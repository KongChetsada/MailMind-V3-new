const { randomUUID } = require('crypto');

const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });
const SECRET_KEY_PATTERN =
  /(authorization|access[_-]?token|refresh[_-]?token|jwt|secret|password|database[_-]?url|api[_-]?key|client[_-]?secret)/i;
const EMAIL_PATTERN = /([a-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi;

const normalizeLevel = (value) => {
  const level = String(value || 'info').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : 'info';
};

const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return email;
  return email.replace(EMAIL_PATTERN, (_match, local, domain) => {
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
  });
};

const redactSecretsInString = (value, maskEmails = true) => {
  if (typeof value !== 'string') return value;
  let safe = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(https?:\/\/)[^:@/\s]+:[^@/\s]+@/gi, '$1[REDACTED]@')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgresql://[REDACTED]')
    .replace(/(access_token|refresh_token|client_secret|api_key)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(
      /(["']?(?:access[_-]?token|refresh[_-]?token|jwt|password|database[_-]?url|api[_-]?key|client[_-]?secret)["']?\s*[:=]\s*)["']?[^,"'\s}]+["']?/gi,
      '$1[REDACTED]'
    );
  if (maskEmails) safe = maskEmail(safe);
  return safe;
};

const sanitizeData = (value, { maskEmails = true, seen = new WeakSet() } = {}) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSecretsInString(value, maskEmails);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return value.message;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeData(item, { maskEmails, seen }));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : sanitizeData(item, { maskEmails, seen }),
    ])
  );
};

const formatContext = (context) =>
  Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, '_')}`)
    .join(' ');

const createTraceId = (prefix = 'trace') => `${prefix}-${randomUUID().slice(0, 8)}`;

const createLogger = (component, context = {}, options = {}) => {
  const env = options.env || process.env;
  const sink = options.sink || console;
  const configuredLevel = normalizeLevel(env.LOG_LEVEL);
  const sensitiveEnabled = String(env.LOG_SENSITIVE_CONTENT || '').toLowerCase() === 'true';
  const isEnabled = (level) => LEVELS[level] <= LEVELS[configuredLevel];

  const emit = (level, action, message, data) => {
    if (!isEnabled(level)) return;
    const timestamp = new Date().toISOString();
    const safeContext = sanitizeData(context, { maskEmails: !sensitiveEnabled });
    const contextText = formatContext(safeContext);
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${component}] [${action}]`;
    const contextSuffix = contextText ? ` [${contextText}]` : '';
    const safeData = data === undefined
      ? undefined
      : sanitizeData(data, { maskEmails: !sensitiveEnabled });
    const dataSuffix = safeData === undefined ? '' : ` | ${JSON.stringify(safeData)}`;
    const line = `${prefix}${contextSuffix} ${redactSecretsInString(String(message || ''), !sensitiveEnabled)}${dataSuffix}`;

    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    (sink[method] || sink.log).call(sink, line);
  };

  const serializeError = (error) => {
    if (!error) return undefined;
    const details = {
      name: error.name,
      message: error.message || String(error),
      code: error.code,
      status: error.status || error.response?.status,
    };
    if (isEnabled('debug') && error.stack) details.stack = error.stack;
    return details;
  };

  const logger = {
    context: { ...context },
    isDebugEnabled: () => isEnabled('debug'),
    isSensitiveEnabled: () => sensitiveEnabled,
    protect: (value) => {
      if (value === null || value === undefined) return value;
      return sensitiveEnabled ? sanitizeData(value, { maskEmails: false }) : `[REDACTED length=${String(value).length}]`;
    },
    child: (additionalContext = {}, childComponent = component) =>
      createLogger(childComponent, { ...context, ...additionalContext }, options),
    info: (action, message, data) => emit('info', action, message, data),
    debug: (action, message, data) => emit('debug', action, message, data),
    warn: (action, message, data) => emit('warn', action, message, data),
    error: (action, message, error, data) =>
      emit('error', action, message, { ...(data || {}), error: serializeError(error) }),
    sensitiveBlock: (action, label, content, data) => {
      if (!isEnabled('debug')) return;
      const serialized = typeof content === 'string'
        ? content
        : JSON.stringify(sanitizeData(content, { maskEmails: false }), null, 2);
      if (!sensitiveEnabled) {
        emit('debug', action, `${label} hidden because LOG_SENSITIVE_CONTENT=false`, {
          ...(data || {}),
          contentLength: serialized.length,
        });
        return;
      }
      const safeContent = redactSecretsInString(serialized, false);
      emit('debug', action, `--- BEGIN ${label} ---\n${safeContent}\n--- END ${label} ---`, data);
    },
  };

  return logger;
};

module.exports = {
  createLogger,
  createTraceId,
  maskEmail,
  sanitizeData,
};
