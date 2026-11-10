import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { hashPassword, writeAdmins } from '../server/auth.js';
import { makeBundle, readBundle } from '../src/family/bundle.js';
import { parseFamily, setPhoto } from '../src/family/model.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]).toString('base64');
let dir;
let server;
let base;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memento-'));
  await writeAdmins(join(dir, 'admins.json'), { anna: await hashPassword('секрет-анны') });
  server = createApp({ root: ROOT, dataDir: dir });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const APP = { 'content-type': 'application/json', 'x-memento': '1' };
const call = (path, { method = 'GET', body, cookie, headers = APP } = {}) =>
  fetch(base + path, { method, headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: body && JSON.stringify(body) });

async function login(password = 'секрет-анны') {
  const res = await call('/api/login', { method: 'POST', body: { login: 'anna', password } });
  return { res, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

function family(photo = null) {
  const fam = parseFamily('Николай 1926\n  + Анна 1929 (1950)\n    Пётр 1952');
  if (photo) setPhoto(fam, fam.people[0].id, photo);
  return fam;
}

test('приложение раздаётся, данные и служебные файлы — нет', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/src/app.js')).status, 200);
  for (const path of ['/data/admins.json', '/server/auth.js', '/package.json', '/.git/config', '/src/../data/admins.json', '/%2e%2e/etc/passwd']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('без входа можно смотреть, но нельзя публиковать', async () => {
  assert.deepEqual(await (await call('/api/me')).json(), { admin: null });
  assert.equal((await call('/api/family')).status, 404, 'пока ничего не опубликовано');
  const res = await call('/api/family', { method: 'PUT', body: { bundle: makeBundle(family()) } });
  assert.equal(res.status, 401);
});

test('вход: неверный пароль отклоняется, верный даёт сессию в HttpOnly-куке', async () => {
  const bad = await login('не тот');
  assert.equal(bad.res.status, 401);
  assert.equal(bad.cookie, undefined);
  const unknown = await call('/api/login', { method: 'POST', body: { login: 'nobody', password: 'секрет-анны' } });
  assert.equal(unknown.status, 401);
  assert.equal((await unknown.json()).error, (await bad.res.json()).error, 'по ответу не понять, есть ли такой логин');

  const { res, cookie } = await login();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.deepEqual(await (await call('/api/me', { cookie })).json(), { admin: 'anna' });
  await call('/api/logout', { method: 'POST', cookie });
  assert.deepEqual(await (await call('/api/me', { cookie })).json(), { admin: null }, 'после выхода сессия недействительна');
  assert.deepEqual(await (await call('/api/me', { cookie: 'memento_session=forged' })).json(), { admin: null });
});

test('правки с чужого сайта отклоняются', async () => {
  const { cookie } = await login();
  const bundle = makeBundle(family());
  const noHeader = await call('/api/family', { method: 'PUT', cookie, body: { bundle }, headers: { 'content-type': 'application/json' } });
  assert.equal(noHeader.status, 403);
  const foreign = await call('/api/family', { method: 'PUT', cookie, body: { bundle }, headers: { ...APP, origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
});

test('администратор публикует семью с фото, все её получают', async () => {
  const { cookie } = await login();
  const fam = family('phabc1');
  const res = await call('/api/family', { method: 'PUT', cookie, body: { bundle: makeBundle(fam, { phabc1: JPEG }) } });
  assert.equal(res.status, 200, await res.clone().text());
  const { savedAt } = await res.json();

  const got = await (await call('/api/family')).json();
  assert.equal(got.savedAt, savedAt);
  assert.equal(got.by, undefined, 'посетителям логин администратора не виден');
  assert.equal((await (await call('/api/family', { cookie })).json()).by, 'anna');
  assert.equal(got.family.people.length, 3);
  assert.equal(got.family.people[0].photo, 'phabc1');
  const photo = await fetch(`${base}/api/photos/phabc1`);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await photo.arrayBuffer()).toString('base64'), JPEG);
  assert.equal((await fetch(`${base}/api/photos/..%2Fadmins`)).status, 404);

  // Следующая публикация без самого фото: сервер оставляет то, что у него есть.
  const again = await call('/api/family', { method: 'PUT', cookie, body: { bundle: makeBundle(fam), base: savedAt } });
  assert.equal(again.status, 200);
  const next = await again.json();
  assert.equal((await (await call('/api/family')).json()).family.people[0].photo, 'phabc1');

  // Устаревшая база — кто-то опубликовал раньше: конфликт, а не затирание.
  const stale = await call('/api/family', { method: 'PUT', cookie, body: { bundle: makeBundle(fam), base: savedAt } });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /более новая версия/);

  // Фото больше не нужно — удаляется с сервера.
  const done = await call('/api/family', { method: 'PUT', cookie, body: { bundle: makeBundle(family()), base: next.savedAt } });
  assert.equal(done.status, 200);
  assert.deepEqual(await readdir(join(dir, 'photos')), []);
});

test('битый файл семьи — понятная ошибка 400, опубликованное не портится', async () => {
  const { cookie } = await login();
  const before = await (await call('/api/family')).json();
  for (const bundle of [{ format: 'другой' }, { ...makeBundle(family()), family: { people: [{ id: '../x' }], unions: [] } }, null]) {
    const res = await call('/api/family', { method: 'PUT', cookie, body: { bundle, base: before.savedAt } });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
  }
  assert.deepEqual(await (await call('/api/family')).json(), before);
});

test('фото под уже опубликованным id не подменяется', async () => {
  const { cookie } = await login();
  const current = await (await call('/api/family')).json();
  const first = await call('/api/family', { method: 'PUT', cookie, body: { bundle: makeBundle(family('phkeep'), { phkeep: JPEG }), base: current.savedAt } });
  const { savedAt } = await first.json();
  const other = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 7, 7, 0xff, 0xd9]).toString('base64');
  const second = await call('/api/family', { method: 'PUT', cookie, body: { bundle: makeBundle(family('phkeep'), { phkeep: other }), base: savedAt } });
  assert.equal(second.status, 200);
  const photo = Buffer.from(await (await fetch(`${base}/api/photos/phkeep`)).arrayBuffer()).toString('base64');
  assert.equal(photo, JPEG);
});

test('удалённый администратор сразу теряет права', async () => {
  const { cookie } = await login();
  await writeAdmins(join(dir, 'admins.json'), {});
  assert.deepEqual(await (await call('/api/me', { cookie })).json(), { admin: null });
  await writeAdmins(join(dir, 'admins.json'), { anna: await hashPassword('секрет-анны') });
});

test('после 10 неудачных входов адрес блокируется', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await login('мимо')).res.status, 401);
  assert.equal((await login()).res.status, 429, 'даже верный пароль не принимается');
});

test('за своим прокси блокируется адрес посетителя, а не прокси', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'memento-proxy-'));
  await writeAdmins(join(dataDir, 'admins.json'), { anna: await hashPassword('секрет-анны') });
  const proxied = createApp({ root: ROOT, dataDir, trustProxy: true });
  await new Promise((done) => proxied.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${proxied.address().port}/api/login`;
  const attempt = (ip, password) =>
    fetch(url, { method: 'POST', headers: { ...APP, 'x-forwarded-for': ip }, body: JSON.stringify({ login: 'anna', password }) });
  // Клиент подставляет свой «адрес» в начало списка — считается последний, от прокси.
  for (let i = 0; i < 10; i++) await attempt(`10.0.0.${i}, 203.0.113.7`, 'мимо');
  assert.equal((await attempt('10.9.9.9, 203.0.113.7', 'секрет-анны')).status, 429, 'подделка начала списка не помогает');
  assert.equal((await attempt('198.51.100.2', 'секрет-анны')).status, 200, 'другой посетитель входит');

  // Параллельные попытки засчитываются до проверки пароля.
  const burst = await Promise.all(Array.from({ length: 16 }, () => attempt('192.0.2.50', 'мимо')));
  assert.ok(burst.filter((r) => r.status === 401).length <= 10, 'не больше 10 проверок пароля');
  assert.ok(burst.some((r) => r.status === 429));
  proxied.close();
  await rm(dataDir, { recursive: true, force: true });
});

test('файл семьи: проверка формата и фото', () => {
  const fam = family('phx');
  const bundle = makeBundle(fam, { phx: JPEG });
  const back = readBundle(JSON.stringify(bundle));
  assert.equal(back.fam.people.length, 3);
  assert.equal(back.photos.phx, JPEG);
  assert.equal(readBundle(makeBundle(fam)).fam.people[0].photo, null, 'фото нет в файле — человек без портрета');
  assert.equal(readBundle(makeBundle(fam), { known: new Set(['phx']) }).fam.people[0].photo, 'phx');
  assert.throws(() => readBundle('не json'), /не JSON/);
  assert.throws(() => readBundle({ format: 'x' }), /не файл семьи/);
  assert.throws(() => readBundle(makeBundle(fam, { phx: 'PGh0bWw+' })), /не JPEG/);
  const twice = makeBundle(fam);
  twice.family.people.push({ ...twice.family.people[0] });
  assert.throws(() => readBundle(twice), /дважды/);
  const long = makeBundle(fam);
  long.family.people[0].name = 'я'.repeat(500);
  assert.throws(() => readBundle(long), /длинное имя/);
  assert.throws(() => readBundle({ ...makeBundle(fam), family: { people: [], unions: [] } }), /пустая/);
  const cut = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
  assert.throws(() => readBundle(makeBundle(fam, { phx: cut })), /не JPEG/, 'обрезанный JPEG');
  const seq = makeBundle(fam);
  seq.family.seq = 1e100;
  assert.throws(() => readBundle(seq), /счётчик/);
});

test('админы хранятся только хешами', async () => {
  const file = join(dir, 'check.json');
  await writeAdmins(file, { bob: await hashPassword('пароль-боба') });
  const text = await (await import('node:fs/promises')).readFile(file, 'utf8');
  assert.ok(!text.includes('пароль-боба'));
  await writeFile(file, '');
});
