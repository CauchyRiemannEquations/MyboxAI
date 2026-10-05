import { database, openToken, sealToken, type MyboxEnv } from "./credentials";
import { AppError, limitedBytes } from "./errors";
import { fileLimit, type MyboxClient, type Resource, type Transport } from "./client";
export const OCR_MODEL = "mistral-ocr-4-1";
export const OCR_PAGES_PER_READ = 5;
type Setting = { encrypted_key: string; daily_limit: number };
const day = () => new Date().toISOString().slice(0, 10);
async function settings(env: MyboxEnv, userId: string) { return database(env).prepare("SELECT encrypted_key, daily_limit FROM ocr_settings WHERE user_id = ?").bind(userId).first<Setting>(); }
export async function ocrStatus(env: MyboxEnv, userId: string) {
  const setting = await settings(env, userId);
  const usage = await database(env).prepare("SELECT pages FROM ocr_usage WHERE user_id = ? AND day = ?").bind(userId, day()).first<{ pages: number }>();
  return { enabled: !!setting, provider: "Mistral", model: OCR_MODEL, daily_limit: setting?.daily_limit ?? 50, pages_today: usage?.pages ?? 0, reset_timezone: "UTC", max_pages_per_read: OCR_PAGES_PER_READ, cache_days: 7 };
}
export async function saveOcrSettings(env: MyboxEnv, userId: string, value: unknown, limit: unknown, consent: unknown, transport: Transport = fetch) {
  if (consent !== true) throw new AppError("OCR_CONSENT_REQUIRED", "문서가 Mistral로 전송되고 별도 API 요금이 발생하는 데 동의해 주세요.");
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new AppError("INVALID_OCR_LIMIT", "하루 처리 한도를 1~500쪽으로 설정해 주세요.");
  const current = await settings(env, userId);
  const key = typeof value === "string" ? value.trim() : "";
  if (!key && current) {
    await database(env).prepare("UPDATE ocr_settings SET daily_limit = ?, updated_at = ? WHERE user_id = ?").bind(limit, new Date().toISOString(), userId).run();
    return ocrStatus(env, userId);
  }
  if (key.length < 16 || key.length > 512 || /[^\x21-\x7e]/.test(key)) throw new AppError("INVALID_OCR_KEY", "Mistral에서 발급한 API 키를 입력해 주세요.");
  let response: Response;
  try { response = await transport("https://api.mistral.ai/v1/models", { headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(20_000) }); }
  catch { throw new AppError("OCR_UNAVAILABLE", "Mistral에 연결하지 못했어요. 다시 시도해 주세요.", 502); }
  if (!response.ok) { await response.body?.cancel(); throw new AppError("INVALID_OCR_KEY", "Mistral API 키와 계정의 API 사용 권한을 확인해 주세요.", 422); }
  const models = JSON.parse(new TextDecoder().decode(await limitedBytes(response, 2 * 1024 * 1024))) as { data?: { id: string }[] };
  if (!models.data?.some(m => m.id === OCR_MODEL)) throw new AppError("OCR_MODEL_UNAVAILABLE", "이 Mistral 계정에서 OCR 4.1을 사용할 수 있는지 확인해 주세요.", 422);
  await database(env).prepare("INSERT INTO ocr_settings (user_id, encrypted_key, daily_limit, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_key = excluded.encrypted_key, daily_limit = excluded.daily_limit, updated_at = excluded.updated_at").bind(userId, await sealToken(key, `${userId}:mistral-key`, env.MYBOX_TOKEN_ENCRYPTION_KEY), limit, new Date().toISOString()).run();
  return ocrStatus(env, userId);
}
export async function removeOcr(env: MyboxEnv, userId: string) {
  const db = database(env);
  await db.batch([db.prepare("DELETE FROM ocr_settings WHERE user_id = ?").bind(userId), db.prepare("DELETE FROM ocr_cache WHERE user_id = ?").bind(userId)]);
  // Today's usage is kept so reconnecting cannot bypass the daily limit.
}
async function cacheKey(userId: string, meta: Resource, page: number) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([userId, meta.resourceId, meta.modifiedAt, meta.name, meta.size, page, OCR_MODEL])));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}
export async function reserveOcrPages(env: MyboxEnv, userId: string, pages: number, dailyLimit: number) {
  const result = await database(env).prepare("INSERT INTO ocr_usage (user_id, day, pages) SELECT ?, ?, ? WHERE ? <= ? ON CONFLICT(user_id, day) DO UPDATE SET pages = ocr_usage.pages + excluded.pages WHERE ocr_usage.pages + excluded.pages <= ? RETURNING pages").bind(userId, day(), pages, pages, dailyLimit, dailyLimit).first<{ pages: number }>();
  if (!result) throw new AppError("OCR_DAILY_LIMIT", "오늘의 OCR 처리 한도에 도달했어요. 연결 화면에서 한도를 변경하거나 내일 다시 읽어 주세요.", 429);
  return result.pages;
}
export async function ocrPages(env: MyboxEnv, userId: string, client: MyboxClient, meta: Resource, pageNumbers: number[], image = false, transport: Transport = fetch) {
  const setting = await settings(env, userId);
  if (!setting) throw new AppError("OCR_NOT_CONNECTED", "스캔 PDF·사진을 읽으려면 연결 화면에서 자동 OCR을 설정해 주세요.", 409);
  if (!pageNumbers.length || pageNumbers.length > OCR_PAGES_PER_READ || new Set(pageNumbers).size !== pageNumbers.length || pageNumbers.some(p => !Number.isInteger(p) || p < 1)) throw new AppError("OCR_PAGE_LIMIT", "OCR은 한 번에 최대 5쪽까지 읽을 수 있어요.");
  if ((meta.size || 0) > fileLimit(meta.name)) throw new AppError("TOO_LARGE", "OCR 파일 크기 제한을 초과했어요.", 413);
  const db = database(env), results = new Map<number, string>();
  const pending: { number: number; key: string }[] = [];
  await db.prepare("DELETE FROM ocr_cache WHERE user_id = ? AND expires_at < ?").bind(userId, Date.now()).run();
  for (const number of pageNumbers) {
    const key = await cacheKey(userId, meta, number);
    const cached = meta.modifiedAt ? await db.prepare("SELECT encrypted_text FROM ocr_cache WHERE cache_key = ? AND user_id = ? AND expires_at > ?").bind(key, userId, Date.now()).first<{ encrypted_text: string }>() : null;
    if (cached) results.set(number, await openToken(cached.encrypted_text, `${userId}:ocr:${key}`, env.MYBOX_TOKEN_ENCRYPTION_KEY));
    else pending.push({ number, key });
  }
  const cacheHits = results.size;
  if (pending.length) {
    const key = await openToken(setting.encrypted_key, `${userId}:mistral-key`, env.MYBOX_TOKEN_ENCRYPTION_KEY);
    // Fresh single-use MYBOX URL; never send the MYBOX PAT to the OCR provider.
    const documentUrl = await client.downloadUrl(meta.resourceId);
    await reserveOcrPages(env, userId, pending.length, setting.daily_limit);
    let response: Response;
    try {
      response = await transport("https://api.mistral.ai/v1/ocr", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(100_000), body: JSON.stringify({ model: OCR_MODEL, document: image ? { type: "image_url", image_url: documentUrl } : { type: "document_url", document_url: documentUrl }, pages: pending.map(p => p.number - 1), include_image_base64: false, table_format: "markdown" }) });
    } catch { throw new AppError("OCR_UNAVAILABLE", "OCR 응답이 지연됐어요. 자동 재시도는 하지 않았어요. Mistral 사용량을 확인한 뒤 다시 읽어 주세요.", 502); }
    if (!response.ok) {
      await response.body?.cancel();
      const message = response.status === 401 || response.status === 403 ? "Mistral API 키와 사용 권한을 확인해 주세요." : response.status === 429 ? "Mistral API 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요." : "OCR이 파일을 읽지 못했어요. 다운로드 접근, 파일 크기나 암호 설정을 확인해 주세요.";
      throw new AppError("OCR_FAILED", message, response.status === 429 ? 429 : 502);
    }
    let payload: { pages?: { index: number; markdown: string; tables?: { id: string; content: string }[] }[] };
    try { payload = JSON.parse(new TextDecoder().decode(await limitedBytes(response, 2 * 1024 * 1024))); } catch { throw new AppError("OCR_BAD_RESPONSE", "OCR 결과를 읽지 못했어요.", 502); }
    for (const p of pending) {
      const page = payload.pages?.find(r => r.index === p.number - 1);
      if (!page || typeof page.markdown !== "string" || page.markdown.length > 200_000) throw new AppError("OCR_BAD_RESPONSE", "OCR 결과에 요청한 쪽이 없거나 내용이 너무 커요.", 502);
      let markdown = page.markdown;
      for (const table of page.tables || []) if (typeof table.id === "string" && typeof table.content === "string") markdown = markdown.replaceAll(`![${table.id}](${table.id})`, table.content).replaceAll(`[${table.id}](${table.id})`, table.content).replaceAll(`(${table.id})`, `\n${table.content}\n`);
      if (markdown.length > 200_000) throw new AppError("OCR_BAD_RESPONSE", "OCR 결과가 너무 커요.", 502);
      results.set(p.number, markdown);
      if (meta.modifiedAt) await db.prepare("INSERT INTO ocr_cache (cache_key, user_id, encrypted_text, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET encrypted_text = excluded.encrypted_text, expires_at = excluded.expires_at").bind(p.key, userId, await sealToken(markdown, `${userId}:ocr:${p.key}`, env.MYBOX_TOKEN_ENCRYPTION_KEY), Date.now() + 7 * 86400_000).run();
    }
  }
  return { pages: results, processedPages: pending.length, cacheHits, model: OCR_MODEL };
}
