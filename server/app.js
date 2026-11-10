// Сервер семьи без зависимостей: раздаёт приложение и хранит опубликованную
// семью. Смотреть может каждый, публиковать — только администраторы
// (server/auth.js). Данные лежат в dataDir:
//   family.json  — опубликованная семья { savedAt, family }
//   photos/      — портреты <id>.jpg
//   admins.json  — администраторы (npm run admin)
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { PHOTO_ID, readBundle } from '../src/family/bundle.js';
import { createAuth } from './auth.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const COOKIE = 'memento_session';
const LOGIN_BODY = 16 * 1024;
const FAMILY_BODY = 64 * 1024 * 1024;

const httpError = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'Слишком большой запрос');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'Тело запроса — не JSON');
  }
}

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

// trustProxy — сервер стоит за одним своим прокси (nginx, хостинг): адрес
// посетителя — последний в X-Forwarded-For, его дописал прокси. Начало списка
// присылает сам клиент, ему верить нельзя.
export function createApp({ root, dataDir, trustProxy = false }) {
  const clientIp = (req) =>
    (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim()) || req.socket.remoteAddress;
  const familyFile = join(dataDir, 'family.json');
  const photoDir = join(dataDir, 'photos');
  const auth = createAuth({ file: join(dataDir, 'admins.json') });
  let publishing = Promise.resolve(); // публикации идут по одной

  async function published() {
    try {
      return JSON.parse(await readFile(familyFile, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  // Правки — только из своего приложения: заголовок, который форма с чужого
  // сайта поставить не может, и совпадающий Origin (если браузер его прислал).
  function sameOrigin(req) {
    if (req.headers['x-memento'] !== '1') return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  const sessionCookie = (req, token, maxAge) => {
    const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
  };

  async function api(req, res, path) {
    const method = req.method;
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) throw httpError(403, 'Запрос не из приложения');
    const token = cookieOf(req, COOKIE);

    if (path === '/api/me' && method === 'GET') return send(res, 200, { admin: await auth.check(token) });

    if (path === '/api/login' && method === 'POST') {
      const { login, password } = (await readBody(req, LOGIN_BODY)) || {};
      const fresh = await auth.login(clientIp(req), login, password);
      return send(res, 200, { admin: login }, { 'set-cookie': sessionCookie(req, fresh, auth.SESSION_MS / 1000) });
    }

    if (path === '/api/logout' && method === 'POST') {
      auth.logout(token);
      return send(res, 200, { admin: null }, { 'set-cookie': sessionCookie(req, '', 0) });
    }

    if (path === '/api/family' && method === 'GET') {
      const data = await published();
      if (!data) return send(res, 404, { error: 'Семья ещё не опубликована' });
      // Логины администраторов видны только им самим.
      if (!(await auth.check(token))) delete data.by;
      return send(res, 200, data);
    }

    if (path === '/api/family' && method === 'PUT') {
      const admin = await auth.check(token);
      if (!admin) throw httpError(401, 'Публиковать могут только администраторы. Войдите');
      const body = (await readBody(req, FAMILY_BODY)) || {};
      const run = publishing.then(async () => {
        // Пока тело шло по сети, администратора могли удалить или сессия истекла.
        if ((await auth.check(token)) !== admin) throw httpError(401, 'Сессия закончилась. Войдите снова');
        // Кто-то опубликовал после того, как этот администратор взял семью.
        const current = await published();
        if (current && body.base !== current.savedAt) {
          throw httpError(409, `На сервере уже есть более новая версия (${current.savedAt}, опубликовал ${current.by ?? 'администратор'})`);
        }
        await mkdir(photoDir, { recursive: true });
        // Фото, которые уже лежат на сервере, присылать заново не нужно.
        const stored = new Set((await readdir(photoDir)).filter((n) => n.endsWith('.jpg')).map((n) => n.slice(0, -4)));
        let bundle;
        try {
          bundle = readBundle(body.bundle, { known: stored });
        } catch (err) {
          throw httpError(400, err.message);
        }
        // id фото неизменны: под старым id не может оказаться другая картинка
        // (браузеры кэшируют фото навсегда), поэтому лежащие уже не перезаписываем.
        for (const [id, b64] of Object.entries(bundle.photos)) {
          if (!stored.has(id)) await writeAtomic(join(photoDir, `${id}.jpg`), Buffer.from(b64, 'base64'));
        }
        // Версия всегда новее предыдущей, даже в ту же миллисекунду.
        const last = current ? Date.parse(current.savedAt) || 0 : 0;
        const savedAt = new Date(Math.max(Date.now(), last + 1)).toISOString();
        await writeAtomic(familyFile, JSON.stringify({ savedAt, by: admin, family: bundle.fam }));
        // Портреты, на которые никто больше не ссылается, удаляем.
        const used = new Set(bundle.fam.people.map((p) => p.photo).filter(Boolean));
        for (const id of stored) if (!used.has(id)) await unlink(join(photoDir, `${id}.jpg`)).catch(() => {});
        return savedAt;
      });
      publishing = run.catch(() => {});
      return send(res, 200, { savedAt: await run });
    }

    const photo = path.match(/^\/api\/photos\/([^/]+)$/);
    if (photo && method === 'GET') {
      if (!PHOTO_ID.test(photo[1])) throw httpError(404, 'Нет такого фото');
      try {
        const body = await readFile(join(photoDir, `${photo[1]}.jpg`));
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
        return res.end(body);
      } catch {
        throw httpError(404, 'Нет такого фото');
      }
    }

    throw httpError(404, 'Нет такого адреса');
  }

  // Наружу — только само приложение: index.html и src/. Данные, сервер,
  // скрипты и .git не отдаются.
  async function staticFile(req, res, path) {
    const rel = path === '/' ? 'index.html' : path.slice(1);
    const file = normalize(join(root, rel));
    const allowed = rel === 'index.html' || file.startsWith(join(root, 'src') + sep);
    if (!allowed || !file.startsWith(root + sep) || rel.split('/').some((part) => part.startsWith('.'))) {
      res.writeHead(404).end('Not found');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }

  return createServer(async (req, res) => {
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!path.startsWith('/api/')) return staticFile(req, res, path);
    try {
      await api(req, res, path);
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500) console.error(err);
      send(res, status, { error: status === 500 ? 'Ошибка сервера' : err.message });
    }
  });
}
