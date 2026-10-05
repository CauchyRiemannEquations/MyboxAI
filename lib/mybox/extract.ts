import { Inflate, unzipSync } from "fflate";
import * as CFB from "cfb";
import { AppError } from "./errors";
const MAX_EXPANDED = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 1_000_000;
export interface ExtractOptions { startPage?: number; pageCount?: number }
export interface Extracted { text: string; format: string; warnings: string[]; totalPages?: number; startPage?: number; endPage?: number; nextStartPage?: number | null }
function entities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    const lookup: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (lookup[entity]) return lookup[entity];
    const code = entity.toLowerCase().startsWith("#x") ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}
export function xmlText(xml: string, format: string): Extracted {
  const fragments: string[] = [];
  const tokens = /<(?:w|hp|h|a):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|hp|h|a):t>|<\/(?:w|hp|h):p\s*>|<(?:w|hp):(?:tab|br|lineBreak)\b[^>]*\/>|<(?:hp|h):script(?:\s[^>]*)?>([\s\S]*?)<\/(?:hp|h):script>/g;
  for (const match of xml.matchAll(tokens)) {
    if (match[1] !== undefined) fragments.push(entities(match[1].replace(/<[^>]*>/g, "")));
    else if (match[2] !== undefined) fragments.push(`[수식: ${entities(match[2])}]`);
    else fragments.push(match[0].includes(":tab") ? "\t" : "\n");
  }
  return { text: fragments.join(""), format, warnings: ["텍스트를 추출한 결과입니다. 표의 배치, 그림, 일부 수식은 원문과 다를 수 있습니다."] };
}
function zipDocument(bytes: Uint8Array, extension: string) {
  let total = 0;
  const files = unzipSync(bytes, { filter: entry => {
    const selected = extension === "docx" ? entry.name === "word/document.xml" : /^Contents\/section\d+\.xml$/i.test(entry.name);
    if (!selected) return false;
    total += entry.originalSize;
    if (total > MAX_EXPANDED) throw new AppError("TOO_COMPLEX", "문서 내용이 너무 커서 읽기를 중단했어요.", 413);
    return true;
  } });
  const names = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!names.length) throw new AppError("INVALID_DOCUMENT", "문서 구조를 읽을 수 없어요. 암호화 여부를 확인해 주세요.");
  const result = xmlText(names.map(n => new TextDecoder().decode(files[n])).join("\n"), extension.toUpperCase());
  if (result.text.length > MAX_TEXT_CHARS) throw new AppError("TOO_COMPLEX", "문서 내용이 너무 커요.", 413);
  return result;
}
export function inflateBounded(bytes: Uint8Array) {
  const parts: Uint8Array[] = [];
  let size = 0;
  const decoder = new Inflate(chunk => {
    size += chunk.length;
    if (size > MAX_EXPANDED) throw new AppError("TOO_COMPLEX", "문서 압축을 해제할 수 있는 크기를 초과했어요.", 413);
    parts.push(chunk);
  });
  for (let i = 0; i < bytes.length; i += 1024) decoder.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
export function hwpRecordText(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fragments: string[] = [];
  let position = 0;
  let characters = 0;
  while (position + 4 <= bytes.length) {
    const header = view.getUint32(position, true);
    position += 4;
    const tag = header & 0x3ff;
    let size = header >>> 20;
    if (size === 0xfff) { if (position + 4 > bytes.length) throw new AppError("INVALID_DOCUMENT", "한글 문서가 손상된 것 같아요."); size = view.getUint32(position, true); position += 4; }
    if (position + size > bytes.length) throw new AppError("INVALID_DOCUMENT", "한글 문서가 손상된 것 같아요.");
    if (tag === 67) {
      const text: string[] = [];
      for (let offset = position; offset + 2 <= position + size; offset += 2) {
        const character = view.getUint16(offset, true);
        if (character === 9) { text.push("\t"); offset += 14; }
        else if (character === 10 || character === 13) text.push("\n");
        else if ([1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].includes(character)) offset += 14;
        else if (character === 24) text.push("-");
        else if (character === 30 || character === 31) text.push(" ");
        else if (character >= 32) text.push(String.fromCharCode(character));
      }
      const paragraph = text.join("");
      characters += paragraph.length;
      if (characters > MAX_TEXT_CHARS) throw new AppError("TOO_COMPLEX", "문서 내용이 너무 커요.", 413);
      fragments.push(paragraph);
    }
    position += size;
  }
  return fragments.join("\n");
}
function hwpDocument(bytes: Uint8Array): Extracted {
  const compound = CFB.read(bytes, { type: "array" });
  const header = CFB.find(compound, "FileHeader")?.content;
  if (!header || header.length < 40 || !new TextDecoder().decode(new Uint8Array(header).subarray(0, 17)).startsWith("HWP Document File")) throw new AppError("INVALID_DOCUMENT", "HWP 5 문서만 지원해요. HWPX 또는 PDF로 저장해 주세요.");
  const flags = new DataView(new Uint8Array(header).buffer).getUint32(36, true);
  if (flags & (2 | 4)) throw new AppError("PROTECTED_DOCUMENT", "암호화·배포용 한글 문서는 읽을 수 없어요. 일반 HWPX나 PDF로 저장해 주세요.");
  const sections = compound.FullPaths.map((path, i) => ({ path, entry: compound.FileIndex[i] })).filter(x => /\/BodyText\/Section\d+$/.test(x.path)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  if (!sections.length) throw new AppError("INVALID_DOCUMENT", "한글 문서의 본문을 찾을 수 없어요.");
  let expanded = 0;
  const texts = sections.map(({ entry }) => {
    const data = new Uint8Array(entry.content);
    const plain = flags & 1 ? inflateBounded(data) : data;
    expanded += plain.length;
    if (expanded > MAX_EXPANDED) throw new AppError("TOO_COMPLEX", "문서 내용이 너무 커요.", 413);
    return hwpRecordText(plain);
  });
  return { text: texts.join("\n\n"), format: "HWP", warnings: ["HWP 5의 본문 텍스트를 추출했습니다. 수식·그림·표의 배치는 완전히 재현되지 않습니다."] };
}
export async function extractDocument(name: string, bytes: Uint8Array, options: ExtractOptions = {}): Promise<Extracted> {
  const extension = name.toLowerCase().split(".").pop() || "";
  try {
    let result: Extracted;
    if (extension === "pdf") {
      const { getDocumentProxy } = await import("unpdf");
      const config: NonNullable<Parameters<typeof getDocumentProxy>[1]> & { isEvalSupported: boolean; maxImageSize: number; stopAtErrors: boolean } = { isEvalSupported: false, maxImageSize: 1_000_000, stopAtErrors: true };
      const pdf = await getDocumentProxy(bytes, config);
      try {
        const start = options.startPage || 1;
        if (start > pdf.numPages) throw new AppError("INVALID_PAGE", `이 문서는 ${pdf.numPages}쪽까지 있어요.`);
        const end = Math.min(pdf.numPages, start + (options.pageCount || 15) - 1);
        const pages: string[] = [];
        let characters = 0;
        for (let pageNumber = start; pageNumber <= end; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
          characters += text.length;
          if (characters > MAX_TEXT_CHARS) throw new AppError("TOO_COMPLEX", "문서 내용이 너무 커요.", 413);
          pages.push(`[${pageNumber}쪽]\n${text}`);
          page.cleanup();
        }
        result = { text: pages.join("\n\n"), format: "PDF", totalPages: pdf.numPages, startPage: start, endPage: end, nextStartPage: end < pdf.numPages ? end + 1 : null, warnings: ["텍스트가 있는 PDF만 읽을 수 있습니다. 스캔 이미지와 수식·그림은 별도 확인이 필요합니다."] };
      } finally { await pdf.loadingTask.destroy(); }
    } else if (extension === "docx" || extension === "hwpx") result = zipDocument(bytes, extension);
    else if (extension === "hwp") result = hwpDocument(bytes);
    else if (["txt", "md", "csv", "json", "log", "tsv", "xml", "yaml", "yml"].includes(extension)) {
      if (bytes.subarray(0, 512).includes(0) && !(bytes[0] === 0xff && bytes[1] === 0xfe)) throw new AppError("BINARY_FILE", "텍스트 문서로 읽을 수 없는 파일이에요.");
      let text: string;
      if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder("utf-16le").decode(bytes);
      else { try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { text = new TextDecoder("euc-kr").decode(bytes); } }
      if (text.length > MAX_TEXT_CHARS) throw new AppError("TOO_COMPLEX", "문서 내용이 너무 커요.", 413);
      result = { text, format: extension.toUpperCase(), warnings: [] };
    } else throw new AppError("UNSUPPORTED_FORMAT", "PDF, HWP, HWPX, DOCX 또는 텍스트 파일을 선택해 주세요.", 422);
    const text = result.text.replace(/\u0000/g, "").replace(/\n{4,}/g, "\n\n\n").trim();
    if (!text || (result.format === "PDF" && !text.replace(/\[\d+쪽\]/g, "").trim())) throw new AppError("NO_TEXT", "추출할 텍스트가 없어요. 스캔 문서는 OCR이 필요해요.", 422);
    return { ...result, text };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("EXTRACTION_FAILED", "이 문서의 내용을 읽지 못했어요. 암호화 여부를 확인하거나 PDF·HWPX로 저장해 주세요.", 422);
  }
}
