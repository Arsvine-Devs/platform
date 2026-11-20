import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { readEnv } from "@arsvine/env";

export function readObjectStorageConfig(env: NodeJS.ProcessEnv = process.env) {
  const root = readEnv("CONTENT_STORAGE_ROOT", env);
  return root && isAbsolute(root) ? { root } : null;
}

function isError(error: unknown, code: string) {
  return (error as NodeJS.ErrnoException | null)?.code === code;
}

async function requireLocalEntry(path: string) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
    throw new Error("Invalid storage entry");
  }
  return info;
}

export function createObjectStorage(config: { root: string }) {
  const root = resolve(config.root);

  async function objectPath(key: string, createParents: boolean) {
    const segments = key.split("/");
    if (
      segments.some((segment) => !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(segment))
    ) {
      throw new Error("Invalid storage key");
    }
    await requireLocalEntry(root);
    let directory = root;
    for (const part of segments.slice(0, -1)) {
      directory = join(directory, part);
      if (createParents) {
        await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
          if (!isError(error, "EEXIST")) throw error;
        });
      }
      if (!(await requireLocalEntry(directory)).isDirectory()) {
        throw new Error("Invalid storage directory");
      }
    }
    return join(directory, segments.at(-1)!);
  }

  return {
    async getText(key: string) {
      const path = await objectPath(key, false);
      if (!(await requireLocalEntry(path)).isFile())
        throw new Error("Invalid storage object");
      return readFile(path, "utf8");
    },
    async putText(key: string, body: string, { replace = false } = {}) {
      const destination = await objectPath(key, true);
      const temporary = join(dirname(destination), `.write-${randomUUID()}`);
      const file = await open(temporary, "wx", 0o600);
      try {
        try {
          await file.writeFile(body, "utf8");
          await file.sync();
        } finally {
          await file.close();
        }
        if (replace) {
          await rename(temporary, destination);
          return;
        }
        try {
          await link(temporary, destination);
        } catch (error) {
          if (!isError(error, "EEXIST")) throw error;
          if (!(await requireLocalEntry(destination)).isFile()) throw error;
          if ((await readFile(destination, "utf8")) !== body) {
            throw new Error("Published object is immutable");
          }
        }
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
