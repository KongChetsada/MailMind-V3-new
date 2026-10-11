-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MailProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'DISABLED');

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('APPOINTMENT', 'TASK_DEADLINE', 'INFO_REQUEST', 'FYI', 'BOOKING_TRAVEL', 'EVENT_INVITATION', 'OTHER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ActionKind" AS ENUM ('EVENT', 'DEADLINE');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('NOT_CHECKED', 'AVAILABLE', 'CONFLICT', 'OUT_OF_WORKING_HOURS', 'OUT_OF_WORK_DAYS');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('SUGGESTED', 'CREATING', 'CREATED', 'FAILED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReplyIntent" AS ENUM ('ACCEPT', 'PROPOSE_TIME', 'DECLINE', 'ANSWER', 'ACKNOWLEDGE');

-- CreateEnum
CREATE TYPE "DraftSource" AS ENUM ('AI', 'USER');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "SummaryType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "picture" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isAutoAnalyzeActive" BOOLEAN NOT NULL DEFAULT true,
    "aiProvider" TEXT NOT NULL DEFAULT 'ollama',
    "aiModel" TEXT,
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '17:00',
    "workDays" TEXT[] DEFAULT ARRAY['mon', 'tue', 'wed', 'thu', 'fri']::TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "firstName" TEXT,
    "lastName" TEXT,
    "gender" TEXT,
    "position" TEXT,
    "signature" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'formal',
    "theme" TEXT NOT NULL DEFAULT 'light',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "MailProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "syncCursor" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "mailAccountId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "providerThreadId" TEXT NOT NULL,
    "fromName" TEXT,
    "fromAddress" TEXT,
    "subject" TEXT,
    "snippet" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "analysisAttempts" INTEGER NOT NULL DEFAULT 0,
    "analysisError" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "category" "EmailCategory",
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "summary" TEXT,
    "needsReply" BOOLEAN NOT NULL DEFAULT false,
    "userCategory" "EmailCategory",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "kind" "ActionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "isTimeSpecified" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "evidence" TEXT,
    "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availability" "Availability" NOT NULL DEFAULT 'NOT_CHECKED',
    "availabilityReason" TEXT,
    "suggestedSlots" JSONB,
    "status" "ActionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "externalEventId" TEXT,
    "externalLink" TEXT,
    "errorMessage" TEXT,
    "createdEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyDraft" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "intent" "ReplyIntent" NOT NULL,
    "body" TEXT NOT NULL,
    "source" "DraftSource" NOT NULL DEFAULT 'AI',
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Summary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SummaryType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserSetting_userId_key" ON "UserSetting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiCredential_userId_provider_key" ON "AiCredential"("userId", "provider");

-- CreateIndex
CREATE INDEX "MailAccount_userId_idx" ON "MailAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MailAccount_provider_providerAccountId_key" ON "MailAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "EmailMessage_mailAccountId_receivedAt_idx" ON "EmailMessage"("mailAccountId", "receivedAt");

-- CreateIndex
CREATE INDEX "EmailMessage_mailAccountId_category_idx" ON "EmailMessage"("mailAccountId", "category");

-- CreateIndex
CREATE INDEX "EmailMessage_analysisStatus_idx" ON "EmailMessage"("analysisStatus");

-- CreateIndex
CREATE INDEX "EmailMessage_providerThreadId_idx" ON "EmailMessage"("providerThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_mailAccountId_providerMessageId_key" ON "EmailMessage"("mailAccountId", "providerMessageId");

-- CreateIndex
CREATE INDEX "ActionItem_emailId_idx" ON "ActionItem"("emailId");

-- CreateIndex
CREATE INDEX "ActionItem_status_idx" ON "ActionItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReplyDraft_emailId_key" ON "ReplyDraft"("emailId");

-- CreateIndex
CREATE INDEX "ReplyDraft_status_idx" ON "ReplyDraft"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Summary_userId_type_periodStart_periodEnd_key" ON "Summary"("userId", "type", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "UserSetting" ADD CONSTRAINT "UserSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCredential" ADD CONSTRAINT "AiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAccount" ADD CONSTRAINT "MailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyDraft" ADD CONSTRAINT "ReplyDraft_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

