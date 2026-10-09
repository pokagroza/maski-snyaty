'use strict';
const config = require('./config');

let PoolImpl, driver;
try {
  PoolImpl = require('pg').Pool;
  driver = 'pg';
} catch (e) {
  // Пакет pg не установлен — используем встроенный клиент (только для разработки и тестов)
  PoolImpl = require('./minipg').Pool;
  driver = 'minipg';
}

const pool = new PoolImpl({ connectionString: config.databaseUrl, max: config.dbPoolSize });
if (pool.on) pool.on('error', (err) => console.error('[db] idle client error:', err.message));

async function query(text, params) {
  return pool.query(text, params);
}

// Транзакция: fn получает клиента с методом query. Отложенные проверки протокола срабатывают на COMMIT.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* соединение могло оборваться */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx, driver };
