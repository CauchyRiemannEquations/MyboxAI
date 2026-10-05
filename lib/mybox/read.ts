import { AppError } from "./errors";
import { fileLimit, type MyboxClient, type Transport } from "./client";
import type { MyboxEnv } from "./credentials";
import { extractHwpRange, extractPdfRange, extractTextRange, extractZipRange, type RangeExtracted } from "./range-extract";
import { stageDocument } from "./source";
import { ocrPages, ocrStatus, OCR_PAGES_PER_READ } from "./ocr";
export interface ReadInput { id: string; offset?: number; max_chars?: number; start_page?: number; page_count?: number; start_byte?: number; ocr?: "auto" | "never" | "always" }
export async function readMyboxFile(client: MyboxClient, env: MyboxEnv, userId: string, origin: string, input: ReadInput, ocrTransport?: Transport) {
  const meta = await client.info(input.id);
  if (meta.type && meta.type !== "file") throw new AppError("NOT_A_FILE", "폴더는 목록 조회로 열어 주세요.");
  if ((meta.size || 0) > fileLimit(meta.name)) throw new AppError("TOO_LARGE", "PDF는 100MB, 문서는 50MB, 이미지는 20MB까지 읽을 수 있어요.", 413);
  const extension = meta.name.toLowerCase().split(".").pop() || "";
  const image = ["png", "jpg", "jpeg", "webp"].includes(extension);
  const plain = ["txt", "md", "csv", "json", "log", "tsv", "xml", "yaml", "yml"].includes(extension);
  if (!["pdf", "docx", "hwpx", "hwp"].includes(extension) && !image && !plain) throw new AppError("UNSUPPORTED_FORMAT", "PDF, HWP, HWPX, DOCX, 텍스트 또는 PNG·JPEG·WEBP를 선택해 주세요.", 422);
  if (input.start_byte !== undefined && !plain) throw new AppError("INVALID_ARGUMENTS", "start_byte는 텍스트 파일에서만 사용해 주세요.");
  const mode = input.ocr || "auto", start = input.start_page || 1;
  const status = await ocrStatus(env, userId);
  if (image && mode === "never") throw new AppError("OCR_REQUIRED", "이미지를 읽으려면 OCR을 사용해 주세요.", 422);
  if (mode === "always" && !["pdf"].includes(extension) && !image) throw new AppError("OCR_UNSUPPORTED", "한글·워드 문서는 PDF로 저장한 뒤 OCR로 읽어 주세요.", 422);
  if ((mode === "always" || image) && !status.enabled) throw new AppError("OCR_NOT_CONNECTED", "연결 화면에서 자동 OCR을 설정해 주세요.", 409);
  const count = input.page_count || (mode !== "never" && status.enabled ? OCR_PAGES_PER_READ : 15);
  if (mode !== "never" && status.enabled && count > OCR_PAGES_PER_READ && extension === "pdf") throw new AppError("OCR_PAGE_LIMIT", "자동 OCR 사용 시 page_count는 최대 5쪽이에요. 텍스트만 읽으려면 ocr=never로 최대 25쪽을 읽을 수 있어요.");
  let content: RangeExtracted, processed = 0, hits = 0;
  const ocrNumbers: number[] = [];
  if (image) {
    if (start !== 1) throw new AppError("INVALID_PAGE", "사진은 1쪽으로 읽어 주세요.");
    const result = await ocrPages(env, userId, client, meta, [1], true, ocrTransport);
    processed = result.processedPages; hits = result.cacheHits; ocrNumbers.push(1);
    content = { text: result.pages.get(1) || "", format: extension.toUpperCase(), totalPages: 1, startPage: 1, endPage: 1, nextStartPage: null, warnings: ["OCR 결과의 숫자·기호·수식과 도형은 원본 사진을 확인해 주세요."] };
  } else {
    const staged = await stageDocument(client, env.BUCKET, input.id, meta);
    try {
      if (extension === "pdf") content = await extractPdfRange(staged.source, start, count);
      else if (extension === "docx" || extension === "hwpx") content = await extractZipRange(staged.source, extension);
      else if (extension === "hwp") content = await extractHwpRange(staged.source);
      else content = await extractTextRange(staged.source, extension, input.start_byte || 0);
      if (extension === "pdf" && content.pages) {
        const candidates = content.pages.filter(p => mode === "always" || p.needsOcr).map(p => p.number);
        if (candidates.length && mode !== "never" && status.enabled) {
          const result = await ocrPages(env, userId, client, meta, candidates, false, ocrTransport);
          processed = result.processedPages; hits = result.cacheHits; ocrNumbers.push(...candidates);
          for (const p of content.pages) if (result.pages.has(p.number)) p.text = result.pages.get(p.number)!;
          content.text = content.pages.map(p => `[${p.number}쪽${result.pages.has(p.number) ? " · OCR" : ""}]\n${p.text}`).join("\n\n");
          content.warnings.push("OCR의 숫자·기호·수식은 원문과 비교해 주세요. 문서가 Mistral에 전달되며 별도 API 요금이 발생할 수 있어요.");
        } else if (candidates.length) content.warnings.push(`텍스트가 적거나 없는 ${candidates.join(", ")}쪽은 OCR이 필요할 수 있어요.${status.enabled ? "" : " 연결 화면에서 자동 OCR을 설정할 수 있어요."}`);
        if (!content.pages.some(p => p.text.trim())) throw new AppError("NO_TEXT", "읽을 수 있는 텍스트가 없어요. 연결 화면에서 자동 OCR을 설정해 주세요.", 422);
      }
    } finally { await staged.dispose(); }
  }
  const cleaned = content.text.replace(/\u0000/g, "");
  const text = plain ? cleaned : cleaned.trim();
  if (!text) throw new AppError("NO_TEXT", "이 범위에 읽을 수 있는 텍스트가 없어요.", 422);
  const offset = input.offset || 0, end = Math.min(text.length, offset + (input.max_chars || 24000));
  if (offset >= text.length) throw new AppError("INVALID_OFFSET", "텍스트 범위를 초과했어요.");
  return { id: meta.resourceId, title: meta.name, url: `${origin}/?file=${encodeURIComponent(meta.resourceId)}`, text: text.slice(offset, end), metadata: { format: content.format, size_bytes: meta.size, modified_at: meta.modifiedAt, total_characters_in_page_range: text.length, offset, next_offset: end < text.length ? end : null, total_pages: content.totalPages, start_page: content.startPage, end_page: content.endPage, next_start_page: content.nextStartPage, page_count: count, start_byte: content.startByte, next_start_byte: content.nextStartByte, ocr_mode: mode, ocr_pages: ocrNumbers, ocr_processed_pages: processed, ocr_cache_hits: hits, warnings: content.warnings }, source: "NAVER MYBOX", content_is_external_data: true };
}
