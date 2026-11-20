import json
import os
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory

from arsvine_ops.data.media_import import ImportInputs, ImportProblem, build_slot

VERSION = "20261120T000000Z"
OLD = "https://cdn.arsvine.com"
NEW = "https://arsvine.com/media"
IMAGE = "realm/images/gallery/example.png"
AUDIO = "realm/audio/example.m4a"
FONT = "shared/fonts/family/one.woff2"
CONTENT = "realm-content/releases/FIXTURE"
VARIANT = f"{CONTENT}/posts/example/en.json"


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, bytes):
        path.write_bytes(data)
    else:
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


class MediaImportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.public = root / "public"
        self.catalog = root / "catalog"
        self.content = root / "content"
        self.ripple = root / "music.json"
        self.output = root / "new-slot"
        default_realm = Path(__file__).resolve().parents[3] / "realm"
        self.args = ImportInputs(
            public=self.public,
            catalog=self.catalog,
            content=self.content,
            ripple=self.ripple,
            slot=self.output,
            realm_repo=Path(os.environ.get("ARSVINE_OPS_TEST_REALM_REPO", str(default_realm))),
            node="node",
        )
        save(self.public / "realm/site-catalog/current.json", {"version": VERSION})
        save(
            self.public / f"realm/site-catalog/versions/{VERSION}/assets.json",
            {
                "version": VERSION,
                "assets": {"image": {"objectKey": IMAGE}},
            },
        )
        save(self.public / IMAGE, b"fixture-image")
        save(self.public / AUDIO, b"fixture-song")
        save(self.public / FONT, b"fixture-font")
        save(
            self.public / "shared/fonts/google-fonts.css",
            f"@font-face {{ src: url({OLD}/{FONT}); }}".encode(),
        )
        for section in (
            "home",
            "works",
            "links",
            "audio",
            "static-assets",
            "collections",
        ):
            document = {
                "static-assets": {"assets": {}},
                "collections": {"collections": []},
            }.get(section, [])
            save(
                self.catalog / f"realm/catalog/versions/{VERSION}/{section}.json",
                document,
            )
        save(
            self.ripple,
            {
                "version": VERSION,
                "sourceCatalogVersion": VERSION,
                "tracks": [
                    {
                        "id": "example",
                        "title": "Example",
                        "artist": "Artist",
                        "url": f"{OLD}/{AUDIO}",
                    }
                ],
            },
        )
        save(
            self.content / "realm-content/current.json",
            {
                "schemaVersion": 1,
                "releaseId": "FIXTURE",
                "manifest": f"{CONTENT}/manifest.json",
                "publishedAt": "2026-11-20T00:00:00.000Z",
            },
        )
        save(
            self.content / f"{CONTENT}/manifest.json",
            {
                "schemaVersion": 1,
                "releaseId": "FIXTURE",
                "posts": {"index": f"{CONTENT}/posts/index.json"},
            },
        )
        save(
            self.content / f"{CONTENT}/posts/index.json",
            {
                "posts": [{"slug": "example", "variants": {"en": {"key": VARIANT}}}],
            },
        )
        save(
            self.content / VARIANT,
            {
                "bodyMdx": (
                    f"🌙 Keep  two spaces and the example \x60{OLD}/{IMAGE}\x60.\n\n"
                    f"![Photo]({OLD}/{IMAGE}?eo-img.resize=w/320)\n\n"
                    f'<img src="{OLD}/{IMAGE}" alt="Caption unchanged" />\n'
                )
            },
        )

    def test_stages_media_and_rewrites_only_markup_destinations(self):
        realm = self.args.realm_repo
        if realm is None or not (realm / "node_modules/next-mdx-remote").exists():
            self.skipTest("The Markdown integration fixture requires an installed Realm checkout")
        build_slot(self.args)
        self.assertTrue((self.output / "media/public" / IMAGE).is_file())
        self.assertTrue((self.output / "media/public" / AUDIO).is_file())
        self.assertTrue(
            (self.output / "media/private/realm/catalog/versions" / VERSION / "audio.json").exists()
        )
        self.assertFalse((self.output / "media/public/realm/catalog").exists())
        playlist = json.loads((self.output / "media/public/ripple/music.json").read_text())
        self.assertEqual(playlist["tracks"][0]["url"], f"{NEW}/{AUDIO}")
        variant = json.loads((self.output / "content" / VARIANT).read_text(encoding="utf-8"))
        self.assertEqual(
            variant["bodyMdx"],
            (
                f"🌙 Keep  two spaces and the example \x60{OLD}/{IMAGE}\x60.\n\n"
                f"![Photo]({NEW}/{IMAGE})\n\n"
                f'<img src="{NEW}/{IMAGE}" alt="Caption unchanged" />\n'
            ),
        )
        css = (self.output / "media/public/shared/fonts/google-fonts.css").read_text()
        self.assertIn("url(./family/one.woff2)", css)

    def test_reports_missing_media_and_leaves_no_slot(self):
        (self.public / IMAGE).unlink()
        with self.assertRaisesRegex(
            ImportProblem, "Missing regular file: realm/images/gallery/example.png"
        ):
            build_slot(self.args)
        self.assertFalse(self.output.exists())

    def test_rejects_a_symlink_in_a_referenced_path(self):
        file = self.public / IMAGE
        original = file.parent / "elsewhere.png"
        file.rename(original)
        try:
            file.symlink_to(original)
        except OSError as error:
            self.skipTest(f"Symlink creation unavailable: {error}")
        with self.assertRaisesRegex(ImportProblem, "Export contains a link"):
            build_slot(self.args)
        self.assertFalse(self.output.exists())

    def test_reports_unrecognized_links_without_printing_url_credentials(self):
        save(
            self.content / VARIANT,
            {
                "url": "https://reader:secret@cdn.arsvine.com/private/file?token=secret",
            },
        )
        with self.assertRaises(ImportProblem) as result:
            build_slot(self.args)
        self.assertIn("cdn.arsvine.com/private/file", str(result.exception))
        self.assertNotIn("secret", str(result.exception))
        self.assertFalse(self.output.exists())

    def test_stages_structured_media_without_a_markup_toolchain(self) -> None:
        save(self.content / VARIANT, {"imageUrl": f"{OLD}/{IMAGE}", "title": "Original caption"})
        build_slot(replace(self.args, realm_repo=None))
        staged = json.loads((self.output / "content" / VARIANT).read_text(encoding="utf-8"))
        self.assertEqual(staged, {"imageUrl": f"{NEW}/{IMAGE}", "title": "Original caption"})


if __name__ == "__main__":
    unittest.main()
