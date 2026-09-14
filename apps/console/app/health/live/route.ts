export function GET() {
  return Response.json(
    { status: 'live', service: 'console' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
