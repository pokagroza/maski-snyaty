'use strict';
// Telegram-уведомления: подключение чата по ссылке, уведомления о заявках, личные данные, отписка.
// Вместо настоящего Telegram поднимается поддельный сервер с тем же API.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const URL_ = process.env.TEST_DATABASE_URL;
if (!URL_) {
  test('Telegram (пропущено: не задан TEST_DATABASE_URL)', { skip: true }, () => {});
  return;
}

const TOKEN = '123456:TEST-token';
const tg = { updates: [], sent: [], blocked: new Set(), waiters: [], nextId: 1 };
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/);
    const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (!m || m[1] !== TOKEN) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' })); }
    const p = body ? JSON.parse(body) : {};
    if (m[2] === 'getMe') return send({ ok: true, result: { id: 1, is_bot: true, first_name: 'Маски сняты', username: 'maski_test_bot' } });
    if (m[2] === 'sendMessage') {
      if (tg.blocked.has(String(p.chat_id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })); }
      tg.sent.push(p);
      tg.waiters.splice(0).forEach((w) => w());
      return send({ ok: true, result: { message_id: tg.sent.length } });
    }
    if (m[2] === 'getUpdates') {
      const give = () => {
        const list = tg.updates.filter((u) => u.update_id >= (p.offset || 0));
        tg.updates = list;
        send({ ok: true, result: list });
      };
      if (tg.updates.length) return give();
      return setTimeout(give, 150);
    }
    send({ ok: false, error_code: 404, description: 'Not Found' });
  });
});

let base, app, admin;

async function call(method, path, body, cookie) {
  const headers = { 'X-Requested-With': 'lupin' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
function userSays(chatId, text, extra) {
  tg.updates.push({ update_id: tg.nextId++, message: { message_id: tg.nextId, text, chat: Object.assign({ id: chatId, type: 'private', first_name: 'Анастасия', username: 'grets' }, extra || {}) } });
}
async function waitFor(pred, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const hit = tg.sent.find(pred);
    if (hit) return hit;
    if (Date.now() > end) throw new Error('Сообщение не пришло: ' + JSON.stringify(tg.sent.map((s) => s.text.slice(0, 60))));
    await new Promise((r) => { tg.waiters.push(r); setTimeout(r, 100); });
  }
}

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.DATABASE_URL = URL_;
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_API_BASE = 'http://127.0.0.1:' + fake.address().port;
  process.env.TELEGRAM_POLL_SEC = '1';
  process.env.PUBLIC_ORIGIN = 'https://maski.test';
  const db = require('../server/db');
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  app = require('../server/index');
  await app.start();
  await new Promise((r) => app.server.listening ? r() : app.server.once('listening', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
  const { hashPassword } = require('../server/auth');
  await db.query(`INSERT INTO staff (login, display_name, role, password_hash) VALUES ('boss', 'Анастасия', 'admin', $1), ('host1', 'Иван', 'host', $2)`,
    [await hashPassword('boss-password-1'), await hashPassword('host-password-1')]);
  admin = (await call('POST', '/api/auth/login', { login: 'boss', password: 'boss-password-1' })).cookie;
});

test.after(async () => {
  await app.telegram.stop();
  app.server.close(); app.server.closeAllConnections();
  fake.close(); fake.closeAllConnections();
  await require('../server/db').pool.end();
});

test('подключение чата по одноразовой ссылке', async () => {
  const host = (await call('POST', '/api/auth/login', { login: 'host1', password: 'host-password-1' })).cookie;
  assert.equal((await call('GET', '/api/admin/telegram', undefined, host)).status, 403);
  const st = (await call('GET', '/api/admin/telegram', undefined, admin)).data;
  assert.equal(st.enabled, true);
  assert.equal(st.personal, false);
  assert.deepEqual(st.chats, []);
  const link = (await call('POST', '/api/admin/telegram/link', {}, admin)).data;
  assert.match(link.url, /^https:\/\/t\.me\/maski_test_bot\?start=[A-Za-z0-9_-]{24}$/);
  const code = link.url.split('=')[1];
  userSays(555, '/start ' + code);
  await waitFor((s) => s.chat_id === 555 && /Готово/.test(s.text));
  const chats = (await call('GET', '/api/admin/telegram', undefined, admin)).data.chats;
  assert.equal(chats.length, 1);
  assert.equal(chats[0].chatId, '555');
  assert.match(chats[0].title, /Анастасия \(@grets\)/);
  assert.equal(chats[0].addedBy, 'Анастасия');
  // повторно та же ссылка не работает
  userSays(556, '/start ' + code);
  await waitFor((s) => s.chat_id === 556 && /устарела/.test(s.text));
  assert.equal((await call('GET', '/api/admin/telegram', undefined, admin)).data.chats.length, 1);
});

test('уведомление о заявке: по умолчанию без имени и контакта', async () => {
  const ev = await call('POST', '/api/admin/events', { kind: 'msk', title: 'Открытые игры <в мафию>', startsAt: '2030-10-09T19:00', price: 1000, capacity: 3 }, admin);
  assert.equal(ev.status, 201);
  tg.sent.length = 0;
  const b = await call('POST', '/api/bookings', { eventId: ev.data.id, name: 'Анна', contact: '+7 900 111-22-33', seats: 2, comment: 'Промокод: Кто ты', consent: true });
  assert.equal(b.status, 201);
  const msg = await waitFor((s) => s.chat_id === '555' || s.chat_id === 555);
  assert.match(msg.text, /Новая заявка на игру/);
  assert.match(msg.text, /Открытые игры &lt;в мафию&gt;/);
  assert.match(msg.text, /9 октября, 19:00/);
  assert.match(msg.text, /Мест в заявке: <b>2<\/b> · свободно 1 из 3/);
  assert.match(msg.text, /С промокодом «Кто ты»/);
  assert.match(msg.text, /https:\/\/maski\.test\/admin\/#bookings/);
  assert.doesNotMatch(msg.text, /Анна|900 111/);
  assert.equal(msg.parse_mode, 'HTML');
});

test('с включёнными личными данными в уведомлении есть имя и контакт', async () => {
  assert.equal((await call('PATCH', '/api/admin/telegram/settings', { personal: true }, admin)).data.personal, true);
  tg.sent.length = 0;
  assert.equal((await call('POST', '/api/bookings', { requestKind: 'corporate', name: 'Ольга', contact: '@olga_hr', comment: 'Нас 25 человек', consent: true })).status, 201);
  const msg = await waitFor(() => true);
  assert.match(msg.text, /Заявка на корпоратив/);
  assert.match(msg.text, /Имя: Ольга/);
  assert.match(msg.text, /Контакт: @olga_hr/);
  assert.match(msg.text, /Нас 25 человек/);
  await call('PATCH', '/api/admin/telegram/settings', { personal: false }, admin);
});

test('проверка связи, заблокированный чат и отписка', async () => {
  // второй чат, который потом заблокирует бота
  const code = (await call('POST', '/api/admin/telegram/link', {}, admin)).data.url.split('=')[1];
  userSays(777, '/start ' + code, { first_name: 'Иван', username: 'ivan' });
  await waitFor((s) => s.chat_id === 777 && /Готово/.test(s.text));
  assert.equal((await call('GET', '/api/admin/telegram', undefined, admin)).data.chats.length, 2);
  tg.blocked.add('777');
  const t = await call('POST', '/api/admin/telegram/test', {}, admin);
  assert.equal(t.status, 200);
  assert.equal(t.data.sent, 1);
  assert.deepEqual((await call('GET', '/api/admin/telegram', undefined, admin)).data.chats.map((c) => c.chatId), ['555']);
  userSays(555, '/stop');
  await waitFor((s) => s.chat_id === 555 && /отключены/.test(s.text));
  assert.equal((await call('GET', '/api/admin/telegram', undefined, admin)).data.chats.length, 0);
  assert.equal((await call('POST', '/api/admin/telegram/test', {}, admin)).status, 409);
  // заявка без подключённых чатов проходит как обычно
  assert.equal((await call('POST', '/api/bookings', { requestKind: 'private', name: 'Пётр', contact: '+7 900 000-00-01', consent: true })).status, 201);
});
