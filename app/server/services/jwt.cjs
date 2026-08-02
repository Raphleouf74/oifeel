
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'dev_secret';

exports.sign = (payload, expiresIn = '7d') => jwt.sign(payload, secret, { expiresIn });
exports.verify = (token) => jwt.verify(token, secret);