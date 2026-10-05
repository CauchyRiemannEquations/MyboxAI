import { AppError } from "./errors";
import { hwpRecordText, inflateBounded, xmlText, type Extracted } from "./extract";
import type { ByteSource } from "./source";
const EXPANDED = 8 * 1024 * 1024;
export interface RangeExtracted extends Extracted { pages?: { number: number; text: string; needsOcr: boolean }[]; nextStartByte?: number | null; startByte?: number }
const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
function invalid() { return new AppError("INVALID_DOCUMENT", "문서 구조를 읽지 못했어요. 암호화 여부를 확인하거나 PDF·HWPX로 저장해 주세요.", 422); }
export async function extractPdfRange(source: ByteSource, start = 1, count = 5): Promise<RangeExtracted> {
  const { getResolvedPDFJS } = await import("unpdf");
  const { PDFDataRangeTransport, getDocument } = await getResolvedPDFJS();
  const initial = await source.read(0, Math.min(source.size, 64 * 1024));
  const range = new PDFDataRangeTransport(source.size, initial, false);
  let readError: unknown;
  const config = { range, rangeChunkSize: 64 * 1024, disableAutoFetch: true, disableStream: true, useSystemFonts: true, useWorkerFetch: false, isEvalSupported: false, maxImageSize: 1_000_000, stopAtErrors: true };
  const loading = getDocument(config);
  range.requestDataRange = (begin: number, end: number) => {
    void source.read(begin, end - begin).then(data => range.onDataRange(begin, data)).catch(error => { readError = error; void loading.destroy(); });
  };
  try {
    const pdf = await loading.promise;
    if (start > pdf.numPages) throw new AppError("INVALID_PAGE", `이 문서는 ${pdf.numPages}쪽까지 있어요.`);
    const end = Math.min(pdf.numPages, start + count - 1);
    const pages: NonNullable<RangeExtracted["pages"]> = [];
    let characters = 0;
    for (let number = start; number <= end; number++) {
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
        characters += text.length;
        if (characters > 1_000_000) throw new AppError("TOO_COMPLEX", "쪽 수를 줄여 다시 읽어 주세요.", 413);
        pages.push({ number, text, needsOcr: text.replace(/\s/g, "").length < 20 });
      } finally { page.cleanup(); }
    }
    return { text: pages.map(p => `[${p.number}쪽]\n${p.text}`).join("\n\n"), format: "PDF", pages, totalPages: pdf.numPages, startPage: start, endPage: end, nextStartPage: end < pdf.numPages ? end + 1 : null, warnings: ["그림·도형·표 배치와 수식은 원문에서 확인해 주세요. OCR이 필요하면 ocr=always로 지정할 수 있어요."] };
  } catch (error) { if (readError) throw readError; if (error instanceof AppError) throw error; throw invalid(); }
  finally { await loading.destroy(); }
}
export async function extractZipRange(source: ByteSource, extension: "docx" | "hwpx"): Promise<RangeExtracted> {
  const tail = await source.read(Math.max(0, source.size - 65557), Math.min(source.size, 65557));
  const tv = view(tail);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50 && i + 22 + tv.getUint16(i + 20, true) === tail.length) { end = i; break; }
  if (end < 0 || tv.getUint16(end + 4, true) || tv.getUint16(end + 6, true)) throw invalid();
  const count = tv.getUint16(end + 10, true), length = tv.getUint32(end + 12, true), offset = tv.getUint32(end + 16, true);
  if (count > 10000 || length > 2 * 1024 * 1024 || offset + length > source.size || count === 65535) throw new AppError("TOO_COMPLEX", "문서 안의 항목이 너무 많아요.", 413);
  const directory = await source.read(offset, length), dv = view(directory);
  const selected: { name: string; method: number; size: number; compressed: number; offset: number }[] = [];
  let position = 0, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > length || dv.getUint32(position, true) !== 0x02014b50) throw invalid();
    const nameLength = dv.getUint16(position + 28, true), extraLength = dv.getUint16(position + 30, true), commentLength = dv.getUint16(position + 32, true);
    if (position + 46 + nameLength + extraLength + commentLength > length) throw invalid();
    const name = new TextDecoder().decode(directory.subarray(position + 46, position + 46 + nameLength));
    if (extension === "docx" ? name === "word/document.xml" : /^Contents\/section\d+\.xml$/i.test(name)) {
      const size = dv.getUint32(position + 24, true), compressed = dv.getUint32(position + 20, true), method = dv.getUint16(position + 10, true);
      expanded += size;
      if (expanded > EXPANDED || compressed > EXPANDED) throw new AppError("TOO_COMPLEX", "문서의 본문이 너무 커요.", 413);
      if (dv.getUint16(position + 8, true) & 1 || ![0, 8].includes(method)) throw invalid();
      selected.push({ name, method, size, compressed, offset: dv.getUint32(position + 42, true) });
    }
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (!selected.length) throw invalid();
  const texts: string[] = [];
  for (const entry of selected.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const header = view(await source.read(entry.offset, 30));
    if (header.getUint32(0, true) !== 0x04034b50) throw invalid();
    const data = await source.read(entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true), entry.compressed);
    const plain = entry.method === 8 ? inflateBounded(data) : data;
    if (plain.length !== entry.size) throw invalid();
    texts.push(xmlText(new TextDecoder().decode(plain), extension.toUpperCase()).text);
  }
  const text = texts.join("\n\n").trim();
  if (text.length > 1_000_000) throw new AppError("TOO_COMPLEX", "문서의 본문이 너무 커요.", 413);
  return { text, format: extension.toUpperCase(), warnings: ["본문만 추출했습니다. 삽입된 그림은 읽지 않으며 표와 수식 배치는 원문과 다를 수 있어요."] };
}
// Read the compound-file allocation tables, then only HWP body streams.
export async function extractHwpRange(source: ByteSource): Promise<RangeExtracted> {
  const header = await source.read(0, 512), hv = view(header);
  if (Array.from(header.subarray(0, 8)).join(",") !== "208,207,17,224,161,177,26,225") throw invalid();
  const sectorSize = 2 ** hv.getUint16(30, true), miniSize = 2 ** hv.getUint16(32, true);
  if (![512, 4096].includes(sectorSize) || miniSize !== 64 || hv.getUint32(56, true) !== 4096) throw invalid();
  const maxSectors = Math.floor(source.size / sectorSize) - 1;
  const sector = (id: number) => { if (id > maxSectors || id >= 0xfffffffa) throw invalid(); return source.read((id + 1) * sectorSize, sectorSize); };
  const fatIds: number[] = [];
  for (let i = 0; i < 109; i++) { const id = hv.getUint32(76 + 4 * i, true); if (id !== 0xffffffff) fatIds.push(id); }
  let difat = hv.getUint32(68, true);
  const seenDifat = new Set<number>();
  for (let i = 0; i < hv.getUint32(72, true); i++) {
    if (seenDifat.has(difat) || seenDifat.size > 128) throw invalid(); seenDifat.add(difat);
    const dv = view(await sector(difat));
    for (let j = 0; j < sectorSize / 4 - 1; j++) { const id = dv.getUint32(j * 4, true); if (id !== 0xffffffff) fatIds.push(id); }
    difat = dv.getUint32(sectorSize - 4, true);
  }
  const fatCount = hv.getUint32(44, true);
  if (fatIds.length < fatCount || fatCount > 1024) throw invalid();
  const fat = new Uint32Array(fatCount * sectorSize / 4);
  for (let i = 0; i < fatCount; i++) { const fv = view(await sector(fatIds[i])); for (let j = 0; j < sectorSize / 4; j++) fat[i * sectorSize / 4 + j] = fv.getUint32(j * 4, true); }
  function chain(start: number, table: Uint32Array, cap: number) {
    const ids: number[] = [], seen = new Set<number>();
    for (let id = start; id !== 0xfffffffe;) { if (id >= table.length || id >= 0xfffffffa || seen.has(id) || ids.length >= cap) throw invalid(); seen.add(id); ids.push(id); id = table[id]; }
    return ids;
  }
  async function regular(ids: number[], size: number) {
    if (size > EXPANDED || ids.length * sectorSize < size) throw new AppError("TOO_COMPLEX", "한글 문서 본문이 너무 커요.", 413);
    const result = new Uint8Array(size);
    for (let i = 0; i * sectorSize < size; i++) result.set((await sector(ids[i])).subarray(0, Math.min(sectorSize, size - i * sectorSize)), i * sectorSize);
    return result;
  }
  const directoryIds = chain(hv.getUint32(48, true), fat, Math.ceil(2 * 1024 * 1024 / sectorSize));
  const directory = await regular(directoryIds, directoryIds.length * sectorSize), dv = view(directory);
  const entries: { name: string; type: number; left: number; right: number; child: number; start: number; size: number }[] = [];
  for (let pos = 0; pos + 128 <= directory.length; pos += 128) {
    const nameLength = dv.getUint16(pos + 64, true);
    if (nameLength > 64 || nameLength % 2) throw invalid();
    const size = dv.getUint32(pos + 120, true) + dv.getUint32(pos + 124, true) * 2 ** 32;
    entries.push({ name: new TextDecoder("utf-16le").decode(directory.subarray(pos, pos + Math.max(0, nameLength - 2))), type: directory[pos + 66], left: dv.getUint32(pos + 68, true), right: dv.getUint32(pos + 72, true), child: dv.getUint32(pos + 76, true), start: dv.getUint32(pos + 116, true), size });
  }
  const root = entries[0]; if (!root || root.type !== 5) throw invalid();
  const paths = new Map<string, typeof root>();
  const visited = new Set<number>();
  function walk(id: number, parent: string) { if (id === 0xffffffff) return; if (id >= entries.length || visited.has(id) || visited.size > 10000) throw invalid(); visited.add(id); const entry = entries[id]; walk(entry.left, parent); const path = parent + entry.name; paths.set(path, entry); if (entry.type === 1) walk(entry.child, path + "/"); walk(entry.right, parent); }
  walk(root.child, "");
  const miniFatIds = hv.getUint32(64, true) ? chain(hv.getUint32(60, true), fat, 1024) : [];
  const miniFatData = await regular(miniFatIds, miniFatIds.length * sectorSize), mv = view(miniFatData);
  const miniFat = new Uint32Array(miniFatData.length / 4); for (let i = 0; i < miniFat.length; i++) miniFat[i] = mv.getUint32(i * 4, true);
  const rootIds = root.size ? chain(root.start, fat, maxSectors + 1) : [];
  async function stream(entry: typeof root) {
    if (entry.size > EXPANDED) throw new AppError("TOO_COMPLEX", "한글 문서 본문이 너무 커요.", 413);
    if (entry.size >= 4096) return regular(chain(entry.start, fat, Math.ceil(EXPANDED / sectorSize)), entry.size);
    if (!entry.size) return new Uint8Array();
    const ids = chain(entry.start, miniFat, 64), result = new Uint8Array(entry.size);
    if (ids.length * miniSize < entry.size) throw invalid();
    for (let i = 0; i * miniSize < entry.size; i++) { const miniOffset = ids[i] * miniSize, rootIndex = Math.floor(miniOffset / sectorSize); if (rootIndex >= rootIds.length || miniOffset + miniSize > root.size) throw invalid(); const data = await sector(rootIds[rootIndex]); result.set(data.subarray(miniOffset % sectorSize, miniOffset % sectorSize + Math.min(miniSize, entry.size - i * miniSize)), i * miniSize); }
    return result;
  }
  const fileHeader = paths.get("FileHeader"); if (!fileHeader) throw invalid();
  const file = await stream(fileHeader); if (file.length < 40 || !new TextDecoder().decode(file.subarray(0, 17)).startsWith("HWP Document File")) throw invalid();
  const flags = view(file).getUint32(36, true); if (flags & 6) throw new AppError("PROTECTED_DOCUMENT", "암호화·배포용 한글 문서는 일반 PDF나 HWPX로 저장해 주세요.", 422);
  const sections = [...paths.entries()].filter(([p]) => /^BodyText\/Section\d+$/.test(p)).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  if (!sections.length) throw invalid();
  const texts: string[] = []; let expanded = 0;
  for (const [, entry] of sections) { const data = await stream(entry), plain = flags & 1 ? inflateBounded(data) : data; expanded += plain.length; if (expanded > EXPANDED) throw new AppError("TOO_COMPLEX", "한글 문서 본문이 너무 커요.", 413); texts.push(hwpRecordText(plain)); }
  return { text: texts.join("\n\n").trim(), format: "HWP", warnings: ["HWP 5 본문을 추출했습니다. 삽입된 그림, 수식과 표 배치는 완전히 재현되지 않아요."] };
}
export async function extractTextRange(source: ByteSource, extension: string, startByte = 0): Promise<RangeExtracted> {
  if (startByte >= source.size) throw new AppError("INVALID_OFFSET", "파일의 읽기 범위를 초과했어요.");
  const first = await source.read(0, Math.min(512, source.size));
  const utf16 = first[0] === 0xff && first[1] === 0xfe;
  if (first.includes(0) && !utf16) throw new AppError("BINARY_FILE", "텍스트 파일로 읽을 수 없어요.", 422);
  let encoding = "utf-8";
  if (utf16) { encoding = "utf-16le"; if (startByte % 2) throw new AppError("INVALID_OFFSET", "짝수 바이트에서 이어서 읽어 주세요."); }
  else { try { new TextDecoder("utf-8", { fatal: true }).decode(first, { stream: true }); } catch { encoding = "euc-kr"; } }
  const length = Math.min(512 * 1024, source.size - startByte), data = await source.read(startByte, length);
  const decoder = new TextDecoder(encoding);
  const text = decoder.decode(data, { stream: length < source.size - startByte });
  // Keep an incomplete multibyte character for the next window.
  let carry = 0;
  if (encoding === "utf-16le" && startByte + length < source.size && data.length >= 2) { const last = data[data.length - 2] | (data[data.length - 1] << 8); if (last >= 0xd800 && last <= 0xdbff) carry = 2; }
  if (encoding === "utf-8" && startByte + length < source.size) { let last = data.length - 1; while (last >= data.length - 4 && (data[last] & 0xc0) === 0x80) last--; const lead = data[last], expected = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1; if (data.length - last < expected) carry = data.length - last; }
  if (encoding === "euc-kr" && startByte + length < source.size) { let i = 0; while (i < data.length) i += data[i] >= 0x80 ? 2 : 1; if (i > data.length) carry = 1; }
  const next = startByte + length - carry;
  return { text, format: extension.toUpperCase(), startByte, nextStartByte: next < source.size ? next : null, warnings: [] };
}
