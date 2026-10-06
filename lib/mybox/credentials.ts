import { AppError } from "./errors";
export interface MyboxEnv { DB?: D1Database; BUCKET?: R2Bucket; MYBOX_TOKEN_ENCRYPTION_KEY?: string }
type ConnectionRow = { encrypted_token: string; connected_at: string };
export function database(env: MyboxEnv) {
  if (!env.DB) throw new AppError("STORAGE_UNAVAILABLE", "연결 저장소를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.", 503);
  return env.DB;
}
function b64(bytes: Uint8Array) { return btoa(Array.from(bytes, n => String.fromCharCode(n)).join("")); }
function unb64(value: string) { const text = atob(value); const bytes = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i); return bytes; }
async function encryptionKey(secret?: string) {
  if (!secret) throw new AppError("KEY_UNAVAILABLE", "보안 설정을 준비하고 있어요. 잠시 후 다시 시도해 주세요.", 503);
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = unb64(secret); } catch { throw new AppError("KEY_UNAVAILABLE", "보안 설정을 확인해야 해요.", 503); }
  if (raw.length !== 32) throw new AppError("KEY_UNAVAILABLE", "보안 설정을 확인해야 해요.", 503);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealToken(token: string, userId: string, secret?: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) }, await encryptionKey(secret), new TextEncoder().encode(token));
  return `v1.${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}
export async function openToken(value: string, userId: string, secret?: string) {
  const key = await encryptionKey(secret);
  try {
    const [version, iv, cipher, trailing] = value.split(".");
    if (version !== "v1" || !iv || !cipher || trailing !== undefined) throw new Error("invalid envelope");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(userId) }, key, unb64(cipher));
    return new TextDecoder().decode(plain);
  } catch { throw new AppError("RECONNECT_REQUIRED", "연결을 다시 설정해 주세요.", 401); }
}
async function row(env: MyboxEnv, userId: string) { return database(env).prepare("SELECT encrypted_token, connected_at FROM mybox_connections WHERE user_id = ?").bind(userId).first<ConnectionRow>(); }
export async function connectionStatus(env: MyboxEnv, userId: string) {
  const entry = await row(env, userId);
  return { connected: !!entry, connected_at: entry?.connected_at ?? null, read_only: false, file_management: true, supported_formats: ["PDF", "HWP", "HWPX", "DOCX", "TXT", "MD", "CSV", "JSON", "PNG", "JPEG", "WEBP"], max_file_bytes: 100 * 1024 * 1024, file_limits_mb: { pdf: 100, documents: 50, images: 20 }, text_window_bytes: 512 * 1024 };
}
export async function getToken(env: MyboxEnv, userId: string) {
  const entry = await row(env, userId);
  if (!entry) throw new AppError("MYBOX_NOT_CONNECTED", "연결 화면에서 MYBOX 개인 액세스 토큰을 입력해 주세요.", 409);
  return openToken(entry.encrypted_token, userId, env.MYBOX_TOKEN_ENCRYPTION_KEY);
}
export async function saveToken(env: MyboxEnv, userId: string, token: string) {
  await database(env).prepare("INSERT INTO mybox_connections (user_id, encrypted_token, connected_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_token = excluded.encrypted_token, connected_at = excluded.connected_at").bind(userId, await sealToken(token, userId, env.MYBOX_TOKEN_ENCRYPTION_KEY), new Date().toISOString()).run();
}
export async function disconnect(env: MyboxEnv, userId: string) { await database(env).prepare("DELETE FROM mybox_connections WHERE user_id = ?").bind(userId).run(); }
export function validateToken(token: unknown): string {
  if (typeof token !== "string") throw new AppError("INVALID_TOKEN", "MYBOX에서 발급한 개인 액세스 토큰을 입력해 주세요.");
  const trimmed = token.trim();
  if (!trimmed.startsWith("mbx_pat_") || trimmed.length < 16 || trimmed.length > 2048 || /[^\x21-\x7e]/.test(trimmed)) throw new AppError("INVALID_TOKEN", "mbx_pat_로 시작하는 MYBOX 토큰을 확인해 주세요.");
  return trimmed;
}
