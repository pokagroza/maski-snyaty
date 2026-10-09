'use strict';
// Интеграционные тесты API на настоящей PostgreSQL.
// Запуск: TEST_DATABASE_URL=postgres://user:pass@host:port/lupin_test node --test test/
// База из TEST_DATABASE_URL полностью очищается перед тестами — не указывайте рабочую базу!
const test = require('node:test');
const assert = require('node:assert/strict');

const URL_ = process.env.TEST_DATABASE_URL;
if (!URL_) {
  test('API (пропущено: не задан TEST_DATABASE_URL)', { skip: true }, () => {});
  return;
}
process.env.DATABASE_URL = URL_;
process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

let base, server;
const MSK = ['civ', 'civ', 'civ', 'civ', 'civ', 'civ', 'sher', 'maf', 'maf', 'don'];

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

function protocol(over = {}) {
  return Object.assign({
    format: 'msk', date: '2026-10-11', tableNo: 1, hostName: 'Ведущий', result: 'black', lx: [8, 9, 2],
    seats: MSK.map((role, i) => ({ nick: 'Игрок ' + (i + 1), role, dop: i === 7 ? 0.5 : i === 0 ? 0.3 : 0, fines: 0, dq: 'none', first: i === 0 }))
  }, over);
}

let admin, host;

test.before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const app = require('../server/index');
  await app.start();
  server = app.server;
  await new Promise((r) => server.listening ? r() : server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  await db.query(`INSERT INTO staff (login, display_name, role, password_hash) VALUES ('boss', 'Степан', 'admin', $1), ('host1', 'Ведущий Один', 'host', $2)`,
    [await hashPassword('boss-password-1'), await hashPassword('host-password-1')]);
});

test.after(async () => {
  server.close();
  await db.pool.end();
});

test('здоровье и публичные списки', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);
  assert.deepEqual((await call('GET', '/api/events')).data, { events: [] });
});

test('вход: неверный пароль, верный пароль, me', async () => {
  assert.equal((await call('POST', '/api/auth/login', { login: 'boss', password: 'wrong-password' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { login: 'nobody', password: 'x' })).status, 401);
  const ok = await call('POST', '/api/auth/login', { login: 'boss', password: 'boss-password-1' });
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /^lupin_sid=/);
  admin = ok.cookie;
  host = (await call('POST', '/api/auth/login', { login: 'host1', password: 'host-password-1' })).cookie;
  const me = await call('GET', '/api/auth/me', undefined, admin);
  assert.equal(me.data.me.role, 'admin');
  assert.equal((await call('GET', '/api/auth/me')).status, 401);
});

test('защита: без заголовка X-Requested-With и с чужим Origin запрос отклоняется', async () => {
  const r1 = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: admin } });
  assert.equal(r1.status, 403);
  const r2 = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: admin, 'X-Requested-With': 'lupin', Origin: 'https://evil.example' } });
  assert.equal(r2.status, 403);
});

test('без входа протокол не сохранить; ведущему недоступна афиша', async () => {
  assert.equal((await call('POST', '/api/staff/games', protocol())).status, 401);
  assert.equal((await call('GET', '/api/admin/events', undefined, host)).status, 403);
});

test('афиша и запись: учёт мест и отказ при нехватке', async () => {
  const ev = await call('POST', '/api/admin/events', { kind: 'msk', title: 'Московская мафия', startsAt: '2030-10-11T18:00', price: 1200, capacity: 3, tableSize: 10 }, admin);
  assert.equal(ev.status, 201);
  const id = ev.data.id;
  const list = (await call('GET', '/api/events')).data.events;
  assert.equal(list[0].time, '18:00');
  assert.equal(list[0].left, 3);
  assert.equal((await call('POST', '/api/bookings', { eventId: id, name: 'Анна', contact: '+7 900 000-00-00', seats: 2, consent: false })).status, 400);
  assert.equal((await call('POST', '/api/bookings', { eventId: id, name: 'Анна', contact: '123', seats: 2, consent: true })).status, 400);
  assert.equal((await call('POST', '/api/bookings', { eventId: id, name: 'Анна', contact: '+7 900 000-00-00', seats: 2, consent: true })).status, 201);
  const over = await call('POST', '/api/bookings', { eventId: id, name: 'Борис', contact: '@boris_m', seats: 2, consent: true });
  assert.equal(over.status, 409);
  assert.equal(over.data.left, 1);
  assert.equal((await call('POST', '/api/bookings', { eventId: id, name: 'Борис', contact: '@boris_m', seats: 1, consent: true })).status, 201);
  assert.equal((await call('GET', '/api/events')).data.events[0].left, 0);
  const bookings = (await call('GET', '/api/admin/bookings', undefined, admin)).data.bookings;
  assert.equal(bookings.length, 2);
  assert.equal((await call('PATCH', '/api/admin/bookings/' + bookings[0].id, { status: 'cancelled' }, admin)).status, 200);
  assert.equal((await call('GET', '/api/events')).data.events[0].left, 1);
  assert.equal((await call('DELETE', '/api/admin/events/' + id, undefined, admin)).status, 409);
});

let gameId;
test('протокол: новые игроки требуют подтверждения, затем сохранение', async () => {
  const first = await call('POST', '/api/staff/games', protocol(), host);
  assert.equal(first.status, 409);
  assert.equal(first.data.missing.length, 10);
  const saved = await call('POST', '/api/staff/games', Object.assign(protocol(), { createPlayers: true }), host);
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.equal(saved.data.newPlayers.length, 10);
  gameId = saved.data.game.id;
  assert.equal(saved.data.game.seats[0].nick, 'Игрок 1');
});

test('протокол с ошибкой отклоняется с понятным текстом', async () => {
  const p = protocol(); p.seats[1].role = 'maf';
  const r = await call('POST', '/api/staff/games', p, host);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Состав/);
  const d = protocol(); d.seats[7].dop = 0.7; d.seats[8].dop = 0.6;
  assert.match((await call('POST', '/api/staff/games', d, host)).data.error, /лимит 1,2/);
  const dup = protocol(); dup.seats[1].nick = 'игрок 1';
  assert.match((await call('POST', '/api/staff/games', dup, host)).data.error, /двух местах/);
});

test('рейтинг и публичные протоколы считаются по ФСМ', async () => {
  const r = (await call('GET', '/api/rating?format=msk&month=2026-10')).data;
  assert.equal(r.gamesCount, 1);
  const p1 = r.rows.find((x) => x.nick === 'Игрок 1');
  // мирный, красные проиграли: 0 + доп 0,3 + ЛХ 2 чёрных 0,25 + Ci (i=1, B=1 → 0,4)
  assert.equal(p1.lx, 0.25);
  assert.equal(p1.ci, 0.4);
  assert.equal(p1.total, 0.95);
  const p8 = r.rows.find((x) => x.nick === 'Игрок 8');
  assert.equal(p8.total, 1.5);
  assert.equal(r.rows[0].nick, 'Игрок 8');
  const g = (await call('GET', '/api/games?format=msk&month=2026-10')).data.games[0];
  assert.equal(g.lxBlacks, 2);
  assert.equal(g.seats[0].total, 0.55);
  assert.deepEqual((await call('GET', '/api/rating/months?format=msk')).data.months, ['2026-10']);
});

test('правка: ведущий правит свой протокол, чужой — нет; удаляет только админ', async () => {
  const p = protocol({ result: 'red', lx: [null, null, null] });
  p.seats[7].dop = 0; p.seats[0].dop = 0.5;
  const upd = await call('PUT', '/api/staff/games/' + gameId, p, host);
  assert.equal(upd.status, 200, JSON.stringify(upd.data));
  const r = (await call('GET', '/api/rating?format=msk&month=2026-10')).data;
  assert.equal(r.rows.find((x) => x.nick === 'Игрок 1').total, 1.5);

  const other = await call('POST', '/api/staff/games', protocol({ tableNo: 2 }), admin);
  assert.equal(other.status, 201);
  assert.equal((await call('PUT', '/api/staff/games/' + other.data.game.id, protocol({ tableNo: 2 }), host)).status, 403);
  assert.equal((await call('DELETE', '/api/staff/games/' + other.data.game.id, undefined, host)).status, 403);
  assert.equal((await call('DELETE', '/api/staff/games/' + other.data.game.id, undefined, admin)).status, 200);
});

test('база сама отклоняет неверный протокол в обход API', async () => {
  await assert.rejects(db.tx(async (c) => {
    await c.query(`INSERT INTO games (format, played_on, result) VALUES ('msk', '2026-10-12', 'red')`);
    await c.query(`INSERT INTO game_seats (game_id, seat_no, player_id, role) SELECT currval('games_id_seq'), id, id, 'civ' FROM players ORDER BY id LIMIT 10`);
  }), /msk table/);
});

test('игроки: переименование сохраняет историю, объединение дублей', async () => {
  const players = (await call('GET', '/api/admin/players', undefined, admin)).data.players;
  const p1 = players.find((x) => x.nick === 'Игрок 1');
  assert.equal((await call('PUT', '/api/admin/players/' + p1.id, { nick: 'Доцент' }, admin)).status, 200);
  const r = (await call('GET', '/api/rating?format=msk&month=2026-10')).data;
  assert.ok(r.rows.find((x) => x.nick === 'Доцент'));
  const dup = (await call('POST', '/api/staff/players', { nick: 'доцент2' }, host)).data.player;
  assert.equal((await call('POST', `/api/admin/players/${dup.id}/merge`, { intoId: p1.id }, admin)).status, 200);
  const p2 = players.find((x) => x.nick === 'Игрок 2');
  assert.equal((await call('POST', `/api/admin/players/${p2.id}/merge`, { intoId: p1.id }, admin)).status, 409);
});

test('сотрудники: нельзя остаться без администратора', async () => {
  const me = (await call('GET', '/api/auth/me', undefined, admin)).data.me;
  assert.equal((await call('PUT', '/api/admin/staff/' + me.id, { name: 'Степан', role: 'host', active: true }, admin)).status, 400);
  const created = await call('POST', '/api/admin/staff', { login: 'host2', name: 'Ведущий Два', role: 'host', password: 'short' }, admin);
  assert.equal(created.status, 400);
  assert.equal((await call('POST', '/api/admin/staff', { login: 'host2', name: 'Ведущий Два', role: 'host', password: 'long-enough-pass' }, admin)).status, 201);
  const log = (await call('GET', '/api/admin/audit', undefined, admin)).data.log;
  assert.ok(log.some((x) => x.entity === 'game' && x.action === 'delete'));
});

test('профиль игрока: статистика, места и достижения', async () => {
  const r = (await call('GET', '/api/rating?format=msk&month=2026-10')).data;
  const id = r.rows[0].playerId;
  const prof = await call('GET', '/api/players/' + id);
  assert.equal(prof.status, 200);
  assert.equal(prof.data.player.id, id);
  assert.ok(prof.data.totals.games >= 1);
  assert.equal(prof.data.achievements.length, 14);
  assert.ok(prof.data.series.length >= 1);
  assert.equal((await call('GET', '/api/players/999999')).status, 404);
  const g = (await call('GET', '/api/games?format=msk&month=2026-10')).data.games[0];
  assert.ok(g.seats[0].playerId);
});

test('галерея: загрузка, скрытие, проверка формата и прав', async () => {
  // 1×1 JPEG
  const jpg = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  assert.equal((await call('POST', '/api/admin/gallery', { image: jpg, width: 1, height: 1 }, host)).status, 403);
  assert.equal((await call('POST', '/api/admin/gallery', { image: Buffer.from('<svg/>').toString('base64'), width: 1, height: 1 }, admin)).status, 400);
  const up = await call('POST', '/api/admin/gallery', { image: 'data:image/jpeg;base64,' + jpg, width: 1200, height: 800, caption: 'Финал сентября', takenOn: '2026-09-28' }, admin);
  assert.equal(up.status, 201);
  const pub = (await call('GET', '/api/gallery')).data.photos;
  assert.equal(pub.length, 1);
  assert.equal(pub[0].caption, 'Финал сентября');
  const img = await fetch(base + pub[0].src);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call('PATCH', '/api/admin/gallery/' + up.data.id, { caption: 'Скрыто', published: false }, admin)).status, 200);
  assert.equal((await call('GET', '/api/gallery')).data.photos.length, 0);
  assert.equal((await fetch(base + '/api/gallery/' + up.data.id + '/image')).status, 404);
  assert.equal((await call('DELETE', '/api/admin/gallery/' + up.data.id, undefined, admin)).status, 200);
  assert.equal((await call('GET', '/api/admin/gallery', undefined, admin)).data.photos.length, 0);
});

test('выход завершает сессию', async () => {
  await call('POST', '/api/auth/logout', {}, host);
  assert.equal((await call('GET', '/api/auth/me', undefined, host)).status, 401);
});
