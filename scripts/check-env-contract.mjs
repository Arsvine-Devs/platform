import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const contractPath = path.join(root, "config", "env-contracts.json");

function fail(message) {
  throw new Error(message);
}

function parseExample(content, file) {
  const keys = new Set();
  for (const [lineNumber, line] of content.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)\s*=/);
    if (!match) continue;
    const key = match[1];
    if (keys.has(key)) fail(`${file}:${lineNumber + 1} duplicates ${key}`);
    keys.add(key);
  }
  return keys;
}

async function main() {
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  if (contract.version !== 1 || !Array.isArray(contract.entries)) {
    fail("config/env-contracts.json must contain version 1 and entries");
  }

  const byKey = new Map();
  for (const entry of contract.entries) {
    if (
      !entry ||
      typeof entry.key !== "string" ||
      !/^[A-Z][A-Z0-9_]*$/.test(entry.key)
    ) {
      fail("every environment entry needs an uppercase key");
    }
    if (byKey.has(entry.key)) fail(`duplicate registered key: ${entry.key}`);
    if (!Array.isArray(entry.exampleFiles) || !Array.isArray(entry.usedBy)) {
      fail(`${entry.key} needs exampleFiles and usedBy arrays`);
    }
    if (
      !entry.description ||
      !entry.format ||
      !entry.requiredness ||
      !Array.isArray(entry.scopes)
    ) {
      fail(
        `${entry.key} is missing description, format, requiredness, or scopes`,
      );
    }
    byKey.set(entry.key, entry);
  }

  const files = new Map();
  for (const entry of contract.entries) {
    for (const file of entry.exampleFiles) {
      if (files.has(file)) continue;
      const absolute = path.resolve(root, file);
      await access(absolute).catch(() => fail(`missing example file: ${file}`));
      files.set(file, parseExample(await readFile(absolute, "utf8"), file));
    }
    for (const source of entry.usedBy) {
      const absolute = path.resolve(root, source);
      await access(absolute).catch(() =>
        fail(`${entry.key} references missing consumer: ${source}`),
      );
    }
  }

  for (const [file, keys] of files) {
    for (const key of keys) {
      const entry = byKey.get(key);
      if (!entry) fail(`${file} contains unregistered key: ${key}`);
      if (!entry.exampleFiles.includes(file)) {
        fail(
          `${key} is present in ${file} but does not register that example file`,
        );
      }
    }
  }

  for (const entry of contract.entries) {
    if (entry.exampleFiles.length === 0) continue;
    for (const file of entry.exampleFiles) {
      if (!files.get(file)?.has(entry.key))
        fail(`${entry.key} is missing from ${file}`);
    }
  }

  const sourceOnly = contract.entries.filter(
    (entry) => entry.exampleFiles.length === 0,
  ).length;
  console.log(
    `[env:check] verified ${contract.entries.length} registered keys across ${files.size} example files; ${sourceOnly} source-only provider inputs`,
  );
}

main().catch((error) => {
  console.error(
    `[env:check] FAILED: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
});
