// ข้อผิดพลาดที่มีรหัส HTTP และรหัสข้อความสำหรับหน้าเว็บ
class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);
const unauthorized = (message = 'กรุณาเข้าสู่ระบบใหม่') => new HttpError(401, 'UNAUTHORIZED', message);
const notFound = (message = 'ไม่พบข้อมูล') => new HttpError(404, 'NOT_FOUND', message);
const conflict = (code, message, details) => new HttpError(409, code, message, details);

module.exports = { HttpError, badRequest, unauthorized, notFound, conflict };
