// Файл семьи: семья и портреты (JPEG в base64) одним JSON. Один формат на
// всё: скачать файл, загрузить его обратно, опубликовать на сервере. Модуль
// без DOM — им же проверяет публикацию сервер.
import { deserialize, serialize } from './model.js';

export const FORMAT = 'memento-family';
export const VERSION = 1;
export const LIMITS = { people: 5000, name: 120, photoBytes: 512 * 1024 };
export const PHOTO_ID = /^ph[a-z0-9]{1,40}$/;
const PERSON_ID = /^p\d{1,9}$/;
const UNION_ID = /^u\d{1,9}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const JPEG = '/9j/'; // FF D8 FF — начало любого JPEG в base64

// Последние два байта — FF D9 (конец JPEG). Хвост base64 разбираем вручную:
// модуль работает и в браузере, и на сервере.
function isJpegEnd(b64) {
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const tail = b64.slice(-8);
  if (tail.length < 8) return false;
  let bits = '';
  for (const ch of tail.replace(/=+$/, '')) bits += ABC.indexOf(ch).toString(2).padStart(6, '0');
  const bytes = bits.slice(0, bits.length - (bits.length % 8)).match(/.{8}/g).map((b) => parseInt(b, 2));
  return bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
}

export function makeBundle(fam, photos = {}, savedAt = new Date().toISOString()) {
  return { format: FORMAT, version: VERSION, savedAt, family: JSON.parse(serialize(fam)), photos };
}

// Проверяет файл семьи и возвращает { fam, photos, savedAt }. В photos — только
// портреты, на которые ссылаются люди; человек, чьего фото нет ни в файле, ни
// среди known (уже лежащих у получателя), остаётся без портрета. Чужой или
// битый файл — понятная ошибка.
export function readBundle(data, { known = new Set() } = {}) {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error('Это не файл семьи: внутри не JSON');
    }
  }
  if (!data || data.format !== FORMAT) throw new Error('Это не файл семьи Memento');
  if (data.version !== VERSION) throw new Error(`Неизвестная версия файла семьи: ${data.version}`);
  const raw = data.family;
  if (!raw || !Array.isArray(raw.people) || !Array.isArray(raw.unions)) throw new Error('В файле нет семьи');
  if (!raw.people.length) throw new Error('В файле пустая семья');
  if (raw.people.length > LIMITS.people || raw.unions.length > LIMITS.people) throw new Error('Слишком большая семья');
  // seq — счётчик для новых id: огромный или дробный ломает их уникальность.
  if (raw.seq !== undefined && !(Number.isInteger(raw.seq) && raw.seq >= 0 && raw.seq < 1e9)) throw new Error('Неверный счётчик id в файле');
  const ids = new Set();
  for (const p of raw.people) {
    if (!PERSON_ID.test(String(p?.id))) throw new Error(`Неверный id человека: ${String(p?.id).slice(0, 20)}`);
    if (ids.has(p.id)) throw new Error(`Человек ${p.id} записан дважды`);
    ids.add(p.id);
    if (String(p.name ?? '').length > LIMITS.name) throw new Error(`Слишком длинное имя у ${p.id}`);
    if (p.photo != null && !PHOTO_ID.test(String(p.photo))) throw new Error(`Неверный id фото у ${p.id}`);
  }
  for (const u of raw.unions) {
    if (!UNION_ID.test(String(u?.id))) throw new Error(`Неверный id пары: ${String(u?.id).slice(0, 20)}`);
    if (ids.has(u.id)) throw new Error(`Пара ${u.id} записана дважды`);
    ids.add(u.id);
  }
  const fam = deserialize(JSON.stringify(raw));
  const given = data.photos && typeof data.photos === 'object' ? data.photos : {};
  const photos = {};
  for (const person of fam.people) {
    if (!person.photo) continue;
    const b64 = Object.hasOwn(given, person.photo) ? given[person.photo] : null;
    if (typeof b64 !== 'string') {
      if (!known.has(person.photo)) person.photo = null;
      continue;
    }
    if (b64.length > Math.ceil(LIMITS.photoBytes / 3) * 4) throw new Error(`Фото ${person.name} слишком большое`);
    // Начало и конец JPEG (FF D8 … FF D9); глубже не разбираем — картинку
    // показывает браузер как image/jpeg, повреждённая просто не отрисуется.
    if (!BASE64.test(b64) || !b64.startsWith(JPEG) || !isJpegEnd(b64)) throw new Error(`Фото ${person.name} повреждено или не JPEG`);
    photos[person.photo] = b64;
  }
  return { fam, photos, savedAt: typeof data.savedAt === 'string' ? data.savedAt : null };
}
