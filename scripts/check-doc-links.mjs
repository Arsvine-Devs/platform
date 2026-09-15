import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? process.cwd());
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".vercel",
  "dist",
  "node_modules",
  "output",
  ".playwright-cli",
]);

async function collectMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(
          ...(await collectMarkdownFiles(path.join(directory, entry.name))),
        );
      }
      continue;
    }
    if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

function isExternalTarget(target) {
  return (
    /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target) || target.startsWith("/")
  );
}

function normalizeTarget(rawTarget) {
  const target = rawTarget.trim();
  if (!target || isExternalTarget(target)) return null;

  const withoutAnchor = target.split("#", 1)[0].split("?", 1)[0];
  if (!withoutAnchor) return null;

  try {
    return decodeURIComponent(withoutAnchor);
  } catch {
    return withoutAnchor;
  }
}

function localTargets(source) {
  const targets = [];
  const patterns = [
    /\]\(\s*(?:<([^>]+)>|([^\s)]+))/g,
    /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const rawTarget = match[1] ?? match[2];
      const target = normalizeTarget(rawTarget);
      if (target) targets.push({ offset: match.index ?? 0, target });
    }
  }

  return targets;
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function isInsideRoot(candidate) {
  const rootWithSeparator = root.endsWith(path.sep)
    ? root
    : `${root}${path.sep}`;
  return candidate === root || candidate.startsWith(rootWithSeparator);
}

async function checkFile(file) {
  const source = await readFile(file, "utf8");
  const errors = [];
  const seen = new Set();

  for (const { offset, target } of localTargets(source)) {
    const identity = `${offset}:${target}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const candidate = path.resolve(path.dirname(file), target);
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    const location = `${relative}:${lineNumber(source, offset)}`;
    if (!isInsideRoot(candidate)) {
      errors.push(`${location} points outside the repository: ${target}`);
      continue;
    }

    try {
      await access(candidate);
    } catch {
      errors.push(`${location} points to a missing path: ${target}`);
    }
  }

  return errors;
}

async function checkRequiredEntrypoints() {
  const required = [
    "README.md",
    "INDEX.md",
    "AGENTS.md",
    "docs/README.md",
    "docs/INDEX.md",
    "docs/AGENTS.md",
  ];
  const scopes = ["apps", "packages"];
  for (const parent of scopes) {
    const entries = await readdir(path.join(root, parent), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        required.push(
          `${parent}/${entry.name}/README.md`,
          `${parent}/${entry.name}/AGENTS.md`,
        );
      }
    }
  }

  const errors = [];
  for (const relative of required) {
    try {
      await access(path.join(root, relative));
    } catch {
      errors.push(`required documentation entrypoint is missing: ${relative}`);
    }
  }
  return errors;
}

const files = await collectMarkdownFiles(root);
const fileErrors = (await Promise.all(files.map(checkFile))).flat();
const entrypointErrors = await checkRequiredEntrypoints();
const errors = [...fileErrors, ...entrypointErrors];

if (errors.length > 0) {
  console.error(`[docs:check] ${errors.length} issue(s) found:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `[docs:check] checked ${files.length} Markdown files and all service/package entrypoints`,
  );
}
