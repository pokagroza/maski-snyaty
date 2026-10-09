'use strict';
// Создание администратора из командной строки:
//   docker compose exec app node scripts/create-admin.js <логин> "<Имя>"
// Пароль спрашивается интерактивно (или берётся из ADMIN_PASSWORD).
const readline = require('readline');
const db = require('../server/db');
const { migrate } = require('../server/migrate');
const { hashPassword } = require('../server/auth');

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const login = String(process.argv[2] || '').toLowerCase();
  const name = process.argv[3] || login;
  if (!/^[a-z0-9_.-]{3,32}$/.test(login)) {
    console.error('Укажите логин: латинские буквы, цифры, точка, дефис или подчёркивание (3–32 символа).');
    console.error('Пример: node scripts/create-admin.js stepan "Степан"');
    process.exit(1);
  }
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await ask('Пароль (не короче 10 символов): ', true);
    const again = await ask('Повторите пароль: ', true);
    if (password !== again) { console.error('Пароли не совпали.'); process.exit(1); }
  }
  if (password.length < 10) { console.error('Пароль должен быть не короче 10 символов.'); process.exit(1); }
  await migrate({ log: () => {} });
  const hash = await hashPassword(password);
  const { rows } = await db.query(
    `INSERT INTO staff (login, display_name, role, password_hash) VALUES ($1, $2, 'admin', $3)
     ON CONFLICT (login) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_active = true
     RETURNING id, (xmax = 0) AS created`,
    [login, name, hash]
  );
  console.log(rows[0].created ? `Администратор «${login}» создан.` : `Пароль администратора «${login}» обновлён, доступ восстановлен.`);
  await db.pool.end();
})().catch((err) => { console.error('Ошибка:', err.message); process.exit(1); });
