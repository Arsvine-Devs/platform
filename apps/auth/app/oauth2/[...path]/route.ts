import { handleAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toInternalRequest(request: Request) {
  const url = new URL(request.url);
  url.pathname = `/api/auth${url.pathname}`;
  return new Request(url, request);
}

export function GET(request: Request) {
  return handleAuth(toInternalRequest(request));
}

export function POST(request: Request) {
  return handleAuth(toInternalRequest(request));
}
