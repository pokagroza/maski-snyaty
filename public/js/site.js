(function () {
  "use strict";
  var INK = "#0b0907", PAPER = "#f4ede1", GOLD = "#c99a5b", GOLD_HI = "#e4c08a";
  var LOGO_SRC = "img/logo-mask-t.png", LOGO_IMG = null;
  var MASK_SRC = "img/logo-mask-hi.png", MASK_IMG = null;
  var root = document.documentElement;
  root.dataset.phase = "night";
  var yearEl = document.getElementById("year"); if (yearEl) yearEl.textContent = new Date().getFullYear();
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = !!window.gsap;
  if (hasGsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  /* ---------- icons (shared by DOM cards and WebGL textures) ---------- */
  function starPath(cx, cy, ro, ri, n) {
    var d = "";
    for (var i = 0; i < n * 2; i++) {
      var r = i % 2 ? ri : ro, a = -Math.PI / 2 + i * Math.PI / n;
      d += (i ? "L" : "M") + (cx + Math.cos(a) * r).toFixed(1) + " " + (cy + Math.sin(a) * r).toFixed(1) + " ";
    }
    return d + "Z";
  }
  var ICONS = {
    house: { main: "M12 50 L50 16 L88 50 L79 50 L79 86 L21 86 L21 50 Z", cut: "M43 62 H57 V86 H43 Z" },
    star: { main: starPath(50, 50, 42, 22, 6), cut: "M41 50 A9 9 0 1 0 59 50 A9 9 0 1 0 41 50 Z" },
    cross: { main: "M39 12 H61 V39 H88 V61 H61 V88 H39 V61 H12 V39 H39 Z", cut: "" },
    hat: { main: "M6 68 A44 11 0 0 0 94 68 A44 11 0 0 0 6 68 Z M28 66 L33 30 Q50 21 67 30 L72 66 Z", cut: "M30.5 52 L69.5 52 L70.4 59 L29.6 59 Z" },
    crown: { main: "M14 70 L18 26 L36 48 L50 18 L64 48 L82 26 L86 70 Z M14 75 H86 V86 H14 Z", cut: "M45 58 A5 5 0 1 0 55 58 A5 5 0 1 0 45 58 Z" },
    mask: { main: "M6 36 Q50 18 94 36 Q96 66 72 70 Q58 71 50 58 Q42 71 28 70 Q4 66 6 36 Z", cut: "M20 44 Q30 36 40 45 Q30 53 20 44 Z M60 45 Q70 36 80 44 Q70 53 60 45 Z" }
  };
  function iconSVG(key) {
    var ic = ICONS[key];
    return '<svg viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" d="' + ic.main + '"/>' + (ic.cut ? '<path class="cut" d="' + ic.cut + '"/>' : "") + "</svg>";
  }

  var ROLES = {
    civilian: { name: "Мирный житель", team: "city", teamLabel: "Город", count: "6 / 10", icon: "house", tag: "ищет мафию днём", desc: "Днём ищет мафию в разговоре и голосует. Ночью спит. Оружие — логика и внимание к мелочам." },
    sheriff: { name: "Шериф", team: "city", teamLabel: "Город", count: "1 / 10", icon: "star", tag: "проверяет ночью", desc: "Каждую ночь проверяет одного игрока и узнаёт, мафия ли он. Сам решает, когда раскрыться." },
    doctor: { name: "Доктор", team: "city", teamLabel: "Город", count: "питерская", icon: "cross", tag: "спасает одного", desc: "Ночью лечит одного игрока. Если мафия стреляла в него, тот остаётся в игре." },
    mafia: { name: "Мафия", team: "maf", teamLabel: "Мафия", count: "2 / 10", icon: "hat", tag: "выбирает цель", desc: "В первую ночь знакомится с напарниками, потом вместе с ними выбирает, кого убрать. Днём притворяется мирным." },
    don: { name: "Дон", team: "maf", teamLabel: "Мафия", count: "1 / 10", icon: "crown", tag: "ищет шерифа", desc: "Глава мафии. За ним последнее слово при ночном выстреле, а своими проверками он охотится на шерифа." },
    maniac: { name: "Маньяк", team: "maf", teamLabel: "Одиночка", count: "питерская", icon: "mask", tag: "играет сам за себя", desc: "Не на стороне города и не на стороне мафии. Ночью выбирает свою цель и побеждает, если останется за столом последним." }
  };
  var ROLE_KEYS = ["civilian", "sheriff", "doctor", "mafia", "don", "maniac"];
  var DEAL = {
    msk: { civilian: 6, sheriff: 1, mafia: 2, don: 1 },
    spb: { civilian: 5, sheriff: 1, doctor: 1, maniac: 1, mafia: 2, don: 1 }
  };

  /* ---------- toast ---------- */
  var toastEl = document.getElementById("toast"), toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("on"); }, 2200);
  }

  /* ---------- phase (night/day) ---------- */
  var phaseBtn = document.getElementById("phaseBtn"), phaseLabel = document.getElementById("phaseLabel");
  var sceneApi = null;
  phaseBtn.addEventListener("click", function () {
    var day = root.dataset.phase !== "day";
    root.dataset.phase = day ? "day" : "night";
    phaseLabel.textContent = day ? "День" : "Ночь";
    phaseBtn.setAttribute("aria-pressed", String(day));
    toast(day ? "Город просыпается" : "Город засыпает");
    if (sceneApi) sceneApi.setDay(day);
  });

  /* ---------- table of 10 ---------- */
  var comp = ["civilian", "civilian", "civilian", "civilian", "civilian", "civilian", "sheriff", "mafia", "mafia", "don"];
  document.getElementById("table10").innerHTML = comp.map(function (k) {
    return '<i class="' + (ROLES[k].team === "maf" ? "m" : "") + '">' + iconSVG(ROLES[k].icon) + "</i>";
  }).join("");
  document.querySelectorAll("#table10 .cut").forEach(function (p) { p.setAttribute("fill", "transparent"); });

  /* ---------- role deck ---------- */
  var deck = document.getElementById("deck");
  deck.innerHTML = ROLE_KEYS.map(function (k) {
    var r = ROLES[k];
    return '<button class="rcard" type="button" data-role="' + k + '" aria-label="Карта роли. Нажмите, чтобы перевернуть" data-cursor="Вскрыть">' +
      '<span class="flip"><span class="face back"><span class="seal"><img src="' + LOGO_SRC + '" alt=""></span><span class="wm">МАСКИ СНЯТЫ</span></span>' +
      '<span class="face front ' + r.team + '"><span class="tm"><span>' + r.teamLabel + "</span><span>" + r.count + "</span></span>" + iconSVG(r.icon) +
      "<h3>" + r.name + "</h3><p>" + r.desc + "</p></span></span></button>";
  }).join("");
  deck.querySelectorAll(".face.front").forEach(function (f) {
    var c = f.classList.contains("maf") ? INK : PAPER;
    f.querySelectorAll(".cut").forEach(function (p) { p.setAttribute("fill", c); });
  });
  var cards = Array.prototype.slice.call(deck.querySelectorAll(".rcard"));
  var drawOut = document.getElementById("drawOut");
  cards.forEach(function (c) {
    c.addEventListener("click", function () {
      c.classList.toggle("open");
      c.setAttribute("aria-label", c.classList.contains("open") ? ROLES[c.dataset.role].name + ". Нажмите, чтобы закрыть" : "Карта роли. Нажмите, чтобы перевернуть");
    });
    if (!reduce) {
      c.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse") return;
        var b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5;
        c.style.transform = "rotateX(" + (-y * 14).toFixed(2) + "deg) rotateY(" + (x * 16).toFixed(2) + "deg) translateZ(10px)";
      });
      c.addEventListener("pointerleave", function () { c.style.transform = ""; });
    }
  });
  var drawing = false, dealMode = "msk", drawModeEl = document.getElementById("drawMode");
  function applyDealMode() {
    drawModeEl.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.m === dealMode)); });
    cards.forEach(function (c) { c.classList.toggle("dim", !DEAL[dealMode][c.dataset.role]); });
  }
  drawModeEl.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b || drawing) return;
    dealMode = b.dataset.m; applyDealMode();
    drawOut.textContent = dealMode === "msk" ? "Московская раздача: 10 карт, 4 роли." : "Питерская раздача: 12 карт, в игре доктор и маньяк.";
  });
  applyDealMode();
  document.getElementById("drawBtn").addEventListener("click", function () {
    if (drawing) return;
    drawing = true;
    var weights = DEAL[dealMode], bag = [];
    Object.keys(weights).forEach(function (k) { for (var i = 0; i < weights[k]; i++) bag.push(k); });
    var pick = bag[Math.floor(Math.random() * bag.length)];
    var target = deck.querySelector('[data-role="' + pick + '"]');
    cards.forEach(function (c) { c.classList.remove("open", "picked"); });
    drawOut.textContent = "Ведущий раздаёт карты…";
    function finish() {
      target.classList.add("open", "picked");
      var r = ROLES[pick];
      drawOut.innerHTML = "Вам выпало: <b>" + r.name + "</b>. " + (pick === "maniac" ? "Вы сами за себя. Останьтесь последним." : r.team === "maf" ? "Вы играете за мафию. Не выдайте себя днём." : "Вы играете за город. Найдите мафию до того, как она найдёт вас.");
      drawing = false;
    }
    if (hasGsap && !reduce) {
      gsap.timeline({ onComplete: finish })
        .to(cards, { y: -26, rotation: function () { return (Math.random() - .5) * 10; }, duration: .28, stagger: .05, ease: "power2.out" })
        .to(cards, { y: 0, rotation: 0, duration: .45, stagger: .05, ease: "bounce.out" }, ">-.05");
    } else { setTimeout(finish, 600); }
  });

  /* ---------- API ---------- */
  function api(method, path, body) {
    var opts = { method: method, headers: { "X-Requested-With": "lupin" }, credentials: "same-origin" };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.error || "Сервер не ответил. Попробуйте ещё раз."); e.status = res.status; e.data = data; throw e; }
        return data;
      });
    });
  }
  function escapeHTML(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------- events ---------- */
  var EVENTS = [], eventsLoaded = false;
  var FMT = { all: "Все", msk: "Московская", spb: "Питерская", novice: "Новичкам", theme: "Тематические", final: "Финалы месяца" };
  var FMT_TAG = { novice: "Новичкам", msk: "Московская", spb: "Питерская", theme: "Тематическая", final: "Финал месяца" };
  function dparts(ev) {
    var dt = new Date(ev.date + "T12:00:00");
    return {
      day: dt.getDate(),
      mon: dt.toLocaleDateString("ru-RU", { month: "short" }).replace(".", ""),
      wd: dt.toLocaleDateString("ru-RU", { weekday: "short" }),
      long: dt.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
    };
  }
  function rub(n) { return n.toLocaleString("ru-RU").replace(/ /g, " ") + " ₽"; }
  function plural(n, a, b, c) { var m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c); }
  function findEvent(id) { return EVENTS.filter(function (e) { return String(e.id) === String(id); })[0]; }

  var chips = document.getElementById("chips"), list = document.getElementById("events"), current = "all";
  chips.innerHTML = Object.keys(FMT).map(function (k) { return '<button class="chip" type="button" data-f="' + k + '" aria-pressed="' + (k === "all") + '">' + FMT[k] + "</button>"; }).join("");
  function setFilter(f, animate) {
    current = f;
    chips.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", String(c.dataset.f === f)); });
    renderEvents(animate);
  }
  chips.addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    setFilter(b.dataset.f, true);
  });
  document.querySelectorAll("[data-filter]").forEach(function (a) {
    a.addEventListener("click", function () { setFilter(a.dataset.filter, true); });
  });
  function seatDots(ev) {
    if (ev.capacity > 60) return "";
    var h = "", step = ev.spectator ? 10 : ev.tableSize;
    for (var i = 0; i < ev.capacity; i++) {
      if (i && i % step === 0) h += '<i class="gap"></i>';
      h += '<i class="' + (i < ev.taken ? "t" : "") + '"></i>';
    }
    return h;
  }
  function renderEvents(animate) {
    if (!eventsLoaded) { list.innerHTML = '<p class="sched-empty">Загружаем афишу…</p>'; return; }
    var items = EVENTS.filter(function (e) { return current === "all" || e.kind === current; });
    if (!items.length) {
      list.innerHTML = '<p class="sched-empty">' + (EVENTS.length ? "В этом формате пока нет игр. Загляните позже." : "Расписание скоро появится. Следите за новостями клуба.") + "</p>";
      return;
    }
    list.innerHTML = items.map(function (ev) {
      var p = dparts(ev), left = ev.left, full = left <= 0;
      return '<article class="ev">' +
        '<div class="ev-date"><b>' + p.day + "</b><span>" + p.mon + " · " + p.wd + "</span></div>" +
        '<div class="ev-main"><span class="ev-tag">' + FMT_TAG[ev.kind] + "</span><h3>" + escapeHTML(ev.title) + "</h3><p>" + escapeHTML(ev.description) + "</p></div>" +
        '<div class="ev-time"><b>' + ev.time + "</b>" + escapeHTML(ev.venue) + '<div class="seats" aria-hidden="true">' + seatDots(ev) + '</div><div class="seats-cap">' +
        (full ? "Мест нет" : (ev.spectator ? "Зрителям: " : "Свободно ") + left + " " + plural(left, "место", "места", "мест") + " из " + ev.capacity) + "</div></div>" +
        '<div class="ev-price">' + rub(ev.price) + "</div>" +
        (full ? '<button class="btn ghost" type="button" disabled>Мест нет</button>' : '<a class="btn" href="#book" data-ev="' + ev.id + '" data-cursor="Занять">' + (ev.spectator ? "Билет зрителя" : "Занять место") + "</a>") +
        "</article>";
    }).join("");
    if (animate && hasGsap && !reduce) gsap.from(list.children, { y: 24, duration: .5, stagger: .05, ease: "power3.out" });
  }
  function renderNext() {
    var box = document.getElementById("nextGame");
    var soonest = EVENTS.filter(function (e) { return e.left > 0 && Date.parse(e.date + "T" + e.time + ":00+03:00") > Date.now(); })[0];
    if (!soonest) {
      box.innerHTML = '<div class="eyebrow">Ближайшая игра</div><h3>Скоро в афише</h3><div class="left">Расписание обновляется каждую неделю.</div><a class="btn" href="#book">Оставить заявку</a>';
      return;
    }
    var np = dparts(soonest);
    box.innerHTML = '<div class="eyebrow">Ближайшая игра</div><h3>' + escapeHTML(soonest.title) + '</h3><div class="when">' + np.long + ", " + soonest.time + '</div>' + countdownHTML() + '<div class="left">Осталось ' + soonest.left + " " + plural(soonest.left, "место", "места", "мест") + " · " + rub(soonest.price) + '</div><a class="btn" href="#book" data-ev="' + soonest.id + '">' + (soonest.spectator ? "Билет зрителя" : "Занять место") + "</a>";
    startCountdown(soonest);
    if (window.maskiSceneLayout) window.maskiSceneLayout();
  }
  /* ---------- таймер до начала шоу: перелистывающиеся цифры ---------- */
  // Время в афише — смоленское (UTC+3, без перехода на летнее время)
  var cdTarget = 0, cdTimer = 0, cdPrev = {};
  var CD_UNITS = [["d", "дн", "день", "дня", "дней"], ["h", "ч", "час", "часа", "часов"], ["m", "мин", "минута", "минуты", "минут"], ["s", "сек", "секунда", "секунды", "секунд"]];
  function countdownHTML() {
    return '<div class="countdown" id="countdown" role="timer" aria-live="off"><div class="cd-label">До начала шоу</div><div class="cd-row">' +
      CD_UNITS.map(function (u) { return '<div class="cd-unit" data-u="' + u[0] + '"><div class="cd-digits"><span class="dg"><i>0</i></span><span class="dg"><i>0</i></span></div><small>' + u[4] + "</small></div>"; }).join('<span class="cd-sep">:</span>') +
      "</div></div>";
  }
  function setDigit(el, ch) {
    var cur = el.lastElementChild;
    if (cur && cur.textContent === ch) return;
    var n = document.createElement("i"); n.textContent = ch;
    if (cur && !reduce) { cur.className = "out"; n.className = "in"; setTimeout(function () { if (cur.parentNode) cur.parentNode.removeChild(cur); }, 520); }
    else if (cur) el.removeChild(cur);
    el.appendChild(n);
  }
  function tickCountdown() {
    var box = document.getElementById("countdown");
    if (!box) { clearInterval(cdTimer); cdTimer = 0; return; }
    var ms = cdTarget - Date.now();
    if (ms <= 0) {
      clearInterval(cdTimer); cdTimer = 0;
      box.classList.add("live");
      box.innerHTML = '<div class="cd-label">Шоу уже началось</div><div class="cd-live">Город не спит — ждём вас за столом</div>';
      return;
    }
    var t = Math.floor(ms / 1000), v = { d: Math.floor(t / 86400), h: Math.floor(t % 86400 / 3600), m: Math.floor(t % 3600 / 60), s: t % 60 };
    CD_UNITS.forEach(function (u) {
      var unit = box.querySelector('[data-u="' + u[0] + '"]'), val = v[u[0]];
      var str = (val < 10 ? "0" : "") + Math.min(val, 99);
      var dg = unit.querySelectorAll(".dg");
      setDigit(dg[0], str[0]); setDigit(dg[1], str[1]);
      if (cdPrev[u[0]] !== val) unit.querySelector("small").textContent = plural(val, u[2], u[3], u[4]);
      cdPrev[u[0]] = val;
    });
    box.setAttribute("aria-label", "До начала шоу " + v.d + " " + plural(v.d, "день", "дня", "дней") + " " + v.h + " " + plural(v.h, "час", "часа", "часов"));
    box.classList.toggle("soon", ms < 3 * 3600 * 1000);
  }
  function startCountdown(ev) {
    cdTarget = Date.parse(ev.date + "T" + ev.time + ":00+03:00"); cdPrev = {};
    if (cdTimer) clearInterval(cdTimer);
    tickCountdown();
    if (cdTarget > Date.now()) cdTimer = setInterval(tickCountdown, 1000);
  }

  function loadEvents(animate) {
    return api("GET", "/api/events").then(function (d) {
      EVENTS = d.events; eventsLoaded = true;
      renderEvents(animate); renderNext(); fillSelect();
    }).catch(function () {
      eventsLoaded = true; EVENTS = [];
      list.innerHTML = '<p class="sched-empty">Не удалось загрузить афишу. Обновите страницу чуть позже.</p>';
      renderNext(); fillSelect();
    });
  }
  renderEvents(false);

  /* ---------- booking ---------- */
  var sel = document.getElementById("f-game"), seats = document.getElementById("f-seats"), total = document.getElementById("total"), err = document.getElementById("err");
  var PLANS = { corporate: ["Корпоратив", 0], "private": ["День рождения", 0] };
  function fillSelect() {
    if (!sel) return;
    var prev = sel.value;
    var h = EVENTS.filter(function (e) { return e.left > 0; }).map(function (e) {
      var p = dparts(e); return '<option value="' + e.id + '">' + p.day + " " + p.mon + ", " + e.time + " · " + escapeHTML(e.title) + "</option>";
    }).join("");
    h += '<optgroup label="Другое">' + Object.keys(PLANS).map(function (k) { return '<option value="plan:' + k + '">' + PLANS[k][0] + "</option>"; }).join("") + "</optgroup>";
    sel.innerHTML = h;
    if (prev && sel.querySelector('option[value="' + prev + '"]')) sel.value = prev;
    updateTotal();
  }
  function chosen() {
    var v = sel.value || "";
    if (v.indexOf("plan:") === 0) { var k = v.slice(5); return { plan: k, title: PLANS[k][0], price: PLANS[k][1], max: 1 }; }
    var ev = findEvent(v);
    if (!ev) return { plan: "private", title: "", price: 0, max: 1 };
    return { ev: ev, price: ev.price, max: Math.max(1, Math.min(6, ev.left)) };
  }
  function updateTotal() {
    if (!sel || !seats) return;
    var c = chosen(), n = Math.max(1, Math.min(c.max, parseInt(seats.value, 10) || 1));
    seats.max = c.max; seats.value = n;
    seats.disabled = !!c.plan;
    total.innerHTML = "<small>Итого</small>" + (c.price ? rub(c.price * n) : "по запросу");
  }
  function bindFormControls() {
    sel.addEventListener("change", updateTotal);
    seats.addEventListener("input", updateTotal);
    document.getElementById("minus").addEventListener("click", function () { seats.value = (parseInt(seats.value, 10) || 1) - 1; updateTotal(); });
    document.getElementById("plus").addEventListener("click", function () { seats.value = (parseInt(seats.value, 10) || 1) + 1; updateTotal(); });
  }
  bindFormControls();

  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-ev],[data-plan]"); if (!a) return;
    if (!document.getElementById("form")) resetForm();
    sel.value = a.dataset.ev ? a.dataset.ev : "plan:" + a.dataset.plan;
    updateTotal();
    var f = document.getElementById("form");
    f.classList.remove("flash"); void f.offsetWidth; f.classList.add("flash");
    setTimeout(function () { var n = document.getElementById("f-name"); if (n) n.focus({ preventScroll: true }); }, 700);
  });

  var formHTML = document.getElementById("bookBox").innerHTML;
  function resetForm() {
    document.getElementById("bookBox").innerHTML = formHTML;
    sel = document.getElementById("f-game"); seats = document.getElementById("f-seats"); total = document.getElementById("total"); err = document.getElementById("err");
    bindFormControls(); fillSelect(); bindForm();
  }
  var sending = false;
  function bindForm() {
    document.getElementById("form").addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      var name = document.getElementById("f-name").value.trim(), contact = document.getElementById("f-contact").value.trim();
      var consent = document.getElementById("f-consent").checked;
      if (!name) { err.textContent = "Укажите имя, чтобы ведущий знал, как к вам обращаться."; document.getElementById("f-name").focus(); return; }
      var digits = contact.replace(/\D/g, "").length;
      if (!/^@?[A-Za-z0-9_]{4,32}$/.test(contact) && (digits < 10 || digits > 15)) { err.textContent = "Укажите телефон из 10–11 цифр или ник в Telegram, например @lupin_guest."; document.getElementById("f-contact").focus(); return; }
      if (!consent) { err.textContent = "Отметьте согласие на обработку персональных данных — без него мы не можем принять заявку."; document.getElementById("f-consent").focus(); return; }
      err.textContent = "";
      var c = chosen(), n = parseInt(seats.value, 10) || 1;
      var payload = {
        requestKind: c.ev ? "event" : c.plan, eventId: c.ev ? c.ev.id : null, seats: c.ev ? n : 1,
        name: name, contact: contact, comment: document.getElementById("f-note").value.trim(), consent: true,
        website: document.getElementById("f-website").value
      };
      var btn = document.querySelector("#form button[type=submit]");
      sending = true; btn.disabled = true;
      api("POST", "/api/bookings", payload).then(function () {
        var what = c.ev ? escapeHTML(c.ev.title) + ", " + dparts(c.ev).long + " в " + c.ev.time : escapeHTML(c.title);
        var box = document.getElementById("bookBox");
        box.innerHTML = '<div class="ticket" tabindex="-1" id="ticket"><div class="seal2"><img src="' + LOGO_SRC + '" alt="" style="width:46%;height:auto"></div><div class="eyebrow" style="justify-content:center">Заявка принята</div><h3>' + escapeHTML(name) + ', ваша роль — гость вечера</h3>' +
          '<p class="sum">' + what + (c.ev ? " · " + n + " " + plural(n, "место", "места", "мест") : "") + (c.price ? " · " + rub(c.price * n) : "") + ". Мы свяжемся с вами по контакту " + escapeHTML(contact) + ", чтобы подтвердить запись.</p>" +
          '<button class="btn ghost" type="button" id="again">Новая заявка</button></div>';
        var t = document.getElementById("ticket"); t.focus({ preventScroll: true });
        if (hasGsap && !reduce) gsap.from(t, { rotationY: -90, transformPerspective: 900, duration: .9, ease: "power3.out" });
        document.getElementById("again").addEventListener("click", resetForm);
        loadEvents(false);
      }).catch(function (ex) {
        err.textContent = ex.message;
        if (ex.status === 409) loadEvents(false);
      }).then(function () { sending = false; if (btn) btn.disabled = false; });
    });
  }
  bindForm();
  loadEvents(false);

  /* ---------- рейтинг месяца и протоколы (данные с сервера) ---------- */
  var MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  var MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  var ROLE_NAME = { civ: "Мирный", sher: "Шериф", doc: "Доктор", lover: "Любовница", maniac: "Маньяк", maf: "Мафия", don: "Дон" };
  var RES_NAME = { red: "победа красных", black: "победа чёрных", maniac: "победа маньяка", draw: "ничья" };
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dec(x) { return String(Math.round(x * 100) / 100).replace(".", ","); }
  function nowMonth() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function monthLabel(m) { var p = m.split("-"); return MONTHS_NOM[+p[1] - 1] + " " + p[0]; }
  function shortDate(iso) { var p = iso.split("-"); return +p[2] + " " + MONTHS_SHORT[+p[1] - 1]; }

  var rateMode = "msk", rateBody = document.getElementById("rateBody"), rateSearch = document.getElementById("rateSearch"), rateMonth = document.getElementById("rateMonth");
  var rateCap = document.getElementById("rateCap"), protoList = document.getElementById("protoList");
  var RATING = null, PROTOS = [], rateReq = 0;

  function loadMonths() {
    return api("GET", "/api/rating/months?format=" + rateMode).then(function (d) {
      var ms = d.months.slice();
      if (ms.indexOf(nowMonth()) === -1) ms.unshift(nowMonth());
      ms.sort().reverse();
      var prev = rateMonth.value;
      rateMonth.innerHTML = ms.map(function (m) { return '<option value="' + m + '">' + monthLabel(m) + "</option>"; }).join("");
      rateMonth.value = prev && ms.indexOf(prev) !== -1 ? prev : (d.months.indexOf(nowMonth()) !== -1 || !d.months.length ? nowMonth() : d.months[0]);
    }).catch(function () {
      rateMonth.innerHTML = '<option value="' + nowMonth() + '">' + monthLabel(nowMonth()) + "</option>";
    });
  }
  function loadRating(animate) {
    var my = ++rateReq, month = rateMonth.value || nowMonth();
    document.getElementById("monthName").textContent = MONTHS_GEN[+month.split("-")[1] - 1];
    rateBody.innerHTML = '<tr class="rt-empty"><td colspan="10">Загружаем рейтинг…</td></tr>';
    return Promise.all([
      api("GET", "/api/rating?format=" + rateMode + "&month=" + month),
      api("GET", "/api/games?format=" + rateMode + "&month=" + month)
    ]).then(function (res) {
      if (my !== rateReq) return;
      RATING = res[0]; PROTOS = res[1].games;
      renderRating(animate);
    }).catch(function () {
      if (my !== rateReq) return;
      rateBody.innerHTML = '<tr class="rt-empty"><td colspan="10">Не удалось загрузить рейтинг. Обновите страницу чуть позже.</td></tr>';
    });
  }
  function renderRating(animate) {
    if (!RATING) return;
    var rows = RATING.rows, q = rateSearch.value.trim().toLowerCase(), month = RATING.month;
    var max = Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([.01])), h = "";
    rows.forEach(function (r) {
      if (!q || String(r.nick).toLowerCase().indexOf(q) !== -1) {
        var cls = [r.place === 1 ? "top1" : "", r.place && r.place <= 3 ? "top3" : "", r.eligible ? "" : "out", q ? "hl" : ""].join(" ");
        var need = RATING.minGames - r.games;
        h += '<tr class="' + cls + '"><td class="pos">' + (r.place || "—") + '</td><td class="nick">' + (r.playerId ? '<button class="nick-btn" type="button" data-player="' + r.playerId + '">' + escapeHTML(r.nick) + "</button>" : escapeHTML(r.nick)) +
          "<small>" + (r.eligible ? r.winRate + "% побед" : "до допуска " + need + " " + plural(need, "игра", "игры", "игр")) + "</small></td>" +
          "<td>" + r.games + "</td><td>" + r.wins + "</td><td>" + dec(r.dop) + "</td><td>" + dec(r.lx) + "</td><td>" + dec(r.ci) + "</td><td>" + (r.pen ? "−" + dec(r.pen) : "0") +
          '</td><td class="pts">' + dec(r.total) + '<span class="bar" style="transform:scaleX(' + Math.min(1, Math.max(0, r.total / max)).toFixed(3) + ')"></span></td><td>' + r.avg.toFixed(2).replace(".", ",") + "</td></tr>";
      }
      if (!q && r.place === RATING.finalSpots) h += '<tr class="cutline"><td colspan="10"><div>черта финала</div></td></tr>';
    });
    if (!rows.length) h = '<tr class="rt-empty"><td colspan="10">' + monthLabel(month) + ": протоколов пока нет. Рейтинг появится после первой внесённой игры.</td></tr>";
    else if (!h) h = '<tr class="rt-empty"><td colspan="10">Игрок с таким ником в этом месяце не играл.</td></tr>';
    rateBody.innerHTML = h;
    rateCap.innerHTML = "<span>Σ — сумма очков за месяц, Ср. — средний балл за игру. Места распределяются по сумме, при равенстве — по среднему баллу. В рейтинг попадают игроки, сыгравшие " + RATING.minGames + " игр и больше.</span>";
    renderProtos();
    if (animate && hasGsap && !reduce) gsap.from(rateBody.querySelectorAll("tr"), { x: -20, duration: .45, stagger: .02, ease: "power3.out" });
  }
  function protoTable(g) {
    var rows = g.seats.map(function (s, i) {
      return "<tr><td>" + (i + 1) + "</td><td>" + (s.playerId ? '<button class="nick-btn" type="button" data-player="' + s.playerId + '">' + escapeHTML(s.nick) + "</button>" : escapeHTML(s.nick)) + (s.first ? " ✕" : "") + "</td><td>" + ROLE_NAME[s.role] + "</td><td>" + s.main + "</td><td>" + dec(s.dop) + "</td><td>" + dec(s.lx) + "</td><td>" + (s.pen ? "−" + dec(s.pen) : "0") + '</td><td class="pts">' + dec(s.total) + "</td></tr>";
    }).join("");
    var fi = -1; g.seats.forEach(function (s, i) { if (s.first) fi = i; });
    var lxLine = "";
    if (g.format === "msk" && fi >= 0) {
      var named = (g.lx || []).filter(Boolean);
      lxLine = "<p class='rt-cap'>Первым убит №" + (fi + 1) + ". " + (named.length ? "Лучший ход: " + named.join(", ") + " (чёрных: " + g.lxBlacks + ")." : "Лучший ход не назван.") + "</p>";
    }
    return '<div class="tbl-wrap"><table class="rt"><thead><tr><th>№</th><th>Игрок</th><th>Роль</th><th>Поб.</th><th>Доп</th><th>ЛХ</th><th>Штр.</th><th>Итог</th></tr></thead><tbody>' + rows + "</tbody></table></div>" + lxLine;
  }
  function renderProtos() {
    protoList.innerHTML = PROTOS.length ? PROTOS.slice(0, 60).map(function (g) {
      return '<details class="proto"><summary><span>' + shortDate(g.date) + " · стол " + g.tableNo + ' <span class="res">· ' + RES_NAME[g.result] + (g.hostName ? " · ведущий " + escapeHTML(g.hostName) : "") + "</span></span></summary>" + protoTable(g) + "</details>";
    }).join("") : '<p class="rt-cap">Протоколов за этот месяц нет.</p>';
  }
  document.getElementById("rateMode").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    rateMode = b.dataset.m;
    this.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    loadMonths().then(function () { loadRating(true); });
  });
  rateMonth.addEventListener("change", function () { loadRating(true); });
  rateSearch.addEventListener("input", function () { renderRating(false); });
  loadMonths().then(function () { loadRating(false); });

  (function countdown() {
    var now = new Date(), end = new Date(now.getFullYear(), now.getMonth() + 1, 1), days = Math.ceil((end - now) / 864e5);
    document.getElementById("finalLabel").textContent = "До конца отбора " + MONTHS_GEN[now.getMonth()];
    document.getElementById("countdown").innerHTML = days + "<small>" + plural(days, "день", "дня", "дней") + "</small>";
    document.getElementById("finalWhen").innerHTML = 'Финал месяца проходит в первые выходные следующего месяца. <a href="#games" data-filter-link="final">Билеты зрителя в афише</a>.';
    document.querySelector("[data-filter-link]").addEventListener("click", function () { setFilter("final", true); });
  })();

  /* ---------- галерея вечеров: полароиды проявляются из сепии ---------- */
  var GALLERY_DEFAULT = [
    { src: "img/masks-row.jpg", caption: "Маски ждут игроков", width: 1096, height: 860 },
    { src: "img/founder.jpg", caption: "Анастасия, основатель клуба", width: 396, height: 592 },
    { src: "img/masks-shelf.jpg", caption: "Реквизит ручной работы", width: 596, height: 440 }
  ];
  var galPhotos = [], lbIndex = 0;
  var polTable = document.getElementById("polTable"), lightbox = document.getElementById("lightbox");
  function galDate(iso) { if (!iso) return ""; var p = iso.split("-"); return +p[2] + " " + MONTHS_GEN[+p[1] - 1] + " " + p[0]; }
  function renderGallery(photos) {
    galPhotos = photos;
    // Полароиды «брошены» на стол: у каждого свой наклон и сдвиг, но одинаковые при каждой загрузке
    polTable.innerHTML = photos.map(function (ph, i) {
      var r = ((i * 37) % 9 - 4) * 1.3, dy = ((i * 53) % 5 - 2) * 6;
      return '<button class="pol" type="button" data-i="' + i + '" data-cursor="Смотреть" style="--r:' + r.toFixed(1) + "deg;--dy:" + dy + 'px" aria-label="' + escapeHTML(ph.caption || "Фото вечера") + '">' +
        '<span class="pol-ph"><img src="' + escapeHTML(ph.src) + '" alt="" loading="lazy" decoding="async"></span>' +
        '<span class="pol-cap">' + escapeHTML(ph.caption || "") + "</span>" + (ph.takenOn ? '<span class="pol-date">' + galDate(ph.takenOn) + "</span>" : "") + "</button>";
    }).join("") +
      '<a class="pol pol-you" href="#book" data-cursor="Записаться" style="--r:2.6deg;--dy:-4px"><span class="pol-ph"><img src="img/logo-mask-t.png" alt=""><em>здесь может быть<br>ваш вечер</em></span><span class="pol-cap">Следующий кадр — ваш</span></a>';
    var cards = polTable.querySelectorAll(".pol");
    if (reduce || !("IntersectionObserver" in window)) { cards.forEach(function (c) { c.classList.add("dev"); }); return; }
    // Снимки проявляются по очереди, когда стол попадает в кадр
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var idx = Array.prototype.indexOf.call(cards, en.target);
        setTimeout(function () { en.target.classList.add("dev"); }, 250 + (idx % 4) * 350);
        io.unobserve(en.target);
      });
    }, { threshold: .35 });
    cards.forEach(function (c) { io.observe(c); });
  }
  function openLightbox(i) {
    lbIndex = (i + galPhotos.length) % galPhotos.length;
    var ph = galPhotos[lbIndex], img = document.getElementById("lbImg");
    img.src = ph.src; img.alt = ph.caption || "Фото вечера";
    document.getElementById("lbCap").innerHTML = escapeHTML(ph.caption || "") + (ph.takenOn ? "<small>" + galDate(ph.takenOn) + "</small>" : "") + '<small class="lb-count">' + (lbIndex + 1) + " / " + galPhotos.length + "</small>";
    if (cur) cur.classList.remove("big");
    if (lightbox.hidden) { lightbox.hidden = false; document.body.style.overflow = "hidden"; requestAnimationFrame(function () { lightbox.classList.add("on"); }); lightbox.querySelector(".lb-close").focus(); }
  }
  function closeLightbox() {
    lightbox.classList.remove("on"); document.body.style.overflow = "";
    setTimeout(function () { lightbox.hidden = true; }, 300);
    var back = polTable.querySelector('[data-i="' + lbIndex + '"]'); if (back) back.focus();
  }
  polTable.addEventListener("click", function (e) { var b = e.target.closest("button.pol"); if (b) openLightbox(+b.dataset.i); });
  lightbox.addEventListener("click", function (e) {
    if (e.target.closest(".lb-close") || e.target === lightbox) closeLightbox();
    else if (e.target.closest(".lb-nav.prev")) openLightbox(lbIndex - 1);
    else if (e.target.closest(".lb-nav.next")) openLightbox(lbIndex + 1);
  });
  addEventListener("keydown", function (e) {
    if (lightbox.hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") openLightbox(lbIndex - 1);
    else if (e.key === "ArrowRight") openLightbox(lbIndex + 1);
  });
  (function () {
    var sx = 0;
    lightbox.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener("touchend", function (e) { var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) openLightbox(lbIndex + (dx < 0 ? 1 : -1)); });
  })();
  api("GET", "/api/gallery").then(function (d) { renderGallery(d.photos && d.photos.length ? d.photos : GALLERY_DEFAULT); })
    .catch(function () { renderGallery(GALLERY_DEFAULT); });

  /* ---------- format panels tilt ---------- */
  if (!reduce) document.querySelectorAll("[data-tilt-soft]").forEach(function (el) {
    el.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      var b = el.getBoundingClientRect(), x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5;
      el.style.transform = "rotateX(" + (-y * 4).toFixed(2) + "deg) rotateY(" + (x * 5).toFixed(2) + "deg)";
      var g = el.querySelector(".ghost-num"); if (g) g.style.transform = "translate(" + (x * -30).toFixed(1) + "px," + (y * -20).toFixed(1) + "px)";
    });
    el.addEventListener("pointerleave", function () { el.style.transform = ""; var g = el.querySelector(".ghost-num"); if (g) g.style.transform = ""; });
  });

  /* ---------- plan tilt ---------- */
  if (!reduce) document.querySelectorAll("[data-tilt]").forEach(function (el) {
    el.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      var b = el.getBoundingClientRect(), x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5;
      el.style.transform = "rotateX(" + (-y * 8).toFixed(2) + "deg) rotateY(" + (x * 10).toFixed(2) + "deg) translateY(-6px)";
    });
    el.addEventListener("pointerleave", function () { el.style.transform = ""; });
  });

  /* ---------- custom cursor ---------- */
  var cur = document.getElementById("cursor"), curLabel = document.getElementById("cursorLabel");
  var cx = innerWidth / 2, cy = innerHeight / 2, tx = cx, ty = cy, sceneHover = false, sceneLabel = "Вскрыть";
  if (matchMedia("(pointer: fine)").matches) {
    addEventListener("pointermove", function (e) {
      tx = e.clientX; ty = e.clientY;
      var t = e.target.closest && e.target.closest("[data-cursor]");
      var label = t ? t.dataset.cursor : (sceneHover ? sceneLabel : "");
      cur.classList.toggle("big", !!label);
      if (label) curLabel.textContent = label;
    });
    (function loop() { cx += (tx - cx) * .2; cy += (ty - cy) * .2; cur.style.transform = "translate(" + cx.toFixed(1) + "px," + cy.toFixed(1) + "px)"; requestAnimationFrame(loop); })();
  }

  /* ---------- тест «Узнай свою роль» ---------- */
  (function quiz() {
    var stage = document.getElementById("quizStage");
    if (!stage) return;
    var Q = [
      { q: "Вы пришли на вечеринку, где почти никого не знаете. Что делаете?", a: [
        ["Знакомлюсь со всеми и запоминаю, кто что сказал", { sheriff: 2, civilian: 1 }],
        ["Держусь в тени и наблюдаю", { mafia: 2, maniac: 1 }],
        ["Нахожу самого интересного человека и делаю его союзником", { don: 2, mafia: 1 }],
        ["Помогаю хозяевам, чтобы всем было уютно", { doctor: 2, civilian: 1 }]] },
      { q: "В споре вы обычно…", a: [
        ["Привожу факты и ловлю на противоречиях", { sheriff: 2 }],
        ["Говорю уверенно, даже если сам не уверен", { don: 2, mafia: 1 }],
        ["Слушаю всех и встаю на сторону самого убедительного", { civilian: 2 }],
        ["Молчу, а потом делаю по-своему", { maniac: 2 }]] },
      { q: "Друг рассказывает историю, и вы понимаете, что он сочиняет. Ваша реакция?", a: [
        ["Мягко подыгрываю, чтобы его не задеть", { doctor: 2, mafia: 1 }],
        ["Сразу вывожу на чистую воду", { sheriff: 2 }],
        ["Запоминаю — пригодится", { don: 1, maniac: 1, mafia: 1 }],
        ["Верю: зачем ему врать?", { civilian: 2 }]] },
      { q: "Ваша роль в команде?", a: [
        ["Лидер, который принимает решения", { don: 2, mafia: 1 }],
        ["Аналитик, который видит картину целиком", { sheriff: 2 }],
        ["Тот, кто всегда подставит плечо", { doctor: 2, civilian: 1 }],
        ["Одиночка: сам справлюсь лучше", { maniac: 2 }]] },
      { q: "Что для вас главное в игре?", a: [
        ["Победа. Любой ценой", { maniac: 2, don: 1 }],
        ["Красивая логика и правда", { civilian: 2, sheriff: 1 }],
        ["Атмосфера и люди вокруг", { doctor: 2, civilian: 1 }],
        ["Обмануть всех и остаться незамеченным", { mafia: 2, don: 1 }]] }
    ];
    var RESULT = {
      civilian: { title: "Голос разума", text: "Вы доверяете людям и умеете договариваться. За столом ваша сила — внимание к деталям и честное слово: если вы убеждены, за вами пойдут.", tip: "Слушайте, кто голосует вместе с мафией: так город и побеждает." },
      sheriff: { title: "Видит насквозь", text: "Вы замечаете то, что другие пропускают, и не боитесь сказать об этом вслух. Логика — ваше оружие, а интуиция — запасной патрон.", tip: "Не спешите раскрываться: шериф живёт дольше, когда о нём не знают." },
      doctor: { title: "Хранитель стола", text: "Вы чувствуете людей и всегда приходите на помощь. Там, где другие спорят, вы спасаете — и именно поэтому вас ценят.", tip: "Защищайте того, кто громче всех ищет мафию: на него охотятся первым." },
      mafia: { title: "Обаятельная тень", text: "Вы улыбаетесь, кивнёте и согласитесь, а потом окажется, что всё шло по вашему плану. Спокойствие — ваш лучший грим.", tip: "Не защищайте напарника слишком рьяно: это выдаёт вас обоих." },
      don: { title: "Режиссёр вечера", text: "Вы ведёте за собой и умеете превратить любой разговор в свою партию. Другие играют роли, а вы пишете сценарий.", tip: "Ищите шерифа по тому, кто слишком уверенно знает правду." },
      maniac: { title: "Сам себе союзник", text: "Вам не нужна команда, чтобы победить. Вы непредсказуемы, а значит, опасны для всех сторон сразу.", tip: "Пусть город и мафия заняты друг другом, пока вы ждёте своего часа." }
    };
    var answers = [], step = 0;

    function swap(html, after) {
      if (hasGsap && !reduce) {
        gsap.to(stage.firstElementChild, { rotationY: -70, opacity: 0, transformPerspective: 1000, duration: .3, ease: "power2.in", onComplete: function () {
          stage.innerHTML = html; if (after) after();
          gsap.fromTo(stage.firstElementChild, { rotationY: 70, opacity: 0, transformPerspective: 1000 }, { rotationY: 0, opacity: 1, duration: .45, ease: "power3.out" });
        } });
      } else { stage.innerHTML = html; if (after) after(); }
    }
    function pips() {
      return '<div class="quiz-pips" aria-hidden="true">' + Q.map(function (_, i) { return '<i class="' + (i < step ? "done" : i === step ? "now" : "") + '"></i>'; }).join("") + "</div>";
    }
    function question() {
      var q = Q[step];
      swap('<div class="quiz-card">' + pips() + '<div class="quiz-count">Вопрос ' + (step + 1) + " из " + Q.length + '</div><h3 class="quiz-q">' + q.q + '</h3><div class="quiz-answers">' +
        q.a.map(function (a, i) { return '<button class="quiz-a" type="button" data-i="' + i + '" data-spark><span class="quiz-l"><b>' + "АБВГ"[i] + "</b></span>" + a[0] + "</button>"; }).join("") +
        "</div>" + (step ? '<button class="quiz-back" type="button">← Назад</button>' : "") + "</div>", function () {
          var first = stage.querySelector(".quiz-a"); if (first) first.focus({ preventScroll: true });
        });
    }
    function result() {
      var score = {};
      answers.forEach(function (ai, qi) { var w = Q[qi].a[ai][1]; Object.keys(w).forEach(function (k) { score[k] = (score[k] || 0) + w[k]; }); });
      var order = ["sheriff", "don", "mafia", "doctor", "maniac", "civilian"];
      var best = order.reduce(function (b, k) { return (score[k] || 0) > (score[b] || 0) ? k : b; }, order[0]);
      var R = ROLES[best], X = RESULT[best];
      try { localStorage.setItem("maski-role", best); } catch (e) { /* хранилище недоступно */ }
      swap('<div class="quiz-result">' +
        '<div class="quiz-story"><img id="quizImg" alt="Карта роли «' + R.name + '» для сторис"><p class="quiz-save-hint">На телефоне: нажмите и удерживайте картинку, чтобы сохранить.</p></div>' +
        '<div class="quiz-res-text"><div class="eyebrow">Ваша роль</div><h3 class="quiz-role">' + R.name + '</h3><p class="quiz-sub">' + X.title + "</p><p>" + X.text + '</p><p class="quiz-tip"><b>Совет за столом:</b> ' + X.tip + "</p>" +
        '<div class="quiz-actions"><button class="btn" type="button" id="quizSave">Сохранить картинку</button><a class="btn ghost" id="quizVk" target="_blank" rel="noopener">Поделиться ВКонтакте</a></div>' +
        '<div class="quiz-actions"><a class="btn ghost" href="#games">Проверить себя за столом</a><button class="quiz-back" type="button" id="quizAgain">Пройти ещё раз</button></div>' +
        '<p class="quiz-msg" id="quizMsg" role="status"></p></div></div>', function () {
          var canvas = storyCanvas(best);
          var url = canvas.toDataURL("image/jpeg", .9);
          document.getElementById("quizImg").src = url;
          var site = location.origin && location.origin.indexOf("http") === 0 ? location.origin + location.pathname : "https://vk.ru/club_maskisnyty";
          document.getElementById("quizVk").href = "https://vk.com/share.php?url=" + encodeURIComponent(site + "#quiz") + "&title=" + encodeURIComponent("Моя роль в «Маски сняты» — " + R.name + ". А ты кто за игровым столом?");
          document.getElementById("quizSave").addEventListener("click", function () { saveImage(canvas, R.name); });
          document.getElementById("quizAgain").addEventListener("click", function () { answers = []; step = 0; question(); });
          if (window.maskiSparks) { var b = document.querySelector(".quiz-role").getBoundingClientRect(); window.maskiSparks(b.left + 40, b.top + 20, 40); }
        });
    }
    function saveImage(canvas, name) {
      var msg = document.getElementById("quizMsg");
      canvas.toBlob(function (blob) {
        if (!blob) { msg.textContent = "Не удалось подготовить картинку. Сохраните её долгим нажатием."; return; }
        var file = typeof File === "function" ? new File([blob], "maski-snyaty-rol.jpg", { type: "image/jpeg" }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "Моя роль — " + name }).catch(function () { });
          return;
        }
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "maski-snyaty-rol.jpg";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        msg.textContent = "Если загрузка не началась, нажмите на картинку правой кнопкой и выберите «Сохранить».";
      }, "image/jpeg", .92);
    }
    // Картинка для сторис 1080×1920 в фирменном стиле
    function storyCanvas(key) {
      var R = ROLES[key], X = RESULT[key];
      var c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
      var g = c.getContext("2d");
      var bg = g.createRadialGradient(540, 760, 80, 540, 900, 1250);
      bg.addColorStop(0, "#2a1d10"); bg.addColorStop(.55, "#120c07"); bg.addColorStop(1, INK);
      g.fillStyle = bg; g.fillRect(0, 0, 1080, 1920);
      // световой луч сверху
      var beam = g.createLinearGradient(0, 0, 0, 1100);
      beam.addColorStop(0, "rgba(255,200,130,.16)"); beam.addColorStop(1, "rgba(255,200,130,0)");
      g.fillStyle = beam; g.beginPath(); g.moveTo(470, 0); g.lineTo(610, 0); g.lineTo(900, 1100); g.lineTo(180, 1100); g.closePath(); g.fill();
      // золотая пыль
      for (var i = 0; i < 140; i++) { g.globalAlpha = Math.random() * .5; g.fillStyle = GOLD_HI; var r = Math.random() * 2.4 + .4; g.beginPath(); g.arc(Math.random() * 1080, Math.random() * 1920, r, 0, 6.28); g.fill(); }
      g.globalAlpha = 1;
      // рамка с ромбами
      g.strokeStyle = GOLD; g.lineWidth = 3; g.strokeRect(54, 54, 972, 1812); g.lineWidth = 1.2; g.strokeRect(74, 74, 932, 1772);
      [[74, 74], [1006, 74], [74, 1846], [1006, 1846]].forEach(function (p) { g.save(); g.translate(p[0], p[1]); g.rotate(Math.PI / 4); g.fillStyle = GOLD; g.fillRect(-9, -9, 18, 18); g.restore(); });
      g.textAlign = "center"; g.textBaseline = "alphabetic";
      // шапка
      if (LOGO_IMG) { var lh = 120, lw = lh * LOGO_IMG.width / LOGO_IMG.height; g.drawImage(LOGO_IMG, 540 - lw / 2, 150, lw, lh); }
      g.fillStyle = PAPER; g.font = '300 40px "Jost", sans-serif'; g.fillText("М А С К И   ", 470, 340);
      g.fillStyle = GOLD_HI; g.fillText("С Н Я Т Ы", 680, 340);
      g.fillStyle = "#a59b8c"; g.font = '300 30px "Jost", sans-serif'; g.fillText("м о я   р о л ь   з а   и г р о в ы м   с т о л о м", 540, 470);
      // карта роли
      var cw = 520, ch = 760, cx = 540 - cw / 2, cy = 540;
      g.save(); g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 60; g.shadowOffsetY = 30;
      g.drawImage(drawFront(key), cx, cy, cw, ch); g.restore();
      g.strokeStyle = "rgba(228,192,138,.6)"; g.lineWidth = 2; g.strokeRect(cx, cy, cw, ch);
      // текст
      g.fillStyle = PAPER; g.font = '700 110px "Cormorant Garamond", serif'; g.fillText(R.name.toUpperCase(), 540, 1450);
      g.fillStyle = GOLD_HI; g.font = 'italic 500 62px "Cormorant Garamond", serif'; g.fillText(X.title, 540, 1530);
      g.fillStyle = GOLD; g.fillRect(440, 1580, 200, 2);
      g.save(); g.translate(540, 1581); g.rotate(Math.PI / 4); g.fillRect(-7, -7, 14, 14); g.restore();
      g.fillStyle = PAPER; g.font = '300 36px "Jost", sans-serif'; g.fillText("А ты кто? Пройди тест", 540, 1660);
      g.fillStyle = GOLD_HI; g.font = '400 34px "Jost", sans-serif'; g.fillText("vk.ru/club_maskisnyty", 540, 1720);
      g.fillStyle = "#a59b8c"; g.font = '300 28px "Jost", sans-serif'; g.fillText("и г р а .   п о з н а н и е .   т р а н с ф о р м а ц и я", 540, 1800);
      return c;
    }

    stage.addEventListener("click", function (e) {
      var a = e.target.closest(".quiz-a");
      if (a) { answers[step] = +a.dataset.i; step++; if (step < Q.length) question(); else result(); return; }
      if (e.target.closest("#quizStart")) { answers = []; step = 0; question(); return; }
      if (e.target.closest(".quiz-back") && !e.target.closest("#quizAgain") && step > 0) { step--; answers.length = step; question(); }
    });
  })();

  /* ---------- досье игрока: статистика, форма, маски-достижения ---------- */
  var ACH_ICONS = {
    eye: "M10 50 Q50 16 90 50 Q50 84 10 50 Z M50 37 A13 13 0 1 0 50 63 A13 13 0 1 0 50 37 Z",
    flame: "M50 12 C64 32 76 42 76 62 A26 26 0 0 1 24 62 C24 46 34 40 39 27 C44 40 50 45 55 40 C58 32 54 22 50 12 Z",
    chair: "M32 14 V86 M32 52 H70 V86 M32 14 H66 V52",
    laurel: "M50 88 C28 78 20 56 25 28 M50 88 C72 78 80 56 75 28 M29 44 L19 40 M27 59 L17 58 M34 72 L25 77 M71 44 L81 40 M73 59 L83 58 M66 72 L75 77",
    two: "M18 86 V40 L29 26 L40 40 V86 M60 86 V34 L71 18 L82 34 V86 M10 86 H90",
    hand: "M34 86 V30 A6 6 0 0 1 46 30 V48 M46 26 A6 6 0 0 1 58 26 V48 M58 30 A6 6 0 0 1 70 30 V52 M34 56 L26 46 A6 6 0 0 0 16 54 L34 80 M70 52 V66 C70 78 62 86 50 86 H34",
    ticket: "M14 30 H86 V43 A7 7 0 0 0 86 57 V70 H14 V57 A7 7 0 0 0 14 43 Z M62 30 V70",
    cup: "M30 14 H70 V36 A20 20 0 0 1 30 36 Z M30 20 H16 V28 A12 12 0 0 0 30 40 M70 20 H84 V28 A12 12 0 0 1 70 40 M50 56 V70 M34 86 H66 L62 70 H38 Z"
  };
  function achPath(icon) { return ACH_ICONS[icon] || (ICONS[icon] && ICONS[icon].main) || ICONS.mask.main; }
  function achSVG(icon) { return '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="' + achPath(icon) + '"/></svg>'; }
  var ROLE_KEY = { civ: "civilian", sher: "sheriff", doc: "doctor", lover: "civilian", maf: "mafia", don: "don", maniac: "maniac" };
  var ROLE_LABEL = { civ: "Мирный", sher: "Шериф", doc: "Доктор", lover: "Любовница", maf: "Мафия", don: "Дон", maniac: "Маньяк" };
  var MON_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var MON_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  function num(x) { return String(Math.round(x * 100) / 100).replace(".", ","); }

  var dossier = document.getElementById("dossier"), dPanel = document.getElementById("dossierPanel"), dLast = null, dOpenedByHash = false, dProfile = null;

  function formChart(series) {
    if (!series.length) return '<p class="dos-empty">Пока нет игр в рейтинге.</p>';
    var vals = series.map(function (m) { return (m.msk ? m.msk.total : 0) + (m.spb ? m.spb.total : 0); });
    var max = Math.max.apply(null, vals.concat([1])), min = Math.min.apply(null, vals.concat([0]));
    var W = 640, H = 220, padT = 30, padB = 34, plotH = H - padT - padB, slot = W / series.length, bw = Math.min(24, slot * .55);
    var y0 = padT + plotH * (max / (max - min || 1));
    var best = vals.indexOf(max), lastI = vals.length - 1;
    var bars = series.map(function (m, i) {
      var v = vals[i], h = Math.abs(v) / (max - min || 1) * plotH, x = slot * i + (slot - bw) / 2;
      var y = v >= 0 ? y0 - h : y0, r = Math.min(4, h / 2);
      var path = v >= 0
        ? "M" + x + " " + y0 + " V" + (y + r) + " Q" + x + " " + y + " " + (x + r) + " " + y + " H" + (x + bw - r) + " Q" + (x + bw) + " " + y + " " + (x + bw) + " " + (y + r) + " V" + y0 + " Z"
        : "M" + x + " " + y0 + " V" + (y0 + h - r) + " Q" + x + " " + (y0 + h) + " " + (x + r) + " " + (y0 + h) + " H" + (x + bw - r) + " Q" + (x + bw) + " " + (y0 + h) + " " + (x + bw) + " " + (y0 + h - r) + " V" + y0 + " Z";
      var mm = +m.month.slice(5, 7) - 1;
      var tip = MONTHS_NOM[mm] + " " + m.month.slice(0, 4) + ": " + num(v) + " очк." +
        (m.msk ? " · московская: " + (m.msk.place ? m.msk.place + "-е место" : "вне рейтинга") : "") + (m.spb ? " · питерская: " + (m.spb.place ? m.spb.place + "-е место" : "вне рейтинга") : "");
      var label = (i === best || i === lastI) && h > 0 ? '<text class="dos-val" x="' + (x + bw / 2) + '" y="' + (v >= 0 ? y - 8 : y0 + h + 16) + '">' + num(v) + "</text>" : "";
      return '<g class="dos-bar" tabindex="0" data-tip="' + tip + '"><rect class="hit" x="' + slot * i + '" y="0" width="' + slot + '" height="' + H + '"></rect><path d="' + path + '"></path>' + label +
        '<text class="dos-mon" x="' + (x + bw / 2) + '" y="' + (H - 10) + '">' + MON_SHORT[mm] + "</text></g>";
    }).join("");
    return '<div class="dos-chart"><svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Очки по месяцам"><line class="base" x1="0" x2="' + W + '" y1="' + y0 + '" y2="' + y0 + '"></line>' + bars + '</svg><div class="dos-tip" hidden></div></div>';
  }

  function renderDossier(p) {
    dProfile = p;
    var t = p.totals, fav = p.favoriteRole;
    var since = p.player.since ? "в клубе с " + (+p.player.since.slice(8, 10)) + " " + MON_GEN[+p.player.since.slice(5, 7) - 1] + " " + p.player.since.slice(0, 4) : "";
    var roles = p.roles.map(function (r) {
      return '<li><span class="dos-role-ico">' + iconSVG(ICONS[ROLES[ROLE_KEY[r.role]].icon] ? ROLES[ROLE_KEY[r.role]].icon : "mask") + "</span><b>" + ROLE_LABEL[r.role] +
        '</b><span class="dos-role-n">' + r.games + " " + plural(r.games, "игра", "игры", "игр") + '</span><span class="dos-meter" role="img" aria-label="Победы: ' + r.winRate + '%"><i style="width:' + r.winRate + '%"></i></span><span class="dos-pct">' + r.winRate + "%</span></li>";
    }).join("");
    var ach = p.achievements.map(function (a) {
      return '<li class="' + (a.earned ? "got" : "") + '" title="' + a.text + '"><span class="medal">' + achSVG(a.icon) + "</span><b>" + a.name + "</b><small>" + a.text + "</small>" +
        (a.earned ? '<em class="ach-ok">получено</em>' : '<span class="ach-prog"><i style="width:' + Math.round(a.progress / a.target * 100) + '%"></i></span><em>' + a.progress + " / " + a.target + "</em>") + "</li>";
    }).join("");
    var recent = p.recent.map(function (g) {
      return "<tr><td>" + (+g.date.slice(8, 10)) + " " + MON_SHORT[+g.date.slice(5, 7) - 1] + "</td><td>" + (g.format === "msk" ? "Московская" : "Питерская") + "</td><td>" + ROLE_LABEL[g.role] +
        '</td><td class="' + (g.won ? "win" : "") + '">' + (g.won ? "победа" : "поражение") + '</td><td class="pts">' + num(g.points) + "</td></tr>";
    }).join("");
    dPanel.innerHTML =
      '<button class="dos-close" type="button" aria-label="Закрыть досье">✕</button>' +
      '<header class="dos-head"><div class="dos-mono" aria-hidden="true"><span>' + escapeHTML(String(p.player.nick).slice(0, 1).toUpperCase()) + '</span></div><div><div class="eyebrow">Досье игрока</div><h2 id="dosNick">' + escapeHTML(p.player.nick) + "</h2><p>" + since +
      (fav ? ' · любимая роль: <b>' + ROLE_LABEL[fav].toLowerCase() + "</b>" : "") + "</p></div></header>" +
      '<div class="dos-tiles"><div><b>' + t.games + "</b><span>" + plural(t.games, "игра", "игры", "игр") + "</span></div><div><b>" + t.winRate + "%</b><span>побед</span></div><div><b>" + num(t.points) +
      "</b><span>очков всего</span></div><div><b>" + (t.bestPlace ? t.bestPlace + "-е" : "—") + "</b><span>лучшее место</span></div><div><b>" + t.bestStreak + "</b><span>побед подряд</span></div></div>" +
      '<section class="dos-sec"><h3>Маски-достижения <span>' + p.earnedCount + " из " + p.achievements.length + '</span></h3><ul class="dos-ach">' + ach + "</ul></section>" +
      '<section class="dos-sec"><h3>Форма по месяцам <span>очки за месяц, оба формата</span></h3>' + formChart(p.series) + "</section>" +
      '<section class="dos-sec"><h3>Роли <span>доля побед</span></h3>' + (roles ? '<ul class="dos-roles">' + roles + "</ul>" : '<p class="dos-empty">Игр пока нет.</p>') + "</section>" +
      '<section class="dos-sec"><h3>Последние игры</h3>' + (recent ? '<div class="tbl-wrap"><table class="rt dos-games"><thead><tr><th>Дата</th><th>Формат</th><th>Роль</th><th>Итог</th><th>Очки</th></tr></thead><tbody>' + recent + "</tbody></table></div>" : '<p class="dos-empty">Игр пока нет.</p>') + "</section>" +
      '<div class="dos-share"><button class="btn" type="button" id="dosCard">Карточка для соцсетей</button><div class="dos-card-out" id="dosCardOut"></div></div>';
    bindChartTips();
  }

  function bindChartTips() {
    var chart = dPanel.querySelector(".dos-chart"); if (!chart) return;
    var tip = chart.querySelector(".dos-tip");
    function show(g) {
      tip.textContent = g.getAttribute("data-tip"); tip.hidden = false;
      var b = g.querySelector("path").getBoundingClientRect(), c = chart.getBoundingClientRect();
      tip.style.left = Math.max(0, Math.min(c.width - tip.offsetWidth, b.left - c.left + b.width / 2 - tip.offsetWidth / 2)) + "px";
      tip.style.top = Math.max(0, b.top - c.top - tip.offsetHeight - 10) + "px";
      chart.querySelectorAll(".dos-bar").forEach(function (x) { x.classList.toggle("dim", x !== g); });
    }
    function hide() { tip.hidden = true; chart.querySelectorAll(".dos-bar").forEach(function (x) { x.classList.remove("dim"); }); }
    chart.querySelectorAll(".dos-bar").forEach(function (g) {
      g.addEventListener("pointerenter", function () { show(g); });
      g.addEventListener("focus", function () { show(g); });
      g.addEventListener("blur", hide);
    });
    chart.addEventListener("pointerleave", hide);
  }

  function openPlayer(id, fromHash) {
    if (!id) return;
    dLast = document.activeElement;
    dossier.hidden = false; document.body.style.overflow = "hidden";
    dPanel.innerHTML = '<p class="dos-empty">Открываем досье…</p>';
    if (hasGsap && !reduce) gsap.fromTo(dPanel, { xPercent: 100 }, { xPercent: 0, duration: .55, ease: "power3.out" });
    if (!fromHash) { dOpenedByHash = true; history.pushState(null, "", "#player-" + id); }
    api("GET", "/api/players/" + id).then(function (p) { renderDossier(p); dPanel.focus({ preventScroll: true }); })
      .catch(function (ex) { dPanel.innerHTML = '<button class="dos-close" type="button" aria-label="Закрыть">✕</button><p class="dos-empty">' + escapeHTML(ex.message) + "</p>"; });
  }
  function closePlayer(viaHistory) {
    if (dossier.hidden) return;
    dossier.hidden = true; document.body.style.overflow = "";
    if (!viaHistory && /^#player-\d+$/.test(location.hash)) {
      if (dOpenedByHash) history.back(); else history.replaceState(null, "", location.pathname + location.search);
    }
    dOpenedByHash = false;
    if (dLast && dLast.focus) dLast.focus({ preventScroll: true });
  }
  dossier.addEventListener("click", function (e) {
    if (e.target === dossier || e.target.closest(".dos-close")) closePlayer(false);
    if (e.target.closest("#dosCard")) shareCard();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !dossier.hidden) closePlayer(false); });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-player]"); if (!b) return;
    e.preventDefault(); openPlayer(+b.dataset.player, false);
  });
  window.addEventListener("popstate", function () {
    var m = /^#player-(\d+)$/.exec(location.hash);
    if (m) { if (dossier.hidden) openPlayer(+m[1], true); } else closePlayer(true);
  });
  (function () { var m = /^#player-(\d+)$/.exec(location.hash); if (m) setTimeout(function () { openPlayer(+m[1], true); }, 300); })();

  // Карточка игрока 1080×1350 для постов и сторис
  function shareCard() {
    var p = dProfile; if (!p) return;
    var t = p.totals, c = document.createElement("canvas"); c.width = 1080; c.height = 1350;
    var g = c.getContext("2d");
    var bg = g.createRadialGradient(540, 420, 60, 540, 600, 1000);
    bg.addColorStop(0, "#2a1d10"); bg.addColorStop(.6, "#110b06"); bg.addColorStop(1, INK);
    g.fillStyle = bg; g.fillRect(0, 0, 1080, 1350);
    for (var i = 0; i < 110; i++) { g.globalAlpha = Math.random() * .45; g.fillStyle = GOLD_HI; g.beginPath(); g.arc(Math.random() * 1080, Math.random() * 1350, Math.random() * 2.2 + .4, 0, 6.28); g.fill(); }
    g.globalAlpha = 1;
    g.strokeStyle = GOLD; g.lineWidth = 3; g.strokeRect(48, 48, 984, 1254); g.lineWidth = 1.2; g.strokeRect(66, 66, 948, 1218);
    [[66, 66], [1014, 66], [66, 1284], [1014, 1284]].forEach(function (q) { g.save(); g.translate(q[0], q[1]); g.rotate(Math.PI / 4); g.fillStyle = GOLD; g.fillRect(-8, -8, 16, 16); g.restore(); });
    g.textAlign = "center";
    if (LOGO_IMG) { var lh = 96, lw = lh * LOGO_IMG.width / LOGO_IMG.height; g.drawImage(LOGO_IMG, 540 - lw / 2, 120, lw, lh); }
    g.fillStyle = "#a59b8c"; g.font = '300 30px "Jost", sans-serif'; g.fillText("д о с ь е   и г р о к а", 540, 280);
    var nick = String(p.player.nick).toUpperCase(), size = 130;
    do { g.font = '700 ' + size + 'px "Cormorant Garamond", serif'; size -= 4; } while (g.measureText(nick).width > 880 && size > 50);
    g.fillStyle = PAPER; g.fillText(nick, 540, 420);
    if (p.favoriteRole) { g.fillStyle = GOLD_HI; g.font = 'italic 500 50px "Cormorant Garamond", serif'; g.fillText("любимая роль — " + ROLE_LABEL[p.favoriteRole].toLowerCase(), 540, 490); }
    var tiles = [[String(t.games), plural(t.games, "игра", "игры", "игр")], [t.winRate + "%", "побед"], [num(t.points), "очков"], [t.bestPlace ? t.bestPlace + "-е" : "—", "лучшее место"]];
    tiles.forEach(function (tl, k) {
      var x = 165 + k * 250;
      g.fillStyle = GOLD_HI; g.font = '600 76px "Cormorant Garamond", serif'; g.fillText(tl[0], x, 650);
      g.fillStyle = "#a59b8c"; g.font = '300 26px "Jost", sans-serif'; g.fillText(tl[1], x, 694);
      if (k) { g.fillStyle = "rgba(201,154,91,.35)"; g.fillRect(x - 125, 590, 1, 110); }
    });
    var got = p.achievements.filter(function (a) { return a.earned; }).slice(0, 5);
    g.fillStyle = PAPER; g.font = '300 30px "Jost", sans-serif';
    g.fillText(got.length ? "м а с к и - д о с т и ж е н и я :   " + p.earnedCount + "  и з  " + p.achievements.length : "п е р в ы е   м а с к и   е щ ё   в п е р е д и", 540, 800);
    var startX = 540 - (got.length - 1) * 95;
    got.forEach(function (a, k) {
      var x = startX + k * 190, y = 920;
      g.beginPath(); g.arc(x, y, 64, 0, 6.28); g.fillStyle = "#1b130b"; g.fill(); g.strokeStyle = GOLD; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.arc(x, y, 54, 0, 6.28); g.lineWidth = 1; g.stroke();
      g.save(); g.translate(x - 32, y - 32); g.scale(.64, .64); g.strokeStyle = GOLD_HI; g.lineWidth = 6; g.lineJoin = "round"; g.lineCap = "round"; g.stroke(new Path2D(achPath(a.icon))); g.restore();
      g.fillStyle = "#cfc4b2"; g.font = '400 22px "Jost", sans-serif'; g.fillText(a.name, x, y + 104);
    });
    g.fillStyle = GOLD; g.fillRect(440, 1110, 200, 2);
    g.save(); g.translate(540, 1111); g.rotate(Math.PI / 4); g.fillRect(-7, -7, 14, 14); g.restore();
    g.fillStyle = PAPER; g.font = '300 34px "Jost", sans-serif'; g.fillText("М А С К И   С Н Я Т Ы  ·  м а ф и я ,  С м о л е н с к", 540, 1190);
    g.fillStyle = GOLD_HI; g.font = '400 30px "Jost", sans-serif'; g.fillText("vk.ru/club_maskisnyty", 540, 1240);
    var out = document.getElementById("dosCardOut");
    out.innerHTML = '<img alt="Карточка игрока ' + escapeHTML(p.player.nick) + '" src="' + c.toDataURL("image/jpeg", .9) + '"><p>Нажмите и удерживайте картинку на телефоне или сохраните её правой кнопкой мыши.</p>';
    if (window.maskiSparks) { var bb = out.getBoundingClientRect(); window.maskiSparks(bb.left + bb.width / 2, bb.top + 40, 36); }
  }

  /* ---------- ночь по расписанию клуба ---------- */
  (function clubClock() {
    function hourInClub() {
      try { return +new Date().toLocaleString("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", hour12: false }) % 24; }
      catch (e) { return new Date().getHours(); }
    }
    var eyebrow = document.getElementById("heroEyebrow"), dayText = eyebrow ? eyebrow.textContent : "";
    var last = null;
    function once(key) {
      try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, "1"); } catch (e) { /* без хранилища показываем всегда */ }
      return true;
    }
    function apply(first) {
      var h = hourInClub(), state = h >= 23 || h < 6 ? "late" : h < 11 ? "morning" : "day";
      if (state === last) return;
      var changed = last !== null; last = state;
      root.classList.toggle("late", state === "late");
      if (eyebrow) eyebrow.textContent = state === "late" ? "Город засыпает · ведущий будит мафию" : state === "morning" ? "Город просыпается · доброе утро" : dayText;
      if (state === "late" && (changed || once("maski-late"))) setTimeout(function () { toast("Город засыпает…"); }, first ? 1600 : 0);
      if (state === "morning" && (changed || once("maski-morning"))) setTimeout(function () { toast("Город просыпается"); }, first ? 1600 : 0);
    }
    apply(true);
    setInterval(function () { apply(false); }, 60000);
  })();

  /* ---------- пасхалка: спрятанная маска ---------- */
  (function easterEgg() {
    var box = document.getElementById("secret"), card = document.getElementById("secretCard");
    if (!box) return;
    var CODE = "Кто ты", lastFocus = null;
    function open() {
      if (!box.hidden) return;
      lastFocus = document.activeElement;
      box.hidden = false; document.body.style.overflow = "hidden";
      try { localStorage.setItem("maski-secret", "1"); } catch (e) { /* не важно */ }
      if (hasGsap && !reduce) gsap.fromTo(card, { rotationY: 180, scale: .6, opacity: 0, transformPerspective: 1200 }, { rotationY: 0, scale: 1, opacity: 1, duration: 1.2, ease: "power3.out" });
      setTimeout(function () {
        if (window.maskiSparks) { var b = card.getBoundingClientRect(); window.maskiSparks(b.left + b.width / 2, b.top + 60, 60); window.maskiSparks(b.left + 30, b.bottom - 40, 24); window.maskiSparks(b.right - 30, b.bottom - 40, 24); }
      }, reduce ? 0 : 700);
      document.getElementById("promoCopy").focus({ preventScroll: true });
    }
    function close() { box.hidden = true; document.body.style.overflow = ""; if (lastFocus) lastFocus.focus({ preventScroll: true }); }
    document.getElementById("secretClose").addEventListener("click", close);
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) close(); });
    document.getElementById("promoCopy").addEventListener("click", function () {
      var msg = document.getElementById("promoMsg");
      function fallback() {
        var r = document.createRange(); r.selectNodeContents(document.getElementById("promo"));
        var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        msg.textContent = "Промокод выделен — скопируйте его.";
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(CODE).then(function () { msg.textContent = "Промокод скопирован."; }, fallback);
      else fallback();
    });
    document.getElementById("promoBook").addEventListener("click", function () {
      close();
      var note = document.getElementById("f-note");
      if (note) { note.value = "Промокод: " + CODE; }
    });

    // 1) набрать «маска» (или maska) на клавиатуре
    var typed = "";
    document.addEventListener("keydown", function (e) {
      if (e.target.closest && e.target.closest("input, textarea, select")) return;
      if (!e.key || e.key.length !== 1) return;
      typed = (typed + e.key.toLowerCase()).slice(-8);
      if (/маска$|maska$|vfcrf$/.test(typed)) { typed = ""; open(); }
    });
    // 2) три быстрых нажатия на логотип в шапке
    var logo = document.querySelector("header.top .logo"), taps = [];
    if (logo) logo.addEventListener("click", function (e) {
      var now = Date.now();
      taps = taps.filter(function (t) { return now - t < 900; }); taps.push(now);
      if (taps.length >= 3) { e.preventDefault(); taps = []; open(); }
    });
  })();

  /* ---------- свет свечи вокруг курсора ---------- */
  (function candle() {
    if (reduce || !matchMedia("(pointer: fine)").matches) return;
    var el = document.createElement("div");
    el.className = "candle"; el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    var x = innerWidth / 2, y = innerHeight / 3, lx = x, ly = y, shown = false, t0 = 0;
    addEventListener("pointermove", function (e) {
      x = e.clientX; y = e.clientY;
      if (!shown) { shown = true; el.classList.add("on"); }
    }, { passive: true });
    document.addEventListener("pointerleave", function () { shown = false; el.classList.remove("on"); });
    (function loop(ts) {
      lx += (x - lx) * .14; ly += (y - ly) * .14;
      // едва заметное дрожание пламени
      var flick = 1 + Math.sin(ts / 170) * .015 + Math.sin(ts / 53 + t0) * .01;
      el.style.setProperty("--mx", lx.toFixed(1) + "px");
      el.style.setProperty("--my", ly.toFixed(1) + "px");
      el.style.setProperty("--r", (520 * flick).toFixed(0) + "px");
      requestAnimationFrame(loop);
    })(0);
  })();

  /* ---------- золотые искры при клике ---------- */
  (function sparks() {
    if (reduce) return;
    var cv = document.createElement("canvas"), g = cv.getContext("2d"), parts = [], running = false, dpr = 1;
    cv.className = "sparks"; cv.setAttribute("aria-hidden", "true");
    document.body.appendChild(cv);
    function size() { dpr = Math.min(devicePixelRatio || 1, 2); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
    size(); addEventListener("resize", size);
    var COLORS = ["#e4c08a", "#c99a5b", "#f6e3bd", "#b07a3a"];
    function burst(x, y, n) {
      for (var i = 0; i < n; i++) {
        var a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.4, sp = 2 + Math.random() * 5;
        parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 40 + Math.random() * 40, s: 1.2 + Math.random() * 2.4, c: COLORS[i % COLORS.length], rot: Math.random() * 6.28 });
      }
      if (!running) { running = true; requestAnimationFrame(step); }
    }
    function step() {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, innerWidth, innerHeight);
      g.globalCompositeOperation = "lighter";
      parts = parts.filter(function (p) { return p.life < p.max; });
      parts.forEach(function (p) {
        p.life++; p.vy += .12; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += .2;
        var k = 1 - p.life / p.max;
        g.globalAlpha = k;
        g.fillStyle = p.c;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillRect(-p.s, -p.s, p.s * 2, p.s * 2);
        g.restore();
      });
      g.globalAlpha = 1;
      if (parts.length) requestAnimationFrame(step); else { running = false; g.clearRect(0, 0, innerWidth, innerHeight); }
    }
    document.addEventListener("click", function (e) {
      var t = e.target.closest(".btn, .chip, .mode button, [data-spark]");
      if (!t || t.disabled) return;
      var x = e.clientX, y = e.clientY;
      if (!x && !y) { var b = t.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top + b.height / 2; }
      burst(x, y, t.classList.contains("btn") ? 26 : 14);
    });
    window.maskiSparks = burst;
  })();

  /* ---------- scroll reveals ---------- */
  if (hasGsap && window.ScrollTrigger && !reduce) {
    gsap.from(".hero h1 .ln > span", { yPercent: 100, duration: 1.1, stagger: .12, ease: "power4.out", delay: .1 });
    gsap.from(".hero-sub, .hero-cta, .next", { y: 24, duration: 1, stagger: .1, ease: "power3.out", delay: .4 });
    gsap.utils.toArray("[data-reveal]").forEach(function (el) {
      gsap.from(el, { y: 50, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%" } });
    });
    gsap.from(".rcard", { y: 80, rotationX: -25, transformPerspective: 900, duration: 1, stagger: .08, ease: "power3.out", scrollTrigger: { trigger: "#deck", start: "top 85%" } });
    gsap.from(".plan", { y: 60, duration: .9, stagger: .08, ease: "power3.out", scrollTrigger: { trigger: ".plans", start: "top 85%" } });
    if (getComputedStyle(document.getElementById("tlLine")).display !== "none") {
      gsap.fromTo("#tlLine", { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { trigger: "#timeline", start: "top 80%", end: "bottom 55%", scrub: true } });
    }
    gsap.to(".mega span", { yPercent: function (i) { return (i % 2 ? -1 : 1) * 12; }, ease: "none", scrollTrigger: { trigger: "footer", start: "top bottom", end: "bottom bottom", scrub: true } });
  }

  /* ---------- WebGL scene ---------- */
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var loads = Promise.all([
      document.fonts.load('700 40px "Cormorant Garamond"'), document.fonts.load('italic 500 30px "Cormorant Garamond"'),
      document.fonts.load('300 20px "Jost"'), document.fonts.load('500 20px "Jost"'),
      new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { LOGO_IMG = img; resolve(); };
        img.onerror = function () { resolve(); };
        img.src = LOGO_SRC;
      }),
      new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { MASK_IMG = img; resolve(); };
        img.onerror = function () { resolve(); };
        img.src = MASK_SRC;
      })
    ]).catch(function () {});
    return Promise.race([loads, new Promise(function (r) { setTimeout(r, 1800); })]);
  }

  function drawLogo(g, cx, cy, h) {
    if (!LOGO_IMG) return;
    var w = h * LOGO_IMG.width / LOGO_IMG.height;
    g.drawImage(LOGO_IMG, cx - w / 2, cy - h / 2, w, h);
  }
  function frame(g, edge) {
    g.strokeStyle = edge; g.lineWidth = 4; g.strokeRect(24, 24, 464, 720);
    g.lineWidth = 1.2; g.strokeRect(38, 38, 436, 692);
    // уголки-ромбы, как на афишах клуба
    [[38, 38], [474, 38], [38, 730], [474, 730]].forEach(function (p) {
      g.save(); g.translate(p[0], p[1]); g.rotate(Math.PI / 4); g.fillStyle = edge; g.fillRect(-5, -5, 10, 10); g.restore();
    });
  }
  function drawFront(key) {
    var R = ROLES[key], dark = R.team === "maf", bg = dark ? INK : PAPER, fg = dark ? PAPER : INK;
    var c = document.createElement("canvas"); c.width = 512; c.height = 768;
    var g = c.getContext("2d");
    g.fillStyle = bg; g.fillRect(0, 0, 512, 768);
    frame(g, GOLD);
    g.fillStyle = GOLD; g.textBaseline = "top";
    g.font = '500 20px "Jost", sans-serif';
    g.textAlign = "left"; g.fillText(R.teamLabel.toUpperCase().split("").join(" "), 62, 66);
    g.textAlign = "right"; g.fillText(R.count, 450, 66);
    g.save(); g.translate(256 - 130, 320 - 130); g.scale(2.6, 2.6);
    g.fillStyle = GOLD; g.fill(new Path2D(ICONS[R.icon].main));
    if (ICONS[R.icon].cut) { g.fillStyle = bg; g.fill(new Path2D(ICONS[R.icon].cut)); }
    g.restore();
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "alphabetic";
    var size = 66, txt = R.name.toUpperCase();
    do { g.font = '700 ' + size + 'px "Cormorant Garamond", serif'; size -= 2; } while (g.measureText(txt).width > 400 && size > 26);
    g.fillText(txt, 256, 590);
    g.fillStyle = GOLD;
    g.font = 'italic 500 34px "Cormorant Garamond", serif'; g.fillText(R.tag, 256, 638);
    g.fillRect(206, 668, 100, 1);
    g.font = '300 15px "Jost", sans-serif'; g.fillText("М А С К И   С Н Я Т Ы", 256, 712);
    return c;
  }
  function drawBack() {
    var c = document.createElement("canvas"); c.width = 512; c.height = 768;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(256, 340, 40, 256, 384, 520);
    grad.addColorStop(0, "#1d150d"); grad.addColorStop(1, INK);
    g.fillStyle = grad; g.fillRect(0, 0, 512, 768);
    g.strokeStyle = "rgba(201,154,91,0.12)"; g.lineWidth = 1.2;
    for (var i = -768; i < 512 + 768; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 768, 768); g.stroke();
      g.beginPath(); g.moveTo(i, 768); g.lineTo(i + 768, 0); g.stroke();
    }
    frame(g, GOLD);
    g.beginPath(); g.arc(256, 350, 132, 0, Math.PI * 2); g.fillStyle = INK; g.fill(); g.strokeStyle = GOLD; g.lineWidth = 2.5; g.stroke();
    g.beginPath(); g.arc(256, 350, 118, 0, Math.PI * 2); g.lineWidth = 1; g.stroke();
    if (LOGO_IMG) drawLogo(g, 256, 350, 190);
    g.fillStyle = PAPER; g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.font = '300 30px "Jost", sans-serif'; g.fillText("М А С К И", 256, 576);
    g.fillStyle = GOLD_HI; g.fillText("С Н Я Т Ы", 256, 616);
    g.fillStyle = GOLD; g.fillRect(186, 640, 140, 1);
    g.save(); g.translate(256, 640); g.rotate(Math.PI / 4); g.fillRect(-4, -4, 8, 8); g.restore();
    g.font = '300 13px "Jost", sans-serif'; g.fillText("б о л ь ш е   ч е м   и г р а", 256, 676);
    return c;
  }

  // Логотип делится на два слоя: белая маска (снимается) и золотой профиль (остаётся — лицо под маской)
  function maskLayers(img) {
    var w = img.width, h = img.height;
    var src = document.createElement("canvas"); src.width = w; src.height = h;
    var sg = src.getContext("2d"); sg.drawImage(img, 0, 0);
    var data = sg.getImageData(0, 0, w, h).data;
    function layer(pick, rgb) {
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      var g = c.getContext("2d"), out = g.createImageData(w, h), o = out.data;
      for (var i = 0; i < data.length; i += 4) {
        var a = pick(data[i], data[i + 1], data[i + 2]);
        o[i] = rgb[0]; o[i + 1] = rgb[1]; o[i + 2] = rgb[2]; o[i + 3] = a;
      }
      g.putImageData(out, 0, 0);
      return c;
    }
    function clamp(x) { return x < 0 ? 0 : x > 255 ? 255 : x; }
    var white = layer(function (r, g, b) { var warm = r - b; return warm > 40 ? 0 : clamp((Math.min(r, g, b) - 40) * 1.9); }, [246, 239, 227]);
    var gold = layer(function (r, g, b) { var warm = r - b; return clamp((warm - 30) * 4) * (r > 70 ? 1 : 0); }, [214, 164, 96]);
    return { white: white, gold: gold, aspect: h / w };
  }

  function initScene() {
    var hero = document.getElementById("hero"), canvas = document.getElementById("scene");
    if (!window.THREE) { hero.classList.add("no-gl"); return; }
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" }); }
    catch (e) { hero.classList.add("no-gl"); canvas.style.display = "none"; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(INK);
    scene.fog = new THREE.Fog(INK, 8, 19);
    var camera = new THREE.PerspectiveCamera(36, 1, .1, 60);
    camera.position.set(0, 0, 11);

    var ambient = new THREE.AmbientLight(0xffe2b8, .34); scene.add(ambient);
    var spot = new THREE.SpotLight(0xffcf8f, 2.6, 30, Math.PI / 6.5, .55, 1);
    spot.position.set(0, 9, 3); scene.add(spot); scene.add(spot.target);
    var pointL = new THREE.PointLight(0xffb866, 1.1, 14); pointL.position.set(0, 0, 4); scene.add(pointL);

    var pivot = new THREE.Group(); scene.add(pivot);
    var ring = new THREE.Group(); ring.rotation.x = .2; ring.rotation.z = -.1; pivot.add(ring);

    var cone = new THREE.Mesh(
      new THREE.CylinderGeometry(.15, 3.4, 11, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc07a, transparent: true, opacity: .05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    cone.position.set(0, 3.2, 0); pivot.add(cone);

    var aniso = renderer.capabilities.getMaxAnisotropy();
    function texFrom(c) { var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = aniso; return t; }
    var backMat = new THREE.MeshStandardMaterial({ map: texFrom(drawBack()), roughness: .42, metalness: .2 });
    var edgeMat = new THREE.MeshStandardMaterial({ color: 0xc99a5b, roughness: .35, metalness: .7 });
    var frontMats = {};
    ROLE_KEYS.forEach(function (k) { frontMats[k] = new THREE.MeshStandardMaterial({ map: texFrom(drawFront(k)), roughness: .5, metalness: .05 }); });

    var geo = new THREE.BoxGeometry(1.3, 1.95, .03);
    var order = ["mafia", "civilian", "sheriff", "don", "maniac", "doctor", "mafia", "civilian"];
    var meshes = order.map(function (k, i) {
      // У каждой карты свои материалы: проходя перед маской, карта становится прозрачной и не заслоняет её
      var em = edgeMat.clone(), fm = frontMats[k].clone(), bm = backMat.clone();
      [em, fm, bm].forEach(function (x) { x.transparent = true; });
      var m = new THREE.Mesh(geo, [em, em, em, em, fm, bm]);
      m.userData = { a: i / order.length * Math.PI * 2, ph: Math.random() * 6.28, flip: 0, hover: 0, yo: (Math.random() - .5) * .7, front: 0, mats: [em, fm, bm] };
      ring.add(m); return m;
    });

    // ---------- маска «Маски сняты» ----------
    var maskRoot = new THREE.Group(); pivot.add(maskRoot);
    var maskOff = { click: 0 }, whiteMesh = null, goldMat = null, whiteMat = null, hinge = null, MW = 2.05;
    if (MASK_IMG) {
      var layers = maskLayers(MASK_IMG), MH = MW * layers.aspect;
      var mgeo = new THREE.PlaneGeometry(MW, MH, 48, 60), mp = mgeo.attributes.position;
      for (var vi = 0; vi < mp.count; vi++) {
        var vx = mp.getX(vi) / (MW / 2), vy = mp.getY(vi) / (MH / 2);
        mp.setZ(vi, .42 * (1 - vx * vx) * (.65 + .35 * (1 - vy * vy)));
      }
      mgeo.computeVertexNormals();
      whiteMat = new THREE.MeshStandardMaterial({ map: texFrom(layers.white), transparent: true, alphaTest: .4, side: THREE.DoubleSide, roughness: .32, metalness: .06 });
      goldMat = new THREE.MeshStandardMaterial({ map: texFrom(layers.gold), transparent: true, alphaTest: .3, side: THREE.DoubleSide, roughness: .28, metalness: .85, emissive: new THREE.Color(0x8a5a22), emissiveIntensity: .15 });
      hinge = new THREE.Group(); hinge.position.x = -MW / 2; maskRoot.add(hinge);
      whiteMesh = new THREE.Mesh(mgeo, whiteMat); whiteMesh.position.x = MW / 2; hinge.add(whiteMesh);
      var goldMesh = new THREE.Mesh(mgeo, goldMat); goldMesh.position.z = -.05; maskRoot.add(goldMesh);
      var faceLight = new THREE.PointLight(0xffb45c, 0, 4); faceLight.position.set(.4, .2, 1.4); maskRoot.add(faceLight);
      maskRoot.userData.faceLight = faceLight;
    }

    var PCOUNT = 700, pos = new Float32Array(PCOUNT * 3), spd = new Float32Array(PCOUNT);
    for (var i = 0; i < PCOUNT; i++) { pos[i * 3] = (Math.random() - .5) * 16; pos[i * 3 + 1] = (Math.random() - .5) * 10; pos[i * 3 + 2] = (Math.random() - .5) * 10; spd[i] = .05 + Math.random() * .15; }
    var pgeo = new THREE.BufferGeometry(); pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    var pmat = new THREE.PointsMaterial({ color: 0xe4c08a, size: .03, transparent: true, opacity: .55, depthWrite: false });
    var dust = new THREE.Points(pgeo, pmat); scene.add(dust);

    var W = 1, H = 1, wide = true, UPP = .01, SC = 1;
    function resize() {
      var b = hero.getBoundingClientRect(); W = Math.max(1, b.width); H = Math.max(1, b.height);
      renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.updateProjectionMatrix();
      wide = W > 860;
      // Сцена занимает свободное место: на компьютере — над карточкой «Ближайшая игра»,
      // на телефоне — над заголовком. Так маску ничто не перекрывает ни на одном экране.
      var upp = 2 * 11 * Math.tan(THREE.MathUtils.degToRad(18)) / H;
      var anchor = document.getElementById(wide ? "nextGame" : "heroEyebrow").getBoundingClientRect();
      var top = wide ? 112 : 84, room = Math.max(140, anchor.top - b.top - top - (wide ? 14 : 24));
      var sc = Math.max(.42, Math.min(wide ? 1 : .8, room / (3.6 / upp), wide ? 9 : W / (6.4 / upp)));
      var cx = wide && anchor.width ? anchor.left - b.left + anchor.width / 2 : W / 2;
      pivot.position.set((cx - W / 2) * upp, (H / 2 - (top + room / 2)) * upp, 0);
      pivot.scale.setScalar(sc);
      UPP = upp; SC = sc;
    }
    resize();
    window.maskiSceneLayout = function () { setTimeout(resize, 1200); };
    if (window.ResizeObserver) new ResizeObserver(resize).observe(hero); else addEventListener("resize", resize);

    var mouse = new THREE.Vector2(0, 0), mTarget = { x: 0, y: 0 }, ray = new THREE.Raycaster(), hovered = null, maskHover = false;
    hero.addEventListener("pointermove", function (e) {
      var b = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - b.left) / b.width) * 2 - 1;
      mouse.y = -((e.clientY - b.top) / b.height) * 2 + 1;
      mTarget.x = mouse.x; mTarget.y = mouse.y;
      if (e.target.closest("a,button,.next")) { hovered = null; sceneHover = false; return; }
      ray.setFromCamera(mouse, camera);
      var hit = ray.intersectObjects(pickable())[0];
      hovered = hit && hit.object !== whiteMesh ? hit.object : null;
      maskHover = !!(hit && hit.object === whiteMesh);
      sceneHover = !!hit;
      sceneLabel = maskHover ? (maskOff.click > .5 ? "Надеть" : "Снять") : "Вскрыть";
      hero.style.cursor = hit ? "pointer" : "";
    });
    hero.addEventListener("pointerleave", function () { hovered = null; sceneHover = false; mTarget.x = 0; mTarget.y = 0; });
    hero.addEventListener("click", function (e) {
      if (e.target.closest("a,button,.next")) return;
      var b = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - b.left) / b.width) * 2 - 1; mouse.y = -((e.clientY - b.top) / b.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      var hit = ray.intersectObjects(pickable())[0]; if (!hit) return;
      if (hit.object === whiteMesh) {
        var target = maskOff.click > .5 ? 0 : 1;
        if (hasGsap) gsap.to(maskOff, { click: target, duration: reduce ? .01 : 1.6, ease: "power3.inOut" }); else maskOff.click = target;
        toast(target ? "Маски сняты" : "Маска на месте");
        return;
      }
      var u = hit.object.userData, to = Math.round(u.flip) + 1;
      if (hasGsap) gsap.to(u, { flip: to, duration: reduce ? .01 : 1, ease: "power3.inOut" }); else u.flip = to;
      var k = order[meshes.indexOf(hit.object)];
      toast(ROLES[k].name + " · " + ROLES[k].tag);
    });

    function pickable() {
      var list = meshes.filter(function (m) { return m.userData.front < .5; });
      return whiteMesh ? list.concat([whiteMesh]) : list;
    }
    var scrollP = 0;
    if (hasGsap && window.ScrollTrigger) ScrollTrigger.create({ trigger: hero, start: "top top", end: "bottom top", onUpdate: function (s) { scrollP = s.progress; } });

    var running = true, visible = true;
    if (window.IntersectionObserver) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible && !running) { running = true; clock.getDelta(); requestAnimationFrame(frame); } }, { threshold: 0 }).observe(hero);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && !running && visible) { running = true; clock.getDelta(); requestAnimationFrame(frame); } });

    var clock = new THREE.Clock(), t = 0, spin = 0, speed = reduce ? .15 : 1, vCard = new THREE.Vector3(), vMask = new THREE.Vector3();
    function frame() {
      if (!visible || document.hidden) { running = false; return; }
      var dt = Math.min(clock.getDelta(), .05);
      t += dt * speed; spin += dt * .16 * speed;
      var R = 2.95 + scrollP * 2.2;
      if (whiteMesh) {
        var off = Math.max(maskOff.click, Math.min(1, Math.max(0, (scrollP - .04) * 2.6)));
        var e = off * off * (3 - 2 * off);
        hinge.rotation.y = -e * 1.05;
        hinge.rotation.z = e * .32;
        hinge.position.set(-MW / 2 - e * .75, e * .08, e * .75);
        whiteMat.opacity = 1 - e * .12;
        goldMat.emissiveIntensity = .15 + e * 1.1;
        maskRoot.userData.faceLight.intensity = e * 1.6;
        maskRoot.position.y = Math.sin(t * .8) * .06;
        maskRoot.rotation.y += ((mTarget.x * .3) - maskRoot.rotation.y) * .06;
        maskRoot.rotation.x += ((-mTarget.y * .15) - maskRoot.rotation.x) * .06;
        var hs = 1 + (maskHover ? .04 : 0);
        whiteMesh.scale.x += (hs - whiteMesh.scale.x) * .15; whiteMesh.scale.y = whiteMesh.scale.x;
      }
      camera.updateMatrixWorld();
      if (whiteMesh) maskRoot.getWorldPosition(vMask).project(camera);
      for (var j = 0; j < meshes.length; j++) {
        var m = meshes[j], u = m.userData, a = u.a + spin;
        var cx = Math.cos(a) * R, cz = Math.sin(a) * R;
        // Карта, которая на экране заслоняет маску (с учётом перспективы), становится полупрозрачной и чуть опускается
        var fr = 0;
        if (whiteMesh && cz > 0) {
          m.getWorldPosition(vCard).project(camera);
          var dx = Math.abs(vCard.x - vMask.x) * W / 2, dy = Math.abs(vCard.y - vMask.y) * H / 2;
          var reachX = (MW * .48 + .65) * SC / UPP, reachY = (MW * .5 + .98) * SC / UPP;
          fr = Math.max(0, Math.min(1, (reachX - dx) / (reachX * .3))) * Math.max(0, Math.min(1, (reachY - dy) / (reachY * .3))) * Math.min(1, cz / .8);
        }
        if (!isFinite(fr)) fr = 0;
        u.front += (fr - u.front) * .15;
        var op = 1 - u.front * .7;
        for (var q = 0; q < 3; q++) { u.mats[q].opacity = op; u.mats[q].depthWrite = op > .97; }
        m.position.set(cx, Math.sin(t * .9 + u.ph) * .2 + u.yo - u.front * .35, cz);
        m.rotation.y = Math.PI / 2 - a + u.flip * Math.PI + Math.sin(t * .6 + u.ph) * .18;
        m.rotation.z = Math.sin(t * .5 + u.ph) * .09;
        m.rotation.x = Math.cos(t * .4 + u.ph) * .06;
        u.hover += ((m === hovered ? 1 : 0) - u.hover) * .12;
        m.scale.setScalar(1 + u.hover * .12);
      }
      pivot.rotation.y += ((mTarget.x * .35) - pivot.rotation.y) * .05;
      pivot.rotation.x += ((-mTarget.y * .18) - pivot.rotation.x) * .05;
      pointL.position.x += ((mTarget.x * 6) - pointL.position.x) * .08;
      pointL.position.y += ((mTarget.y * 4) - pointL.position.y) * .08;
      camera.position.z = 11 + scrollP * 3;
      camera.position.y = -scrollP * 1.4;
      var arr = pgeo.attributes.position.array;
      for (var p = 0; p < PCOUNT; p++) {
        arr[p * 3 + 1] += spd[p] * dt * speed;
        arr[p * 3] += Math.sin(t + p) * .002 * speed;
        if (arr[p * 3 + 1] > 5) arr[p * 3 + 1] = -5;
      }
      pgeo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    sceneApi = {
      setDay: function (day) {
        var from = scene.background.clone(), to = new THREE.Color(day ? PAPER : INK);
        var pFrom = pmat.color.clone(), pTo = new THREE.Color(day ? "#946629" : GOLD_HI), o = { k: 0 };
        function apply() { scene.background.copy(from).lerp(to, o.k); scene.fog.color.copy(scene.background); pmat.color.copy(pFrom).lerp(pTo, o.k); }
        if (hasGsap) gsap.to(o, { k: 1, duration: .7, ease: "power2.inOut", onUpdate: apply }); else { o.k = 1; apply(); }
        cone.visible = !day;
        ambient.intensity = day ? .95 : .38;
        pmat.opacity = day ? .35 : .55;
        if (!running && visible) { running = true; clock.getDelta(); requestAnimationFrame(frame); }
      }
    };
    if (root.dataset.phase === "day") sceneApi.setDay(true);
  }
  fontsReady().then(initScene);
})();
