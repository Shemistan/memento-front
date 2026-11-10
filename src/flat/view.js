// Схема 2D: SVG-представление семьи — деревья людей, пары-лианы, шкала лет,
// плавный рост, масштаб и перетаскивание. Данные — family/model.js,
// раскладка — flat/family-layout.js, геометрия — flat/layout.js.
import { getPerson, getUnion } from '../family/model.js';
import { hashString } from '../layout.js';
import { TRUNK_H, UNION_W, YEAR_PX, familyLayout, personLabel } from './family-layout.js';
import {
  NODE_H,
  TWIG_UNIT,
  barkRadius,
  branchCurve,
  branchPath,
  curveAngle,
  leafSpots,
  rootsPath,
  trunkPath,
  twigLeaves,
  twigPath,
  twigSpecs,
  vineCurve,
  vinePath,
  wrapPath,
} from './layout.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const GROW_MS = 700;
const STAGGER_MS = 260; // задержка между поколениями при «вырастить заново»
const EASE = 0.16; // доля пути к цели за кадр
const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const LEAF = 'M0 0C-0.55 -0.25 -0.6 -0.75 0 -1C0.6 -0.75 0.55 -0.25 0 0Z';
const VINE_LEAVES = 7;
// Цвет лианы — свой у каждой пары, чтобы дети разных браков различались.
const VINE_COLORS = ['#c2507a', '#7b5cc4', '#d0862b', '#2f8fa8', '#b8483a', '#4f9a3a'];
const DEG = Math.PI / 180;
const UP_BIAS = 0.3; // веточки тянутся к свету: направление подмешивается к «вверх»
const LEAF_TOP = 40; // запас над верхним узлом под листья
const SOIL = 30; // видимая полоса земли под стволами

const el = (name, attrs = {}, parent) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (v) => 1 - (1 - v) ** 3;
const near = (a, b) => Math.abs(a - b) < 0.05;
const fx = (v) => v.toFixed(1);
// По порядку пары в семье: соседние браки не совпадают по цвету.
export const vineColor = (fam, unionId) => VINE_COLORS[Math.max(0, fam.unions.findIndex((u) => u.id === unionId)) % VINE_COLORS.length];

// Лист в локальных координатах группы: s — точка из leafSpots/twigLeaves.
function leaf(s) {
  const g = el('g', { transform: `translate(${fx(s.x)} ${fx(s.y)}) rotate(${s.angle.toFixed(0)})` });
  el('path', { d: LEAF, class: `flat-leaf tone-${s.tone}`, transform: `scale(${fx(s.size)})`, style: `--delay:${s.delay}ms` }, g);
  return g;
}

function upward(angle) {
  const x = Math.cos(angle) * (1 - UP_BIAS);
  const y = Math.sin(angle) * (1 - UP_BIAS) - UP_BIAS;
  return Math.atan2(y, x);
}

export function createFlatView(svg, { onSelect }) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = FONT;
  const measure = (person) => Math.max(64, Math.ceil(ctx.measureText(personLabel(person)).width + 30));

  const world = el('g', { class: 'flat-world' }, svg);
  const yearLayer = el('g', { class: 'flat-years' }, world);
  const ground = el('g', { class: 'flat-ground' }, world);
  const hill = el('ellipse', { class: 'flat-hill' }, ground);
  const soil = el('rect', { class: 'flat-soil' }, ground);
  const decorLayer = el('g', { class: 'flat-decor' }, world);
  const trunkLayer = el('g', {}, world);
  const branchLayer = el('g', {}, world);
  const knotLayer = el('g', {}, world);
  const decorLeafLayer = el('g', { class: 'flat-decor' }, world);
  const leafLayer = el('g', { class: 'flat-leaves' }, world);
  const vineLayer = el('g', { class: 'flat-vines' }, world);
  const nodeLayer = el('g', {}, world);

  const items = new Map(); // id узла раскладки → элементы и показанное состояние
  let layout = null;
  let parents = new Set(); // узлы, у которых есть продолжение
  let fam = null;
  let yearPx = YEAR_PX;
  let selectedId = null;
  let animating = true;
  let cam = { s: 1, x: 0, y: 0 };
  let autoFit = true;
  let placed = false; // камера ещё ни разу не ставилась — первый кадр без наплыва
  let lastArea = null;

  function makeItem(n, appear) {
    const item = { kind: n.kind, isRoot: n.parentId === null, appear, shown: null, twigs: [], tip: null, els: [] };
    const keep = (node) => {
      item.els.push(node);
      return node;
    };
    if (n.parentId) item.branch = keep(el('path', { class: 'flat-bark flat-real' }, branchLayer));
    else {
      item.trunk = keep(el('path', { class: 'flat-bark flat-real' }, trunkLayer));
      item.roots = keep(el('path', { class: 'flat-bark flat-real flat-roots' }, trunkLayer));
    }
    // Наплыв в развилке: без табличек стык веток выглядит как у настоящего дерева.
    item.knot = keep(el('circle', { class: 'flat-knot', r: 0 }, knotLayer));
    item.node = keep(el('g', { class: `flat-node flat-node--${n.kind}`, tabindex: '0', role: 'button', 'data-id': n.id }, nodeLayer));
    if (n.kind === 'person') {
      item.decor = keep(el('g', {}, decorLayer));
      item.decorLeaves = keep(el('g', {}, decorLeafLayer));
      item.leaves = keep(el('g', {}, leafLayer));
      item.rect = el('rect', { y: -NODE_H / 2, height: NODE_H, rx: NODE_H / 2 }, item.node);
      item.text = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, item.node);
    } else {
      const color = vineColor(fam, n.id);
      el('circle', { r: UNION_W / 2, fill: color, class: 'flat-union' }, item.node);
      el('circle', { cx: -3.2, r: 4.6, class: 'flat-ring' }, item.node);
      el('circle', { cx: 3.2, r: 4.6, class: 'flat-ring' }, item.node);
      item.text = el('text', { x: UNION_W / 2 + 5, 'dominant-baseline': 'central', class: 'flat-union-year' }, item.node);
      item.vine = keep(el('path', { class: 'flat-vine', stroke: color }, vineLayer));
      item.vineLeaves = keep(el('g', {}, vineLayer));
      item.vineLeafEls = Array.from({ length: VINE_LEAVES }, (_, i) =>
        el('path', { d: LEAF, class: `flat-leaf tone-${i % 4}`, style: `--delay:${i * 40}ms` }, item.vineLeaves),
      );
      item.wraps = new Map();
    }
    return item;
  }

  function dropItem(item) {
    for (const node of item.els) node.remove();
    for (const wrap of item.wraps?.values() ?? []) wrap.remove();
  }

  function fillPerson(item, n, person, childless) {
    // Пышная крона — на концах веток и у одинокого саженца; корню с потомками
    // листья у таблички не нужны — там ствол.
    const tip = childless;
    item.text.textContent = personLabel(person);
    item.node.setAttribute('aria-label', personLabel(person));
    item.rect.setAttribute('x', -n.width / 2);
    item.rect.setAttribute('width', n.width);
    // У ушедших — осенние листья (если включено «Осень у ушедших»).
    item.leaves.classList.toggle('is-gone', person.dead);
    item.decorLeaves.classList.toggle('is-gone', person.dead);
    item.node.classList.toggle('is-gone', person.dead);
    if (item.tip === tip && item.leafWidth === n.width) return;
    item.tip = tip;
    item.leafWidth = n.width;
    const bare = n.parentId === null && !childless;
    item.leaves.replaceChildren(...(bare ? [] : leafSpots(n.id, { tip, width: n.width }).map(leaf)));
    item.decor.replaceChildren();
    item.decorLeaves.replaceChildren();
    item.twigs = [];
    if (n.parentId === null) return;
    // Декоративные веточки: контуры пересчитываются каждый кадр,
    // пучки листьев на кончиках строятся один раз.
    twigSpecs(n.id, { tip }).forEach((spec, i) => {
      const parts = [spec, ...spec.kids].map((part, k) => {
        const leaves = el('g', {}, item.decorLeaves);
        leaves.append(...twigLeaves(`${n.id}/${i}/${k}`).map(leaf));
        return { spec: part, path: el('path', { class: 'flat-bark' }, item.decor), leaves };
      });
      item.twigs.push(parts);
    });
  }

  function fillUnion(item, n, union) {
    const host = getPerson(fam, union.host);
    const partner = getPerson(fam, union.partner);
    item.partnerId = union.partner;
    item.text.textContent = union.since ?? '';
    item.node.setAttribute('aria-label', `Пара: ${host.name} и ${partner.name}`);
    // Лиана обвивает ветки детей этой пары — но не продолжение к следующей паре.
    const kids = [...layout.nodes.values()].filter((k) => k.parentId === n.id && k.kind === 'person').map((k) => k.id);
    for (const [kid, wrap] of item.wraps) {
      if (!kids.includes(kid)) {
        wrap.remove();
        item.wraps.delete(kid);
      }
    }
    for (const kid of kids) {
      if (!item.wraps.has(kid)) item.wraps.set(kid, el('path', { class: 'flat-vine flat-vine--wrap', stroke: item.vine.getAttribute('stroke') }, vineLayer));
    }
  }

  function relayout() {
    layout = familyLayout(fam, { measure, yearPx });
    parents = new Set([...layout.nodes.values()].map((n) => n.parentId));
    drawYears();
  }

  function setFamily(family, { regrow = false } = {}) {
    fam = family;
    relayout();
    const now = performance.now();
    const reborn = new Map(); // корень стал ребёнком или наоборот: элементы другие, состояние то же
    for (const [id, item] of items) {
      const n = layout.nodes.get(id);
      if (!regrow && n && item.kind === n.kind && item.isRoot === (n.parentId === null)) continue;
      if (!regrow && n && item.kind === n.kind) reborn.set(id, item);
      dropItem(item);
      items.delete(id);
    }
    const depth = new Map();
    for (const id of layout.order) {
      const n = layout.nodes.get(id);
      depth.set(id, n.parentId ? depth.get(n.parentId) + 1 : 0);
      let item = items.get(id);
      if (!item) {
        const old = reborn.get(id);
        item = makeItem(n, old ? old.appear : regrow ? now + depth.get(id) * STAGGER_MS : now);
        // Новая ветка выходит из того места, где сейчас виден родитель.
        const parent = items.get(n.parentId)?.shown;
        item.shown = old ? old.shown : parent && !regrow ? { ...parent } : { x: n.x, y: n.y, r: 0 };
        items.set(id, item);
      }
      if (n.kind === 'person') fillPerson(item, n, getPerson(fam, id), !parents.has(id));
    }
    for (const id of layout.order) {
      const n = layout.nodes.get(id);
      if (n.kind === 'union') fillUnion(items.get(id), n, getUnion(fam, id));
    }
    // Порядок в слоях как в дереве: дети поверх родителей, соседи — по порядку.
    for (const id of layout.order) for (const node of items.get(id).els) node.parentNode?.append(node);
    setSelected(selectedId);
    animating = true;
  }

  function setSelected(id) {
    selectedId = id;
    for (const [key, item] of items) item.node.classList.toggle('is-selected', key === id);
  }

  function replay() {
    const now = performance.now();
    const depth = new Map();
    for (const id of layout.order) {
      const n = layout.nodes.get(id);
      depth.set(id, n.parentId ? depth.get(n.parentId) + 1 : 0);
      const item = items.get(id);
      item.appear = now + depth.get(id) * STAGGER_MS;
      item.shown = { x: n.x, y: n.y, r: 0 };
    }
    animating = true;
  }

  // Шкала десятилетий: видно, кто когда родился.
  function drawYears() {
    const b = layout.bounds;
    const years = [...layout.nodes.values()].map((n) => n.year);
    yearLayer.replaceChildren();
    if (!years.length) return;
    const left = b.minX - 120;
    const right = b.maxX + 80;
    for (let yr = Math.ceil(Math.min(...years) / 10) * 10; yr <= Math.max(...years) + 5; yr += 10) {
      const y = layout.yearY(yr);
      if (y > layout.groundY - 10) continue;
      el('line', { x1: left + 44, x2: right, y1: fx(y), y2: fx(y) }, yearLayer);
      el('text', { x: left + 36, y: fx(y), 'text-anchor': 'end', 'dominant-baseline': 'central' }, yearLayer).textContent = yr;
    }
  }

  // --- камера ---

  function viewport(area) {
    const w = Math.max(120, area.right - area.left - 72);
    // На узком экране не мельчим ниже читаемого: остальное — перетаскиванием.
    return { w, h: Math.max(120, area.height - 52), minScale: w < 600 ? 0.6 : 0 };
  }
  const widthScale = (view, w) => Math.max(view.minScale, Math.min(1.25, view.w / w));
  const contentW = () => layout.bounds.maxX - layout.bounds.minX + 200; // с запасом под шкалу лет

  // Широкая семья на высоком экране: время растягивается по высоте,
  // чтобы экран не пустовал и разница в годах читалась лучше.
  function yearPxFor(area) {
    const years = [...layout.nodes.values()].map((n) => n.year);
    const span = Math.max(...years) - Math.min(...years);
    if (!(span > 0)) return YEAR_PX;
    const view = viewport(area);
    const s = widthScale(view, contentW());
    const fill = (view.h / s - LEAF_TOP - SOIL - NODE_H - TRUNK_H) / span;
    return Math.max(3.5, Math.min(9, fill));
  }

  function fitTarget(area) {
    const b = layout.bounds;
    const view = viewport(area);
    const h = layout.groundY + SOIL - (b.minY - LEAF_TOP);
    const s = Math.min(widthScale(view, contentW()), view.h / h);
    return {
      s,
      x: (area.left + area.right) / 2 - ((b.minX + b.maxX) / 2 - 20) * s,
      y: area.height - 24 - (layout.groundY + SOIL) * s,
    };
  }

  function applyCamera() {
    world.setAttribute('transform', `translate(${cam.x.toFixed(2)} ${cam.y.toFixed(2)}) scale(${cam.s.toFixed(4)})`);
  }

  function fit() {
    autoFit = true;
    animating = true;
  }

  function zoomAt(px, py, factor) {
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.s * factor));
    cam.x = px - ((px - cam.x) * s) / cam.s;
    cam.y = py - ((py - cam.y) * s) / cam.s;
    cam.s = s;
    autoFit = false;
    applyCamera();
  }

  // --- кадр ---

  function frame(area) {
    if (!layout) return;
    const resized = !lastArea || lastArea.left !== area.left || lastArea.right !== area.right || lastArea.height !== area.height;
    lastArea = area;
    if (resized && autoFit) animating = true;
    if (!animating) return;

    let busy = false;
    if (autoFit) {
      const want = yearPxFor(area);
      if (Math.abs(want - yearPx) > 0.15) {
        yearPx = want;
        relayout();
      }
      const t = fitTarget(area);
      const k = placed ? EASE : 1;
      placed = true;
      cam = { s: cam.s + (t.s - cam.s) * k, x: cam.x + (t.x - cam.x) * k, y: cam.y + (t.y - cam.y) * k };
      applyCamera();
      busy = !near(cam.s * 100, t.s * 100) || !near(cam.x, t.x) || !near(cam.y, t.y);
    }

    const now = performance.now();
    for (const id of layout.order) {
      const n = layout.nodes.get(id);
      const item = items.get(id);
      const grow = easeOut(clamp01((now - item.appear) / GROW_MS));
      item.grow = grow;
      if (grow < 1) busy = true;
      const s = item.shown;
      const r = barkRadius(n.tips);
      s.x += (n.x - s.x) * EASE;
      s.y += (n.y - s.y) * EASE;
      s.r += (r - s.r) * EASE;
      if (!near(s.x, n.x) || !near(s.y, n.y) || !near(s.r, r)) busy = true;

      const parent = n.parentId ? items.get(n.parentId).shown : null;
      const pos = parent ? { x: parent.x + (s.x - parent.x) * grow, y: parent.y + (s.y - parent.y) * grow } : s;
      item.pos = pos;
      const place = `translate(${fx(pos.x)} ${fx(pos.y)}) scale(${grow.toFixed(3)})`;
      item.node.setAttribute('transform', place);
      item.leaves?.setAttribute('transform', place);
      item.knot.setAttribute('cx', fx(pos.x));
      item.knot.setAttribute('cy', fx(pos.y));
      item.knot.setAttribute('r', n.tips > 1 || !parent ? (s.r * 1.15 * grow).toFixed(2) : 0);
      if (parent) {
        const r0 = Math.min(s.r, parent.r * 0.92) * Math.max(0.3, grow);
        // Ветка, которая идёт дальше, не сужается в шейку перед развилкой.
        const r1 = Math.max(1.6, s.r * (n.tips > 1 || parents.has(id) ? 0.9 : 0.55)) * grow;
        item.at = branchCurve(parent, pos);
        item.rAt = (t) => r1 + (r0 - r1) * (1 - t) ** 1.4;
        item.branch.setAttribute('d', branchPath(parent, pos, r0, r1));
        if (n.kind === 'person') drawTwigs(item, grow);
      } else {
        const tr = s.r * (0.35 + 0.65 * grow);
        item.trunk.setAttribute('d', trunkPath(pos, tr * 1.15, layout.groundY));
        item.roots.setAttribute('d', rootsPath(pos.x, tr, layout.groundY, id));
      }
    }
    for (const id of layout.order) if (layout.nodes.get(id).kind === 'union') drawVine(items.get(id));

    const b = layout.bounds;
    const span = Math.max(600, b.maxX - b.minX + 400);
    hill.setAttribute('cx', (b.minX + b.maxX) / 2);
    hill.setAttribute('cy', layout.groundY + 40);
    hill.setAttribute('rx', span * 0.6);
    hill.setAttribute('ry', 46);
    soil.setAttribute('x', (b.minX + b.maxX) / 2 - span * 4);
    soil.setAttribute('y', layout.groundY + 18);
    soil.setAttribute('width', span * 8);
    soil.setAttribute('height', 4000);

    animating = busy;
  }

  function drawTwigs(item, grow) {
    for (const [main, ...kids] of item.twigs) {
      const start = item.at(main.spec.t);
      const angle = upward(curveAngle(item.at, main.spec.t) + main.spec.angle * DEG);
      const len = main.spec.len * TWIG_UNIT * grow;
      placeTwig(main, twigPath(start, angle, len, Math.max(1.3, item.rAt(main.spec.t) * 0.75)), grow);
      for (const kid of kids) {
        const from = { x: start.x + Math.cos(angle) * len * kid.spec.t, y: start.y + Math.sin(angle) * len * kid.spec.t };
        const sub = twigPath(from, upward(angle + kid.spec.angle * DEG), len * kid.spec.len, Math.max(0.9, item.rAt(main.spec.t) * 0.45));
        placeTwig(kid, sub, grow);
      }
    }
  }

  function placeTwig(part, twig, grow) {
    part.path.setAttribute('d', twig.d);
    part.leaves.setAttribute('transform', `translate(${fx(twig.tip.x)} ${fx(twig.tip.y)}) rotate(${(twig.angle / DEG + 90).toFixed(0)}) scale(${grow.toFixed(3)})`);
  }

  // Лиана: от супруга к значку пары, дальше вьётся по веткам детей пары.
  function drawVine(item) {
    const from = items.get(item.partnerId)?.pos;
    if (!from) return;
    const grow = item.grow * (items.get(item.partnerId).grow ?? 1);
    const at = vineCurve(from, item.pos);
    item.vine.setAttribute('d', vinePath(at, Math.max(0.001, grow)));
    item.vineLeafEls.forEach((leafEl, i) => {
      const t = (i + 0.6) / VINE_LEAVES;
      const p = at(t);
      const angle = curveAngle(at, t) / DEG + (i % 2 ? 60 : -120);
      const size = t <= grow ? 9 + (i % 3) * 1.5 : 0;
      leafEl.setAttribute('transform', `translate(${fx(p.x)} ${fx(p.y)}) rotate(${angle.toFixed(0)}) scale(${size})`);
    });
    for (const [kid, wrap] of item.wraps) {
      const child = items.get(kid);
      if (!child?.at) continue;
      wrap.setAttribute('d', wrapPath(child.at, child.rAt, Math.max(0.001, child.grow * grow), (hashString(kid) % 628) / 100));
    }
  }

  // --- ввод ---

  const pointers = new Map();
  let drag = null;

  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture?.(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: false, target: e.target.closest?.('[data-id]')?.dataset.id ?? null };
    if (pointers.size === 2) drag.pinch = pinchState();
  });

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: cam.s };
  }

  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !drag) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.moved = true;
    if (!drag.moved) return;
    autoFit = false;
    if (pointers.size >= 2 && drag.pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (drag.pinch.s * dist) / drag.pinch.dist / cam.s);
      return;
    }
    cam.x += (e.clientX - prev.x) / pointers.size;
    cam.y += (e.clientY - prev.y) / pointers.size;
    applyCamera();
    svg.classList.add('is-dragging');
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    svg.classList.remove('is-dragging');
    if (drag && !drag.moved && drag.target && e.type === 'pointerup') onSelect(drag.target);
    if (!pointers.size) drag = null;
    else if (drag) drag.pinch = null;
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);

  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)));
    },
    { passive: false },
  );

  svg.addEventListener('keydown', (e) => {
    const id = e.target.closest?.('[data-id]')?.dataset.id;
    if (id && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSelect(id);
    }
  });

  return {
    setFamily,
    setSelected,
    replay,
    fit,
    frame,
    zoom: (factor) => {
      const area = lastArea ?? { left: 0, right: window.innerWidth, height: window.innerHeight };
      zoomAt((area.left + area.right) / 2, area.height / 2, factor);
    },
    setLeaves: (on) => svg.classList.toggle('no-leaves', !on),
    // Узлы видны: таблички, пары и шкала лет на месте, веточки вне модели
    // приглушены. Скрыты: все ветки одинаковые — просто деревья с лианами.
    setNodes: (on) => svg.classList.toggle('show-nodes', on),
    setAutumn: (on) => svg.classList.toggle('autumn', on),
    wake: () => {
      animating = true;
    },
  };
}
