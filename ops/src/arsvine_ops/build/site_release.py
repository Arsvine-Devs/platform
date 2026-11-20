"""Validate site declarations and assemble deployable artifacts."""

import argparse
import hashlib
import io
import json
import os
import posixpath
import re
import tarfile
from collections.abc import Sequence, Set
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from typing import NotRequired, TypedDict, cast

import yaml

IDENTIFIER = re.compile(r"[a-z][a-z0-9-]{0,23}")
HOSTNAME = re.compile(r"(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]+")
BRANCH = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_./-]{0,199}")
HEALTH = re.compile(r"/[a-zA-Z0-9/_-]*")
PACKAGE = re.compile(r"(?:@[a-z0-9-]+/)?[a-z0-9][a-z0-9.-]*")


class Build(TypedDict):
    type: str
    directory: str
    package: NotRequired[str]
    output: NotRequired[str]
    entry: NotRequired[str]


class BuildJob(Build):
    id: str


class Production(TypedDict):
    branch: str
    hostname: str


class Site(TypedDict):
    id: str
    runtime: str
    production: Production
    build: Build
    health: str
    capabilities: NotRequired[list[str]]


class ReleaseSite(TypedDict):
    productionRef: str
    hostname: str
    healthPath: str
    capabilities: list[str]


class ReleaseManifest(TypedDict):
    version: int
    project: str
    environment: str
    commit: str
    runtime: str
    digest: str
    site: ReleaseSite


def require_match(pattern: re.Pattern[str], value: object, label: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError(f"invalid {label}")
    return value


def checked_branch(value: object) -> str:
    branch = require_match(BRANCH, value, "production branch")
    if ".." in branch or "//" in branch or branch.endswith(("/", ".lock")):
        raise ValueError("invalid production branch")
    return branch


def relative_path(value: object, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_./-]+", value):
        raise ValueError(f"{label} must be a relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"{label} must be a relative path within the repository")
    return str(path)


def mapping(value: object, fields: Set[str], label: str) -> dict[str, object]:
    if not isinstance(value, dict) or value.keys() - fields:
        raise ValueError(f"invalid {label} fields")
    return cast(dict[str, object], value)


def read_build(value: object, runtime: str) -> Build:
    raw = mapping(value, {"type", "directory", "package", "output", "entry"}, "build")
    build_type = raw.get("type")
    if not isinstance(build_type, str) or (runtime, build_type) not in {
        ("static", "static"),
        ("node", "next"),
        ("node", "workspace-node"),
    }:
        raise ValueError("runtime and build type do not match")
    build: Build = {
        "type": build_type,
        "directory": relative_path(raw.get("directory", "."), "build directory"),
    }
    if "package" in raw or build_type == "workspace-node":
        build["package"] = require_match(PACKAGE, raw.get("package"), "build package")
    if build_type == "static":
        build["output"] = relative_path(raw.get("output", "dist"), "build output")
        if build["output"] == ".":
            raise ValueError("static build output must be a dedicated directory")
    if build_type == "workspace-node":
        build["entry"] = relative_path(raw.get("entry", "dist/index.js"), "entry point")
    return build


def read_site(path: Path) -> list[Site]:
    data = mapping(
        yaml.safe_load(path.read_text(encoding="utf-8")), {"version", "services"}, "site"
    )
    records = data.get("services")
    if data.get("version") != 1 or not isinstance(records, list) or not records:
        raise ValueError("site.yaml requires version 1 and at least one service")
    sites: list[Site] = []
    identifiers: set[str] = set()
    hostnames: set[str] = set()
    for record in records:
        raw = mapping(
            record, {"id", "runtime", "production", "build", "health", "capabilities"}, "service"
        )
        identifier = require_match(IDENTIFIER, raw.get("id"), "service id")
        production = mapping(raw.get("production"), {"hostname", "branch"}, "production")
        hostname = require_match(HOSTNAME, production.get("hostname"), "hostname")
        branch = checked_branch(production.get("branch"))
        if identifier in identifiers or hostname in hostnames:
            raise ValueError("duplicate service id or production hostname")
        identifiers.add(identifier)
        hostnames.add(hostname)
        health = require_match(HEALTH, raw.get("health"), "health path")
        if health.startswith("//"):
            raise ValueError("invalid health path")
        capabilities = raw.get("capabilities", [])
        if not isinstance(capabilities, list):
            raise ValueError("capabilities must be a list")
        runtime = raw.get("runtime")
        if not isinstance(runtime, str):
            raise ValueError("invalid runtime")
        sites.append(
            {
                "id": identifier,
                "runtime": runtime,
                "production": {"branch": branch, "hostname": hostname},
                "health": health,
                "capabilities": [
                    require_match(IDENTIFIER, item, "capability") for item in capabilities
                ],
                "build": read_build(raw.get("build"), runtime),
            }
        )
    return sites


def build_matrix(services: Sequence[Site], environment: str, branch: str) -> list[BuildJob]:
    return [
        {"id": service["id"], **service["build"]}
        for service in services
        if environment == "preview" or service["production"]["branch"] == branch
    ]


def excluded_name(name: str) -> bool:
    return name in {".git", ".npmrc"} or name.startswith(".env")


def add_directory(
    archive: tarfile.TarFile,
    directory: Path,
    destination: str = "",
    *,
    omit: Set[PurePosixPath] = frozenset(),
) -> None:
    directory = directory.resolve(strict=True)
    prefix = PurePosixPath(destination)

    def visit(path: Path, relative: PurePosixPath) -> None:
        if excluded_name(path.name) or relative in omit:
            return
        arcname = prefix / relative
        entry = tarfile.TarInfo(str(arcname))
        if path.is_symlink() or path.is_junction():
            try:
                target = path.resolve(strict=True).relative_to(directory)
            except ValueError as error:
                raise ValueError(f"release link leaves its build directory: {arcname}") from error
            if any(excluded_name(part) for part in target.parts):
                raise ValueError(f"release link targets an excluded object: {arcname}")
            entry.type = tarfile.SYMTYPE
            entry.linkname = posixpath.relpath(
                str(prefix.joinpath(*target.parts)), str(arcname.parent)
            )
            entry.mode = 0o755
            archive.addfile(entry)
        elif path.is_dir():
            entry.type = tarfile.DIRTYPE
            entry.mode = 0o755
            archive.addfile(entry)
            for child in sorted(path.iterdir()):
                visit(child, relative / child.name)
        elif path.is_file():
            attributes = path.stat()
            entry.size = attributes.st_size
            entry.mode = 0o755 if attributes.st_mode & 0o111 else 0o644
            with path.open("rb") as stream:
                archive.addfile(entry, stream)
        else:
            raise ValueError(f"release contains an unsupported file type at {arcname}")

    for child in sorted(directory.iterdir()):
        visit(child, PurePosixPath(child.name))


def add_loader(archive: tarfile.TarFile, entry: str) -> None:
    loader = f"await import({json.dumps('./' + entry)});\n".encode()
    info = tarfile.TarInfo("entry.mjs")
    info.size = len(loader)
    info.mode = 0o644
    archive.addfile(info, io.BytesIO(loader))


def write_release(release: Path, source: Path, build: Build, prepared: Path | None) -> None:
    directory = source / build["directory"]
    with tarfile.open(release, "w") as archive:
        if build["type"] == "static":
            distribution = directory / build.get("output", "dist")
            if not (distribution / "index.html").is_file():
                raise ValueError("static build is missing index.html")
            add_directory(archive, distribution)
        elif build["type"] == "next":
            standalone = directory / ".next/standalone"
            app_path = PurePosixPath(build["directory"])
            entry = app_path / "server.js"
            if not (standalone / entry).is_file():
                raise ValueError("Next build is missing the standalone server")
            static = app_path / ".next/static"
            public = app_path / "public"
            add_directory(archive, standalone, omit={static, public})
            add_directory(archive, directory / ".next/static", str(static))
            if (directory / "public").is_dir():
                add_directory(archive, directory / "public", str(public))
            add_loader(archive, str(entry))
        else:
            entry = build.get("entry", "dist/index.js")
            if prepared is None or not (prepared / entry).is_file():
                raise ValueError("workspace-node build is missing its deployed entry")
            add_directory(archive, prepared)
            add_loader(archive, entry)


def archive_digest(path: Path) -> str:
    with path.open("rb") as stream:
        return "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()


def matching_release(output: Path, manifest: ReleaseManifest) -> bool:
    if output.is_symlink() or output.is_junction():
        return False
    try:
        existing: object = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        return existing == manifest and archive_digest(output / "release.tar") == manifest["digest"]
    except (OSError, ValueError):
        return False


def package(
    source: Path,
    service: Site,
    environment: str,
    commit: str,
    output: Path,
    prepared: Path | None = None,
) -> ReleaseManifest:
    require_match(re.compile(r"[a-f0-9]{40}"), commit, "commit")
    if environment not in {"production", "preview"}:
        raise ValueError("invalid build environment")
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".web-release-", dir=output.parent) as temporary:
        candidate = Path(temporary)
        release = candidate / "release.tar"
        write_release(release, source, service["build"], prepared)
        manifest: ReleaseManifest = {
            "version": 1,
            "project": service["id"],
            "environment": environment,
            "commit": commit,
            "runtime": service["runtime"],
            "digest": archive_digest(release),
            "site": {
                "productionRef": service["production"]["branch"],
                "hostname": service["production"]["hostname"],
                "healthPath": service["health"],
                "capabilities": service.get("capabilities", []),
            },
        }
        (candidate / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        if output.is_symlink() or output.is_junction():
            raise FileExistsError(f"release destination is a link: {output}")
        if output.is_dir() and not any(output.iterdir()):
            output.rmdir()
        if output.exists():
            if not matching_release(output, manifest):
                raise FileExistsError(
                    f"release destination already contains different data: {output}"
                )
            return manifest
        try:
            candidate.rename(output)
        except OSError:
            if not matching_release(output, manifest):
                raise
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    plan = subcommands.add_parser("plan")
    plan.add_argument("--source", type=Path, default=Path.cwd())
    plan.add_argument("--environment", choices=("production", "preview"), required=True)
    plan.add_argument("--branch", required=True)
    archive = subcommands.add_parser("package")
    archive.add_argument("--source", type=Path, default=Path.cwd())
    archive.add_argument("--environment", choices=("production", "preview"), required=True)
    archive.add_argument("--project", required=True)
    archive.add_argument("--commit", required=True)
    archive.add_argument("--output", type=Path, required=True)
    archive.add_argument("--prepared", type=Path)
    args = parser.parse_args()
    try:
        services = read_site(args.source / "site.yaml")
        if args.command == "plan":
            matrix = build_matrix(services, args.environment, args.branch)
            matrix_json = json.dumps({"include": matrix}, separators=(",", ":"))
            if github_output := os.environ.get("GITHUB_OUTPUT"):
                with open(github_output, "a", encoding="utf-8") as stream:
                    stream.write(f"matrix={matrix_json}\npopulated={str(bool(matrix)).lower()}\n")
            else:
                print(matrix_json)
        else:
            service = next((item for item in services if item["id"] == args.project), None)
            if service is None:
                raise ValueError("unknown service id")
            print(
                json.dumps(
                    package(
                        args.source,
                        service,
                        args.environment,
                        args.commit,
                        args.output,
                        args.prepared,
                    )
                )
            )
    except (ValueError, OSError, yaml.YAMLError, tarfile.TarError) as error:
        parser.exit(1, f"{error}\n")
