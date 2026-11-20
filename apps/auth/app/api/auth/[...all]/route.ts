import { handleAuth } from "@/lib/auth";

export const runtime = "nodejs";

export const GET = handleAuth;
export const POST = handleAuth;
