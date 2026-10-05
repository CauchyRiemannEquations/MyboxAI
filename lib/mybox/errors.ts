export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function safeError(error: unknown) {
  if (error instanceof AppError) return { code: error.code, message: error.message, status: error.status };
  return { code: "UNAVAILABLE", message: "연결을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.", status: 503 };
}
export function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}
export function requireUser(request: Request) {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id || !request.headers.get("oai-authenticated-user-email")) throw new AppError("AUTH_REQUIRED", "ChatGPT 계정으로 로그인해 주세요.", 401);
  return id;
}
export function checkOrigin(request: Request, required = false) {
  const origin = request.headers.get("origin");
  if ((required && !origin) || (origin && origin !== new URL(request.url).origin)) throw new AppError("INVALID_ORIGIN", "이 연결 화면에서 다시 시도해 주세요.", 403);
}
export async function limitedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length") || 0) > limit) { await response.body?.cancel(); throw new AppError("TOO_LARGE", "읽을 수 있는 크기를 초과했어요.", 413); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new AppError("TOO_LARGE", "응답이 너무 커서 읽기를 중단했어요.", 413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
export async function readJson(request: Request, limit = 16_384) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new AppError("INVALID_CONTENT_TYPE", "JSON 요청이 필요해요.", 415);
  try { return JSON.parse(new TextDecoder().decode(await limitedBytes(new Response(request.body, { headers: request.headers }), limit))); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError("INVALID_JSON", "요청 형식을 확인해 주세요."); }
}
