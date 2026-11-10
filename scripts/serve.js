// Запуск сервера: приложение (ES-модули не грузятся по file://) и хранилище
// опубликованной семьи. Данные — в DATA_DIR (по умолчанию ./data).
// TRUST_PROXY=1 — только если сервер стоит за своим прокси.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATA_DIR = resolve(process.env.DATA_DIR || resolve(ROOT, 'data'));
const PORT = Number(process.env.PORT) || 5173;

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
createApp({ root: ROOT, dataDir: DATA_DIR, trustProxy: process.env.TRUST_PROXY === '1' }).listen(PORT, () => console.log(`Дерево растёт на http://localhost:${PORT}`));
