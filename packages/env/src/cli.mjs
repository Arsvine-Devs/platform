import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

const root = process.cwd();
const contractPath = path.join(root, "config", "env-contracts.json");

function parseArgs(argv) {
  const commandIndex = argv[2] === "--" ? 3 : 2;
  const command = argv[commandIndex] ?? "help";
  const flags = new Map();
  for (let index = commandIndex + 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--"))
      throw new Error(`Unexpected argument: ${argument}`);
    const separator = argument.indexOf("=");
    const key =
      separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    const inlineValue =
      separator === -1 ? undefined : argument.slice(separator + 1);
    const next = argv[index + 1];
    let value = inlineValue;
    if (value === undefined && next && !next.startsWith("--")) {
      value = next;
      index += 1;
    }
    value ??= "true";
    const values = flags.get(key) ?? [];
    values.push(value);
    flags.set(key, values);
  }
  return { command, flags };
}

function values(flags, name) {
  return (flags.get(name) ?? []).flatMap((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function one(flags, name) {
  return values(flags, name)[0];
}

function isFlag(flags, name) {
  return flags.has(name) && values(flags, name).at(-1) === "true";
}

function hasValue(environment, key) {
  return (
    typeof environment?.[key] === "string" && environment[key].trim() !== ""
  );
}

function withinRoot(relativePath) {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function loadContract() {
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  if (contract.version !== 1 || !Array.isArray(contract.entries))
    throw new Error("Invalid config/env-contracts.json");
  return contract;
}

function filteredEntries(contract, flags) {
  const services = values(flags, "service");
  return contract.entries.filter(
    (entry) =>
      services.length === 0 ||
      services.some((service) => entry.services.includes(service)),
  );
}

async function readLocalValues(file) {
  try {
    return dotenv.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return {};
    throw error;
  }
}

async function localValuesByExample(contract) {
  const result = new Map();
  const files = new Set(
    contract.entries.flatMap((entry) => entry.exampleFiles),
  );
  for (const exampleFile of files) {
    const localFile = path.join(root, path.dirname(exampleFile), ".env.local");
    result.set(exampleFile, await readLocalValues(localFile));
  }
  return result;
}

function printHelp() {
  console.log(`Environment provider CLI

Commands:
  envctl stats [--service api|auth|content|console]
  envctl query --key NAME
  envctl prune --file PATH [--service api|auth|content|console]
  envctl register --key NAME --service SERVICE --description TEXT --format TEXT
    --used-by PATH [--example-file PATH] [--requiredness required|optional|conditional]
    [--scope local,preview,production] [--example VALUE] [--secret] [--commented]
    [--source-only]

Queries never print environment values. Registration updates the contract and,
when --example-file is supplied, appends a documented entry to that example file.`);
}

async function stats(contract, flags) {
  const entries = filteredEntries(contract, flags);
  const localValues = await localValuesByExample(contract);
  const counts = {
    registered: entries.length,
    required: entries.filter((entry) => entry.requiredness === "required")
      .length,
    conditional: entries.filter((entry) => entry.requiredness === "conditional")
      .length,
    optional: entries.filter((entry) => entry.requiredness === "optional")
      .length,
    secret: entries.filter((entry) => entry.secret).length,
    sourceOnly: entries.filter((entry) => entry.exampleFiles.length === 0)
      .length,
  };
  console.log(
    `[env] registered=${counts.registered} required=${counts.required} conditional=${counts.conditional} optional=${counts.optional} secret=${counts.secret} source-only=${counts.sourceOnly}`,
  );

  const services = [
    ...new Set(entries.flatMap((entry) => entry.services)),
  ].sort();
  for (const service of services) {
    const owned = entries.filter((entry) => entry.services.includes(service));
    const configured = owned.filter((entry) =>
      entry.exampleFiles.some((file) =>
        hasValue(localValues.get(file), entry.key),
      ),
    );
    console.log(
      `[env] ${service}: ${owned.length} registered, ${configured.length} configured in adjacent .env.local files`,
    );
  }
}

async function query(contract, flags) {
  const key = one(flags, "key");
  if (!key) throw new Error("query requires --key NAME");
  const entry = contract.entries.find((item) => item.key === key);
  if (!entry) throw new Error(`Unregistered environment key: ${key}`);
  const localValues = await localValuesByExample(contract);
  const configured = entry.exampleFiles.filter((file) =>
    hasValue(localValues.get(file), key),
  );
  console.log(`key: ${entry.key}`);
  console.log(`services: ${entry.services.join(", ")}`);
  console.log(`requiredness: ${entry.requiredness}`);
  console.log(`format: ${entry.format}`);
  console.log(`secret: ${entry.secret ? "yes" : "no"}`);
  console.log(`scopes: ${entry.scopes.join(", ")}`);
  console.log(`description: ${entry.description}`);
  console.log(`failure behavior: ${entry.failureBehavior}`);
  console.log(`consumers: ${entry.usedBy.join(", ")}`);
  console.log(
    `example files: ${entry.exampleFiles.length ? entry.exampleFiles.join(", ") : "(source-only)"}`,
  );
  console.log(
    `local status: ${configured.length ? `set in ${configured.join(", ")}` : "unset"}`,
  );
}

async function prune(contract, flags) {
  const file = one(flags, "file");
  if (!file) throw new Error("prune requires --file PATH");
  if (!withinRoot(file))
    throw new Error(`path escapes repository root: ${file}`);
  const allowed = new Set(
    filteredEntries(contract, flags).map((entry) => entry.key),
  );
  const absolute = path.resolve(root, file);
  const current = await readFile(absolute, "utf8");
  const removed = [];
  const kept = [];
  const output = current
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
      if (!match) return false;
      if (!allowed.has(match[1])) {
        removed.push(match[1]);
        return false;
      }
      kept.push(match[1]);
      return true;
    })
    .join("\n");
  await writeFile(absolute, `${output.trimEnd()}\n`, "utf8");
  console.log(
    `[env] pruned ${file}; removed=${[...new Set(removed)].sort().join(", ") || "(none)"}; kept=${[...new Set(kept)].sort().join(", ") || "(none)"}`,
  );
}

async function register(contract, flags) {
  const key = one(flags, "key");
  const services = values(flags, "service");
  const description = one(flags, "description");
  const format = one(flags, "format");
  const usedBy = values(flags, "used-by");
  const scopes = values(flags, "scope");
  const exampleFiles = values(flags, "example-file");
  const sourceOnly = isFlag(flags, "source-only");
  const requiredness = one(flags, "requiredness") ?? "optional";
  const example = one(flags, "example");

  if (!key || !/^[A-Z][A-Z0-9_]*$/.test(key))
    throw new Error("--key must be an uppercase environment name");
  if (contract.entries.some((entry) => entry.key === key))
    throw new Error(`Already registered: ${key}`);
  if (services.length === 0)
    throw new Error("register requires at least one --service");
  if (!description || !format || usedBy.length === 0)
    throw new Error("register requires --description, --format, and --used-by");
  if (!["required", "optional", "conditional"].includes(requiredness))
    throw new Error("invalid --requiredness");
  if (scopes.length === 0) throw new Error("register requires --scope");
  if (sourceOnly && exampleFiles.length > 0)
    throw new Error("--source-only cannot have --example-file");
  if (!sourceOnly && exampleFiles.length === 0)
    throw new Error(
      "register requires --example-file unless --source-only is used",
    );
  if (!sourceOnly && example === undefined)
    throw new Error(
      "register requires a safe --example value for example files",
    );

  for (const file of [...exampleFiles, ...usedBy]) {
    if (!withinRoot(file))
      throw new Error(`path escapes repository root: ${file}`);
  }
  for (const file of exampleFiles) {
    await access(path.resolve(root, file)).catch(() => {
      throw new Error(`missing example file: ${file}`);
    });
  }
  for (const file of usedBy) {
    await access(path.resolve(root, file)).catch(() => {
      throw new Error(`missing consumer: ${file}`);
    });
  }

  const entry = {
    key,
    services,
    exampleFiles,
    requiredness,
    secret: isFlag(flags, "secret"),
    format,
    ...(example === undefined ? {} : { example }),
    scopes,
    usedBy,
    description,
    failureBehavior:
      one(flags, "failure") ??
      "The consuming service reports the configuration failure.",
  };
  contract.entries.push(entry);
  await writeFile(
    contractPath,
    `${JSON.stringify(contract, null, 2)}\n`,
    "utf8",
  );

  if (!sourceOnly) {
    const block = [
      `# ${key}: ${description}`,
      `# Format: ${format}`,
      `# Scope: ${scopes.join(", ")}`,
      `# Secret: ${entry.secret ? "yes" : "no"}`,
      `${isFlag(flags, "commented") ? "# " : ""}${key}=${example}`,
      "",
    ].join("\n");
    for (const file of exampleFiles) {
      const absolute = path.resolve(root, file);
      const current = await readFile(absolute, "utf8");
      await writeFile(absolute, `${current.trimEnd()}\n\n${block}`, "utf8");
    }
  }
  console.log(
    `[env] registered ${key} for ${services.join(", ")}; secret=${entry.secret ? "yes" : "no"}; example-files=${exampleFiles.length}`,
  );
}

async function main() {
  const { command, flags } = parseArgs(process.argv);
  const contract = await loadContract();
  if (command === "stats") return stats(contract, flags);
  if (command === "query") return query(contract, flags);
  if (command === "prune") return prune(contract, flags);
  if (command === "register") return register(contract, flags);
  printHelp();
}

main().catch((error) => {
  console.error(
    `[env] FAILED: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
});
