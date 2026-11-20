#!/usr/bin/env python3
"""Host entrypoints for operating the independent Arsvine Web platform."""

import argparse
import contextlib
import http.client
import json
import logging
import os
import socket
import stat
import subprocess
import sys
from pathlib import Path

from .artifacts import GitHub, runtime_archive
from .controller import Controller, active_id, serve, status_code
from .edge import Cloudflare, plan, publish
from .registry import (
    CONFIG,
    ORIGIN_ONLY,
    ORIGIN_PORT,
    SOCKET,
    STATE,
    caddyfile,
    load_registry,
)
from .security import policy, sync


class UnixConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(SOCKET))


def submit(args):
    payload = {
        "project": args.project,
        "environment": args.environment,
        "runId": args.run_id,
        "commit": args.commit,
        "actor": "operator",
    }
    with contextlib.closing(UnixConnection("local-console", timeout=10)) as client:
        client.request(
            "POST",
            "/v1/deployments",
            json.dumps(payload),
            {"Content-Type": "application/json"},
        )
        with client.getresponse() as response:
            result = json.load(response)
            if response.status != 202:
                raise ValueError(result.get("error", "Controller rejected this deployment"))
    print(json.dumps(result, indent=2))


def root_required():
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise ValueError("Run this host operation as root")


def configure_edge(sites, preview=None):
    root_required()
    if ORIGIN_ONLY.exists():
        raise ValueError("Local-origin mode cannot publish Cloudflare routes")
    desired = plan(sites, CONFIG / "edge.json", preview=preview)
    planned = {entry["record"]["name"] for entry in desired["records"]}
    active = set()
    for site in sites.values():
        for environment, target in site.targets.items():
            if target.hostname not in planned or not active_id(site.directory(environment)):
                continue
            if (
                not 200
                <= status_code(target.hostname, ORIGIN_PORT, site.health_path, tls=True)
                < 300
            ):
                raise ValueError(f"Origin health failed for {target.hostname}")
            active.add(target.hostname)
            for alias in target.redirect_aliases:
                if status_code(alias, ORIGIN_PORT, "/", tls=True) != 308:
                    raise ValueError(f"Origin redirect health failed for {alias}")
                active.add(alias)
    if not active:
        raise ValueError("Deploy a healthy release before enabling the Tunnel routes")
    config = desired["configuration"]["config"]
    config["ingress"] = [
        route
        for route in config["ingress"]
        if "hostname" not in route or route["hostname"] in active
    ]
    desired["records"] = [
        entry for entry in desired["records"] if entry["record"]["name"] in active
    ]
    tunnel = Cloudflare(CONFIG / "credentials/edge-tunnel-token")
    dns = Cloudflare(CONFIG / "credentials/edge-dns-token")
    publish(desired, tunnel, dns, preserve_routes=preview is not None)


def activated_socket():
    if (os.environ.get("LISTEN_FDS"), os.environ.get("LISTEN_PID")) != (
        "1",
        str(os.getpid()),
    ):
        raise ValueError("Start the controller through its systemd socket")
    listener = socket.socket(fileno=3)
    if listener.family != socket.AF_UNIX or listener.getsockname() != str(SOCKET):
        listener.close()
        raise ValueError("Unexpected controller socket")
    return listener


@contextlib.contextmanager
def regular_input(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Bootstrap inputs must be regular files")
        yield stream


def bootstrap_archive(sites, args):
    import pwd

    from .host import CONTROLLER

    root_required()
    if not (STATE / "controller").is_dir():
        raise ValueError("Install the Web runtime before importing an archive")
    site = sites.get(args.project)
    if not site:
        raise ValueError("Unknown site registration")
    account = pwd.getpwnam(CONTROLLER)
    if account.pw_uid == 0:
        raise ValueError("The release controller requires an unprivileged user")
    with (
        regular_input(args.manifest) as metadata,
        regular_input(args.archive) as release,
    ):
        content = metadata.read(8193)
        if len(content) > 8192:
            raise ValueError("Release manifest is too large")
        # The operator opens trusted inputs. The release controller only receives these two streams.
        os.setgroups([])
        os.setgid(account.pw_gid)
        os.setuid(account.pw_uid)
        os.umask(0o077)
        operation = Controller(sites, STATE, None).bootstrap(
            site,
            args.environment,
            release,
            json.loads(content),
            args.digest,
        )
    print(json.dumps({"deployment": operation}, indent=2))
    return 0 if operation["status"] == "ready" else 2


def doctor(sites):
    from .observation import service_metrics

    versions = {}
    for tool, command in (
        ("python", ("/usr/bin/python3", "--version")),
        ("caddy", ("/usr/bin/caddy", "version")),
        ("cloudflared", ("/usr/bin/cloudflared", "--version")),
        ("node", ("/usr/bin/node", "--version")),
        ("nftables", ("/usr/sbin/nft", "--version")),
        ("systemd", ("/usr/bin/systemctl", "--version")),
    ):
        try:
            outcome = subprocess.run(command, capture_output=True, text=True, timeout=3, check=True)
            versions[tool] = (outcome.stdout or outcome.stderr).splitlines()[0][:200]
        except (OSError, IndexError, subprocess.SubprocessError):
            versions[tool] = None
    projects = []
    ports = {ORIGIN_PORT}
    ports.update(
        target.port for site in sites.values() for target in site.targets.values() if target.port
    )
    try:
        result = subprocess.run(
            ["/usr/bin/ss", "-H", "-ltn"],
            capture_output=True,
            text=True,
            timeout=3,
            check=True,
        )
        addresses = [
            line.split()[3] for line in result.stdout.splitlines() if len(line.split()) >= 5
        ]
        listeners = [
            address
            for address in addresses
            if address.rsplit(":", 1)[-1] in {str(port) for port in ports}
        ]
    except (OSError, subprocess.SubprocessError):
        listeners = None
    for site in sites.values():
        for environment, target in site.targets.items():
            try:
                http_status = status_code(target.hostname, ORIGIN_PORT, site.health_path, tls=True)
            except (OSError, http.client.HTTPException):
                http_status = None
            projects.append(
                {
                    "project": site.id,
                    "environment": environment,
                    "hostname": target.hostname,
                    "origin": {
                        "address": "127.0.0.1",
                        "port": ORIGIN_PORT,
                        "httpStatus": http_status,
                    },
                    "runtimePort": target.port,
                    "activeDeploymentId": active_id(site.directory(environment)),
                    "service": service_metrics(site.slot(environment))
                    if target.port is not None
                    else None,
                }
            )
    print(
        json.dumps(
            {
                "originOnly": ORIGIN_ONLY.is_file(),
                "dependencies": versions,
                "projects": projects,
                "controllerSocket": SOCKET.is_socket(),
                "listeners": listeners,
            },
            indent=2,
        )
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=CONFIG / "sites.json")
    commands = parser.add_subparsers(dest="command", required=True)
    bundle = commands.add_parser("bundle", help="Build the standalone server runtime")
    bundle.add_argument("output", type=Path)
    commands.add_parser("validate")
    commands.add_parser("caddy")
    edge = commands.add_parser("edge-plan")
    edge.add_argument("--edge-config", type=Path, default=CONFIG / "edge.json")
    edge.add_argument(
        "--preview", metavar="PROJECT", help="Plan only this project's preview hostname"
    )
    for action in ("security-plan", "sync-security"):
        security = commands.add_parser(action)
        security.add_argument("--edge-config", type=Path, default=CONFIG / "edge.json")
        security.add_argument("--rate-limit", choices=("off", "path", "host-post"), default="off")
    installer = commands.add_parser("install")
    installer.add_argument("--origin-only", action="store_true")
    commands.add_parser("apply-firewall")
    daemon = commands.add_parser("serve")
    daemon.add_argument("--origin-only", action="store_true")
    edge_sync = commands.add_parser("sync-edge")
    edge_sync.add_argument(
        "--preview",
        metavar="PROJECT",
        help="Publish only this project's preview hostname",
    )
    diagnosis = commands.add_parser("doctor")
    diagnosis.add_argument(
        "--json", action="store_true", help="Print structured diagnostics (the default)"
    )
    bootstrap = commands.add_parser("bootstrap-archive")
    bootstrap.add_argument("project")
    bootstrap.add_argument("environment", choices=("production", "preview"))
    bootstrap.add_argument("--archive", type=Path, required=True)
    bootstrap.add_argument("--manifest", type=Path, required=True)
    bootstrap.add_argument("--digest", required=True)
    deploy = commands.add_parser("deploy")
    deploy.add_argument("project")
    deploy.add_argument("environment", choices=("production", "preview"))
    deploy.add_argument("run_id", type=int)
    deploy.add_argument("commit")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        if args.command == "bundle":
            archive = runtime_archive()
            with args.output.open("xb") as stream:
                stream.write(archive)
            args.output.chmod(0o755)
            return 0
        if args.command == "deploy":
            submit(args)
            return 0
        if args.command == "apply-firewall":
            from .host import apply_firewall

            root_required()
            apply_firewall((CONFIG / "origin.nft").read_text(encoding="utf-8"))
            return 0
        sites = load_registry(args.registry)
        if args.command == "validate":
            print(f"Validated {len(sites)} sites")
        elif args.command == "caddy":
            print(caddyfile(sites), end="")
        elif args.command == "doctor":
            doctor(sites)
        elif args.command == "edge-plan":
            print(json.dumps(plan(sites, args.edge_config, preview=args.preview), indent=2))
        elif args.command in ("security-plan", "sync-security"):
            desired = policy(sites, plan(sites, args.edge_config), args.rate_limit)
            if args.command == "security-plan":
                print(json.dumps(desired, indent=2))
            else:
                root_required()
                if (
                    args.registry != CONFIG / "sites.json"
                    or args.edge_config != CONFIG / "edge.json"
                ):
                    raise ValueError("Sync using the root-owned Web and Cloudflare registries")
                if ORIGIN_ONLY.exists():
                    raise ValueError("Local-origin mode cannot publish Cloudflare security rules")
                sync(Cloudflare(CONFIG / "credentials/edge-security-token"), desired)
        elif args.command == "install":
            from .host import install

            root_required()
            if args.registry != CONFIG / "sites.json":
                raise ValueError("Install using the root-owned host registry path")
            install(sites, origin_only=args.origin_only)
        elif args.command == "bootstrap-archive":
            if args.registry != CONFIG / "sites.json":
                raise ValueError("Bootstrap using the root-owned host registry path")
            return bootstrap_archive(sites, args)
        elif args.command == "serve":
            if os.geteuid() == 0 or args.registry != CONFIG / "sites.json":
                raise ValueError(
                    "The release controller requires its unprivileged service identity"
                )
            if args.origin_only != ORIGIN_ONLY.is_file():
                raise ValueError("Controller unit and installed origin mode disagree")
            github = None
            credentials = os.environ.get("CREDENTIALS_DIRECTORY")
            if credentials and not args.origin_only:
                token_file = Path(credentials) / "github-token"
                if token_file.is_file():
                    github = GitHub(token_file.read_text(encoding="utf-8").strip())
            serve(Controller(sites, STATE, github), activated_socket())
        elif args.command == "sync-edge":
            if args.registry != CONFIG / "sites.json":
                raise ValueError("Publish using the root-owned host registry path")
            configure_edge(sites, preview=args.preview)
    except (
        OSError,
        ValueError,
        http.client.HTTPException,
        subprocess.SubprocessError,
    ) as error:
        print(str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
