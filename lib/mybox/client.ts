import { AppError, limitedBytes } from "./errors";
export { AppError } from "./errors";
const API = "https://open-api.mybox.naver.com";
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export function fileLimit(name: string) { return /\.pdf$/i.test(name) ? MAX_FILE_BYTES : /\.(png|jpe?g|webp)$/i.test(name) ? 20 * 1024 * 1024 : 50 * 1024 * 1024; }
export interface Resource { resourceId: string; name: string; size?: number; type?: string; category?: string; parentId?: string; parentPath?: string; path?: string; modifiedAt?: string; createdAt?: string }
export interface ResourcePage { resources?: Resource[]; responseMetaData?: { nextCursor?: string }; fileCount?: number; subFolderCount?: number }
export type Transport = typeof fetch;
export function resourceId(value: unknown) {
  if (typeof value !== "string" || !value.length || value.length > 1024 || /[\x00-\x20\x7f]/.test(value)) throw new AppError("INVALID_ID", "검색 결과에 표시된 파일 ID를 사용해 주세요.");
  return encodeURIComponent(value);
}
export function safeDownloadUrl(raw: unknown) {
  if (typeof raw !== "string") throw new AppError("BAD_DOWNLOAD_URL", "다운로드 주소를 확인할 수 없어요.", 502);
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError("BAD_DOWNLOAD_URL", "다운로드 주소를 확인할 수 없어요.", 502); }
  const host = url.hostname.toLowerCase();
  const allowed = ["naver.com", "naver.net", "pstatic.net", "navercloud.com", "ncloud.com"].some(domain => host === domain || host.endsWith(`.${domain}`));
  if (url.protocol !== "https:" || !allowed || url.username || url.password || (url.port && url.port !== "443")) throw new AppError("BAD_DOWNLOAD_URL", "MYBOX 다운로드 주소를 확인해야 해요.", 502);
  return url;
}
export class MyboxClient {
  constructor(private token: string, private transport: Transport = fetch) {}
  async api<T>(path: string, query: Record<string, string | number | undefined> = {}, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const url = new URL(path, API);
    if (url.origin !== API || !path.startsWith("/v1/")) throw new AppError("INVALID_API", "요청 주소를 확인해 주세요.");
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    let response: Response;
    try { response = await this.transport(url, { method: options.method || "GET", headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}), redirect: "error", signal: AbortSignal.timeout(20_000) }); }
    catch (error) {
      // Provider errors may contain credentials. Only classify known codes;
      // never forward their message, stack, URL or headers to users/logs.
      const failure = error as { name?: string; cause?: { code?: string } };
      const code = failure?.cause?.code;
      if (code && ["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code)) {
        throw new AppError("MYBOX_TLS_ERROR", "MYBOX HTTPS 인증서를 확인하지 못했어요. PC의 신뢰 인증서와 보안 프로그램·프록시 설정을 확인하세요. 구버전 Node.js라면 22.19 이상 또는 24.5 이상의 최신 LTS로 업데이트하세요.", 502);
      }
      if (failure?.name === "TimeoutError" || failure?.name === "AbortError" || (code && ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code))) {
        if (options.method && options.method !== "GET") throw new AppError("MYBOX_MUTATION_UNCERTAIN", "변경 요청의 응답 시간이 초과됐습니다. MYBOX에서 완료 여부를 먼저 조회하세요. 동일 작업을 자동으로 재시도하지 않습니다.", 502);
        throw new AppError("MYBOX_TIMEOUT", "MYBOX 연결 확인 시간이 초과됐어요. 인터넷 연결·VPN·프록시 설정을 확인한 뒤 다시 시도하세요.", 502);
      }
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") throw new AppError("MYBOX_DNS_ERROR", "MYBOX 서버 주소를 찾지 못했어요. 인터넷 연결과 DNS 설정을 확인하세요.", 502);
      if (options.method && options.method !== "GET") throw new AppError("MYBOX_MUTATION_UNCERTAIN", "변경 요청의 응답을 확인하지 못했습니다. MYBOX에서 완료 여부를 먼저 조회하세요. 동일 작업을 자동으로 재시도하지 않습니다.", 502);
      throw new AppError("MYBOX_UNAVAILABLE", "MYBOX에 접속하지 못했어요. 인터넷 연결·VPN·프록시 설정을 확인한 뒤 다시 시도해 주세요.", 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      const messages: Record<number, string> = { 401: "MYBOX 토큰이 만료되었거나 올바르지 않아요. 다시 연결해 주세요.", 403: "MYBOX 계정 상태나 API 접근 권한을 확인해 주세요.", 404: "파일을 찾을 수 없어요. 이동하거나 삭제되었을 수 있어요.", 409: "같은 이름의 파일이나 폴더가 있습니다. 다른 이름을 지정하거나 덮어쓰기를 명시하세요.", 422: "이 작업의 대상·이름·위치를 확인하세요.", 423: "파일이 잠겨 있습니다. 잠금 상태를 확인하세요.", 429: "MYBOX 호출 한도에 도달했어요. 잠시 후 다시 시도해 주세요.", 507: "MYBOX 저장 공간이 부족합니다." };
      throw new AppError(`MYBOX_${response.status}`, messages[response.status] || "MYBOX에서 요청을 처리하지 못했어요.", response.status === 401 ? 401 : response.status === 429 ? 429 : 502);
    }
    if (response.status === 204 || !response.body) return {} as T;
    try { const bytes = await limitedBytes(response, 2 * 1024 * 1024); return (bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {}) as T; }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError("MYBOX_BAD_RESPONSE", "MYBOX 응답 형식을 확인할 수 없어요.", 502); }
  }
  storage() { return this.api<Record<string, unknown>>("/v1/drive/storage"); }
  info(id: string) { return this.api<Resource>(`/v1/drive/resources/${resourceId(id)}`); }
  list(folderId?: string, cursor?: string, count = 50, sort = "name,asc") { return this.api<ResourcePage>(folderId ? `/v1/drive/folders/${resourceId(folderId)}/resources` : "/v1/drive/resources", { sort, cursor, count }); }
  search(query: string, category?: string, parentPath?: string, cursor?: string, count = 20, filters: Record<string, string | undefined> = {}) {
    if (!query.trim() && !category && !filters.startDate && !filters.endDate) throw new AppError("EMPTY_SEARCH", "파일 이름이나 종류·날짜를 입력해 주세요.");
    return this.api<ResourcePage>("/v1/search/resources/files", { ...filters, q: query.trim(), category, parentPath, cursor, count });
  }
  searchFolders(query = "", filters: Record<string, string | number | undefined> = {}) {
    if (!query.trim() && !filters.path && !filters.startDate && !filters.endDate) throw new AppError("EMPTY_SEARCH", "폴더 이름·경로·날짜를 입력해 주세요.");
    return this.api<ResourcePage>("/v1/search/resources/folders", { ...filters, q: query.trim() });
  }
  trash(cursor?: string, count = 100, sort = "deletedAt,desc") { return this.api<ResourcePage>("/v1/drive/trash", { cursor, count, sort }); }
  createFolder(folderName: string, parentId?: string) { return this.api<Record<string, unknown>>("/v1/drive/folders", {}, { method: "POST", body: { folderName, parentId } }); }
  rename(id: string, name: string) { return this.api(`/v1/drive/resources/${resourceId(id)}/rename`, {}, { method: "POST", body: { name } }); }
  move(id: string, parentId: string, isOverwrite = false) { return this.api(`/v1/drive/resources/${resourceId(id)}/move`, {}, { method: "POST", body: { parentId, isOverwrite } }); }
  copy(id: string, parentId?: string, name?: string, isOverwrite = false) { return this.api(`/v1/drive/resources/${resourceId(id)}/copy`, {}, { method: "POST", body: { parentId, name, isOverwrite } }); }
  deleteResource(id: string) { return this.api(`/v1/drive/resources/${resourceId(id)}`, {}, { method: "DELETE" }); }
  restore(id: string, isOverwrite = false) { return this.api(`/v1/drive/trash/${resourceId(id)}/restore`, {}, { method: "POST", body: { isOverwrite } }); }
  permanentlyDelete(id: string) { return this.api(`/v1/drive/trash/${resourceId(id)}`, {}, { method: "DELETE" }); }
  emptyTrash() { return this.api("/v1/drive/trash", {}, { method: "DELETE" }); }
  favorite(id: string, enabled: boolean) { return this.api(`/v1/drive/resources/${resourceId(id)}/${enabled ? "favorite" : "unfavorite"}`, {}, { method: "POST" }); }
  setTrashAutoDelete(days: number) { return this.api("/v1/drive/storage", {}, { method: "PATCH", body: { trashAutoDeleteDays: days } }); }
  async createUploadUrl(fileName: string, fileSize: number, parentId?: string, isOverwrite = false, resume = false, modifiedTime?: string) {
    if (!Number.isSafeInteger(fileSize) || fileSize < 0) throw new AppError("INVALID_SIZE", "파일 크기를 바이트 단위로 지정하세요.");
    if (resume && !modifiedTime) throw new AppError("MODIFIED_TIME_REQUIRED", "이어올리기에는 modified_time을 함께 지정하세요.");
    const result = await this.api<{ uploadUrl: string; offset?: number }>("/v1/drive/files", {}, { method: "POST", body: { fileName, fileSize, parentId, isOverwrite, resume, modifiedTime } });
    safeDownloadUrl(result.uploadUrl);
    if (!Number.isSafeInteger(result.offset ?? 0) || (result.offset ?? 0) < 0 || (result.offset ?? 0) > fileSize) throw new AppError("INVALID_UPLOAD_OFFSET", "MYBOX 업로드 시작점을 확인할 수 없습니다.");
    return result;
  }
  async uploadBlob(blob: Blob, fileName: string, parentId?: string, isOverwrite = false, resume = false, modifiedTime?: string) {
    const storage = await this.storage();
    if (typeof storage.maxFileBytes === "number" && blob.size > storage.maxFileBytes) throw new AppError("UPLOAD_TOO_LARGE", "이 MYBOX 계정의 업로드 최대 크기를 초과했습니다.", 413);
    const ticket = await this.createUploadUrl(fileName, blob.size, parentId, isOverwrite, resume, modifiedTime);
    const data = new FormData(); data.set("Filedata", blob.slice(ticket.offset ?? 0), fileName);
    let response: Response;
    try { response = await this.transport(safeDownloadUrl(ticket.uploadUrl), { method: "POST", body: data, redirect: "error", signal: AbortSignal.timeout(30 * 60_000) }); }
    catch { throw new AppError("UPLOAD_FAILED", "업로드가 중단됐습니다. 완료 여부를 MYBOX에서 확인하세요. 자동으로 재시도하지 않습니다.", 502); }
    if (!response.ok) { await response.body?.cancel(); throw new AppError("UPLOAD_FAILED", "MYBOX가 업로드를 완료하지 못했습니다. 저장 공간과 파일 상태를 확인하세요.", 502); }
    // Storage responses are not a documented resource schema; don't expose signed URLs.
    await response.body?.cancel();
    return { uploaded: true, file_name: fileName, bytes: blob.size, resumed_from: ticket.offset ?? 0, parent_id: parentId ?? null, overwritten: isOverwrite };
  }
  async downloadUrl(id: string) {
    const download = await this.api<{ downloadUrl: string }>(`/v1/drive/files/${resourceId(id)}/download`);
    return safeDownloadUrl(download.downloadUrl).toString();
  }
  async downloadResponse(id: string, knownMeta?: Resource, maximum?: number) {
    const meta = knownMeta || await this.info(id);
    if (meta.type && meta.type !== "file") throw new AppError("NOT_A_FILE", "폴더는 목록 조회로 열어 주세요.");
    const limit = maximum ?? fileLimit(meta.name);
    if ((meta.size || 0) > limit) throw new AppError("TOO_LARGE", `이 형식은 ${limit / 1024 / 1024}MB까지 읽을 수 있어요. PDF는 100MB, 문서는 50MB, 이미지는 20MB까지 지원해요.`, 413);
    let target = safeDownloadUrl(await this.downloadUrl(id));
    // Signed URLs authorize themselves. Never forward the MYBOX PAT.
    for (let hop = 0; hop <= 3; hop++) {
      let response: Response;
      try { response = await this.transport(target, { redirect: "manual", signal: AbortSignal.timeout(maximum === undefined ? 120_000 : 30 * 60_000) }); }
      catch { throw new AppError("DOWNLOAD_FAILED", "파일을 내려받지 못했어요. 다시 시도해 주세요.", 502); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || hop === 3) throw new AppError("DOWNLOAD_FAILED", "다운로드 주소를 확인해야 해요.", 502);
        target = safeDownloadUrl(new URL(location, target).toString());
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new AppError("DOWNLOAD_FAILED", "파일을 내려받지 못했어요. 다시 시도해 주세요.", 502); }
      if (Number(response.headers.get("content-length") || 0) > limit) { await response.body?.cancel(); throw new AppError("TOO_LARGE", "파일 크기 제한을 초과했어요.", 413); }
      return { meta, response };
    }
    throw new AppError("DOWNLOAD_FAILED", "파일을 내려받지 못했어요.", 502);
  }
  // Small fixtures and compatibility callers only; production uses streaming staging.
  async download(id: string) { const { meta, response } = await this.downloadResponse(id); return { meta, bytes: await limitedBytes(response, Math.min(fileLimit(meta.name), 8 * 1024 * 1024)) }; }
}
