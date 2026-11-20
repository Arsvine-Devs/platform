import hashlib
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from arsvine_ops.build.site_release import Site, build_matrix, package, read_site


class SiteReleaseTest(unittest.TestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.site_file = self.root / "site.yaml"
        self.service: Site = {
            "id": "sample",
            "runtime": "static",
            "production": {"branch": "main", "hostname": "sample.example.com"},
            "health": "/",
            "capabilities": [],
            "build": {"type": "static", "directory": ".", "output": "dist"},
        }

    def write_site(self, *services: Site) -> list[Site]:
        self.site_file.write_text(json.dumps({"version": 1, "services": services}))
        return read_site(self.site_file)

    def test_duplicate_domain_and_escaping_build_path_fail_before_build(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.write_site(self.service, {**self.service, "id": "other"})
        self.service["build"]["output"] = "../../etc"
        with self.assertRaisesRegex(ValueError, "relative"):
            self.write_site(self.service)

    def test_production_matrix_contains_only_services_approved_for_ref(self):
        services = self.write_site(self.service)
        self.assertEqual(build_matrix(services, "production", "topic"), [])
        self.assertEqual(build_matrix(services, "preview", "topic")[0]["id"], "sample")

    def test_package_contains_only_requested_static_output_and_exact_digest(self):
        self.write_site(self.service)
        (self.root / "dist").mkdir()
        (self.root / "dist" / "index.html").write_text("<h1>Sample</h1>")
        (self.root / ".env").write_text("SECRET=fixture")
        out = self.root / "artifacts"
        package(self.root, self.service, "production", "a" * 40, out)
        manifest = json.loads((out / "manifest.json").read_text())
        data = (out / "release.tar").read_bytes()
        self.assertEqual(manifest["digest"], "sha256:" + hashlib.sha256(data).hexdigest())
        self.assertEqual(manifest["project"], "sample")
        with tarfile.open(out / "release.tar") as archive:
            self.assertEqual(archive.getnames(), ["index.html"])

    def test_failed_package_does_not_replace_an_existing_release(self):
        dist = self.root / "dist"
        dist.mkdir()
        index = dist / "index.html"
        index.write_text("<h1>Sample</h1>")
        out = self.root / "artifacts"
        original = package(self.root, self.service, "preview", "a" * 40, out)
        self.assertEqual(package(self.root, self.service, "preview", "a" * 40, out), original)
        archive = (out / "release.tar").read_bytes()
        index.unlink()

        with self.assertRaisesRegex(ValueError, "missing index.html"):
            package(self.root, self.service, "preview", "b" * 40, out)
        self.assertEqual((out / "release.tar").read_bytes(), archive)
        with self.assertRaisesRegex(ValueError, "missing index.html"):
            package(self.root, self.service, "preview", "b" * 40, self.root / "failed")
        self.assertFalse((self.root / "failed").exists())

    def test_next_monorepo_package_includes_static_and_public_next_to_server(self):
        service: Site = {
            **self.service,
            "runtime": "node",
            "build": {"type": "next", "directory": "apps/demo", "package": "demo"},
        }
        app = self.root / "apps/demo"
        for name in (".next/standalone/apps/demo", ".next/static", "public"):
            (app / name).mkdir(parents=True)
        (app / ".next/standalone/apps/demo/server.js").write_text("require('next')")
        (app / ".next/static/app.js").write_text("export {}")
        copied_static = app / ".next/standalone/apps/demo/.next/static"
        copied_static.mkdir(parents=True)
        (copied_static / "app.js").write_text("old")
        (app / "public/logo.svg").write_text("<svg/>")
        (app / ".next/standalone/.env").write_text("SECRET=fixture")
        out = self.root / "artifacts"
        package(self.root, service, "preview", "b" * 40, out)
        with tarfile.open(out / "release.tar") as archive:
            contents = archive.getnames()
            self.assertIn("apps/demo/public/logo.svg", contents)
            static_path = "apps/demo/.next/static/app.js"
            self.assertEqual(contents.count(static_path), 1)
            static = archive.extractfile(static_path)
            assert static is not None
            self.assertEqual(static.read(), b"export {}")
            self.assertIn("apps/demo/server.js", contents)
            self.assertNotIn(".env", contents)
            loader = archive.extractfile("entry.mjs")
            assert loader is not None
            self.assertIn(b"./apps/demo/server.js", loader.read())

    def test_node_lookup_keeps_the_dependency_links_instead_of_copying_the_target(self):
        service: Site = {
            **self.service,
            "runtime": "node",
            "build": {"type": "workspace-node", "directory": ".", "package": "demo"},
        }
        source = self.root / "prepared"
        dependencies = source / "node_modules"
        module = dependencies / ".pnpm/demo/node_modules/demo"
        module.mkdir(parents=True)
        (source / "dist").mkdir()
        (source / "dist/index.js").write_text("import 'demo'")
        (module / "index.js").write_text("export {}")
        try:
            (dependencies / "demo").symlink_to(module, target_is_directory=True)
        except OSError:
            self.skipTest("Local filesystem cannot create Unix-style symbolic links")
        out = self.root / "artifacts"
        package(self.root, service, "preview", "a" * 40, out, source)
        with tarfile.open(out / "release.tar") as archive:
            link = archive.getmember("node_modules/demo")
            self.assertTrue(link.issym())
            self.assertEqual(link.linkname, ".pnpm/demo/node_modules/demo")


if __name__ == "__main__":
    unittest.main()
