"""Install the self-hosted Web runtime using root-owned systemd and nft configuration."""

import grp
import json
import os
import pwd
import re
import ssl
import stat
import subprocess
import tempfile
from pathlib import Path

from .artifacts import runtime_archive
from .registry import (
    CONFIG,
    GATEWAY_STATE,
    LOCAL_SERVICES,
    ORIGIN_CA,
    ORIGIN_ONLY,
    ORIGIN_PORT,
    STATE,
    caddyfile,
)

LIBEXEC = Path("/usr/local/libexec/arsvine-ops")
WEB_RUNTIME = LIBEXEC / "web.pyz"
UNITS = Path("/etc/systemd/system")
CONTROLLER = "ars-web-controller"
GATEWAY = "ars-web-gateway"
TUNNEL = "ars-web-tunnel"
CONSOLE = "ars-web-console"
OBSERVER = "ars-web-observe"
FIREWALL = "arsvine_web"
PUBLIC_ORIGIN_SITES = ("realm", "ripple", "console", "auth", "api", "content")


def media_group(environment):
    return "ars-web-media-" + ("live" if environment == "production" else "pr")


RESTRICTIONS = """NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectKernelLogs=true
RestrictSUIDSGID=true
RestrictNamespaces=true
CapabilityBoundingSet=
LimitCORE=0
"""


def run(*args, **options):
    return subprocess.run(args, check=True, **options)


def check_ports(sites):
    owners = {ORIGIN_PORT: "arsvine-web-gateway.service"}
    owners.update(
        (target.port, f"arsvine-web-{site.slot(environment)}.service")
        for site in sites.values()
        for environment, target in site.targets.items()
        if target.port is not None
    )
    sockets = run("/usr/bin/ss", "-H", "-ltnp", capture_output=True, text=True)
    for line in sockets.stdout.splitlines():
        columns = line.split(maxsplit=5)
        if len(columns) < 5:
            continue
        port = columns[3].rsplit(":", 1)[-1]
        if not port.isdecimal() or int(port) not in owners:
            continue
        processes = re.findall(r"\bpid=(\d+)\b", columns[5]) if len(columns) >= 6 else []
        unit = owners[int(port)]
        if not processes or any(not unit_owns_process(unit, pid) for pid in processes):
            raise ValueError(f"Origin TCP port {port} is already in use")


def unit_owns_process(unit, pid):
    try:
        cgroups = Path(f"/proc/{pid}/cgroup").read_text(encoding="ascii")
    except OSError:
        return False
    return any(unit in line.rsplit(":", 1)[-1].split("/") for line in cgroups.splitlines())


def write(path, content, mode=0o644, group=0):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        pending = Path(temporary.name)
        try:
            temporary.write(content.encode() if isinstance(content, str) else content)
            temporary.flush()
            os.fchown(temporary.fileno(), 0, group)
            os.fchmod(temporary.fileno(), mode)
            pending.replace(path)
        finally:
            pending.unlink(missing_ok=True)


def directory(path, mode, *, owner=0, group=0):
    path.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir():
        raise ValueError(f"Unsafe runtime directory {path}")
    os.chown(path, owner, group)
    path.chmod(mode)


def provision_access_log(path, *, owner, group):
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK
    descriptor = os.open(path, flags, 0o600)
    try:
        attributes = os.fstat(descriptor)
        if not stat.S_ISREG(attributes.st_mode) or attributes.st_nlink != 1:
            raise ValueError(f"Unsafe access log file {path}")
        os.fchown(descriptor, owner, group)
        os.fchmod(descriptor, 0o640)
    finally:
        os.close(descriptor)


def pin_origin_ca(source: Path, destination: Path, *, gateway_uid: int) -> bool:
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        attributes = os.fstat(stream.fileno())
        if not stat.S_ISREG(attributes.st_mode) or attributes.st_uid != gateway_uid:
            raise ValueError("Caddy origin CA must be a regular file owned by the gateway")
        certificate = stream.read(32769)
    pem = certificate.strip()
    if (
        len(certificate) > 32768
        or not pem.startswith(b"-----BEGIN CERTIFICATE-----")
        or not pem.endswith(b"-----END CERTIFICATE-----")
        or pem.count(b"-----BEGIN ") != 1
    ):
        raise ValueError("Caddy origin CA must contain one public PEM certificate")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_verify_locations(cadata=pem.decode("ascii"))
    if context.cert_store_stats()["x509_ca"] != 1:
        raise ValueError("Caddy origin certificate is not a CA")
    existing = None
    if not destination.is_symlink() and destination.is_file():
        existing = destination.read_bytes()
        mode = destination.stat()
        if (
            existing == certificate
            and mode.st_uid == 0
            and mode.st_gid == 0
            and stat.S_IMODE(mode.st_mode) == 0o644
        ):
            return False
    write(destination, certificate, mode=0o644)
    return existing != certificate


def system_user(user):
    try:
        return pwd.getpwnam(user)
    except KeyError:
        run(
            "/usr/sbin/useradd",
            "--system",
            "--user-group",
            "--no-create-home",
            "--shell",
            "/usr/sbin/nologin",
            user,
        )
        return pwd.getpwnam(user)


def firewall(sites, uid, *, origin_only=False):
    controller, gateway = uid(CONTROLLER), uid(GATEWAY)
    gateway_clients = {0, controller}
    if not origin_only:
        gateway_clients.add(uid(TUNNEL))
    app_uids = {
        uid(site.user(environment))
        for site in sites.values()
        if site.runtime == "node"
        for environment in site.targets
    }
    ports = {
        target.port for site in sites.values() for target in site.targets.values() if target.port
    }

    def nft_set(values):
        return "{ " + ", ".join(str(value) for value in sorted(values)) + " }"

    lines = [
        f"table inet {FIREWALL} {{",
        "  chain local_output {",
        "    type filter hook output priority 5; policy accept;",
        "    ct state established,related accept",
        f"    fib daddr type local tcp dport {ORIGIN_PORT} meta skuid != {nft_set(gateway_clients)} reject",
    ]
    for site in sites.values():
        for environment in site.targets:
            peers = site.dependency_targets(sites, environment)
            if peers:
                peer_ports = nft_set({peer.port for peer in peers.values()})
                principal = uid(site.user(environment))
                lines.append(
                    f"    meta skuid {principal} ip daddr 127.0.0.1 tcp dport {peer_ports} accept"
                )
    if ports:
        lines.append(
            f"    fib daddr type local tcp dport {nft_set(ports)} meta skuid != {nft_set({0, controller, gateway})} reject"
        )
    if app_uids:
        members = f"meta skuid {nft_set(app_uids)}"
        # In addition to registered peers, tenants may reach the DNS stub and enrolled databases.
        lines.append(
            f"    {members} ip daddr 127.0.0.53 meta l4proto {{ tcp, udp }} th dport 53 accept"
        )
        for site in sites.values():
            if site.local_services:
                site_uids = nft_set({uid(site.user(environment)) for environment in site.targets})
                local_ports = nft_set({LOCAL_SERVICES[service] for service in site.local_services})
                lines.append(
                    f"    meta skuid {site_uids} ip daddr 127.0.0.1 tcp dport {local_ports} accept"
                )
        lines.extend(
            (
                f"    {members} fib daddr type local reject",
                f"    {members} ip daddr {{ 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4 }} reject",
                f"    {members} ip6 daddr {{ ::/128, ::1/128, fc00::/7, fe80::/10, ff00::/8 }} reject",
            )
        )
    lines.extend(
        (
            "  }",
            "  chain local_input {",
            "    type filter hook input priority -5; policy accept;",
            f'    iifname != "lo" tcp dport {nft_set({ORIGIN_PORT, *ports})} drop',
            "  }",
            "}",
        )
    )
    return "\n".join(lines) + "\n"


def origin_environment(site, sites, environment):
    peers = site.dependency_targets(sites, environment)
    origins = {name: f"http://127.0.0.1:{peer.port}" for name, peer in peers.items()}
    lines = [f"ARS_WEB_INTERNAL_ORIGINS='{json.dumps(origins, separators=(',', ':'))}'"]
    if site.id in PUBLIC_ORIGIN_SITES:
        public = {
            name: f"https://{sites[name].targets[environment].hostname}"
            for name in PUBLIC_ORIGIN_SITES
            if name in sites and environment in sites[name].targets
        }
        lines.append(f"ARS_WEB_ORIGINS='{json.dumps(public, separators=(',', ':'))}'")
    if site.media == "realm":
        for name in ("auth", "content"):
            if name in peers:
                prefix = name.upper()
                lines.extend(
                    (
                        f"{prefix}_INTERNAL_ORIGIN={origins[name]}",
                        f"{prefix}_ORIGIN=https://{peers[name].hostname}",
                    )
                )
    return lines


def apply_firewall(configuration, *, validate=False):
    result = run("/usr/sbin/nft", "-j", "list", "tables", capture_output=True, text=True)
    tables = json.loads(result.stdout)["nftables"]
    exists = any(
        row.get("table", {}).get("name") == FIREWALL and row["table"]["family"] == "inet"
        for row in tables
    )
    batch = (f"delete table inet {FIREWALL}\n" if exists else "") + configuration
    options = ("-c",) if validate else ()
    run("/usr/sbin/nft", *options, "-f", "-", input=batch, text=True)


def node_unit(site, environment):
    target = site.targets[environment]
    slot = site.slot(environment)
    directory = site.directory(environment)
    account_groups = []
    extra = []
    inaccessible = [
        "/etc/vps-ops",
        "/var/lib/vps-ops",
        "/etc/wireguard",
        "/srv/vps-subscriptions",
        str(CONFIG),
        "/run/postgresql",
        "/run/redis",
        "/run/valkey",
        "/run/dbus",
        "/run/systemd/private",
        "/run/docker.sock",
        "/run/podman/podman.sock",
    ]
    if site.id == "console":
        account_groups.append(CONSOLE)
    else:
        inaccessible.append("/run/arsvine-web")
    if site.media == "realm":
        account_groups.append(media_group(environment))
    if account_groups:
        extra.append("SupplementaryGroups=" + " ".join(account_groups))
    if site.storage == "content":
        extra.append(f"ReadWritePaths={STATE}/content/{environment}")
    extra_options = "\n".join(extra)
    hidden_paths = " ".join("-" + path for path in inaccessible)
    return f"""[Unit]
Description=Arsvine Web site {slot}
Requires=arsvine-web-guard.service
After=arsvine-web-guard.service network-online.target
ConditionPathIsDirectory={directory}/current

[Service]
User={site.user(environment)}
Slice=arsvine-web.slice
UMask=0077
WorkingDirectory={directory}/current
ExecStart=/usr/bin/node {directory}/current/entry.mjs
Environment=NODE_ENV=production HOSTNAME=127.0.0.1 HOST=127.0.0.1 PORT={target.port}
EnvironmentFile=-{CONFIG}/env/{slot}.env
EnvironmentFile={CONFIG}/run/{slot}.env
{extra_options}
StateDirectory=arsvine-web-{slot}
StateDirectoryMode=0700
MemoryHigh={site.memory_mib * 9 // 10}M
MemoryMax={site.memory_mib}M
TasksMax=80
CPUQuota=75%
SocketBindAllow=ipv4:tcp:{target.port}
SocketBindDeny=any
InaccessiblePaths={hidden_paths}
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
{RESTRICTIONS}
[Install]
WantedBy=multi-user.target
"""


def shared_units(*, origin_only=False, github_enabled=False):
    credentials = (
        f"LoadCredential=github-token:{CONFIG}/credentials/github-token\n"
        if github_enabled and not origin_only
        else ""
    )
    mode = " --origin-only" if origin_only else ""
    units = {
        "arsvine-web.slice": """[Unit]
Description=Arsvine Web workload budget

[Slice]
CPUWeight=70
IOWeight=70
MemoryHigh=45%
MemoryMax=55%
TasksMax=450
""",
        "arsvine-web-guard.service": f"""[Unit]
Description=Arsvine Web local origin controls
After=nftables.service

[Service]
Type=oneshot
RemainAfterExit=true
ExecStart={WEB_RUNTIME} apply-firewall

[Install]
WantedBy=multi-user.target
""",
        "arsvine-web-gateway.service": f"""[Unit]
Description=Arsvine Web gateway
Requires=arsvine-web-guard.service
After=arsvine-web-guard.service network-online.target

[Service]
User={GATEWAY}
SupplementaryGroups={media_group("production")} {media_group("preview")}
Slice=arsvine-web.slice
Type=notify
ExecStart=/usr/bin/caddy run --config {CONFIG}/Caddyfile
ExecReload=/usr/bin/caddy reload --address unix//run/arsvine-web-gateway/admin.sock --config {CONFIG}/Caddyfile
RuntimeDirectory=arsvine-web-gateway
RuntimeDirectoryMode=0700
StateDirectory=arsvine-web-gateway
StateDirectoryMode=0700
ReadWritePaths={STATE}/ingress
Environment=HOME={GATEWAY_STATE}
MemoryMax=180M
Restart=on-failure
{RESTRICTIONS}
[Install]
WantedBy=multi-user.target
""",
        "arsvine-web-tunnel.service": f"""[Unit]
Description=Arsvine Web Cloudflare Tunnel
Requires=arsvine-web-guard.service arsvine-web-gateway.service
Wants=network-online.target
After=arsvine-web-guard.service arsvine-web-gateway.service network-online.target
ConditionPathExists={ORIGIN_CA}

[Service]
User={TUNNEL}
Slice=arsvine-web.slice
LoadCredential=tunnel-token:{CONFIG}/credentials/tunnel-token
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:20241 run --token-file %d/tunnel-token
MemoryMax=180M
Restart=on-failure
RestartSec=4
{RESTRICTIONS}
[Install]
WantedBy=multi-user.target
""",
        "arsvine-web-controller.socket": f"""[Unit]
Description=Private Arsvine Web controller socket

[Socket]
ListenStream=/run/arsvine-web/control.sock
SocketUser={CONTROLLER}
SocketGroup={CONSOLE}
SocketMode=0660
DirectoryMode=0755
RemoveOnStop=true

[Install]
WantedBy=sockets.target
""",
        "arsvine-web-controller.service": f"""[Unit]
Description=Arsvine Web release controller
Requires=arsvine-web-guard.service
After=arsvine-web-guard.service network-online.target

[Service]
User={CONTROLLER}
SupplementaryGroups={OBSERVER}
Slice=arsvine-web.slice
UMask=0077
{credentials}ExecStart={WEB_RUNTIME} serve{mode}
ReadWritePaths={STATE}
MemoryMax=192M
Restart=on-failure
RestartSec=3
{RESTRICTIONS}
""",
    }
    if origin_only:
        units.pop("arsvine-web-tunnel.service")
    return units


def install(sites, *, origin_only=False):
    if origin_only and (UNITS / "arsvine-web-tunnel.service").exists():
        raise ValueError("Local-origin mode requires a host without an installed Web Tunnel")
    dependencies = [
        Path("/usr/bin/caddy"),
        Path("/usr/bin/ss"),
        Path("/usr/sbin/nft"),
        Path("/usr/sbin/runuser"),
    ]
    if not origin_only:
        dependencies.append(Path("/usr/bin/cloudflared"))
    if any(site.runtime == "node" for site in sites.values()):
        dependencies.extend((Path("/usr/bin/node"), Path("/etc/polkit-1/rules.d")))
    for path in dependencies:
        if not path.exists():
            raise ValueError(f"Install the required host dependency {path}")
    required_files = ["sites.json"]
    github_file = CONFIG / "credentials/github-token"
    github_enabled = not origin_only and (github_file.exists() or github_file.is_symlink())
    if not origin_only:
        required_files.append("credentials/tunnel-token")
    if github_enabled:
        required_files.append("credentials/github-token")
    if any(
        not (CONFIG / name).is_file() or (CONFIG / name).is_symlink() for name in required_files
    ):
        raise ValueError("Install the required site registry and credential files first")
    check_ports(sites)
    controller = system_user(CONTROLLER)
    gateway = system_user(GATEWAY)
    if not origin_only:
        system_user(TUNNEL)
    for group in (CONSOLE, OBSERVER, media_group("production"), media_group("preview")):
        try:
            grp.getgrnam(group)
        except KeyError:
            run("/usr/sbin/groupadd", "--system", group)
    directory(CONFIG, 0o755)
    directory(CONFIG / "env", 0o700)
    directory(CONFIG / "run", 0o700)
    directory(CONFIG / "credentials", 0o700)
    directory(CONFIG / "tls", 0o755)
    for name in required_files:
        path = CONFIG / name
        os.chown(path, 0, 0)
        path.chmod(0o600 if name.startswith("credentials") else 0o644)
    directory(LIBEXEC, 0o755)
    write(WEB_RUNTIME, runtime_archive(), 0o755)
    directory(STATE, 0o755)
    # SQLite and downloads are private, while generated site roots are traversable only by their serving UID.
    directory(STATE / "staging", 0o700, owner=controller.pw_uid, group=controller.pw_gid)
    directory(STATE / "controller", 0o700, owner=controller.pw_uid, group=controller.pw_gid)
    observer = grp.getgrnam(OBSERVER)
    ingress_directory = STATE / "ingress"
    directory(ingress_directory, 0o2750, owner=gateway.pw_uid, group=observer.gr_gid)
    directory(GATEWAY_STATE, 0o700, owner=gateway.pw_uid, group=gateway.pw_gid)
    directory(GATEWAY_STATE / "caddy", 0o700, owner=gateway.pw_uid, group=gateway.pw_gid)
    directory(STATE / "sites", 0o755)
    for environment in ("production", "preview"):
        directory(
            STATE / "media" / environment / "public",
            0o2750,
            group=grp.getgrnam(media_group(environment)).gr_gid,
        )
    app_units = []
    for site in sites.values():
        directory(STATE / "sites" / site.id, 0o711)
        for environment, target in site.targets.items():
            provision_access_log(
                ingress_directory / f"{site.slot(environment)}.json",
                owner=gateway.pw_uid,
                group=observer.gr_gid,
            )
            user = system_user(site.user(environment)) if site.runtime == "node" else gateway
            deployment = site.directory(environment)
            directory(deployment, 0o750, owner=controller.pw_uid, group=user.pw_gid)
            directory(
                deployment / "releases",
                0o750,
                owner=controller.pw_uid,
                group=user.pw_gid,
            )
            if site.runtime == "node":
                slot = site.slot(environment)
                unit = f"arsvine-web-{slot}.service"
                write(UNITS / unit, node_unit(site, environment))
                runtime = [
                    "NODE_ENV=production",
                    "HOSTNAME=127.0.0.1",
                    "HOST=127.0.0.1",
                    f"PORT={target.port}",
                ]
                runtime.extend(origin_environment(site, sites, environment))
                if site.storage == "content":
                    root = STATE / "content" / environment
                    directory(root, 0o700, owner=user.pw_uid, group=user.pw_gid)
                    runtime.append(f"CONTENT_STORAGE_ROOT={root}")
                if site.media == "realm":
                    media = STATE / "media" / environment
                    directory(media / "private", 0o2750, group=user.pw_gid)
                    runtime.extend(
                        (
                            f"REALM_CATALOG_ROOT={media}/private",
                            f"REALM_CATALOG_POINTER={media}/public/realm/site-catalog/current.json",
                        )
                    )
                write(CONFIG / "run" / f"{slot}.env", "\n".join(runtime) + "\n", 0o600)
                app_units.append(unit)
    previous_units = CONFIG / "installed-units.json"
    if previous_units.is_file():
        previous = json.loads(previous_units.read_text(encoding="utf-8"))
        if not isinstance(previous, list) or any(
            not isinstance(unit, str)
            or not re.fullmatch(
                r"arsvine-web-[a-z][a-z0-9-]{0,23}-(?:production|preview)\.service",
                unit,
            )
            for unit in previous
        ):
            raise ValueError("Invalid installed Web unit inventory")
        for name in sorted(set(previous) - set(app_units)):
            run("/usr/bin/systemctl", "disable", "--now", name)
            (UNITS / name).unlink(missing_ok=True)
            slot = name.removeprefix("arsvine-web-").removesuffix(".service")
            (CONFIG / "run" / f"{slot}.env").unlink(missing_ok=True)
    units = shared_units(origin_only=origin_only, github_enabled=github_enabled)
    for unit, content in units.items():
        write(UNITS / unit, content)
    allowed = json.dumps(app_units)
    polkit = Path("/etc/polkit-1/rules.d")
    if polkit.is_dir():
        write(
            polkit / "60-arsvine-web.rules",
            f"""polkit.addRule(function(action, subject) {{
  if (action.id === "org.freedesktop.systemd1.manage-units" && subject.user === "{CONTROLLER}" &&
      {allowed}.indexOf(action.lookup("unit")) !== -1 &&
      ["restart", "stop"].indexOf(action.lookup("verb")) !== -1) {{
    return polkit.Result.YES;
  }}
}});
""",
        )

    def uid(user: str) -> int:
        return pwd.getpwnam(user).pw_uid

    rules = firewall(sites, uid, origin_only=origin_only)
    apply_firewall(rules, validate=True)
    write(CONFIG / "origin.nft", rules)
    contents = caddyfile(sites)
    with tempfile.NamedTemporaryFile(dir=CONFIG, mode="w", encoding="utf-8") as candidate:
        candidate.write(contents)
        candidate.flush()
        os.fchown(candidate.fileno(), 0, gateway.pw_gid)
        os.fchmod(candidate.fileno(), 0o640)
        run(
            "/usr/sbin/runuser",
            "--user",
            GATEWAY,
            "--preserve-environment",
            "--",
            "/usr/bin/caddy",
            "validate",
            "--config",
            candidate.name,
            "--adapter",
            "caddyfile",
            env={"HOME": str(GATEWAY_STATE), "PATH": "/usr/bin:/usr/sbin"},
        )
    write(CONFIG / "Caddyfile", contents)
    if origin_only:
        write(ORIGIN_ONLY, "Local archive bootstrap is enabled\n")
    else:
        ORIGIN_ONLY.unlink(missing_ok=True)
    run("/usr/bin/systemctl", "daemon-reload")
    run("/usr/bin/systemctl", "enable", "arsvine-web-guard.service", *app_units)
    write(previous_units, json.dumps(app_units) + "\n", 0o600)
    run("/usr/bin/systemctl", "restart", "arsvine-web-guard.service")
    run("/usr/bin/systemctl", "enable", "--now", "arsvine-web-gateway.service")
    run("/usr/bin/systemctl", "reload", "arsvine-web-gateway.service")
    root_certificate = GATEWAY_STATE / "caddy/pki/authorities/local/root.crt"
    trust_changed = pin_origin_ca(root_certificate, ORIGIN_CA, gateway_uid=gateway.pw_uid)
    run("/usr/bin/systemctl", "enable", "--now", "arsvine-web-controller.socket")
    run("/usr/bin/systemctl", "try-restart", "arsvine-web-controller.service")
    if not origin_only:
        run("/usr/bin/systemctl", "enable", "arsvine-web-tunnel.service")
        run(
            "/usr/bin/systemctl",
            "restart" if trust_changed else "start",
            "arsvine-web-tunnel.service",
        )
