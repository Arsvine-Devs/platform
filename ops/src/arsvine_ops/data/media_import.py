"""Build an inactive VPS data slot from exported Realm, Ripple, and Content files."""

import argparse
import html
import json
import re
import shutil
import stat
import subprocess
import tempfile
from collections.abc import Iterator, Set
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import NotRequired, TypedDict
from urllib.parse import quote, unquote, urlsplit, urlunsplit

OLD_HOST = "cdn.arsvine.com"
NEW_HOST = "arsvine.com"
REALM_POINTER = "realm/site-catalog/current.json"
CONTENT_POINTER = "realm-content/current.json"
SECTION_NAMES = ("audio", "collections", "home", "links", "static-assets", "works")
MEDIA_PREFIXES = ("realm/audio/", "realm/images/", "ripple/releases/", "shared/fonts/")
MUSIC_PREFIXES = ("realm/audio/", "ripple/releases/")
URL_FIELDS = frozenset(
    {
        "artwork",
        "artworkurl",
        "audiourl",
        "backgroundurl",
        "cover",
        "coverurl",
        "data-src",
        "href",
        "image",
        "imageurl",
        "poster",
        "publicurl",
        "src",
        "url",
        "videourl",
    }
)
FONT_CSS = "shared/fonts/google-fonts.css"
STAMP = re.compile(r"[0-9]{8}T[0-9]{6}Z\Z")
CSS_URL = re.compile(r"""url\(\s*(?P<quote>['"]?)(?P<url>[^\s'")]+)(?P=quote)\s*\)""")

# Use the exact Markdown/MDX tokenizer installed by Realm. Token offsets keep
# paragraphs, examples, code fences, spacing, and unrelated attributes intact.
MDX_LINK_TOKENS = r"""
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fromProject = createRequire(resolve('package.json'));
const fromRemote = createRequire(fromProject.resolve('next-mdx-remote'));
const fromMdx = createRequire(fromRemote.resolve('@mdx-js/mdx'));
const fromParse = createRequire(fromMdx.resolve('remark-parse'));
const fromMdast = createRequire(fromParse.resolve('mdast-util-from-markdown'));
const fromRemarkMdx = createRequire(fromMdx.resolve('remark-mdx'));
const { parse, postprocess, preprocess } = await import(pathToFileURL(fromMdast.resolve('micromark')));
const { mdxjs } = await import(pathToFileURL(fromRemarkMdx.resolve('micromark-extension-mdxjs')));
const documents = JSON.parse(readFileSync(0, 'utf8'));

const result = documents.map(({ location, source, isMdx }) => {
  const edits = [];
  try {
    const events = postprocess(parse({ extensions: isMdx ? [mdxjs()] : [] })
      .document().write(preprocess()(source, 'utf8', true)));
    let attribute = '';
    for (const [kind, token] of events) {
      if (kind !== 'enter') continue;
      const text = source.slice(token.start.offset, token.end.offset);
      if (/^mdxJsx(?:Flow|Text)TagAttributeName$/.test(token.type)) {
        attribute = text.toLowerCase();
      }
      const isLink = ['autolinkProtocol', 'definitionDestinationString', 'resourceDestinationString'].includes(token.type);
      const isAttribute = /^mdxJsx(?:Flow|Text)TagAttributeValueLiteralValue$/.test(token.type);
      if (isLink || isAttribute) {
        edits.push({
          start: Array.from(source.slice(0, token.start.offset)).length,
          end: Array.from(source.slice(0, token.end.offset)).length,
          attribute: isAttribute ? attribute : '',
          value: text,
        });
      }
    }
    return { edits };
  } catch (error) {
    return { error: 'Markup parsing failed: ' + location + ' at ' + (error.line ?? '?') + ':' + (error.column ?? '?') };
  }
});
process.stdout.write(JSON.stringify(result));
"""


class ImportProblem(ValueError):
    """Invalid data or an unsafe source layout."""


type JsonValue = None | bool | int | float | str | list[JsonValue] | JsonObject
type JsonObject = dict[str, JsonValue]


@dataclass(frozen=True)
class ImportInputs:
    public: Path
    catalog: Path
    content: Path
    ripple: Path
    slot: Path
    realm_repo: Path | None = None
    node: str = "node"


@dataclass(frozen=True)
class Markup:
    document: JsonObject
    field: str
    location: str
    source: str


class MarkupEdit(TypedDict):
    start: int
    end: int
    attribute: str
    value: str


class MarkupResult(TypedDict):
    edits: NotRequired[list[MarkupEdit]]
    error: NotRequired[str]


def checked_key(key: object) -> PurePosixPath:
    if not isinstance(key, str) or "\\" in key or ":" in key or "\0" in key:
        raise ImportProblem(f"Invalid relative file key: {key!r}")
    parts = key.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise ImportProblem(f"Invalid relative file key: {key!r}")
    return PurePosixPath(*parts)


def linked(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


def checked_path(root: Path, key: str) -> Path:
    relative = checked_key(key)
    current = root
    for part in relative.parts:
        current = current / part
        if linked(current):
            raise ImportProblem(f"Export contains a link: {key}")
    return current


def checked_file(root: Path, key: str) -> Path:
    file = checked_path(root, key)
    if not file.is_file() or not stat.S_ISREG(file.stat().st_mode):
        raise ImportProblem(f"Missing regular file: {key}")
    return file


def load_json(root: Path, key: str) -> JsonValue:
    file = checked_file(root, key)
    try:
        return json.loads(file.read_bytes())
    except (UnicodeError, ValueError) as error:
        raise ImportProblem(f"Invalid JSON: {key}") from error


def load_object(root: Path, key: str) -> JsonObject:
    value = load_json(root, key)
    if not isinstance(value, dict):
        raise ImportProblem(f"Expected a JSON object: {key}")
    return value


def version(value: object) -> str:
    if not isinstance(value, str) or not STAMP.fullmatch(value):
        raise ImportProblem("Invalid media version")
    return value


def url_label(value: str) -> str:
    try:
        location = urlsplit(value)
        return (location.hostname or "") + location.path
    except ValueError:
        return "(malformed URL)"


def checked_directory(root: Path, key: str) -> Path:
    directory = checked_path(root, key)
    if not directory.is_dir():
        raise ImportProblem(f"Missing export directory: {key}")
    return directory


def release_files(root: Path, directory: str) -> Iterator[str]:
    start = checked_directory(root, directory)
    for file in sorted(start.iterdir()):
        key = file.relative_to(root).as_posix()
        if linked(file):
            raise ImportProblem(f"Export contains a link: {key}")
        if file.is_dir():
            yield from release_files(root, key)
        elif file.is_file() and file.suffix == ".json":
            yield key
        else:
            raise ImportProblem(f"Unsupported release file: {key}")


def source_directory(path: Path) -> Path:
    if linked(path) or not path.is_dir():
        raise ImportProblem(f"Export root must be a directory: {path}")
    return path.resolve(strict=True)


class Slot:
    def __init__(self, public: Path) -> None:
        self.public = public
        self.files: dict[str, Path | bytes | JsonValue] = {}
        self.issues: list[str] = []
        self.markup: list[Markup] = []

    def add_media(
        self, key: str, location: str, *, prefixes: tuple[str, ...] = MEDIA_PREFIXES
    ) -> None:
        try:
            checked_key(key)
            if not key.startswith(prefixes):
                raise ImportProblem(f"Unrecognized public media key: {key}")
            path = checked_file(self.public, key)
            if path.stat().st_size == 0:
                raise ImportProblem(f"Empty media file: {key}")
            self.files.setdefault(f"media/public/{key}", path)
        except ImportProblem as error:
            self.issues.append(f"{location}: {error}")

    def media_url(
        self, value: str, location: str, *, prefixes: tuple[str, ...] = MEDIA_PREFIXES
    ) -> str:
        try:
            url = urlsplit(html.unescape(value))
            old = url.hostname == OLD_HOST
            canonical = url.path.startswith("/media/") and (
                url.hostname == NEW_HOST or not url.scheme and not url.netloc
            )
            if not old and not canonical:
                return value
            if url.scheme not in {"", "http", "https"} or url.username or url.password or url.port:
                raise ImportProblem(f"Invalid media URL: {value}")
            raw_key = url.path.removeprefix("/" if old else "/media/")
            parts = [unquote(part, errors="strict") for part in raw_key.split("/")]
            if any("/" in part for part in parts):
                raise ImportProblem(f"URL contains encoded path separator: {value}")
            key = checked_key("/".join(parts)).as_posix()
            self.add_media(key, location, prefixes=prefixes)
            if not old:
                return value
            query = "&".join(
                component
                for component in url.query.split("&")
                if not unquote(component.partition("=")[0]).startswith("eo-img.")
            )
            return urlunsplit(
                (
                    "https",
                    NEW_HOST,
                    "/media/" + quote(key, safe="/"),
                    query,
                    url.fragment,
                )
            )
        except (ValueError, UnicodeError):
            self.issues.append(f"{location}: unresolved media URL {url_label(value)}")
            return value

    def inspect(self, data: JsonValue, location: str, content_keys: Set[str] = frozenset()) -> None:
        if isinstance(data, list):
            for item in data:
                self.inspect(item, location, content_keys)
        if not isinstance(data, dict):
            return
        for field, value in data.items():
            if isinstance(value, (dict, list)):
                self.inspect(value, location, content_keys)
            elif isinstance(value, str):
                if field == "objectKey":
                    self.add_media(value, location)
                elif field in {"key", "path", "index", "manifest"} and value.startswith(
                    "realm-content/"
                ):
                    if value not in content_keys:
                        self.issues.append(f"{location}: missing release reference {value}")
                elif field.lower() in URL_FIELDS:
                    data[field] = self.media_url(value, location)
                elif field == "bodyMdx" or field == "content" and "/tweets/" in location:
                    self.markup.append(Markup(data, field, location, value))

    def rewrite_markup(self, realm_repo: Path | None, node: str) -> None:
        if not self.markup:
            return
        if realm_repo is None:
            raise ImportProblem(
                "Provide --realm-repo with installed dependencies to parse exported markup"
            )
        documents = [
            {
                "location": markup.location,
                "source": markup.source,
                "isMdx": markup.field == "bodyMdx",
            }
            for markup in self.markup
        ]
        try:
            result = subprocess.run(
                [node, "--input-type=module", "--eval", MDX_LINK_TOKENS],
                cwd=realm_repo,
                input=json.dumps(documents),
                capture_output=True,
                encoding="utf-8",
                timeout=120,
                check=True,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise ImportProblem(
                "Realm's Markdown tokenizer could not run. Install Realm dependencies first."
            ) from error
        parsed: list[MarkupResult] = json.loads(result.stdout)
        for markup, entry in zip(self.markup, parsed, strict=True):
            if error := entry.get("error"):
                self.issues.append(error)
                continue
            source = markup.source
            for edit in reversed(entry.get("edits", [])):
                attribute = edit["attribute"]
                if attribute and attribute not in URL_FIELDS:
                    continue
                value = self.media_url(edit["value"], f"{markup.location}:{markup.field}")
                start, end = edit["start"], edit["end"]
                source = source[:start] + value + source[end:]
            markup.document[markup.field] = source

    def rewrite_fonts(self) -> None:
        stylesheet = checked_file(self.public, FONT_CSS).read_text(encoding="utf-8")

        def update(match: re.Match[str]) -> str:
            value = match["url"]
            parsed = urlsplit(value)
            if parsed.scheme or parsed.netloc:
                mapped = self.media_url(value, FONT_CSS, prefixes=("shared/fonts/",))
                url = urlsplit(mapped)
                if url.hostname != NEW_HOST or not url.path.startswith("/media/shared/fonts/"):
                    self.issues.append(f"{FONT_CSS}: unresolved font URL {url_label(value)}")
                    return match[0]
                relative = "./" + url.path.removeprefix("/media/shared/fonts/")
            else:
                relative = value
                self.add_media(
                    "shared/fonts/" + unquote(parsed.path.removeprefix("./")),
                    FONT_CSS,
                    prefixes=("shared/fonts/",),
                )
            return (
                match[0][: match.start("url") - match.start()]
                + relative
                + match[0][match.end("url") - match.start() :]
            )

        rewritten, count = CSS_URL.subn(update, stylesheet)
        if not count:
            self.issues.append(f"{FONT_CSS}: no font source URLs found")
        self.files[f"media/public/{FONT_CSS}"] = rewritten.encode("utf-8")

    def require_valid(self) -> None:
        if self.issues:
            raise ImportProblem("\n".join(sorted(set(self.issues))))

    def write(self, output: Path) -> None:
        self.require_valid()
        if output.exists() or linked(output):
            raise ImportProblem(f"Stage slot already exists: {output}")
        staging = Path(tempfile.mkdtemp(prefix=".arsvine-import-", dir=output.parent))
        try:
            for key, value in sorted(self.files.items()):
                target = staging / checked_key(key)
                target.parent.mkdir(parents=True, exist_ok=True)
                if isinstance(value, Path):
                    shutil.copyfile(value, target)
                elif isinstance(value, bytes):
                    target.write_bytes(value)
                else:
                    target.write_text(
                        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8",
                    )
            if output.exists() or linked(output):
                raise ImportProblem(f"Stage slot already exists: {output}")
            staging.rename(output)
        finally:
            if staging.exists():
                shutil.rmtree(staging)


def add_realm(plan: Slot, catalog: Path) -> None:
    pointer = load_object(plan.public, REALM_POINTER)
    release = version(pointer["version"])
    private_pointer = checked_path(catalog, "realm/catalog/current.json")
    if private_pointer.exists():
        existing = load_object(catalog, "realm/catalog/current.json")
        if version(existing["version"]) != release:
            raise ImportProblem("Realm public and private exports have different active versions")
    public_key = f"realm/site-catalog/versions/{release}/assets.json"
    manifest = load_object(plan.public, public_key)
    if manifest["version"] != release or not isinstance(manifest["assets"], dict):
        raise ImportProblem("Invalid Realm public manifest")
    plan.inspect(manifest, public_key)
    plan.files[f"media/public/{public_key}"] = manifest
    plan.files[f"media/public/{REALM_POINTER}"] = {"version": release}
    for section in SECTION_NAMES:
        key = f"realm/catalog/versions/{release}/{section}.json"
        document = load_json(catalog, key)
        if section == "static-assets":
            if not isinstance(document, dict) or not isinstance(document.get("assets"), dict):
                raise ImportProblem(f"Invalid asset catalog section: {key}")
        elif section == "collections":
            if not isinstance(document, dict) or not isinstance(document.get("collections"), list):
                raise ImportProblem(f"Invalid asset catalog section: {key}")
        elif not isinstance(document, list) and not (
            isinstance(document, dict) and isinstance(document.get("items"), list)
        ):
            raise ImportProblem(f"Invalid asset catalog section: {key}")
        plan.inspect(document, key)
        plan.files[f"media/private/{key}"] = document


def add_content(plan: Slot, content: Path) -> None:
    pointer = load_object(content, CONTENT_POINTER)
    release = checked_key(pointer["releaseId"])
    if len(release.parts) != 1:
        raise ImportProblem("Content pointer contains an invalid release ID")
    prefix = f"realm-content/releases/{release}"
    manifest_key = f"{prefix}/manifest.json"
    if (
        pointer.get("schemaVersion") != 1
        or pointer["manifest"] != manifest_key
        or not isinstance(pointer.get("publishedAt"), str)
        or not pointer["publishedAt"]
    ):
        raise ImportProblem("Content pointer does not identify the current versioned manifest")
    manifest = load_object(content, manifest_key)
    if manifest.get("schemaVersion") != 1 or manifest.get("releaseId") != str(release):
        raise ImportProblem("Content manifest does not match its release pointer")
    release_keys = frozenset(release_files(content, prefix))
    for key in release_keys:
        document = manifest if key == manifest_key else load_json(content, key)
        plan.inspect(document, key, release_keys)
        plan.files[f"content/{key}"] = document
    plan.files[f"content/{CONTENT_POINTER}"] = pointer


def add_ripple(plan: Slot, file: Path) -> None:
    source = load_object(file.parent, file.name)
    version(source["version"])
    version(source["sourceCatalogVersion"])
    tracks = source["tracks"]
    if not isinstance(tracks, list) or not 1 <= len(tracks) <= 100:
        raise ImportProblem("Ripple catalog has an invalid track count")
    filtered: list[JsonValue] = []
    ids: set[str] = set()
    for track in tracks:
        if not isinstance(track, dict):
            raise ImportProblem("Ripple catalog contains an invalid track")
        track_id = track["id"]
        if (
            not isinstance(track_id, str)
            or not re.fullmatch(r"[a-z0-9-]{1,100}", track_id)
            or track_id in ids
        ):
            raise ImportProblem("Ripple catalog has an invalid or duplicate track ID")
        ids.add(track_id)
        public_track: JsonObject = {"id": track_id}
        for field in ("title", "artist", "url", "artworkUrl"):
            value = track.get(field)
            if field == "artworkUrl" and value is None:
                continue
            if not isinstance(value, str) or not value.strip() or len(value) > 400:
                raise ImportProblem(f"Invalid Ripple track field: {track_id}.{field}")
            if field.endswith("Url") or field == "url":
                value = plan.media_url(
                    value, f"Ripple track {track_id}.{field}", prefixes=MUSIC_PREFIXES
                )
                target = urlsplit(value)
                if (
                    (target.scheme, target.netloc) != ("https", NEW_HOST)
                    or not target.path.removeprefix("/media/").startswith(MUSIC_PREFIXES)
                    or not target.path.startswith("/media/")
                    or target.query
                    or target.fragment
                ):
                    plan.issues.append(
                        f"Ripple track {track_id}.{field}: unresolved media URL {url_label(value)}"
                    )
            public_track[field] = value
        filtered.append(public_track)
    plan.files["media/public/ripple/music.json"] = {
        "version": source["version"],
        "sourceCatalogVersion": source["sourceCatalogVersion"],
        "tracks": filtered,
    }


def build_slot(args: ImportInputs) -> int:
    public = source_directory(args.public)
    catalog = source_directory(args.catalog)
    content = source_directory(args.content)
    output = source_directory(args.slot.parent) / args.slot.name
    for root in (public, catalog, content):
        if output.resolve().is_relative_to(root):
            raise ImportProblem("The new stage slot must be outside every source export")
    plan = Slot(public)
    add_realm(plan, catalog)
    add_content(plan, content)
    add_ripple(plan, args.ripple)
    plan.rewrite_fonts()
    plan.require_valid()
    plan.rewrite_markup(args.realm_repo, args.node)
    plan.write(output)
    return len(plan.files)


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--public", required=True, type=Path, help="Public media export root")
    parser.add_argument(
        "--catalog", required=True, type=Path, help="Private Realm catalog export root"
    )
    parser.add_argument(
        "--content",
        required=True,
        type=Path,
        help="Current published Content export root",
    )
    parser.add_argument("--ripple", required=True, type=Path, help="Published Ripple music JSON")
    parser.add_argument("--slot", required=True, type=Path, help="New inactive directory to stage")
    parser.add_argument(
        "--realm-repo", type=Path, help="Realm checkout with dependencies installed"
    )
    parser.add_argument("--node", default="node", help="Node executable for markup parsing")


def command(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    try:
        inputs = ImportInputs(
            args.public,
            args.catalog,
            args.content,
            args.ripple,
            args.slot,
            args.realm_repo,
            args.node,
        )
        count = build_slot(inputs)
    except (ImportProblem, OSError, KeyError, AttributeError, TypeError) as error:
        parser.exit(1, f"Import failed: {error}\n")
    print(f"Staged {count} files in {args.slot}")
