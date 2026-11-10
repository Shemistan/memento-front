// Схема 2D: раскладка семьи. Чистые функции без DOM.
// Высота узла — год (кто родился раньше, стоит ниже), горизонталь —
// Reingold–Tilford по полосам высоты, деревья разных корней — лес.
import { childrenOf, getPerson, getUnion, isUnionId, lifeText, roots, unionsOf } from '../family/model.js';
import { NODE_H, barkRadius } from './layout.js';

export const UNION_W = 26; // диаметр значка пары
export const YEAR_PX = 5; // пикселей на год по умолчанию
export const GAP = 16; // минимальный зазор между соседними узлами
export const MIN_DY = 46; // узел стоит не ближе к родителю по высоте
export const TRUNK_H = 110; // высота ствола у самого старшего корня
const BAND = 24; // высота полосы контура
const TREE_GAP = 36; // зазор между деревьями
const STEM = 7; // полуширина стебля в контуре
const CHAR_W = 7.6;
const PAD = 30;
const MIN_W = 64;

export const personLabel = (p) => (lifeText(p) ? `${p.name} · ${lifeText(p)}` : p.name);

export function estimateWidth(text) {
  return Math.max(MIN_W, Math.round(String(text).length * CHAR_W + PAD));
}

// Годы людей и пар: заданные или оценка по родным.
export function yearsOf(fam) {
  const known = fam.people.map((p) => p.born).filter((y) => y !== null);
  const fallback = known.length ? Math.min(...known) : 1950;
  const year = new Map();
  const busy = new Set(); // защита от циклов в испорченных данных
  const personYear = (p) => {
    if (year.has(p.id)) return year.get(p.id);
    if (busy.has(p.id)) return fallback;
    busy.add(p.id);
    let y = p.born;
    if (y === null) {
      if (p.parent === null) {
        const union = fam.unions.find((u) => u.partner === p.id || u.host === p.id);
        const other = union && getPerson(fam, union.partner === p.id ? union.host : union.partner);
        y = other?.born ?? fallback;
      } else if (isUnionId(p.parent)) y = unionYear(getUnion(fam, p.parent)) + 2;
      else y = personYear(getPerson(fam, p.parent)) + 25;
    }
    year.set(p.id, y);
    return y;
  };
  const unionYear = (u) => {
    if (year.has(u.id)) return year.get(u.id);
    let y = u.since;
    if (y === null) {
      const kids = childrenOf(fam, u.id).map((c) => c.born).filter((v) => v !== null);
      const elder = Math.max(personYear(getPerson(fam, u.host)), personYear(getPerson(fam, u.partner)));
      y = kids.length ? Math.min(...kids) - 1 : elder + 22;
    }
    year.set(u.id, y);
    return y;
  };
  for (const p of fam.people) personYear(p);
  for (const u of fam.unions) unionYear(u);
  return year;
}

// Дерево раскладки: человек → его дети без пары, затем первая пара;
// пара → её дети, затем следующая пара того же человека. Так ветка человека
// идёт от брака к браку, а дети каждой пары растут из своего узла.
function layoutKids(fam, year) {
  const byYear = (list) =>
    list
      .map((p, i) => ({ p, i }))
      .sort((a, b) => year.get(a.p.id) - year.get(b.p.id) || a.i - b.i)
      .map(({ p }) => p.id);
  const kids = new Map();
  for (const person of fam.people) {
    const chain = unionsOf(fam, person.id);
    kids.set(person.id, [...byYear(childrenOf(fam, person.id)), ...chain.slice(0, 1).map((u) => u.id)]);
    chain.forEach((u, i) => kids.set(u.id, [...byYear(childrenOf(fam, u.id)), ...chain.slice(i + 1, i + 2).map((n) => n.id)]));
  }
  return kids;
}

// Контур — Map: полоса высоты → { l, r } относительно корня поддерева.
function addSpan(contour, top, bottom, l, r) {
  for (let b = Math.floor(top / BAND); b <= Math.floor(bottom / BAND); b++) {
    const span = contour.get(b);
    if (!span) contour.set(b, { l, r });
    else {
      span.l = Math.min(span.l, l);
      span.r = Math.max(span.r, r);
    }
  }
}

function shifted(contour, dx, into = new Map()) {
  for (const [b, { l, r }] of contour) addSpan(into, b * BAND, b * BAND, l + dx, r + dx);
  return into;
}

const mirror = (contour) => new Map([...contour].map(([b, { l, r }]) => [b, { l: -r, r: -l }]));

// Наименьшее смещение sub, при котором он стоит правее edge с зазором gap.
function rightOf(edge, sub, gap) {
  let x = -Infinity;
  for (const [b, { l }] of sub) {
    const span = edge.get(b);
    if (span) x = Math.max(x, span.r - l + gap);
  }
  return x;
}

// Укладывает поддеревья слева направо. Соседи не делят одну вертикаль,
// даже если по высоте не встречаются: иначе их ветки легли бы друг на друга.
function pack(subs, gap) {
  const xs = [];
  const edge = new Map();
  for (const sub of subs) {
    const x = xs.length ? Math.max(rightOf(edge, sub, gap), xs[xs.length - 1] + STEM * 2 + gap) : 0;
    shifted(sub, x, edge);
    xs.push(x);
  }
  return xs;
}

const centered = (xs) => {
  const mid = (xs[0] + xs[xs.length - 1]) / 2;
  return xs.map((x) => x - mid);
};

// Раскладка семьи. measure(человек) — ширина таблички, yearPx — масштаб времени.
// rows — вместо времени ярусы поколений через rows px (для редактора);
// nodeH, unionW, unionH — размеры узлов, по которым считаются зазоры.
// skip — корни, которые раскладывать не нужно (редактор ставит их сам).
export function familyLayout(
  fam,
  { measure = (p) => estimateWidth(personLabel(p)), yearPx = YEAR_PX, gap = GAP, rows = null, nodeH = NODE_H, unionW = UNION_W, unionH = UNION_W, skip = new Set() } = {},
) {
  const year = yearsOf(fam);
  const kids = layoutKids(fam, year);
  const parentOf = new Map();
  for (const [id, list] of kids) for (const k of list) parentOf.set(k, id);
  const treeRoots = roots(fam)
    .map((p) => p.id)
    .filter((id) => !skip.has(id));
  const base = year.size ? Math.min(...year.values()) : 0;

  // Высота — год, но не ближе MIN_DY к родителю. Прижатые к родителю всё
  // равно стоят по старшинству: каждый год младше — ещё на 2px выше.
  const y = new Map();
  const setY = (id, depth = 0) => {
    if (rows !== null) {
      // Ярусы: человек → пара → дети пары. Ребёнок без пары пропускает ярус
      // пары, чтобы карточки родителя и ребёнка не наезжали друг на друга.
      y.set(id, -depth * rows + 0);
      for (const k of kids.get(id)) setY(k, depth + (isUnionId(id) || isUnionId(k) ? 1 : 2));
      return;
    }
    const own = -(year.get(id) - base) * yearPx + 0;
    const parent = parentOf.get(id);
    const lift = parent === undefined ? 0 : Math.max(0, year.get(id) - year.get(parent)) * 2;
    y.set(id, parent === undefined ? own : Math.min(own, y.get(parent) - MIN_DY - lift));
    for (const k of kids.get(id)) setY(k);
  };
  for (const r of treeRoots) setY(r);
  const groundY = Math.max(0, ...treeRoots.map((r) => y.get(r))) + TRUNK_H;

  const width = new Map();
  for (const p of fam.people) width.set(p.id, measure(p));
  for (const u of fam.unions) width.set(u.id, unionW);

  const offset = new Map();
  const tips = new Map();
  const place = (id) => {
    const w = width.get(id);
    const h = isUnionId(id) ? unionH : nodeH;
    const contour = new Map();
    addSpan(contour, y.get(id) - h / 2, y.get(id) + h / 2, -w / 2, w / 2);
    const parent = parentOf.get(id);
    if (parent !== undefined) addSpan(contour, y.get(id) + h / 2, (y.get(id) + y.get(parent)) / 2, -STEM, STEM);
    const ch = kids.get(id);
    if (!ch.length) {
      tips.set(id, 1);
      return contour;
    }
    const subs = ch.map(place);
    const ltr = centered(pack(subs, gap));
    const rtl = centered(pack(subs.map(mirror).reverse(), gap).map((x) => -x).reverse());
    const xs = ltr.map((x, i) => (x + rtl[i]) / 2);
    ch.forEach((c, i) => offset.set(c, xs[i]));
    tips.set(id, ch.reduce((s, c) => s + tips.get(c), 0));
    subs.forEach((sub, i) => shifted(sub, xs[i], contour));
    return contour;
  };
  const treeContour = new Map();
  for (const r of treeRoots) {
    const contour = place(r);
    if (rows === null) {
      const half = barkRadius(tips.get(r)) * 2.4 + 4; // ствол с расширением у земли
      addSpan(contour, y.get(r), groundY, -half, half);
    }
    treeContour.set(r, contour);
  }

  // Лес. Сначала желаемое место каждого дерева: обход пар от первого дерева,
  // узел супруга встаёт под узел пары, к которому тянется его лиана. Затем
  // деревья по желаемым местам укладываются слева направо без наложений.
  const rel = new Map(); // x узла относительно корня своего дерева
  const treeOf = new Map();
  const relWalk = (id, x, root) => {
    rel.set(id, x);
    treeOf.set(id, root);
    for (const k of kids.get(id)) relWalk(k, x + offset.get(k), root);
  };
  for (const r of treeRoots) relWalk(r, 0, r);
  const desired = new Map();
  for (const start of treeRoots) {
    if (desired.has(start)) continue;
    desired.set(start, desired.size ? Math.max(...desired.values()) + 400 : 0);
    const queue = [start];
    while (queue.length) {
      const root = queue.shift();
      for (const u of fam.unions) {
        // Концы лианы: узел супруга и узел пары (он на дереве host).
        for (const [mine, here, there] of [
          [u.host, u.id, u.partner],
          [u.partner, u.partner, u.id],
        ]) {
          const next = treeOf.get(there);
          if (!next || treeOf.get(mine) !== root || desired.has(next)) continue;
          desired.set(next, desired.get(root) + rel.get(here) - rel.get(there));
          queue.push(next);
        }
      }
    }
  }
  const sorted = [...treeRoots].sort((a, b) => desired.get(a) - desired.get(b));
  const treeX = new Map();
  const all = new Map();
  for (const root of sorted) {
    const sub = treeContour.get(root);
    const x = treeX.size ? Math.max(desired.get(root), rightOf(all, sub, TREE_GAP)) : desired.get(root);
    shifted(sub, x, all);
    treeX.set(root, x);
  }
  // Первое дерево — в начале координат: так камера не прыгает при правках соседей.
  const shift = treeX.get(treeRoots[0]) ?? 0;

  const nodes = new Map();
  const order = [];
  for (const root of treeRoots) {
    const walk = (id) => {
      const kind = isUnionId(id) ? 'union' : 'person';
      const x = rel.get(id) + treeX.get(root) - shift;
      nodes.set(id, { id, kind, parentId: parentOf.get(id) ?? null, x, y: y.get(id), year: year.get(id), width: width.get(id), tips: tips.get(id), root });
      order.push(id);
      for (const k of kids.get(id)) walk(k);
    };
    walk(root);
  }

  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: groundY };
  for (const n of nodes.values()) {
    bounds.minX = Math.min(bounds.minX, n.x - n.width / 2);
    bounds.maxX = Math.max(bounds.maxX, n.x + n.width / 2);
    bounds.minY = Math.min(bounds.minY, n.y - nodeH / 2);
  }
  if (!nodes.size) Object.assign(bounds, { minX: -100, maxX: 100, minY: -100 });
  return { nodes, order, bounds, groundY, roots: treeRoots, base, yearPx, yearY: (yr) => -(yr - base) * yearPx + 0 };
}
