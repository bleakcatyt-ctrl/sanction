'use strict';
const config = require('../server/config');
const { open, defaultFile } = require('../server/db');
const crawler = require('../server/crawler');

const db = open(defaultFile());
console.log('Сбор вакансий… (БД:', defaultFile() + ')');
crawler.tick(db, { force: true }).then((r) => {
  for (const x of r) console.log(`${x.source.padEnd(10)} получено ${String(x.fetched).padStart(4)}  подошло ${String(x.kept).padStart(4)}  новых ${String(x.inserted).padStart(4)}  ${x.error ? 'ОШИБКА: ' + x.error : 'ok'}`);
  void config;
});
