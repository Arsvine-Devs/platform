"""Review and reconcile the Web platform's own Cloudflare rules."""

import json

from .edge import CloudflareError
from .registry import match

CACHE_PHASE = "http_request_cache_settings"
RATE_PHASE = "http_ratelimit"
WAF_PHASE = "http_request_firewall_custom"
CACHE_REF = "arsvine-web-private-cache-bypass"
ASSET_CACHE_REF = "arsvine-web-public-assets"
RATE_REF = "arsvine-web-auth-throttle"
SCAN_REF = "arsvine-web-scan-block"
SCAN_PATHS = (
    "/.aws",
    "/.env",
    "/.env.local",
    "/.git",
    "/phpmyadmin",
    "/server-status",
    "/wp-admin",
    "/wp-login.php",
    "/xmlrpc.php",
)
SCAN_PREFIXES = ("/.aws/", "/.env.", "/.git/", "/phpmyadmin/", "/wp-admin/")
AUTH_PATHS = (
    "/api/auth/sign-in/email",
    "/api/auth/passkey/verify-authentication",
    "/api/auth/two-factor/verify-totp",
    "/api/protected-verify",
)


def conditions(hosts, *, path=None, prefix=None):
    target = "http.host in {" + " ".join(json.dumps(host) for host in sorted(hosts)) + "}"
    if prefix is not None:
        return f"({target} and starts_with(http.request.uri.path, {json.dumps(prefix)}))"
    if path is not None:
        return f"({target} and http.request.uri.path eq {json.dumps(path)})"
    return f"({target})"


def policy(sites, desired_edge, rate_limit, *, asset_hostname=None):
    enrolled = {row["record"]["name"]: row["zoneId"] for row in desired_edge["records"]}
    groups = {
        zone_id: {
            "web": set(),
            "protected": set(),
            "realm": set(),
            "ripple": set(),
            "identity": set(),
        }
        for zone_id in enrolled.values()
    }
    for host, zone_id in enrolled.items():
        groups[zone_id]["web"].add(host)
    for site in sites.values():
        for target in site.targets.values():
            group = groups[enrolled[target.hostname]]
            if target.access_audience:
                group["protected"].add(target.hostname)
            if site.media:
                group[site.media].add(target.hostname)
            if "identity" in site.capabilities or site.id == "realm":
                group["identity"].add(target.hostname)
    zones = []
    for zone_id, group in sorted(groups.items()):
        cache_conditions = []
        if group["protected"]:
            cache_conditions.append(conditions(group["protected"]))
        if group["realm"]:
            cache_conditions.append(conditions(group["realm"], prefix="/media/"))
        if group["ripple"]:
            cache_conditions.append(conditions(group["ripple"], path="/api/music"))
        entries = []
        if asset_hostname and enrolled.get(asset_hostname) == zone_id:
            entries.append(
                {
                    "phase": CACHE_PHASE,
                    "rule": {
                        "ref": ASSET_CACHE_REF,
                        "enabled": True,
                        "action": "set_cache_settings",
                        "description": "Arsvine CDN: follow origin caching for public files",
                        "expression": conditions({asset_hostname}, prefix="/media/")
                        + ' and http.request.method in {"GET" "HEAD"}',
                        "action_parameters": {
                            "cache": True,
                            "edge_ttl": {"mode": "bypass_by_default"},
                            "browser_ttl": {"mode": "respect_origin"},
                        },
                    },
                }
            )
        if cache_conditions:
            entries.append(
                {
                    "phase": CACHE_PHASE,
                    "rule": {
                        "ref": CACHE_REF,
                        "enabled": True,
                        "action": "set_cache_settings",
                        "description": "Arsvine Web: bypass shared cache for protected sites and media",
                        "expression": " or ".join(cache_conditions),
                        "action_parameters": {"cache": False},
                    },
                }
            )
        if group["identity"] and rate_limit != "off":
            paths = (
                "http.request.uri.path in {"
                + " ".join(json.dumps(path) for path in AUTH_PATHS)
                + "}"
            )
            expression = paths
            if rate_limit == "host-post":
                expression = (
                    conditions(group["identity"])
                    + ' and http.request.method eq "POST" and '
                    + paths
                )
            entries.append(
                {
                    "phase": RATE_PHASE,
                    "rule": {
                        "ref": RATE_REF,
                        "enabled": True,
                        "action": "block",
                        "description": "Arsvine Web: slow repeated authentication attempts",
                        "expression": f"(cf.waf.credential_check.password_leaked) or ({expression})",
                        "ratelimit": {
                            "characteristics": ["cf.colo.id", "ip.src"],
                            "period": 10,
                            "requests_per_period": 5,
                            "mitigation_timeout": 10,
                        },
                    },
                }
            )
        path = "lower(http.request.uri.path)"
        scan_conditions = [
            path + " in {" + " ".join(json.dumps(candidate) for candidate in SCAN_PATHS) + "}",
            *(f"starts_with({path}, {json.dumps(prefix)})" for prefix in SCAN_PREFIXES),
        ]
        entries.append(
            {
                "phase": WAF_PHASE,
                "rule": {
                    "ref": SCAN_REF,
                    "enabled": True,
                    "action": "block",
                    "description": "Arsvine Web: block probes for private config and unused software",
                    "expression": conditions(group["web"])
                    + " and ("
                    + " or ".join(scan_conditions)
                    + ")",
                },
            }
        )
        zones.append({"zoneId": zone_id, "rules": entries})
    return {
        "managedProtections": [
            "Cloudflare Free Managed Ruleset",
            "Cloudflare automatic DDoS protection",
        ],
        "rateLimitMode": rate_limit,
        "zones": zones,
    }


def contains(actual, expected):
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            key in actual and contains(actual[key], value) for key, value in expected.items()
        )
    return actual == expected


def sync(client, desired):
    """Create missing phase rulesets or update only the named platform rules."""
    changes = []
    for zone in desired["zones"]:
        base = f"/zones/{zone['zoneId']}/rulesets"
        for entry in zone["rules"]:
            phase, rule = entry["phase"], entry["rule"]
            try:
                ruleset = client.call(f"{base}/phases/{phase}/entrypoint")
            except CloudflareError as exc:
                if exc.status != 404:
                    raise
                changes.append(
                    (
                        base,
                        "POST",
                        {
                            "name": "Arsvine Web",
                            "kind": "zone",
                            "phase": phase,
                            "rules": [rule],
                        },
                    )
                )
                continue
            ruleset_id = match(ruleset["id"], r"[a-f0-9]{32}", "Cloudflare ruleset ID")
            rules_url = f"{base}/{ruleset_id}/rules"
            rules = ruleset.get("rules", [])
            found = [candidate for candidate in rules if candidate.get("ref") == rule["ref"]]
            if len(found) > 1:
                raise ValueError(f"Cloudflare contains duplicate rule references for {rule['ref']}")
            if not found:
                changes.append((rules_url, "POST", rule))
                continue
            current = found[0]
            patch = dict(rule)
            if phase == CACHE_PHASE and rule["ref"] == CACHE_REF and rules[-1] != current:
                # Cache Rules use the last matching cache setting.
                patch["position"] = {"after": ""}
            if not contains(current, rule) or "position" in patch:
                rule_id = match(current["id"], r"[a-f0-9]{32}", "Cloudflare rule ID")
                changes.append((f"{rules_url}/{rule_id}", "PATCH", patch))
    for path, method, body in changes:
        client.call(path, method, body)
