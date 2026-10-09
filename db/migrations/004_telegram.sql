-- Telegram-уведомления о заявках: куда слать и одноразовые коды подключения
CREATE TABLE telegram_chats (
  chat_id    bigint PRIMARY KEY,
  title      text NOT NULL DEFAULT '' CHECK (char_length(title) <= 120),
  staff_id   integer REFERENCES staff (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telegram_link_codes (
  code       text PRIMARY KEY CHECK (code ~ '^[A-Za-z0-9_-]{16,64}$'),
  staff_id   integer NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

-- Настройки сайта, которые меняет администратор
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- По умолчанию в Telegram не уходят имя и контакт гостя (сервера Telegram за рубежом, 152-ФЗ)
INSERT INTO app_settings (key, value) VALUES ('telegram_personal_data', 'false');
