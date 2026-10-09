'use strict';
/*
 * Минимальный клиент PostgreSQL с интерфейсом, совместимым с `pg` (Pool.query, connect/release).
 * Используется ТОЛЬКО как запасной вариант для разработки и тестов, когда пакет `pg` не установлен.
 * В продакшене (Docker) ставится и используется официальный драйвер `pg`.
 * Поддерживает: SCRAM-SHA-256 / MD5 / пароль, параметризованные запросы, простые запросы для миграций.
 */
const net = require('net');
const crypto = require('crypto');

const TYPE_PARSERS = {
  16: (v) => v === 't',                 // bool
  21: Number, 23: Number, 26: Number,   // int2, int4, oid
  700: Number, 701: Number,             // float4, float8
  114: JSON.parse, 3802: JSON.parse     // json, jsonb
  // int8 (20) и numeric (1700) остаются строками, как в pg
};

function parseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname || '127.0.0.1',
    port: +u.port || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)) || decodeURIComponent(u.username)
  };
}

function serialize(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

class Connection {
  constructor(cfg) {
    this.cfg = cfg;
    this.buf = Buffer.alloc(0);
    this.queue = [];
    this.current = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.cfg.port, this.cfg.host);
      this.sock = sock;
      this.ready = { resolve, reject };
      sock.setNoDelay(true);
      sock.on('connect', () => this.startup());
      sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
      sock.on('error', (e) => this.fail(e));
      sock.on('close', () => this.fail(new Error('Connection closed')));
    });
  }

  fail(err) {
    if (this.ready) { this.ready.reject(err); this.ready = null; }
    if (this.current) { this.current.reject(err); this.current = null; }
    this.queue.splice(0).forEach((q) => q.reject(err));
    this.dead = true;
  }

  frame(type, body) {
    const len = Buffer.alloc(4); len.writeInt32BE(body.length + 4);
    return type ? Buffer.concat([Buffer.from(type), len, body]) : Buffer.concat([len, body]);
  }

  send(type, body) { this.sock.write(this.frame(type, body)); }

  startup() {
    const parts = [];
    const ver = Buffer.alloc(4); ver.writeInt32BE(196608); parts.push(ver);
    for (const [k, v] of [['user', this.cfg.user], ['database', this.cfg.database], ['client_encoding', 'UTF8']]) {
      parts.push(Buffer.from(k + '\0' + v + '\0'));
    }
    parts.push(Buffer.from('\0'));
    this.send(null, Buffer.concat(parts));
  }

  drain() {
    while (this.buf.length >= 5) {
      const type = String.fromCharCode(this.buf[0]);
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) return;
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      this.handle(type, body);
    }
  }

  handle(type, body) {
    switch (type) {
      case 'R': return this.auth(body);
      case 'S': case 'K': case 'N': case '1': case '2': case 'n': case 's': return;
      case 'Z':
        if (this.ready) { const r = this.ready; this.ready = null; r.resolve(this); }
        if (this.current) {
          const c = this.current; this.current = null;
          if (c.error) c.reject(c.error); else c.resolve({ rows: c.rows, rowCount: c.rowCount, fields: c.fields });
        }
        return this.next();
      case 'T': return this.rowDesc(body);
      case 'D': return this.dataRow(body);
      case 'C': {
        const tag = body.toString('utf8', 0, body.length - 1);
        const m = tag.match(/(\d+)$/);
        if (this.current) this.current.rowCount = m ? +m[1] : 0;
        return;
      }
      case 'E': {
        const err = this.errorFrom(body);
        if (this.current) this.current.error = err;
        else if (this.ready) { this.ready.reject(err); this.ready = null; }
        return;
      }
      default: return;
    }
  }

  errorFrom(body) {
    const f = {};
    let i = 0;
    while (i < body.length && body[i] !== 0) {
      const code = String.fromCharCode(body[i]);
      const end = body.indexOf(0, i + 1);
      f[code] = body.toString('utf8', i + 1, end);
      i = end + 1;
    }
    const err = new Error(f.M || 'PostgreSQL error');
    err.code = f.C; err.detail = f.D; err.constraint = f.n; err.severity = f.S; err.table = f.t; err.column = f.c;
    return err;
  }

  auth(body) {
    const kind = body.readInt32BE(0);
    const { user, password } = this.cfg;
    if (kind === 0) return;
    if (kind === 3) return this.send('p', Buffer.from(password + '\0'));
    if (kind === 5) {
      const salt = body.subarray(4, 8);
      const inner = crypto.createHash('md5').update(password + user).digest('hex');
      const outer = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
      return this.send('p', Buffer.from('md5' + outer + '\0'));
    }
    if (kind === 10) {
      this.nonce = crypto.randomBytes(18).toString('base64');
      this.clientFirstBare = 'n=*,r=' + this.nonce;
      const msg = Buffer.from('n,,' + this.clientFirstBare);
      const mech = Buffer.from('SCRAM-SHA-256\0');
      const len = Buffer.alloc(4); len.writeInt32BE(msg.length);
      return this.send('p', Buffer.concat([mech, len, msg]));
    }
    if (kind === 11) {
      const serverFirst = body.toString('utf8', 4);
      const attrs = Object.fromEntries(serverFirst.split(',').map((p) => [p[0], p.slice(2)]));
      if (!attrs.r.startsWith(this.nonce)) return this.fail(new Error('SCRAM nonce mismatch'));
      const salted = crypto.pbkdf2Sync(password.normalize('NFKC'), Buffer.from(attrs.s, 'base64'), +attrs.i, 32, 'sha256');
      const clientKey = crypto.createHmac('sha256', salted).update('Client Key').digest();
      const storedKey = crypto.createHash('sha256').update(clientKey).digest();
      const finalNoProof = 'c=biws,r=' + attrs.r;
      const authMessage = this.clientFirstBare + ',' + serverFirst + ',' + finalNoProof;
      const sig = crypto.createHmac('sha256', storedKey).update(authMessage).digest();
      const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
      const serverKey = crypto.createHmac('sha256', salted).update('Server Key').digest();
      this.expectedServerSig = crypto.createHmac('sha256', serverKey).update(authMessage).digest('base64');
      return this.send('p', Buffer.from(finalNoProof + ',p=' + proof.toString('base64')));
    }
    if (kind === 12) {
      const v = body.toString('utf8', 4).replace(/^v=/, '');
      if (v !== this.expectedServerSig) this.fail(new Error('SCRAM server signature mismatch'));
      return;
    }
    this.fail(new Error('Unsupported auth method ' + kind));
  }

  rowDesc(body) {
    const n = body.readInt16BE(0);
    let i = 2;
    const fields = [];
    for (let k = 0; k < n; k++) {
      const end = body.indexOf(0, i);
      const name = body.toString('utf8', i, end);
      i = end + 1;
      const typeId = body.readInt32BE(i + 6);
      i += 18;
      fields.push({ name, dataTypeID: typeId });
    }
    if (this.current) { this.current.fields = fields; this.current.rows = []; }
  }

  dataRow(body) {
    const c = this.current; if (!c) return;
    const n = body.readInt16BE(0);
    let i = 2;
    const row = {};
    for (let k = 0; k < n; k++) {
      const len = body.readInt32BE(i); i += 4;
      const f = c.fields[k];
      if (len === -1) { row[f.name] = null; continue; }
      const raw = body.toString('utf8', i, i + len); i += len;
      const p = TYPE_PARSERS[f.dataTypeID];
      row[f.name] = p ? p(raw) : raw;
    }
    c.rows.push(row);
  }

  query(text, params) {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new Error('Connection is closed'));
      this.queue.push({ text, params, resolve, reject, rows: [], rowCount: 0, fields: [] });
      if (!this.current) this.next();
    });
  }

  next() {
    if (this.current || !this.queue.length) return;
    const q = this.current = this.queue.shift();
    if (!q.params || !q.params.length) {
      if (q.simple) return this.send('Q', Buffer.from(q.text + '\0'));
    }
    const params = (q.params || []).map(serialize);
    const parse = Buffer.concat([Buffer.from('\0' + q.text + '\0'), Buffer.from([0, 0])]);
    const parts = [Buffer.from('\0\0'), Buffer.from([0, 0])];
    const cnt = Buffer.alloc(2); cnt.writeInt16BE(params.length); parts.push(cnt);
    for (const p of params) {
      const len = Buffer.alloc(4);
      if (p === null) { len.writeInt32BE(-1); parts.push(len); continue; }
      const b = Buffer.from(p, 'utf8'); len.writeInt32BE(b.length); parts.push(len, b);
    }
    parts.push(Buffer.from([0, 0]));
    // Все сообщения одного запроса уходят одним пакетом
    this.sock.write(Buffer.concat([
      this.frame('P', parse),
      this.frame('B', Buffer.concat(parts)),
      this.frame('D', Buffer.from('P\0')),
      this.frame('E', Buffer.concat([Buffer.from('\0'), Buffer.alloc(4)])),
      this.frame('S', Buffer.alloc(0))
    ]));
  }

  simpleQuery(text) {
    return new Promise((resolve, reject) => {
      this.queue.push({ text, simple: true, resolve, reject, rows: [], rowCount: 0, fields: [] });
      if (!this.current) this.next();
    });
  }

  end() { try { this.send('X', Buffer.alloc(0)); this.sock.end(); } catch (e) { /* already closed */ } this.dead = true; }
}

class Pool {
  constructor({ connectionString, max = 5 }) {
    this.cfg = parseUrl(connectionString);
    this.max = max;
    this.idle = [];
    this.count = 0;
    this.waiters = [];
  }

  async connect() {
    let conn = this.idle.pop();
    while (conn && conn.dead) { this.count--; conn = this.idle.pop(); }
    if (!conn) {
      if (this.count >= this.max) {
        conn = await new Promise((r) => this.waiters.push(r));
      } else {
        this.count++;
        try { conn = await new Connection(this.cfg).connect(); }
        catch (e) { this.count--; throw e; }
      }
    }
    const pool = this;
    return {
      query: (text, params) => (params === undefined && /;\s*\S/.test(text) ? conn.simpleQuery(text) : conn.query(text, params)),
      release() {
        if (conn.dead) { pool.count--; return; }
        const w = pool.waiters.shift();
        if (w) w(conn); else pool.idle.push(conn);
      }
    };
  }

  async query(text, params) {
    const c = await this.connect();
    try { return await c.query(text, params); } finally { c.release(); }
  }

  async end() { this.idle.forEach((c) => c.end()); this.idle = []; }
}

module.exports = { Pool };
