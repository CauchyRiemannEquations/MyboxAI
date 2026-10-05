import { env } from "cloudflare:workers";
import { checkOrigin, json, readJson, requireUser, safeError, AppError } from "@/lib/mybox/errors";
import { connectionStatus, disconnect, saveToken, validateToken } from "@/lib/mybox/credentials";
import { MyboxClient } from "@/lib/mybox/client";
import { executeTool } from "@/lib/mybox/tools";
import { ocrStatus, saveOcrSettings, removeOcr } from "@/lib/mybox/ocr";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const userId = requireUser(request);
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "status";
    if (action === "status") return json({ ...await connectionStatus(env, userId), ocr: await ocrStatus(env, userId) });
    if (action === "read") return json({ error: "POST_REQUIRED", message: "문서 읽기는 연결 화면의 버튼으로 요청해 주세요." }, 405);
    const args: Record<string, unknown> = {};
    for (const key of ["id", "query", "category", "folder_id", "cursor", "parent_path"]) if (url.searchParams.has(key)) args[key] = url.searchParams.get(key);
    for (const key of ["offset", "max_chars", "start_page", "page_count", "count"]) if (url.searchParams.has(key)) args[key] = Number(url.searchParams.get(key));
    const names: Record<string, string> = { list: "list_files", search: "search", info: "get_file_info", storage: "get_storage_info" };
    if (!names[action]) throw new AppError("INVALID_ACTION", "지원하지 않는 요청이에요.");
    return json(await executeTool(names[action], args, env, userId, url.origin));
  } catch (error) { const safe = safeError(error); return json({ error: safe.code, message: safe.message }, safe.status); }
}
export async function POST(request: Request) {
  try {
    const userId = requireUser(request);
    checkOrigin(request, true);
    const body = await readJson(request, 4096);
    if (body?.action === "read") { const args = { ...body }; delete args.action; return json(await executeTool("fetch", args, env, userId, new URL(request.url).origin)); }
    if (body?.action === "ocr") return json({ ocr: await saveOcrSettings(env, userId, body.key, body.daily_limit, body.consent) });
    const token = validateToken(body?.token);
    const storage = await new MyboxClient(token).storage();
    await saveToken(env, userId, token);
    return json({ ...await connectionStatus(env, userId), ocr: await ocrStatus(env, userId), storage });
  } catch (error) { const safe = safeError(error); return json({ error: safe.code, message: safe.message }, safe.status); }
}
export async function DELETE(request: Request) {
  try { const userId = requireUser(request); checkOrigin(request, true); await removeOcr(env, userId); if (new URL(request.url).searchParams.get("action") !== "ocr") await disconnect(env, userId); return json({ ...await connectionStatus(env, userId), ocr: await ocrStatus(env, userId) }); }
  catch (error) { const safe = safeError(error); return json({ error: safe.code, message: safe.message }, safe.status); }
}
