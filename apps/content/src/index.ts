import { readEnv } from "@arsvine/env";
import { loadProjectEnv } from "@arsvine/env/dotenv";

loadProjectEnv();

const { buildContentServer } = await import("./server.js");
const app = buildContentServer();
const port = Number(readEnv("PORT") ?? 3002);
const host = readEnv("HOST") ?? "0.0.0.0";

await app.listen({ port, host });
