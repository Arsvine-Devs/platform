import hashlib
import http.client
import io
import json
import os
import shutil
import socket
import stat
import sys
import tarfile
import tempfile
import threading
import time
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from arsvine_ops.web.artifacts import approved_run, extract_tree, unpack
from arsvine_ops.web.controller import ApiServer, Controller, PeerScope, active_id
from arsvine_ops.web.edge import CloudflareError, plan, publish
from arsvine_ops.web.observation import ingress
from arsvine_ops.web.registry import caddyfile, load_registry
from arsvine_ops.web.security import (
    CACHE_PHASE,
    CACHE_REF,
    RATE_PHASE,
    SCAN_REF,
    WAF_PHASE,
    policy,
    sync,
)

COMMIT = "a" * 40
AUDIENCE = "b" * 64
SITE = {
    "id": "app",
    "repository": "example/app",
    "runtime": "node",
    "productionRef": "main",
    "production": {"hostname": "app.example.com", "port": 12000},
    "preview": {
        "hostname": "preview.example.com",
        "port": 12001,
        "accessAudience": AUDIENCE,
    },
}
EXPECTED = {
    "project": "app",
    "environment": "production",
    "commit": COMMIT,
    "runtime": "node",
}


def dependency_sites():
    return [
        dict(
            SITE,
            id="realm",
            media="realm",
            dependencies=["auth", "content"],
            production={"hostname": "realm.example.com", "port": 12000},
            preview={
                "hostname": "realm-preview.example.com",
                "port": 12001,
                "accessAudience": AUDIENCE,
            },
        ),
        dict(
            SITE,
            id="auth",
            production={"hostname": "auth.example.com", "port": 12002},
            preview={
                "hostname": "auth-preview.example.com",
                "port": 12003,
                "accessAudience": AUDIENCE,
            },
        ),
        dict(
            SITE,
            id="content",
            production={"hostname": "content.example.com", "port": 12004},
            preview={
                "hostname": "content-preview.example.com",
                "port": 12005,
                "accessAudience": AUDIENCE,
            },
        ),
        dict(
            SITE,
            id="unrelated",
            production={"hostname": "unrelated.example.com", "port": 12006},
            preview={
                "hostname": "unrelated-preview.example.com",
                "port": 12007,
                "accessAudience": AUDIENCE,
            },
        ),
    ]


def build(path, name="entry.mjs", *, member_type=tarfile.REGTYPE, bad_digest=False, grants=()):
    content = b'console.log("demo");\n'
    blob = io.BytesIO()
    with tarfile.open(fileobj=blob, mode="w") as archive:
        member = tarfile.TarInfo(name)
        member.type = member_type
        if member_type == tarfile.REGTYPE:
            member.size = len(content)
        elif member_type == tarfile.SYMTYPE:
            member.linkname = "/etc/passwd"
        archive.addfile(member, io.BytesIO(content))
    digest = hashlib.sha256(blob.getvalue()).hexdigest()
    manifest = dict(
        EXPECTED,
        version=1,
        digest=f"sha256:{'0' * 64 if bad_digest else digest}",
        site={
            "productionRef": "main",
            "hostname": "app.example.com",
            "healthPath": "/",
            "capabilities": list(grants),
        },
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("release.tar", blob.getvalue())


def write_tree(archive_path, files, links):
    with tarfile.open(archive_path, mode="w") as archive:
        for path in files:
            member = tarfile.TarInfo(path)
            member.size = 2
            archive.addfile(member, io.BytesIO(b"ok"))
        for path, target in links.items():
            member = tarfile.TarInfo(path)
            member.type = tarfile.SYMTYPE
            member.linkname = target
            archive.addfile(member)


class RuntimeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name)
        self.registry = self.path / "sites.json"
        self.registry.write_text(json.dumps({"sites": [SITE]}), encoding="utf-8")
        self.sites = load_registry(self.registry).sites
        self.site = self.sites["app"]

    def test_release_tampering_and_links_fail_before_activation(self):
        for name, type_, corrupt in (
            ("../escaped", tarfile.REGTYPE, False),
            ("entry.mjs", tarfile.SYMTYPE, False),
            ("entry.mjs", tarfile.REGTYPE, True),
        ):
            with self.subTest(name=name, type_=type_, corrupt=corrupt):
                build(
                    self.path / "bundle.zip",
                    name,
                    member_type=type_,
                    bad_digest=corrupt,
                )
                with self.assertRaises(ValueError):
                    unpack(
                        self.path / "bundle.zip",
                        self.path / "candidate",
                        EXPECTED,
                        self.site,
                    )
                shutil.rmtree(self.path / "candidate", ignore_errors=True)
        self.assertFalse((self.path / "escaped").exists())

    def test_ci_cannot_grant_itself_a_host_capability(self):
        bundle = self.path / "bundle.zip"
        build(bundle, grants=("postgres",))
        with self.assertRaisesRegex(ValueError, "unapproved site"):
            unpack(bundle, self.path / "candidate", EXPECTED, self.site)

    def test_release_intake_preserves_other_files_in_staging(self):
        sibling = self.path / "release.tar"
        sibling.write_bytes(b"other staging input")
        archive = self.path / "bundle.zip"
        build(archive)
        release = self.path / "candidate"
        unpack(archive, release, EXPECTED, self.site)
        self.assertTrue((release / "entry.mjs").is_file())
        self.assertEqual(sibling.read_bytes(), b"other staging input")

    def test_registry_requires_same_environment_for_direct_dependencies(self):
        rows = dependency_sites()
        rows[1].pop("preview")
        self.registry.write_text(json.dumps({"sites": rows}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "realm preview needs auth registered for preview"):
            load_registry(self.registry)
        rows = dependency_sites()
        rows[0]["dependencies"].append("unknown")
        self.registry.write_text(json.dumps({"sites": rows}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "registered Node dependency: unknown"):
            load_registry(self.registry)

    @unittest.skipUnless(os.name == "posix", "Uses the host's isolated runtime identities")
    def test_preview_origin_environment_and_firewall_only_grant_same_environment_dependencies(
        self,
    ):
        from arsvine_ops.web.host import CONTROLLER, GATEWAY, firewall, origin_environment

        self.registry.write_text(json.dumps({"sites": dependency_sites()}), encoding="utf-8")
        sites = load_registry(self.registry).sites
        realm = sites["realm"]
        values = dict(value.split("=", 1) for value in origin_environment(realm, sites, "preview"))
        self.assertEqual(
            json.loads(values["ARS_WEB_INTERNAL_ORIGINS"].strip("'")),
            {"auth": "http://127.0.0.1:12003", "content": "http://127.0.0.1:12005"},
        )
        self.assertEqual(values["CONTENT_INTERNAL_ORIGIN"], "http://127.0.0.1:12005")
        self.assertEqual(values["CONTENT_ORIGIN"], "https://content-preview.example.com")
        self.assertEqual(values["AUTH_INTERNAL_ORIGIN"], "http://127.0.0.1:12003")
        self.assertEqual(values["AUTH_ORIGIN"], "https://auth-preview.example.com")
        accounts = [CONTROLLER, GATEWAY] + [
            site.user(environment) for site in sites.values() for environment in site.targets
        ]
        uids = {account: index for index, account in enumerate(accounts, start=1000)}
        rules = firewall(sites, uids.__getitem__, origin_only=True)
        permission = (
            f"meta skuid {uids[realm.user('preview')]} ip daddr 127.0.0.1 "
            "tcp dport { 12003, 12005 } accept"
        )
        self.assertIn(permission, rules)
        self.assertLess(rules.index(permission), rules.index("tcp dport { 12000, 12001"))

    @unittest.skipUnless(os.name == "posix", "Uses the systemd environment renderer")
    def test_builtin_preview_issuer_and_public_origins_come_from_preview_registry(self):
        from arsvine_ops.web.host import origin_environment

        rows = dependency_sites()
        rows.append(
            {
                "id": "ripple",
                "repository": "example/ripple",
                "runtime": "static",
                "productionRef": "main",
                "production": {"hostname": "ripple.example.com"},
            }
        )
        self.registry.write_text(json.dumps({"sites": rows}), encoding="utf-8")
        sites = load_registry(self.registry).sites
        values = dict(
            line.split("=", 1) for line in origin_environment(sites["auth"], sites, "preview")
        )
        self.assertEqual(json.loads(values["ARS_WEB_INTERNAL_ORIGINS"].strip("'")), {})
        self.assertEqual(
            json.loads(values["ARS_WEB_ORIGINS"].strip("'")),
            {
                "realm": "https://realm-preview.example.com",
                "auth": "https://auth-preview.example.com",
                "content": "https://content-preview.example.com",
            },
        )

    @unittest.skipUnless(os.name == "posix", "Uses POSIX dependency symlinks")
    def test_release_keeps_pnpm_relative_sibling_links(self):
        base = self.path / "release"
        base.mkdir()
        archive = self.path / "release.tar"
        link = "node_modules/left/node_modules/helper"
        dependency = "node_modules/right/node_modules/helper"
        target = "../../right/node_modules/helper"
        write_tree(archive, [dependency + "/index.js"], {link: target})
        extract_tree(archive, base)
        self.assertEqual((base / link).readlink().as_posix(), target)
        self.assertEqual((base / link).resolve(), base / dependency)
        self.assertEqual((base / link / "index.js").read_bytes(), b"ok")

    def test_release_rejects_link_escape_cycles_and_member_link_parents(self):
        for files, links, fault in (
            ([], {"escape": "../outside"}, "escapes"),
            ([], {"a": "b", "b": "a"}, "cycle"),
            (
                ["public/index.html", "shortcut/write.html"],
                {"shortcut": "public"},
                "entry parent",
            ),
            (
                ["public/index.html"],
                {"a/short": "../public", "escape": "a/short/../../outside"},
                "escapes",
            ),
        ):
            with self.subTest(fault=fault, links=links):
                archive = self.path / "release.tar"
                base = self.path / "release"
                base.mkdir(exist_ok=True)
                write_tree(archive, files, links)
                with self.assertRaisesRegex(ValueError, fault):
                    extract_tree(archive, base)
                self.assertEqual(list(base.iterdir()), [])

    def test_run_must_match_repository_workflow_and_environment(self):
        run = {
            "status": "completed",
            "conclusion": "success",
            "path": ".github/workflows/web.yml",
            "repository": {"full_name": "example/app"},
            "head_repository": {"full_name": "example/app"},
            "id": 10,
            "head_sha": COMMIT,
            "head_branch": "main",
            "event": "push",
        }
        self.assertTrue(approved_run(run, self.site, "production"))
        self.assertFalse(approved_run(run, self.site, "preview"))
        preview = dict(run, event="workflow_dispatch", head_branch="feature/demo")
        self.assertTrue(approved_run(preview, self.site, "preview"))
        self.assertFalse(approved_run(preview, self.site, "production"))
        self.assertFalse(approved_run(dict(preview, event="pull_request"), self.site, "preview"))
        fork = dict(preview, head_repository={"full_name": "another/app"})
        self.assertFalse(approved_run(fork, self.site, "preview"))
        self.assertFalse(
            approved_run(
                dict(run, path=".github/workflows/unrelated.yml"),
                self.site,
                "production",
            )
        )

    def test_origin_policy_is_a_known_host_route_with_tls_and_preview_access(self):
        edge = self.path / "edge.json"
        edge.write_text(
            json.dumps(
                {
                    "accountId": "1" * 32,
                    "tunnelId": "12345678-1234-1234-1234-123456789abc",
                    "teamName": "example",
                    "zones": {"example.com": "2" * 32},
                }
            ),
            encoding="utf-8",
        )
        routes = plan(self.sites, edge)["configuration"]["config"]["ingress"]
        self.assertEqual(routes[-1], {"service": "http_status:404"})
        self.assertEqual(routes[0]["originRequest"]["originServerName"], "app.example.com")
        self.assertEqual(routes[1]["originRequest"]["access"]["audTag"], [AUDIENCE])
        self.assertTrue(routes[1]["originRequest"]["access"]["required"])
        self.assertEqual(routes[1]["service"], "https://127.0.0.1:8080")
        self.assertEqual(routes[1]["originRequest"]["caPool"], "/etc/arsvine-web/tls/origin-ca.pem")
        rendered = caddyfile(self.sites)
        self.assertIn("auto_https disable_redirects", rendered)
        self.assertIn("skip_install_trust", rendered)
        self.assertIn("tls internal", rendered)
        self.assertIn("strict_sni_host on", rendered)
        self.assertIn("max_header_size 64KiB", rendered)
        self.assertIn("read_header 10s", rendered)
        self.assertIn("idle 2m", rendered)
        self.assertIn("respond 404", rendered)
        self.assertIn("bind 127.0.0.1", rendered)
        self.assertIn("https://preview.example.com:8080", rendered)

    def test_realm_redirect_alias_is_enrolled_with_its_own_tls_hostname(self):
        rows = dependency_sites()
        rows[0]["production"]["redirectAliases"] = ["www.example.com"]
        self.registry.write_text(json.dumps({"sites": rows}), encoding="utf-8")
        sites = load_registry(self.registry).sites
        edge = self.path / "edge.json"
        edge.write_text(
            json.dumps(
                {
                    "accountId": "1" * 32,
                    "tunnelId": "12345678-1234-1234-1234-123456789abc",
                    "teamName": "example",
                    "zones": {"example.com": "2" * 32},
                }
            ),
            encoding="utf-8",
        )
        rendered = caddyfile(sites)
        self.assertIn("https://www.example.com:8080", rendered)
        self.assertIn("redir https://realm.example.com{uri} 308", rendered)
        prod_routes = plan(sites, edge)["configuration"]["config"]["ingress"]
        alias = next(route for route in prod_routes if route.get("hostname") == "www.example.com")
        self.assertEqual(alias["originRequest"]["originServerName"], "www.example.com")
        preview = plan(sites, edge, preview="realm")
        self.assertEqual(
            [entry["record"]["name"] for entry in preview["records"]], ["realm-preview.example.com"]
        )

        rows[0]["preview"]["redirectAliases"] = ["alternate.example.com"]
        self.registry.write_text(json.dumps({"sites": rows}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Realm production"):
            load_registry(self.registry)

    def test_conflicting_dns_does_not_change_the_tunnel_or_records(self):
        calls = []

        class Client:
            def call(self, path, method="GET", data=None):
                calls.append((path, method))
                return [{"type": "A", "name": "app.example.com", "content": "192.0.2.1"}]

        record = {
            "type": "CNAME",
            "name": "app.example.com",
            "content": "example.cfargotunnel.com",
            "proxied": True,
        }
        desired = {"records": [{"record": record, "zoneId": "2" * 32}]}
        with self.assertRaisesRegex(ValueError, "explicit cutover"):
            publish(desired, Client(), Client())
        self.assertEqual([method for _, method in calls], ["GET"])

    def test_scoped_preview_publishes_only_preview_dns_and_preserves_tunnel_routes(
        self,
    ):
        edge = self.path / "edge.json"
        edge.write_text(
            json.dumps(
                {
                    "accountId": "1" * 32,
                    "tunnelId": "12345678-1234-1234-1234-123456789abc",
                    "teamName": "example",
                    "zones": {"example.com": "2" * 32},
                }
            ),
            encoding="utf-8",
        )
        desired = plan(self.sites, edge, preview="app")
        self.assertEqual(
            [row["record"]["name"] for row in desired["records"]],
            ["preview.example.com"],
        )
        routes = [
            {"hostname": "app.example.com", "service": "http://127.0.0.1:8001"},
            {
                "hostname": "preview.example.com",
                "path": "/old",
                "service": "http_status:410",
            },
            {"hostname": "*.example.com", "service": "http://127.0.0.1:8002"},
            {"service": "http_status:404"},
        ]
        origin_request = {"connectTimeout": "10s"}
        tunnel_calls = []
        dns_calls = []

        class Tunnel:
            def call(self, path, method="GET", data=None):
                tunnel_calls.append((method, data))
                return {"config": {"ingress": routes, "originRequest": origin_request}}

        class DNS:
            def call(self, path, method="GET", data=None):
                dns_calls.append((path, method, data))
                return []

        publish(desired, Tunnel(), DNS(), preserve_routes=True)
        self.assertEqual([method for method, _ in tunnel_calls], ["GET", "PUT"])
        result = tunnel_calls[1][1]["config"]
        self.assertEqual(result["originRequest"], origin_request)
        preview = result["ingress"][2]
        self.assertEqual(preview["hostname"], "preview.example.com")
        self.assertTrue(preview["originRequest"]["access"]["required"])
        self.assertEqual(result["ingress"][:2] + result["ingress"][3:], routes)
        self.assertEqual([method for _, method, _ in dns_calls], ["GET", "POST"])
        self.assertIn("name=preview.example.com", dns_calls[0][0])
        self.assertEqual(dns_calls[1][2]["name"], "preview.example.com")

    def test_access_projection_counts_errors_and_scrubs_request_values(self):
        log = self.path / "access.jsonl"
        event = {"ts": time.time(), "status": 502, "duration": 0.012, "size": 5}
        log.write_text(
            "\n".join(
                json.dumps(row)
                for row in (
                    dict(
                        event,
                        path="/foo/" + "a" * 50,
                        cf_ray="0123456789abcdef-NRT",
                        request_id="safe-id",
                    ),
                    dict(
                        event,
                        status=200,
                        path="/foo?secret=test",
                        cf_ray="cookie=value",
                        request_id="raw header",
                    ),
                    dict(event, ts=time.time() - 7200, path="/old"),
                )
            ),
            encoding="utf-8",
        )
        snapshot = ingress(log)
        self.assertEqual(snapshot["requests"], 2)
        self.assertEqual(snapshot["errors5xx"], 1)
        self.assertEqual(snapshot["p95Milliseconds"], 12)
        self.assertIsNone(snapshot["entries"][0]["path"])
        self.assertIsNone(snapshot["entries"][0]["requestId"])
        self.assertIsNone(snapshot["entries"][0]["cfRay"])
        self.assertEqual(snapshot["entries"][1]["path"], "/foo/:redacted")
        self.assertEqual(snapshot["entries"][1]["cfRay"], "0123456789abcdef-NRT")

    def test_cloudflare_security_updates_its_rule_without_replacing_the_zone(self):
        security_site = dict(SITE, capabilities=["identity"])
        self.registry.write_text(json.dumps({"sites": [security_site]}), encoding="utf-8")
        sites = load_registry(self.registry).sites
        zone_id = "2" * 32
        edge = {
            "records": [
                {"zoneId": zone_id, "record": {"name": host}}
                for host in ("app.example.com", "preview.example.com", "cdn.example.com")
            ]
        }
        desired = policy(sites, edge, "host-post")
        cache, rate, scanner = desired["zones"][0]["rules"]
        self.assertEqual(cache["phase"], CACHE_PHASE)
        self.assertEqual(rate["phase"], RATE_PHASE)
        self.assertEqual(scanner["phase"], WAF_PHASE)
        self.assertEqual(scanner["rule"]["ref"], SCAN_REF)
        self.assertEqual(scanner["rule"]["action"], "block")
        self.assertIn('"cdn.example.com"', scanner["rule"]["expression"])
        self.assertIn('"/.aws/"', scanner["rule"]["expression"])
        self.assertNotIn('"/.well-known/', scanner["rule"]["expression"])
        self.assertIn('"preview.example.com"', cache["rule"]["expression"])
        self.assertNotIn('"app.example.com"', cache["rule"]["expression"])
        self.assertIn('http.request.method eq "POST"', rate["rule"]["expression"])
        self.assertNotIn(
            "http.host",
            policy(sites, edge, "path")["zones"][0]["rules"][1]["rule"]["expression"],
        )
        calls = []

        class Client:
            deny_waf = False

            def call(self, path, method="GET", data=None):
                calls.append((path, method, data))
                if CACHE_PHASE in path:
                    return {
                        "id": "3" * 32,
                        "rules": [
                            {"id": "4" * 32, "ref": CACHE_REF, "expression": "old"},
                            {"id": "5" * 32, "ref": "other-team-rule"},
                        ],
                    }
                if RATE_PHASE in path:
                    return {"id": "6" * 32, "rules": []}
                if WAF_PHASE in path:
                    if self.deny_waf:
                        raise CloudflareError(method, 403)
                    return {"id": "7" * 32, "rules": []}
                return {}

        sync(Client(), desired)
        writes = [entry for entry in calls if entry[1] != "GET"]
        self.assertEqual([method for _, method, _ in writes], ["PATCH", "POST", "POST"])
        self.assertTrue(writes[0][0].endswith("/rules/" + "4" * 32))
        self.assertEqual(writes[0][2]["position"], {"after": ""})
        self.assertNotIn("other-team-rule", str(writes))
        calls.clear()
        denied = Client()
        denied.deny_waf = True
        with self.assertRaises(CloudflareError):
            sync(denied, desired)
        self.assertTrue(all(method == "GET" for _, method, _ in calls))

    @unittest.skipUnless(os.name == "posix", "Uses POSIX release symlinks")
    def test_unhealthy_dynamic_release_restores_the_previous_healthy_runtime(self):
        directory = self.site.directory("production", self.path)
        (directory / "releases").mkdir(parents=True)
        (self.path / "staging").mkdir()
        (self.path / "controller").mkdir()

        class GitHub:
            def download(self, site, environment, run_id, commit, destination):
                build(destination)

        controller = Controller(self.sites, self.path, GitHub())
        payload = {
            "project": "app",
            "environment": "production",
            "runId": 1,
            "commit": COMMIT,
            "actor": "user-42",
        }
        first = controller.enqueue(payload)
        second = controller.enqueue(dict(payload, runId=2))
        with (
            patch("arsvine_ops.web.controller.change_unit") as unit,
            patch(
                "arsvine_ops.web.controller.wait_for_health",
                side_effect=[None, ValueError("Health check failed"), None],
            ) as health,
        ):
            controller.deploy(first)
            controller.deploy(second)
        self.assertEqual(active_id(directory), first["id"])
        self.assertEqual(controller.receipt(first["id"])["status"], "ready")
        self.assertEqual(controller.receipt(second["id"])["status"], "failed")
        self.assertEqual(controller.receipt(first["id"])["actor"], "user-42")
        self.assertFalse((directory / "releases" / second["id"]).exists())
        self.assertEqual(unit.call_count, 3)
        self.assertEqual(health.call_count, 3)

        third = controller.enqueue(dict(payload, runId=3))

        def lose_previous_release(*args):
            shutil.rmtree(directory / "releases" / first["id"])
            raise ValueError("Health check failed")

        with (
            patch("arsvine_ops.web.controller.change_unit") as change_unit,
            patch("arsvine_ops.web.controller.wait_for_health", side_effect=lose_previous_release),
        ):
            controller.deploy(third)
        self.assertIsNone(active_id(directory))
        self.assertEqual(controller.receipt(third["id"])["status"], "failed")
        self.assertEqual(change_unit.call_args.args[-1], "stop")
        self.assertFalse((directory / "releases" / third["id"]).exists())

    @unittest.skipUnless(os.name == "posix", "Uses POSIX production identities")
    def test_origin_socket_and_unix_controller_have_restrictive_access(self):
        from arsvine_ops.web.host import CONTROLLER, GATEWAY, TUNNEL, firewall, shared_units

        identities = {
            CONTROLLER: 110,
            GATEWAY: 111,
            TUNNEL: 112,
            self.site.user("production"): 113,
        }
        # Production and preview get separate accounts, including a distinct suffix.
        identities[self.site.user("preview")] = 114
        self.assertNotEqual(self.site.user("production"), self.site.user("preview"))
        policy = firewall(self.sites, identities.__getitem__)
        self.assertIn("tcp dport 8080 meta skuid != { 0, 110, 112 } reject", policy)
        self.assertIn("tcp dport { 12000, 12001 } meta skuid != { 0, 110, 111 } reject", policy)
        self.assertIn("meta skuid { 113, 114 } fib daddr type local reject", policy)
        self.assertIn('iifname != "lo" tcp dport { 8080, 12000, 12001 } drop', policy)
        socket_unit = shared_units()["arsvine-web-controller.socket"]
        self.assertIn("SocketGroup=ars-web-console", socket_unit)
        self.assertIn("SocketMode=0660", socket_unit)
        guard = shared_units()["arsvine-web-guard.service"]
        self.assertIn("CapabilityBoundingSet=CAP_NET_ADMIN", guard)
        self.assertIn("NoNewPrivileges=true", guard)

    @unittest.skipUnless(os.name == "posix", "Uses POSIX origin ownership checks")
    def test_install_rejects_port_owned_by_another_systemd_unit(self):
        from arsvine_ops.web.host import check_ports

        listener = SimpleNamespace(
            stdout='LISTEN 0 511 127.0.0.1:12000 0.0.0.0:* users:(("node",pid=14,fd=17))\n'
        )
        with (
            patch("arsvine_ops.web.host.run", return_value=listener),
            patch("arsvine_ops.web.host.unit_owns_process", return_value=False) as owner,
            self.assertRaisesRegex(ValueError, "12000 is already in use"),
        ):
            check_ports(self.sites)
        owner.assert_called_once_with("arsvine-web-app-production.service", "14")

    @unittest.skipUnless(os.name == "posix", "Uses POSIX log ownership")
    def test_access_log_provisioning_preserves_data_and_rejects_links(self):
        from arsvine_ops.web.host import provision_access_log

        log = self.path / "gateway.json"
        log.write_bytes(b"existing request")
        for _ in range(2):
            provision_access_log(log, owner=os.geteuid(), group=os.getegid())
        self.assertEqual(stat.S_IMODE(log.stat().st_mode), 0o640)
        self.assertEqual(log.read_bytes(), b"existing request")

        linked = self.path / "linked.json"
        linked.symlink_to(log.name)
        with self.assertRaises(OSError):
            provision_access_log(linked, owner=os.geteuid(), group=os.getegid())
        linked.unlink()
        os.link(log, linked)
        with self.assertRaisesRegex(ValueError, "Unsafe access log"):
            provision_access_log(linked, owner=os.geteuid(), group=os.getegid())

    @unittest.skipUnless(sys.platform == "linux", "Uses Linux Unix-socket peer credentials")
    def test_console_http_protocol_on_unix_socket(self):
        (self.path / "controller").mkdir()
        controller = Controller(self.sites, self.path, object())
        socket_path = str(self.path / "console.sock")

        class Client(http.client.HTTPConnection):
            def connect(self):
                self.sock = socket.socket(socket.AF_UNIX)
                self.sock.settimeout(2)
                self.sock.connect(socket_path)

        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(socket_path)
        listener.listen()
        scopes: dict[int, PeerScope] = {os.geteuid(): "owner"}
        with ApiServer(controller, listener, scopes) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            client = Client("console")
            try:
                client.request("GET", "/v1/projects")
                with client.getresponse() as response:
                    self.assertEqual(response.status, 200)
                    projects = json.load(response)["projects"]
                self.assertEqual(projects[0]["production"]["hostname"], "app.example.com")
                payload = {
                    "project": "app",
                    "environment": "production",
                    "runId": 123,
                    "commit": COMMIT,
                    "actor": "console-owner",
                }
                client.request(
                    "POST",
                    "/v1/deployments",
                    json.dumps(payload),
                    {"Content-Type": "application/json"},
                )
                with client.getresponse() as response:
                    self.assertEqual(response.status, 202)
                    queued = json.load(response)["deployment"]
                self.assertEqual(queued["status"], "queued")
                preview = controller.enqueue(dict(payload, environment="preview"))
                client.request("GET", f"/v1/deployments/{queued['id']}")
                with client.getresponse() as response:
                    self.assertEqual(json.load(response)["deployment"]["actor"], "console-owner")
                controller.github = None
                client.request("GET", "/v1/projects")
                with client.getresponse() as response:
                    self.assertEqual(response.status, 200)
                    json.load(response)
                client.request("GET", "/v1/builds?project=app&environment=preview")
                with client.getresponse() as response:
                    self.assertEqual(response.status, 503)
                    self.assertIn("credentials", json.load(response)["error"])
                client.request(
                    "POST",
                    "/v1/deployments",
                    json.dumps(payload),
                    {"Content-Type": "application/json"},
                )
                with client.getresponse() as response:
                    self.assertEqual(response.status, 503)
                    json.load(response)
                scopes[os.geteuid()] = "preview"
                client.request("GET", "/v1/projects")
                with client.getresponse() as response:
                    projects = json.load(response)["projects"]
                self.assertIsNone(projects[0]["production"])
                self.assertEqual(projects[0]["preview"]["hostname"], "preview.example.com")
                client.request("GET", "/v1/deployments")
                with client.getresponse() as response:
                    self.assertEqual(
                        [row["id"] for row in json.load(response)["deployments"]], [preview["id"]]
                    )
                client.request("GET", f"/v1/deployments/{queued['id']}")
                with client.getresponse() as response:
                    self.assertEqual(response.status, 404)
                    json.load(response)
                client.request("GET", "/v1/observation?project=app")
                with client.getresponse() as response:
                    environments = json.load(response)["observation"]["environments"]
                    self.assertEqual([value["environment"] for value in environments], ["preview"])
                client.request(
                    "POST",
                    "/v1/deployments",
                    json.dumps(payload),
                    {"Content-Type": "application/json"},
                )
                with client.getresponse() as response:
                    self.assertEqual(response.status, 403)
                    json.load(response)
                scopes.clear()
                client.request("GET", "/v1/projects")
                with client.getresponse() as response:
                    self.assertEqual(response.status, 403)
                    json.load(response)
            finally:
                client.close()
                server.shutdown()
                thread.join(timeout=2)

    @unittest.skipUnless(
        os.name == "posix",
        "Uses the pilot runtime's POSIX files and socket permissions",
    )
    def test_local_bootstrap_uses_the_same_release_receipt_and_validates_operator_digest(
        self,
    ):
        directory = self.site.directory("production", self.path)
        (directory / "releases").mkdir(parents=True)
        (self.path / "staging").mkdir()
        (self.path / "controller").mkdir()
        bundle = self.path / "bundle.zip"
        build(bundle)
        with zipfile.ZipFile(bundle) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            payload = archive.read("release.tar")
        controller = Controller(self.sites, self.path, None)
        with self.assertRaisesRegex(ValueError, "Operator digest"):
            controller.bootstrap(
                self.site,
                "production",
                io.BytesIO(payload),
                manifest,
                "sha256:" + "f" * 64,
            )
        self.assertEqual(controller.deployments(None, None), [])
        with (
            patch("arsvine_ops.web.controller.change_unit"),
            patch("arsvine_ops.web.controller.wait_for_health"),
        ):
            succeeded = controller.bootstrap(
                self.site,
                "production",
                io.BytesIO(payload),
                manifest,
                manifest["digest"],
            )
            failed = controller.bootstrap(
                self.site,
                "production",
                io.BytesIO(payload + b"tampered"),
                manifest,
                manifest["digest"],
            )
        self.assertEqual(succeeded["status"], "ready")
        self.assertEqual(failed["status"], "failed")
        self.assertIsNone(succeeded["runId"])
        self.assertEqual(succeeded["actor"], "operator")
        self.assertEqual(active_id(directory), succeeded["id"])

    @unittest.skipUnless(os.name == "posix", "Uses POSIX origin policy identities")
    def test_origin_only_runtime_does_not_install_connector_or_github_credentials(self):
        from arsvine_ops.web.host import CONTROLLER, GATEWAY, firewall, shared_units

        units = shared_units(origin_only=True)
        self.assertNotIn("arsvine-web-tunnel.service", units)
        controller = units["arsvine-web-controller.service"]
        self.assertIn("serve --origin-only", controller)
        self.assertNotIn("LoadCredential", controller)
        identities = {CONTROLLER: 100, GATEWAY: 101}
        policy = firewall({}, identities.__getitem__, origin_only=True)
        self.assertIn("tcp dport 8080 meta skuid != { 0, 100 } reject", policy)

    @unittest.skipUnless(os.name == "posix", "Uses POSIX service identities")
    def test_tunnel_and_github_release_credentials_are_independent(self):
        from arsvine_ops.web.host import shared_units

        units = shared_units()
        self.assertIn("arsvine-web-tunnel.service", units)
        self.assertIn("LoadCredential=tunnel-token:", units["arsvine-web-tunnel.service"])
        self.assertNotIn("github-token", units["arsvine-web-controller.service"])
        enrolled = shared_units(github_enabled=True)
        self.assertIn("LoadCredential=github-token:", enrolled["arsvine-web-controller.service"])
