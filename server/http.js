'use strict';
// Небольшой HTTP-каркас на встроенном модуле node:http: маршруты, JSON, статика, заголовки безопасности.
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

function clientIp(req) {
  if (config.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket.remoteAddress || '';
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Слишком большой запрос.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handlers) {
    // Первым аргументом можно передать настройки маршрута, например { bodyLimit: 4 * 1024 * 1024 }
    const opts = handlers.length && typeof handlers[0] === 'object' ? handlers.shift() : {};
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers, bodyLimit: opts.bodyLimit });
  }
  get(p, ...h) { this.add('GET', p, h); }
  post(p, ...h) { this.add('POST', p, h); }
  put(p, ...h) { this.add('PUT', p, h); }
  patch(p, ...h) { this.add('PATCH', p, h); }
  delete(p, ...h) { this.add('DELETE', p, h); }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// Статика: файлы из public, плюс отдельные точки монтирования (например, /js/scoring.js и /vendor)
function createStatic(mounts) {
  return function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    for (const [prefix, dir] of mounts) {
      if (!pathname.startsWith(prefix)) continue;
      let rel = pathname.slice(prefix.length);
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(dir, rel));
      if (!file.startsWith(path.normalize(dir + path.sep)) && file !== path.normalize(dir)) continue;
      let stat;
      try { stat = fs.statSync(file); } catch (e) { continue; }
      if (stat.isDirectory()) {
        res.writeHead(301, { Location: pathname.replace(/\/?$/, '/') });
        res.end();
        return true;
      }
      const ext = path.extname(file).toLowerCase();
      const isHtml = ext === '.html';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': isHtml ? 'no-cache' : (prefix.startsWith('/vendor/') ? 'public, max-age=2592000, immutable' : 'public, max-age=3600'),
        'Last-Modified': stat.mtime.toUTCString()
      });
      if (req.method === 'HEAD') { res.end(); return true; }
      fs.createReadStream(file).pipe(res);
      return true;
    }
    return false;
  };
}

function createServer({ router, serveStatic, notFoundFile, csrfCheck, loadSession }) {
  return http.createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      if (pathname.startsWith('/api/')) {
        const found = router.match(req.method, pathname);
        if (!found) throw new HttpError(404, 'Такого адреса API нет.');
        if (found.methodNotAllowed) throw new HttpError(405, 'Метод не поддерживается.');
        req.params = found.params;
        req.query = Object.fromEntries(url.searchParams);
        req.ip = clientIp(req);
        req.cookies = parseCookies(req.headers.cookie);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          csrfCheck(req);
          const raw = await readBody(req, found.route.bodyLimit);
          if (raw) {
            if (!/application\/json/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Ожидается JSON.');
            try { req.body = JSON.parse(raw); } catch (e) { throw new HttpError(400, 'Некорректный JSON.'); }
          } else req.body = {};
        }
        await loadSession(req);
        for (const h of found.route.handlers) {
          const out = await h(req, res);
          if (res.writableEnded) return;
          if (out !== undefined) { sendJson(res, out && out.__status ? out.__status : 200, out && out.__status ? out.body : out); return; }
        }
        if (!res.writableEnded) sendJson(res, 204, {});
        return;
      }
      if (serveStatic(req, res, pathname)) return;
      const wantsPage = !/\.[a-z0-9]+$/i.test(pathname) || /\.html$/i.test(pathname);
      if (req.method === 'GET' && notFoundFile && wantsPage && !pathname.startsWith('/vendor/')) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        fs.createReadStream(notFoundFile).pipe(res);
        return;
      }
      res.writeHead(404); res.end();
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, Object.assign({ error: err.message }, err.extra || {}));
      } else {
        console.error('[http] ошибка', req.method, pathname, err && err.stack || err);
        if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка сервера. Попробуйте ещё раз.' });
        else res.end();
      }
    }
  });
}

module.exports = { HttpError, Router, createServer, createStatic, sendJson, clientIp };
