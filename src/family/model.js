// Семья: люди, пары и кто от кого родился. Только данные, без отрисовки.
// Человек: { id: 'pN', name, born, bornDate, dead, died, diedDate, photo, parent,
// added }; parent — id пары (ребёнок пары), id человека (ребёнок без пары) или
// null (корень своего дерева). born/died — год, bornDate/diedDate — полная дата
// 'ГГГГ-ММ-ДД', если известна. dead — человека нет в живых (год может быть
// неизвестен). photo — id портрета в хранилище фото (family/photos.js).
// Пара: { id: 'uN', host, partner, since, sinceDate } — дети пары растут на
// дереве host, лиана тянется к нему от partner.
import { ROOT_ID } from '../model.js';

export function createFamily() {
  return { seq: 0, people: [], unions: [] };
}

export const isUnionId = (id) => typeof id === 'string' && id.startsWith('u');
export const getPerson = (fam, id) => fam.people.find((p) => p.id === id) || null;
export const getUnion = (fam, id) => fam.unions.find((u) => u.id === id) || null;
export const childrenOf = (fam, parentId) => fam.people.filter((p) => p.parent === parentId);
export const roots = (fam) => fam.people.filter((p) => p.parent === null);

const cleanName = (name, fallback) => String(name ?? '').trim() || fallback;
// --- даты ---
// Дата — год или полная: «1926», «12.03.1926», «1926-03-12». Хранится как
// { year, date }: date — 'ГГГГ-ММ-ДД' или null, если известен только год.

const validYear = (y) => Number.isInteger(y) && y > 0 && y < 3000;
const pad = (n, w = 2) => String(n).padStart(w, '0');

// null — даты нет; undefined — ввод не похож на дату.
export function parseDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return validYear(Math.round(value)) ? { year: Math.round(value), date: null } : undefined;
  const text = String(value).trim();
  if (!text || text === '?') return null;
  if (/^\d{1,4}$/.test(text)) return validYear(Number(text)) ? { year: Number(text), date: null } : undefined;
  let m = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{3,4})$/);
  const [y, mo, d] = m ? [m[3], m[2], m[1]].map(Number) : (text.match(/^(\d{3,4})-(\d{1,2})-(\d{1,2})$/) || []).slice(1).map(Number);
  if (!y) return undefined;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (!validYear(y) || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return undefined;
  return { year: y, date: `${pad(y, 4)}-${pad(mo)}-${pad(d)}` };
}

export function formatDate(year, date = null) {
  if (date) {
    const [y, m, d] = date.split('-');
    return `${d}.${m}.${Number(y)}`;
  }
  return year === null || year === undefined ? '' : String(year);
}

// Дробный год: для порядка и проверок, когда известна полная дата.
export function stamp(year, date = null) {
  if (year === null || year === undefined) return null;
  if (!date) return year;
  const [y, m, d] = date.split('-').map(Number);
  return y + (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 31622400000;
}

function toDate(value) {
  const parsed = parseDate(value);
  if (parsed === undefined) throw new Error(`Не похоже на дату: «${value}». Пишите год или дд.мм.гггг`);
  return parsed;
}

// Мягкий разбор для старых и чужих данных: непонятное — как «нет даты».
const softDate = (value) => parseDate(value) ?? null;


// Пары, где человек — host, по году брака (без года — в конце, по порядку создания).
export function unionsOf(fam, personId) {
  const hosted = fam.unions.filter((u) => u.host === personId);
  return hosted
    .map((u, i) => ({ u, i }))
    .sort((a, b) => (stamp(a.u.since, a.u.sinceDate) ?? Infinity) - (stamp(b.u.since, b.u.sinceDate) ?? Infinity) || a.i - b.i)
    .map(({ u }) => u);
}

export const partnerUnionsOf = (fam, personId) => fam.unions.filter((u) => u.partner === personId);

// Супруг «со стороны»: без предков, без детей и своих пар, в одной паре.
// В тексте пишется прямо в строке пары, в редакторе стоит рядом с супругом.
export function isOutsidePartner(fam, person) {
  return (
    person.parent === null &&
    !childrenOf(fam, person.id).length &&
    !fam.unions.some((u) => u.host === person.id) &&
    partnerUnionsOf(fam, person.id).length === 1
  );
}

// Человек, на чьей ветке растут дети parentId (для пары — её host).
export function carrierOf(fam, parentId) {
  return isUnionId(parentId) ? getUnion(fam, parentId)?.host ?? null : parentId;
}

export function rootOf(fam, personId) {
  let person = getPerson(fam, personId);
  const seen = new Set();
  while (person && person.parent !== null && !seen.has(person.id)) {
    seen.add(person.id);
    person = getPerson(fam, carrierOf(fam, person.parent));
  }
  return person;
}

// --- кто смотрит ---
// Главное дерево зависит от того, кто смотрит: в каждой паре ветку с детьми
// держит тот из супругов, кто ближе смотрящему по крови, лиана тянется от
// другого. Родня папы видит главным его дерево, родня мамы — её.

// Расстояние по крови от человека до всех родных: шаг — родитель или ребёнок.
export function bloodDistances(fam, fromId) {
  const near = new Map(fam.people.map((p) => [p.id, []]));
  for (const child of fam.people) {
    const union = isUnionId(child.parent) ? getUnion(fam, child.parent) : null;
    const elders = union ? [union.host, union.partner] : child.parent === null ? [] : [child.parent];
    for (const elder of elders) {
      if (!near.has(elder)) continue;
      near.get(elder).push(child.id);
      near.get(child.id).push(elder);
    }
  }
  const dist = new Map();
  if (!near.has(fromId)) return dist;
  dist.set(fromId, 0);
  const queue = [fromId];
  for (let i = 0; i < queue.length; i++) {
    for (const next of near.get(queue[i])) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(queue[i]) + 1);
      queue.push(next);
    }
  }
  return dist;
}

// Семья глазами viewerId: копия, где пары развёрнуты к смотрящему. Хранимая
// семья не меняется. Без смотрящего (или если он не найден) — как записано.
export function viewFrom(fam, viewerId) {
  if (!viewerId || !getPerson(fam, viewerId)) return { ...fam, viewer: null };
  const dist = bloodDistances(fam, viewerId);
  const far = (id) => dist.get(id) ?? Infinity;
  const seen = { ...fam, unions: [...fam.unions], viewer: viewerId };
  seen.unions.forEach((u, i) => {
    if (far(u.partner) >= far(u.host)) return;
    const flipped = { ...u, host: u.partner, partner: u.host };
    // Разворот не должен сделать ребёнка пары предком нового host (запутанные данные).
    const kids = new Set(childrenOf(seen, u.id).map((p) => p.id));
    for (let up = flipped.host, guard = new Set(); up && !guard.has(up); up = carrierOf(seen, getPerson(seen, up)?.parent ?? null)) {
      if (kids.has(up)) return;
      guard.add(up);
    }
    seen.unions[i] = flipped;
  });
  return seen;
}

// Правка «как видно»: change получает семью глазами viewerId (удаление ветки,
// разрыв пары работают по видимым веткам), потом пары возвращаются к
// записанному виду. Если change бросил ошибку, семья не меняется.
export function editAsSeen(fam, viewerId, change) {
  const seen = structuredClone(viewFrom(fam, viewerId));
  const result = change(seen);
  const stored = new Map(fam.unions.map((u) => [u.id, u]));
  fam.seq = seen.seq;
  fam.people = seen.people;
  fam.unions = seen.unions.map((u) => (stored.has(u.id) ? { ...u, host: stored.get(u.id).host, partner: stored.get(u.id).partner } : u));
  return result;
}

// Корень главного дерева: дерево смотрящего, без него — первое.
export function mainRoot(fam) {
  return (fam.viewer && rootOf(fam, fam.viewer)) || roots(fam)[0] || null;
}

export function addPerson(fam, { name, born = null, died = null, dead = false, parent = null, added = 0, before = null } = {}) {
  if (parent !== null && !(isUnionId(parent) ? getUnion(fam, parent) : getPerson(fam, parent))) {
    throw new Error(`Нет родителя ${parent}`);
  }
  fam.seq += 1;
  const birth = toDate(born);
  const person = {
    id: `p${fam.seq}`,
    name: cleanName(name, `Человек ${fam.seq}`),
    born: birth?.year ?? null,
    bornDate: birth?.date ?? null,
    parent,
    added,
    photo: null,
  };
  setDeath(person, { dead, died });
  // before — встать в списке перед этим человеком: порядок корней задаёт,
  // какое дерево главное.
  const at = before ? fam.people.findIndex((p) => p.id === before) : -1;
  if (at >= 0) fam.people.splice(at, 0, person);
  else fam.people.push(person);
  return person;
}

// Год смерти делает человека ушедшим; dead без года — «умер, год неизвестен».
function setDeath(person, { dead, died }) {
  const death = toDate(died);
  person.died = death?.year ?? null;
  person.diedDate = death?.date ?? null;
  person.dead = Boolean(dead) || death !== null;
}

export function setDied(fam, id, { dead = false, died = null } = {}) {
  const person = getPerson(fam, id);
  if (person) setDeath(person, { dead, died });
  return person;
}

// Добавляет родителя: у корня — нового предка (человек встаёт в его дерево);
// у ребёнка без пары — второго родителя, и родители становятся парой.
export function canAddParent(fam, id) {
  const person = getPerson(fam, id);
  return Boolean(person) && !isUnionId(person.parent);
}

export function addParent(fam, childId, fields = {}) {
  const child = getPerson(fam, childId);
  if (!child) throw new Error('Нет такого человека');
  if (isUnionId(child.parent)) throw new Error('Оба родителя уже есть');
  if (child.parent === null) {
    const parent = addPerson(fam, { ...fields, before: child.id });
    child.parent = parent.id;
    return { parent };
  }
  const parent = addPerson(fam, fields);
  const union = addUnion(fam, child.parent, parent.id);
  child.parent = union.id;
  return { parent, union };
}

export function addUnion(fam, hostId, partnerId, since = null) {
  if (!getPerson(fam, hostId) || !getPerson(fam, partnerId)) throw new Error('Нет такого человека');
  if (hostId === partnerId) throw new Error('Пара из одного человека невозможна');
  const same = fam.unions.some(
    (u) => (u.host === hostId && u.partner === partnerId) || (u.host === partnerId && u.partner === hostId),
  );
  if (same) throw new Error('Такая пара уже есть');
  fam.seq += 1;
  const married = toDate(since);
  const union = { id: `u${fam.seq}`, host: hostId, partner: partnerId, since: married?.year ?? null, sinceDate: married?.date ?? null };
  fam.unions.push(union);
  return union;
}

export function renamePerson(fam, id, name) {
  const person = getPerson(fam, id);
  const clean = String(name ?? '').trim();
  if (person && clean) person.name = clean;
  return person;
}

export function setBorn(fam, id, value) {
  const person = getPerson(fam, id);
  const birth = toDate(value);
  if (person) {
    person.born = birth?.year ?? null;
    person.bornDate = birth?.date ?? null;
  }
  return person;
}

export function setPhoto(fam, id, photoId) {
  const person = getPerson(fam, id);
  if (person) person.photo = photoId ?? null;
  return person;
}

// Кому из родителей принадлежит ребёнок: одному человеку или паре. Варианты —
// нынешний «носитель» ребёнка и все пары, где он host или partner.
export function parentOptions(fam, childId) {
  const child = getPerson(fam, childId);
  if (!child || child.parent === null) return [];
  const carrier = carrierOf(fam, child.parent);
  const unions = fam.unions.filter((u) => u.host === carrier || u.partner === carrier);
  return [carrier, ...unions.map((u) => u.id)];
}

// Перевесить ребёнка на другого родителя или пару. Потомок не может стать
// родителем своего предка.
export function setParent(fam, childId, parentId) {
  const child = getPerson(fam, childId);
  if (!child) throw new Error('Нет такого человека');
  const union = isUnionId(parentId) ? getUnion(fam, parentId) : null;
  const elders = union ? [union.host, union.partner] : [parentId];
  if (!elders.every((id) => getPerson(fam, id))) throw new Error('Нет такого родителя');
  for (const elder of elders) {
    let cur = elder;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      if (cur === childId) throw new Error('Потомок не может быть родителем своего предка');
      seen.add(cur);
      cur = carrierOf(fam, getPerson(fam, cur)?.parent ?? null);
    }
  }
  child.parent = parentId;
  return child;
}

export function setSince(fam, id, year) {
  const union = getUnion(fam, id);
  const married = toDate(year);
  if (union) {
    union.since = married?.year ?? null;
    union.sinceDate = married?.date ?? null;
  }
  return union;
}

// Пара распадается: её дети остаются детьми host.
export function removeUnion(fam, id) {
  const union = getUnion(fam, id);
  if (!union) return;
  for (const child of childrenOf(fam, id)) child.parent = union.host;
  fam.unions = fam.unions.filter((u) => u !== union);
}

// Удаляет человека и его потомков на его ветке: детей без пары и детей пар,
// где он host. Пары, где он partner, распадаются — их дети остаются у host.
export function removePerson(fam, id) {
  if (!getPerson(fam, id)) return [];
  const doomed = new Set();
  const visit = (pid) => {
    if (doomed.has(pid)) return;
    doomed.add(pid);
    for (const child of childrenOf(fam, pid)) visit(child.id);
    for (const union of unionsOf(fam, pid)) for (const child of childrenOf(fam, union.id)) visit(child.id);
  };
  visit(id);
  for (const union of fam.unions.filter((u) => doomed.has(u.partner) && !doomed.has(u.host))) removeUnion(fam, union.id);
  fam.unions = fam.unions.filter((u) => !doomed.has(u.host) && !doomed.has(u.partner));
  fam.people = fam.people.filter((p) => !doomed.has(p.id));
  return [...doomed];
}

// --- текстовый формат ---
// «Имя 1950» — человек; «Имя 1926–1998» — с годом смерти, «Имя 1926–?» —
// умер, год неизвестен. Вместо года — полная дата: «12.03.1926».
// Отступ — ребёнок строки выше.
// «+ Имя 1952 (1975)» — пара с человеком выше; её дети — с отступом под ней.
// «+ @Имя 1952» — пара с человеком, описанным в другом месте (по имени и году).

const DATE = String.raw`\d{1,2}\.\d{1,2}\.\d{3,4}|\d{3,4}|\?`;
const LIFE = String.raw`(?:\s+(${DATE})(?:\s*([–—-])\s*(${DATE})?)?)?`;
const PERSON_RE = new RegExp(String.raw`^(.*?)${LIFE}$`);
const UNION_RE = new RegExp(String.raw`^\+\s*(@)?\s*(.*?)${LIFE}(?:\s*\((\d{1,2}\.\d{1,2}\.\d{3,4}|\d{3,4})\))?$`);

// Годы жизни для подписи: «1926», «1926–1998», «?–1998», «1926–?».
// full — с полными датами, где они известны: «12.03.1926–1998».
export function lifeText(person, { full = false } = {}) {
  const born = full ? formatDate(person.born, person.bornDate) : formatDate(person.born);
  const died = full ? formatDate(person.died, person.diedDate) : formatDate(person.died);
  if (!person.dead) return born;
  return `${born || '?'}–${died || '?'}`;
}

const life = (born, dash, died) => ({ born: born === '?' ? null : born, dead: Boolean(dash), died: died === '?' ? null : died });

export function parseFamily(text, added = 0) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((raw, i) => ({ raw: raw.replace(/\t/g, '  '), no: i + 1 }))
    .filter(({ raw }) => raw.trim() && !raw.trim().startsWith('#'));
  if (!lines.length) throw new Error('Пустая структура');

  const fam = createFamily();
  const stack = []; // { indent, id }
  const refs = [];
  for (const { raw, no } of lines) {
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim().replace(/^[-*•]\s+/, '');
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const above = stack[stack.length - 1]?.id ?? null;

    if (line.startsWith('+')) {
      const [, ref, name, born, dash, died, since] = line.match(UNION_RE);
      if (!above || isUnionId(above)) throw new Error(`Строка ${no}: пара должна стоять под человеком`);
      if (!name.trim()) throw new Error(`Строка ${no}: не указано имя супруга`);
      const married = toDate(since);
      const union = { id: null, host: above, partner: null, since: married?.year ?? null, sinceDate: married?.date ?? null };
      if (ref) refs.push({ union, name: name.trim(), born: toDate(born)?.year ?? null, no });
      else union.partner = addPerson(fam, { name, ...life(born, dash, died), added }).id;
      fam.seq += 1;
      union.id = `u${fam.seq}`;
      fam.unions.push(union);
      stack.push({ indent, id: union.id });
    } else {
      const [, name, born, dash, died] = line.match(PERSON_RE);
      const person = addPerson(fam, { name, ...life(born, dash, died), parent: above, added });
      stack.push({ indent, id: person.id });
    }
  }
  for (const { union, name, born, no } of refs) {
    const match = fam.people.find((p) => p.name === name && (born === null || p.born === born) && p.id !== union.host);
    if (!match) throw new Error(`Строка ${no}: не найден человек «${name}»`);
    union.partner = match.id;
  }
  return fam;
}

const lifeSuffix = (person) => {
  const text = lifeText(person, { full: true });
  return text ? ` ${text}` : '';
};

export function toFamilyText(fam) {
  const inline = (person) => isOutsidePartner(fam, person);
  const lines = [];
  const walkPerson = (person, depth) => {
    lines.push(`${'  '.repeat(depth)}${person.name}${lifeSuffix(person)}`);
    for (const child of childrenOf(fam, person.id)) walkPerson(child, depth + 1);
    for (const union of unionsOf(fam, person.id)) {
      const partner = getPerson(fam, union.partner);
      const since = union.since === null ? '' : ` (${formatDate(union.since, union.sinceDate)})`;
      // Ссылка ищет человека по имени и году рождения — смерть в ней лишняя.
      const who = inline(partner) ? `${partner.name}${lifeSuffix(partner)}` : `@${partner.name}${partner.born === null ? '' : ` ${partner.born}`}`;
      lines.push(`${'  '.repeat(depth + 1)}+ ${who}${since}`);
      for (const child of childrenOf(fam, union.id)) walkPerson(child, depth + 2);
    }
  };
  for (const root of roots(fam)) if (!inline(root)) walkPerson(root, 0);
  return lines.join('\n');
}

// --- проверки ---
// Мягкие предупреждения о вероятных опечатках в годах: Map id → [текст].
export function checks(fam) {
  const found = new Map();
  const warn = (id, text) => found.set(id, [...(found.get(id) ?? []), text]);
  const parentsOf = (person) => {
    if (person.parent === null) return [];
    if (!isUnionId(person.parent)) return [getPerson(fam, person.parent)];
    const union = getUnion(fam, person.parent);
    return [getPerson(fam, union.host), getPerson(fam, union.partner)];
  };
  const birth = (p) => stamp(p.born, p.bornDate);
  const death = (p) => stamp(p.died, p.diedDate);
  // Без полных дат сравниваем годы с запасом в год; с датами — точнее.
  const slack = (a, b) => (a && b ? 0.8 : 1);
  for (const person of fam.people) {
    if (person.born !== null && person.died !== null && death(person) < birth(person)) warn(person.id, 'Дата смерти раньше даты рождения');
    if (person.born === null) continue;
    for (const parent of parentsOf(person)) {
      if (!parent) continue;
      if (parent.died !== null && birth(person) > death(parent) + slack(person.bornDate, parent.diedDate)) {
        warn(person.id, `Родился(-ась) после смерти родителя: ${parent.name}, ${formatDate(parent.died, parent.diedDate)}`);
      }
      if (parent.born !== null && birth(person) - birth(parent) < 12) {
        warn(person.id, `Родитель слишком молод: ${parent.name}, ${formatDate(parent.born, parent.bornDate)}`);
      }
    }
  }
  for (const union of fam.unions) {
    if (union.since === null) continue;
    const married = stamp(union.since, union.sinceDate);
    for (const id of [union.host, union.partner]) {
      const person = getPerson(fam, id);
      if (person.died !== null && married > death(person) + (union.sinceDate && person.diedDate ? 0 : 0.99)) {
        warn(union.id, `Брак после смерти: ${person.name}, ${formatDate(person.died, person.diedDate)}`);
      }
      if (person.born !== null && married < birth(person)) warn(union.id, `Брак раньше рождения: ${person.name}, ${formatDate(person.born, person.bornDate)}`);
    }
  }
  return found;
}

export function serialize(fam) {
  return JSON.stringify(fam);
}

// Отбрасывает битые ссылки: пары без людей, детей несуществующих родителей.
export function deserialize(json) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.people) || !Array.isArray(data.unions)) throw new Error('Некорректные данные семьи');
  const fam = createFamily();
  const ids = new Set(data.people.map((p) => String(p.id)));
  fam.unions = data.unions
    .filter((u) => ids.has(u.host) && ids.has(u.partner) && u.host !== u.partner)
    .map((u) => {
      const married = softDate(u.sinceDate ?? u.since);
      return { id: String(u.id), host: u.host, partner: u.partner, since: married?.year ?? null, sinceDate: married?.date ?? null };
    });
  const unionIds = new Set(fam.unions.map((u) => u.id));
  fam.people = data.people.map((p) => ({
    id: String(p.id),
    name: cleanName(p.name, String(p.id)),
    born: softDate(p.bornDate ?? p.born)?.year ?? null,
    bornDate: softDate(p.bornDate ?? p.born)?.date ?? null,
    died: softDate(p.diedDate ?? p.died)?.year ?? null,
    diedDate: softDate(p.diedDate ?? p.died)?.date ?? null,
    dead: Boolean(p.dead) || softDate(p.diedDate ?? p.died) !== null,
    photo: typeof p.photo === 'string' ? p.photo : null,
    parent: ids.has(p.parent) || unionIds.has(p.parent) ? p.parent : null,
    added: Number(p.added) || 0,
  }));
  // Цикл по родству разрываем: такой человек становится корнем.
  for (const person of fam.people) {
    const seen = new Set([person.id]);
    let up = carrierOf(fam, person.parent);
    while (up) {
      if (seen.has(up)) {
        person.parent = null;
        break;
      }
      seen.add(up);
      up = carrierOf(fam, getPerson(fam, up)?.parent ?? null);
    }
  }
  const maxId = Math.max(0, ...[...fam.people, ...fam.unions].map((x) => Number(x.id.slice(1)) || 0));
  fam.seq = Math.max(Number(data.seq) || 0, maxId);
  return fam;
}

// Старое дерево веток (memento-tree:v1) — люди без годов и пар.
export function fromTree(tree) {
  const fam = createFamily();
  const walk = (id, parent) => {
    const node = tree.nodes.find((n) => n.id === id);
    const person = addPerson(fam, { name: node.name, parent, added: node.born || 0 });
    for (const child of tree.nodes.filter((n) => n.parentId === id)) walk(child.id, person.id);
  };
  walk(ROOT_ID, null);
  return fam;
}

// Проекция главного дерева (mainRoot) для живого вида: дети пар — ветки от
// host. ids узлов = ids людей, корень — ROOT_ID.
export function toTree(fam) {
  const main = mainRoot(fam);
  const nodes = [];
  if (!main) return { seq: 0, nodes: [{ id: ROOT_ID, name: '—', parentId: null, born: 0 }] };
  const nodeId = (pid) => (pid === main.id ? ROOT_ID : pid);
  const walk = (person, parentId) => {
    nodes.push({ id: nodeId(person.id), name: person.name, parentId, born: person.added || 0 });
    for (const child of childrenOf(fam, person.id)) walk(child, nodeId(person.id));
    for (const union of unionsOf(fam, person.id)) {
      for (const child of childrenOf(fam, union.id)) walk(child, nodeId(person.id));
    }
  };
  walk(main, null);
  return { seq: fam.seq, nodes };
}

export const personIdFromTree = (fam, nodeId) => (nodeId === ROOT_ID ? mainRoot(fam)?.id ?? null : nodeId);
