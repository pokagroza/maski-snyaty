'use strict';
// Галерея вечеров: публичный список и картинки, управление — у администратора.
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const auth = require('../auth');

const MAX_BYTES = 3 * 1024 * 1024;
// Определяем формат по первым байтам файла, а не по тому, что прислал браузер
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const COLS = `id, caption, to_char(taken_on, 'YYYY-MM-DD') AS taken_on, width, height, sort, is_published,
              extract(epoch FROM updated_at)::bigint AS ver`;
function out(r) {
  return {
    id: r.id, caption: r.caption, takenOn: r.taken_on, width: r.width, height: r.height,
    sort: r.sort, published: r.is_published, src: `/api/gallery/${r.id}/image?v=${r.ver}`
  };
}
function parseMeta(b) {
  return {
    caption: v.str(b.caption, { name: 'Подпись', max: 140, optional: true }) || '',
    takenOn: b.takenOn ? v.date(b.takenOn, 'Дата вечера') : null,
    sort: b.sort === undefined || b.sort === '' ? 0 : v.int(b.sort, { name: 'Порядок', min: -1000, max: 1000 }),
    published: b.published === undefined ? true : v.bool(b.published)
  };
}

module.exports = function galleryRoutes(r) {
  r.get('/api/gallery', async () => {
    const { rows } = await db.query(`SELECT ${COLS} FROM gallery_photos WHERE is_published
                                      ORDER BY sort DESC, taken_on DESC NULLS LAST, id DESC LIMIT 60`);
    return { photos: rows.map(out) };
  });

  r.get('/api/gallery/:id/image', async (req, res) => {
    const id = v.id(req.params.id, 'Фото');
    const { rows } = await db.query('SELECT mime, image, is_published FROM gallery_photos WHERE id = $1', [id]);
    const p = rows[0];
    // Скрытые фото видит только администратор (для предпросмотра в админке)
    if (!p || (!p.is_published && !(req.staff && req.staff.role === 'admin'))) throw new HttpError(404, 'Фото не найдено.');
    res.writeHead(200, {
      'Content-Type': p.mime,
      'Content-Length': p.image.length,
      'Cache-Control': p.is_published ? 'public, max-age=31536000, immutable' : 'private, no-store'
    });
    res.end(req.method === 'HEAD' ? undefined : p.image);
  });

  r.get('/api/admin/gallery', async (req) => {
    auth.requireAdmin(req);
    const { rows } = await db.query(`SELECT ${COLS} FROM gallery_photos ORDER BY sort DESC, taken_on DESC NULLS LAST, id DESC`);
    return { photos: rows.map(out) };
  });

  r.post('/api/admin/gallery', { bodyLimit: Math.ceil(MAX_BYTES * 1.4) + 4096 }, async (req) => {
    auth.requireAdmin(req);
    const b = req.body || {};
    const meta = parseMeta(b);
    if (typeof b.image !== 'string' || !b.image) v.bad('Выберите фотографию.');
    const buf = Buffer.from(b.image.replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length) v.bad('Не удалось прочитать фотографию.');
    if (buf.length > MAX_BYTES) v.bad('Фото больше 3 МБ. Уменьшите его и попробуйте снова.');
    const mime = sniff(buf);
    if (!mime) v.bad('Подходят только JPEG, PNG или WebP.');
    const width = v.int(b.width, { name: 'Ширина', min: 1, max: 6000 });
    const height = v.int(b.height, { name: 'Высота', min: 1, max: 6000 });
    const { rows } = await db.query(
      `INSERT INTO gallery_photos (caption, taken_on, mime, image, width, height, sort, is_published, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLS}`,
      [meta.caption, meta.takenOn, mime, buf, width, height, meta.sort, meta.published, req.staff.id]
    );
    await auth.audit(null, req.staff.id, 'create', 'photo', rows[0].id, { caption: meta.caption });
    return { __status: 201, body: out(rows[0]) };
  });

  r.patch('/api/admin/gallery/:id', async (req) => {
    auth.requireAdmin(req);
    const id = v.id(req.params.id, 'Фото');
    const meta = parseMeta(req.body || {});
    const { rows } = await db.query(
      `UPDATE gallery_photos SET caption = $2, taken_on = $3, sort = $4, is_published = $5, updated_at = now()
        WHERE id = $1 RETURNING ${COLS}`,
      [id, meta.caption, meta.takenOn, meta.sort, meta.published]
    );
    if (!rows[0]) throw new HttpError(404, 'Фото не найдено.');
    await auth.audit(null, req.staff.id, 'update', 'photo', id, { caption: meta.caption, published: meta.published });
    return out(rows[0]);
  });

  r.delete('/api/admin/gallery/:id', async (req) => {
    auth.requireAdmin(req);
    const id = v.id(req.params.id, 'Фото');
    const { rowCount } = await db.query('DELETE FROM gallery_photos WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Фото не найдено.');
    await auth.audit(null, req.staff.id, 'delete', 'photo', id);
    return { ok: true };
  });
};
