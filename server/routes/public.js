'use strict';
// Публичные маршруты: афиша, запись, рейтинг, протоколы.
const db = require('../db');
const config = require('../config');
const v = require('../validate');
const games = require('../games');
const { HttpError } = require('../http');
const { rateLimiter } = require('../auth');
const telegram = require('../telegram');

const ACTIVE = `status IN ('new', 'confirmed', 'attended')`;

const EVENT_COLUMNS = `
  e.id, e.kind::text AS kind, e.title, e.description,
  to_char(e.starts_at AT TIME ZONE $1, 'YYYY-MM-DD') AS date,
  to_char(e.starts_at AT TIME ZONE $1, 'HH24:MI') AS time,
  e.venue, e.price, e.capacity, e.table_size, e.is_spectator,
  COALESCE((SELECT sum(seats) FROM bookings b WHERE b.event_id = e.id AND b.${ACTIVE}), 0)::int AS taken`;

function eventOut(r) {
  return {
    id: r.id, kind: r.kind, title: r.title, description: r.description, date: r.date, time: r.time, venue: r.venue,
    price: r.price, capacity: r.capacity, tableSize: r.table_size, spectator: r.is_spectator, taken: r.taken,
    left: Math.max(0, r.capacity - r.taken)
  };
}

const bookingLimit = rateLimiter({ windowMs: 60 * 60 * 1000, max: 8, key: (req) => 'book:' + req.ip, message: 'Слишком много заявок с вашего адреса. Попробуйте через час или напишите нам.' });

module.exports = function publicRoutes(r) {
  r.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  r.get('/api/events', async () => {
    const { rows } = await db.query(
      `SELECT ${EVENT_COLUMNS} FROM events e
        WHERE e.is_published AND e.starts_at > now() - interval '3 hours'
        ORDER BY e.starts_at LIMIT 60`,
      [config.clubTz]
    );
    return { events: rows.map(eventOut) };
  });

  r.post('/api/bookings', async (req) => {
    bookingLimit(req);
    const b = req.body || {};
    if (b.website) return { __status: 201, body: { ok: true } }; // поле-ловушка для ботов
    const kind = v.oneOf(b.requestKind || 'event', ['event', 'subscription', 'corporate', 'private'], 'Тип заявки');
    const name = v.str(b.name, { name: 'Имя', min: 1, max: 80 });
    const contact = v.str(b.contact, { name: 'Телефон или Telegram', min: 3, max: 80 });
    const digits = contact.replace(/\D/g, '');
    if (!/^@?[A-Za-z0-9_]{4,32}$/.test(contact) && (digits.length < 10 || digits.length > 15)) {
      v.bad('Укажите телефон из 10–11 цифр или ник в Telegram, например @lupin_guest.');
    }
    const comment = v.str(b.comment, { name: 'Комментарий', max: 500, optional: true });
    if (b.consent !== true) v.bad('Нужно согласие на обработку персональных данных.');
    const seats = kind === 'event' ? v.int(b.seats, { name: 'Мест', min: 1, max: 6 }) : 1;
    const eventId = kind === 'event' ? v.id(b.eventId, 'Игра') : null;

    const id = await db.tx(async (c) => {
      if (eventId) {
        const { rows } = await c.query(
          `SELECT id, capacity, is_published, starts_at > now() AS upcoming FROM events WHERE id = $1 FOR UPDATE`, [eventId]
        );
        const e = rows[0];
        if (!e || !e.is_published) throw new HttpError(404, 'Эта игра не найдена в афише.');
        if (!e.upcoming) throw new HttpError(409, 'Запись на эту игру уже закрыта.');
        const taken = (await c.query(`SELECT COALESCE(sum(seats), 0)::int AS n FROM bookings WHERE event_id = $1 AND ${ACTIVE}`, [eventId])).rows[0].n;
        const left = e.capacity - taken;
        if (left <= 0) throw new HttpError(409, 'Мест на эту игру не осталось.');
        if (seats > left) throw new HttpError(409, `Осталось мест: ${left}. Уменьшите количество.`, { left });
      }
      const ins = await c.query(
        `INSERT INTO bookings (request_kind, event_id, name, contact, seats, comment, consent_at)
         VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
        [kind, eventId, name, contact, seats, comment]
      );
      return ins.rows[0].id;
    });
    telegram.notifyBookingLater(id);
    return { __status: 201, body: { ok: true, id } };
  });

  r.get('/api/rating/months', async (req) => {
    const format = v.oneOf(req.query.format || 'msk', ['msk', 'spb'], 'Формат');
    const { rows } = await db.query(
      `SELECT DISTINCT to_char(played_on, 'YYYY-MM') AS month FROM games WHERE format = $1 ORDER BY 1 DESC LIMIT 36`, [format]
    );
    return { months: rows.map((x) => x.month) };
  });

  r.get('/api/rating', async (req) => {
    const format = v.oneOf(req.query.format || 'msk', ['msk', 'spb'], 'Формат');
    const month = v.month(req.query.month);
    return games.rating(format, month);
  });

  r.get('/api/players/:id', async (req) => {
    const prof = await games.playerProfile(v.id(req.params.id, 'Игрок'));
    if (!prof) throw new HttpError(404, 'Игрок не найден.');
    return prof;
  });

  r.get('/api/games', async (req) => {
    const format = v.oneOf(req.query.format || 'msk', ['msk', 'spb'], 'Формат');
    const month = v.month(req.query.month);
    const list = await games.gamesForMonth(format, month);
    return { games: list.slice(0, 200).map(games.publicGame) };
  });
};

module.exports.eventOut = eventOut;
module.exports.EVENT_COLUMNS = EVENT_COLUMNS;
