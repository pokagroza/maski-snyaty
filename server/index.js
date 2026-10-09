'use strict';
const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./db');
const { migrate } = require('./migrate');
const { Router, createServer, createStatic } = require('./http');
const auth = require('./auth');

const ROOT = path.join(__dirname, '..');
const router = new Router();
require('./routes/public')(router);
require('./routes/staff')(router);
require('./routes/admin')(router);
require('./routes/gallery')(router);
const telegram = require('./telegram');
telegram.routes(router, { auth, v: require('./validate'), HttpError: require('./http').HttpError });

// Шрифты и библиотеки раздаются с нашего сервера, без обращений к сторонним CDN
const NM = path.join(ROOT, 'node_modules');
const mounts = [
  ['/vendor/three/', path.join(NM, 'three', 'build')],
  ['/vendor/gsap/', path.join(NM, 'gsap', 'dist')],
  ['/vendor/fonts/cormorant-garamond/', path.join(NM, '@fontsource', 'cormorant-garamond')],
  ['/vendor/fonts/jost/', path.join(NM, '@fontsource', 'jost')],
  ['/vendor/fonts/marck-script/', path.join(NM, '@fontsource', 'marck-script')],
  ['/', path.join(ROOT, 'public')]
].filter(([, dir]) => dir);
const staticFiles = createStatic(mounts);
const SHARED = { '/js/scoring.js': path.join(ROOT, 'shared', 'scoring.js'), '/js/profile.js': path.join(ROOT, 'shared', 'profile.js') };

function serveStatic(req, res, pathname) {
  if (SHARED[pathname] && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(SHARED[pathname]).pipe(res);
    return true;
  }
  if (pathname === '/admin') { res.writeHead(301, { Location: '/admin/' }); res.end(); return true; }
  return staticFiles(req, res, pathname);
}

const server = createServer({
  router,
  serveStatic,
  notFoundFile: path.join(ROOT, 'public', '404.html'),
  csrfCheck: auth.csrfCheck,
  loadSession: auth.loadSession
});

// Ежедневное обслуживание: удалить истёкшие сессии и обезличить старые заявки (152-ФЗ: не храним дольше нужного)
async function housekeeping() {
  try {
    await db.query('DELETE FROM sessions WHERE expires_at < now()');
    const { rowCount } = await db.query(
      `UPDATE bookings SET name = 'обезличено', contact = 'обезличено', comment = ''
        WHERE created_at < now() - make_interval(days => $1) AND contact <> 'обезличено'`,
      [config.bookingRetentionDays]
    );
    if (rowCount) console.log(`[housekeeping] обезличено заявок: ${rowCount}`);
  } catch (err) {
    console.error('[housekeeping]', err.message);
  }
}

async function start() {
  await migrate();
  const missing = ['three/build/three.min.js', 'gsap/dist/gsap.min.js', '@fontsource/jost/400.css']
    .filter((f) => !fs.existsSync(path.join(NM, f)));
  if (missing.length) console.warn('[start] не найдены файлы оформления (сайт откроется, но без 3D и фирменных шрифтов):', missing.join(', '));
  server.listen(config.port, () => console.log(`[start] «Маски сняты» слушает порт ${config.port} (драйвер БД: ${db.driver})`));
  housekeeping();
  setInterval(housekeeping, 24 * 60 * 60 * 1000).unref();
  telegram.start();
}

function shutdown(signal) {
  console.log(`[stop] получен ${signal}, завершаем работу`);
  server.close(() => telegram.stop().then(() => db.pool.end()).then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  start().catch((err) => {
    console.error('[start] не удалось запустить сервер:', err.message);
    process.exit(1);
  });
}

module.exports = { server, start, telegram };
