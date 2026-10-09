'use strict';
// Проверка при сборке Docker-образа: на месте ли все файлы, которые сайт берёт из node_modules.
// Если пакет изменил структуру, сборка остановится с понятным сообщением, а не сломает сайт молча.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const MAP = {
  '/vendor/three/': 'three/build/',
  '/vendor/gsap/': 'gsap/dist/',
  '/vendor/fonts/cormorant-garamond/': '@fontsource/cormorant-garamond/',
  '/vendor/fonts/jost/': '@fontsource/jost/',
  '/vendor/fonts/marck-script/': '@fontsource/marck-script/'
};

const pages = ['public/index.html', 'public/admin/index.html', 'public/privacy.html', 'public/404.html'];
const needed = new Set();
for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  for (const m of html.matchAll(/(?:href|src)="(\/vendor\/[^"]+)"/g)) needed.add(m[1]);
}

const missing = [];
for (const url of needed) {
  const prefix = Object.keys(MAP).find((p) => url.startsWith(p));
  const file = path.join(NM, MAP[prefix] + url.slice(prefix.length));
  if (!fs.existsSync(file)) { missing.push(url + '  →  node_modules/' + MAP[prefix] + url.slice(prefix.length)); continue; }
  if (file.endsWith('.css')) {
    const css = fs.readFileSync(file, 'utf8');
    for (const m of css.matchAll(/url\(\.\/([^)]+)\)/g)) {
      if (!fs.existsSync(path.join(path.dirname(file), m[1]))) missing.push(url + ' ссылается на отсутствующий ' + m[1]);
    }
  }
}

if (missing.length) {
  console.error('Не найдены файлы оформления:\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log(`Файлы оформления на месте (${needed.size}).`);
