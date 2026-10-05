import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStdio } from "./server.mjs";
import { AppError } from "./core.mjs";
export { createServer, loadToken } from "./server.mjs";

// Keep the entrypoint guard here, outside modules shared by the HTTP build.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runStdio().catch(error => {
  process.stderr.write(`MyboxAI: ${error instanceof AppError ? error.message : "MCP 서버를 시작하지 못했습니다."}\n`);
  process.exitCode = 1;
});
