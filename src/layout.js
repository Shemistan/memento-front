// Геометрия дерева: из модели строит «план» (ветки пользователя плюс
// процедурные веточки и листья), из плана на каждый кадр — «позу»
// с учётом роста, ветра и видимости листьев.
// Мировые координаты: основание ствола в (0, 0), ось y направлена вверх,
// угол ветки отсчитывается от вертикали (0 — вверх, плюс — вправо).

import { ROOT_ID, childrenOf } from './model.js';

const DEG = Math.PI / 180;
const GOLDEN = 0.6180339887;
const MORPH_MS = 1200;
const BARK_K = 0.16; // радиус = BARK_K * sqrt(нагрузка) — модель «трубок» да Винчи
const MIN_R = 0.35;

export const GROW_MS = { user: 1600, twig: 900 };

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (rand, a, b) => a + (b - a) * rand();
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (v) => 1 - (1 - v) ** 3;

function subtreeSizes(tree) {
  const size = new Map();
  const walk = (id) => {
    let s = 1;
    for (const c of childrenOf(tree, id)) s += walk(c.id);
    size.set(id, s);
    return s;
  };
  walk(ROOT_ID);
  return size;
}

export function buildPlan(tree) {
  const limbs = [];
  const leaves = [];
  const sizes = subtreeSizes(tree);

  const pushLimb = (limb) => {
    limb.idx = limbs.length;
    limb.children = [];
    limbs.push(limb);
    if (limb.parent >= 0) limbs[limb.parent].children.push(limb.idx);
    return limb;
  };

  const wobbleFor = (rand, segs, amount) => Array.from({ length: segs }, () => range(rand, -amount, amount));

  function addLeaves(limb, rand) {
    const density = limb.level === 2 ? 2.8 : 4.4;
    const count = Math.round(limb.len / density) + (limb.level === 2 ? 6 : 3);
    for (let i = 0; i < count; i += 1) {
      const tip = i >= count - 4;
      leaves.push({
        limb: limb.idx,
        t: tip ? range(rand, 0.9, 1) : range(rand, 0.3, 0.95),
        side: rand() < 0.5 ? -1 : 1,
        ang: tip ? range(rand, 0, 50) * DEG : range(rand, 35, 80) * DEG,
        size: range(rand, 5.2, 8.6) * (limb.level === 2 ? 0.92 : 1),
        tone: rand(),
        phase: range(rand, 0, Math.PI * 2),
        stagger: rand(),
        back: rand() < 0.38,
      });
    }
  }

  // Процедурные веточки: делают из «палки» живую ветку и несут листья.
  // Каждая веточка случайна от своего ключа, а место на ветке — от номера,
  // поэтому при перестройке плана существующие веточки остаются на местах.
  function addTwigs(parent, opts) {
    const { count, tFrom, level, lenFrom, lenTo, fork } = opts;
    const base = rng(hashString(parent.id))();
    const specs = [];
    for (let j = 0; j < count; j += 1) {
      const id = `${parent.id}/${j}`;
      const rand = rng(hashString(id));
      const t = tFrom + (0.94 - tFrom) * ((base + j * GOLDEN) % 1);
      const side = (j + Math.round(base)) % 2 ? 1 : -1;
      specs.push({ id, rand, t, rel: side * range(rand, 32, 62) * DEG, len: parent.len * range(rand, lenFrom, lenTo) });
    }
    for (let j = 0; j < fork; j += 1) {
      const id = `${parent.id}/f${j}`;
      const rand = rng(hashString(id));
      const side = fork === 1 ? (base < 0.5 ? -1 : 1) : j % 2 ? 1 : -1;
      specs.push({ id, rand, t: range(rand, 0.97, 1), rel: side * range(rand, 14, 34) * DEG, len: parent.len * range(rand, lenFrom, lenTo) * 1.05 });
    }
    for (const { id, rand, t, rel, len } of specs) {
      const segs = level === 1 ? 5 : 4;
      const twig = pushLimb({
        id,
        parent: parent.idx,
        userId: null,
        owner: parent.owner,
        level,
        t,
        rel,
        len: Math.max(6, len),
        segs,
        wobble: wobbleFor(rand, segs, 0.11),
        tropism: 0.035,
        born: parent.born,
        dur: GROW_MS.twig,
        phase: range(rand, 0, Math.PI * 2),
        freq: range(rand, 1.4, 2.2),
      });
      if (level === 1) {
        addTwigs(twig, { count: rand() < 0.5 ? 2 : 3, tFrom: 0.3, level: 2, lenFrom: 0.38, lenTo: 0.6, fork: 1 });
      }
      addLeaves(twig, rand);
    }
  }

  function addUser(node, parentLimb, t, rel, depth) {
    const rand = rng(hashString(node.id));
    const sub = sizes.get(node.id) || 1;
    const growth = 0.85 + 0.17 * Math.log2(1 + sub);
    let len;
    if (!parentLimb) {
      len = 105 * growth;
    } else {
      len = parentLimb.len * (0.92 - 0.38 * t) * range(rand, 0.9, 1.1) * Math.min(1.25, growth);
      len = Math.max(len, 34);
    }
    const segs = parentLimb ? 9 : 12;
    const limb = pushLimb({
      id: `u:${node.id}`,
      parent: parentLimb ? parentLimb.idx : -1,
      userId: node.id,
      owner: node.id,
      level: 0,
      depth,
      t,
      rel,
      len,
      segs,
      wobble: wobbleFor(rand, segs, parentLimb ? 0.07 : 0.025),
      tropism: parentLimb ? 0.045 : 0.12,
      born: node.born || 0,
      dur: GROW_MS.user,
      phase: range(rand, 0, Math.PI * 2),
      freq: range(rand, 0.7, 1.1),
    });

    // Место ребёнка зависит только от его номера: новая ветка не двигает старые.
    // На стволе крона начинается выше, чем на ветках.
    const kids = childrenOf(tree, node.id);
    const k = kids.length;
    const first = hashString(node.id) % 2 ? 1 : -1;
    const from = parentLimb ? 0.34 : 0.46;
    kids.forEach((child, i) => {
      const crand = rng(hashString('pos:' + child.id));
      const side = i % 2 ? -first : first;
      const ct = from + (0.92 - from) * ((0.55 + i * GOLDEN) % 1) + range(crand, -0.025, 0.025);
      const spread = parentLimb ? 22 + 26 * (1 - ct) : 26 + 30 * (1 - ct);
      const crel = side * (spread + range(crand, -7, 7)) * DEG;
      addUser(child, limb, Math.min(0.96, ct), crel, depth + 1);
    });

    if (!parentLimb) {
      // Ствол: веточки только в кроне и «лидер» на верхушке.
      addTwigs(limb, { count: k ? 2 : 4, tFrom: 0.62, level: 1, lenFrom: 0.22, lenTo: 0.34, fork: 2 });
    } else {
      const count = Math.max(1, 2 + Math.floor(len / 38) - Math.ceil(k / 2));
      addTwigs(limb, { count, tFrom: 0.28, level: 1, lenFrom: 0.24, lenTo: 0.4, fork: k ? 1 : 2 });
    }
    return limb;
  }

  const root = tree.nodes.find((n) => n.id === ROOT_ID);
  addUser(root, null, 0, 0, 0);
  return { limbs, leaves };
}

// Перестройка плана после правки дерева: ветки, что были и раньше, плавно
// перетекают из прежней формы в новую; новые веточки растут с нуля.
export function carryOver(prev, next, now) {
  const before = new Map(prev.limbs.map((l) => [l.id, l]));
  for (const limb of next.limbs) {
    const old = before.get(limb.id);
    if (!old) {
      limb.born = Math.max(limb.born, now);
      continue;
    }
    const m = morphAt(old, now);
    const from = { len: mix(old, 'len', m), t: mix(old, 't', m), rel: mix(old, 'rel', m) };
    if (from.len !== limb.len || from.t !== limb.t || from.rel !== limb.rel) limb.morph = { at: now, ...from };
  }
  return next;
}

const morphAt = (limb, now) => (limb.morph ? easeOut(clamp01((now - limb.morph.at) / MORPH_MS)) : 1);
const mix = (limb, field, m) => (m >= 1 ? limb[field] : limb.morph[field] + (limb[field] - limb.morph[field]) * m);

// Нагрузка, которую несёт ветка от точки t до кончика (с учётом роста).
function loadBeyond(i, t, eg, load, geo) {
  let sum = geo.len[i] * eg[i] * (1 - t);
  for (const c of geo.children[i]) if (geo.t[c] >= t * eg[i]) sum += load[c];
  return sum;
}

export function pose(plan, { now, epoch = 0, time = now / 1000, wind = 1, leafAmount = 1 }) {
  const { limbs, leaves } = plan;
  const n = limbs.length;
  const start = new Float64Array(n);
  const eg = new Float64Array(n);
  const load = new Float64Array(n);
  const out = new Array(n);
  const geo = { len: new Float64Array(n), t: new Float64Array(n), rel: new Float64Array(n), children: limbs.map((l) => l.children) };

  for (const limb of limbs) {
    const i = limb.idx;
    const m = morphAt(limb, now);
    geo.len[i] = mix(limb, 'len', m);
    geo.t[i] = mix(limb, 't', m);
    geo.rel[i] = mix(limb, 'rel', m);
    const own = Math.max(limb.born, epoch);
    if (limb.parent < 0) start[i] = own;
    else {
      const p = limbs[limb.parent];
      start[i] = Math.max(own, start[p.idx] + p.dur * geo.t[i]);
    }
    eg[i] = easeOut(clamp01((now - start[i]) / limb.dur));
  }

  for (let i = n - 1; i >= 0; i -= 1) {
    load[i] = eg[i] > 0 ? loadBeyond(i, 0, eg, load, geo) : 0;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;

  for (const limb of limbs) {
    const i = limb.idx;
    if (eg[i] <= 0) {
      out[i] = null;
      continue;
    }
    let x = 0;
    let y = 0;
    let theta = 0;
    let rCap = Infinity;
    if (limb.parent >= 0) {
      const p = out[limb.parent];
      if (!p) {
        out[i] = null;
        continue;
      }
      const at = samplePolyline(p.pts, geo.t[i] / Math.max(eg[limb.parent], 1e-6));
      x = at.x;
      y = at.y;
      theta = at.a + geo.rel[i];
      rCap = at.r * 0.92;
    }
    const rBase = BARK_K * Math.sqrt(load[i]);
    const amp = (limb.level ? 0.05 : 0.022) / (1 + 0.12 * rBase);
    const sway = wind * amp * (Math.sin(time * limb.freq + limb.phase) + 0.35 * Math.sin(time * limb.freq * 2.3 + limb.phase * 1.7));
    theta += sway;

    const segLen = (geo.len[i] * eg[i]) / limb.segs;
    const pts = [];
    for (let k = 0; k <= limb.segs; k += 1) {
      const tt = k / limb.segs;
      let r = Math.max(MIN_R, BARK_K * Math.sqrt(loadBeyond(i, tt, eg, load, geo)));
      if (limb.parent < 0) r *= 1 + 0.7 * Math.max(0, 1 - tt / 0.1) ** 2;
      r = Math.min(r, rCap);
      pts.push({ x, y, r, a: theta });
      if (k < limb.segs) {
        theta += limb.wobble[k] + limb.tropism * -theta + sway * 0.25;
        x += Math.sin(theta) * segLen;
        y += Math.cos(theta) * segLen;
      }
    }
    for (const p of pts) {
      if (p.x - p.r < minX) minX = p.x - p.r;
      if (p.x + p.r > maxX) maxX = p.x + p.r;
      if (p.y > maxY) maxY = p.y;
    }
    out[i] = { pts, userId: limb.userId, level: limb.level, owner: limb.owner, grow: eg[i] };
  }

  const leafOut = [];
  for (const leaf of leaves) {
    const host = out[leaf.limb];
    if (!host) continue;
    const limb = limbs[leaf.limb];
    const g = eg[leaf.limb];
    if (leaf.t > g) continue;
    const appeared = clamp01((now - start[leaf.limb] - limb.dur * leaf.t - 250) / 700);
    const shown = clamp01(leafAmount * 1.6 - leaf.stagger * 0.6);
    const s = leaf.size * easeOut(appeared) * shown;
    if (s < 0.4) continue;
    const at = samplePolyline(host.pts, leaf.t / g);
    const flutter = wind * 0.22 * Math.sin(time * 3.1 + leaf.phase);
    const a = at.a + leaf.side * leaf.ang + flutter;
    const reach = at.r + s * 0.55;
    const lx = at.x + Math.sin(a) * reach;
    const ly = at.y + Math.cos(a) * reach;
    leafOut.push({ x: lx, y: ly, a, s, tone: leaf.tone, back: leaf.back });
    if (lx - s < minX) minX = lx - s;
    if (lx + s > maxX) maxX = lx + s;
    if (ly + s > maxY) maxY = ly + s;
  }

  if (!Number.isFinite(minX)) {
    minX = -10;
    maxX = 10;
  }
  return { limbs: out, leaves: leafOut, bounds: { minX, maxX, minY: 0, maxY: Math.max(maxY, 10) } };
}

// Точка на ломаной по доле длины u ∈ [0, 1] (по сегментам равной длины).
export function samplePolyline(pts, u) {
  const last = pts.length - 1;
  const f = clamp01(u) * last;
  const k = Math.min(last - 1, Math.floor(f));
  if (last < 1) return { ...pts[0] };
  const w = f - k;
  const a = pts[k];
  const b = pts[k + 1];
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, r: a.r + (b.r - a.r) * w, a: a.a + (b.a - a.a) * w };
}
