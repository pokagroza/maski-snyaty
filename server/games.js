'use strict';
// Чтение протоколов и расчёт рейтинга. Рейтинг считается тем же модулем, что и превью в админке.
const db = require('./db');
const scoring = require('../shared/scoring');
const profileLib = require('../shared/profile');
const config = require('./config');

const SELECT = `
  SELECT g.id, g.event_id, g.format::text AS format, to_char(g.played_on, 'YYYY-MM-DD') AS date,
         g.table_no, g.host_name, g.result::text AS result, g.lx1, g.lx2, g.lx3, g.created_by,
         to_char(g.updated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS updated_at,
         s.seat_no, s.player_id, p.nick, s.role::text AS role, s.dop::float8 AS dop, s.fines,
         s.dq::text AS dq, s.first_killed
    FROM games g
    JOIN game_seats s ON s.game_id = g.id
    JOIN players p ON p.id = s.player_id`;

function group(rows) {
  const map = new Map();
  for (const r of rows) {
    let g = map.get(r.id);
    if (!g) {
      g = {
        id: r.id, eventId: r.event_id, format: r.format, date: r.date, tableNo: r.table_no, hostName: r.host_name,
        result: r.result, lx: [r.lx1, r.lx2, r.lx3], createdBy: r.created_by, updatedAt: r.updated_at, seats: []
      };
      map.set(r.id, g);
    }
    g.seats[r.seat_no - 1] = { playerId: r.player_id, nick: r.nick, role: r.role, dop: r.dop, fines: r.fines, dq: r.dq, first: r.first_killed };
  }
  return [...map.values()];
}

async function gamesForMonth(format, month) {
  const params = [month + '-01'];
  let where = `g.played_on >= $1::date AND g.played_on < ($1::date + interval '1 month')`;
  if (format) { params.push(format); where += ` AND g.format = $2`; }
  const { rows } = await db.query(`${SELECT} WHERE ${where} ORDER BY g.played_on DESC, g.table_no DESC, g.id DESC, s.seat_no`, params);
  return group(rows);
}

async function gameById(id, client) {
  const { rows } = await (client || db).query(`${SELECT} WHERE g.id = $1 ORDER BY s.seat_no`, [id]);
  return group(rows)[0] || null;
}

// Кэш рейтинга: сбрасывается при любом изменении протоколов
// version защищает от гонки: если протокол сохранили, пока считался рейтинг, устаревший результат не кэшируется
const cache = new Map();
let version = 0;
function invalidate() { version++; cache.clear(); }

async function rating(format, month) {
  const key = format + ':' + month;
  if (cache.has(key)) return cache.get(key);
  const startedAt = version;
  const games = await gamesForMonth(format, month);
  const rows = scoring.computeRating(games).map((r) => ({
    place: r.place, playerId: r.playerId, nick: r.nick, games: r.games, wins: r.wins, winRate: r.winRate,
    dop: r.dop, lx: r.lx, ci: r.ci, pen: r.pen, total: r.total, avg: r.avg, eligible: r.eligible, finalist: r.finalist
  }));
  const result = { format, month, minGames: scoring.MIN_GAMES, finalSpots: scoring.FINAL_SPOTS, gamesCount: games.length, rows };
  if (startedAt === version) cache.set(key, result);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return result;
}

// Публичный вид протокола: очки каждого места
function publicGame(g) {
  return {
    id: g.id, format: g.format, date: g.date, tableNo: g.tableNo, hostName: g.hostName, result: g.result,
    lx: g.lx, lxBlacks: g.format === 'msk' ? scoring.lxBlacks(g) : 0,
    seats: g.seats.map((s, i) => Object.assign({ playerId: s.playerId, nick: s.nick, role: s.role, first: s.first }, scoring.seatScore(g, i)))
  };
}

function clubMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.clubTz, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return parts.find((p) => p.type === 'year').value + '-' + parts.find((p) => p.type === 'month').value;
}

// Профиль игрока: все его игры, места в рейтингах по месяцам и маски-достижения
async function playerProfile(id) {
  const pl = await db.query(`SELECT id, nick, to_char(created_at, 'YYYY-MM-DD') AS since FROM players WHERE id = $1`, [id]);
  if (!pl.rows[0]) return null;
  const { rows } = await db.query(
    `${SELECT} WHERE g.id IN (SELECT game_id FROM game_seats WHERE player_id = $1) ORDER BY g.played_on, g.id, s.seat_no`, [id]
  );
  const list = group(rows);
  const keys = [...new Set(list.map((g) => g.format + ':' + g.date.slice(0, 7)))];
  const monthPlaces = {};
  for (const key of keys) {
    const [format, month] = key.split(':');
    const r = await rating(format, month);
    const row = r.rows.find((x) => x.playerId === id);
    if (row) monthPlaces[key] = { place: row.place, total: row.total, games: row.games, eligible: row.eligible, finalist: row.finalist };
  }
  return profileLib.buildProfile({ player: pl.rows[0], games: list, monthPlaces, now: clubMonth() });
}

module.exports = { gamesForMonth, gameById, rating, invalidate, publicGame, group, playerProfile };
