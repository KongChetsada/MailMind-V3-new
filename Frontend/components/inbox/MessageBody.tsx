"use client";

import { useMemo } from "react";
import DOMPurify from "isomorphic-dompurify";

/**
 * แสดงเนื้อหาอีเมลอย่างปลอดภัย
 * - ตัดสคริปต์ ฟอร์ม และรูปภาพจากภายนอก (รูปภาพมักใช้ติดตามการเปิดอ่าน)
 * - ลิงก์เปิดในแท็บใหม่
 */
export default function MessageBody({ html, text }: { html: string; text: string }) {
  const safeHtml = useMemo(() => {
    if (!html) return "";
    const clean = DOMPurify.sanitize(html, {
      FORBID_TAGS: ["style", "script", "img", "picture", "video", "audio", "iframe", "form", "input", "button", "link", "meta"],
      FORBID_ATTR: ["style", "srcset", "background"],
    });
    return clean.replace(/<a /gi, '<a target="_blank" rel="noopener noreferrer" ');
  }, [html]);

  if (safeHtml) {
    return (
      <div
        className="email-body max-w-none overflow-x-auto text-sm leading-relaxed text-slate-700 [&_a]:text-blue-600 [&_a]:underline [&_p]:my-2 [&_table]:my-2 [&_td]:pr-3 [&_td]:align-top [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }
  return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{text || "(ไม่มีเนื้อหา)"}</div>;
}
