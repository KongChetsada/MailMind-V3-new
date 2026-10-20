"use client";

import { useMemo } from "react";
import DOMPurify from "isomorphic-dompurify";

const SAFE_IMAGE_SRC = /^(https?:|data:image\/)/i;

/** ปรับแต่งหลังกรอง: ลิงก์เปิดแท็บใหม่ รูปไม่ส่ง referrer และไม่โหลดจนกว่าจะเลื่อนถึง */
const afterSanitize = (node: Element) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src") || "";
    // cid: ที่ฝังไม่สำเร็จ หรือ scheme อื่น ไม่ต้องโหลด
    if (!SAFE_IMAGE_SRC.test(src)) node.removeAttribute("src");
    node.setAttribute("referrerpolicy", "no-referrer");
    node.setAttribute("loading", "lazy");
  }
};

/**
 * แสดงเนื้อหาอีเมลอย่างปลอดภัย
 * - ตัดสคริปต์ ฟอร์ม iframe และสไตล์ที่จะกระทบหน้าเว็บ
 * - แสดงรูปภาพทั้งรูปที่แนบในเมลและรูปจากเว็บภายนอก (ผู้ส่งที่ฝังรูปติดตามจะรู้ว่าเปิดอ่าน)
 * - ลิงก์เปิดในแท็บใหม่
 */
export default function MessageBody({ html, text }: { html: string; text: string }) {
  const safeHtml = useMemo(() => {
    if (!html) return "";
    DOMPurify.addHook("afterSanitizeAttributes", afterSanitize);
    try {
      return DOMPurify.sanitize(html, {
        FORBID_TAGS: ["style", "script", "video", "audio", "iframe", "form", "input", "button", "link", "meta"],
        FORBID_ATTR: ["style", "srcset", "background"],
      });
    } finally {
      DOMPurify.removeHook("afterSanitizeAttributes");
    }
  }, [html]);

  if (safeHtml) {
    return (
      <div
        className="email-body max-w-none overflow-x-auto text-sm leading-relaxed text-slate-700 [&_a]:text-blue-600 [&_a]:underline [&_img]:inline-block [&_img]:h-auto [&_img]:max-w-full [&_p]:my-2 [&_table]:my-2 [&_td]:pr-3 [&_td]:align-top [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }
  return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{text || "(ไม่มีเนื้อหา)"}</div>;
}
