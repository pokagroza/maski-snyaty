'use strict';
// Администратор: афиша, заявки, игроки, сотрудники, журнал.
const db = require('../db');
const config = require('../config');
const v = require('../validate');
const games = require('../games');
const { HttpError } = require('../http');
const auth = require('../auth');
const { EVENT_COLUMNS, eventOut } = require('./public');

const KINDS = ['msk', 'spb', 'novice', 'theme', 'final'];
const STATUSES = ['new', 'confirmed', 'attended', 'no_show', 'cancelled'];

function parseEvent(b) {
  b = b || {};
  return {
    kind: v.oneOf(b.kind, KINDS, 'Формат'),
    title: v.str(b.title, { name: 'Название', min: 1, max: 120 }),
    description: v.str(b.description, { name: 'Описание', max: 600, optional: true }),
    startsAt: v.localDateTime(b.startsAt, 'Начало'),
    venue: v.str(b.venue || 'Джи Бар, ул. Николаева, 30', { name: 'Место', min: 1, max: 120 }),
    price: v.int(b.price, { name: 'Цена', min: 0, max: 1000000 }),
    capacity: v.int(b.capacity, { name: 'Мест', min: 1, max: 500 }),
    tableSize: v.int(b.tableSize === undefined ? 10 : b.tableSize, { name: 'Мест за столом', min: 8, max: 14 }),
    spectator: v.bool(b.spectator),
    published: b.published === undefined ? true : v.bool(b.published)
  };
}

module.exports = function adminRoutes(r) {
  // ---------- афиша ----------
  r.get('/api/admin/events', async (req) => {
    auth.requireAdmin(req);
    const scope = req.query.scope === 'past' ? 'past' : 'upcoming';
    const { rows } = await db.query(
      `SELECT ${EVENT_COLUMNS}, e.is_published, to_char(e.starts_at AT TIME ZONE $1, 'YYYY-MM-DD"T"HH24:MI') AS starts_local,
              (SELECT count(*) FROM bookings b WHERE b.event_id = e.id)::int AS bookings_total
         FROM events e
        WHERE ${scope === 'past' ? `e.starts_at < now() - interval '3 hours'` : `e.starts_at >= now() - interval '3 hours'`}
        ORDER BY e.starts_at ${scope === 'past' ? 'DESC' : 'ASC'} LIMIT 200`,
      [config.clubTz]
    );
    return { events: rows.map((x) => Object.assign(eventOut(x), { published: x.is_published, startsAt: x.starts_local, bookingsTotal: x.bookings_total })) };
  });

  r.post('/api/admin/events', async (req) => {
    auth.requireAdmin(req);
    const e = parseEvent(req.body);
    const { rows } = await db.query(
      `INSERT INTO events (kind, title, description, starts_at, venue, price, capacity, table_size, is_spectator, is_published)
       VALUES ($1, $2, $3, ($4::timestamp AT TIME ZONE $11), $5, $6, $7, $8, $9, $10) RETURNING id`,
      [e.kind, e.title, e.description, e.startsAt, e.venue, e.price, e.capacity, e.tableSize, e.spectator, e.published, config.clubTz]
    );
    await auth.audit(null, req.staff.id, 'create', 'event', rows[0].id, { title: e.title, startsAt: e.startsAt });
    return { __status: 201, body: { id: rows[0].id } };
  });

  r.put('/api/admin/events/:id', async (req) => {
    auth.requireAdmin(req);
    const id = v.id(req.params.id);
    const e = parseEvent(req.body);
    const taken = (await db.query(`SELECT COALESCE(sum(seats), 0)::int AS n FROM bookings WHERE event_id = $1 AND status IN ('new', 'confirmed', 'attended')`, [id])).rows[0].n;
    if (e.capacity < taken) throw new HttpError(400, `Уже записано ${taken} человек — мест не может быть меньше.`);
    const { rowCount } = await db.query(
      `UPDATE events SET kind = $2, title = $3, description = $4, starts_at = ($5::timestamp AT TIME ZONE $12), venue = $6, price = $7,
              capacity = $8, table_size = $9, is_spectator = $10, is_published = $11, updated_at = now() WHERE id = $1`,
      [id, e.kind, e.title, e.description, e.startsAt, e.venue, e.price, e.capacity, e.tableSize, e.spectator, e.published, config.clubTz]
    );
    if (!rowCount) throw new HttpError(404, 'Игра не найдена.');
    await auth.audit(null, req.staff.id, 'update', 'event', id, { title: e.title });
    return { ok: true };
  });

  r.delete('/api/admin/events/:id', async (req) => {
    auth.requireAdmin(req);
    const id = v.id(req.params.id);
    const n = (await db.query('SELECT count(*)::int AS n FROM bookings WHERE event_id = $1', [id])).rows[0].n;
    if (n) throw new HttpError(409, `На эту игру есть заявки (${n}). Снимите её с публикации вместо удаления.`);
    const { rowCount } = await db.query('DELETE FROM events WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Игра не найдена.');
    await auth.audit(null, req.staff.id, 'delete', 'event', id);
    return { ok: true };
  });

  // ---------- заявки ----------
  r.get('/api/admin/bookings', async (req) => {
    auth.requireAdmin(req);
    const params = [config.clubTz];
    const where = [];
    if (req.query.status) { params.push(v.oneOf(req.query.status, STATUSES, 'Статус')); where.push(`b.status = $${params.length}`); }
    if (req.query.eventId) { params.push(v.id(req.query.eventId)); where.push(`b.event_id = $${params.length}`); }
    const { rows } = await db.query(
      `SELECT b.id, b.request_kind::text AS kind, b.event_id, b.name, b.contact, b.seats, b.comment, b.status::text AS status,
              to_char(b.created_at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS created,
              e.title AS event_title, to_char(e.starts_at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS event_starts
         FROM bookings b LEFT JOIN events e ON e.id = b.event_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY b.created_at DESC LIMIT 300`,
      params
    );
    return { bookings: rows };
  });

  r.patch('/api/admin/bookings/:id', async (req) => {
    auth.requireAdmin(req);
    const id = v.id(req.params.id);
    const status = v.oneOf((req.body || {}).status, STATUSES, 'Статус');
    const { rowCount } = await db.query('UPDATE bookings SET status = $2, handled_by = $3, updated_at = now() WHERE id = $1', [id, status, req.staff.id]);
    if (!rowCount) throw new HttpError(404, 'Заявка не найдена.');
    await auth.audit(null, req.staff.id, 'status', 'booking', id, { status });
    return { ok: true };
  });

  // ---------- игроки ----------
  r.get('/api/admin/players', async (req) => {
    auth.requireAdmin(req);
    const { rows } = await db.query(
      `SELECT p.id, p.nick, p.note, to_char(p.created_at, 'YYYY-MM-DD') AS created,
              (SELECT count(*) FROM game_seats s WHERE s.player_id = p.id)::int AS games
         FROM players p ORDER BY p.nick_key LIMIT 3000`
    );
    return { players: rows };
  });

  r.put('/api/admin/players/:id', async (req) => {
    auth.requireAdmin(req);
    const id = v.id(req.params.id);
    const nick = v.str((req.body || {}).nick, { name: 'Ник', min: 1, max: 40 });
    const note = v.str((req.body || {}).note, { name: 'Заметка', max: 300, optional: true });
    try {
      const { rowCount } = await db.query('UPDATE players SET nick = $2, note = $3 WHERE id = $1', [id, nick, note || null]);
      if (!rowCount) throw new HttpError(404, 'Игрок не найден.');
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'Игрок с таким ником уже есть. Объедините карточки, если это один человек.');
      throw err;
    }
    games.invalidate();
    await auth.audit(null, req.staff.id, 'update', 'player', id, { nick });
    return { ok: true };
  });

  // Объединить дубли: все игры игрока id переходят к intoId, карточка id удаляется
  r.post('/api/admin/players/:id/merge', async (req) => {
    auth.requireAdmin(req);
    const id = v.id(req.params.id);
    const into = v.id((req.body || {}).intoId, 'Основная карточка');
    if (id === into) throw new HttpError(400, 'Выберите другую карточку.');
    await db.tx(async (c) => {
      const both = await c.query('SELECT id, nick FROM players WHERE id = $1 OR id = $2 FOR UPDATE', [id, into]);
      if (both.rows.length !== 2) throw new HttpError(404, 'Игрок не найден.');
      const clash = await c.query(
        `SELECT count(*)::int AS n FROM game_seats a JOIN game_seats b ON a.game_id = b.game_id WHERE a.player_id = $1 AND b.player_id = $2`, [id, into]
      );
      if (clash.rows[0].n) throw new HttpError(409, 'Эти игроки сидели за одним столом — это разные люди, объединять нельзя.');
      await c.query('UPDATE game_seats SET player_id = $2 WHERE player_id = $1', [id, into]);
      await c.query('DELETE FROM players WHERE id = $1', [id]);
      await auth.audit(c, req.staff.id, 'merge', 'player', into, { from: both.rows.find((x) => x.id === id).nick });
    });
    games.invalidate();
    return { ok: true };
  });

  r.delete('/api/admin/players/:id', async (req) => {
    auth.requireAdmin(req);
    const id = v.id(req.params.id);
    const n = (await db.query('SELECT count(*)::int AS n FROM game_seats WHERE player_id = $1', [id])).rows[0].n;
    if (n) throw new HttpError(409, 'У игрока есть сыгранные игры. Удалить можно только карточку без игр.');
    await db.query('DELETE FROM players WHERE id = $1', [id]);
    await auth.audit(null, req.staff.id, 'delete', 'player', id);
    return { ok: true };
  });

  // ---------- сотрудники ----------
  r.get('/api/admin/staff', async (req) => {
    auth.requireAdmin(req);
    const { rows } = await db.query(
      `SELECT id, login, display_name AS name, role::text AS role, is_active AS active,
              to_char(last_login_at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS last_login
         FROM staff ORDER BY role, login`, [config.clubTz]
    );
    return { staff: rows };
  });

  r.post('/api/admin/staff', async (req) => {
    auth.requireAdmin(req);
    const b = req.body || {};
    const login = v.str(b.login, { name: 'Логин', min: 3, max: 32 }).toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(login)) v.bad('Логин: латинские буквы, цифры, точка, дефис или подчёркивание.');
    const name = v.str(b.name, { name: 'Имя', min: 1, max: 60 });
    const role = v.oneOf(b.role, ['admin', 'host'], 'Роль');
    auth.validatePassword(b.password);
    try {
      const { rows } = await db.query(
        'INSERT INTO staff (login, display_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
        [login, name, role, await auth.hashPassword(b.password)]
      );
      await auth.audit(null, req.staff.id, 'create', 'staff', rows[0].id, { login, role });
      return { __status: 201, body: { id: rows[0].id } };
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'Такой логин уже занят.');
      throw err;
    }
  });

  r.put('/api/admin/staff/:id', async (req) => {
    auth.requireAdmin(req);
    const id = v.id(req.params.id);
    const b = req.body || {};
    const name = v.str(b.name, { name: 'Имя', min: 1, max: 60 });
    const role = v.oneOf(b.role, ['admin', 'host'], 'Роль');
    const active = v.bool(b.active);
    if (id === req.staff.id && (role !== 'admin' || !active)) throw new HttpError(400, 'Нельзя снять права администратора или отключить самого себя.');
    await db.tx(async (c) => {
      const { rowCount } = await c.query('UPDATE staff SET display_name = $2, role = $3, is_active = $4 WHERE id = $1', [id, name, role, active]);
      if (!rowCount) throw new HttpError(404, 'Сотрудник не найден.');
      const admins = (await c.query(`SELECT count(*)::int AS n FROM staff WHERE role = 'admin' AND is_active`)).rows[0].n;
      if (!admins) throw new HttpError(400, 'Должен остаться хотя бы один активный администратор.');
      if (b.password) {
        auth.validatePassword(b.password);
        await c.query('UPDATE staff SET password_hash = $2 WHERE id = $1', [id, await auth.hashPassword(b.password)]);
      }
      if (b.password || !active) await c.query('DELETE FROM sessions WHERE staff_id = $1', [id]);
      await auth.audit(c, req.staff.id, 'update', 'staff', id, { role, active, passwordReset: !!b.password });
    });
    return { ok: true };
  });

  // ---------- журнал ----------
  r.get('/api/admin/audit', async (req) => {
    auth.requireAdmin(req);
    const { rows } = await db.query(
      `SELECT a.id, to_char(a.at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS at, s.display_name AS staff, a.action, a.entity, a.entity_id, a.details
         FROM audit_log a LEFT JOIN staff s ON s.id = a.staff_id ORDER BY a.at DESC LIMIT 200`, [config.clubTz]
    );
    return { log: rows };
  });
};
