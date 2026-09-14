export function GET() {
  const ready = Boolean(
    process.env.AUTH_DATABASE_URL && process.env.BETTER_AUTH_SECRET,
  );
  return Response.json(
    { status: ready ? "ready" : "not_ready", service: "auth" },
    { status: ready ? 200 : 503 },
  );
}
