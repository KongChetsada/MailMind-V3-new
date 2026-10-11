const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { unauthorized } = require('../utils/httpError');

const signUserToken = (user) =>
  jwt.sign({ id: user.id, email: user.email }, env.jwtSecret, { expiresIn: '7d' });

/** ตรวจ JWT ของระบบ แล้วใส่ req.user = { id, email } */
const requireAuth = (req, _res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next(unauthorized());
  jwt.verify(token, env.jwtSecret, (err, decoded) => {
    if (err) return next(unauthorized());
    req.user = { id: decoded.id, email: decoded.email };
    next();
  });
};

module.exports = { requireAuth, signUserToken };
