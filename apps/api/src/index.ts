import { readEnv } from "@arsvine/env";
import { loadProjectEnv } from "@arsvine/env/dotenv";

loadProjectEnv();

const { buildApiServer } = await import("./server.js");
const app = buildApiServer();
const port = Number(readEnv("PORT") ?? 3001);
const host = readEnv("HOST") ?? "0.0.0.0";

await app.listen({ port, host });
