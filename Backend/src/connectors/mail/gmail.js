// ตัวเชื่อม Gmail — แปลงข้อมูลของ Gmail เป็นรูปแบบกลางของระบบ
// ทุกตัวเชื่อมอีเมลต้องมีฟังก์ชันชุดเดียวกับที่ไฟล์นี้คืน (ดู connectors/mail/index.js)
const { google } = require('googleapis');
const { authClientForAccount, withGoogleErrors } = require('../google/client');
const { parseAddress } = require('../../utils/emailText');

const header = (headers, name) =>
  (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

const decode = (data) => (data ? Buffer.from(data, 'base64').toString('utf8') : '');

/** รวมส่วน text/plain และ text/html จากโครงสร้าง MIME (ข้ามไฟล์แนบ) */
const extractBodies = (payload) => {
  const out = { text: '', html: '' };
  const walk = (part) => {
    if (!part) return;
    if (part.filename) return;
    if (part.mimeType === 'text/plain' && part.body?.data) out.text += decode(part.body.data);
    else if (part.mimeType === 'text/html' && part.body?.data) out.html += decode(part.body.data);
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
};

const toMeta = (data) => {
  const headers = data.payload?.headers;
  const from = parseAddress(header(headers, 'From'));
  const labels = data.labelIds || [];
  return {
    providerMessageId: data.id,
    providerThreadId: data.threadId,
    fromName: from.name,
    fromAddress: from.address,
    subject: header(headers, 'Subject') || null,
    snippet: data.snippet || null,
    receivedAt: new Date(Number(data.internalDate) || Date.now()),
    isRead: !labels.includes('UNREAD'),
    labels,
  };
};

const encodeRaw = (lines) =>
  Buffer.from(lines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const createGmailConnector = (account) => {
  const gmail = google.gmail({ version: 'v1', auth: authClientForAccount(account) });

  return {
    provider: 'GOOGLE',

    /** รหัสข้อความในกล่องขาเข้าที่ใหม่กว่า since ไล่ทุกหน้าจนหมดหรือครบ maxMessages */
    async listMessageIdsSince({ since, maxMessages = 300 }) {
      const q = `in:inbox -from:me after:${Math.floor(since.getTime() / 1000)}`;
      const ids = [];
      let pageToken;
      do {
        const res = await withGoogleErrors(() =>
          gmail.users.messages.list({ userId: 'me', q, maxResults: 100, pageToken })
        );
        for (const m of res.data.messages || []) ids.push(m.id);
        pageToken = res.data.nextPageToken;
      } while (pageToken && ids.length < maxMessages);
      return { ids: ids.slice(0, maxMessages), truncated: Boolean(pageToken) || ids.length > maxMessages };
    },

    async getMessageMeta(messageId) {
      const res = await withGoogleErrors(() =>
        gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        })
      );
      return toMeta(res.data);
    },

    /** ข้อความทั้งเธรดเรียงตามเวลา: [{ id, from, subject, date, text, html, isRead }] */
    async getThread(threadId) {
      const res = await withGoogleErrors(() =>
        gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })
      );
      return (res.data.messages || []).map((msg) => {
        const headers = msg.payload?.headers;
        const bodies = extractBodies(msg.payload);
        return {
          id: msg.id,
          from: header(headers, 'From'),
          subject: header(headers, 'Subject'),
          date: header(headers, 'Date') || new Date(Number(msg.internalDate)).toISOString(),
          receivedAt: new Date(Number(msg.internalDate) || Date.now()).toISOString(),
          text: bodies.text,
          html: bodies.html,
          isRead: !(msg.labelIds || []).includes('UNREAD'),
        };
      });
    },

    /** ตอบกลับข้อความในเธรดเดิม คืน { id } ของข้อความที่ส่งออก */
    async sendReply({ threadId, inReplyToMessageId, body }) {
      const original = await withGoogleErrors(() =>
        gmail.users.messages.get({
          userId: 'me',
          id: inReplyToMessageId,
          format: 'metadata',
          metadataHeaders: ['From', 'Reply-To', 'Message-ID', 'References', 'Subject'],
        })
      );
      const headers = original.data.payload?.headers;
      const to = parseAddress(header(headers, 'Reply-To') || header(headers, 'From')).address;
      if (!to) throw new Error('ไม่พบที่อยู่อีเมลของผู้ส่งเดิม');

      const subject = header(headers, 'Subject');
      const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
      const messageId = header(headers, 'Message-ID');
      const references = `${header(headers, 'References')} ${messageId}`.trim();

      const raw = encodeRaw([
        `To: ${to}`,
        `Subject: =?utf-8?B?${Buffer.from(replySubject).toString('base64')}?=`,
        ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${references}`] : []),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        body,
      ]);

      const res = await withGoogleErrors(() =>
        gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId } })
      );
      return { id: res.data.id };
    },

    /** ตำแหน่งปัจจุบันของบันทึกการเปลี่ยนแปลง (เก็บไว้ถามครั้งถัดไปว่ามีอะไรเปลี่ยนตั้งแต่ตรงนี้) */
    async getChangeCursor() {
      const res = await withGoogleErrors(() => gmail.users.getProfile({ userId: 'me' }));
      return String(res.data.historyId);
    },

    /**
     * สิ่งที่เปลี่ยนในกล่องจดหมายตั้งแต่ cursor — หนึ่งคำขอต่อ 500 รายการเปลี่ยนแปลง ไม่ต้องไล่ถามทีละฉบับ
     * คืน { cursor, removedIds, restoredIds, readIds, unreadIds, expired }
     *   removedIds  : ถูกลบถาวร ย้ายลงถังขยะ หรือถูกทำเป็นสแปม
     *   restoredIds : ถูกกู้กลับมาที่กล่องขาเข้า
     *   expired     : cursor เก่าเกินกว่าที่ Gmail เก็บไว้ (ประมาณหนึ่งสัปดาห์) ต้องตรวจด้วยวิธีสำรอง
     */
    async getChanges({ cursor }) {
      const state = new Map(); // messageId -> { removed, read } สถานะล่าสุดชนะ
      const set = (id, patch) => state.set(id, { ...(state.get(id) || {}), ...patch });
      let pageToken;
      let latest = cursor;
      try {
        do {
          const res = await withGoogleErrors(() =>
            gmail.users.history.list({
              userId: 'me',
              startHistoryId: cursor,
              historyTypes: ['messageDeleted', 'labelAdded', 'labelRemoved'],
              maxResults: 500,
              pageToken,
            })
          );
          for (const record of res.data.history || []) {
            for (const d of record.messagesDeleted || []) set(d.message.id, { removed: true });
            for (const a of record.labelsAdded || []) {
              if (a.labelIds?.some((l) => l === 'TRASH' || l === 'SPAM')) set(a.message.id, { removed: true });
              if (a.labelIds?.includes('INBOX')) set(a.message.id, { removed: false });
              if (a.labelIds?.includes('UNREAD')) set(a.message.id, { read: false });
            }
            for (const r of record.labelsRemoved || []) {
              if (r.labelIds?.some((l) => l === 'TRASH' || l === 'SPAM')) set(r.message.id, { removed: false });
              if (r.labelIds?.includes('UNREAD')) set(r.message.id, { read: true });
            }
          }
          if (res.data.historyId) latest = String(res.data.historyId);
          pageToken = res.data.nextPageToken;
        } while (pageToken);
      } catch (error) {
        const status = error.code || error.status || error.response?.status;
        if (status === 404) return { cursor: null, removedIds: [], restoredIds: [], readIds: [], unreadIds: [], expired: true };
        throw error;
      }
      const pick = (test) => [...state.entries()].filter(([, v]) => test(v)).map(([id]) => id);
      return {
        cursor: latest,
        removedIds: pick((v) => v.removed === true),
        restoredIds: pick((v) => v.removed === false),
        readIds: pick((v) => v.read === true && v.removed !== true),
        unreadIds: pick((v) => v.read === false && v.removed !== true),
        expired: false,
      };
    },

    /** วิธีสำรองเมื่อ cursor หมดอายุ: รหัสข้อความที่อยู่ในถังขยะหรือสแปมช่วงที่ผ่านมา */
    async listRemovedIds({ days = 30, maxMessages = 500 }) {
      const ids = [];
      for (const q of [`in:trash newer_than:${days}d`, `in:spam newer_than:${days}d`]) {
        let pageToken;
        do {
          const res = await withGoogleErrors(() =>
            gmail.users.messages.list({ userId: 'me', q, maxResults: 100, pageToken, includeSpamTrash: true })
          );
          for (const m of res.data.messages || []) ids.push(m.id);
          pageToken = res.data.nextPageToken;
        } while (pageToken && ids.length < maxMessages);
      }
      return ids;
    },

    async markRead(messageId) {
      await withGoogleErrors(() =>
        gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { removeLabelIds: ['UNREAD'] } })
      );
    },
  };
};

module.exports = { createGmailConnector, extractBodies };
