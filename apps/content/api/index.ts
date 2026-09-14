import type { IncomingMessage, ServerResponse } from "node:http";

import { buildContentServer } from "../src/server.js";

type ContentServer = ReturnType<typeof buildContentServer>;

let app: ContentServer | undefined;
let readyPromise: Promise<void> | undefined;

function getApp() {
  if (!app) app = buildContentServer();
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
