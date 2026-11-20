"""Prepare site releases and bundle the server-side runtime."""

import hashlib
import http.client
import io
import json
import shutil
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipapp
import zipfile
from importlib.resources import files
from pathlib import Path, PurePosixPath

from .registry import capabilities, fields, match

ARCHIVE_LIMIT = 768 * 1024 * 1024
TREE_LIMIT = 1024 * 1024 * 1024
MAX_ENTRIES = 75_000
COMMIT = r"[a-f0-9]{40}"
DIGEST = r"sha256:[a-f0-9]{64}"


def runtime_archive() -> bytes:
    archive = io.BytesIO()
    with tempfile.TemporaryDirectory(prefix="arsvine-web-runtime-") as staging:
        package = Path(staging) / "arsvine_ops"
        web = package / "web"
        web.mkdir(parents=True)
        (package / "__init__.py").touch()
        for resource in files("arsvine_ops.web").iterdir():
            if resource.name.endswith(".py") and resource.is_file():
                (web / resource.name).write_bytes(resource.read_bytes())
        zipapp.create_archive(
            staging,
            archive,
            interpreter="/usr/bin/python3",
            main="arsvine_ops.web.webctl:main",
            compressed=True,
        )
    return archive.getvalue()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def digest_file(path):
    with path.open("rb") as stream:
        return "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()


def limited_copy(source, destination, limit):
    total = 0
    while block := source.read(1024 * 1024):
        total += len(block)
        if total > limit:
            raise ValueError("Build artifact exceeds the size limit")
        destination.write(block)


def validate_manifest(manifest, expected, site):
    fields(
        manifest,
        ("version", "project", "environment", "commit", "runtime", "digest", "site"),
    )
    if type(manifest["version"]) is not int or manifest["version"] != 1:
        raise ValueError("Unsupported release manifest")
    if any(manifest[key] != value for key, value in expected.items()):
        raise ValueError("Release manifest does not match the approved build")
    declaration = manifest["site"]
    fields(declaration, ("productionRef", "hostname", "healthPath", "capabilities"))
    if (
        declaration["productionRef"] != site.production_ref
        or declaration["hostname"] != site.targets["production"].hostname
        or declaration["healthPath"] != site.health_path
        or not set(capabilities(declaration["capabilities"])) <= set(site.capabilities)
    ):
        raise ValueError("Release requests an unapproved site declaration or capability")
    return match(manifest["digest"], DIGEST, "release digest")


def prepare_tree(tar_path, destination, digest, runtime):
    if digest_file(tar_path) != digest:
        raise ValueError("Release tar digest mismatch")
    destination.mkdir()
    destination.chmod(0o755)
    extract_tree(tar_path, destination)
    if runtime == "node" and not (destination / "entry.mjs").is_file():
        raise ValueError("Node release is missing entry.mjs")
    return digest


def unpack(archive, destination, expected, site):
    """Check the manifest and write an archive into a fresh isolated directory."""
    tar_path = None
    try:
        with zipfile.ZipFile(archive) as bundle:
            entries = bundle.infolist()
            if sorted(entry.filename for entry in entries) != [
                "manifest.json",
                "release.tar",
            ]:
                raise ValueError("Artifact must contain one manifest and one release archive")
            if bundle.getinfo("manifest.json").file_size > 8192:
                raise ValueError("Release manifest is too large")
            manifest = json.loads(bundle.read("manifest.json"))
            digest = validate_manifest(manifest, expected, site)
            with (
                bundle.open("release.tar") as content,
                tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as output,
            ):
                tar_path = Path(output.name)
                limited_copy(content, output, TREE_LIMIT)
        return prepare_tree(tar_path, destination, digest, expected["runtime"])
    finally:
        if tar_path is not None:
            tar_path.unlink(missing_ok=True)


def relative_path(name):
    if (
        not name
        or name.startswith("/")
        or "\\" in name
        or ":" in name
        or any(ord(character) < 32 for character in name)
    ):
        raise ValueError("Release archive contains an unsafe path")
    return PurePosixPath(name)


def archive_entries(tree):
    root = PurePosixPath(".")
    entries = {}
    directories = {root}
    total = 0
    for index, member in enumerate(tree):
        if index >= MAX_ENTRIES or member.size < 0:
            raise ValueError("Invalid release archive size")
        if member.sparse or member.type not in (
            tarfile.REGTYPE,
            tarfile.AREGTYPE,
            tarfile.DIRTYPE,
            tarfile.SYMTYPE,
        ):
            raise ValueError(
                "Release entries must be files, directories or internal symbolic links"
            )
        path = relative_path(member.name)
        if ".." in path.parts:
            raise ValueError("Release archive contains an unsafe path")
        if path == root and member.isdir():
            continue
        if path == root or path in entries:
            raise ValueError("Release archive contains a duplicate or empty path")
        entries[path] = member
        directories.update(path.parents)
        if member.isdir():
            directories.add(path)
        total += member.size
        if total > TREE_LIMIT:
            raise ValueError("Release tree exceeds the size limit")
    if any(path in entries and not entries[path].isdir() for path in directories):
        raise ValueError("Release archive contains a file or link as an entry parent")
    return entries, directories


def resolve_links(entries, directories):
    resolved = {}
    links = {
        path: relative_path(entry.linkname) for path, entry in entries.items() if entry.issym()
    }

    def resolve(path, seen):
        if path in seen or len(seen) >= 40:
            raise ValueError("Release archive contains a symbolic link cycle or excessive chain")
        start = path.parent
        for part in links[path].parts:
            if start not in directories:
                raise ValueError("Release link crosses a non-directory entry")
            if part == "..":
                if not start.parts:
                    raise ValueError("Release link escapes the artifact")
                start = start.parent
                continue
            start /= part
            if start in links:
                start = resolve(start, seen | {path})
            elif start not in entries and start not in directories:
                raise ValueError("Release link target is absent")
        if start in path.parents:
            raise ValueError("Release link points to an ancestor directory")
        resolved[path] = start
        return start

    for path in links:
        resolve(path, set())
    return resolved


def extract_tree(tar_path, destination):
    with tarfile.open(tar_path, mode="r:") as tree:
        entries, directories = archive_entries(tree)
        links = resolve_links(entries, directories)
        for member in entries.values():
            tarfile.data_filter(member, str(destination))
        for path in sorted(directories, key=lambda item: len(item.parts)):
            target = destination.joinpath(*path.parts)
            target.mkdir(exist_ok=True)
            target.chmod(0o755)
        for path, member in entries.items():
            if not member.isfile():
                continue
            target = destination.joinpath(*path.parts)
            stream = tree.extractfile(member)
            if stream is None:
                raise ValueError("Release archive is missing file content")
            with stream, target.open("xb") as output:
                shutil.copyfileobj(stream, output)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)
        for path, actual in links.items():
            destination.joinpath(*path.parts).symlink_to(
                entries[path].linkname,
                target_is_directory=actual in directories,
            )


def approved_run(run, site, environment):
    if (
        run.get("status") != "completed"
        or run.get("conclusion") != "success"
        or run.get("path") != f".github/workflows/{site.workflow}"
        or (run.get("repository") or {}).get("full_name", "").lower() != site.repository.lower()
        or (run.get("head_repository") or {}).get("full_name", "").lower()
        != site.repository.lower()
        or type(run.get("id")) is not int
        or run["id"] < 1
    ):
        return False
    try:
        match(run.get("head_sha"), COMMIT, "commit")
        branch = match(run.get("head_branch"), r"[A-Za-z0-9][A-Za-z0-9/_.-]{0,199}", "branch")
    except ValueError:
        return False
    if environment == "production":
        return branch == site.production_ref and run.get("event") in {
            "push",
            "workflow_dispatch",
        }
    return run.get("event") == "workflow_dispatch"


class GitHub:
    def __init__(self, token):
        if not token or any(character.isspace() for character in token):
            raise ValueError("GitHub artifact credential is unavailable")
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "arsvine-web",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        self.client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, path):
        return urllib.request.Request("https://api.github.com" + path, headers=self.headers)

    def json(self, path):
        try:
            with self.client.open(self.request(path), timeout=15) as response:
                payload = response.read(2 * 1024 * 1024 + 1)
                if len(payload) > 2 * 1024 * 1024:
                    raise ValueError("GitHub response is too large")
                return json.loads(payload)
        except (OSError, http.client.HTTPException):
            raise ValueError("GitHub Actions request failed") from None

    def artifact(self, site, environment, run_id):
        payload = self.json(
            f"/repos/{site.repository}/actions/runs/{run_id}/artifacts?per_page=100"
        )
        if payload.get("total_count", 0) > 100:
            raise ValueError("Workflow run has too many artifacts")
        name = site.artifact(environment)
        artifacts = [item for item in payload.get("artifacts", []) if item.get("name") == name]
        if len(artifacts) != 1 or artifacts[0].get("expired"):
            return None
        artifact = artifacts[0]
        if (
            type(artifact.get("id")) is not int
            or artifact["id"] < 1
            or type(artifact.get("size_in_bytes")) is not int
            or not 0 < artifact["size_in_bytes"] <= ARCHIVE_LIMIT
        ):
            return None
        if artifact.get("digest"):
            match(artifact["digest"], DIGEST, "artifact digest")
        return artifact

    def builds(self, site, environment):
        site.slot(environment)
        workflow = urllib.parse.quote(site.workflow, safe="")
        query = {"per_page": "15", "status": "success"}
        if environment == "production":
            query["branch"] = site.production_ref
        runs = self.json(
            f"/repos/{site.repository}/actions/workflows/{workflow}/runs?{urllib.parse.urlencode(query)}"
        )
        builds = []
        for run in runs.get("workflow_runs", [])[:15]:
            if not approved_run(run, site, environment):
                continue
            artifact = self.artifact(site, environment, run["id"])
            if artifact:
                builds.append(
                    {
                        "runId": run["id"],
                        "commit": run["head_sha"],
                        "branch": run["head_branch"],
                        "createdAt": run["created_at"],
                        "artifact": artifact["name"],
                        "url": f"https://github.com/{site.repository}/actions/runs/{run['id']}",
                    }
                )
        return builds

    def download(self, site, environment, run_id, commit, destination):
        run = self.json(f"/repos/{site.repository}/actions/runs/{run_id}")
        if (
            not approved_run(run, site, environment)
            or run["id"] != run_id
            or run["head_sha"] != commit
        ):
            raise ValueError(
                "Workflow run does not match the approved project, environment or commit"
            )
        artifact = self.artifact(site, environment, run_id)
        if not artifact:
            raise ValueError("Required build artifact is unavailable")
        path = f"/repos/{site.repository}/actions/artifacts/{artifact['id']}/zip"
        try:
            try:
                response = self.client.open(self.request(path), timeout=30)
            except urllib.error.HTTPError as error:
                if error.code != 302:
                    raise
                url = error.headers.get("Location", "")
                error.close()
                parsed = urllib.parse.urlsplit(url)
                if (
                    not parsed.hostname
                    or parsed.scheme != "https"
                    or parsed.username
                    or parsed.password
                ):
                    raise ValueError("GitHub returned an invalid artifact download URL")
                # GitHub's short-lived artifact URL never receives the API credential.
                response = self.client.open(url, timeout=60)
            with response as source, destination.open("xb") as stream:
                limited_copy(source, stream, ARCHIVE_LIMIT)
        except (OSError, http.client.HTTPException):
            raise ValueError("GitHub artifact download failed") from None
        if artifact.get("digest") and digest_file(destination) != artifact["digest"]:
            raise ValueError("GitHub artifact digest mismatch")
