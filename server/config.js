'use strict';

const env = process.env;

function required(name) {
  const v = env[name];
  if (!v) {
    console.error(`[config] не задана переменная окружения ${name}`);
    process.exit(1);
  }
  return v;
}

const isProd = env.NODE_ENV === 'production';

module.exports = {
  isProd,
  port: +(env.PORT || 3000),
  databaseUrl: required('DATABASE_URL'),
  dbPoolSize: +(env.DB_POOL_SIZE || 10),
  // Часовой пояс клуба: в нём вводятся и показываются даты игр
  clubTz: env.CLUB_TZ || 'Europe/Moscow',
  // Сайт работает за Caddy: адрес клиента берём из X-Forwarded-For
  trustProxy: env.TRUST_PROXY === '1' || isProd,
  // Публичный адрес сайта, например https://lupin-mafia.ru (для проверки Origin)
  publicOrigin: (env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),
  sessionDays: +(env.SESSION_DAYS || 14),
  // Через сколько дней обезличивать имена и контакты в заявках
  bookingRetentionDays: +(env.BOOKING_RETENTION_DAYS || 365),
  // Telegram-бот для уведомлений о заявках (необязательно). Токен выдаёт @BotFather.
  telegramToken: (env.TELEGRAM_BOT_TOKEN || '').trim(),
  // Адрес API Telegram; меняется только в тестах
  telegramApi: (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '')
};
