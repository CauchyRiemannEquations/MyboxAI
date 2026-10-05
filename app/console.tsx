"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, Link2, ShieldCheck, Search, Folder, FileText, RefreshCw, LockKeyhole, Check, Copy, LoaderCircle, Unplug, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import OcrSettings, { type OcrStatus } from "./ocr-settings";

type Status = { connected: boolean; connected_at?: string; ocr?: OcrStatus };
type Item = { id: string; title: string; name: string; size?: number; type?: string; modifiedAt?: string; parentPath?: string };
type Page = { results: Item[]; next_cursor: string | null };
type Storage = { quotaBytes: number; usedBytes: number; fileCounts?: { total: number } };
type DocumentResult = { id: string; title: string; text: string; metadata: { format: string; warnings: string[]; next_offset?: number | null; start_page?: number; end_page?: number; next_start_page?: number | null; total_pages?: number; page_count?: number; start_byte?: number; next_start_byte?: number | null; ocr_mode?: string; ocr_pages?: number[]; ocr_processed_pages?: number; ocr_cache_hits?: number } };
type Crumb = { id: string; name: string };
async function api<T>(action: string, args: Record<string, string | number> = {}): Promise<T> {
  const query = new URLSearchParams({ action });
  for (const [key, value] of Object.entries(args)) query.set(key, String(value));
  const response = action === "read" ? await fetch("/api/mybox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...args }) }) : await fetch(`/api/mybox?${query}`, { cache: "no-store" });
  const data = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(data.message || "연결을 확인해 주세요.");
  return data as T;
}
function bytes(value = 0) { if (!value) return "0 B"; const index = Math.min(3, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${["B", "KB", "MB", "GB"][index]}`; }
function date(value?: string) { if (!value) return "—"; return new Date(value).toLocaleDateString("ko-KR"); }

export default function Console({ displayName }: { displayName: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [storage, setStorage] = useState<Storage | null>(null);
  const [page, setPage] = useState<Page>({ results: [], next_cursor: null });
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [activeSearch, setActiveSearch] = useState<{ query: string; filter: string } | null>(null);
  const [document, setDocument] = useState<DocumentResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const currentOperation = useRef(0);

  const openFile = useCallback(async (id: string, extra: Record<string, string | number> = {}) => {
    setBusy("read"); setNotice(""); setSheetOpen(true);
    try { const result = await api<DocumentResult>("read", { id, ...extra }); setDocument(result); setSheetOpen(true); void api<Status>("status").then(setStatus).catch(() => {}); return { id: result.id, title: result.title, text: result.text, metadata: result.metadata }; }
    catch (error) { setNotice((error as Error).message); throw error; }
    finally { setBusy(null); }
  }, []);

  const browse = useCallback(async (path: Crumb[], search: { query: string; filter: string } | null = null, cursor?: string) => {
    const operation = ++currentOperation.current;
    setBusy("files"); setNotice("");
    try {
      const args: Record<string, string> = cursor ? { cursor } : {};
      if (search) { args.query = search.query; if (search.filter !== "all") args.category = search.filter; }
      else if (path.length) args.folder_id = path[path.length - 1].id;
      const result = await api<Page>(search ? "search" : "list", args);
      if (operation !== currentOperation.current) return result;
      setPage(previous => cursor ? { ...result, results: [...previous.results, ...result.results] } : result);
      setCrumbs(path); setActiveSearch(search);
      return result;
    } catch (error) { if (operation === currentOperation.current) setNotice((error as Error).message); throw error; }
    finally { if (operation === currentOperation.current) setBusy(null); }
  }, []);

  const initialize = useCallback(async () => {
    setLoading(true); setNotice("");
    try {
      const result = await api<Status>("status");
      setStatus(result);
      if (result.connected) {
        await browse([]);
        try { setStorage(await api<Storage>("storage")); } catch (error) { setNotice((error as Error).message); setSettings(true); }
        const linkedFile = new URLSearchParams(window.location.search).get("file");
        if (linkedFile) await openFile(linkedFile);
      }
    } catch (error) { setNotice((error as Error).message); }
    finally { setLoading(false); }
  }, [browse, openFile]);
  useEffect(() => { void initialize(); }, [initialize]);

  useEffect(() => {
    const context = (window.document as Document & { modelContext?: { registerTool: (tool: object, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool || !status?.connected) return;
    const lifecycle = new AbortController();
    const tools = [
      { name: "search_mybox_files", title: "MYBOX 파일 검색", description: "파일 이름으로 검색하고 현재 화면에 검색 결과를 표시합니다.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }, execute: async (value: unknown) => { const input = value as { query?: string }; if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 300) throw new Error("검색어를 확인해 주세요."); setQuery(input.query); setFilter("all"); return browse([], { query: input.query, filter: "all" }); } },
      { name: "read_mybox_file", title: "MYBOX 문서 열기", description: "검색 결과의 파일 ID로 문서 텍스트를 읽고 문서 패널을 엽니다.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, execute: async (value: unknown) => { const input = value as { id?: string }; if (typeof input.id !== "string" || !input.id || input.id.length > 1024) throw new Error("파일 ID를 확인해 주세요."); return openFile(input.id); } },
    ];
    for (const tool of tools) { try { void Promise.resolve(context.registerTool({ ...tool, annotations: { readOnlyHint: true, untrustedContentHint: true } }, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Browser tools are optional; remote MCP remains available. */ } }
    return () => lifecycle.abort();
  }, [status?.connected, browse, openFile]);

  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy("connect"); setNotice("");
    try {
      const response = await fetch("/api/mybox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json() as Status & { storage: Storage; message?: string };
      if (!response.ok) throw new Error(data.message || "연결을 확인해 주세요.");
      setToken(""); setStatus(data); setStorage(data.storage); setSettings(false); await browse([]);
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(null); }
  }
  async function removeConnection() {
    setBusy("disconnect"); setNotice("");
    try {
      const response = await fetch("/api/mybox", { method: "DELETE" });
      const data = await response.json() as Status & { message?: string };
      if (!response.ok) throw new Error(data.message || "연결 해제를 완료하지 못했어요.");
      setStatus(data as Status); setStorage(null); setPage({ results: [], next_cursor: null }); setDocument(null); setSheetOpen(false); setCrumbs([]); setActiveSearch(null); setToken("");
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(null); }
  }
  async function copyPrompt() {
    try { await navigator.clipboard.writeText("MYBOX에서 미분 자료를 찾아서 내용을 요약해줘."); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { setNotice("문구를 길게 눌러 복사해 주세요: MYBOX에서 미분 자료를 찾아서 내용을 요약해줘."); }
  }
  const connected = status?.connected;
  const usedPercent = storage?.quotaBytes ? Math.min(100, storage.usedBytes / storage.quotaBytes * 100) : 0;
  return <div className="app-shell">
    <aside className="rail"><a className="rail-brand" href="/"><Cloud size={26} /><span>MYBOX<br /><small>GPT 연결</small></span></a><div className="rail-current"><Link2 size={18} />내 연결</div><div className="rail-footer"><ShieldCheck size={19} /><span>내 계정 전용<br /><small>파일 검색과 읽기</small></span></div></aside>
    <main className="workspace">
      <header className="topbar"><div><span className="eyebrow">MY FILES, IN CHATGPT</span><h1>MYBOX 연결</h1></div><span className="account" title={displayName}>{displayName}</span></header>
      <section className="connection-bar" aria-label="연결 상태"><div className="service-pair"><div className="service-name"><span className="brand-mark small">M</span><strong>MYBOX</strong></div><Link2 className="pair-link" /><div className="service-name"><span className="gpt-mark">GPT</span><strong>ChatGPT</strong></div></div><div className="connection-actions"><span className={`status-pill ${connected ? "connected" : ""}`}>{loading ? "확인 중" : connected ? "연결됨" : "연결 대기"}</span>{connected && <Button variant="outline" onClick={() => setSettings(!settings)} disabled={!!busy}>연결 관리</Button>}</div></section>
      {notice && <div className="notice" role="alert"><span>{notice}</span><Button variant="ghost" onClick={() => void initialize()} disabled={!!busy}>다시 확인</Button></div>}
      {loading && <div className="loading-state" role="status"><LoaderCircle className="spin" />연결 상태를 확인하고 있어요.</div>}
      {!loading && (!connected || settings) && <section className="setup-grid"><div className="token-card"><div className="section-label"><LockKeyhole size={18} />개인 액세스 토큰</div><h2>{connected ? "새 토큰으로 연결하기" : "내 MYBOX를 연결하세요"}</h2><p>MYBOX에서 발급한 토큰을 입력하면 파일을 검색하고 읽을 수 있어요.</p><form onSubmit={connect}><label htmlFor="mybox-token">MYBOX 토큰</label><Input id="mybox-token" type="password" placeholder="mbx_pat_…" autoComplete="off" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} className="token-input" required maxLength={2048} /><Button type="submit" disabled={!token.trim() || !!busy} className="connect-button">{busy === "connect" ? <><LoaderCircle className="spin" />MYBOX 확인 중</> : <><Link2 size={18} />{connected ? "토큰 교체하기" : "MYBOX 연결하기"}</>}</Button></form><div className="security-note"><ShieldCheck size={17} /><span>토큰은 암호화해 저장하며, GPT에는 전달하지 않아요.</span></div></div><div className="instructions-card"><span className="section-label">처음 한 번만 설정</span><ol><li><span>1</span><div><strong>MYBOX에서 토큰 만들기</strong><p>MYBOX 웹 → 설정 → 계정 및 개인 액세스 토큰 관리 → 토큰 생성</p><a href="https://developers.mybox.naver.com/getting-started" target="_blank" rel="noopener noreferrer">네이버 공식 발급 안내</a></div></li><li><span>2</span><div><strong>이 화면에서 연결하기</strong><p>발급한 토큰을 왼쪽 입력칸에 붙여 넣으세요. 만료되면 새 토큰으로 교체하면 돼요.</p></div></li><li><span>3</span><div><strong>ChatGPT에서 플러그인 설치</strong><p>이 대화의 설치 카드를 누르거나, 플러그인 → 개인 → 내가 만든 플러그인에서 설치하세요.</p></div></li></ol></div></section>}
      {!loading && connected && <>
        <OcrSettings status={status?.ocr || { enabled: false, daily_limit: 50, pages_today: 0, max_pages_per_read: 5, cache_days: 7 }} onChange={ocr => setStatus(previous => previous ? { ...previous, ocr } : previous)} onError={setNotice} /><section className="storage-strip"><div><span className="section-label">MYBOX 사용 용량</span><strong>{storage ? `${bytes(storage.usedBytes)} / ${bytes(storage.quotaBytes)}` : "용량 확인 필요"}</strong></div><Progress value={usedPercent} className="storage-progress" />{storage?.fileCounts && <span className="file-count">파일 {storage.fileCounts.total.toLocaleString()}개</span>}</section>
        <section className="browser-card"><div className="browser-title"><div><span className="section-label">FILE EXPLORER</span><h2>내 파일</h2></div><Button variant="ghost" size="icon" aria-label="파일 목록 새로고침" disabled={!!busy} onClick={() => void browse(crumbs, activeSearch).catch(() => {})}><RefreshCw size={18} className={busy === "files" ? "spin" : ""} /></Button></div><form className="search-form" onSubmit={event => { event.preventDefault(); if (!query.trim() && filter === "all") { void browse(crumbs).catch(() => {}); return; } void browse([], { query, filter }).catch(() => {}); }}><div className="search-input-wrap"><Search size={18} /><Input aria-label="파일 이름 검색" placeholder="파일 이름으로 검색" value={query} onChange={event => setQuery(event.target.value)} maxLength={300} /></div><Select value={filter} onValueChange={setFilter}><SelectTrigger aria-label="파일 종류" className="category-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">모든 파일</SelectItem><SelectItem value="document">문서</SelectItem><SelectItem value="image">사진</SelectItem><SelectItem value="video">동영상</SelectItem><SelectItem value="audio">음악</SelectItem></SelectContent></Select><Button type="submit" disabled={!!busy}>검색</Button></form><div className="breadcrumbs"><button onClick={() => { setQuery(""); setFilter("all"); void browse([]).catch(() => {}); }} disabled={!!busy}>MYBOX</button>{crumbs.map((crumb, index) => <span key={crumb.id}><ChevronRight size={14} /><button disabled={!!busy} onClick={() => void browse(crumbs.slice(0, index + 1)).catch(() => {})}>{crumb.name}</button></span>)}{activeSearch && <span className="search-result-label"><ChevronRight size={14} />검색 결과</span>}</div><Table><TableHeader><TableRow><TableHead>이름</TableHead><TableHead className="size-column">크기</TableHead><TableHead className="date-column">수정일</TableHead><TableHead className="kind-column">종류</TableHead></TableRow></TableHeader><TableBody>{page.results.map(file => <TableRow key={file.id}><TableCell><button className="file-button" disabled={!!busy} onClick={() => file.type === "folder" ? void browse([...crumbs, { id: file.id, name: file.title }]).catch(() => {}) : void openFile(file.id).catch(() => {})}>{file.type === "folder" ? <Folder className="folder-icon" size={20} /> : <FileText size={20} />}<span>{file.title}{activeSearch && file.parentPath && <small>{file.parentPath}</small>}</span></button></TableCell><TableCell className="size-column">{file.type === "folder" ? "—" : bytes(file.size)}</TableCell><TableCell className="date-column">{date(file.modifiedAt)}</TableCell><TableCell className="kind-column">{file.type === "folder" ? "폴더" : file.title.split(".").pop()?.toUpperCase()}</TableCell></TableRow>)}</TableBody></Table>{!page.results.length && <div className="empty-state"><Folder size={32} /><p>{busy === "files" ? "파일을 불러오고 있어요." : activeSearch ? "검색 결과가 없어요. 파일 이름을 바꿔서 찾아보세요." : "이 폴더에는 파일이 없어요."}</p></div>}{page.next_cursor && <div className="more-row"><Button variant="outline" disabled={!!busy} onClick={() => void browse(crumbs, activeSearch, page.next_cursor!).catch(() => {})}>파일 더 보기</Button></div>}<div className="browser-caption">파일 이름·종류로 검색합니다. 문서 본문 검색은 지원하지 않아요.</div></section>
      </>}
      {!loading && <section className="prompt-card"><div><span className="section-label">CHATGPT에서 이렇게 말해보세요</span><p>“MYBOX에서 미분 자료를 찾아서 내용을 요약해줘.”</p></div><Button variant="outline" onClick={() => void copyPrompt()}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "복사됨" : "예시 복사"}</Button></section>}
      <footer className="page-footer"><p>PDF 100MB · HWP/HWPX/DOCX/텍스트 50MB · 사진 20MB<br /><span>스캔 PDF·사진은 자동 OCR 연결 후 읽을 수 있어요. 수식·기호·도형은 원문을 확인해 주세요. 암호 폴더와 공유 받은 폴더는 MYBOX API에서 지원하지 않아요.</span></p>{connected && <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" disabled={!!busy}><Unplug size={16} />연결 해제</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>MYBOX 연결을 해제할까요?</AlertDialogTitle><AlertDialogDescription>저장된 MYBOX 토큰, OCR 키와 OCR 캐시를 삭제합니다. MYBOX 파일은 그대로 보관돼요. 네이버에서 토큰 자체를 폐기하려면 MYBOX 설정에서도 삭제해 주세요.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => void removeConnection()}>연결 해제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</footer>
    </main>
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}><SheetContent className="document-sheet"><SheetHeader><SheetTitle>{document?.title || "문서"}</SheetTitle><SheetDescription>문서에서 추출한 텍스트 · {document?.metadata.format}{document?.metadata.total_pages ? ` · ${document.metadata.start_page}–${document.metadata.end_page} / ${document.metadata.total_pages}쪽` : ""}</SheetDescription></SheetHeader><div className="document-body">{busy === "read" && <p className="document-loading" role="status"><LoaderCircle className="spin" size={18} />문서를 읽고 있어요. 큰 파일이나 OCR은 시간이 걸릴 수 있어요.</p>}{document?.metadata.format === "PDF" && <form className="page-form" key={document.id + ":" + document.metadata.start_page} onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void openFile(document.id, { start_page: Number(values.get("start")), page_count: Number(values.get("count")), ocr: String(values.get("ocr")) }).catch(() => {}); }}><label>시작 쪽<Input name="start" type="number" min={1} max={document.metadata.total_pages || 100000} defaultValue={document.metadata.start_page || 1} required /></label><label>읽을 쪽 수<Input name="count" type="number" min={1} max={25} defaultValue={Math.min(5, document.metadata.page_count || 5)} required /></label><Select name="ocr" defaultValue={document.metadata.ocr_mode || "auto"}><SelectTrigger aria-label="읽기 방식"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">자동 OCR</SelectItem><SelectItem value="never">텍스트만</SelectItem><SelectItem value="always">OCR로 읽기</SelectItem></SelectContent></Select><Button type="submit" disabled={!!busy}>쪽 읽기</Button></form>}{!!document?.metadata.ocr_pages?.length && <p className="ocr-read-info">OCR {document.metadata.ocr_pages.join(", ")}쪽 · 새 처리 {document.metadata.ocr_processed_pages || 0}쪽 · 캐시 {document.metadata.ocr_cache_hits || 0}쪽</p>}{document?.metadata.warnings.map(warning => <p className="document-warning" key={warning}>{warning}</p>)}<pre>{document?.text}</pre><div className="document-paging">{document?.metadata.next_offset != null && <Button variant="outline" disabled={!!busy} onClick={() => void openFile(document.id, { offset: document.metadata.next_offset!, ...(document.metadata.start_page ? { start_page: document.metadata.start_page, page_count: document.metadata.page_count || 5, ocr: document.metadata.ocr_mode || "auto" } : {}), ...(document.metadata.start_byte != null ? { start_byte: document.metadata.start_byte } : {}) }).catch(() => {})}>이어서 읽기</Button>}{document?.metadata.next_start_page != null && <Button variant="outline" disabled={!!busy} onClick={() => void openFile(document.id, { start_page: document.metadata.next_start_page!, page_count: document.metadata.page_count || 5, ocr: document.metadata.ocr_mode || "auto" }).catch(() => {})}>다음 쪽 읽기</Button>}{document?.metadata.next_start_byte != null && document.metadata.next_offset == null && <Button variant="outline" disabled={!!busy} onClick={() => void openFile(document.id, { start_byte: document.metadata.next_start_byte! }).catch(() => {})}>다음 텍스트 범위</Button>}{document?.metadata.format === "PDF" && status?.ocr?.enabled && <Button variant="outline" disabled={!!busy} onClick={() => void openFile(document.id, { start_page: document.metadata.start_page || 1, page_count: Math.min(5, document.metadata.page_count || 5), ocr: "always" }).catch(() => {})}>OCR로 다시 읽기</Button>}</div></div></SheetContent></Sheet>
  </div>;
}
