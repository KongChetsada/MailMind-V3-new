// ทางเดียวที่หน้าเว็บเรียก Backend — component ไม่เรียก fetch เอง
import type {
  ActionItem,
  CalendarEvent,
  ConfirmMode,
  EmailCategory,
  EmailCounts,
  EmailDetail,
  EmailFilter,
  EmailListItem,
  MailAccount,
  ReplyDraft,
  ReplyIntent,
  SettingsResponse,
  Stats,
  SummaryType,
  UserProfile,
  UserSetting,
} from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000").replace(/\/+$/, "");
const TOKEN_KEY = "app_token";

export const tokenStore = {
  get: () => (typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY)),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** ข้อความสำหรับแสดงผู้ใช้จากข้อผิดพลาดใด ๆ */
export const errorMessage = (error: unknown, fallback = "เกิดข้อผิดพลาด กรุณาลองใหม่") =>
  error instanceof ApiError ? error.message : fallback;

type Options = { method?: string; body?: unknown; query?: Record<string, string | number | undefined | null> };

async function request<T>(path: string, { method = "GET", body, query }: Options = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new ApiError(res.status, data?.code || "ERROR", data?.error || "เกิดข้อผิดพลาด", data?.details);
    // token ของระบบหมดอายุ หรือสิทธิ์ของ Google ถูกเพิกถอน → กลับไปหน้าเข้าสู่ระบบ
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      tokenStore.clear();
      window.location.href = `/login?error=${error.code === "REAUTH_REQUIRED" ? "reauth" : "expired"}`;
    }
    throw error;
  }
  return data as T;
}

async function requestBlob(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {},
    });
  } catch {
    throw new ApiError(0, "NETWORK", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.code || "ERROR", data?.error || "ดึงไฟล์ไม่สำเร็จ");
  }
  return res.blob();
}

export const api = {
  me: () => request<{ user: UserProfile }>("/api/user/me"),
  accounts: () => request<{ items: MailAccount[] }>("/api/accounts"),
  backfill: {
    start: (accountId: string) => request<{ account: MailAccount }>(`/api/accounts/${accountId}/backfill`, { method: "POST" }),
    stop: (accountId: string) => request<{ account: MailAccount }>(`/api/accounts/${accountId}/backfill/stop`, { method: "POST" }),
  },

  emails: {
    list: (params: { category?: EmailCategory; filter?: EmailFilter; q?: string; cursor?: string | null }) =>
      request<{ items: EmailListItem[]; nextCursor: string | null }>("/api/emails", { query: params }),
    counts: () => request<EmailCounts>("/api/emails/counts"),
    get: (id: string) => request<EmailDetail>(`/api/emails/${id}`),
    /** ไฟล์แนบเป็น Blob (ต้องแนบ token จึงใช้ <img src> ตรง ๆ ไม่ได้) */
    attachment: (id: string, messageId: string, partId: string) =>
      requestBlob(`/api/emails/${id}/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(partId)}`),
    update: (id: string, body: { userCategory?: EmailCategory; isRead?: true }) =>
      request<EmailDetail>(`/api/emails/${id}`, { method: "PATCH", body }),
    analyze: (id: string) => request<EmailDetail>(`/api/emails/${id}/analyze`, { method: "POST" }),
    sync: () => request<{ created: number; removed: number; restored: number }>("/api/emails/sync", { method: "POST" }),
    createDraft: (id: string, body: { intent?: ReplyIntent; body?: string }) =>
      request<{ draft: ReplyDraft }>(`/api/emails/${id}/draft`, { method: "POST", body }),
  },

  drafts: {
    update: (id: string, body: string) => request<{ draft: ReplyDraft }>(`/api/drafts/${id}`, { method: "PUT", body: { body } }),
    send: (id: string, body?: string) =>
      request<{ draft: ReplyDraft }>(`/api/drafts/${id}/send`, { method: "POST", body: { body } }),
    discard: (id: string) => request<{ draft: ReplyDraft }>(`/api/drafts/${id}/discard`, { method: "POST" }),
  },

  actions: {
    list: (status: "SUGGESTED" | "CREATED" = "SUGGESTED") =>
      request<{ items: ActionItem[] }>("/api/actions", { query: { status } }),
    update: (
      id: string,
      body: Partial<{ title: string; startAt: string | null; endAt: string | null; isAllDay: boolean; location: string | null; repeatDays: number }>
    ) => request<{ action: ActionItem }>(`/api/actions/${id}`, { method: "PUT", body }),
    confirm: (id: string, body: { force?: boolean; inviteSender?: boolean; mode?: ConfirmMode }) =>
      request<{ action: ActionItem }>(`/api/actions/${id}/confirm`, { method: "POST", body }),
    dismiss: (id: string) => request<{ action: ActionItem }>(`/api/actions/${id}/dismiss`, { method: "POST" }),
  },

  calendar: () => request<{ items: CalendarEvent[] }>("/api/calendar"),

  summary: {
    get: (type: SummaryType, force = false) =>
      request<{ content: string; generatedAt: string; cached: boolean }>("/api/summary", { query: { type, force: String(force) } }),
    stats: (days: number) => request<Stats>("/api/summary/stats", { query: { days } }),
  },

  settings: {
    get: () => request<SettingsResponse>("/api/settings"),
    update: (body: Partial<UserSetting>) => request<SettingsResponse>("/api/settings", { method: "PUT", body }),
    saveKey: (provider: string, apiKey: string) =>
      request<SettingsResponse>(`/api/settings/ai/keys/${provider}`, { method: "PUT", body: { apiKey } }),
    deleteKey: (provider: string) => request<SettingsResponse>(`/api/settings/ai/keys/${provider}`, { method: "DELETE" }),
    testAi: (body: { provider: string; model?: string; apiKey?: string }) =>
      request<{ ok: true; provider: string; model: string }>("/api/settings/ai/test", { method: "POST", body }),
    models: (provider: string) => request<{ models: { id: string }[] }>("/api/settings/ai/models", { query: { provider } }),
  },
};
