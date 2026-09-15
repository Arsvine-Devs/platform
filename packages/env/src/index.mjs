export function readEnv(name, source = process.env) {
  const value = source[name];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function requiredEnv(name, source = process.env) {
  const value = readEnv(name, source);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function readEnvList(name, source = process.env) {
  const value = readEnv(name, source);
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}
