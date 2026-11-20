"""Deployment state, release activation and the private runtime socket protocol."""

import contextlib
import datetime
import http.client
import json
import logging
import shutil
import socket
import socketserver
import sqlite3
import ssl
import struct
import subprocess
import tarfile
import tempfile
import threading
import time
import uuid
import zipfile
from collections.abc import Callable, Mapping
from functools import partial
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Literal, TypedDict, cast
from urllib.parse import parse_qs, urlsplit

from .artifacts import (
    COMMIT,
    DIGEST,
    TREE_LIMIT,
    limited_copy,
    prepare_tree,
    unpack,
    validate_manifest,
)
from .observation import ingress, service_metrics
from .registry import ORIGIN_CA, ORIGIN_PORT, fields, match

LOG = logging.getLogger(__name__)
COLUMNS = (
    "id, project, environment, runId, commitHash AS 'commit', status, digest, "
    "createdAt, updatedAt, error, actor"
)
PeerScope = Literal["owner", "preview"]


class Deployment(TypedDict):
    id: str
    project: str
    environment: str
    runId: int | None
    commit: str
    status: str
    digest: str | None
    createdAt: str
    updatedAt: str
    error: str | None
    actor: str


def timestamp() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")


def active_id(directory: Path) -> str | None:
    current = directory / "current"
    if not current.is_symlink():
        if current.exists():
            raise ValueError("Invalid active release pointer")
        return None
    target = current.readlink()
    if target.parent != Path("releases"):
        raise ValueError("Invalid active release pointer")
    release_id = match(target.name, r"[a-f0-9]{32}", "deployment ID")
    if not (directory / target).is_dir() or (directory / target).is_symlink():
        raise ValueError("Active release data is missing or invalid")
    return release_id


def selected_release(directory: Path, release_id: str) -> bool:
    current = directory / "current"
    return current.is_symlink() and current.readlink() == Path("releases") / release_id


def select(directory: Path, deployment_id: str | None) -> None:
    current = directory / "current"
    if deployment_id is None:
        current.unlink(missing_ok=True)
        return
    target = Path("releases") / match(deployment_id, r"[a-f0-9]{32}", "deployment ID")
    if not (directory / target).is_dir() or (directory / target).is_symlink():
        raise ValueError("Release data is missing or invalid")
    pending = directory / ".next"
    pending.unlink(missing_ok=True)
    pending.symlink_to(target, target_is_directory=True)
    pending.replace(current)


def change_unit(site, environment, operation):
    unit = "arsvine-web-" + site.slot(environment) + ".service"
    subprocess.run(
        ["/usr/bin/systemctl", "--no-ask-password", operation, unit],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
        timeout=40,
    )


def status_code(host, port, path, *, tls):
    if tls:
        context = ssl.create_default_context(cafile=str(ORIGIN_CA))
        with (
            socket.create_connection(("127.0.0.1", port), timeout=3) as transport,
            context.wrap_socket(transport, server_hostname=host) as client,
        ):
            client.sendall(
                f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode()
            )
            with http.client.HTTPResponse(client) as response:
                response.begin()
                return response.status
    with contextlib.closing(http.client.HTTPConnection("127.0.0.1", port, timeout=3)) as client:
        client.request("GET", path, headers={"Host": host})
        with client.getresponse() as response:
            return response.status


def wait_for_health(site, environment):
    target = site.targets[environment]
    deadline = time.monotonic() + 30
    while True:
        try:
            if (
                target.port is None
                or 200
                <= status_code(
                    target.hostname,
                    target.port,
                    site.health_path,
                    tls=False,
                )
                < 300
            ) and 200 <= status_code(
                target.hostname, ORIGIN_PORT, site.health_path, tls=True
            ) < 300:
                return
        except (OSError, http.client.HTTPException):
            pass
        if time.monotonic() >= deadline:
            raise ValueError("Site did not pass the local HTTPS health check")
        time.sleep(1)


class Controller:
    def __init__(self, sites, state, github):
        self.sites = sites
        self.state = state
        self.github = github
        self.changed = threading.Event()
        with self.connect() as database:
            database.execute("""
                CREATE TABLE IF NOT EXISTS deployments (
                    id TEXT PRIMARY KEY,
                    project TEXT NOT NULL,
                    environment TEXT NOT NULL,
                    runId INTEGER,
                    commitHash TEXT NOT NULL,
                    status TEXT NOT NULL,
                    digest TEXT,
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL,
                    error TEXT,
                    previous TEXT,
                    actor TEXT NOT NULL
                )
            """)

    @contextlib.contextmanager
    def connect(self):
        with contextlib.closing(
            sqlite3.connect(self.state / "controller/deployments.sqlite3")
        ) as database:
            database.row_factory = sqlite3.Row
            with database:
                yield database

    @contextlib.contextmanager
    def release_lock(self):
        import fcntl

        with (self.state / "controller/deployment.lock").open("ab") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    def projects(self, environment_filter: str | None = None):
        rows = []
        for site in self.sites.values():
            if environment_filter and environment_filter not in site.targets:
                continue
            row = {
                "id": site.id,
                "repository": site.repository,
                "runtime": site.runtime,
                "productionRef": site.production_ref,
                "healthPath": site.health_path,
                "production": None,
                "preview": None,
            }
            for environment, target in site.targets.items():
                if environment_filter and environment != environment_filter:
                    continue
                row[environment] = {
                    "hostname": target.hostname,
                    "activeDeploymentId": self.active_deployment(site, environment),
                }
            rows.append(row)
        return rows

    def active_deployment(self, site, environment):
        deployment = active_id(site.directory(environment, self.state))
        if deployment:
            with self.connect() as database:
                row = database.execute(
                    "SELECT status, previous FROM deployments WHERE id = ?",
                    (deployment,),
                ).fetchone()
                if row and row["status"] == "deploying":
                    return row["previous"]
        return deployment

    def observation(self, site, environment_filter: str | None = None):
        environments = []
        for environment, target in site.targets.items():
            if environment_filter and environment != environment_filter:
                continue
            deployment_id = self.active_deployment(site, environment)
            service = service_metrics(site.slot(environment)) if site.runtime == "node" else None
            ready = False
            if deployment_id and (service is None or service["activeState"] == "active"):
                try:
                    ready = (
                        200
                        <= status_code(target.hostname, ORIGIN_PORT, site.health_path, tls=True)
                        < 300
                    )
                except (OSError, http.client.HTTPException):
                    pass
            environments.append(
                {
                    "environment": environment,
                    "hostname": target.hostname,
                    "activeDeploymentId": deployment_id,
                    "ready": ready,
                    "service": service,
                    "ingress": ingress(self.state / "ingress" / f"{site.slot(environment)}.json"),
                }
            )
        return {
            "project": site.id,
            "observedAt": timestamp(),
            "environments": environments,
        }

    def row(self, deployment_id: str) -> Deployment | None:
        with self.connect() as database:
            row = database.execute(
                f"SELECT {COLUMNS} FROM deployments WHERE id = ?", (deployment_id,)
            ).fetchone()
            return cast(Deployment, dict(row)) if row else None

    def receipt(self, deployment_id: str) -> Deployment:
        row = self.row(deployment_id)
        if row is None:
            raise RuntimeError("Deployment receipt is missing")
        return row

    def deployments(self, project: str | None, environment: str | None) -> list[Deployment]:
        with self.connect() as database:
            rows = database.execute(
                f"""
                SELECT {COLUMNS} FROM deployments
                WHERE (? IS NULL OR project = ?) AND (? IS NULL OR environment = ?)
                ORDER BY rowid DESC LIMIT 100
            """,
                (project, project, environment, environment),
            )
            return [cast(Deployment, dict(row)) for row in rows]

    def enqueue(self, payload) -> Deployment:
        fields(payload, ("project", "environment", "runId", "commit", "actor"))
        project = match(payload["project"], r"[a-z][a-z0-9-]{0,23}", "project")
        environment = match(payload["environment"], r"production|preview", "environment")
        site = self.sites.get(project)
        if not site or environment not in site.targets:
            raise ValueError("Unknown project environment")
        run_id = payload["runId"]
        if type(run_id) is not int or not 0 < run_id < 2**53:
            raise ValueError("Invalid workflow run ID")
        commit = match(payload["commit"], COMMIT, "commit")
        actor = match(payload["actor"], r"[A-Za-z0-9._:@|/-]{1,200}", "actor")
        now = timestamp()
        deployment_id = uuid.uuid4().hex
        with self.connect() as database:
            database.execute("BEGIN IMMEDIATE")
            existing = database.execute(
                """
                SELECT id FROM deployments WHERE project = ? AND environment = ?
                AND runId = ? AND commitHash = ? AND status IN ('queued', 'deploying')
            """,
                (project, environment, run_id, commit),
            ).fetchone()
            if existing:
                deployment_id = existing["id"]
            else:
                pending = database.execute(
                    "SELECT count(*) FROM deployments WHERE status IN ('queued', 'deploying')"
                ).fetchone()[0]
                if pending >= 16:
                    raise ValueError("Deployment queue is full")
                database.execute(
                    """
                    INSERT INTO deployments
                    (id, project, environment, runId, commitHash, status, createdAt, updatedAt, actor)
                    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)
                """,
                    (
                        deployment_id,
                        project,
                        environment,
                        run_id,
                        commit,
                        now,
                        now,
                        actor,
                    ),
                )
        self.changed.set()
        return self.receipt(deployment_id)

    def update(self, deployment_id, status, *, digest=None, error=None, previous=None):
        with self.connect() as database:
            database.execute(
                """
                UPDATE deployments SET status = ?, digest = ?, error = ?, previous = ?, updatedAt = ?
                WHERE id = ?
            """,
                (status, digest, error, previous, timestamp(), deployment_id),
            )

    def restore(self, site, environment, directory, previous):
        select(directory, previous)
        if site.runtime == "node":
            change_unit(site, environment, "restart" if previous else "stop")
        if previous:
            wait_for_health(site, environment)

    def recover(self):
        with self.connect() as database:
            interrupted = database.execute(
                "SELECT id, project, environment, previous FROM deployments WHERE status = 'deploying'"
            ).fetchall()
        for row in interrupted:
            site = self.sites.get(row["project"])
            environment = row["environment"]
            error = "Deployment was interrupted"
            if site and environment in site.targets:
                directory = site.directory(environment, self.state)
                try:
                    if selected_release(directory, row["id"]):
                        self.restore(site, environment, directory, row["previous"])
                except (OSError, ValueError, subprocess.SubprocessError):
                    error = "Deployment was interrupted and the previous release failed its health check"
                    self.detach_failed_release(site, environment, directory, row["id"])
                    LOG.warning("Recovery needs attention for %s", row["id"])
            self.update(row["id"], "failed", error=error)

    def deploy(
        self,
        release: Deployment,
        *,
        prepare: Callable[[Path], str] | None = None,
    ) -> None:
        site = self.sites.get(release["project"])
        environment = release["environment"]
        deployment_id = release["id"]
        if not site or environment not in site.targets:
            self.update(
                deployment_id,
                "failed",
                error="Project environment is no longer registered",
            )
            return
        directory = site.directory(environment, self.state)
        candidate = directory / "releases" / deployment_id
        previous = active_id(directory)
        digest = None
        switched = False
        self.update(deployment_id, "deploying", previous=previous)
        try:
            # The stage is on the same filesystem as the release pointer and inaccessible to site UIDs.
            with tempfile.TemporaryDirectory(dir=self.state / "staging") as stage:
                staged = Path(stage)
                if prepare is None:
                    if self.github is None or release["runId"] is None:
                        raise ValueError("GitHub Actions deployment is unavailable")
                    archive = staged / "artifact.zip"
                    self.github.download(
                        site, environment, release["runId"], release["commit"], archive
                    )
                    digest = unpack(
                        archive,
                        staged / "tree",
                        {
                            "project": site.id,
                            "environment": environment,
                            "commit": release["commit"],
                            "runtime": site.runtime,
                        },
                        site,
                    )
                else:
                    digest = prepare(staged)
                (staged / "tree").replace(candidate)
            select(directory, deployment_id)
            switched = True
            if site.runtime == "node":
                change_unit(site, environment, "restart")
            wait_for_health(site, environment)
        except (
            OSError,
            ValueError,
            subprocess.SubprocessError,
            tarfile.TarError,
            zipfile.BadZipFile,
        ) as failure:
            # Structured errors omit paths and command output that may contain credentials.
            error = (
                str(failure)
                if isinstance(failure, ValueError)
                else "Release could not be installed"
            )
            if switched:
                try:
                    self.restore(site, environment, directory, previous)
                except (ValueError, OSError, subprocess.SubprocessError):
                    error += ". The previous release needs attention"
                    self.detach_failed_release(site, environment, directory, deployment_id)
            if not selected_release(directory, deployment_id):
                shutil.rmtree(candidate, ignore_errors=True)
            self.update(deployment_id, "failed", digest=digest, error=error[:300])
            LOG.warning("Deployment %s failed (%s)", deployment_id, type(failure).__name__)
            return
        self.update(deployment_id, "ready", digest=digest)
        for path in (directory / "releases").iterdir():
            if path.name not in (deployment_id, previous):
                shutil.rmtree(path, ignore_errors=True)

    def detach_failed_release(
        self, site, environment: str, directory: Path, deployment_id: str
    ) -> None:
        try:
            if selected_release(directory, deployment_id):
                self.restore(site, environment, directory, None)
        except (OSError, ValueError, subprocess.SubprocessError):
            LOG.exception("Failed release %s needs operator attention", deployment_id)

    def bootstrap(self, site, environment, archive, manifest, supplied_digest) -> Deployment:
        site.slot(environment)
        commit = match(
            manifest.get("commit") if isinstance(manifest, dict) else None,
            COMMIT,
            "commit",
        )
        expected = {
            "project": site.id,
            "environment": environment,
            "commit": commit,
            "runtime": site.runtime,
        }
        digest = validate_manifest(manifest, expected, site)
        if set(manifest["site"]["capabilities"]) != set(site.capabilities):
            raise ValueError("Pilot release capabilities must match the site registration")
        if digest != match(supplied_digest, DIGEST, "operator release digest"):
            raise ValueError("Operator digest does not match the release manifest")

        def prepare(stage: Path) -> str:
            tar_path = stage / "release.tar"
            with tar_path.open("xb") as destination:
                limited_copy(archive, destination, TREE_LIMIT)
            return prepare_tree(tar_path, stage / "tree", digest, site.runtime)

        with self.release_lock():
            self.recover()
            deployment_id = uuid.uuid4().hex
            now = timestamp()
            with self.connect() as database:
                database.execute(
                    """
                    INSERT INTO deployments
                    (id, project, environment, runId, commitHash, status, createdAt, updatedAt, actor)
                    VALUES (?, ?, ?, NULL, ?, 'queued', ?, ?, 'operator')
                """,
                    (deployment_id, site.id, environment, commit, now, now),
                )
            self.deploy(self.receipt(deployment_id), prepare=prepare)
            return self.receipt(deployment_id)

    def work(self):
        with self.release_lock():
            self.recover()
        if self.github is None:
            return
        while True:
            self.changed.clear()
            with self.connect() as database:
                pending = database.execute(
                    f"SELECT {COLUMNS} FROM deployments WHERE status = 'queued' ORDER BY rowid LIMIT 1"
                ).fetchone()
            if not pending:
                self.changed.wait(30)
                continue
            try:
                with self.release_lock():
                    self.deploy(cast(Deployment, dict(pending)))
            except Exception:
                LOG.exception("Interrupted deployment worker for %s", pending["id"])
                with self.release_lock():
                    self.recover()
                    row = self.row(pending["id"])
                    if row and row["status"] == "queued":
                        self.update(row["id"], "failed", error="Deployment worker failed")


def console_peer_scopes(controller: Controller) -> dict[int, PeerScope]:
    import pwd

    scopes: dict[int, PeerScope] = {0: "owner"}
    console = controller.sites.get("console")
    if console and console.runtime == "node":
        for environment in console.targets:
            uid = pwd.getpwnam(console.user(environment)).pw_uid
            if uid in scopes:
                raise ValueError("Console service identities must have distinct unprivileged UIDs")
            scopes[uid] = "preview" if environment == "preview" else "owner"
    return scopes


class Api(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def __init__(
        self,
        request,
        client_address,
        server,
        *,
        controller: Controller,
        peer_scopes: Mapping[int, PeerScope],
    ):
        self.controller = controller
        self.peer_scopes = peer_scopes
        super().__init__(request, client_address, server)

    def address_string(self):
        return "local-console"

    def log_message(self, format: str, *args: object) -> None:
        pass

    def setup(self):
        super().setup()
        self.request.settimeout(20)

    def peer_scope(self) -> PeerScope | None:
        credentials = struct.Struct("=iII")
        try:
            _, uid, _ = credentials.unpack(
                self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, credentials.size)
            )
        except (OSError, struct.error):
            return None
        return self.peer_scopes.get(uid)

    def json(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        scope = self.peer_scope()
        if scope is None:
            self.json(403, {"error": "Controller access denied"})
            return
        controller = self.controller
        try:
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=2)
            if any(len(values) != 1 for values in query.values()) or set(query) - {
                "project",
                "environment",
            }:
                raise ValueError("Invalid query")
            project = query.get("project", [None])[0]
            environment = query.get("environment", [None])[0]
            if scope == "preview" and (environment == "production" or parsed.path == "/v1/builds"):
                self.json(403, {"error": "Console preview has read-only access to previews"})
                return
            site = controller.sites.get(project)
            if (
                scope == "preview"
                and project is not None
                and (site is None or "preview" not in site.targets)
            ):
                self.json(404, {"error": "Project preview not found"})
                return
            if (
                project is not None
                and not site
                or environment is not None
                and environment not in ("production", "preview")
            ):
                raise ValueError("Unknown project environment")
            if parsed.path == "/v1/projects" and not query:
                self.json(
                    200,
                    {"projects": controller.projects("preview" if scope == "preview" else None)},
                )
            elif parsed.path == "/v1/deployments":
                selected = "preview" if scope == "preview" else environment
                self.json(200, {"deployments": controller.deployments(project, selected)})
            elif parsed.path.startswith("/v1/deployments/") and not query:
                deployment_id = match(
                    parsed.path.rsplit("/", 1)[-1], r"[a-f0-9]{32}", "deployment ID"
                )
                row = controller.row(deployment_id)
                if scope == "preview" and row and row["environment"] != "preview":
                    row = None
                self.json(
                    200 if row else 404,
                    {"deployment": row} if row else {"error": "Deployment not found"},
                )
            elif parsed.path == "/v1/builds":
                if not site or not environment or environment not in site.targets:
                    raise ValueError("Select a registered project environment")
                if controller.github is None:
                    self.json(
                        503,
                        {"error": "GitHub Actions credentials are not configured"},
                    )
                else:
                    self.json(200, {"builds": controller.github.builds(site, environment)})
            elif parsed.path == "/v1/observation":
                if not site or environment:
                    raise ValueError("Select a registered project")
                self.json(
                    200,
                    {
                        "observation": controller.observation(
                            site, "preview" if scope == "preview" else None
                        ),
                    },
                )
            else:
                self.json(404, {"error": "Unknown runtime endpoint"})
        except ValueError as error:
            self.json(400, {"error": str(error)[:300]})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "-1"))
            if self.headers.get_content_type() != "application/json" or not 0 < length <= 2048:
                raise ValueError("Expected a small JSON deployment request")
            # Consume bounded bytes before rejecting the request so a client can finish
            # sending its body even when it uses separate writes for headers and data.
            body = self.rfile.read(length)
            if self.peer_scope() != "owner":
                self.json(403, {"error": "Controller write access denied"})
                return
            if self.path != "/v1/deployments":
                self.json(404, {"error": "Unknown runtime endpoint"})
                return
            if self.controller.github is None:
                self.json(503, {"error": "GitHub Actions credentials are not configured"})
                return
            self.json(
                202,
                {"deployment": self.controller.enqueue(json.loads(body))},
            )
        except ValueError as error:
            self.json(400, {"error": str(error)[:300]})


class ApiServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True

    def __init__(
        self,
        controller: Controller,
        listener: socket.socket,
        peer_scopes: Mapping[int, PeerScope],
    ):
        # systemd has already created, bound and started listening on the Unix socket.
        handler = partial(Api, controller=controller, peer_scopes=peer_scopes)
        socketserver.BaseServer.__init__(self, listener.getsockname(), handler)
        self.socket = listener


def serve(controller: Controller, listener: socket.socket) -> None:
    with ApiServer(controller, listener, console_peer_scopes(controller)) as server:
        threading.Thread(target=controller.work, daemon=True).start()
        server.serve_forever()
