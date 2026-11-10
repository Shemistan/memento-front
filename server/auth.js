// Администраторы: кто может публиковать семью. Список — файл admins.json
// ({ admins: { логин: { salt, hash } } }), пароли — только хеши scrypt.
// Правится командой npm run admin; файл перечитывается при каждом входе и
// проверке, так что удалённый администратор теряет права сразу.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEYLEN = 32;
export const LOGIN = /^[a-zA-Z0-9._-]{2,40}$/;
export const MIN_PASSWORD = 8;
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FAILS = 10; // неудачных входов с одного адреса…
const LOCK_MS = 15 * 60 * 1000; // …и столько ждать после них
const MAX_TRACKED = 10000; // адресов в памяти; самые старые забываются
const MAX_CHECKING = 8; // одновременных проверок пароля на весь сервер

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, KEYLEN);
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

export async function readAdmins(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data && typeof data.admins === 'object' && data.admins ? data.admins : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

export async function writeAdmins(file, admins) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ admins }, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

// Неизвестный логин проверяется так же долго, как известный: по времени
// ответа не узнать, кто администратор.
const DUMMY = { salt: randomBytes(16).toString('base64'), hash: randomBytes(KEYLEN).toString('base64') };

async function passwordMatches(password, record) {
  const expected = Buffer.from(record.hash, 'base64');
  const actual = await scrypt(String(password), Buffer.from(record.salt, 'base64'), KEYLEN);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createAuth({ file, now = Date.now }) {
  const sessions = new Map(); // токен → { login, expires }
  const attempts = new Map(); // адрес → { count, since, until }
  let checking = 0; // проверок пароля прямо сейчас (scrypt нагружает процессор)

  const tooMany = (message) => Object.assign(new Error(message), { status: 429 });

  // Попытка засчитывается до проверки пароля: параллельные запросы не обойдут
  // предел, пока ждут scrypt. Успешный вход счётчик сбрасывает.
  function reserve(ip) {
    const t = now();
    let rec = attempts.get(ip);
    if (rec && rec.until > t) throw tooMany('Слишком много попыток. Попробуйте через 15 минут');
    if (!rec || rec.since + LOCK_MS <= t) rec = { count: 0, since: t, until: 0 };
    rec.count += 1;
    if (rec.count >= MAX_FAILS) rec.until = t + LOCK_MS;
    attempts.delete(ip); // переставляем в конец: первыми в карте — самые старые
    attempts.set(ip, rec);
    for (const key of attempts.keys()) {
      if (attempts.size <= MAX_TRACKED) break;
      attempts.delete(key);
    }
  }

  async function login(ip, loginName, password) {
    if (checking >= MAX_CHECKING) throw tooMany('Сервер занят, попробуйте через минуту');
    reserve(ip);
    checking += 1;
    let ok;
    let name;
    try {
      const admins = await readAdmins(file);
      name = String(loginName ?? '');
      const record = LOGIN.test(name) && Object.hasOwn(admins, name) ? admins[name] : null;
      ok = (await passwordMatches(password ?? '', record ?? DUMMY)) && record !== null;
    } finally {
      checking -= 1;
    }
    if (!ok) throw Object.assign(new Error('Неверный логин или пароль'), { status: 401 });
    attempts.delete(ip);
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { login: name, expires: now() + SESSION_MS });
    return token;
  }

  // Логин администратора по токену или null: сессия жива и он всё ещё в списке.
  async function check(token) {
    const session = token ? sessions.get(token) : null;
    if (!session) return null;
    if (session.expires <= now() || !Object.hasOwn(await readAdmins(file), session.login)) {
      sessions.delete(token);
      return null;
    }
    return session.login;
  }

  const logout = (token) => sessions.delete(token);

  return { login, check, logout, SESSION_MS };
}
