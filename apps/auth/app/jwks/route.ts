import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = toNextJsHandler(auth);

function toInternalRequest(request: Request) {
  const url = new URL(request.url);
  url.pathname = `/api/auth${url.pathname}`;
  return new Request(url, request);
}

export function GET(request: Request) {
  return handler.GET(toInternalRequest(request));
}
