import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createObjectStorage } from "./index.js";

test("a publication is immutable and its current pointer can advance", async () => {
  const root = await mkdtemp(join(tmpdir(), "arsvine-content-"));
  try {
    const storage = createObjectStorage({ root });
    const key = "realm-content/releases/release/manifest.json";
    await storage.putText(key, '{"release":"first"}');
    await storage.putText(key, '{"release":"first"}');
    await expect(storage.putText(key, '{"release":"second"}')).rejects.toThrow(
      "immutable",
    );
    await expect(storage.getText(key)).resolves.toBe('{"release":"first"}');
    const pointer = "realm-content/current.json";
    await storage.putText(pointer, '{"current":"first"}', { replace: true });
    await storage.putText(pointer, '{"current":"second"}', { replace: true });
    expect(await readFile(join(root, pointer), "utf8")).toBe(
      '{"current":"second"}',
    );
    await expect(storage.getText("../outside")).rejects.toThrow("Invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
