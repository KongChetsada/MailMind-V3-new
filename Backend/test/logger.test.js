const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, sanitizeData } = require('../src/utils/logger');

const makeSink = () => {
  const lines = [];
  return {
    lines,
    log: (line) => lines.push(line),
    warn: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
};

test('child logger preserves trace and adds correlation identifiers', () => {
  const sink = makeSink();
  const root = createLogger('SYNC', { traceId: 'sync-123' }, {
    sink,
    env: { LOG_LEVEL: 'info', LOG_SENSITIVE_CONTENT: 'false' },
  });
  root.child({ messageId: 'msg-1', threadId: 'thread-1' }, 'EMAIL')
    .info('PROCESS_START', 'Processing message');

  assert.match(sink.lines[0], /\[EMAIL\] \[PROCESS_START\]/);
  assert.match(sink.lines[0], /traceId=sync-123/);
  assert.match(sink.lines[0], /messageId=msg-1/);
  assert.match(sink.lines[0], /threadId=thread-1/);
});

test('sensitive content is hidden by default and email addresses are masked', () => {
  const sink = makeSink();
  const logger = createLogger('AI', { traceId: 'ai-1' }, {
    sink,
    env: { LOG_LEVEL: 'debug', LOG_SENSITIVE_CONTENT: 'false' },
  });
  logger.debug('METADATA', 'Sender user@example.com', { recipient: 'person@example.com' });
  logger.sensitiveBlock('PROMPT', 'AI PROMPT', 'private appointment with user@example.com');

  const output = sink.lines.join('\n');
  assert.doesNotMatch(output, /user@example\.com/);
  assert.doesNotMatch(output, /person@example\.com/);
  assert.doesNotMatch(output, /private appointment/);
  assert.match(output, /LOG_SENSITIVE_CONTENT=false/);
});

test('sensitive mode prints content but always redacts secrets', () => {
  const sink = makeSink();
  const logger = createLogger('AI', { traceId: 'ai-2' }, {
    sink,
    env: { LOG_LEVEL: 'debug', LOG_SENSITIVE_CONTENT: 'true' },
  });
  logger.sensitiveBlock(
    'PROMPT',
    'AI PROMPT',
    'mail from user@example.com\nAuthorization: Bearer must-not-leak\n"accessToken":"must-not-leak"'
  );
  logger.debug('CONFIG', 'Loaded config', {
    accessToken: 'must-not-leak',
    Authorization: 'Bearer must-not-leak',
  });

  const output = sink.lines.join('\n');
  assert.match(output, /mail from user@example\.com/);
  assert.doesNotMatch(output, /must-not-leak/);
  assert.match(output, /\[REDACTED\]/);
});

test('sanitizeData redacts nested secret keys and database URLs', () => {
  const safe = sanitizeData({
    nested: { refresh_token: 'secret' },
    url: 'postgresql://user:password@localhost/database',
  });
  assert.equal(safe.nested.refresh_token, '[REDACTED]');
  assert.equal(safe.url, 'postgresql://[REDACTED]');
});
