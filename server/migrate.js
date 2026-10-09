'use strict';
// Применяет SQL-миграции из db/migrations по порядку. Каждая миграция — в своей транзакции.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DIR = path.join(__dirname, '..', 'db', 'migrations');

async function migrate({ log = console.log } = {}) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    await db.tx(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    log(`[migrate] применена ${file}`);
    applied++;
  }
  if (!applied) log('[migrate] база актуальна');
  return applied;
}

module.exports = { migrate };

if (require.main === module) {
  migrate().then(() => db.pool.end()).catch((err) => {
    console.error('[migrate] ошибка:', err.message);
    process.exit(1);
  });
}
