'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../shared/profile');

const MSK = ['civ', 'civ', 'civ', 'civ', 'civ', 'civ', 'sher', 'maf', 'maf', 'don'];
let gid = 0;
function game(over, seatOver) {
  const seats = MSK.map((role, i) => ({ playerId: i + 1, nick: 'P' + (i + 1), role, dop: 0, fines: 0, dq: 'none', first: false }));
  if (seatOver) seatOver(seats);
  return Object.assign({ id: ++gid, format: 'msk', date: '2026-10-' + String(10 + gid % 18).padStart(2, '0'), tableNo: 1, result: 'red', lx: [null, null, null], seats }, over);
}

test('статистика: игры, победы, роли, серия', () => {
  const games = [
    game({ result: 'black' }, (s) => { s[0].role = 'maf'; s[7].role = 'civ'; }), // игрок 1 — мафия, победа
    game({ result: 'red' }),
    game({ result: 'red' }),
    game({ result: 'black' })
  ];
  const p = P.buildProfile({ player: { id: 1, nick: 'P1' }, games, monthPlaces: {}, now: '2026-10' });
  assert.equal(p.totals.games, 4);
  assert.equal(p.totals.wins, 3);
  assert.equal(p.totals.winRate, 75);
  assert.equal(p.totals.bestStreak, 3);
  assert.equal(p.roles.find((r) => r.role === 'maf').wins, 1);
  assert.equal(p.achievements.find((a) => a.id === 'first-blood').earned, true);
  assert.equal(p.achievements.find((a) => a.id === 'streak').progress, 3);
  assert.equal(p.recent[0].id, games[3].id);
});

test('Шерлок: лучший ход с тремя чёрными', () => {
  const g = game({ result: 'black', lx: [8, 9, 10] }, (s) => { s[0].first = true; });
  const p = P.buildProfile({ player: { id: 1, nick: 'P1' }, games: [g], monthPlaces: {}, now: '2026-10' });
  assert.equal(p.totals.lx3, 1);
  assert.equal(p.achievements.find((a) => a.id === 'sherlock').earned, true);
});

test('чемпион только за завершённый месяц', () => {
  const places = { 'msk:2026-09': { place: 1, total: 9, eligible: true, finalist: true }, 'msk:2026-10': { place: 1, total: 5, eligible: true, finalist: true } };
  const p = P.buildProfile({ player: { id: 1, nick: 'P1' }, games: [], monthPlaces: places, now: '2026-10' });
  assert.equal(p.achievements.find((a) => a.id === 'champion').progress, 1);
  assert.equal(p.achievements.find((a) => a.id === 'finalist').earned, true);
  assert.equal(p.totals.bestPlace, 1);
  assert.equal(p.series.length, 2);
});
