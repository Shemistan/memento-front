// Семья: люди, пары и кто от кого родился. Только данные, без отрисовки.
// Человек: { id: 'pN', name, born, dead, died, parent, added }; parent — id пары
// (ребёнок пары), id человека (ребёнок без пары) или null (корень своего
// дерева). dead — человека нет в живых; died — год смерти, если известен.
// Пара: { id: 'uN', host, partner, since } — дети пары растут на дереве host,
// лиана тянется к нему от partner.
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
const cleanYear = (year) => {
  if (year === null || year === undefined || String(year).trim() === '') return null;
  const n = Math.round(Number(year));
  return Number.isFinite(n) && n > 0 && n < 3000 ? n : null;
};

// Пары, где человек — host, по году брака (без года — в конце, по порядку создания).
export function unionsOf(fam, personId) {
  const hosted = fam.unions.filter((u) => u.host === personId);
  return hosted
    .map((u, i) => ({ u, i }))
    .sort((a, b) => (a.u.since ?? Infinity) - (b.u.since ?? Infinity) || a.i - b.i)
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

export function addPerson(fam, { name, born = null, died = null, dead = false, parent = null, added = 0, before = null } = {}) {
  if (parent !== null && !(isUnionId(parent) ? getUnion(fam, parent) : getPerson(fam, parent))) {
    throw new Error(`Нет родителя ${parent}`);
  }
  fam.seq += 1;
  const person = { id: `p${fam.seq}`, name: cleanName(name, `Человек ${fam.seq}`), born: cleanYear(born), parent, added };
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
  person.died = cleanYear(died);
  person.dead = Boolean(dead) || person.died !== null;
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
  const union = { id: `u${fam.seq}`, host: hostId, partner: partnerId, since: cleanYear(since) };
  fam.unions.push(union);
  return union;
}

export function renamePerson(fam, id, name) {
  const person = getPerson(fam, id);
  const clean = String(name ?? '').trim();
  if (person && clean) person.name = clean;
  return person;
}

export function setBorn(fam, id, year) {
  const person = getPerson(fam, id);
  if (person) person.born = cleanYear(year);
  return person;
}

export function setSince(fam, id, year) {
  const union = getUnion(fam, id);
  if (union) union.since = cleanYear(year);
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
// умер, год неизвестен. Отступ — ребёнок строки выше.
// «+ Имя 1952 (1975)» — пара с человеком выше; её дети — с отступом под ней.
// «+ @Имя 1952» — пара с человеком, описанным в другом месте (по имени и году).

const LIFE = String.raw`(?:\s+(\d{3,4}|\?)(?:\s*([–—-])\s*(\d{3,4}|\?)?)?)?`;
const PERSON_RE = new RegExp(String.raw`^(.*?)${LIFE}$`);
const UNION_RE = new RegExp(String.raw`^\+\s*(@)?\s*(.*?)${LIFE}(?:\s*\((\d{3,4})\))?$`);

// Годы жизни для подписи: «1926», «1926–1998», «?–1998», «1926–?».
export function lifeText(person) {
  if (!person.dead) return person.born === null ? '' : String(person.born);
  return `${person.born ?? '?'}–${person.died ?? '?'}`;
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
      const union = { id: null, host: above, partner: null, since: cleanYear(since) };
      if (ref) refs.push({ union, name: name.trim(), born: cleanYear(born), no });
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
  const text = lifeText(person);
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
      const since = union.since === null ? '' : ` (${union.since})`;
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
  for (const person of fam.people) {
    if (person.born !== null && person.died !== null && person.died < person.born) warn(person.id, 'Год смерти раньше года рождения');
    if (person.born === null) continue;
    for (const parent of parentsOf(person)) {
      if (parent?.died !== null && parent?.died !== undefined && person.born > parent.died + 1) {
        warn(person.id, `Родился(-ась) после смерти родителя: ${parent.name}, ${parent.died}`);
      }
      if (parent?.born !== null && parent?.born !== undefined && person.born - parent.born < 12) {
        warn(person.id, `Родитель слишком молод: ${parent.name}, ${parent.born}`);
      }
    }
  }
  for (const union of fam.unions) {
    if (union.since === null) continue;
    for (const id of [union.host, union.partner]) {
      const person = getPerson(fam, id);
      if (person.died !== null && union.since > person.died) warn(union.id, `Брак после смерти: ${person.name}, ${person.died}`);
      if (person.born !== null && union.since < person.born) warn(union.id, `Брак раньше рождения: ${person.name}, ${person.born}`);
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
    .map((u) => ({ id: String(u.id), host: u.host, partner: u.partner, since: cleanYear(u.since) }));
  const unionIds = new Set(fam.unions.map((u) => u.id));
  fam.people = data.people.map((p) => ({
    id: String(p.id),
    name: cleanName(p.name, String(p.id)),
    born: cleanYear(p.born),
    died: cleanYear(p.died),
    dead: Boolean(p.dead) || cleanYear(p.died) !== null,
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

// Проекция главного дерева (первого корня) для живого вида: дети пар —
// ветки от host. ids узлов = ids людей, корень — ROOT_ID.
export function toTree(fam) {
  const main = roots(fam)[0];
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

export const personIdFromTree = (fam, nodeId) => (nodeId === ROOT_ID ? roots(fam)[0]?.id ?? null : nodeId);
