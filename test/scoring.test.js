'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/scoring');

const MSK = ['civ', 'civ', 'civ', 'civ', 'civ', 'civ', 'sher', 'maf', 'maf', 'don'];
function msk(over = {}) {
  const seats = MSK.map((role, i) => ({ playerId: i + 1, nick: 'P' + (i + 1), role, dop: 0, fines: 0, dq: 'none', first: false }));
  return Object.assign({ format: 'msk', date: '2026-10-11', result: 'red', lx: [null, null, null], seats }, over);
}

test('победа даёт +1 всей команде, проигравшим 0', () => {
  const g = msk({ result: 'red' });
  assert.equal(S.seatScore(g, 0).main, 1);
  assert.equal(S.seatScore(g, 6).main, 1);   // шериф
  assert.equal(S.seatScore(g, 7).main, 0);   // мафия
  const b = msk({ result: 'black' });
  assert.equal(S.seatScore(b, 9).main, 1);   // дон
  assert.equal(S.seatScore(b, 0).main, 0);
});

test('ничья: основные баллы никому', () => {
  const g = msk({ result: 'draw' });
  g.seats.forEach((_, i) => assert.equal(S.seatScore(g, i).main, 0));
});

test('лучший ход: 3 чёрных +0,5, 2 чёрных +0,25, 1 чёрный 0', () => {
  const g = msk({ result: 'black' });
  g.seats[0].first = true;
  g.lx = [8, 9, 10]; assert.equal(S.seatScore(g, 0).lx, 0.5);
  g.lx = [8, 9, 2];  assert.equal(S.seatScore(g, 0).lx, 0.25);
  g.lx = [8, 2, 3];  assert.equal(S.seatScore(g, 0).lx, 0);
});

test('лучший ход не начисляется чёрному и в питерской', () => {
  const g = msk({ result: 'red' });
  g.seats[7].first = true; g.lx = [8, 9, 10];
  assert.equal(S.seatScore(g, 7).lx, 0);
});

test('штрафы: ошибка −0,4, удаление −0,5, ППК −1', () => {
  const g = msk({ result: 'red' });
  g.seats[0].fines = 2;  assert.equal(S.seatScore(g, 0).total, 0.2);  // 1 − 0,8
  g.seats[1].dq = 'dq';  assert.equal(S.seatScore(g, 1).total, 0.5);
  g.seats[2].dq = 'ppk'; assert.equal(S.seatScore(g, 2).total, 0);
});

test('Ci по формуле ФСМ: i × 0,4 / B, не больше 0,4', () => {
  assert.equal(S.r2(S.ciValue(1, 10)), 0.1);  // B = 4
  assert.equal(S.r2(S.ciValue(4, 10)), 0.4);
  assert.equal(S.r2(S.ciValue(6, 10)), 0.4);  // i > B
  assert.equal(S.r2(S.ciValue(1, 2)), 0.4);   // B = max(1, round(0,8)) = 1
});

test('Ci: полностью при поражении красных, половина при победе с чёрным в ЛХ', () => {
  const lost = msk({ result: 'black' }); lost.seats[0].first = true;
  assert.equal(S.ciShare(lost, 0), 1);
  const wonWithBlack = msk({ result: 'red', lx: [8, 2, 3] }); wonWithBlack.seats[0].first = true;
  assert.equal(S.ciShare(wonWithBlack, 0), 0.5);
  const wonNoBlack = msk({ result: 'red', lx: [2, 3, 4] }); wonNoBlack.seats[0].first = true;
  assert.equal(S.ciShare(wonNoBlack, 0), 0);
  const draw = msk({ result: 'draw' }); draw.seats[0].first = true;
  assert.equal(S.ciShare(draw, 0), 0);
});

test('рейтинг месяца: суммы, Ci, допуск и места', () => {
  const games = [];
  for (let k = 0; k < 6; k++) {
    const g = msk({ result: k < 4 ? 'black' : 'red' });
    if (k === 0) { g.seats[0].first = true; g.lx = [8, 9, 10]; } // игрок 1: убит первым, 3 чёрных, красные проиграли
    if (k < 4) { g.seats[7].dop = 0.5; }
    games.push(g);
  }
  const rows = S.computeRating(games);
  const p1 = rows.find(r => r.playerId === 1);
  // 6 игр, 2 победы, ЛХ 0,5, i = 1, B = round(2,4) = 2, Ci = 0,2, получен полностью
  assert.equal(p1.games, 6);
  assert.equal(p1.wins, 2);
  assert.equal(p1.lx, 0.5);
  assert.equal(p1.ci, 0.2);
  assert.equal(p1.total, 2.7);
  const p8 = rows.find(r => r.playerId === 8);
  assert.equal(p8.total, 6);   // 4 победы + 4 × 0,5
  assert.equal(rows[0].playerId, 8);
  assert.equal(rows[0].place, 1);
  assert.ok(rows.every(r => r.eligible));
});

test('игрок с малым числом игр не получает место', () => {
  const rows = S.computeRating([msk()]);
  assert.ok(rows.every(r => !r.eligible && r.place === null));
});

test('проверка протокола: верный стол проходит', () => {
  const g = msk({ result: 'black', lx: [8, 9, 2] });
  g.seats[0].first = true; g.seats[7].dop = 0.5; g.seats[0].dop = 0.3;
  assert.deepEqual(S.validateGame(g).errors, []);
});

test('проверка протокола ловит ошибки', () => {
  const comp = msk(); comp.seats[0].role = 'maf';
  assert.match(S.validateGame(comp).errors.join(), /Состав/);
  const sum = msk({ result: 'red' }); sum.seats[0].dop = 0.7; sum.seats[1].dop = 0.6;
  assert.match(S.validateGame(sum).errors.join(), /лимит 1,2/);
  const lose = msk({ result: 'red' }); lose.seats[7].dop = 0.5;
  assert.match(S.validateGame(lose).errors.join(), /проигравшему/);
  const draw = msk({ result: 'draw' }); draw.seats[0].dop = 0.2;
  assert.match(S.validateGame(draw).errors.join(), /ничьей/);
  const dup = msk(); dup.seats[1].playerId = 1;
  assert.match(S.validateGame(dup).errors.join(), /двух местах/);
  const lx = msk({ lx: [1, 2, 3] }); lx.seats[0].first = true;
  assert.match(S.validateGame(lx).errors.join(), /себя/);
  const lx2 = msk({ lx: [2, 3, null] }); lx2.seats[0].first = true;
  assert.match(S.validateGame(lx2).errors.join(), /три номера/);
});

test('доп 0,3 не считается дробной ошибкой', () => {
  const g = msk({ result: 'red' }); g.seats[0].dop = 0.3;
  assert.deepEqual(S.validateGame(g).errors, []);
});
