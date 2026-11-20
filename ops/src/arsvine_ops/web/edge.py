"""Root-only reconciliation for the dedicated Web Tunnel and DNS records."""

import json
import urllib.error
import urllib.parse
import urllib.request

from .artifacts import NoRedirect
from .registry import ORIGIN_CA, ORIGIN_PORT, fields, hostname, match


def preview_target(sites, project):
    site = sites.get(project)
    if site is None or "preview" not in site.targets:
        raise ValueError("Select a project with an enrolled preview")
    return site.targets["preview"]


def plan(sites, path, *, preview=None):
    settings = json.loads(path.read_text(encoding="utf-8"))
    fields(settings, ("accountId", "tunnelId", "zones"), ("teamName",))
    account = match(settings["accountId"], r"[a-f0-9]{32}", "Cloudflare account ID")
    tunnel = match(
        settings["tunnelId"],
        r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}",
        "Tunnel ID",
    )
    if not isinstance(settings["zones"], dict) or not settings["zones"]:
        raise ValueError("Cloudflare DNS zones must be registered")
    zones = {
        hostname(host): match(zone, r"[a-f0-9]{32}", "Cloudflare zone ID")
        for host, zone in settings["zones"].items()
    }
    team = settings.get("teamName")
    if team is not None:
        match(team, r"[a-z0-9][a-z0-9-]{0,62}", "Access team name")
    ingress = []
    records = []
    targets = (
        [preview_target(sites, preview)]
        if preview is not None
        else [target for site in sites.values() for target in site.targets.values()]
    )
    origins = [
        (domain, target.access_audience)
        for target in targets
        for domain in (target.hostname, *target.redirect_aliases)
    ]
    for domain, access_audience in origins:
        candidates = [
            suffix for suffix in zones if domain == suffix or domain.endswith("." + suffix)
        ]
        if not candidates:
            raise ValueError(f"Unregistered Cloudflare DNS zone for {domain}")
        origin = {
            "originServerName": domain,
            "httpHostHeader": domain,
            "caPool": ORIGIN_CA.as_posix(),
        }
        if access_audience:
            if not team:
                raise ValueError("An Access team is required for protected hostnames")
            origin["access"] = {
                "required": True,
                "teamName": team,
                "audTag": [access_audience],
            }
        ingress.append(
            {
                "hostname": domain,
                "service": f"https://127.0.0.1:{ORIGIN_PORT}",
                "originRequest": origin,
            }
        )
        records.append(
            {
                "zoneId": zones[max(candidates, key=len)],
                "record": {
                    "type": "CNAME",
                    "name": domain,
                    "content": f"{tunnel}.cfargotunnel.com",
                    "proxied": True,
                    "ttl": 1,
                },
            }
        )
    ingress.append({"service": "http_status:404"})
    return {
        "accountId": account,
        "tunnelId": tunnel,
        "configuration": {"config": {"ingress": ingress}},
        "records": records,
    }


class Cloudflare:
    def __init__(self, credential):
        token = credential.read_text(encoding="utf-8").strip()
        if not token or any(character.isspace() for character in token):
            raise ValueError("Cloudflare API credential is unavailable")
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        self.client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(self, path, method="GET", data=None):
        request = urllib.request.Request(
            "https://api.cloudflare.com/client/v4" + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers=self.headers,
            method=method,
        )
        try:
            with self.client.open(request, timeout=20) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            error.close()
            raise CloudflareError(method, error.code) from None
        except OSError:
            raise ValueError(f"Cloudflare {method} request failed") from None
        if payload.get("success") is not True:
            raise ValueError(f"Cloudflare {method} request was rejected")
        return payload["result"]


class CloudflareError(ValueError):
    def __init__(self, method, status):
        self.status = status
        super().__init__(f"Cloudflare {method} request failed with HTTP {status}")


def merge_preview(tunnel_client, path, desired):
    ingress = desired["config"]["ingress"]
    if len(ingress) != 2 or not ingress[0].get("hostname"):
        raise ValueError("Scoped synchronization requires one preview hostname")
    route, fallback = ingress
    try:
        current = tunnel_client.call(path)
    except CloudflareError as error:
        if error.status != 404:
            raise
        return desired
    if not isinstance(current, dict) or "config" not in current:
        raise ValueError("Cloudflare returned an invalid Tunnel configuration")
    config = current["config"]
    if config is None:
        return desired
    if not isinstance(config, dict):
        raise ValueError("Cloudflare returned an invalid Tunnel configuration")
    existing = config.get("ingress", [])
    if not isinstance(existing, list) or any(
        not isinstance(entry, dict) or not isinstance(entry.get("hostname") or "", str)
        for entry in existing
    ):
        raise ValueError("Cloudflare returned invalid Tunnel ingress rules")
    matching = [
        index
        for index, entry in enumerate(existing)
        if entry.get("hostname") == route["hostname"] and not entry.get("path")
    ]
    if len(matching) > 1:
        raise ValueError("Tunnel contains multiple routes for the selected preview")
    replacement = list(existing)
    if matching:
        replacement[matching[0]] = route
    else:
        # Unrelated routes keep their relative order, including preview path overrides.
        position = next(
            (
                index
                for index, entry in enumerate(existing)
                if not entry.get("hostname")
                or (
                    entry["hostname"].startswith("*.")
                    and route["hostname"].endswith(entry["hostname"][1:])
                )
            ),
            len(existing),
        )
        replacement.insert(position, route)
    if replacement[-1].get("hostname") or replacement[-1].get("path"):
        replacement.append(fallback)
    return {"config": {**config, "ingress": replacement}}


def publish(desired, tunnel_client, dns_client, *, preserve_routes=False):
    additions = []
    for entry in desired["records"]:
        record = entry["record"]
        path = f"/zones/{entry['zoneId']}/dns_records"
        query = urllib.parse.urlencode({"name": record["name"], "per_page": "100"})
        existing = dns_client.call(path + "?" + query)
        if not existing:
            additions.append((path, record))
        elif len(existing) != 1 or any(
            existing[0].get(key) != record[key] for key in ("type", "name", "content", "proxied")
        ):
            raise ValueError(f"Existing DNS at {record['name']} needs an explicit cutover")
    path = f"/accounts/{desired['accountId']}/cfd_tunnel/{desired['tunnelId']}/configurations"
    configuration = desired["configuration"]
    if preserve_routes:
        configuration = merge_preview(tunnel_client, path, configuration)
    tunnel_client.call(path, "PUT", configuration)
    for path, record in additions:
        dns_client.call(path, "POST", record)
