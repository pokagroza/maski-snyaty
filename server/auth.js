'use strict';
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const { HttpError } = require('./http');

const COOKIE = 'lupin_sid';
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

// ---------- пароли: scrypt со случайной солью ----------
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (err, key) => {
      if (err) return reject(err);
      resolve(['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$'));
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
    const [, N, r, p, salt, hash] = parts;
    const expected = Buffer.from(hash, 'base64');
    crypto.scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem }, (err, key) => {
      if (err) return resolve(false);
      resolve(crypto.timingSafeEqual(key, expected));
    });
  });
}

// Хеш-заглушка, чтобы проверка несуществующего логина занимала столько же времени
let dummyHash = null;
async function dummyVerify(password) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Пароль должен быть не короче 10 символов.');
  if (pw.length > 200) throw new HttpError(400, 'Пароль слишком длинный.');
}

// ---------- сессии ----------
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function cookieHeader(value, maxAgeSec) {
  return [
    `${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    config.isProd ? 'Secure' : '', `Max-Age=${maxAgeSec}`
  ].filter(Boolean).join('; ');
}

async function createSession(res, staffId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (token_hash, staff_id, expires_at, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4)`,
    [tokenHash(token), staffId, config.sessionDays, String(userAgent || '').slice(0, 200)]
  );
  res.setHeader('Set-Cookie', cookieHeader(token, config.sessionDays * 86400));
}

async function destroySession(req, res) {
  const token = req.cookies[COOKIE];
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
  res.setHeader('Set-Cookie', cookieHeader('', 0));
}

async function loadSession(req) {
  req.staff = null;
  const token = req.cookies && req.cookies[COOKIE];
  if (!token || token.length > 100) return;
  const { rows } = await db.query(
    `SELECT s.id, s.login, s.display_name, s.role
       FROM sessions x JOIN staff s ON s.id = x.staff_id
      WHERE x.token_hash = $1 AND x.expires_at > now() AND s.is_active`,
    [tokenHash(token)]
  );
  if (rows[0]) req.staff = { id: rows[0].id, login: rows[0].login, name: rows[0].display_name, role: rows[0].role };
}

// ---------- защита от подделки запросов ----------
// Все изменяющие запросы должны идти с заголовком X-Requested-With (браузер не пошлёт его с чужого сайта без CORS)
// и, если браузер прислал Origin, он должен совпадать с адресом сайта.
function csrfCheck(req) {
  if (req.headers['x-requested-with'] !== 'lupin') throw new HttpError(403, 'Запрос отклонён.');
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = new Set();
  if (config.publicOrigin) allowed.add(config.publicOrigin);
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) { allowed.add('https://' + host); if (!config.isProd) allowed.add('http://' + host); }
  if (!allowed.has(origin)) throw new HttpError(403, 'Запрос с чужого сайта отклонён.');
}

// ---------- ограничение частоты (в памяти процесса) ----------
function rateLimiter({ windowMs, max, key, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.min(windowMs, 60000)).unref();
  return function limit(req) {
    const k = key(req);
    const now = Date.now();
    let e = hits.get(k);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(k, e); }
    e.count++;
    if (e.count > max) {
      throw new HttpError(429, message || 'Слишком много запросов. Попробуйте позже.', { retryAfterSec: Math.ceil((e.reset - now) / 1000) });
    }
  };
}

// ---------- доступ ----------
function requireStaff(req) {
  if (!req.staff) throw new HttpError(401, 'Войдите в админку.');
}
function requireAdmin(req) {
  requireStaff(req);
  if (req.staff.role !== 'admin') throw new HttpError(403, 'Это действие доступно только администратору.');
}

async function audit(clientOrDb, staffId, action, entity, entityId, details) {
  await (clientOrDb || db).query(
    'INSERT INTO audit_log (staff_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [staffId || null, action, entity, entityId || null, details || {}]
  );
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, dummyVerify, validatePassword,
  createSession, destroySession, loadSession, csrfCheck, rateLimiter, requireStaff, requireAdmin, audit
};
