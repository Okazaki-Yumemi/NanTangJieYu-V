'use strict';

const crypto = require('node:crypto');

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function newToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * 生成人类友好的注册码：XXXX-XXXX-XXXX-XXXX。
 * 字符集去掉了易混淆的 0/O、1/I/L。
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function generateRegistrationCode(randomFn = crypto.randomBytes) {
  const raw = randomFn(12);
  const chars = [];
  for (let index = 0; index < 12; index += 1) {
    chars.push(CODE_ALPHABET[raw[index] % CODE_ALPHABET.length]);
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

function normalizeDisplayName(value) {
  return String(value || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const normalizedPassword = String(password || '');
  const hash = crypto.scryptSync(normalizedPassword, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) {
    return false;
  }
  const actual = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

module.exports = {
  newId,
  newToken,
  generateRegistrationCode,
  normalizeDisplayName,
  hashPassword,
  verifyPassword
};
