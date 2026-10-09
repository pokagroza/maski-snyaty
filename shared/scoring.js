/*
 * «Маски сняты» — подсчёт очков по системе Федерации спортивной мафии (ФСМ).
 * Один и тот же файл работает на сервере (require) и в браузере (window.LupinScoring),
 * поэтому превью в админке и рейтинг на сайте всегда считают одинаково.
 *
 * Протокол игры:
 *   { format: 'msk'|'spb', result: 'red'|'black'|'maniac'|'draw',
 *     lx: [n, n, n] | [null, null, null],
 *     seats: [{ playerId, nick, role, dop, fines, dq: 'none'|'dq'|'ppk', first: bool }] }
 *   Номер места = индекс в seats + 1.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LupinScoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_GAMES = 6;          // допуск в рейтинг месяца
  var FINAL_SPOTS = 10;       // мест за финальным столом
  var DOP_MAX_WIN = 0.7;      // доп победителю (ФСМ)
  var DOP_MIN_WIN = 0.2;
  var DOP_MAX_LOSE = 0.4;     // доп проигравшему (ФСМ)
  var DOP_TABLE_MAX = 1.2;    // сумма допов за стол
  var FINE = 0.4;             // ошибка, повредившая команде
  var DQ = { none: 0, dq: 0.5, ppk: 1 };
  var CI_MAX = 0.4;

  var MSK_ROLES = ['civ', 'sher', 'maf', 'don'];
  var SPB_ROLES = ['civ', 'sher', 'doc', 'lover', 'maniac', 'maf', 'don'];
  var MSK_COMPOSITION = { civ: 6, sher: 1, maf: 2, don: 1 };

  function r2(x) { return Math.round(x * 100) / 100; }
  function teamOf(role) { return role === 'maf' || role === 'don' ? 'black' : role === 'maniac' ? 'solo' : 'red'; }
  function won(role, result) {
    if (!result || result === 'draw') return false;
    if (result === 'maniac') return role === 'maniac';
    return teamOf(role) === result;
  }
  function firstIdx(g) {
    for (var i = 0; i < g.seats.length; i++) if (g.seats[i].first) return i;
    return -1;
  }
  function lxBlacks(g) {
    var c = 0;
    (g.lx || []).forEach(function (n) {
      var s = n ? g.seats[n - 1] : null;
      if (s && teamOf(s.role) === 'black') c++;
    });
    return c;
  }
  function lxPoints(g, idx) {
    var s = g.seats[idx];
    if (g.format !== 'msk' || !s.first || teamOf(s.role) !== 'red') return 0;
    var b = lxBlacks(g);
    return b >= 3 ? 0.5 : b === 2 ? 0.25 : 0;
  }
  // Очки игрока за одну игру без Ci (Ci зависит от всего месяца)
  function seatScore(g, idx) {
    var s = g.seats[idx];
    var main = won(s.role, g.result) ? 1 : 0;
    var dop = +s.dop || 0;
    var lx = lxPoints(g, idx);
    var pen = (+s.fines || 0) * FINE + (DQ[s.dq] || 0);
    return { main: main, dop: dop, lx: lx, pen: r2(pen), total: r2(main + dop + lx - pen) };
  }
  // Доля Ci, которую получает первый убитый в этой игре: 1, 0.5 или 0 (ФСМ п. 8.6.3–8.6.4)
  function ciShare(g, idx) {
    var s = g.seats[idx];
    if (g.format !== 'msk' || !s.first || teamOf(s.role) !== 'red') return 0;
    if (g.result === 'black') return 1;
    if (g.result === 'red' && lxBlacks(g) >= 1) return 0.5;
    return 0;
  }
  // Ci = i × 0,4 / B при i ≤ B, иначе 0,4; B = 40% от числа игр (с округлением)
  function ciValue(firstKills, games) {
    var B = Math.max(1, Math.round(0.4 * games));
    return firstKills <= B ? firstKills * CI_MAX / B : CI_MAX;
  }

  function computeRating(games, opts) {
    opts = opts || {};
    var minGames = opts.minGames == null ? MIN_GAMES : opts.minGames;
    var P = {};
    games.forEach(function (g) {
      g.seats.forEach(function (s, i) {
        var key = s.playerId != null ? 'id:' + s.playerId : 'nick:' + String(s.nick || '').trim().toLowerCase();
        var p = P[key] || (P[key] = { playerId: s.playerId != null ? s.playerId : null, nick: s.nick, games: 0, wins: 0, main: 0, dop: 0, lx: 0, pen: 0, firstKills: 0, ciShares: [] });
        var sc = seatScore(g, i);
        p.games++;
        if (sc.main) p.wins++;
        p.main += sc.main; p.dop += sc.dop; p.lx += sc.lx; p.pen += sc.pen;
        if (g.format === 'msk' && s.first && teamOf(s.role) === 'red') {
          p.firstKills++;
          var sh = ciShare(g, i);
          if (sh) p.ciShares.push(sh);
        }
      });
    });
    var rows = Object.keys(P).map(function (k) {
      var p = P[k];
      var ci = ciValue(p.firstKills, p.games);
      p.ci = r2(p.ciShares.reduce(function (a, f) { return a + ci * f; }, 0));
      p.dop = r2(p.dop); p.lx = r2(p.lx); p.pen = r2(p.pen);
      p.total = r2(p.main + p.dop + p.lx + p.ci - p.pen);
      p.avg = r2(p.total / p.games);
      p.winRate = Math.round(p.wins / p.games * 100);
      p.eligible = p.games >= minGames;
      delete p.ciShares;
      return p;
    });
    rows.sort(function (a, b) {
      return (b.eligible - a.eligible) || (b.total - a.total) || (b.avg - a.avg) || (b.wins - a.wins) ||
        String(a.nick).localeCompare(String(b.nick), 'ru');
    });
    var place = 0;
    rows.forEach(function (r) { r.place = r.eligible ? ++place : null; r.finalist = r.eligible && r.place <= FINAL_SPOTS; });
    return rows;
  }

  // Проверка протокола. errors блокируют сохранение, warns — подсказки.
  function validateGame(g) {
    var errors = [], warns = [];
    var n = g.seats.length;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date || '')) errors.push('Укажите дату игры.');
    if (['red', 'black', 'maniac', 'draw'].indexOf(g.result) === -1) errors.push('Выберите результат игры.');
    if (g.format !== 'msk' && g.format !== 'spb') errors.push('Неизвестный формат игры.');
    var allowed = g.format === 'msk' ? MSK_ROLES : SPB_ROLES;

    var empty = 0, seen = {};
    g.seats.forEach(function (s, i) {
      var nick = String(s.nick || '').trim();
      if (!nick && s.playerId == null) { empty++; return; }
      var key = s.playerId != null ? 'id:' + s.playerId : 'nick:' + nick.toLowerCase();
      if (seen[key]) errors.push('Игрок «' + (nick || s.playerId) + '» записан на двух местах.');
      seen[key] = true;
      if (allowed.indexOf(s.role) === -1) errors.push('Место ' + (i + 1) + ': роль недоступна в этом формате.');
      if (['none', 'dq', 'ppk'].indexOf(s.dq || 'none') === -1) errors.push('Место ' + (i + 1) + ': неизвестный вид удаления.');
      var f = +s.fines || 0;
      if (f < 0 || f > 3 || f !== Math.floor(f)) errors.push('Место ' + (i + 1) + ': ошибок может быть от 0 до 3.');
    });
    if (empty) errors.push('Заполните ники: пусто на ' + empty + ' ' + (empty === 1 ? 'месте' : 'местах') + '.');

    var c = {};
    g.seats.forEach(function (s) { c[s.role] = (c[s.role] || 0) + 1; });
    if (g.format === 'msk') {
      if (n !== 10) errors.push('В московской мафии за столом 10 игроков.');
      var okComp = Object.keys(MSK_COMPOSITION).every(function (r) { return (c[r] || 0) === MSK_COMPOSITION[r]; });
      if (!okComp) errors.push('Состав московской мафии: 6 мирных, 1 шериф, 2 мафии и 1 дон.');
    } else if (g.format === 'spb') {
      if (n < 8 || n > 14) errors.push('В питерской мафии за столом от 8 до 14 игроков.');
      if (!(c.maf || 0) && !(c.don || 0)) errors.push('Нужна хотя бы одна мафия или дон.');
      if ((c.maniac || 0) > 1) errors.push('Маньяк за столом может быть только один.');
      if (g.result === 'maniac' && !c.maniac) errors.push('Победа маньяка, но маньяка нет за столом.');
    }
    if (g.result === 'maniac' && g.format === 'msk') errors.push('В московской мафии нет маньяка.');

    var firsts = g.seats.filter(function (s) { return s.first; }).length;
    if (firsts > 1) errors.push('Первым убитым может быть только один игрок.');
    var fi = firstIdx(g);
    var named = (g.lx || []).filter(function (x) { return x != null && x !== ''; }).map(Number);
    if (named.length) {
      if (g.format !== 'msk') errors.push('Лучший ход записывается только в московской мафии.');
      else if (fi < 0 || teamOf(g.seats[fi].role) !== 'red') errors.push('Лучший ход есть только у мирного или шерифа, убитого первым.');
      if (named.length !== 3) errors.push('В лучшем ходе нужно три номера или ни одного.');
      else {
        if (named[0] === named[1] || named[1] === named[2] || named[0] === named[2]) errors.push('Номера в лучшем ходе не должны повторяться.');
        if (named.some(function (x) { return x < 1 || x > n || x !== Math.floor(x); })) errors.push('В лучшем ходе указан несуществующий номер.');
        if (fi >= 0 && named.indexOf(fi + 1) !== -1) errors.push('Первый убитый не может назвать в лучшем ходе себя.');
      }
    }

    var sum = 0;
    g.seats.forEach(function (s, i) {
      var d = +s.dop || 0;
      sum += d;
      if (d < 0) errors.push('Место ' + (i + 1) + ': доп не может быть отрицательным.');
      if (Math.abs(Math.round(d * 100) - d * 100) > 1e-6) errors.push('Место ' + (i + 1) + ': доп указывается с точностью до сотых.');
      if (!d || !g.result || g.result === 'draw') return;
      var w = won(s.role, g.result);
      if (w && d > DOP_MAX_WIN) errors.push('Место ' + (i + 1) + ': победителю можно дать не больше +0,7.');
      if (!w && d > DOP_MAX_LOSE) errors.push('Место ' + (i + 1) + ': проигравшему можно дать не больше +0,4.');
      if (w && d < DOP_MIN_WIN) warns.push('Место ' + (i + 1) + ': по правилам ФСМ доп победителю начинается с +0,2.');
    });
    if (g.result === 'draw' && sum > 0) errors.push('При ничьей доп. баллы не даются.');
    if (r2(sum) > DOP_TABLE_MAX) errors.push('Сумма доп. баллов за стол ' + String(r2(sum)).replace('.', ',') + ', а лимит 1,2.');
    if (g.format === 'msk' && fi >= 0 && teamOf(g.seats[fi].role) !== 'red') warns.push('Первым убит чёрный игрок: лучший ход и Ci не начисляются.');
    return { errors: errors, warns: warns };
  }

  return {
    MIN_GAMES: MIN_GAMES, FINAL_SPOTS: FINAL_SPOTS, MSK_ROLES: MSK_ROLES, SPB_ROLES: SPB_ROLES, MSK_COMPOSITION: MSK_COMPOSITION,
    r2: r2, teamOf: teamOf, won: won, firstIdx: firstIdx, lxBlacks: lxBlacks, lxPoints: lxPoints,
    seatScore: seatScore, ciShare: ciShare, ciValue: ciValue, computeRating: computeRating, validateGame: validateGame
  };
});
