import { openAsBlob } from "node:fs";
import { lstat, realpath, open, unlink } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../lib/mybox/errors.ts";

const MAX_TRANSFER_BYTES = 50 * 1024 ** 3;
async function localPath(value, root, destination = false) {
  if (!path.isAbsolute(value)) throw new AppError("ABSOLUTE_PATH_REQUIRED", "PC 파일의 절대 경로를 지정하세요.");
  const resolved = destination ? path.join(await realpath(path.dirname(value)), path.basename(value)) : await realpath(value);
  if (root) {
    const boundary = await realpath(root), relative = path.relative(boundary, resolved);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new AppError("TRANSFER_PATH_DENIED", "서버의 MYBOX_TRANSFER_DIR 안에 있는 파일 경로만 사용할 수 있습니다.", 403);
  }
  return resolved;
}

export async function uploadLocalFile(client, input, root) {
  const source = await localPath(input.local_path, root);
  const info = await lstat(source);
  if (!info.isFile() || info.size > MAX_TRANSFER_BYTES) throw new AppError("INVALID_LOCAL_FILE", "50GiB 이하의 일반 파일을 지정하세요.");
  const fileName = input.file_name || path.basename(source);
  if (!fileName || fileName.length > 255 || /[\\/\x00-\x1f\x7f]/.test(fileName)) throw new AppError("INVALID_NAME", "업로드 파일 이름을 확인하세요.");
  // openAsBlob streams multipart from disk and detects file changes during upload.
  const blob = await openAsBlob(source);
  return client.uploadBlob(blob, fileName, input.parent_id, input.overwrite, input.resume, info.mtime.toISOString());
}

export async function downloadLocalFile(client, input, root) {
  const destination = await localPath(input.local_path, root, true);
  // Exclusive creation preserves existing local files. Caller can choose a new name.
  let handle, reader;
  try {
    handle = await open(destination, "wx", 0o600);
    const meta = await client.info(input.id);
    const { response } = await client.downloadResponse(input.id, meta, MAX_TRANSFER_BYTES);
    if (response.body) reader = response.body.getReader();
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read(); if (done) break;
      if (size + value.length > MAX_TRANSFER_BYTES) throw new AppError("TOO_LARGE", "파일이 전송 최대 크기 50GiB를 초과했습니다.", 413);
      let offset = 0;
      while (offset < value.length) {
        const { bytesWritten } = await handle.write(value, offset, value.length - offset, size + offset);
        if (!bytesWritten) throw new AppError("LOCAL_STORAGE", "다운로드 파일을 저장하지 못했습니다.");
        offset += bytesWritten;
      }
      size += value.length;
    }
    if (Number.isFinite(meta.size) && meta.size !== size) throw new AppError("INCOMPLETE_FILE", "다운로드 파일 크기가 원본과 다릅니다.");
    return { downloaded: true, local_path: destination, bytes: size, id: input.id };
  } catch (error) {
    await reader?.cancel().catch(() => {});
    if (handle) { await handle.close(); handle = null; await unlink(destination).catch(() => {}); }
    if (error instanceof AppError) throw error;
    throw new AppError("LOCAL_TRANSFER_FAILED", "로컬 경로·기존 파일·폴더 쓰기 권한을 확인하세요.");
  } finally { reader?.releaseLock(); await handle?.close(); }
}
