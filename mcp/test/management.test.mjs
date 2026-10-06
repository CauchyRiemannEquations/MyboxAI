import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.mjs";
import { MyboxClient } from "../dist/core.mjs";

const PAT = "mbx_pat_synthetic-management-token";
const payload = result => JSON.parse(result.content.find(block => block.type === "text").text);
function fixture({ failUpload = false, offset = 0 } = {}) {
  const calls = [], files = new Map(), trash = new Map(); let sequence = 0;
  const client = new MyboxClient(PAT, async (raw, init = {}) => {
    const url = new URL(raw), method = init.method || "GET";
    calls.push({ url, init });
    if (url.hostname === "upload.mybox.naver.com") {
      assert.equal(init.headers?.Authorization, undefined); assert.equal(init.redirect, "error");
      assert(init.body instanceof FormData);
      if (failUpload) throw new Error("synthetic upload failure");
      const file = init.body.get("Filedata");
      assert(file instanceof Blob);
      const id = "file-" + ++sequence;
      files.set(id, { resourceId: id, name: file.name, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()), type: "file", parentId: "root" });
      return new Response("ok");
    }
    if (url.hostname === "download.mybox.naver.com") {
      assert.equal(init.headers?.Authorization, undefined);
      return new Response(files.get(url.pathname.slice(1)).bytes);
    }
    assert.equal(url.hostname, "open-api.mybox.naver.com"); assert.equal(init.headers.Authorization, `Bearer ${PAT}`);
    const body = init.body ? JSON.parse(init.body) : {}, id = decodeURIComponent(url.pathname.split("/")[4] || ""), item = files.get(id);
    if (url.pathname === "/v1/drive/storage") return Response.json(method === "PATCH" ? body : { maxFileBytes: 50 * 1024 ** 3, usedBytes: 0, quotaBytes: 50 * 1024 ** 3 });
    if (url.pathname === "/v1/drive/files") { assert.equal(body.isOverwrite, false); return Response.json({ uploadUrl: "https://upload.mybox.naver.com/upload?stoken=synthetic", offset }, { status: 201 }); }
    if (url.pathname === "/v1/drive/folders" && method === "POST") { const id = "folder-" + ++sequence; const entry = { resourceId: id, name: body.folderName, parentId: body.parentId || "root", type: "folder" }; files.set(id, entry); return Response.json(entry, { status: 201 }); }
    if (url.pathname.endsWith("/download")) return Response.json({ downloadUrl: `https://download.mybox.naver.com/${id}` });
    if (url.pathname.endsWith("/rename")) { item.name = body.name; return Response.json({ name: item.name }); }
    if (url.pathname.endsWith("/move")) { item.parentId = body.parentId; return new Response(null, { status: 200 }); }
    if (url.pathname.endsWith("/copy")) { const next = "copy-" + ++sequence; const entry = { ...item, resourceId: next, name: body.name || item.name, parentId: body.parentId || "root" }; files.set(next, entry); return Response.json(entry, { status: 201 }); }
    if (url.pathname.endsWith("/unfavorite") || url.pathname.endsWith("/favorite")) { item.isFavorite = url.pathname.endsWith("/favorite"); return Response.json({ resourceId: id, isFavorite: item.isFavorite }); }
    if (url.pathname.endsWith("/restore")) { const entry = trash.get(id); files.set(id, entry); trash.delete(id); return new Response(null); }
    if (url.pathname.startsWith("/v1/drive/trash")) {
      if (method === "DELETE") { if (id) trash.delete(id); else trash.clear(); return new Response(null, { status: 204 }); }
      return Response.json({ resources: [...trash.values()], responseMetaData: {} });
    }
    if (method === "DELETE") { files.delete(id); trash.set(id, item); return new Response(null, { status: 204 }); }
    if (url.pathname.includes("/search/") || url.pathname.endsWith("/resources")) return Response.json({ resources: [...files.values()].map(({ bytes, ...item }) => item), responseMetaData: {} });
    if (item) { const { bytes, ...meta } = item; return Response.json(meta); }
    return new Response(null, { status: 404 });
  });
  return { client, calls, files, trash };
}
async function mcp(client, task, options = {}) {
  const server = createServer({ client, ...options }), sdk = new Client({ name: "management-test", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(right); await sdk.connect(left);
  const call = async (name, args) => { const result = await sdk.callTool({ name, arguments: args }); assert(!result.isError, JSON.stringify(result)); return payload(result); };
  try { await task(call, sdk); } finally { await sdk.close(); await server.close(); }
}
async function temporary(task) { const root = await mkdtemp(path.join(tmpdir(), "mybox-management-")); try { await task(root); } finally { await rm(root, { recursive: true, force: true }); } }

test("MCP supports upload, create, rename, move, copy, favorites, trash, restore, and permanent deletion", async () => {
  const { client, files, trash, calls } = fixture();
  await mcp(client, async (call, sdk) => {
    const folder = await call("create_folder", { name: "학습 자료" });
    await call("upload_text", { file_name: "수업.txt", text: "수정한 수업 내용" });
    const file = [...files.values()].find(item => item.type === "file");
    assert.equal(new TextDecoder().decode(file.bytes), "수정한 수업 내용");
    await call("rename_resource", { id: file.resourceId, name: "새 수업.txt" });
    await call("move_resource", { id: file.resourceId, parent_id: folder.resourceId });
    assert.equal(files.get(file.resourceId).parentId, folder.resourceId);
    const copy = await call("copy_resource", { id: file.resourceId, name: "복사본.txt" });
    assert(files.has(copy.resourceId));
    await call("set_favorite", { id: file.resourceId, enabled: true }); assert.equal(file.isFavorite, true);
    await call("set_favorite", { id: file.resourceId, enabled: false }); assert.equal(file.isFavorite, false);
    await call("delete_resource", { id: file.resourceId }); assert(!files.has(file.resourceId)); assert(trash.has(file.resourceId));
    assert.equal((await call("list_trash", {})).resources.length, 1);
    await call("restore_resource", { id: file.resourceId }); assert(files.has(file.resourceId));
    await call("delete_resource", { id: file.resourceId });
    const before = calls.length;
    assert((await sdk.callTool({ name: "permanently_delete_resource", arguments: { id: file.resourceId } })).isError);
    assert.equal(calls.length, before);
    await call("permanently_delete_resource", { id: file.resourceId, confirm_permanent: true }); assert(!trash.has(file.resourceId));
    await call("delete_resource", { id: copy.resourceId });
    await call("empty_trash", { confirm_permanent: true }); assert.equal(trash.size, 0);
    assert.equal((await call("set_trash_auto_delete", { days: 15 })).trashAutoDeleteDays, 15);
    assert((await sdk.callTool({ name: "set_trash_auto_delete", arguments: { days: 7 } })).isError);
  });
});

test("search filters, folder path, paging and list sorting reach official API fields", async () => {
  const { client, calls } = fixture();
  await mcp(client, async call => {
    await call("search", { start_date: "2026-01-01T00:00:00+09:00", date_field: "modified" });
    await call("search_folders", { path: "/수업/", count: 200 });
    await call("list_files", { count: 1000, sort: "modifiedAt,desc" });
    await call("list_trash", { count: 1000, sort: "size,asc", cursor: "next" });
  });
  assert.equal(calls[0].url.searchParams.get("startDate"), "2026-01-01T00:00:00+09:00");
  assert.equal(calls[1].url.searchParams.get("path"), "/수업/");
  assert.equal(calls[2].url.searchParams.get("sort"), "modifiedAt,desc");
  assert.equal(calls[3].url.searchParams.get("cursor"), "next");
});

test("local file upload and raw download preserve bytes and refuse overwriting local files", async () => temporary(async root => {
  const { client, files } = fixture(); const data = Buffer.alloc(10 * 1024 * 1024, 123), source = path.join(root, "큰 원본.bin"), destination = path.join(root, "받은 파일.bin");
  await writeFile(source, data);
  await mcp(client, async (call, sdk) => {
    const result = await call("upload_file", { local_path: source }); assert.equal(result.bytes, data.length);
    const file = [...files.values()].find(item => item.type === "file");
    assert.equal((await call("download_file", { id: file.resourceId, local_path: destination })).bytes, data.length);
    assert.deepEqual(await readFile(destination), data);
    assert((await sdk.callTool({ name: "download_file", arguments: { id: file.resourceId, local_path: destination } })).isError);
    assert.deepEqual(await readFile(destination), data);
  });
}));

test("remote path access is disabled by default; configured transfer roots reject traversal", async () => temporary(async root => {
  const { client } = fixture(); await mkdir(path.join(root, "allowed")); await writeFile(path.join(root, "outside.txt"), "outside");
  await mcp(client, async (_call, sdk) => { assert(!(await sdk.listTools()).tools.some(tool => tool.name === "upload_file")); }, { localFiles: false });
  await mcp(client, async (_call, sdk) => {
    const result = await sdk.callTool({ name: "upload_file", arguments: { local_path: path.join(root, "outside.txt") } });
    assert.equal(payload(result).code, "TRANSFER_PATH_DENIED");
  }, { transferRoot: path.join(root, "allowed") });
}));

test("upload URL rejects external destinations and resumed uploads send only bytes after the offset", async () => {
  const unsafe = new MyboxClient(PAT, async () => Response.json({ uploadUrl: "https://evil.example/upload" }));
  await assert.rejects(unsafe.createUploadUrl("x.bin", 5), error => error.code === "BAD_DOWNLOAD_URL");
  const resumed = fixture({ offset: 2 });
  const result = await resumed.client.uploadBlob(new Blob(["abcdef"]), "x.bin", undefined, false, true, "2026-01-01T00:00:00Z");
  assert.equal(result.resumed_from, 2); assert.equal(new TextDecoder().decode([...resumed.files.values()][0].bytes), "cdef");
  await assert.rejects(resumed.client.createUploadUrl("x.bin", 6, undefined, false, true), error => error.code === "MODIFIED_TIME_REQUIRED");
});

test("failed upload is not retried, invalid Base64 creates no API requests, and binary payloads are preserved", async () => {
  let mutations = 0;
  const uncertain = new MyboxClient(PAT, async () => { mutations++; const error = new Error("synthetic timeout"); error.name = "TimeoutError"; throw error; });
  await assert.rejects(uncertain.copy("source"), error => error.code === "MYBOX_MUTATION_UNCERTAIN");
  assert.equal(mutations, 1);
  const broken = fixture({ failUpload: true }); await assert.rejects(broken.client.uploadBlob(new Blob(["data"]), "x.txt"), error => error.code === "UPLOAD_FAILED");
  assert.equal(broken.calls.filter(call => call.url.hostname.startsWith("upload.")).length, 1);
  const { client, calls, files } = fixture();
  await mcp(client, async (call, sdk) => {
    assert((await sdk.callTool({ name: "upload_data", arguments: { file_name: "bad", content_base64: "%%%" } })).isError); assert.equal(calls.length, 0);
    const tooLarge = Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64");
    assert((await sdk.callTool({ name: "upload_data", arguments: { file_name: "too-big", content_base64: tooLarge } })).isError); assert.equal(calls.length, 0);
    await call("upload_data", { file_name: "binary", content_base64: Buffer.from([0, 255, 12]).toString("base64") });
    assert.deepEqual([...files.values()][0].bytes, Uint8Array.from([0, 255, 12]));
    assert((await sdk.callTool({ name: "create_folder", arguments: { name: "../escape" } })).isError);
  });
});

test("read-only mode hides mutation tools while retaining the original document tools", async () => {
  await mcp(fixture().client, async (_call, sdk) => {
    const tools = (await sdk.listTools()).tools;
    for (const name of ["fetch", "search", "list_files", "get_file_info", "get_storage_info", "search_folders", "list_trash"]) assert(tools.some(tool => tool.name === name));
    assert(!tools.some(tool => tool.name === "delete_resource" || tool.name === "upload_text"));
  }, { readOnly: true, localFiles: false });
});
