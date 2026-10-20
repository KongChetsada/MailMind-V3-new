"use client";

import { useEffect, useState } from "react";
import { Download, FileText, ImageOff, Paperclip } from "lucide-react";
import { Spinner } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import type { Attachment } from "@/lib/types";

// รูปที่แสดงตัวอย่างได้ (ต้องตรงกับ PREVIEWABLE ใน Backend — SVG ให้ดาวน์โหลดแทน)
const PREVIEWABLE = /^image\/(jpeg|png|gif|webp|bmp)$/i;
// รูปที่ใหญ่กว่านี้ไม่โหลดเอง ผู้ใช้กดแสดงเอง
const AUTO_PREVIEW_BYTES = 15 * 1024 * 1024;

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** รูปแนบหนึ่งรูป: ดึงเป็น Blob พร้อม token แล้วแสดง คลิกเพื่อเปิดขนาดเต็มในแท็บใหม่ */
function ImagePreview({ emailId, messageId, file }: { emailId: string; messageId: string; file: Attachment }) {
  const [requested, setRequested] = useState(file.size <= AUTO_PREVIEW_BYTES);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requested) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    api.emails
      .attachment(emailId, messageId, file.partId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => !cancelled && setError(errorMessage(e, "โหลดรูปไม่สำเร็จ")));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requested, emailId, messageId, file.partId]);

  return (
    <figure className="w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="flex min-h-24 items-center justify-center">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" title="เปิดขนาดเต็ม">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL ที่สร้างในเบราว์เซอร์ ใช้ next/image ไม่ได้ */}
            <img src={url} alt={file.filename} className="max-h-72 w-auto max-w-full object-contain" />
          </a>
        ) : error ? (
          <p className="flex items-center gap-1.5 p-4 text-xs text-rose-600">
            <ImageOff className="h-4 w-4" /> {error}
          </p>
        ) : requested ? (
          <Spinner className="h-5 w-5 text-slate-400" />
        ) : (
          <button onClick={() => setRequested(true)} className="p-4 text-xs font-semibold text-blue-600 hover:underline">
            แสดงรูป ({formatSize(file.size)})
          </button>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-500">
        <span className="truncate">{file.filename || "รูปภาพ"}</span>
        <span className="shrink-0">{formatSize(file.size)}</span>
      </figcaption>
    </figure>
  );
}

/** ไฟล์อื่น: ปุ่มดาวน์โหลด */
function FileChip({ emailId, messageId, file }: { emailId: string; messageId: string; file: Attachment }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await api.emails.attachment(emailId, messageId, file.partId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename || "attachment";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(errorMessage(e, "ดาวน์โหลดไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-sm items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-700">{file.filename || "ไฟล์แนบ"}</p>
        <p className={error ? "text-[11px] text-rose-600" : "text-[11px] text-slate-400"}>{error || formatSize(file.size)}</p>
      </div>
      <button onClick={download} disabled={busy} title="ดาวน์โหลด" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50">
        {busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** ไฟล์แนบของข้อความหนึ่งฉบับ */
export default function Attachments({ emailId, messageId, files }: { emailId: string; messageId: string; files: Attachment[] }) {
  if (!files.length) return null;
  const images = files.filter((f) => PREVIEWABLE.test(f.mimeType));
  const others = files.filter((f) => !PREVIEWABLE.test(f.mimeType));
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
        <Paperclip className="h-3.5 w-3.5" /> ไฟล์แนบ {files.length} ไฟล์
      </p>
      <div className="flex flex-wrap gap-2">
        {images.map((f) => (
          <ImagePreview key={f.partId} emailId={emailId} messageId={messageId} file={f} />
        ))}
        {others.map((f) => (
          <FileChip key={f.partId} emailId={emailId} messageId={messageId} file={f} />
        ))}
      </div>
    </div>
  );
}
