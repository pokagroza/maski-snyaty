'use strict';
// Вход и работа ведущих: протоколы игр и игроки.
const db = require('../db');
const config = require('../config');
const v = require('../validate');
const games = require('../games');
const scoring = require('../../shared/scoring');
const { HttpError } = require('../http');
const auth = require('../auth');

const loginByIp = auth.rateLimiter({ windowMs: 15 * 60 * 1000, max: 20, key: (req) => 'login-ip:' + req.ip, message: 'Слишком много попыток входа. Подождите 15 минут.' });
const loginByName = auth.rateLimiter({ windowMs: 15 * 60 * 1000, max: 8, key: (req) => 'login-name:' + String((req.body || {}).login || '').toLowerCase(), message: 'Слишком много попыток входа под этим логином. Подождите 15 минут.' });

function dbError(err) {
  if (err && err.code === '23514') return new HttpError(400, 'База отклонила протокол: он не проходит проверку правил. Проверьте состав, допы и лучший ход.', { detail: err.message });
  if (err && err.code === '23505') return new HttpError(400, 'Один и тот же игрок записан на двух местах или отмечено больше одного первого убитого.');
  if (err && err.code === '23503') return new HttpError(400, 'Игрок или игра, на которые ссылается протокол, не найдены.');
  return err;
}

function parseProtocol(body) {
  const b = body || {};
  const format = v.oneOf(b.format, ['msk', 'spb'], 'Формат');
  const seatsIn = Array.isArray(b.seats) ? b.seats : v.bad('Нет списка мест.');
  if (seatsIn.length < 8 || seatsIn.length > 14) v.bad('За столом должно быть от 8 до 14 мест.');
  const seats = seatsIn.map((s, i) => {
    const seat = s || {};
    return {
      playerId: seat.playerId === undefined || seat.playerId === null || seat.playerId === '' ? null : v.id(seat.playerId, 'Игрок'),
      nick: v.str(seat.nick, { name: `Ник на месте ${i + 1}`, max: 40, optional: true }),
      role: v.oneOf(seat.role, scoring.SPB_ROLES, `Роль на месте ${i + 1}`),
      dop: Math.round(v.num(seat.dop, { name: `Доп на месте ${i + 1}`, min: 0, max: 0.7 }) * 100) / 100,
      fines: v.int(seat.fines || 0, { name: `Ошибки на месте ${i + 1}`, min: 0, max: 3 }),
      dq: v.oneOf(seat.dq || 'none', ['none', 'dq', 'ppk'], `Удаление на месте ${i + 1}`),
      first: v.bool(seat.first)
    };
  });
  const lxIn = Array.isArray(b.lx) ? b.lx.slice(0, 3) : [];
  const lx = [0, 1, 2].map((k) => (lxIn[k] === null || lxIn[k] === undefined || lxIn[k] === '' ? null : v.int(lxIn[k], { name: 'Лучший ход', min: 1, max: 14 })));
  return {
    format,
    date: v.date(b.date, 'Дата игры'),
    tableNo: v.int(b.tableNo === undefined ? 1 : b.tableNo, { name: 'Стол', min: 1, max: 20 }),
    hostName: v.str(b.hostName, { name: 'Ведущий', max: 60, optional: true }),
    result: v.oneOf(b.result, ['red', 'black', 'maniac', 'draw'], 'Результат'),
    eventId: b.eventId ? v.id(b.eventId, 'Игра из афиши') : null,
    lx,
    seats,
    createPlayers: b.createPlayers === true
  };
}

// Находит игроков по id или нику; новых создаёт только с явного подтверждения
async function resolvePlayers(c, p) {
  const missing = [];
  for (const s of p.seats) {
    if (s.playerId) {
      const { rows } = await c.query('SELECT id, nick FROM players WHERE id = $1', [s.playerId]);
      if (!rows[0]) throw new HttpError(400, `Игрок с id ${s.playerId} не найден.`);
      s.nick = rows[0].nick;
      continue;
    }
    const { rows } = await c.query('SELECT id, nick FROM players WHERE nick_key = lower(btrim($1))', [s.nick]);
    if (rows[0]) { s.playerId = rows[0].id; s.nick = rows[0].nick; } else missing.push(s);
  }
  if (missing.length && !p.createPlayers) {
    throw new HttpError(409, 'В протоколе есть новые игроки. Подтвердите их создание.', { missing: missing.map((s) => s.nick) });
  }
  for (const s of missing) {
    const { rows } = await c.query(
      `INSERT INTO players (nick) VALUES ($1) ON CONFLICT (nick_key) DO UPDATE SET nick = players.nick RETURNING id, nick`, [s.nick]
    );
    s.playerId = rows[0].id; s.nick = rows[0].nick;
  }
  return missing.map((s) => s.nick);
}

async function writeSeats(c, gameId, seats) {
  await c.query('DELETE FROM game_seats WHERE game_id = $1', [gameId]);
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    await c.query(
      `INSERT INTO game_seats (game_id, seat_no, player_id, role, dop, fines, dq, first_killed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [gameId, i + 1, s.playerId, s.role, s.dop, s.fines, s.dq, s.first]
    );
  }
}

async function saveGame(req, existingId) {
  const p = parseProtocol(req.body);
  const check = scoring.validateGame(p);
  if (check.errors.length) throw new HttpError(400, check.errors[0], { errors: check.errors, warns: check.warns });
  const fi = scoring.firstIdx(p);
  const keepLx = p.format === 'msk' && fi >= 0 && scoring.teamOf(p.seats[fi].role) === 'red' && p.lx.every((x) => x);
  const lx = keepLx ? p.lx : [null, null, null];
  try {
    const result = await db.tx(async (c) => {
      if (p.eventId) {
        const e = await c.query('SELECT id FROM events WHERE id = $1', [p.eventId]);
        if (!e.rows[0]) throw new HttpError(400, 'Игра из афиши не найдена.');
      }
      let gameId = existingId;
      if (existingId) {
        const cur = await c.query('SELECT created_by FROM games WHERE id = $1 FOR UPDATE', [existingId]);
        if (!cur.rows[0]) throw new HttpError(404, 'Протокол не найден.');
        if (req.staff.role !== 'admin' && cur.rows[0].created_by !== req.staff.id) {
          throw new HttpError(403, 'Ведущий может править только свои протоколы. Обратитесь к администратору.');
        }
      }
      const created = await resolvePlayers(c, p);
      // повторная проверка после сопоставления ников с игроками (дубли одного игрока под разными написаниями)
      const recheck = scoring.validateGame(p);
      if (recheck.errors.length) throw new HttpError(400, recheck.errors[0], { errors: recheck.errors });
      if (existingId) {
        await c.query(
          `UPDATE games SET event_id = $2, format = $3, played_on = $4, table_no = $5, host_name = $6, result = $7,
                  lx1 = $8, lx2 = $9, lx3 = $10, updated_by = $11, updated_at = now() WHERE id = $1`,
          [existingId, p.eventId, p.format, p.date, p.tableNo, p.hostName, p.result, lx[0], lx[1], lx[2], req.staff.id]
        );
      } else {
        const ins = await c.query(
          `INSERT INTO games (event_id, format, played_on, table_no, host_name, result, lx1, lx2, lx3, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
          [p.eventId, p.format, p.date, p.tableNo, p.hostName, p.result, lx[0], lx[1], lx[2], req.staff.id]
        );
        gameId = ins.rows[0].id;
      }
      await writeSeats(c, gameId, p.seats);
      await auth.audit(c, req.staff.id, existingId ? 'update' : 'create', 'game', gameId, { date: p.date, format: p.format, table: p.tableNo, newPlayers: created });
      return { gameId, created };
    });
    games.invalidate();
    const saved = await games.gameById(result.gameId);
    return { game: saved, newPlayers: result.created, warns: check.warns };
  } catch (err) {
    throw dbError(err);
  }
}

module.exports = function staffRoutes(r) {
  // ---------- вход ----------
  r.post('/api/auth/login', async (req, res) => {
    loginByIp(req); loginByName(req);
    const login = v.str((req.body || {}).login, { name: 'Логин', min: 1, max: 32 }).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const { rows } = await db.query('SELECT id, login, display_name, role, password_hash, is_active FROM staff WHERE login = $1', [login]);
    const s = rows[0];
    if (!s) { await auth.dummyVerify(password); throw new HttpError(401, 'Неверный логин или пароль.'); }
    const ok = await auth.verifyPassword(password, s.password_hash);
    if (!ok || !s.is_active) throw new HttpError(401, 'Неверный логин или пароль.');
    await auth.createSession(res, s.id, req.headers['user-agent']);
    await db.query('UPDATE staff SET last_login_at = now() WHERE id = $1', [s.id]);
    await auth.audit(null, s.id, 'login', 'staff', s.id, { ip: req.ip });
    return { me: { id: s.id, login: s.login, name: s.display_name, role: s.role } };
  });

  r.post('/api/auth/logout', async (req, res) => {
    await auth.destroySession(req, res);
    return { ok: true };
  });

  r.get('/api/auth/me', async (req) => {
    auth.requireStaff(req);
    return { me: req.staff };
  });

  r.post('/api/auth/password', async (req) => {
    auth.requireStaff(req);
    const { current, next } = req.body || {};
    auth.validatePassword(next);
    const { rows } = await db.query('SELECT password_hash FROM staff WHERE id = $1', [req.staff.id]);
    if (!(await auth.verifyPassword(String(current || ''), rows[0].password_hash))) throw new HttpError(400, 'Текущий пароль указан неверно.');
    await db.query('UPDATE staff SET password_hash = $2 WHERE id = $1', [req.staff.id, await auth.hashPassword(next)]);
    await db.query('DELETE FROM sessions WHERE staff_id = $1 AND token_hash <> $2', [req.staff.id, require('crypto').createHash('sha256').update(req.cookies[auth.COOKIE]).digest('hex')]);
    await auth.audit(null, req.staff.id, 'password', 'staff', req.staff.id);
    return { ok: true };
  });

  // ---------- игроки ----------
  r.get('/api/staff/players', async (req) => {
    auth.requireStaff(req);
    const q = String(req.query.q || '').trim().slice(0, 40);
    const { rows } = q
      ? await db.query(`SELECT id, nick FROM players WHERE nick_key LIKE '%' || lower($1) || '%' ORDER BY nick_key LIMIT 20`, [q.replace(/[%_\\]/g, '')])
      : await db.query('SELECT id, nick FROM players ORDER BY nick_key LIMIT 3000');
    return { players: rows };
  });

  r.post('/api/staff/players', async (req) => {
    auth.requireStaff(req);
    const nick = v.str((req.body || {}).nick, { name: 'Ник', min: 1, max: 40 });
    const { rows } = await db.query(
      `INSERT INTO players (nick) VALUES ($1) ON CONFLICT (nick_key) DO UPDATE SET nick = players.nick RETURNING id, nick, (xmax = 0) AS created`, [nick]
    );
    if (rows[0].created) await auth.audit(null, req.staff.id, 'create', 'player', rows[0].id, { nick });
    return { player: { id: rows[0].id, nick: rows[0].nick }, created: rows[0].created };
  });

  // ---------- протоколы ----------
  r.get('/api/staff/games', async (req) => {
    auth.requireStaff(req);
    const month = v.month(req.query.month);
    const list = await games.gamesForMonth(null, month);
    return { games: list.map((g) => Object.assign(g, { canEdit: req.staff.role === 'admin' || g.createdBy === req.staff.id })) };
  });

  r.get('/api/staff/games/:id', async (req) => {
    auth.requireStaff(req);
    const g = await games.gameById(v.id(req.params.id));
    if (!g) throw new HttpError(404, 'Протокол не найден.');
    return { game: g };
  });

  r.post('/api/staff/games', async (req) => {
    auth.requireStaff(req);
    return { __status: 201, body: await saveGame(req, null) };
  });

  r.put('/api/staff/games/:id', async (req) => {
    auth.requireStaff(req);
    return saveGame(req, v.id(req.params.id));
  });

  r.delete('/api/staff/games/:id', async (req) => {
    auth.requireAdmin(req);
    const id = v.id(req.params.id);
    const g = await games.gameById(id);
    if (!g) throw new HttpError(404, 'Протокол не найден.');
    await db.tx(async (c) => {
      await c.query('DELETE FROM games WHERE id = $1', [id]);
      await auth.audit(c, req.staff.id, 'delete', 'game', id, { date: g.date, format: g.format, table: g.tableNo, seats: g.seats.map((s) => [s.nick, s.role]) });
    });
    games.invalidate();
    return { ok: true };
  });

  // Игры афиши за период — чтобы привязать протокол к вечеру
  r.get('/api/staff/events', async (req) => {
    auth.requireStaff(req);
    const month = v.month(req.query.month);
    const { rows } = await db.query(
      `SELECT e.id, e.kind::text AS kind, e.title,
              to_char(e.starts_at AT TIME ZONE $1, 'YYYY-MM-DD') AS date, to_char(e.starts_at AT TIME ZONE $1, 'HH24:MI') AS time
         FROM events e
        WHERE (e.starts_at AT TIME ZONE $1) >= $2::date AND (e.starts_at AT TIME ZONE $1) < ($2::date + interval '1 month')
        ORDER BY e.starts_at`,
      [config.clubTz, month + '-01']
    );
    return { events: rows };
  });
};
