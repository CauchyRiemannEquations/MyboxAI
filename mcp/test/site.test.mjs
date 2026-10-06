import test from "node:test";
import assert from "node:assert/strict";
import { toolDefinitions, executeTool } from "../dist/site_tools.mjs";
import { handleMcp } from "../dist/site_mcp.mjs";
import { MyboxClient } from "../dist/core.mjs";

test("legacy Site exposes the same cloud management schemas and forwards authenticated operations", async () => {
  assert.equal(toolDefinitions.length, 22);
  assert(!toolDefinitions.some(tool => tool.name === "upload_file" || tool.name === "download_file"));
  const writes = toolDefinitions.filter(tool => !tool.annotations.readOnlyHint);
  assert(writes.some(tool => tool.name === "upload_text")); assert(writes.some(tool => tool.name === "empty_trash"));
  const calls = [];
  const client = new MyboxClient("mbx_pat_synthetic-site-test", async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ resourceId: "new-folder", name: "생성 폴더" }, { status: 201 }); });
  const result = await executeTool("create_folder", { name: "생성 폴더" }, {}, "alice", "https://mybox.example", client);
  assert.equal(result.resourceId, "new-folder"); assert.equal(calls[0].init.method, "POST"); assert.equal(JSON.parse(calls[0].init.body).folderName, "생성 폴더");
  await assert.rejects(executeTool("empty_trash", {}, {}, "alice", "https://mybox.example", client), error => error.code === "INVALID_ARGUMENTS");
  assert.equal(calls.length, 1);
});

test("Site MCP still rejects anonymous writes and cross-origin requests before cloud changes", async () => {
  const request = origin => new Request("https://mybox.example/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_folder", arguments: { name: "must-not-create" } } }) });
  assert.equal((await handleMcp(request(), {})).status, 401);
  assert.equal((await handleMcp(request("https://evil.example"), {})).status, 403);
});
