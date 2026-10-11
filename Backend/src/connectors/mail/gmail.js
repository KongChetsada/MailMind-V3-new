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

    async markRead(messageId) {
      await withGoogleErrors(() =>
        gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { removeLabelIds: ['UNREAD'] } })
      );
    },
  };
};

module.exports = { createGmailConnector, extractBodies };
