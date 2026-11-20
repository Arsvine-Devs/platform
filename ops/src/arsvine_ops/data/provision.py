"""Provision website-owned databases and a single loopback Valkey instance."""

import argparse
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import tempfile
from collections.abc import Iterable, Mapping, Set
from pathlib import Path
from typing import IO, TypedDict
from urllib.parse import quote

from arsvine_ops.web.registry import load_registry

CONFIG = Path("/etc/arsvine-web")
ENVIRONMENTS = ("production", "preview")
DATABASE_VARIABLES = {
    "auth": "AUTH_DATABASE_URL",
    "api": "CORE_DATABASE_URL",
    "realm": "DATABASE_URL",
}
VALKEY_UNIT = Path("/etc/systemd/system/arsvine-web-valkey.service")
type DataSlot = tuple[str, str]


class DataCredentials(TypedDict):
    postgres: dict[str, str]
    valkey: dict[str, str]


def role(site: str, environment: str) -> str:
    return f"ars_web_{environment}_{site.replace('-', '_')}"


def run(
    *args: str | Path,
    capture_output: bool = False,
    input: str | None = None,
    env: Mapping[str, str] | None = None,
    stdin: IO[bytes] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=True,
        text=True,
        capture_output=capture_output,
        input=input,
        env=env,
        stdin=stdin,
    )


def atomic_write(path: Path, text: str, mode: int = 0o600, *, replace: bool = True) -> None:
    path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    stream = tempfile.NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf-8", delete=False)
    temporary = Path(stream.name)
    try:
        with stream:
            os.chmod(temporary, mode)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def registered_slots(path: Path) -> tuple[dict[DataSlot, str], set[DataSlot]]:
    databases: dict[DataSlot, str] = {}
    caches: set[DataSlot] = set()
    for site in load_registry(path).values():
        if site.runtime != "node":
            continue
        for environment in site.targets:
            if "postgres" in site.local_services:
                databases[site.id, environment] = DATABASE_VARIABLES.get(site.id, "DATABASE_URL")
            if "valkey" in site.local_services:
                caches.add((site.id, environment))
    return databases, caches


def get_credentials(databases: Iterable[DataSlot], caches: Iterable[DataSlot]) -> DataCredentials:
    path = CONFIG / "data-credentials.json"
    result: DataCredentials = {"postgres": {}, "valkey": {}}
    if path.exists():
        stored = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(stored, dict):
            raise ValueError("Invalid stored data credentials")
        for engine in ("postgres", "valkey"):
            values = stored.get(engine)
            if not isinstance(values, dict) or not all(
                isinstance(key, str) and isinstance(value, str) and value
                for key, value in values.items()
            ):
                raise ValueError("Invalid stored data credentials")
            result[engine].update(values)
    changed = False
    for engine, slots in (("postgres", databases), ("valkey", caches)):
        for site, environment in slots:
            identifier = role(site, environment)
            if identifier not in result[engine]:
                result[engine][identifier] = secrets.token_urlsafe(36)
                changed = True
    if changed:
        atomic_write(path, json.dumps(result))
    return result


def psql(
    *args: str,
    capture_output: bool = False,
    input: str | None = None,
    env: Mapping[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return run(
        "runuser",
        "-u",
        "postgres",
        "--",
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        *args,
        capture_output=capture_output,
        input=input,
        env=env,
    )


def postgres_setup(identifier: str, password: str) -> None:
    env = {**os.environ, "ARS_WEB_DATABASE_PASSWORD": password}
    commands = rf"""\getenv password ARS_WEB_DATABASE_PASSWORD
SELECT 'CREATE ROLE {identifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{identifier}')\gexec
ALTER ROLE {identifier} PASSWORD :'password';
SELECT 'CREATE DATABASE {identifier} OWNER {identifier}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '{identifier}')\gexec
REVOKE CONNECT, TEMPORARY ON DATABASE {identifier} FROM PUBLIC;
GRANT CONNECT ON DATABASE {identifier} TO {identifier};
"""
    psql("-q", "-d", "postgres", input=commands, env=env)


def valkey_configuration(credentials: Mapping[str, str], caches: Set[DataSlot]) -> str:
    lines = [
        "bind 127.0.0.1",
        "protected-mode yes",
        "port 6379",
        'save ""',
        "appendonly no",
        "maxmemory 64mb",
        "maxmemory-policy noeviction",
        "user default off",
    ]
    permissions = "+ping +info +select +client|setinfo +get +set +del +eval +incr +pttl +pexpire"
    for site, environment in sorted(caches):
        identifier = role(site, environment)
        digest = hashlib.sha256(credentials[identifier].encode()).hexdigest()
        lines.append(f"user {identifier} on #{digest} ~{site}:{environment}:* {permissions}")
    return "\n".join(lines) + "\n"


def update_environment(path: Path, changes: Mapping[str, str]) -> None:
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    retained = [line for line in existing if line.partition("=")[0].strip() not in changes]
    generated = [f"{key}={value}" for key, value in changes.items()]
    atomic_write(path, "\n".join([*retained, *generated]) + "\n")


def check_restore_files(directory: Path, selected: Iterable[str]) -> None:
    for site in selected:
        dump = directory / f"{site}.dump"
        if not dump.is_file() or dump.is_symlink():
            raise ValueError(f"Missing PostgreSQL dump for {site}")


def restore(directory: Path, selected: tuple[str, ...]) -> None:
    check_restore_files(directory, selected)
    for site in selected:
        database = role(site, "production")
        probe = psql(
            "-At",
            "-d",
            database,
            "-c",
            "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')",
            capture_output=True,
        )
        if probe.stdout.strip() != "0":
            raise ValueError(f"{site} database already contains tables")
    for site in selected:
        database = role(site, "production")
        with (directory / f"{site}.dump").open("rb") as dump:
            run(
                "runuser",
                "-u",
                "postgres",
                "--",
                "pg_restore",
                "--single-transaction",
                "--exit-on-error",
                "--no-owner",
                "--no-privileges",
                f"--role={database}",
                "-d",
                database,
                stdin=dump,
            )


def provision(registry: Path) -> None:
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise ValueError("Provisioning requires the VPS administrator")
    databases, caches = registered_slots(registry)
    valkey = shutil.which("valkey-server") if caches else None
    if caches and not valkey:
        raise ValueError("Install valkey-server before provisioning")
    if databases:
        addresses = psql(
            "-At", "-d", "postgres", "-c", "SHOW listen_addresses", capture_output=True
        )
        if {item.strip() for item in addresses.stdout.strip().split(",")} - {
            "127.0.0.1",
            "::1",
            "localhost",
        }:
            raise ValueError("PostgreSQL must listen on local addresses")
    credentials = get_credentials(databases, caches)
    changes: dict[DataSlot, dict[str, str]] = {slot: {} for slot in databases.keys() | caches}
    for (site, environment), key in databases.items():
        identifier = role(site, environment)
        password = credentials["postgres"][identifier]
        postgres_setup(identifier, password)
        changes[site, environment][key] = (
            f"postgresql://{identifier}:{quote(password)}@127.0.0.1:5432/{identifier}"
        )
    for site, environment in caches:
        identifier = role(site, environment)
        password = credentials["valkey"][identifier]
        changes[site, environment]["REDIS_URL"] = (
            f"redis://{identifier}:{quote(password)}@127.0.0.1:6379"
        )
        changes[site, environment]["REDIS_KEY_PREFIX"] = f"{site}:{environment}:"
    if valkey:
        apply_valkey(valkey, valkey_configuration(credentials["valkey"], caches))
    for (site, environment), values in changes.items():
        update_environment(CONFIG / "env" / f"{site}-{environment}.env", values)


def apply_valkey(valkey: str, configuration: str) -> None:
    config_path = CONFIG / "valkey.conf"
    applied = CONFIG / "valkey.applied"
    if not config_path.exists() or config_path.read_text(encoding="utf-8") != configuration:
        atomic_write(config_path, configuration)
    unit = f"""[Unit]
Description=Arsvine Web sessions and rate limits

[Service]
DynamicUser=yes
Slice=arsvine-web.slice
LoadCredential=config:{config_path}
ExecStart={valkey} %d/config
ProtectSystem=strict
ProtectHome=yes
NoNewPrivileges=yes
PrivateTmp=yes
MemoryMax=128M
Restart=on-failure

[Install]
WantedBy=multi-user.target
"""
    digest = hashlib.sha256((configuration + "\0" + unit).encode()).hexdigest() + "\n"
    atomic_write(VALKEY_UNIT, unit, mode=0o644)
    run("systemctl", "daemon-reload")
    run("systemctl", "enable", VALKEY_UNIT.name)
    if not applied.is_file() or applied.read_text(encoding="utf-8") != digest:
        run("systemctl", "restart", VALKEY_UNIT.name)
        atomic_write(applied, digest)
    else:
        run("systemctl", "start", VALKEY_UNIT.name)


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--sites", type=Path, default=CONFIG / "sites.json")
    parser.add_argument(
        "--restore",
        type=Path,
        help="Restore auth.dump, api.dump, and realm.dump into empty production databases",
    )
    parser.add_argument("--restore-site", choices=DATABASE_VARIABLES, action="append")


def command(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    if args.restore_site and not args.restore:
        parser.error("--restore-site requires --restore")
    if args.restore and not args.apply:
        parser.error("--restore requires --apply")
    if not args.apply:
        try:
            databases, caches = registered_slots(args.sites)
        except (ValueError, KeyError, OSError) as error:
            parser.exit(1, f"Read site registrations: {error}\n")
        print(
            json.dumps(
                {
                    "postgres": [role(*slot) for slot in sorted(databases)],
                    "valkey": [role(*slot) for slot in sorted(caches)],
                },
                indent=2,
            )
        )
        return
    try:
        selected = tuple(args.restore_site or DATABASE_VARIABLES)
        if args.restore:
            check_restore_files(args.restore, selected)
        provision(args.sites)
        if args.restore:
            restore(args.restore, selected)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Web data setup failed: {error}\n")
