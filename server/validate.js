'use strict';
const { HttpError } = require('./http');

function bad(msg) { throw new HttpError(400, msg); }

function str(v, { name, min = 0, max = 200, optional = false } = {}) {
  if (v === undefined || v === null) {
    if (optional) return '';
    bad(`Заполните поле «${name}».`);
  }
  if (typeof v !== 'string') bad(`Поле «${name}» должно быть текстом.`);
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (s.length < min) bad(min <= 1 ? `Заполните поле «${name}».` : `Поле «${name}»: минимум ${min} символов.`);
  if (s.length > max) bad(`Поле «${name}»: максимум ${max} символов.`);
  return s;
}

function int(v, { name, min, max, optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return null;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) bad(`Поле «${name}» должно быть целым числом.`);
  if (min !== undefined && n < min) bad(`Поле «${name}»: не меньше ${min}.`);
  if (max !== undefined && n > max) bad(`Поле «${name}»: не больше ${max}.`);
  return n;
}

function num(v, { name, min, max } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : (v === null || v === undefined || v === '' ? 0 : v);
  if (typeof n !== 'number' || !Number.isFinite(n)) bad(`Поле «${name}» должно быть числом.`);
  if (min !== undefined && n < min) bad(`Поле «${name}»: не меньше ${String(min).replace('.', ',')}.`);
  if (max !== undefined && n > max) bad(`Поле «${name}»: не больше ${String(max).replace('.', ',')}.`);
  return n;
}

function oneOf(v, list, name) {
  if (list.indexOf(v) === -1) bad(`Недопустимое значение поля «${name}».`);
  return v;
}

function bool(v) { return v === true || v === 'true' || v === 1; }

function date(v, name = 'Дата') {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(`Поле «${name}»: укажите дату в формате ГГГГ-ММ-ДД.`);
  const d = new Date(v + 'T00:00:00Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== v) bad(`Поле «${name}»: такой даты нет.`);
  return v;
}

function month(v) {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) bad('Укажите месяц в формате ГГГГ-ММ.');
  return v;
}

function localDateTime(v, name = 'Начало') {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) bad(`Поле «${name}»: укажите дату и время.`);
  date(v.slice(0, 10), name);
  const [h, m] = v.slice(11).split(':').map(Number);
  if (h > 23 || m > 59) bad(`Поле «${name}»: неверное время.`);
  return v;
}

function id(v, name = 'id') { return int(v, { name, min: 1, max: 2147483647 }); }

module.exports = { str, int, num, oneOf, bool, date, month, localDateTime, id, bad };
