import { mkdtemp, open, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AppError } from "../../lib/mybox/errors.ts";
import { fileLimit } from "../../lib/mybox/client.ts";

export class FileByteSource {
  readBytes = 0;
  constructor(handle, size) { this.handle = handle; this.size = size; }
  async read(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.size) {
      throw new AppError("INVALID_DOCUMENT", "문서의 읽기 범위가 올바르지 않습니다.", 422);
    }
    if (length > 8 * 1024 * 1024 || this.readBytes + length > 256 * 1024 * 1024) {
      throw new AppError("TOO_COMPLEX", "문서가 너무 복잡합니다. 읽을 쪽 수를 줄여 주세요.", 413);
    }
    this.readBytes += length;
    const data = new Uint8Array(length);
    let position = 0;
    while (position < length) {
      const { bytesRead } = await this.handle.read(data, position, length - position, offset + position);
      if (!bytesRead) throw new AppError("INCOMPLETE_FILE", "파일 다운로드가 완전하지 않습니다.", 422);
      position += bytesRead;
    }
    return data;
  }
}

// Download once, stream to a private temporary file, and parse only selected ranges.
export async function stageLocalDocument(client, id, meta, tempRoot = tmpdir()) {
  const { response } = await client.downloadResponse(id, meta);
  const limit = fileLimit(meta.name);
  let directory, handle, reader;
  try {
    directory = await mkdtemp(path.join(tempRoot, "mybox-ai-"));
    await chmod(directory, 0o700);
    handle = await open(path.join(directory, "source"), "wx+", 0o600);
    if (!response.body) throw new AppError("EMPTY_FILE", "파일이 비어 있습니다.", 422);
    reader = response.body.getReader();
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.length > limit) throw new AppError("TOO_LARGE", "이 형식의 파일 크기 제한을 초과했습니다.", 413);
      let offset = 0;
      while (offset < value.length) {
        const { bytesWritten } = await handle.write(value, offset, value.length - offset, size + offset);
        if (!bytesWritten) throw new AppError("LOCAL_STORAGE", "임시 파일을 저장할 수 없습니다.", 503);
        offset += bytesWritten;
      }
      size += value.length;
    }
    if (!size) throw new AppError("EMPTY_FILE", "파일이 비어 있습니다.", 422);
    if (Number.isFinite(meta.size) && meta.size > 0 && size !== meta.size) {
      throw new AppError("INCOMPLETE_FILE", "파일 크기가 달라졌습니다. 다시 읽어 주세요.", 422);
    }
    const source = new FileByteSource(handle, size);
    const ownedHandle = handle, ownedDirectory = directory;
    let disposed = false;
    return { source, async dispose() {
      if (disposed) return;
      disposed = true;
      try { await ownedHandle.close(); } finally { await rm(ownedDirectory, { recursive: true, force: true }); }
    } };
  } catch (error) {
    await reader?.cancel().catch(() => {});
    await handle?.close().catch(() => {});
    if (directory) await rm(directory, { recursive: true, force: true });
    if (error instanceof AppError) throw error;
    throw new AppError("LOCAL_STORAGE", "파일을 내려받거나 임시 저장하지 못했습니다.", 503);
  } finally {
    reader?.releaseLock();
    if (!reader) await response.body?.cancel().catch(() => {});
  }
}
