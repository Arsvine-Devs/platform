import { buildContentServer } from "./server.js";

const app = buildContentServer();
const port = Number(process.env.PORT ?? 3002);
const host = process.env.HOST ?? "0.0.0.0";

await app.listen({ port, host });
