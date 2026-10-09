/*
 * «Маски сняты» — профиль игрока: статистика по ролям, форма по месяцам и маски-достижения.
 * Работает на сервере (require) и в браузере (window.LupinProfile), рядом с shared/scoring.js.
 *
 * buildProfile({ player, games, monthPlaces, now })
 *   player      — { id, nick, since }
 *   games       — протоколы, где играл игрок (формат как в scoring.js, seats[].playerId)
 *   monthPlaces — { 'msk:2026-10': { place, total, eligible, finalist }, ... }
 *   now         — 'YYYY-MM' текущего месяца (месяц ещё идёт, «чемпион» за него не даётся)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./scoring'));
  else root.LupinProfile = factory(root.LupinScoring);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  var ROLE_ORDER = ['civ', 'sher', 'doc', 'lover', 'maf', 'don', 'maniac'];

  // icon — ключ значка (рисуется в интерфейсе), target — сколько нужно, value(st) — текущий прогресс
  var ACHIEVEMENTS = [
    { id: 'first-blood', name: 'Первая кровь', text: 'Первая победа за мафию или дона', icon: 'hat', target: 1, value: function (st) { return st.blackWins; } },
    { id: 'sherlock', name: 'Шерлок', text: 'Лучший ход: назвать всех трёх чёрных', icon: 'eye', target: 1, value: function (st) { return st.lx3; } },
    { id: 'sheriff-eye', name: 'Глаз шерифа', text: '5 побед за шерифа', icon: 'star', target: 5, value: function (st) { return st.roleWins.sher; } },
    { id: 'elusive', name: 'Неуловимый', text: '5 побед за дона', icon: 'crown', target: 5, value: function (st) { return st.roleWins.don; } },
    { id: 'city-voice', name: 'Голос города', text: '10 побед за мирного жителя', icon: 'house', target: 10, value: function (st) { return st.roleWins.civ; } },
    { id: 'savior', name: 'Спаситель', text: '3 победы за доктора', icon: 'cross', target: 3, value: function (st) { return st.roleWins.doc; } },
    { id: 'loner', name: 'Одиночка', text: 'Победа за маньяка', icon: 'mask', target: 1, value: function (st) { return st.roleWins.maniac; } },
    { id: 'streak', name: 'Серия', text: '5 побед подряд', icon: 'flame', target: 5, value: function (st) { return st.bestStreak; } },
    { id: 'regular', name: 'Завсегдатай', text: 'Сыграть 25 игр', icon: 'chair', target: 25, value: function (st) { return st.games; } },
    { id: 'veteran', name: 'Ветеран', text: 'Сыграть 100 игр', icon: 'laurel', target: 100, value: function (st) { return st.games; } },
    { id: 'two-capitals', name: 'Обе столицы', text: 'По 5 игр в московской и питерской мафии', icon: 'two', target: 5, value: function (st) { return Math.min(st.byFormat.msk.games, st.byFormat.spb.games); } },
    { id: 'clean', name: 'Чистая игра', text: '20 игр без единого штрафа', icon: 'hand', target: 20, value: function (st) { return st.cleanStreak; } },
    { id: 'finalist', name: 'Финалист', text: 'Войти в топ-10 рейтинга месяца', icon: 'ticket', target: 1, value: function (st) { return st.finalistMonths; } },
    { id: 'champion', name: 'Чемпион месяца', text: 'Закончить месяц на первом месте', icon: 'cup', target: 1, value: function (st) { return st.championMonths; } }
  ];

  function r2(x) { return Math.round(x * 100) / 100; }

  function buildProfile(opts) {
    var player = opts.player, pid = player.id, places = opts.monthPlaces || {}, now = opts.now;
    var games = (opts.games || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id || 0) - (b.id || 0); });

    var st = {
      games: 0, wins: 0, points: 0, blackWins: 0, lx3: 0, lx2: 0, firstKills: 0, penalties: 0,
      bestStreak: 0, streak: 0, cleanStreak: 0, cleanRun: 0,
      roleGames: {}, roleWins: {}, byFormat: { msk: { games: 0, wins: 0, points: 0 }, spb: { games: 0, wins: 0, points: 0 } },
      finalistMonths: 0, championMonths: 0
    };
    ROLE_ORDER.forEach(function (r) { st.roleGames[r] = 0; st.roleWins[r] = 0; });

    var recent = [];
    games.forEach(function (g) {
      var idx = -1;
      for (var i = 0; i < g.seats.length; i++) if (g.seats[i].playerId === pid) { idx = i; break; }
      if (idx < 0) return;
      var s = g.seats[idx], sc = S.seatScore(g, idx), won = !!sc.main;
      st.games++; st.points += sc.total;
      st.roleGames[s.role]++;
      st.byFormat[g.format].games++; st.byFormat[g.format].points += sc.total;
      if (won) {
        st.wins++; st.roleWins[s.role]++; st.byFormat[g.format].wins++;
        if (S.teamOf(s.role) === 'black') st.blackWins++;
        st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak);
      } else st.streak = 0;
      if (sc.lx >= 0.5) st.lx3++; else if (sc.lx >= 0.25) st.lx2++;
      if (s.first) st.firstKills++;
      if (sc.pen > 0) { st.penalties++; st.cleanRun = 0; } else { st.cleanRun++; st.cleanStreak = Math.max(st.cleanStreak, st.cleanRun); }
      recent.push({ id: g.id, date: g.date, format: g.format, tableNo: g.tableNo, role: s.role, won: won, result: g.result, points: sc.total });
    });

    var months = {};
    Object.keys(places).forEach(function (key) {
      var p = places[key], parts = key.split(':'), fmt = parts[0], m = parts[1];
      if (p.finalist) st.finalistMonths++;
      if (p.place === 1 && now && m < now) st.championMonths++;
      months[m] = months[m] || { month: m, msk: null, spb: null };
      months[m][fmt] = { place: p.place, total: p.total, games: p.games, eligible: p.eligible };
    });
    var series = Object.keys(months).sort().map(function (m) { return months[m]; }).slice(-12);

    var bestPlace = null;
    Object.keys(places).forEach(function (k) { var p = places[k].place; if (p && (bestPlace === null || p < bestPlace)) bestPlace = p; });

    var roles = ROLE_ORDER.filter(function (r) { return st.roleGames[r] > 0; }).map(function (r) {
      return { role: r, games: st.roleGames[r], wins: st.roleWins[r], winRate: Math.round(st.roleWins[r] / st.roleGames[r] * 100) };
    });
    var favorite = roles.slice().sort(function (a, b) { return b.games - a.games || b.winRate - a.winRate; })[0] || null;

    var achievements = ACHIEVEMENTS.map(function (a) {
      var v = Math.min(a.value(st), a.target);
      return { id: a.id, name: a.name, text: a.text, icon: a.icon, target: a.target, progress: v, earned: v >= a.target };
    });

    return {
      player: { id: pid, nick: player.nick, since: player.since || null },
      totals: {
        games: st.games, wins: st.wins, winRate: st.games ? Math.round(st.wins / st.games * 100) : 0,
        points: r2(st.points), avg: st.games ? r2(st.points / st.games) : 0,
        bestPlace: bestPlace, firstKills: st.firstKills, lx3: st.lx3, lx2: st.lx2, bestStreak: st.bestStreak,
        msk: { games: st.byFormat.msk.games, wins: st.byFormat.msk.wins, points: r2(st.byFormat.msk.points) },
        spb: { games: st.byFormat.spb.games, wins: st.byFormat.spb.wins, points: r2(st.byFormat.spb.points) }
      },
      roles: roles,
      favoriteRole: favorite ? favorite.role : null,
      series: series,
      achievements: achievements,
      earnedCount: achievements.filter(function (a) { return a.earned; }).length,
      recent: recent.reverse().slice(0, 12)
    };
  }

  return { ACHIEVEMENTS: ACHIEVEMENTS, buildProfile: buildProfile };
});
