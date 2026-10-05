import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, "dist"), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: { server: "src/stdio.mjs", core: "src/core.mjs", http: "src/http.mjs" },
  outdir: "dist",
  bundle: true,
  splitting: true,
  outExtension: { ".js": ".mjs" },
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning",
});
