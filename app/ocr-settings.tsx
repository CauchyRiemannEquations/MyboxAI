"use client";
import { useState } from "react";
import { ScanText, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
export type OcrStatus = { enabled: boolean; daily_limit: number; pages_today: number; max_pages_per_read: number; cache_days: number };
export default function OcrSettings({ status, onChange, onError }: { status: OcrStatus; onChange: (value: OcrStatus) => void; onError: (message: string) => void }) {
  const [key, setKey] = useState("");
  const [limit, setLimit] = useState(String(status.daily_limit));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); onError("");
    try {
      const response = await fetch("/api/mybox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ocr", key, daily_limit: Number(limit), consent }) });
      const data = await response.json() as { ocr: OcrStatus; message?: string };
      if (!response.ok) throw new Error(data.message || "OCR 연결을 확인해 주세요.");
      setKey(""); setConsent(false); setEditing(false); onChange(data.ocr);
    } catch (error) { onError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); onError("");
    try {
      const response = await fetch("/api/mybox?action=ocr", { method: "DELETE" });
      const data = await response.json() as { ocr: OcrStatus; message?: string };
      if (!response.ok) throw new Error(data.message || "OCR 해제를 완료하지 못했어요.");
      onChange(data.ocr); setKey(""); setConsent(false); setEditing(false);
    } catch (error) { onError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="ocr-card" aria-label="자동 OCR 설정">
    <div className="ocr-heading"><div><span className="section-label"><ScanText size={18} />스캔 PDF · 사진 읽기</span><h2>자동 OCR <span className={`status-pill ${status.enabled ? "connected" : ""}`}>{status.enabled ? "사용 중" : "설정 필요"}</span></h2><p>스캔으로 보이는 쪽을 Mistral OCR 4.1로 읽습니다. 수식이 빠지면 문서에서 OCR로 다시 읽을 수 있어요.</p></div>{status.enabled && <Button variant="outline" onClick={() => setEditing(!editing)} disabled={busy}>OCR 관리</Button>}</div>
    {status.enabled && <div className="ocr-usage"><strong>오늘 {status.pages_today} / {status.daily_limit}쪽</strong><span>하루 한도 · UTC 자정 초기화 · 한 번에 최대 5쪽 · 결과 7일 캐시</span></div>}
    {(!status.enabled || editing) && <form onSubmit={save} className="ocr-form">
      <div className="ocr-fields"><div><label htmlFor="ocr-key">Mistral API 키 {status.enabled && <small>교체할 때만 입력</small>}</label><Input id="ocr-key" type="password" autoComplete="off" spellCheck={false} placeholder={status.enabled ? "저장된 키 사용" : "Mistral API 키"} value={key} onChange={event => setKey(event.target.value)} maxLength={512} required={!status.enabled} /></div><div><label htmlFor="ocr-limit">하루 처리 한도 (쪽)</label><Input id="ocr-limit" type="number" min={1} max={500} value={limit} onChange={event => setLimit(event.target.value)} required /></div></div>
      <p className="ocr-cost">Mistral API 사용료는 ChatGPT 구독과 별도입니다. 실패한 요청도 앱의 처리 한도에 포함하며, 실제 청구는 Mistral 사용량에서 확인하세요. <a href="https://console.mistral.ai" target="_blank" rel="noopener noreferrer">API 키 만들기</a> · <a href="https://docs.mistral.ai/inference/pricing" target="_blank" rel="noopener noreferrer">공식 요금 확인</a></p>
      <label className="ocr-consent"><Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} /><span>OCR을 위해 문서 전체의 임시 다운로드 주소가 Mistral에 전달되고, 지정한 쪽 처리에 별도 API 요금이 발생할 수 있음에 동의합니다.</span></label>
      <div className="ocr-buttons"><Button type="submit" disabled={busy || !consent || (!status.enabled && !key.trim())}>{busy ? <LoaderCircle className="spin" size={17} /> : <ScanText size={17} />}{status.enabled ? "설정 저장" : "자동 OCR 연결"}</Button>{status.enabled && <Button type="button" variant="outline" disabled={busy} onClick={() => void remove()}>OCR 사용 해제</Button>}</div>
      <div className="security-note"><ShieldCheck size={17} /><span>API 키와 OCR 캐시는 암호화해 저장합니다. MYBOX 토큰은 Mistral에 전달하지 않아요.</span></div>
    </form>}
  </section>;
}
