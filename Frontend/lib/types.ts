// ชนิดข้อมูลที่ตรงกับ API ของ Backend

export type EmailCategory =
  | "APPOINTMENT"
  | "TASK_DEADLINE"
  | "INFO_REQUEST"
  | "FYI"
  | "BOOKING_TRAVEL"
  | "EVENT_INVITATION"
  | "OTHER";

export type Priority = "HIGH" | "NORMAL" | "LOW";
export type AnalysisStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "SKIPPED" | "MANUAL";
export type ActionKind = "EVENT" | "DEADLINE";
export type Availability = "NOT_CHECKED" | "AVAILABLE" | "CONFLICT" | "OUT_OF_WORKING_HOURS" | "OUT_OF_WORK_DAYS";
export type ActionStatus = "SUGGESTED" | "CREATING" | "CREATED" | "FAILED" | "DISMISSED" | "MERGED";
export type ActionRelation = "DETAIL" | "RESCHEDULE";
export type ConfirmMode = "CREATE" | "UPDATE_RELATED";
export type ReplyIntent = "ACCEPT" | "PROPOSE_TIME" | "DECLINE" | "ANSWER" | "ACKNOWLEDGE";
export type DraftStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "DISCARDED";
export type EmailFilter = "has_draft" | "has_action" | "needs_reply" | "failed" | "unread";
export type SummaryType = "DAILY" | "WEEKLY" | "MONTHLY";

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface EmailListItem {
  id: string;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string;
  isRead: boolean;
  category: EmailCategory | null;
  aiCategory: EmailCategory | null;
  priority: Priority;
  summary: string | null;
  needsReply: boolean;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  draftStatus: DraftStatus | null;
  suggestedActions: number;
  createdActions: number;
}

export interface ActionItem {
  id: string;
  emailId: string;
  kind: ActionKind;
  title: string;
  startAt: string | null;
  endAt: string | null;
  isAllDay: boolean;
  isTimeSpecified: boolean;
  /** จำนวนวันติดกันที่กิจกรรมเกิดในช่วงเวลาเดิม (1 = ครั้งเดียว) */
  repeatDays: number;
  location: string | null;
  evidence: string | null;
  missingFields: string[];
  availability: Availability;
  availabilityReason: string | null;
  suggestedSlots: { start: string; end: string }[];
  status: ActionStatus;
  externalLink: string | null;
  errorMessage: string | null;
  emailSubject?: string | null;
  /** ความสัมพันธ์กับรายการเดิมในเธรดเดียวกัน (null = ไม่เกี่ยวข้อง) */
  relation: ActionRelation | null;
  related: {
    id: string;
    emailId: string;
    title: string;
    startAt: string | null;
    endAt: string | null;
    isAllDay: boolean;
    isTimeSpecified: boolean;
    repeatDays: number;
    status: ActionStatus;
  } | null;
}

export interface ReplyDraft {
  id: string;
  intent: ReplyIntent;
  body: string;
  source: "AI" | "USER";
  status: DraftStatus;
  sentAt: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

export interface ThreadMessage {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  text: string;
  html: string;
  attachments: Attachment[];
  isCurrent: boolean;
}

export interface Attachment {
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface EmailDetail extends EmailListItem {
  accountEmail: string;
  aiProvider: string | null;
  aiModel: string | null;
  analyzedAt: string | null;
  actionItems: ActionItem[];
  draft: ReplyDraft | null;
  messages: ThreadMessage[];
  threadError: string | null;
}

export interface EmailCounts {
  total: number;
  unread: number;
  failed: number;
  pending: number;
  hasDraft: number;
  hasAction: number;
  categories: Record<EmailCategory, number>;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  isAllDay: boolean;
  location: string;
  htmlLink: string;
}

export interface MailAccount {
  id: string;
  provider: "GOOGLE" | "MICROSOFT";
  emailAddress: string;
  status: "ACTIVE" | "NEEDS_REAUTH" | "DISABLED";
  lastSyncAt: string | null;
  lastSyncError: string | null;
  backfill: {
    status: "idle" | "running" | "paused" | "done" | "failed";
    count: number;
    oldestAt: string | null;
    error: string | null;
  };
}

export interface AiProviderInfo {
  id: string;
  label: string;
  requiresKey: boolean;
  isLocal: boolean;
  defaultModel: string | null;
  hasKey: boolean;
}

export interface UserSetting {
  isAutoAnalyzeActive: boolean;
  notifyNewAppointments: boolean;
  aiProvider: string;
  aiModel: string | null;
  startTime: string;
  endTime: string;
  workDays: string[];
  timezone: string;
  firstName: string | null;
  lastName: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | null;
  position: string | null;
  signature: string | null;
  tone: "formal" | "casual";
}

export interface SettingsResponse {
  setting: UserSetting;
  providers: AiProviderInfo[];
}

export interface Stats {
  days: number;
  emails: { total: number } & Record<AnalysisStatus, number>;
  byCategory: Record<EmailCategory, number>;
  perDay: { date: string; count: number }[];
  classification: { analyzed: number; corrected: number; correctionRate: number | null; failureRate: number | null };
  drafts: {
    pending: number;
    sent: number;
    discarded: number;
    failed: number;
    sentAfterEdit: number;
    medianResponseMinutes: number | null;
  };
  actions: { suggested: number; created: number; dismissed: number; merged: number; failed: number };
  models: { provider: string; model: string | null; analyzed: number }[];
}
