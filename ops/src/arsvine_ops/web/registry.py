"""Root-owned site registration and deterministic origin rendering."""

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

CONFIG = Path("/etc/arsvine-web")
ORIGIN_CA = CONFIG / "tls/origin-ca.pem"
ORIGIN_ONLY = CONFIG / "origin-only"
STATE = Path("/var/lib/arsvine-web")
GATEWAY_STATE = STATE.with_name("arsvine-web-gateway")
SOCKET = Path("/run/arsvine-web/control.sock")
ORIGIN_PORT = 8080
ENVIRONMENTS = ("production", "preview")
LOCAL_SERVICES = {"postgres": 5432, "valkey": 6379}
RESERVED_PORTS = {10443, 10480, 15080, 15081, 20241}
SITE_ID = r"[a-z][a-z0-9-]{0,23}"


def match(value, pattern, label):
    if not isinstance(value, str) or not re.fullmatch(pattern, value, re.ASCII):
        raise ValueError(f"Invalid {label}")
    return value


def fields(value, required, optional=()):
    if not isinstance(value, dict) or set(required) - value.keys():
        raise ValueError("Required configuration fields are missing")
    if value.keys() - set(required) - set(optional):
        raise ValueError("Unknown configuration field")


def hostname(value):
    return match(
        value,
        r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}",
        "hostname",
    )


@dataclass(frozen=True)
class Target:
    hostname: str
    port: int | None
    access_audience: str | None
    redirect_aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class Site:
    id: str
    repository: str
    runtime: str
    production_ref: str
    workflow: str
    health_path: str
    targets: dict[str, Target]
    media: str | None
    storage: str | None
    local_services: tuple[str, ...]
    memory_mib: int
    capabilities: tuple[str, ...]
    dependencies: tuple[str, ...]

    def slot(self, environment: str) -> str:
        if environment not in self.targets:
            raise ValueError("Project environment is unavailable")
        return f"{self.id}-{environment}"

    def user(self, environment: str) -> str:
        return f"aw-{self.id}-{'live' if environment == 'production' else 'pr'}"

    def directory(self, environment, state=STATE):
        self.slot(environment)
        return state / "sites" / self.id / environment

    def artifact(self, environment: str) -> str:
        self.slot(environment)
        return f"web-{self.id}-{environment}"

    def dependency_targets(
        self, sites: Mapping[str, "Site"], environment: str
    ) -> dict[str, Target]:
        self.slot(environment)
        return {
            dependency: sites[dependency].targets[environment] for dependency in self.dependencies
        }


def load_registry(path: Path) -> dict[str, Site]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    fields(raw, ("sites",))
    if not isinstance(raw["sites"], list):
        raise ValueError("Expected a list of sites")
    sites: dict[str, Site] = {}
    hosts = set()
    ports = set()
    for row in raw["sites"]:
        fields(
            row,
            ("id", "repository", "runtime", "productionRef", "production"),
            (
                "preview",
                "healthPath",
                "workflow",
                "media",
                "storage",
                "localServices",
                "memoryMiB",
                "capabilities",
                "dependencies",
            ),
        )
        site_id = match(row["id"], SITE_ID, "site ID")
        if site_id in sites:
            raise ValueError(f"Duplicate site: {site_id}")
        repo = match(row["repository"], r"[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+", "repository")
        if repo.split("/")[1] in {".", ".."}:
            raise ValueError("Invalid repository")
        runtime = match(row["runtime"], r"node|static", "runtime")
        branch = match(row["productionRef"], r"[A-Za-z0-9][A-Za-z0-9/_.-]{0,199}", "branch")
        path_spec = r"/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]*"
        health = match(row.get("healthPath", "/"), path_spec, "health path")
        if {".", ".."}.intersection(health.split("/")):
            raise ValueError("Health path contains a relative segment")
        workflow = match(row.get("workflow", "web.yml"), r"[A-Za-z0-9_-]+\.ya?ml", "workflow")
        media = row.get("media")
        if media is not None:
            match(media, r"realm|ripple", "media route")
            if media == "ripple" and runtime != "static":
                raise ValueError("Ripple's media route requires a static runtime")
            if media == "realm" and runtime != "node":
                raise ValueError("Realm's catalog requires a Node runtime")
        if media and any(site.media == media for site in sites.values()):
            raise ValueError(f"Media route already owned by another project: {media}")
        storage = row.get("storage")
        if storage is not None and (
            storage != "content"
            or runtime != "node"
            or any(site.storage == storage for site in sites.values())
        ):
            raise ValueError("Invalid or duplicate content storage binding")
        local_services = row.get("localServices", [])
        if not isinstance(local_services, list) or any(
            not isinstance(name, str) or name not in LOCAL_SERVICES for name in local_services
        ):
            raise ValueError("Invalid local service")
        if runtime == "static" and local_services:
            raise ValueError("Static sites do not use local services")
        memory_mib = row.get("memoryMiB", 320)
        if type(memory_mib) is not int or not 64 <= memory_mib <= 4096:
            raise ValueError("Invalid site memory limit")
        grants = capabilities(row.get("capabilities", []))
        peers = row.get("dependencies", [])
        if not isinstance(peers, list):
            raise ValueError("Expected a list of site dependencies")
        dependencies = tuple(match(peer, SITE_ID, "site dependency") for peer in peers)
        if len(set(dependencies)) != len(dependencies) or site_id in dependencies:
            raise ValueError(f"Invalid dependencies for {site_id}")
        if runtime == "static" and dependencies:
            raise ValueError(f"Static site {site_id} cannot declare runtime dependencies")
        targets = {}
        for environment in ENVIRONMENTS:
            if environment not in row:
                continue
            target = row[environment]
            fields(target, ("hostname",), ("port", "accessAudience", "redirectAliases"))
            host = hostname(target["hostname"])
            port = target.get("port")
            audience = target.get("accessAudience")
            if host in hosts:
                raise ValueError(f"Duplicate hostname: {host}")
            hosts.add(host)
            aliases = target.get("redirectAliases", [])
            if not isinstance(aliases, list):
                raise ValueError("Redirect aliases must be a list of hostnames")
            if aliases and (site_id != "realm" or environment != "production"):
                raise ValueError("Redirect aliases require Realm production")
            redirect_aliases = tuple(hostname(alias) for alias in aliases)
            for alias in redirect_aliases:
                if alias in hosts:
                    raise ValueError(f"Duplicate hostname: {alias}")
                hosts.add(alias)
            if runtime == "node":
                if (
                    type(port) is not int
                    or not 10240 <= port <= 49151
                    or port in ports | RESERVED_PORTS
                ):
                    raise ValueError(f"Invalid or occupied origin port for {host}")
                ports.add(port)
            elif port is not None:
                raise ValueError("Static sites do not use an origin port")
            if site_id == "console" or environment == "preview" or audience is not None:
                audience = match(audience, r"[a-f0-9]{64}", "Cloudflare Access audience")
            targets[environment] = Target(host, port, audience, redirect_aliases)
        sites[site_id] = Site(
            site_id,
            repo,
            runtime,
            branch,
            workflow,
            health,
            targets,
            media,
            storage,
            tuple(dict.fromkeys(local_services)),
            memory_mib,
            grants,
            dependencies,
        )
    for site in sites.values():
        for name in site.dependencies:
            dependency = sites.get(name)
            if dependency is None or dependency.runtime != "node":
                raise ValueError(f"{site.id} requires a registered Node dependency: {name}")
            for environment in site.targets:
                if environment not in dependency.targets:
                    raise ValueError(
                        f"{site.id} {environment} needs {name} registered for {environment}"
                    )
    return sites


def capabilities(values):
    if not isinstance(values, list) or len(values) > 24:
        raise ValueError("Invalid site capabilities")
    entries = tuple(match(value, r"[a-z][a-z0-9-]{0,35}", "capability") for value in values)
    if len(set(entries)) != len(entries):
        raise ValueError("Duplicate site capabilities")
    return entries


def caddyfile(sites, *, state=STATE):
    storage = state.with_name(GATEWAY_STATE.name) / "caddy"
    lines = [
        "{",
        "  auto_https disable_redirects",
        "  skip_install_trust",
        "  storage file_system {",
        f"    root {storage.as_posix()}",
        "  }",
        "  admin unix//run/arsvine-web-gateway/admin.sock",
        "  servers {",
        "    protocols h1 h2",
        "    strict_sni_host on",
        "  }",
        "}",
    ]
    ripple = next((site for site in sites.values() if site.media == "ripple"), None)
    for site in sites.values():
        for environment, target in site.targets.items():
            lines.extend(
                (
                    f"https://{target.hostname}:{ORIGIN_PORT} {{",
                    "  bind 127.0.0.1",
                    "  tls internal",
                )
            )
            if target.access_audience:
                lines.append('  header Cache-Control "private, no-store"')
            lines.extend(
                (
                    "  log_append <path {http.request.uri.path}",
                    "  log_append <cf_ray {http.request.header.Cf-Ray}",
                    "  log_append request_id {http.response.header.X-Request-Id}",
                    "  log {",
                    f"    output file {state}/ingress/{site.slot(environment)}.json {{",
                    "      mode 0640",
                    "      roll_size 2MiB",
                    "      roll_keep 1",
                    "      roll_keep_for 72h",
                    "    }",
                    "    format filter {",
                    "      wrap json",
                    "      fields {",
                    "        request delete",
                    "        resp_headers delete",
                    "        user_id delete",
                    "      }",
                    "    }",
                    "  }",
                )
            )
            if site.media == "realm" or (site.media == "ripple" and environment == "preview"):
                lines.append("  handle_path /media/* {")
                ripple_target = (
                    ripple.targets.get(environment) if ripple and site.media == "realm" else None
                )
                if ripple_target:
                    origin = f"https://{ripple_target.hostname}"
                    lines.extend(
                        (
                            f"    @ripple_origin header Origin {origin}",
                            "    header +Vary Origin",
                            "    header @ripple_origin {",
                            f"      Access-Control-Allow-Origin {origin}",
                            '      Access-Control-Allow-Methods "GET, HEAD, OPTIONS"',
                            "      Access-Control-Allow-Headers Range",
                            '      Access-Control-Expose-Headers "Accept-Ranges, Content-Range, Content-Length, ETag"',
                            "    }",
                            "    @ripple_preflight {",
                            "      method OPTIONS",
                            f"      header Origin {origin}",
                            "    }",
                            "    respond @ripple_preflight 204",
                        )
                    )
                lines.extend(
                    (
                        f"    root * {state}/media/{environment}/public",
                        "    file_server",
                        "  }",
                    )
                )
            if site.media == "ripple":
                lines.extend(
                    (
                        "  @published_music {",
                        "    path /api/music",
                        "    file {",
                        f"      root {state}/media/{environment}/public",
                        "      try_files /ripple/music.json",
                        "    }",
                        "  }",
                        "  handle @published_music {",
                        f"    root * {state}/media/{environment}/public",
                        '    header Content-Type "application/json; charset=utf-8"',
                        "    rewrite * /ripple/music.json",
                        "    file_server",
                        "  }",
                    )
                )
            lines.append("  handle {")
            if site.media == "ripple":
                lines.append('    header /api/music Content-Type "application/json; charset=utf-8"')
            if site.runtime == "static":
                lines.extend(
                    (
                        f"    root * {site.directory(environment, state)}/current",
                        "    try_files {path} {path}/ {path}.html",
                        "    file_server",
                    )
                )
            else:
                lines.extend(
                    (
                        f"    reverse_proxy 127.0.0.1:{target.port} {{",
                        f"      header_up X-Forwarded-Host {target.hostname}",
                        "      header_up X-Forwarded-Proto https",
                        "      header_up -X-Forwarded-Port",
                        "      header_up -Forwarded",
                        "      header_up -CF-Access-Client-Id",
                        "      header_up -CF-Access-Client-Secret",
                        "      header_up -CF-Access-Jwt-Assertion",
                        "    }",
                    )
                )
            lines.extend(("  }", "}"))
            for alias in target.redirect_aliases:
                lines.extend(
                    (f"https://{alias}:{ORIGIN_PORT} {{", "  bind 127.0.0.1", "  tls internal")
                )
                if target.access_audience:
                    lines.append('  header Cache-Control "private, no-store"')
                lines.extend((f"  redir https://{target.hostname}{{uri}} 308", "}"))
    lines.extend(
        (f"https://:{ORIGIN_PORT} {{", "  bind 127.0.0.1", "  tls internal", "  respond 404", "}")
    )
    return "\n".join(lines) + "\n"
