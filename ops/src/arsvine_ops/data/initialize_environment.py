"""Initialize empty application state and credentials for a Web environment."""

from __future__ import annotations

import argparse
import datetime
import json
import os
import secrets
from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING

from arsvine_ops.data.provision import CONFIG, ENVIRONMENTS, atomic_write, update_environment
from arsvine_ops.web.registry import Site, load_registry

if TYPE_CHECKING:
    from pwd import struct_passwd


STATE = Path("/var/lib/arsvine-web")


def seed_files(
    root: Path, contents: Mapping[str, object], uid: int, gid: int, *, public: bool = False
) -> None:
    if root.is_symlink():
        raise ValueError("Seed root may not be a symbolic link")
    owns_files = hasattr(os, "geteuid") and os.geteuid() == 0
    for key, value in contents.items():
        relative = Path(key)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Invalid seed file path")
        file = root / relative
        folders = [
            parent for parent in file.parents if parent != root and parent.is_relative_to(root)
        ]
        for parent in reversed(folders):
            if parent.is_symlink():
                raise ValueError("Seed directory may not be a symbolic link")
            parent.mkdir(mode=0o2750 if public else 0o750, exist_ok=True)
            if owns_files:
                os.chown(parent, uid, gid, follow_symlinks=False)
        if file.is_symlink():
            raise ValueError("Seed file may not be a symbolic link")
        if file.is_file():
            continue
        atomic_write(file, json.dumps(value, ensure_ascii=False) + "\n", mode=0o640, replace=False)
        if owns_files:
            os.chown(file, uid, gid, follow_symlinks=False)


def seed_content_as_owner(
    root: Path, contents: Mapping[str, object], account: struct_passwd
) -> None:
    child = os.fork()
    if child == 0:
        try:
            os.setgroups([])
            os.setgid(account.pw_gid)
            os.setuid(account.pw_uid)
            seed_files(root, contents, account.pw_uid, account.pw_gid)
        except BaseException:
            os._exit(1)
        os._exit(0)
    if os.waitstatus_to_exitcode(os.waitpid(child, 0)[1]) != 0:
        raise ValueError("Unable to initialize Content as its service account")


def lookup_password_file(slot: str) -> dict[str, str]:
    file = CONFIG / "environment-credentials" / f"{slot}.json"
    keys = ("auth", "console", "publisher", "refresh", "visitor", "protected")
    if file.exists():
        stored = json.loads(file.read_text(encoding="utf-8"))
        if not isinstance(stored, dict) or not all(
            isinstance(stored.get(k), str) and stored[k] for k in keys
        ):
            raise ValueError("Invalid stored environment credentials")
        return {name: stored[name] for name in keys}
    values = {name: secrets.token_urlsafe(36) for name in keys}
    try:
        atomic_write(file, json.dumps(values, indent=2) + "\n", replace=False)
    except FileExistsError:
        return lookup_password_file(slot)
    return values


def environment_values(
    registrations: Mapping[str, Site], environment: str, auth_state: Path | None
) -> None:
    by_name = {
        name: entry.targets[environment].hostname
        for name, entry in registrations.items()
        if environment in entry.targets
    }
    if not by_name.keys() >= {"auth", "api", "console", "content", "realm"}:
        raise ValueError(
            "Register Auth, API, Console, Content, and Realm for this environment first"
        )
    values = lookup_password_file(environment)
    bindings = {
        "auth": {
            "BETTER_AUTH_SECRET": values["auth"],
            "AUTH_TRUSTED_ORIGINS": ",".join(
                f"https://{by_name[name]}" for name in ("auth", "console")
            ),
        },
        "console": {"SESSION_SECRET": values["console"], "TRUST_PROXY": "1"},
        "api": {
            "CONTENT_PUBLISH_TOKEN": values["publisher"],
            "REVALIDATE_WEBHOOK_SECRET": values["refresh"],
        },
        "content": {"CONTENT_PUBLISH_TOKEN": values["publisher"]},
        "realm": {
            "ACCESS_GRANT_SECRET": values["protected"],
            "VISITOR_STATS_SECRET": values["visitor"],
            "REVALIDATE_WEBHOOK_SECRET": values["refresh"],
            "TRUST_PROXY": "1",
        },
    }
    if auth_state:
        state = json.loads(auth_state.read_text(encoding="utf-8"))
        if state["issuer"] != f"https://{by_name['auth']}":
            raise ValueError("Auth bootstrap file belongs to another environment")
        for name, prefix in (("console", "AUTH_OIDC_CLIENT"), ("realm", "CONTENT_SERVICE_CLIENT")):
            client = state["clients"][name]
            for field in ("id", "secret"):
                value = client[field]
                if not isinstance(value, str) or not value or any(ch.isspace() for ch in value):
                    raise ValueError("Invalid Auth client credential")
                bindings[name][f"{prefix}_{field.upper()}"] = value
    for name, entries in bindings.items():
        update_environment(CONFIG / "env" / f"{name}-{environment}.env", entries)


def seed_empty(environment: str) -> None:
    import grp
    import pwd

    timestamp = datetime.datetime.now(datetime.UTC)
    version = timestamp.strftime("%Y%m%dT%H%M%SZ")
    suffix = "live" if environment == "production" else "pr"
    content = STATE / "content" / environment
    pointer = content / "realm-content/current.json"
    if not pointer.exists():
        account = pwd.getpwnam(f"aw-content-{suffix}")
        release_id = "initial"
        key = f"realm-content/releases/{release_id}/manifest.json"
        seed_content_as_owner(
            content,
            {
                key: {"schemaVersion": 1, "releaseId": release_id},
                "realm-content/current.json": {
                    "schemaVersion": 1,
                    "releaseId": release_id,
                    "publishedAt": timestamp.isoformat(),
                    "manifest": key,
                },
            },
            account,
        )
    media = STATE / "media" / environment
    public = "realm/site-catalog/current.json"
    if not (media / "public" / public).exists():
        account = pwd.getpwnam(f"aw-realm-{suffix}")
        directory = f"realm/catalog/versions/{version}"
        seed_files(
            media / "private",
            {
                f"{directory}/audio.json": [],
                f"{directory}/home.json": [],
                f"{directory}/works.json": [],
                f"{directory}/links.json": [],
                f"{directory}/collections.json": {"collections": []},
                f"{directory}/static-assets.json": {"assets": {}},
            },
            0,
            account.pw_gid,
        )
        group = grp.getgrnam(f"ars-web-media-{suffix}")
        manifest = f"realm/site-catalog/versions/{version}/assets.json"
        seed_files(
            media / "public",
            {
                manifest: {"version": version, "assets": {}},
                public: {"version": version},
            },
            0,
            group.gr_gid,
            public=True,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=ENVIRONMENTS)
    parser.add_argument("--auth-state", type=Path)
    args = parser.parse_args()
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        parser.error("Run as the Web host administrator")
    try:
        registrations = load_registry(CONFIG / "sites.json")
        environment_values(registrations, args.environment, args.auth_state)
        seed_empty(args.environment)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Web environment setup failed: {error}\n")
    print(f"Initialized Web environment: {args.environment}")
