import type { IncomingMessage, ServerResponse } from "node:http";

import { buildApiServer } from "../src/server.js";

type ApiServer = ReturnType<typeof buildApiServer>;

let app: ApiServer | undefined;
let readyPromise: Promise<void> | undefined;

function getApp() {
  if (!app) app = buildApiServer();
  readyPromise ??= Promise.resolve(app.ready()).then(() => undefined);
  return { app, ready: readyPromise };
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const current = getApp();
  await current.ready;
  const requestUrl = request.url ?? "/";
  if (requestUrl === "/api" || requestUrl.startsWith("/api/")) {
    request.url = requestUrl.slice(4) || "/";
  }
  current.app.server.emit("request", request, response);
}
