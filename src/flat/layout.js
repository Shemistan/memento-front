// Схема 2D: раскладка дерева по поколениям и геометрия веток.
// Чистые функции без DOM — фундамент будущего генеалогического дерева:
// поколение = ярус, порядок детей сохраняется, поддеревья не пересекаются.
import { ROOT_ID } from '../model.js';
import { hashString, rng } from '../layout.js';

export const ROW = 128; // расстояние между поколениями
export const GAP = 16; // минимальный зазор между соседями-сиблингами
export const NODE_H = 30; // высота таблички с именем
const CHAR_W = 7.6;
const PAD = 30;
const MIN_W = 64;
const BARK_K = 2.6; // полутолщина = BARK_K * sqrt(число кончиков) — модель «трубок»
const TIP_R = 2.2;

export function estimateWidth(name) {
  return Math.max(MIN_W, Math.round(String(name).length * CHAR_W + PAD));
}

// Зазор растёт с глубиной различия: двоюродные стоят дальше родных.
const sepAt = (gap, d) => (d === 0 ? gap : gap * 1.6);

// Укладывает поддеревья слева направо; contour[d] = { l, r } — края яруса d
// относительно корня поддерева. Возвращает смещения корней.
function pack(subs, gap) {
  const xs = [];
  const edge = [];
  for (const sub of subs) {
    let x = 0;
    if (xs.length) {
      x = -Infinity;
      for (let d = 0; d < Math.min(sub.length, edge.length); d++) {
        x = Math.max(x, edge[d] - sub[d].l + sepAt(gap, d));
      }
    }
    sub.forEach((lvl, d) => {
      edge[d] = d < edge.length ? Math.max(edge[d], lvl.r + x) : lvl.r + x;
    });
    xs.push(x);
  }
  return xs;
}

const mirror = (contour) => contour.map(({ l, r }) => ({ l: -r, r: -l }));
const centered = (xs) => {
  const mid = (xs[0] + xs[xs.length - 1]) / 2;
  return xs.map((x) => x - mid);
};

// Reingold–Tilford с усреднением укладок слева и справа: маленькие поддеревья
// между крупными не прижимаются к одному краю. Оба варианта удовлетворяют
// линейным ограничениям на зазоры, значит и их среднее — тоже.
export function layoutTree(tree, { measure = estimateWidth, row = ROW, gap = GAP } = {}) {
  const kids = new Map(tree.nodes.map((n) => [n.id, []]));
  for (const n of tree.nodes) if (n.parentId && kids.has(n.parentId)) kids.get(n.parentId).push(n.id);
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const width = new Map(tree.nodes.map((n) => [n.id, measure(n.name)]));
  const offset = new Map([[ROOT_ID, 0]]);
  const tips = new Map();

  const place = (id) => {
    const w = width.get(id);
    const own = { l: -w / 2, r: w / 2 };
    const ch = kids.get(id);
    if (!ch.length) {
      tips.set(id, 1);
      return [own];
    }
    const subs = ch.map(place);
    const ltr = centered(pack(subs, gap));
    const rtl = centered(pack([...subs].reverse().map(mirror), gap).map((x) => -x).reverse());
    const xs = ltr.map((x, i) => (x + rtl[i]) / 2);
    ch.forEach((c, i) => offset.set(c, xs[i]));
    tips.set(id, ch.reduce((s, c) => s + tips.get(c), 0));

    const contour = [own];
    subs.forEach((sub, i) =>
      sub.forEach(({ l, r }, d) => {
        const lvl = contour[d + 1];
        if (!lvl) contour[d + 1] = { l: l + xs[i], r: r + xs[i] };
        else {
          lvl.l = Math.min(lvl.l, l + xs[i]);
          lvl.r = Math.max(lvl.r, r + xs[i]);
        }
      }),
    );
    return contour;
  };
  place(ROOT_ID);

  const nodes = new Map();
  const order = [];
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const walk = (id, x, depth) => {
    const node = { id, parentId: byId.get(id).parentId, x, y: -depth * row + 0, depth, width: width.get(id), tips: tips.get(id) };
    nodes.set(id, node);
    order.push(id);
    bounds.minX = Math.min(bounds.minX, x - node.width / 2);
    bounds.maxX = Math.max(bounds.maxX, x + node.width / 2);
    bounds.minY = Math.min(bounds.minY, node.y - NODE_H / 2);
    bounds.maxY = Math.max(bounds.maxY, node.y + NODE_H / 2);
    for (const c of kids.get(id)) walk(c, x + offset.get(c), depth + 1);
  };
  walk(ROOT_ID, 0, 0);
  return { nodes, order, bounds, row };
}

export const barkRadius = (tipCount) => BARK_K * Math.sqrt(tipCount) + TIP_R;

const fmt = (v) => Math.round(v * 10) / 10;

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

// Кривая ветки от родителя к ребёнку: S-образная (вверх, вбок, снова вверх).
// Нужна и для контура, и чтобы сажать на ветку декоративные веточки.
export function branchCurve(from, to, bend = 0.5) {
  const dy = to.y - from.y;
  const p1 = { x: from.x, y: from.y + dy * bend };
  const p2 = { x: to.x, y: to.y - dy * (1 - bend) * 0.9 };
  return (t) => cubic(from, p1, p2, to, t);
}

// Направление кривой в точке t (радианы, как Math.atan2).
export function curveAngle(at, t) {
  const a = at(Math.max(0, t - 0.01));
  const b = at(Math.min(1, t + 0.01));
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// Обводит ломаную толщиной radius(t) и возвращает атрибут d.
function outline(pts, radius) {
  const left = [];
  const right = [];
  const last = pts.length - 1;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(last, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const r = radius(i / last);
    left.push(`${fmt(p.x + nx * r)} ${fmt(p.y + ny * r)}`);
    right.push(`${fmt(p.x - nx * r)} ${fmt(p.y - ny * r)}`);
  });
  return `M${left.join('L')}L${right.reverse().join('L')}Z`;
}

// Сужающаяся ветка с толщиной r0 → r1 и наплывом у развилки.
export function branchPath(from, to, r0, r1, { bend = 0.5, steps = 14 } = {}) {
  const at = branchCurve(from, to, bend);
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(at(i / steps));
  return outline(pts, (t) => r1 + (r0 - r1) * (1 - t) ** 1.4 + r0 * 0.35 * Math.max(0, 1 - t * 6));
}

// Декоративная веточка: прямая с лёгким изгибом кверху, сужается к кончику.
// Возвращает контур, кончик и направление на кончике — для подветочек и листьев.
export function twigPath(start, angle, length, r0, steps = 6) {
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const end = { x: start.x + dir.x * length, y: start.y + dir.y * length };
  const ctrl = { x: start.x + dir.x * length * 0.5, y: start.y + dir.y * length * 0.5 - length * 0.12 };
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({ x: u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x, y: u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y });
  }
  return {
    d: outline(pts, (t) => r0 * (1 - 0.72 * t)),
    tip: end,
    angle: Math.atan2(end.y - ctrl.y, end.x - ctrl.x),
  };
}

const range = (rand, a, b) => a + (b - a) * rand();

// Веточки, которых нет в модели: они дают кроне вид настоящего дерева.
// Угол — от направления родительской ветки в точке t, длина — доля яруса.
// Детерминированно по id, чтобы правки не перетасовывали крону.
export function twigSpecs(id, { tip = false } = {}) {
  const rand = rng(hashString(`flat-twig:${id}`));
  const twig = (t, side, angle, len) => ({
    t,
    angle: side * angle,
    len,
    kids: rand() < 0.7 ? [{ t: range(rand, 0.45, 0.7), angle: -side * range(rand, 28, 45), len: range(rand, 0.4, 0.6) }] : [],
  });
  const twigs = [];
  let side = rand() < 0.5 ? -1 : 1;
  for (let i = 0; i < 3; i++) {
    twigs.push(twig(0.2 + i * 0.25 + range(rand, 0, 0.1), side, range(rand, 30, 55), range(rand, 0.32, 0.52)));
    side = -side;
  }
  if (tip) {
    // Крона над кончиком: веером в стороны, прямо вверх не растём — там подпись.
    for (const base of [-1, 1]) twigs.push(twig(1, base, range(rand, 22, 40), range(rand, 0.32, 0.45)));
    if (rand() < 0.6) twigs.push(twig(1, rand() < 0.5 ? -1 : 1, range(rand, 55, 70), range(rand, 0.25, 0.35)));
  }
  return twigs;
}

// Пучок листьев на кончике веточки. Координаты локальные: веточка смотрит вверх (−y).
export function twigLeaves(seed) {
  const rand = rng(hashString(`flat-twig-leaf:${seed}`));
  const count = 4 + Math.floor(rand() * 4);
  const spots = [];
  for (let i = 0; i < count; i++) {
    const angle = range(rand, -70, 70);
    spots.push({
      x: range(rand, -7, 7),
      y: range(rand, -10, 3),
      angle,
      size: range(rand, 9, 14),
      tone: Math.floor(rand() * 4),
      delay: Math.round(rand() * 420),
    });
  }
  return spots;
}

// Ствол от земли до корневой таблички с расширением у земли и корнями.
export function trunkPath(top, r, groundY) {
  const h = groundY - top.y;
  const flare = r * 2.1;
  const x = top.x;
  return [
    `M${fmt(x - r * 0.8)} ${fmt(top.y)}`,
    `C${fmt(x - r)} ${fmt(top.y + h * 0.5)} ${fmt(x - r * 1.05)} ${fmt(groundY - h * 0.25)} ${fmt(x - flare)} ${fmt(groundY)}`,
    `L${fmt(x + flare)} ${fmt(groundY)}`,
    `C${fmt(x + r * 1.05)} ${fmt(groundY - h * 0.25)} ${fmt(x + r)} ${fmt(top.y + h * 0.5)} ${fmt(x + r * 0.8)} ${fmt(top.y)}Z`,
  ].join('');
}

export function rootsPath(x, r, groundY, seed = 'roots') {
  const rand = rng(hashString(seed));
  const parts = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const reach = r * (3 + k * 2.2 + rand());
      const sx = x + side * r * (0.6 + k * 0.7);
      const ex = x + side * reach;
      const ey = groundY + 6 + k * 7 + rand() * 4;
      const w = Math.max(1.5, r * (0.45 - k * 0.15));
      parts.push(
        `M${fmt(sx - side * w)} ${fmt(groundY - 1)}Q${fmt((sx + ex) / 2)} ${fmt(groundY + 2)} ${fmt(ex)} ${fmt(ey)}` +
          `Q${fmt((sx + ex) / 2)} ${fmt(groundY + w)} ${fmt(sx + side * w)} ${fmt(groundY - 1)}Z`,
      );
    }
  }
  return parts.join('');
}

// Листья вокруг таблички: на кончиках — пышная крона, на развилках — пара
// листочков. Детерминированно по id, чтобы листья не прыгали при правках.
export function leafSpots(id, { tip = false, width = MIN_W } = {}) {
  const rand = rng(hashString(`flat-leaf:${id}`));
  const count = tip ? 15 + Math.floor(rand() * 5) : 5 + Math.floor(rand() * 3);
  const rx = width / 2 + 6;
  const spots = [];
  for (let i = 0; i < count; i++) {
    // Сверху и по бокам; снизу — ветка, туда листья не ставим.
    const a = Math.PI * (-0.08 - rand() * 0.84) + (i % 2 ? 0 : Math.PI * 0.02);
    const spread = tip ? 0.75 + rand() * 0.55 : 0.6 + rand() * 0.4;
    spots.push({
      x: Math.cos(a) * rx * spread,
      y: Math.sin(a) * (NODE_H / 2 + 8 + rand() * (tip ? 18 : 8)),
      angle: (a * 180) / Math.PI + 90 + (rand() - 0.5) * 50,
      size: (tip ? 12 : 10) + rand() * 7,
      tone: Math.floor(rand() * 4),
      delay: Math.round(rand() * 420),
    });
  }
  return spots;
}
