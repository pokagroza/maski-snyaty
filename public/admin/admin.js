(function () {
  "use strict";
  var S = window.LupinScoring;
  var ME = null;
  var main = document.getElementById("main");

  /* ---------- общие помощники ---------- */
  function api(method, path, body) {
    var opts = { method: method, headers: { "X-Requested-With": "lupin" }, credentials: "same-origin" };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/me") { showLogin("Сессия истекла. Войдите снова."); }
        if (!res.ok) { var e = new Error(data.error || "Сервер не ответил. Попробуйте ещё раз."); e.status = res.status; e.data = data; throw e; }
        return data;
      });
    });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dec(x) { return String(Math.round(x * 100) / 100).replace(".", ","); }
  function signed(x) { x = Math.round(x * 100) / 100; return x === 0 ? "0" : (x > 0 ? "+" : "−") + dec(Math.abs(x)); }
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nowMonth() { return todayISO().slice(0, 7); }
  function rub(n) { return Number(n).toLocaleString("ru-RU").replace(/ /g, " ") + " ₽"; }
  var MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  var MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  function monthLabel(m) { var p = m.split("-"); return MONTHS_NOM[+p[1] - 1] + " " + p[0]; }
  function shortDate(iso) { var p = iso.slice(0, 10).split("-"); return +p[2] + " " + MONTHS_SHORT[+p[1] - 1] + " " + p[0]; }
  function monthOptions(selected, back) {
    var d = new Date(), out = [];
    for (var i = -1; i < (back || 18); i++) {
      var x = new Date(d.getFullYear(), d.getMonth() - i, 1), m = x.getFullYear() + "-" + pad(x.getMonth() + 1);
      out.push('<option value="' + m + '"' + (m === selected ? " selected" : "") + ">" + monthLabel(m) + "</option>");
    }
    return out.join("");
  }
  var toastEl = document.getElementById("toast"), toastT;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("on"); }, 2400);
  }
  function $(id) { return document.getElementById(id); }

  var ROLE_OPTS = {
    msk: [["civ", "Мирный"], ["sher", "Шериф"], ["maf", "Мафия"], ["don", "Дон"]],
    spb: [["civ", "Мирный"], ["sher", "Шериф"], ["doc", "Доктор"], ["lover", "Любовница"], ["maniac", "Маньяк"], ["maf", "Мафия"], ["don", "Дон"]]
  };
  var ROLE_NAME = { civ: "Мирный", sher: "Шериф", doc: "Доктор", lover: "Любовница", maniac: "Маньяк", maf: "Мафия", don: "Дон" };
  var RESULTS = {
    msk: [["red", "Победа красных"], ["black", "Победа чёрных"], ["draw", "Ничья"]],
    spb: [["red", "Победа красных"], ["black", "Победа чёрных"], ["maniac", "Победа маньяка"], ["draw", "Ничья"]]
  };
  var RES_NAME = { red: "победа красных", black: "победа чёрных", maniac: "победа маньяка", draw: "ничья" };
  var FMT_NAME = { msk: "Московская", spb: "Питерская" };
  var KIND_NAME = { msk: "Московская", spb: "Питерская", novice: "Новичкам", theme: "Тематическая", final: "Финал месяца" };
  var STATUS_NAME = { "new": "Новая", confirmed: "Подтверждена", attended: "Пришёл", no_show: "Не пришёл", cancelled: "Отменена" };
  var REQ_NAME = { event: "Игра", subscription: "Абонемент", corporate: "Корпоратив", "private": "Частная вечеринка" };

  /* ---------- вход ---------- */
  function showLogin(msg) {
    ME = null;
    $("appView").hidden = true; $("loginView").hidden = false;
    $("lErr").textContent = msg || "";
    setTimeout(function () { $("lLogin").focus(); }, 0);
  }
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = this.querySelector("button"); btn.disabled = true;
    api("POST", "/api/auth/login", { login: $("lLogin").value.trim(), password: $("lPass").value })
      .then(function (d) { $("lPass").value = ""; start(d.me); })
      .catch(function (ex) { $("lErr").textContent = ex.message; })
      .then(function () { btn.disabled = false; });
  });
  $("logoutBtn").addEventListener("click", function () {
    api("POST", "/api/auth/logout", {}).catch(function () {}).then(function () { showLogin("Вы вышли из админки."); });
  });

  /* ---------- навигация ---------- */
  var VIEWS = [
    ["protocol", "Протокол", false, viewProtocol],
    ["games", "Игры", false, viewGames],
    ["events", "Афиша", true, viewEvents],
    ["bookings", "Заявки", true, viewBookings],
    ["players", "Игроки", true, viewPlayers],
    ["gallery", "Галерея", true, viewGallery],
    ["telegram", "Telegram", true, viewTelegram],
    ["staff", "Сотрудники", true, viewStaff],
    ["audit", "Журнал", true, viewAudit],
    ["password", "Пароль", false, viewPassword]
  ];
  function allowed() { return VIEWS.filter(function (v) { return !v[2] || ME.role === "admin"; }); }
  function route() {
    if (!ME) return;
    var name = (location.hash || "#protocol").slice(1).split("/")[0];
    var view = allowed().filter(function (v) { return v[0] === name; })[0] || allowed()[0];
    $("tabs").innerHTML = allowed().map(function (v) { return '<a href="#' + v[0] + '"' + (v === view ? ' aria-current="page"' : "") + ">" + v[1] + "</a>"; }).join("");
    main.innerHTML = "";
    view[3]();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  function start(me) {
    ME = me;
    $("loginView").hidden = true; $("appView").hidden = false;
    $("whoName").textContent = me.name + (me.role === "admin" ? " · администратор" : " · ведущий");
    route();
  }

  /* ---------- протокол ---------- */
  var draft = null, players = [], editAfterLoad = null;
  function blankSeat() { return { playerId: null, nick: "", role: "civ", dop: 0, fines: 0, dq: "none", first: false }; }
  function newDraft(fmt, keep) {
    var n = fmt === "spb" ? 12 : 10, seats = [];
    for (var i = 0; i < n; i++) seats.push(blankSeat());
    return { id: null, format: fmt, date: keep ? keep.date : todayISO(), tableNo: keep ? keep.tableNo : 1, hostName: keep ? keep.hostName : ME.name, eventId: keep ? keep.eventId : null, result: "", seats: seats, lx: [null, null, null] };
  }
  function loadPlayers() {
    return api("GET", "/api/staff/players").then(function (d) {
      players = d.players;
      var dl = $("nickList"); if (dl) dl.innerHTML = players.map(function (p) { return '<option value="' + esc(p.nick) + '"></option>'; }).join("");
    }).catch(function () {});
  }
  function loadEventsFor(date) {
    var sel = $("pEvent"); if (!sel) return;
    api("GET", "/api/staff/events?month=" + date.slice(0, 7)).then(function (d) {
      sel.innerHTML = '<option value="">Без привязки</option>' + d.events.map(function (e) {
        return '<option value="' + e.id + '">' + +e.date.slice(8) + " " + MONTHS_SHORT[+e.date.slice(5, 7) - 1] + ", " + e.time + " · " + esc(e.title) + "</option>";
      }).join("");
      sel.value = draft.eventId ? String(draft.eventId) : "";
      if (sel.value === "" && draft.eventId) draft.eventId = null;
    }).catch(function () { sel.innerHTML = '<option value="">Без привязки</option>'; });
  }
  function viewProtocol() {
    main.appendChild($("tplProtocol").content.cloneNode(true));
    if (editAfterLoad) { draft = editAfterLoad; editAfterLoad = null; }
    else if (!draft) draft = newDraft("msk");
    bindProtocol();
    renderDraft();
    loadPlayers();
    loadEventsFor(draft.date);
  }
  function seatRow(s, i) {
    var opts = ROLE_OPTS[draft.format].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === s.role ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
    var fin = [0, 1, 2, 3].map(function (k) { return '<option value="' + k + '"' + (k === (+s.fines || 0) ? " selected" : "") + ">" + (k ? "−" + dec(k * .4) : "0") + "</option>"; }).join("");
    var dq = [["none", "—"], ["dq", "−0,5"], ["ppk", "ППК −1"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === s.dq ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
    return '<tr data-i="' + i + '"><td class="n">' + (i + 1) + "</td>" +
      '<td><input id="seat-nick-' + i + '" data-k="nick" list="nickList" autocomplete="off" maxlength="40" value="' + esc(s.nick) + '" aria-label="Ник игрока ' + (i + 1) + '"></td>' +
      '<td><select id="seat-role-' + i + '" data-k="role" aria-label="Роль игрока ' + (i + 1) + '">' + opts + "</select></td>" +
      '<td><input id="seat-dop-' + i + '" data-k="dop" type="number" min="0" max="0.7" step="0.1" inputmode="decimal" value="' + (s.dop || "") + '" placeholder="0" aria-label="Доп игрока ' + (i + 1) + '"></td>' +
      '<td><select id="seat-fines-' + i + '" data-k="fines" aria-label="Ошибки игрока ' + (i + 1) + '">' + fin + "</select></td>" +
      '<td><select id="seat-dq-' + i + '" data-k="dq" aria-label="Удаление игрока ' + (i + 1) + '">' + dq + "</select></td>" +
      '<td><input id="seat-first-' + i + '" data-k="first" type="radio" name="firstKilled"' + (s.first ? " checked" : "") + ' aria-label="Игрок ' + (i + 1) + ' убит первым"></td>' +
      '<td class="tot" id="seat-tot-' + i + '"></td></tr>';
  }
  function renderDraft() {
    document.querySelectorAll("#pFmt button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.m === draft.format)); });
    $("pDate").value = draft.date; $("pTable").value = draft.tableNo; $("pHost").value = draft.hostName || "";
    $("pRes").innerHTML = RESULTS[draft.format].map(function (r) { return '<button class="chip" type="button" data-r="' + r[0] + '" aria-pressed="' + (draft.result === r[0]) + '">' + r[1] + "</button>"; }).join("");
    $("pSeats").innerHTML = draft.seats.map(seatRow).join("");
    $("pSeatBtns").hidden = draft.format !== "spb";
    $("pSave").textContent = draft.id ? "Сохранить изменения" : "Сохранить протокол";
    $("pTitle").textContent = draft.id ? "Правка протокола от " + shortDate(draft.date) : "Новый протокол";
    $("pNew").hidden = true;
    var opts = '<option value="">—</option>' + draft.seats.map(function (s, i) { return '<option value="' + (i + 1) + '">' + (i + 1) + "</option>"; }).join("");
    [0, 1, 2].forEach(function (k) { var el = $("lx" + k); el.innerHTML = opts; el.value = draft.lx[k] && draft.lx[k] <= draft.seats.length ? String(draft.lx[k]) : ""; });
    recalc();
  }
  function forCheck() { return { format: draft.format, date: draft.date, result: draft.result, lx: draft.lx, seats: draft.seats }; }
  function recalc() {
    var g = forCheck(), fi = S.firstIdx(g);
    draft.seats.forEach(function (s, i) {
      var cell = $("seat-tot-" + i); if (cell) cell.textContent = signed(S.seatScore(g, i).total);
      var row = $("pSeats").children[i]; if (row) row.className = S.teamOf(s.role) === "black" ? "black" : "";
    });
    $("pLxField").hidden = draft.format !== "msk";
    var out = $("lxOut");
    if (fi < 0) out.textContent = "Отметьте игрока, убитого первым, чтобы записать его лучший ход.";
    else if (S.teamOf(draft.seats[fi].role) !== "red") out.textContent = "Первым убит чёрный игрок: лучший ход не начисляется.";
    else { var b = S.lxBlacks(g); out.textContent = "Чёрных в лучшем ходе: " + b + " → " + (b >= 3 ? "+0,5" : b === 2 ? "+0,25" : "0"); }
    var c = {}; draft.seats.forEach(function (s) { c[s.role] = (c[s.role] || 0) + 1; });
    var need = draft.format === "msk" ? S.MSK_COMPOSITION : null;
    $("pComp").innerHTML = ROLE_OPTS[draft.format].map(function (o) {
      var n = c[o[0]] || 0, ok = need ? n === need[o[0]] : n > 0;
      return '<span class="' + (ok ? "ok" : "") + '">' + o[1] + ": " + n + (need ? " / " + need[o[0]] : "") + "</span>";
    }).join("");
    var v = S.validateGame(g);
    $("pIssues").innerHTML = v.errors.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + v.warns.map(function (t) { return '<li class="warn">' + esc(t) + "</li>"; }).join("");
  }
  function bindProtocol() {
    var seatsEl = $("pSeats");
    function onSeat(e) {
      var el = e.target, tr = el.closest("tr"); if (!tr || !el.dataset.k) return;
      var s = draft.seats[+tr.dataset.i], k = el.dataset.k;
      if (k === "nick") { s.nick = el.value; s.playerId = null; }
      else if (k === "role") s.role = el.value;
      else if (k === "dop") s.dop = el.value === "" ? 0 : Math.max(0, parseFloat(String(el.value).replace(",", ".")) || 0);
      else if (k === "fines") s.fines = +el.value;
      else if (k === "dq") s.dq = el.value;
      else if (k === "first") draft.seats.forEach(function (x, i) { x.first = i === +tr.dataset.i; });
      $("pNew").hidden = true;
      recalc();
    }
    seatsEl.addEventListener("input", onSeat);
    seatsEl.addEventListener("change", onSeat);
    $("pFmt").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b || b.dataset.m === draft.format) return;
      var fmt = b.dataset.m, n = fmt === "spb" ? 12 : 10, seats = draft.seats.slice(0, n);
      while (seats.length < n) seats.push(blankSeat());
      seats.forEach(function (s) { if (fmt === "msk" && ["doc", "lover", "maniac"].indexOf(s.role) !== -1) s.role = "civ"; });
      draft.format = fmt; draft.seats = seats;
      if (fmt === "msk" && draft.result === "maniac") draft.result = "";
      if (fmt === "spb") draft.lx = [null, null, null];
      renderDraft();
    });
    $("pRes").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      draft.result = b.dataset.r;
      this.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      recalc();
    });
    $("pDate").addEventListener("change", function () { var m = draft.date.slice(0, 7); draft.date = this.value; if (this.value && this.value.slice(0, 7) !== m) loadEventsFor(this.value); recalc(); });
    $("pTable").addEventListener("input", function () { draft.tableNo = Math.max(1, Math.min(20, parseInt(this.value, 10) || 1)); });
    $("pHost").addEventListener("input", function () { draft.hostName = this.value; });
    $("pEvent").addEventListener("change", function () { draft.eventId = this.value ? +this.value : null; });
    [0, 1, 2].forEach(function (k) { $("lx" + k).addEventListener("change", function () { draft.lx[k] = this.value ? +this.value : null; recalc(); }); });
    $("lxClear").addEventListener("click", function () { draft.seats.forEach(function (s) { s.first = false; }); draft.lx = [null, null, null]; renderDraft(); });
    $("pAdd").addEventListener("click", function () { if (draft.seats.length < 14) { draft.seats.push(blankSeat()); renderDraft(); } });
    $("pRemove").addEventListener("click", function () { if (draft.seats.length > 8) { draft.seats.pop(); renderDraft(); } });
    $("pReset").addEventListener("click", function () { draft = newDraft(draft.format, draft); $("pStatus").textContent = ""; renderDraft(); loadEventsFor(draft.date); });
    $("pSave").addEventListener("click", function () { save(false); });
    $("pNewYes").addEventListener("click", function () { save(true); });
    $("pNewNo").addEventListener("click", function () { $("pNew").hidden = true; $("pSeats").querySelector("input").focus(); });
  }
  var saving = false;
  function save(createPlayers) {
    if (saving) return;
    var v = S.validateGame(forCheck());
    if (v.errors.length) { $("pStatus").textContent = "Исправьте отмеченные ошибки, чтобы сохранить."; $("pIssues").scrollIntoView({ block: "center" }); return; }
    var payload = {
      format: draft.format, date: draft.date, tableNo: draft.tableNo, hostName: draft.hostName, result: draft.result,
      eventId: draft.eventId, lx: draft.lx, createPlayers: !!createPlayers,
      seats: draft.seats.map(function (s) { return { playerId: s.playerId, nick: s.nick.trim(), role: s.role, dop: s.dop, fines: s.fines, dq: s.dq, first: s.first }; })
    };
    saving = true; $("pSave").disabled = true; $("pStatus").textContent = "Сохраняем…";
    var wasEdit = !!draft.id;
    api(wasEdit ? "PUT" : "POST", wasEdit ? "/api/staff/games/" + draft.id : "/api/staff/games", payload).then(function (d) {
      toast(wasEdit ? "Протокол обновлён" : "Протокол сохранён");
      var keep = draft;
      draft = newDraft(keep.format, keep);
      if (!wasEdit) draft.tableNo = keep.tableNo;
      renderDraft();
      $("pStatus").textContent = (wasEdit ? "Изменения сохранены." : "Протокол сохранён.") + (d.newPlayers && d.newPlayers.length ? " Новые игроки: " + d.newPlayers.join(", ") + "." : "") + " Рейтинг пересчитан.";
      loadPlayers();
      window.scrollTo(0, 0);
    }).catch(function (ex) {
      if (ex.status === 409 && ex.data && ex.data.missing) {
        $("pNewText").textContent = "Этих игроков ещё нет в базе: " + ex.data.missing.join(", ") + ". Проверьте написание. Если это новые игроки, создайте для них карточки.";
        $("pNew").hidden = false;
        $("pStatus").textContent = "";
        $("pNew").scrollIntoView({ block: "center" });
      } else {
        $("pStatus").textContent = ex.message;
      }
    }).then(function () { saving = false; var b = $("pSave"); if (b) b.disabled = false; });
  }

  /* ---------- игры ---------- */
  function viewGames() {
    main.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Протоколы игр</h2><p class="hint">' +
      (ME.role === "admin" ? "Администратор может править и удалять любые протоколы." : "Вы можете править протоколы, которые внесли сами.") +
      '</p></div><div class="toolbar"><div class="field"><label for="gMonth">Месяц</label><select id="gMonth">' + monthOptions(nowMonth()) + '</select></div></div></div><div id="gList"><p class="empty">Загружаем…</p></div></section>';
    $("gMonth").addEventListener("change", loadGames);
    $("gList").addEventListener("click", onGameAction);
    loadGames();
  }
  var gamesCache = [];
  function loadGames() {
    api("GET", "/api/staff/games?month=" + $("gMonth").value).then(function (d) {
      gamesCache = d.games;
      $("gList").innerHTML = d.games.length ? d.games.map(function (g) {
        var rows = g.seats.map(function (s, i) {
          var sc = S.seatScore(g, i);
          return "<tr><td>" + (i + 1) + "</td><td>" + esc(s.nick) + (s.first ? " ✕" : "") + "</td><td>" + ROLE_NAME[s.role] + '</td><td class="num">' + sc.main + '</td><td class="num">' + dec(sc.dop) + '</td><td class="num">' + dec(sc.lx) + '</td><td class="num">' + (sc.pen ? "−" + dec(sc.pen) : "0") + '</td><td class="num"><b>' + dec(sc.total) + "</b></td></tr>";
        }).join("");
        var acts = (g.canEdit ? '<button class="mini" type="button" data-act="edit" data-id="' + g.id + '">Изменить</button>' : "") +
          (ME.role === "admin" ? '<button class="mini" type="button" data-act="del" data-id="' + g.id + '">Удалить</button>' : "");
        return '<details class="game-item"><summary><span><b>' + shortDate(g.date) + " · стол " + g.tableNo + "</b> · " + FMT_NAME[g.format] + ' <span class="meta">· ' + RES_NAME[g.result] + (g.hostName ? " · " + esc(g.hostName) : "") + '</span></span><span class="acts">' + acts + "</span></summary>" +
          '<div class="tbl-wrap"><table class="dtable"><thead><tr><th>№</th><th>Игрок</th><th>Роль</th><th>Поб.</th><th>Доп</th><th>ЛХ</th><th>Штр.</th><th>Итог</th></tr></thead><tbody>' + rows + "</tbody></table></div></details>";
      }).join("") : '<p class="empty">В этом месяце протоколов нет.</p>';
    }).catch(function (ex) { $("gList").innerHTML = '<p class="empty">' + esc(ex.message) + "</p>"; });
  }
  function onGameAction(e) {
    var b = e.target.closest("button[data-act]"); if (!b) return;
    e.preventDefault();
    var id = +b.dataset.id, g = gamesCache.filter(function (x) { return x.id === id; })[0];
    if (b.dataset.act === "edit" && g) {
      editAfterLoad = { id: g.id, format: g.format, date: g.date, tableNo: g.tableNo, hostName: g.hostName, eventId: g.eventId, result: g.result,
        lx: (g.lx || [null, null, null]).slice(0, 3),
        seats: g.seats.map(function (s) { return { playerId: s.playerId, nick: s.nick, role: s.role, dop: s.dop, fines: s.fines, dq: s.dq, first: s.first }; }) };
      location.hash = "#protocol";
    } else if (b.dataset.act === "del") {
      b.parentNode.innerHTML = '<span class="admin-status">Удалить навсегда?</span><button class="mini solid" type="button" data-act="yes" data-id="' + id + '">Да</button><button class="mini" type="button" data-act="no" data-id="' + id + '">Нет</button>';
    } else if (b.dataset.act === "no") {
      loadGames();
    } else if (b.dataset.act === "yes") {
      api("DELETE", "/api/staff/games/" + id).then(function () { toast("Протокол удалён"); loadGames(); }).catch(function (ex) { toast(ex.message); loadGames(); });
    }
  }

  /* ---------- афиша ---------- */
  var eventsCache = [], editingEvent = null;
  function eventForm(e) {
    e = e || { kind: "msk", title: "", description: "", startsAt: todayISO() + "T19:00", venue: "Джи Бар, ул. Николаева, 30", price: 1000, capacity: 20, tableSize: 10, spectator: false, published: true };
    var kinds = Object.keys(KIND_NAME).map(function (k) { return '<option value="' + k + '"' + (k === e.kind ? " selected" : "") + ">" + KIND_NAME[k] + "</option>"; }).join("");
    return '<form class="card-form" id="evForm" novalidate><h3>' + (editingEvent ? "Правка игры" : "Новая игра в афише") + "</h3>" +
      '<div class="grid3"><div class="field"><label for="evKind">Формат</label><select id="evKind">' + kinds + '</select></div>' +
      '<div class="field"><label for="evStart">Начало</label><input id="evStart" type="datetime-local" value="' + esc(e.startsAt) + '"></div>' +
      '<div class="field"><label for="evVenue">Место</label><input id="evVenue" maxlength="120" value="' + esc(e.venue) + '"></div></div>' +
      '<div class="field"><label for="evTitle">Название</label><input id="evTitle" maxlength="120" value="' + esc(e.title) + '" placeholder="Московская мафия. Рейтинговая игра"></div>' +
      '<div class="field"><label for="evDesc">Описание</label><input id="evDesc" maxlength="600" value="' + esc(e.description) + '" placeholder="Коротко: правила, дресс-код, особенности"></div>' +
      '<div class="grid3"><div class="field"><label for="evPrice">Цена, ₽</label><input id="evPrice" type="number" min="0" value="' + e.price + '"></div>' +
      '<div class="field"><label for="evCap">Всего мест</label><input id="evCap" type="number" min="1" max="500" value="' + e.capacity + '"></div>' +
      '<div class="field"><label for="evTable">Мест за столом</label><input id="evTable" type="number" min="8" max="14" value="' + e.tableSize + '"></div></div>' +
      '<div class="toolbar"><label class="check"><input id="evSpect" type="checkbox"' + (e.spectator ? " checked" : "") + '> Продаются билеты зрителям (финал)</label>' +
      '<label class="check"><input id="evPub" type="checkbox"' + (e.published ? " checked" : "") + "> Показывать на сайте</label></div>" +
      '<p class="err" id="evErr" role="alert"></p><div class="admin-actions"><button class="btn" type="submit">' + (editingEvent ? "Сохранить" : "Добавить в афишу") + "</button>" +
      (editingEvent ? '<button class="mini" type="button" id="evCancel">Отмена</button>' : "") + "</div></form>";
  }
  function viewEvents() {
    main.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Афиша</h2><p class="hint">Игры с флажком «Показывать на сайте» видны посетителям. Игру с заявками нельзя удалить — снимите её с публикации.</p></div>' +
      '<div class="mode" id="evScope" role="group" aria-label="Период"><button type="button" data-s="upcoming" aria-pressed="true">Предстоящие</button><button type="button" data-s="past" aria-pressed="false">Прошедшие</button></div></div>' +
      '<div id="evFormBox"></div><div class="tbl-wrap"><table class="dtable wide"><thead><tr><th>Когда</th><th>Игра</th><th>Формат</th><th>Цена</th><th>Места</th><th>Сайт</th><th></th></tr></thead><tbody id="evBody"></tbody></table></div></section>';
    editingEvent = null;
    renderEventForm();
    $("evScope").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      this.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      loadEventsList();
    });
    $("evBody").addEventListener("click", onEventAction);
    loadEventsList();
  }
  function renderEventForm() {
    $("evFormBox").innerHTML = eventForm(editingEvent);
    $("evForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var body = {
        kind: $("evKind").value, startsAt: $("evStart").value, venue: $("evVenue").value, title: $("evTitle").value, description: $("evDesc").value,
        price: +$("evPrice").value, capacity: +$("evCap").value, tableSize: +$("evTable").value, spectator: $("evSpect").checked, published: $("evPub").checked
      };
      api(editingEvent ? "PUT" : "POST", editingEvent ? "/api/admin/events/" + editingEvent.id : "/api/admin/events", body).then(function () {
        toast(editingEvent ? "Игра обновлена" : "Игра добавлена в афишу");
        editingEvent = null; renderEventForm(); loadEventsList();
      }).catch(function (ex) { $("evErr").textContent = ex.message; });
    });
    if ($("evCancel")) $("evCancel").addEventListener("click", function () { editingEvent = null; renderEventForm(); });
  }
  function loadEventsList() {
    var scope = document.querySelector('#evScope [aria-pressed="true"]').dataset.s;
    api("GET", "/api/admin/events?scope=" + scope).then(function (d) {
      eventsCache = d.events;
      $("evBody").innerHTML = d.events.length ? d.events.map(function (e) {
        return '<tr class="' + (e.published ? "" : "muted") + '"><td>' + shortDate(e.date) + ", " + e.time + "</td><td><b>" + esc(e.title) + "</b><br><span class=\"hint\">" + esc(e.description) + "</span></td><td>" + KIND_NAME[e.kind] +
          '</td><td class="num">' + rub(e.price) + '</td><td class="num">' + e.taken + " / " + e.capacity + '</td><td><span class="pill ' + (e.published ? "on" : "") + '">' + (e.published ? "на сайте" : "скрыта") + "</span></td>" +
          '<td><div class="acts"><button class="mini" type="button" data-act="edit" data-id="' + e.id + '">Изменить</button><a class="mini" href="#bookings/' + e.id + '">Заявки (' + e.bookingsTotal + ')</a>' +
          '<button class="mini" type="button" data-act="del" data-id="' + e.id + '">Удалить</button></div></td></tr>';
      }).join("") : '<tr><td colspan="7" class="empty">Игр нет. Добавьте первую через форму выше.</td></tr>';
    }).catch(function (ex) { $("evBody").innerHTML = '<tr><td colspan="7" class="empty">' + esc(ex.message) + "</td></tr>"; });
  }
  function onEventAction(e) {
    var b = e.target.closest("button[data-act]"); if (!b) return;
    var id = +b.dataset.id, ev = eventsCache.filter(function (x) { return x.id === id; })[0];
    if (b.dataset.act === "edit") { editingEvent = ev; renderEventForm(); $("evFormBox").scrollIntoView({ block: "start" }); }
    else if (b.dataset.act === "del") {
      b.parentNode.innerHTML = '<span class="admin-status">Удалить?</span><button class="mini solid" type="button" data-act="yes" data-id="' + id + '">Да</button><button class="mini" type="button" data-act="no" data-id="' + id + '">Нет</button>';
    } else if (b.dataset.act === "no") loadEventsList();
    else if (b.dataset.act === "yes") {
      api("DELETE", "/api/admin/events/" + id).then(function () { toast("Игра удалена"); loadEventsList(); }).catch(function (ex) { toast(ex.message); loadEventsList(); });
    }
  }

  /* ---------- заявки ---------- */
  function viewBookings() {
    var eventId = (location.hash.split("/")[1] || "").replace(/\D/g, "");
    var opts = '<option value="">Все</option>' + Object.keys(STATUS_NAME).map(function (k) { return '<option value="' + k + '">' + STATUS_NAME[k] + "</option>"; }).join("");
    main.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Заявки</h2><p class="hint">Подтвердите запись, связавшись с гостем. Отменённые заявки освобождают места в афише. Через год имена и контакты обезличиваются автоматически.</p></div>' +
      '<div class="toolbar"><div class="field"><label for="bStatus">Статус</label><select id="bStatus">' + opts + "</select></div>" + (eventId ? '<a class="mini" href="#bookings">Показать все игры</a>' : "") + "</div></div>" +
      '<div class="tbl-wrap"><table class="dtable wide"><thead><tr><th>Получена</th><th>Куда</th><th>Имя</th><th>Контакт</th><th>Мест</th><th>Комментарий</th><th>Статус</th></tr></thead><tbody id="bBody"></tbody></table></div></section>';
    function load() {
      var q = [];
      if ($("bStatus").value) q.push("status=" + $("bStatus").value);
      if (eventId) q.push("eventId=" + eventId);
      api("GET", "/api/admin/bookings" + (q.length ? "?" + q.join("&") : "")).then(function (d) {
        $("bBody").innerHTML = d.bookings.length ? d.bookings.map(function (b) {
          var st = Object.keys(STATUS_NAME).map(function (k) { return '<option value="' + k + '"' + (k === b.status ? " selected" : "") + ">" + STATUS_NAME[k] + "</option>"; }).join("");
          var where = b.kind === "event" ? esc(b.event_title) + '<br><span class="hint">' + (b.event_starts ? shortDate(b.event_starts) + ", " + b.event_starts.slice(11) : "") + "</span>" : REQ_NAME[b.kind];
          return '<tr class="' + (b.status === "cancelled" ? "muted" : "") + '"><td>' + shortDate(b.created) + ", " + b.created.slice(11) + "</td><td>" + where + "</td><td>" + esc(b.name) + '</td><td class="sel">' + esc(b.contact) + '</td><td class="num">' + b.seats + "</td><td>" + esc(b.comment) +
            '</td><td><select data-id="' + b.id + '" aria-label="Статус заявки">' + st + "</select></td></tr>";
        }).join("") : '<tr><td colspan="7" class="empty">Заявок нет.</td></tr>';
      }).catch(function (ex) { $("bBody").innerHTML = '<tr><td colspan="7" class="empty">' + esc(ex.message) + "</td></tr>"; });
    }
    $("bStatus").addEventListener("change", load);
    $("bBody").addEventListener("change", function (e) {
      var s = e.target.closest("select[data-id]"); if (!s) return;
      api("PATCH", "/api/admin/bookings/" + s.dataset.id, { status: s.value }).then(function () { toast("Статус: " + STATUS_NAME[s.value]); load(); }).catch(function (ex) { toast(ex.message); load(); });
    });
    load();
  }

  /* ---------- игроки ---------- */
  function viewPlayers() {
    main.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Игроки</h2><p class="hint">Переименование не ломает историю: протоколы ссылаются на карточку игрока. Если один человек записан под двумя никами, объедините карточки.</p></div>' +
      '<div class="toolbar"><div class="field"><label for="plQ">Поиск</label><input id="plQ" type="search" placeholder="Ник"></div></div></div>' +
      '<datalist id="plAll"></datalist><div class="tbl-wrap"><table class="dtable wide"><thead><tr><th>Ник</th><th>Игр</th><th>Добавлен</th><th>Заметка</th><th></th></tr></thead><tbody id="plBody"></tbody></table></div></section>';
    var all = [];
    function render() {
      var q = $("plQ").value.trim().toLowerCase();
      var list = all.filter(function (p) { return !q || p.nick.toLowerCase().indexOf(q) !== -1; }).slice(0, 300);
      $("plBody").innerHTML = list.length ? list.map(function (p) {
        return '<tr data-id="' + p.id + '"><td><b>' + esc(p.nick) + '</b></td><td class="num">' + p.games + "</td><td>" + shortDate(p.created) + "</td><td>" + esc(p.note || "") +
          '</td><td><div class="acts"><button class="mini" type="button" data-act="rename">Изменить</button><button class="mini" type="button" data-act="merge">Объединить</button>' +
          (p.games ? "" : '<button class="mini" type="button" data-act="del">Удалить</button>') + "</div></td></tr>";
      }).join("") : '<tr><td colspan="5" class="empty">Игроков не найдено.</td></tr>';
    }
    function load() {
      api("GET", "/api/admin/players").then(function (d) {
        all = d.players;
        $("plAll").innerHTML = all.map(function (p) { return '<option value="' + esc(p.nick) + '"></option>'; }).join("");
        render();
      });
    }
    $("plQ").addEventListener("input", render);
    $("plBody").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]"); if (!b) return;
      var tr = b.closest("tr"), id = +tr.dataset.id, p = all.filter(function (x) { return x.id === id; })[0];
      var cell = tr.lastElementChild;
      if (b.dataset.act === "rename") {
        tr.children[0].innerHTML = '<input data-f="nick" maxlength="40" value="' + esc(p.nick) + '" aria-label="Ник">';
        tr.children[3].innerHTML = '<input data-f="note" maxlength="300" value="' + esc(p.note || "") + '" aria-label="Заметка">';
        cell.innerHTML = '<div class="acts"><button class="mini solid" type="button" data-act="saveName">Сохранить</button><button class="mini" type="button" data-act="cancel">Отмена</button></div>';
      } else if (b.dataset.act === "saveName") {
        api("PUT", "/api/admin/players/" + id, { nick: tr.querySelector('[data-f="nick"]').value, note: tr.querySelector('[data-f="note"]').value })
          .then(function () { toast("Игрок сохранён"); load(); }).catch(function (ex) { toast(ex.message); });
      } else if (b.dataset.act === "merge") {
        cell.innerHTML = '<div class="acts"><input list="plAll" data-f="into" placeholder="Основная карточка (ник)" aria-label="Основная карточка"><button class="mini solid" type="button" data-act="doMerge">Объединить</button><button class="mini" type="button" data-act="cancel">Отмена</button></div>';
      } else if (b.dataset.act === "doMerge") {
        var nick = cell.querySelector('[data-f="into"]').value.trim().toLowerCase();
        var into = all.filter(function (x) { return x.nick.toLowerCase() === nick; })[0];
        if (!into) { toast("Выберите основную карточку из списка."); return; }
        api("POST", "/api/admin/players/" + id + "/merge", { intoId: into.id }).then(function () { toast("Карточки объединены: игры перенесены к «" + into.nick + "»"); load(); }).catch(function (ex) { toast(ex.message); });
      } else if (b.dataset.act === "del") {
        api("DELETE", "/api/admin/players/" + id).then(function () { toast("Карточка удалена"); load(); }).catch(function (ex) { toast(ex.message); });
      } else if (b.dataset.act === "cancel") render();
    });
    load();
  }

  /* ---------- сотрудники ---------- */
  /* ---------- галерея вечеров ---------- */
  // Фото уменьшаем прямо в браузере: длинная сторона до 1600 px, JPEG — так сайт грузится быстро даже с телефона
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) return reject(new Error("Это не фотография. Подходят JPEG, PNG, WebP или HEIC с iPhone."));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        var ctx = c.getContext("2d"); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var q = 0.86, data = c.toDataURL("image/jpeg", q);
        while (data.length > 2.6e6 && q > 0.5) { q -= 0.1; data = c.toDataURL("image/jpeg", q); }
        resolve({ image: data, width: w, height: h });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Браузер не смог открыть «" + file.name + "». Сохраните фото как JPEG и попробуйте снова.")); };
      img.src = url;
    });
  }
  function viewGallery() {
    main.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Галерея вечеров</h2><p class="hint">Фото появляются на сайте в разделе «Вечера клуба» в виде полароидов. Пока здесь пусто, на сайте показываются фирменные снимки масок. Порядок: больше число — выше.</p></div></div>' +
      '<form class="card-form" id="gForm" novalidate><h3>Добавить фото</h3><div class="grid2">' +
      '<div class="field"><label for="gFile">Фотографии (можно несколько)</label><input id="gFile" type="file" accept="image/*" multiple></div>' +
      '<div class="field"><label for="gCap">Подпись от руки</label><input id="gCap" maxlength="140" placeholder="Например: Финал сентября"></div>' +
      '<div class="field"><label for="gDate">Дата вечера</label><input id="gDate" type="date"></div>' +
      '<div class="field"><label class="check"><input id="gPub" type="checkbox" checked> сразу показать на сайте</label></div></div>' +
      '<p class="err" id="gErr" role="alert"></p><div class="admin-actions"><button class="btn" type="submit" id="gBtn">Загрузить</button><span class="hint" id="gProg"></span></div></form>' +
      '<div class="gal-admin" id="gList"></div></section>';
    var list = [];
    function card(p) {
      return '<figure class="ga-card' + (p.published ? "" : " muted") + '" data-id="' + p.id + '"><img src="' + esc(p.src) + '" alt="" loading="lazy">' +
        '<figcaption><input data-f="caption" maxlength="140" value="' + esc(p.caption) + '" placeholder="Подпись" aria-label="Подпись">' +
        '<div class="ga-row"><input data-f="takenOn" type="date" value="' + esc(p.takenOn || "") + '" aria-label="Дата вечера"><input data-f="sort" type="number" min="-1000" max="1000" value="' + p.sort + '" aria-label="Порядок" title="Порядок: больше — выше"></div>' +
        '<div class="ga-row"><label class="check"><input data-f="published" type="checkbox"' + (p.published ? " checked" : "") + '> на сайте</label>' +
        '<button class="mini solid" type="button" data-act="save">Сохранить</button><button class="mini danger" type="button" data-act="del">Удалить</button></div></figcaption></figure>';
    }
    function load() {
      api("GET", "/api/admin/gallery").then(function (d) {
        list = d.photos;
        $("gList").innerHTML = list.length ? list.map(card).join("") : '<p class="empty">Фото пока нет — загрузите снимки с прошедших вечеров.</p>';
      });
    }
    $("gForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var files = Array.prototype.slice.call($("gFile").files || []);
      $("gErr").textContent = "";
      if (!files.length) { $("gErr").textContent = "Выберите хотя бы одну фотографию."; return; }
      var btn = $("gBtn"); btn.disabled = true;
      var meta = { caption: $("gCap").value.trim(), takenOn: $("gDate").value || undefined, published: $("gPub").checked }, done = 0, failed = [];
      files.reduce(function (chain, f) {
        return chain.then(function () {
          $("gProg").textContent = "Загружаю " + (done + 1) + " из " + files.length + "…";
          return shrinkImage(f).then(function (img) {
            return api("POST", "/api/admin/gallery", Object.assign({}, meta, img));
          }).then(function () { done++; }, function (ex) { done++; failed.push(ex.message); });
        });
      }, Promise.resolve()).then(function () {
        btn.disabled = false; $("gProg").textContent = "";
        if (failed.length) $("gErr").textContent = failed.join(" ");
        if (failed.length < files.length) { toast("Загружено фото: " + (files.length - failed.length)); $("gForm").reset(); $("gPub").checked = true; }
        load();
      });
    });
    $("gList").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]"); if (!b) return;
      var fig = b.closest("figure"), id = +fig.dataset.id;
      if (b.dataset.act === "save") {
        var f = function (k) { return fig.querySelector('[data-f="' + k + '"]'); };
        api("PATCH", "/api/admin/gallery/" + id, { caption: f("caption").value.trim(), takenOn: f("takenOn").value || undefined, sort: f("sort").value, published: f("published").checked })
          .then(function () { toast("Сохранено"); load(); }).catch(function (ex) { toast(ex.message); });
      } else if (b.dataset.act === "del") {
        if (!confirm("Удалить это фото из галереи? Вернуть его не получится.")) return;
        api("DELETE", "/api/admin/gallery/" + id).then(function () { toast("Фото удалено"); load(); }).catch(function (ex) { toast(ex.message); });
      }
    });
    load();
  }

  /* ---------- Telegram-уведомления ---------- */
  function tgPreview(personal) {
    return '<div class="tg-bubble"><b>🎭 Новая заявка на игру</b><br><br><b>Открытые игры в мафию</b><br>9 октября, 19:00 · Джи Бар, ул. Николаева, 30<br>Мест в заявке: <b>2</b> · свободно 5 из 20' +
      (personal ? '<br><br>Имя: Анна<br>Контакт: +7 900 123-45-67<br>Комментарий: Будем впервые' : '') +
      '<br><br><u>Открыть заявку в админке</u></div>';
  }
  function viewTelegram() {
    main.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Уведомления в Telegram</h2><p class="hint">Бот сразу присылает сообщение о каждой новой заявке с сайта: на игру, корпоратив, день рождения или рассылку. Подключить можно свой Telegram, Telegram ведущих или общую группу.</p></div></div><div id="tgBody"><p class="empty">Загружаю…</p></div></section>';
    var st = null, watch = 0;
    function load() {
      return api("GET", "/api/admin/telegram").then(function (d) { st = d; render(); });
    }
    function render() {
      var h = "";
      if (!st.enabled) {
        h += '<div class="card-form"><h3>Бот ещё не настроен</h3><ol class="steps">' +
          '<li>Откройте в Telegram <b>@BotFather</b>, отправьте <code>/newbot</code>, придумайте имя (например, «Маски сняты — заявки») и адрес бота.</li>' +
          '<li>BotFather пришлёт токен вида <code>123456:ABC…</code>. Впишите его на сервере в файл <code>.env</code>: <code>TELEGRAM_BOT_TOKEN=…</code></li>' +
          '<li>Перезапустите сайт командой <code>docker compose up -d</code> и обновите эту страницу.</li></ol></div>';
      } else {
        h += '<div class="card-form tg-status"><div><h3>' + (st.bot ? "Бот " + esc(st.bot.name || "") : "Бот подключается…") + '</h3>' + (st.bot ? '<p class="hint">@' + esc(st.bot.username) + "</p>" : "") +
          (st.error ? '<p class="err">' + esc(st.error) + "</p>" : '<p class="hint">' + (st.chats.length ? "Уведомления получают чатов: " + st.chats.length + "." : "Пока никто не подключён — нажмите кнопку справа.") + "</p>") +
          '</div><div class="admin-actions"><button class="btn" type="button" id="tgLink">Подключить Telegram</button>' +
          (st.chats.length ? '<button class="mini" type="button" id="tgTest">Отправить проверку</button>' : "") + "</div></div>" +
          '<div id="tgLinkBox"></div>';
        h += '<div class="tbl-wrap"><table class="dtable"><thead><tr><th>Чат</th><th>Подключил</th><th>Когда</th><th></th></tr></thead><tbody>' +
          (st.chats.length ? st.chats.map(function (c) {
            return '<tr data-id="' + esc(c.chatId) + '"><td>' + esc(c.title) + "</td><td>" + esc(c.addedBy || "—") + "</td><td>" + esc(c.created ? shortDate(c.created) + ", " + c.created.slice(11) : "—") + '</td><td><div class="acts"><button class="mini danger" type="button" data-act="off">Отключить</button></div></td></tr>';
          }).join("") : '<tr><td colspan="4" class="empty">Нет подключённых чатов</td></tr>') + "</tbody></table></div>";
      }
      h += '<div class="tg-grid"><div class="card-form"><h3>Что будет в сообщении</h3>' +
        '<label class="check"><input type="checkbox" id="tgPersonal"' + (st.personal ? " checked" : "") + "> показывать имя, контакт и комментарий гостя</label>" +
        '<p class="hint">Серверы Telegram находятся за рубежом. Имя и телефон гостя в сообщении — это передача персональных данных за границу, о которой по 152-ФЗ нужно уведомить Роскомнадзор. Без этой галочки в Telegram уходят только вечер и число мест, а контакты гость видит в админке.</p></div>' +
        '<div><p class="hint">Так выглядит уведомление:</p>' + tgPreview(st.personal) + "</div></div>";
      $("tgBody").innerHTML = h;
    }
    $("tgBody").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.id === "tgLink") {
        b.disabled = true;
        api("POST", "/api/admin/telegram/link", {}).then(function (d) {
          $("tgLinkBox").innerHTML = '<div class="card-form tg-linkbox"><h3>Осталось одно нажатие</h3><p>Откройте ссылку на телефоне или компьютере, где установлен Telegram, и нажмите <b>«Старт»</b>. Ссылка одноразовая и действует ' + d.minutes + ' минут.</p>' +
            '<div class="admin-actions"><a class="btn" href="' + esc(d.url) + '" target="_blank" rel="noopener">Открыть бота в Telegram</a><a class="mini" href="' + esc(d.groupUrl) + '" target="_blank" rel="noopener">Добавить в группу</a></div>' +
            '<p class="hint">Ждём подтверждения из Telegram…</p></div>';
          var before = st.chats.length, tries = 0;
          clearInterval(watch);
          watch = setInterval(function () {
            if (!document.body.contains($("tgBody")) || ++tries > 300) return clearInterval(watch);
            api("GET", "/api/admin/telegram").then(function (d2) {
              if (d2.chats.length > before) { clearInterval(watch); st = d2; render(); toast("Telegram подключён"); }
            }).catch(function () {});
          }, 3000);
        }).catch(function (ex) { toast(ex.message); }).then(function () { b.disabled = false; });
      } else if (b.id === "tgTest") {
        api("POST", "/api/admin/telegram/test", {}).then(function (d) { toast("Проверка отправлена в чатов: " + d.sent); load(); }).catch(function (ex) { toast(ex.message); });
      } else if (b.dataset.act === "off") {
        var tr = b.closest("tr");
        if (!confirm("Отключить уведомления для этого чата?")) return;
        api("DELETE", "/api/admin/telegram/chats/" + encodeURIComponent(tr.dataset.id)).then(function () { toast("Чат отключён"); load(); }).catch(function (ex) { toast(ex.message); });
      }
    });
    $("tgBody").addEventListener("change", function (e) {
      if (e.target.id !== "tgPersonal") return;
      var on = e.target.checked;
      api("PATCH", "/api/admin/telegram/settings", { personal: on }).then(function (d) { st.personal = d.personal; render(); toast(on ? "Имя и контакт будут в уведомлениях" : "Уведомления без личных данных"); })
        .catch(function (ex) { e.target.checked = !on; toast(ex.message); });
    });
    load().catch(function (ex) { $("tgBody").innerHTML = '<p class="err">' + esc(ex.message) + "</p>"; });
  }

  function viewStaff() {
    main.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Сотрудники</h2><p class="hint">Ведущий вносит протоколы и правит свои. Администратор управляет всем: афишей, заявками, игроками и доступами.</p></div></div>' +
      '<form class="card-form" id="stForm" novalidate><h3>Добавить сотрудника</h3><div class="grid2">' +
      '<div class="field"><label for="stLogin">Логин</label><input id="stLogin" autocomplete="off" autocapitalize="none" placeholder="латиница, например ivan"></div>' +
      '<div class="field"><label for="stName">Имя</label><input id="stName" maxlength="60"></div>' +
      '<div class="field"><label for="stRole">Роль</label><select id="stRole"><option value="host">Ведущий</option><option value="admin">Администратор</option></select></div>' +
      '<div class="field"><label for="stPass">Пароль (от 10 символов)</label><input id="stPass" type="password" autocomplete="new-password"></div></div>' +
      '<p class="err" id="stErr" role="alert"></p><div class="admin-actions"><button class="btn" type="submit">Добавить</button></div></form>' +
      '<div class="tbl-wrap"><table class="dtable wide"><thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Доступ</th><th>Последний вход</th><th></th></tr></thead><tbody id="stBody"></tbody></table></div></section>';
    var list = [];
    function load() {
      api("GET", "/api/admin/staff").then(function (d) {
        list = d.staff;
        $("stBody").innerHTML = list.map(function (s) {
          return '<tr data-id="' + s.id + '" class="' + (s.active ? "" : "muted") + '"><td>' + esc(s.login) + "</td><td>" + esc(s.name) + "</td><td>" + (s.role === "admin" ? "Администратор" : "Ведущий") +
            '</td><td><span class="pill ' + (s.active ? "on" : "") + '">' + (s.active ? "активен" : "отключён") + "</span></td><td>" + (s.last_login ? shortDate(s.last_login) + ", " + s.last_login.slice(11) : "—") +
            '</td><td><div class="acts"><button class="mini" type="button" data-act="edit">Изменить</button></div></td></tr>';
        }).join("");
      });
    }
    $("stForm").addEventListener("submit", function (e) {
      e.preventDefault();
      api("POST", "/api/admin/staff", { login: $("stLogin").value.trim(), name: $("stName").value.trim(), role: $("stRole").value, password: $("stPass").value })
        .then(function () { toast("Сотрудник добавлен"); $("stForm").reset(); $("stErr").textContent = ""; load(); })
        .catch(function (ex) { $("stErr").textContent = ex.message; });
    });
    $("stBody").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]"); if (!b) return;
      var tr = b.closest("tr"), id = +tr.dataset.id, s = list.filter(function (x) { return x.id === id; })[0];
      if (b.dataset.act === "edit") {
        tr.children[1].innerHTML = '<input data-f="name" maxlength="60" value="' + esc(s.name) + '" aria-label="Имя">';
        tr.children[2].innerHTML = '<select data-f="role" aria-label="Роль"><option value="host"' + (s.role === "host" ? " selected" : "") + '>Ведущий</option><option value="admin"' + (s.role === "admin" ? " selected" : "") + ">Администратор</option></select>";
        tr.children[3].innerHTML = '<label class="check"><input data-f="active" type="checkbox"' + (s.active ? " checked" : "") + "> активен</label>";
        tr.children[5].innerHTML = '<div class="acts"><input data-f="pass" type="password" autocomplete="new-password" placeholder="Новый пароль (необязательно)" aria-label="Новый пароль"><button class="mini solid" type="button" data-act="save">Сохранить</button><button class="mini" type="button" data-act="cancel">Отмена</button></div>';
      } else if (b.dataset.act === "save") {
        var body = { name: tr.querySelector('[data-f="name"]').value, role: tr.querySelector('[data-f="role"]').value, active: tr.querySelector('[data-f="active"]').checked };
        var pw = tr.querySelector('[data-f="pass"]').value; if (pw) body.password = pw;
        api("PUT", "/api/admin/staff/" + id, body).then(function () { toast("Сохранено"); load(); }).catch(function (ex) { toast(ex.message); });
      } else if (b.dataset.act === "cancel") load();
    });
    load();
  }

  /* ---------- журнал ---------- */
  var ACTION_NAME = { create: "создал", update: "изменил", "delete": "удалил", login: "вошёл", password: "сменил пароль", status: "сменил статус", merge: "объединил", link: "подключил" };
  var ENTITY_NAME = { game: "протокол", event: "игру в афише", booking: "заявку", player: "игрока", staff: "сотрудника", photo: "фото в галерее", telegram: "уведомления Telegram" };
  function viewAudit() {
    main.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Журнал действий</h2><p class="hint">Последние 200 действий сотрудников. Удалённые протоколы сохраняются здесь целиком, их можно восстановить вручную.</p></div></div>' +
      '<div class="tbl-wrap"><table class="dtable wide"><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Подробности</th></tr></thead><tbody id="auBody"></tbody></table></div></section>';
    api("GET", "/api/admin/audit").then(function (d) {
      $("auBody").innerHTML = d.log.length ? d.log.map(function (a) {
        var det = a.details || {}, parts = [];
        if (det.date) parts.push(shortDate(det.date));
        if (det.format) parts.push(FMT_NAME[det.format] || det.format);
        if (det.table) parts.push("стол " + det.table);
        if (det.title) parts.push(det.title);
        if (det.nick) parts.push(det.nick);
        if (det.login) parts.push(det.login);
        if (det.status) parts.push(STATUS_NAME[det.status]);
        if (det.from) parts.push("из «" + det.from + "»");
        if (det.caption) parts.push(det.caption);
        if (det.chat) parts.push(det.chat);
        if (det.personal !== undefined) parts.push(det.personal ? "с именем и контактом" : "без личных данных");
        if (det.newPlayers && det.newPlayers.length) parts.push("новые игроки: " + det.newPlayers.join(", "));
        return "<tr><td>" + shortDate(a.at) + ", " + a.at.slice(11) + "</td><td>" + esc(a.staff || "—") + "</td><td>" + (ACTION_NAME[a.action] || a.action) + " " + (ENTITY_NAME[a.entity] || a.entity) + (a.entity_id ? " #" + a.entity_id : "") + "</td><td>" + esc(parts.join(" · ")) + "</td></tr>";
      }).join("") : '<tr><td colspan="4" class="empty">Журнал пуст.</td></tr>';
    });
  }

  /* ---------- пароль ---------- */
  function viewPassword() {
    main.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Смена пароля</h2><p class="hint">После смены пароля другие ваши сессии будут завершены.</p></div></div>' +
      '<form class="card-form" id="pwForm" novalidate style="max-width:480px">' +
      '<div class="field"><label for="pwCur">Текущий пароль</label><input id="pwCur" type="password" autocomplete="current-password"></div>' +
      '<div class="field"><label for="pwNew">Новый пароль (от 10 символов)</label><input id="pwNew" type="password" autocomplete="new-password"></div>' +
      '<div class="field"><label for="pwRep">Повторите новый пароль</label><input id="pwRep" type="password" autocomplete="new-password"></div>' +
      '<p class="err" id="pwErr" role="alert"></p><div class="admin-actions"><button class="btn" type="submit">Сменить пароль</button></div></form></section>';
    $("pwForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if ($("pwNew").value !== $("pwRep").value) { $("pwErr").textContent = "Новые пароли не совпадают."; return; }
      api("POST", "/api/auth/password", { current: $("pwCur").value, next: $("pwNew").value })
        .then(function () { toast("Пароль изменён"); $("pwForm").reset(); $("pwErr").textContent = ""; })
        .catch(function (ex) { $("pwErr").textContent = ex.message; });
    });
  }

  /* ---------- старт ---------- */
  api("GET", "/api/auth/me").then(function (d) { start(d.me); }).catch(function () { showLogin(); });
})();
