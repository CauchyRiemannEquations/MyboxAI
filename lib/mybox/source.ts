import { AppError, limitedBytes } from "./errors";
import { fileLimit, type MyboxClient, type Resource } from "./client";
export interface ByteSource { size: number; read(offset: number, length: number): Promise<Uint8Array>; readBytes: number }
const BLOCK = 64 * 1024;
const READ_BUDGET = 32 * 1024 * 1024;
export class R2Source implements ByteSource {
  readBytes = 0;
  private cache = new Map<number, Uint8Array>();
  constructor(private bucket: R2Bucket, private key: string, public size: number) {}
  async read(offset: number, length: number) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.size || length > 8 * 1024 * 1024) throw new AppError("INVALID_DOCUMENT", "문서의 읽기 범위가 올바르지 않아요.", 422);
    const result = new Uint8Array(length);
    for (let pos = offset; pos < offset + length;) {
      const index = Math.floor(pos / BLOCK);
      let block = this.cache.get(index);
      if (!block) {
        const start = index * BLOCK;
        const count = Math.min(BLOCK, this.size - start);
        this.readBytes += count;
        if (this.readBytes > READ_BUDGET) throw new AppError("TOO_COMPLEX", "이 쪽의 문서 구조가 너무 커요. 쪽 수를 줄이거나 OCR로 읽어 주세요.", 413);
        const object = await this.bucket.get(this.key, { range: { offset: start, length: count } });
        if (!object) throw new AppError("TEMP_FILE_MISSING", "임시 파일을 읽지 못했어요. 다시 열어 주세요.", 503);
        block = await limitedBytes(new Response(object.body), count);
        if (block.length !== count) throw new AppError("INVALID_DOCUMENT", "문서 일부를 읽지 못했어요.", 422);
        if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(index, block);
      }
      const startInBlock = pos % BLOCK;
      const count = Math.min(block.length - startInBlock, offset + length - pos);
      result.set(block.subarray(startInBlock, startInBlock + count), pos - offset);
      pos += count;
    }
    return result;
  }
  clear() { this.cache.clear(); }
}
export async function stageDocument(client: MyboxClient, bucket: R2Bucket | undefined, id: string, meta: Resource) {
  if (!bucket) throw new AppError("FILE_STORAGE_UNAVAILABLE", "대용량 파일 저장소를 준비하고 있어요. 잠시 후 다시 시도해 주세요.", 503);
  // Interrupted reads leave only private objects; the next read removes aged objects.
  const old = await bucket.list({ prefix: "mybox-temp/", limit: 100 });
  const expired = old.objects.filter(o => o.uploaded.getTime() < Date.now() - 60 * 60 * 1000).slice(0, 20);
  if (expired.length) await bucket.delete(expired.map(o => o.key));
  const { response } = await client.downloadResponse(id, meta);
  const headerSize = Number(response.headers.get("content-length") || 0);
  const size = headerSize || meta.size || 0;
  if (!Number.isSafeInteger(size) || size < 1 || size > fileLimit(meta.name) || (headerSize && meta.size && headerSize !== meta.size)) { await response.body?.cancel(); throw new AppError("FILE_SIZE_CHANGED", "파일 크기가 달라졌어요. 파일을 다시 찾아서 열어 주세요.", 422); }
  if (!response.body) throw new AppError("EMPTY_FILE", "파일이 비어 있어요.", 422);
  const key = `mybox-temp/${Date.now()}-${crypto.randomUUID()}`;
  const fixed = new FixedLengthStream(size);
  const controller = new AbortController();
  try {
    const pipe = response.body.pipeTo(fixed.writable, { signal: controller.signal });
    const put = bucket.put(key, fixed.readable, { httpMetadata: { contentType: "application/octet-stream" } }).catch(error => { controller.abort(); throw error; });
    const results = await Promise.allSettled([pipe, put]);
    if (results.some(r => r.status === "rejected")) throw new AppError("DOWNLOAD_FAILED", "파일을 모두 내려받지 못했어요. 다시 시도해 주세요.", 502);
    const source = new R2Source(bucket, key, size);
    return { source, async dispose() { source.clear(); await bucket.delete(key); } };
  } catch (error) { await bucket.delete(key); throw error; }
}
