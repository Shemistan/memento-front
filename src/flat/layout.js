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

// Сужающаяся ветка от родителя к ребёнку: S-образная кривая (вверх, вбок,
// снова вверх), обведённая с толщиной r0 → r1. Возвращает атрибут d.
export function branchPath(from, to, r0, r1, { bend = 0.5, steps = 14 } = {}) {
  const dy = to.y - from.y;
  const p1 = { x: from.x, y: from.y + dy * bend };
  const p2 = { x: to.x, y: to.y - dy * (1 - bend) * 0.9 };
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(cubic(from, p1, p2, to, i / steps));
  const left = [];
  const right = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const t = i / steps;
    // Утолщение у основания — как наплыв в развилке настоящей ветки.
    const r = r1 + (r0 - r1) * (1 - t) ** 1.4 + r0 * 0.35 * Math.max(0, 1 - t * 6);
    left.push(`${fmt(p.x + nx * r)} ${fmt(p.y + ny * r)}`);
    right.push(`${fmt(p.x - nx * r)} ${fmt(p.y - ny * r)}`);
  });
  return `M${left.join('L')}L${right.reverse().join('L')}Z`;
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
