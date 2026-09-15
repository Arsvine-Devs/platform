import dotenv from "dotenv";
import path from "node:path";

const DEFAULT_FILES = [
  ".env.{mode}.local",
  ".env.local",
  ".env.{mode}",
  ".env",
];

export function loadProjectEnv({
  cwd = process.cwd(),
  mode = process.env.NODE_ENV,
} = {}) {
  const normalizedMode = mode === "production" ? "production" : "development";
  const loaded = [];

  for (const template of DEFAULT_FILES) {
    const fileName = template.replace("{mode}", normalizedMode);
    const result = dotenv.config({
      path: path.join(cwd, fileName),
      override: false,
      quiet: true,
    });
    if (!result.error) loaded.push(fileName);
  }

  return { loaded };
}
