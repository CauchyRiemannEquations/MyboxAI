import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { zipSync, strToU8 } from "fflate";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, loadToken, LOCAL_TOOL_NAMES } from "../dist/server.mjs";
import { readDocument, stageLocalDocument, fileLimit } from "../dist/core.mjs";
import { mixedPdf, mockClient } from "./fixtures.mjs";

const pdf = mixedPdf();
const payload = result => JSON.parse(result.content.find(item => item.type === "text").text);
async function withTemp(task) {
  const root = await mkdtemp(path.join(tmpdir(), "mybox-test-"));
  try { await task(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function withMcp(client, task) {
  const server = createServer({ client });
  const sdk = new Client({ name: "mybox-fixture", version: "1.0" }, { capabilities: {} });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right); await sdk.connect(left);
  try { await task(sdk); } finally { await sdk.close(); await server.close(); }
}

test("standard MCP exposes file management with accurate read/write annotations", async () => {
  const fixture = mockClient("math.pdf", pdf);
  await withMcp(fixture.client, async sdk => {
    const { tools } = await sdk.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), [...LOCAL_TOOL_NAMES].sort());
    assert.equal(tools.find(tool => tool.name === "fetch").annotations.readOnlyHint, true);
    assert.equal(tools.find(tool => tool.name === "upload_file").annotations.readOnlyHint, false);
    assert.equal(tools.find(tool => tool.name === "permanently_delete_resource").annotations.destructiveHint, true);
    assert.equal(payload(await sdk.callTool({ name: "search", arguments: { query: "math" } })).files[0].id, "fixture");
    assert.equal(payload(await sdk.callTool({ name: "get_storage_info", arguments: {} })).usedSize, 123);
  });
});

test("mixed PDF auto mode returns native text and only the scanned page as an MCP image", async () => withTemp(async root => {
  const fixture = mockClient("math.pdf", pdf);
  await withMcp(fixture.client, async sdk => {
    const result = await sdk.callTool({ name: "fetch", arguments: { id: "fixture", page_count: 2 } });
    assert(!result.isError, JSON.stringify(result));
    const data = payload(result), images = result.content.filter(item => item.type === "image");
    assert(data.text.includes("Hello derivative")); assert.deepEqual(data.image_pages.map(page => page.number), [2]);
    assert.equal(images.length, 1); assert.equal(images[0].mimeType, "image/jpeg");
    const bytes = Buffer.from(images[0].data, "base64"), meta = await sharp(bytes).metadata();
    assert(meta.width > 1000 && meta.width <= 1800); assert.equal(data.server_ocr_performed, false);
    assert.equal(data.separate_ocr_api_required, false); assert.equal(data.recognition, "current_agent_vision");
    const stats = await sharp(bytes).stats(); assert(stats.channels.some(channel => channel.stdev > 15));
    // Development evidence, ignored by Git.
    await writeFile(path.resolve("dist/scan-preview.jpg"), bytes);
  });
  assert(fixture.calls.every(call => call.url.hostname.endsWith("naver.com")));
  assert(fixture.calls.filter(call => call.url.hostname === "download.mybox.naver.com").every(call => !call.init.headers?.Authorization));
}));

test("vision can render text pages and crop a detail without separate OCR", async () => {
  const { client } = mockClient("math.pdf", pdf);
  const result = await readDocument(client, { id: "fixture", mode: "vision", start_page: 2, page_count: 1, width: 2400, crop: { x: 0, y: 0, width: 0.8, height: 0.5 } });
  const data = payload(result); assert.equal(data.image_pages[0].number, 2);
  assert(data.image_pages[0].width <= 2400); assert(data.image_pages[0].width > data.image_pages[0].height);
  const first = await readDocument(client, { id: "fixture", mode: "vision", start_page: 1, page_count: 1 });
  assert.equal(payload(first).image_pages[0].number, 1);
});

test("text-only scan reports empty text and never invents an OCR transcription", async () => {
  const { client } = mockClient("math.pdf", pdf);
  const result = await readDocument(client, { id: "fixture", mode: "text", start_page: 2, page_count: 1 });
  assert.equal(result.content.filter(item => item.type === "image").length, 0);
  assert.equal(payload(result).recognition, "text_extraction");
  assert(!payload(result).text.includes("Math worksheet"));
});

test("PNG photo returns a JPEG image and optional private local fallback", async () => withTemp(async root => {
  const bytes = await sharp({ create: { width: 1000, height: 800, channels: 3, background: "#087e43" } }).png().toBuffer();
  const { client } = mockClient("photo.png", bytes);
  const result = await readDocument(client, { id: "fixture" }, { imageDirectory: path.join(root, "images"), tempRoot: root });
  const file = payload(result).image_pages[0].local_path;
  assert(path.isAbsolute(file)); assert.equal((await sharp(file).metadata()).format, "jpeg");
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(root), ["images"]);
}));

test("35 MB DOCX streams to disk, skips image payload, and deletes the source afterward", async () => withTemp(async root => {
  const bytes = zipSync({ "word/document.xml": strToU8('<w:document><w:p><w:t>한글 수학 자료</w:t></w:p></w:document>'), "word/media/image.png": new Uint8Array(35 * 1024 * 1024) }, { level: 0 });
  const { client } = mockClient("math.docx", bytes);
  const staged = await stageLocalDocument(client, "fixture", { name: "math.docx", size: bytes.length }, root);
  assert.equal(staged.source.size, bytes.length); assert.equal(staged.source.readBytes, 0);
  await staged.dispose(); assert.deepEqual(await readdir(root), []);
  const result = await readDocument(client, { id: "fixture" }, { tempRoot: root });
  assert.equal(payload(result).text, "한글 수학 자료"); assert.deepEqual(await readdir(root), []);
}));

test("download overflow and invalid document both cancel/clean up temporary files", async () => withTemp(async root => {
  let cancelled = false;
  const bytes = Buffer.alloc(21 * 1024 * 1024);
  const fixture = mockClient("photo.png", bytes, { size: 0, responseFactory: () => {
    let offset = 0;
    return new Response(new ReadableStream({ pull(controller) { controller.enqueue(bytes.subarray(offset, offset + 512 * 1024)); offset += 512 * 1024; if (offset === bytes.length) controller.close(); }, cancel() { cancelled = true; } }));
  } });
  await assert.rejects(readDocument(fixture.client, { id: "fixture" }, { tempRoot: root }), error => error.code === "TOO_LARGE");
  assert(cancelled); assert.deepEqual(await readdir(root), []);
  const broken = mockClient("broken.pdf", Buffer.from("invalid PDF"));
  await assert.rejects(readDocument(broken.client, { id: "fixture" }, { tempRoot: root }), error => error.code === "INVALID_DOCUMENT");
  assert.deepEqual(await readdir(root), []);
}));

test("large text paginates without losing Korean characters", async () => {
  const bytes = Buffer.from("가나다 abc\n".repeat(120000)), { client } = mockClient("math.txt", bytes);
  const first = payload(await readDocument(client, { id: "fixture", mode: "text", max_chars: 40000 }));
  assert(first.next_offset > 0); assert(first.next_start_byte > 0);
  const next = payload(await readDocument(client, { id: "fixture", mode: "text", start_byte: first.next_start_byte, max_chars: 40000 }));
  assert(!first.text.includes("�") && !next.text.includes("�"));
});

test("MCP rejects invalid page counts, out-of-bounds crops, and unsupported vision formats", async () => {
  const { client } = mockClient("math.pdf", pdf);
  await withMcp(client, async sdk => {
    const result = await sdk.callTool({ name: "fetch", arguments: { id: "fixture", page_count: 4 } });
    assert(result.isError); assert.equal(payload(result).code, "VISION_PAGE_LIMIT");
    const crop = await sdk.callTool({ name: "fetch", arguments: { id: "fixture", mode: "vision", crop: { x: 0.8, y: 0, width: 0.5, height: 1 } } });
    assert(crop.isError); assert.equal(payload(crop).code, "INVALID_CROP");
  });
  assert.equal(fileLimit("big.pdf"), 100 * 1024 * 1024); assert.equal(fileLimit("big.hwpx"), 50 * 1024 * 1024);
  const { client: word } = mockClient("word.docx", Buffer.from("unused"));
  await assert.rejects(readDocument(word, { id: "fixture", mode: "vision" }), error => error.code === "VISION_UNSUPPORTED");
});

test("token loader accepts a private token file and never echoes malformed secrets", async () => withTemp(async root => {
  const file = path.join(root, "token"); await writeFile(file, "mbx_pat_fixture_1234567890\n", { mode: 0o600 });
  assert.equal(await loadToken({ MYBOX_TOKEN_FILE: file }), "mbx_pat_fixture_1234567890");
  assert.equal(await loadToken({}), null);
  await assert.rejects(loadToken({ MYBOX_TOKEN: "invalid_secret" }), error => !error.message.includes("invalid_secret"));
}));

test("real stdio subprocess initializes from another working folder and handles missing token", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve("dist/server.mjs")], cwd: tmpdir(),
    env: { ...process.env, MYBOX_TOKEN: "", MYBOX_TOKEN_FILE: "", MYBOX_IMAGE_DIR: "" }, stderr: "pipe" });
  const sdk = new Client({ name: "stdio-check", version: "1.0" }, { capabilities: {} });
  await sdk.connect(transport);
  try {
    assert.equal((await sdk.listTools()).tools.length, LOCAL_TOOL_NAMES.length);
    assert.equal(payload(await sdk.callTool({ name: "get_connection_status", arguments: {} })).configured, false);
    const result = await sdk.callTool({ name: "fetch", arguments: { id: "fixture" } });
    assert(result.isError); assert.equal(payload(result).code, "MYBOX_NOT_CONNECTED");
  } finally { await sdk.close(); }
});
