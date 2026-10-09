'use strict';
// Telegram-бот: уведомления администраторам о новых заявках.
// Работает без вебхука: сервер сам опрашивает Telegram (long polling), поэтому не нужен отдельный адрес
// и настройка HTTPS для бота. Подключение чата — по одноразовой ссылке из админки: t.me/<бот>?start=<код>.
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const POLL_SEC = +(process.env.TELEGRAM_POLL_SEC || 50);
const LINK_TTL_MIN = 15;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const state = { enabled: !!config.telegramToken, bot: null, error: null, offset: 0, stopped: false, abort: null, pending: new Set(), loop: null };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function plural(n, a, b, c) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c); }
function dateRu(iso) { const p = iso.split('-'); return `${+p[2]} ${MONTHS[+p[1] - 1]}`; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, params, { timeoutMs = 10000, signal } = {}) {
  if (!state.enabled) throw new Error('Telegram-бот не настроен');
  const res = await fetch(`${config.telegramApi}/bot${config.telegramToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
    signal: signal || AbortSignal.timeout(timeoutMs)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const err = new Error(data.description || `Telegram ответил ${res.status}`);
    err.code = data.error_code || res.status;
    err.retryAfter = data.parameters && data.parameters.retry_after;
    throw err;
  }
  return data.result;
}

async function getSetting(key, fallback) {
  const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}
async function setSetting(key, value) {
  await db.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]
  );
}

// ---------- отправка ----------
async function sendTo(chatId, text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
      if (err.code === 429 && attempt < 2) { await sleep(((err.retryAfter || 1) + 0.5) * 1000); continue; }
      // Бота заблокировали или удалили из группы — больше туда не пишем
      if (err.code === 403 || (err.code === 400 && /chat not found/i.test(err.message))) {
        await db.query('DELETE FROM telegram_chats WHERE chat_id = $1', [String(chatId)]);
        console.warn(`[telegram] чат ${chatId} недоступен, отключён: ${err.message}`);
        return null;
      }
      if (attempt < 2 && (err.name === 'TimeoutError' || err.code >= 500 || !err.code)) { await sleep(2000 * (attempt + 1)); continue; }
      throw err;
    }
  }
  return null;
}

async function broadcast(text) {
  const { rows } = await db.query('SELECT chat_id FROM telegram_chats ORDER BY created_at');
  let sent = 0;
  for (const r of rows) {
    try { if (await sendTo(r.chat_id, text)) sent++; } catch (err) { console.error(`[telegram] не отправлено в ${r.chat_id}: ${err.message}`); }
  }
  return { sent, total: rows.length };
}

const KIND_HEAD = {
  event: '🎭 <b>Новая заявка на игру</b>',
  corporate: '🥂 <b>Заявка на корпоратив</b>',
  private: '🎂 <b>Заявка на день рождения</b>',
  subscription: '✉️ <b>Подписка на рассылку</b>'
};

// Текст уведомления. Имя и контакт — только если администратор включил это в настройках.
function bookingText(b, { personal }) {
  const lines = [KIND_HEAD[b.request_kind] || KIND_HEAD.event, ''];
  if (b.request_kind === 'event' && b.title) {
    lines.push(`<b>${esc(b.title)}</b>`);
    lines.push(`${dateRu(b.date)}, ${b.time}${b.venue ? ' · ' + esc(b.venue) : ''}`);
    const left = Math.max(0, b.capacity - b.taken);
    lines.push(`Мест в заявке: <b>${b.seats}</b> · свободно ${left} из ${b.capacity}${left === 0 ? ' — <b>мест больше нет</b>' : ''}`);
  }
  if (personal) {
    lines.push('');
    lines.push(`Имя: ${esc(b.name)}`);
    lines.push(`Контакт: ${esc(b.contact)}`);
    if (b.comment) lines.push(`Комментарий: ${esc(b.comment)}`);
  } else if (b.comment && /промокод[\s:«»"'—-]*кто ты|^[\s«»"'.!?]*кто ты[\s«»"'.!?]*$/i.test(b.comment)) {
    // промокод из пасхалки: «Промокод: Кто ты» или просто «Кто ты»
    lines.push('🔑 С промокодом «Кто ты»');
  }
  lines.push('');
  lines.push(config.publicOrigin ? `<a href="${config.publicOrigin}/admin/#bookings">Открыть заявку в админке</a>` : 'Подробности — в админке, раздел «Заявки».');
  return lines.join('\n');
}

async function notifyBooking(bookingId) {
  if (!state.enabled) return;
  const { rows } = await db.query(
    `SELECT b.request_kind::text AS request_kind, b.name, b.contact, b.seats, b.comment,
            e.title, e.venue, e.capacity,
            to_char(e.starts_at AT TIME ZONE $2, 'YYYY-MM-DD') AS date, to_char(e.starts_at AT TIME ZONE $2, 'HH24:MI') AS time,
            COALESCE((SELECT sum(seats) FROM bookings x WHERE x.event_id = e.id AND x.status IN ('new', 'confirmed', 'attended')), 0)::int AS taken
       FROM bookings b LEFT JOIN events e ON e.id = b.event_id WHERE b.id = $1`, [bookingId, config.clubTz]
  );
  if (!rows[0]) return;
  const personal = (await getSetting('telegram_personal_data', false)) === true;
  await broadcast(bookingText(rows[0], { personal }));
}
// Заявка уже сохранена — уведомление уходит в фоне и никогда не мешает записи
function notifyBookingLater(bookingId) {
  if (!state.enabled || state.stopped) return;
  const p = new Promise((r) => setImmediate(r))
    .then(() => notifyBooking(bookingId))
    .catch((err) => console.error('[telegram] уведомление о заявке:', err.message))
    .finally(() => state.pending.delete(p));
  state.pending.add(p);
}

// ---------- подключение чатов ----------
function chatTitle(chat) {
  const t = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || '';
  return (t + (chat.username ? ` (@${chat.username})` : '')).trim().slice(0, 120) || String(chat.id);
}

async function handleUpdate(u) {
  const msg = u.message || u.channel_post;
  if (!msg || typeof msg.text !== 'string') return;
  const chat = msg.chat;
  const m = msg.text.trim().match(/^\/(start|stop)(?:@\w+)?(?:\s+(\S+))?/);
  if (!m) {
    await sendTo(chat.id, 'Я присылаю уведомления о новых заявках клуба «Маски сняты». Подключение — в админке сайта, раздел «Telegram».');
    return;
  }
  if (m[1] === 'stop') {
    await db.query('DELETE FROM telegram_chats WHERE chat_id = $1', [String(chat.id)]);
    await sendTo(chat.id, 'Уведомления отключены. Подключить снова можно в админке сайта.');
    return;
  }
  const code = m[2];
  if (!code) {
    await sendTo(chat.id, 'Чтобы получать уведомления о заявках, нажмите «Подключить Telegram» в админке сайта — откроется ссылка с кодом.');
    return;
  }
  const linked = await db.tx(async (c) => {
    const { rows } = await c.query('DELETE FROM telegram_link_codes WHERE code = $1 RETURNING staff_id, expires_at > now() AS alive', [code]);
    if (!rows[0] || !rows[0].alive) return null;
    await c.query(
      `INSERT INTO telegram_chats (chat_id, title, staff_id) VALUES ($1, $2, $3)
       ON CONFLICT (chat_id) DO UPDATE SET title = EXCLUDED.title, staff_id = EXCLUDED.staff_id`,
      [String(chat.id), chatTitle(chat), rows[0].staff_id]
    );
    await c.query(`INSERT INTO audit_log (staff_id, action, entity, details) VALUES ($1, 'link', 'telegram', $2)`,
      [rows[0].staff_id, { chat: chatTitle(chat) }]);
    return true;
  });
  await sendTo(chat.id, linked
    ? '🎭 Готово! Сюда будут приходить уведомления о новых заявках с сайта «Маски сняты».\nОтключить — команда /stop.'
    : 'Ссылка устарела или уже использована. Нажмите «Подключить Telegram» в админке ещё раз.');
}

async function pollLoop() {
  let backoff = 2000;
  while (!state.stopped) {
    try {
      if (!state.bot) {
        state.bot = await call('getMe');
        state.error = null;
        console.log(`[telegram] бот @${state.bot.username} подключён`);
      }
      state.abort = new AbortController();
      const timer = setTimeout(() => state.abort.abort(), (POLL_SEC + 15) * 1000);
      let updates;
      try {
        updates = await call('getUpdates', { offset: state.offset, timeout: POLL_SEC, allowed_updates: ['message', 'channel_post'] }, { signal: state.abort.signal });
      } finally { clearTimeout(timer); }
      for (const u of updates) {
        state.offset = u.update_id + 1;
        await handleUpdate(u).catch((err) => console.error('[telegram] обработка сообщения:', err.message));
      }
      backoff = 2000;
    } catch (err) {
      if (state.stopped) break;
      state.error = err.code === 401 ? 'Telegram не принял токен бота — проверьте TELEGRAM_BOT_TOKEN.' : `Нет связи с Telegram: ${err.message}`;
      if (err.code === 401) { console.error('[telegram]', state.error); state.bot = null; await sleep(10 * 60 * 1000); continue; }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

function start() {
  if (!state.enabled) return;
  state.stopped = false;
  state.loop = pollLoop();
}
// Останавливает опрос и дожидается уже начатых уведомлений (чтобы при перезапуске ничего не потерялось)
async function stop() {
  state.stopped = true;
  if (state.abort) state.abort.abort();
  await Promise.allSettled([...state.pending, state.loop]);
}

// ---------- админка ----------
function routes(r, { auth, v, HttpError }) {
  r.get('/api/admin/telegram', async (req) => {
    auth.requireAdmin(req);
    const { rows } = await db.query(
      `SELECT t.chat_id, t.title, s.display_name AS added_by, to_char(t.created_at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS created
         FROM telegram_chats t LEFT JOIN staff s ON s.id = t.staff_id ORDER BY t.created_at`, [config.clubTz]
    );
    return {
      enabled: state.enabled,
      bot: state.bot ? { username: state.bot.username, name: state.bot.first_name } : null,
      error: state.enabled ? state.error : null,
      personal: (await getSetting('telegram_personal_data', false)) === true,
      chats: rows.map((x) => ({ chatId: String(x.chat_id), title: x.title, addedBy: x.added_by, created: x.created }))
    };
  });

  r.post('/api/admin/telegram/link', async (req) => {
    auth.requireAdmin(req);
    if (!state.enabled) throw new HttpError(409, 'Бот ещё не настроен: впишите TELEGRAM_BOT_TOKEN в файл .env и перезапустите сайт.');
    if (!state.bot) {
      try { state.bot = await call('getMe'); } catch (err) { throw new HttpError(502, 'Нет связи с Telegram. Попробуйте через минуту.'); }
    }
    const code = crypto.randomBytes(18).toString('base64url');
    await db.query('DELETE FROM telegram_link_codes WHERE expires_at < now()');
    await db.query(`INSERT INTO telegram_link_codes (code, staff_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [code, req.staff.id, LINK_TTL_MIN]);
    return { url: `https://t.me/${state.bot.username}?start=${code}`, groupUrl: `https://t.me/${state.bot.username}?startgroup=${code}`, minutes: LINK_TTL_MIN };
  });

  r.post('/api/admin/telegram/test', async (req) => {
    auth.requireAdmin(req);
    if (!state.enabled) throw new HttpError(409, 'Бот ещё не настроен.');
    const res = await broadcast(`🎭 <b>Проверка связи</b>\nУведомления сайта «Маски сняты» работают. Отправил: ${esc(req.staff.name || 'администратор')}.`);
    if (!res.total) throw new HttpError(409, 'Пока не подключено ни одного чата.');
    return res;
  });

  r.patch('/api/admin/telegram/settings', async (req) => {
    auth.requireAdmin(req);
    const personal = v.bool((req.body || {}).personal);
    await setSetting('telegram_personal_data', personal);
    await auth.audit(null, req.staff.id, 'update', 'telegram', null, { personal });
    return { personal };
  });

  r.delete('/api/admin/telegram/chats/:id', async (req) => {
    auth.requireAdmin(req);
    const id = String(req.params.id);
    if (!/^-?\d{1,20}$/.test(id)) v.bad('Неверный чат.');
    const { rowCount } = await db.query('DELETE FROM telegram_chats WHERE chat_id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Чат не найден.');
    await auth.audit(null, req.staff.id, 'delete', 'telegram', null, { chat: id });
    if (state.enabled) sendTo(id, 'Уведомления о заявках для этого чата отключены администратором.').catch(() => {});
    return { ok: true };
  });
}

module.exports = { start, stop, routes, notifyBookingLater, bookingText, state };
