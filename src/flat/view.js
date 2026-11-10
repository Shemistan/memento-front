// Схема 2D: SVG-представление дерева с плавным ростом, листьями,
// масштабом и перетаскиванием. Данные и раскладка — в model.js и flat/layout.js.
import { ROOT_ID } from '../model.js';
import {
  NODE_H,
  ROW,
  barkRadius,
  branchCurve,
  branchPath,
  curveAngle,
  layoutTree,
  leafSpots,
  rootsPath,
  trunkPath,
  twigLeaves,
  twigPath,
  twigSpecs,
} from './layout.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const GROW_MS = 700;
const STAGGER_MS = 260; // задержка между поколениями при «вырастить заново»
const EASE = 0.16; // доля пути к цели за кадр
const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const LEAF = 'M0 0C-0.55 -0.25 -0.6 -0.75 0 -1C0.6 -0.75 0.55 -0.25 0 0Z';

const el = (name, attrs = {}, parent) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (v) => 1 - (1 - v) ** 3;
const near = (a, b) => Math.abs(a - b) < 0.05;
const DEG = Math.PI / 180;
const UP_BIAS = 0.3; // веточки тянутся к свету: направление подмешивается к «вверх»

// Лист в локальных координатах группы: s — точка из leafSpots/twigLeaves.
function leaf(s) {
  const g = el('g', { transform: `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${s.angle.toFixed(0)})` });
  el('path', { d: LEAF, class: `flat-leaf tone-${s.tone}`, transform: `scale(${s.size.toFixed(1)})`, style: `--delay:${s.delay}ms` }, g);
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
  const measure = (name) => Math.max(64, Math.ceil(ctx.measureText(name).width + 30));

  const world = el('g', { class: 'flat-world' }, svg);
  const ground = el('g', { class: 'flat-ground' }, world);
  const hill = el('ellipse', { class: 'flat-hill' }, ground);
  const soil = el('rect', { class: 'flat-soil' }, ground);
  const roots = el('path', { class: 'flat-bark flat-real flat-roots' }, world);
  const decorLayer = el('g', { class: 'flat-decor' }, world);
  const trunk = el('path', { class: 'flat-bark flat-real' }, world);
  const branchLayer = el('g', {}, world);
  const knotLayer = el('g', {}, world);
  const decorLeafLayer = el('g', { class: 'flat-decor' }, world);
  const leafLayer = el('g', { class: 'flat-leaves' }, world);
  const nodeLayer = el('g', {}, world);

  const items = new Map(); // id → { branch, leaves, node, rect, text, shown, appear }
  let layout = null;
  let current = null; // дерево модели, по которому построена раскладка
  let row = ROW;
  let selectedId = null;
  let animating = true;
  let cam = { s: 1, x: 0, y: 0 };
  let autoFit = true;
  let placed = false; // камера ещё ни разу не ставилась — первый кадр без наплыва
  let lastArea = null;

  function makeItem(n, appear) {
    const branch = n.id === ROOT_ID ? null : el('path', { class: 'flat-bark flat-real' }, branchLayer);
    // Наплыв в развилке: без табличек стык веток выглядит как у настоящего дерева.
    const knot = el('circle', { class: 'flat-knot', r: 0 }, knotLayer);
    const decor = el('g', {}, decorLayer);
    const decorLeaves = el('g', {}, decorLeafLayer);
    const leaves = el('g', {}, leafLayer);
    const node = el('g', { class: 'flat-node', tabindex: '0', role: 'button', 'data-id': n.id }, nodeLayer);
    const rect = el('rect', { y: -NODE_H / 2, height: NODE_H, rx: NODE_H / 2 }, node);
    const text = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, node);
    return { branch, knot, decor, decorLeaves, twigs: [], leaves, node, rect, text, appear, tip: null, shown: null };
  }

  function fillLeaves(item, n) {
    const tip = n.tips === 1 && n.id !== ROOT_ID;
    if (item.tip === tip && item.leafWidth === n.width) return;
    item.tip = tip;
    item.leafWidth = n.width;
    item.leaves.replaceChildren(...leafSpots(n.id, { tip, width: n.width }).map(leaf));
    fillTwigs(item, n, tip);
  }

  // Декоративные веточки ветки: контуры пересчитываются каждый кадр,
  // пучки листьев на кончиках строятся один раз.
  function fillTwigs(item, n, tip) {
    item.decor.replaceChildren();
    item.decorLeaves.replaceChildren();
    item.twigs = [];
    if (n.id === ROOT_ID) return;
    twigSpecs(n.id, { tip }).forEach((spec, i) => {
      const parts = [spec, ...spec.kids].map((part) => ({
        spec: part,
        path: el('path', { class: 'flat-bark' }, item.decor),
        leaves: el('g', {}, item.decorLeaves),
      }));
      parts.forEach((part, k) => part.leaves.append(...twigLeaves(`${n.id}/${i}/${k}`).map(leaf)));
      item.twigs.push(parts);
    });
  }

  function drawTwigs(item, at, rAt, grow) {
    for (const [main, ...kids] of item.twigs) {
      const start = at(main.spec.t);
      const angle = upward(curveAngle(at, main.spec.t) + main.spec.angle * DEG);
      const twig = twigPath(start, angle, main.spec.len * row * 0.8 * grow, Math.max(1.3, rAt(main.spec.t) * 0.75));
      place(main, twig, grow);
      for (const kid of kids) {
        const len = main.spec.len * row * 0.8 * grow;
        const from = { x: start.x + Math.cos(angle) * len * kid.spec.t, y: start.y + Math.sin(angle) * len * kid.spec.t };
        const sub = twigPath(from, upward(angle + kid.spec.angle * DEG), len * kid.spec.len, Math.max(0.9, rAt(main.spec.t) * 0.45));
        place(kid, sub, grow);
      }
    }
  }

  function place(part, twig, grow) {
    part.path.setAttribute('d', twig.d);
    part.leaves.setAttribute(
      'transform',
      `translate(${twig.tip.x.toFixed(1)} ${twig.tip.y.toFixed(1)}) rotate(${(twig.angle / DEG + 90).toFixed(0)}) scale(${grow.toFixed(3)})`,
    );
  }

  function setTree(tree, { regrow = false } = {}) {
    current = tree;
    layout = layoutTree(tree, { measure, row });
    const now = performance.now();
    for (const [id, item] of items) {
      if (!regrow && layout.nodes.has(id)) continue;
      item.node.remove();
      item.leaves.remove();
      item.decor.remove();
      item.decorLeaves.remove();
      item.knot.remove();
      item.branch?.remove();
      items.delete(id);
    }
    const names = new Map(tree.nodes.map((n) => [n.id, n.name]));
    for (const id of layout.order) {
      const n = layout.nodes.get(id);
      let item = items.get(id);
      if (!item) {
        item = makeItem(n, regrow ? now + n.depth * STAGGER_MS : now);
        // Новая ветка выходит из того места, где сейчас виден родитель.
        const parent = items.get(n.parentId)?.shown;
        item.shown = parent && !regrow ? { ...parent } : { x: n.x, y: n.y, r: 0 };
        items.set(id, item);
      }
      item.text.textContent = names.get(id);
      item.node.setAttribute('aria-label', names.get(id));
      item.rect.setAttribute('x', -n.width / 2);
      item.rect.setAttribute('width', n.width);
      fillLeaves(item, n);
    }
    // Порядок в слоях как в дереве: дети поверх родителей, соседи — по порядку.
    for (const id of layout.order) {
      const item = items.get(id);
      if (item.branch) branchLayer.append(item.branch);
      decorLayer.append(item.decor);
      decorLeafLayer.append(item.decorLeaves);
      leafLayer.append(item.leaves);
      nodeLayer.append(item.node);
    }
    setSelected(selectedId);
    animating = true;
  }

  function setSelected(id) {
    selectedId = id;
    for (const [key, item] of items) item.node.classList.toggle('is-selected', key === id);
  }

  function replay() {
    const now = performance.now();
    for (const id of layout.order) {
      const item = items.get(id);
      const n = layout.nodes.get(id);
      item.appear = now + n.depth * STAGGER_MS;
      item.shown = { x: n.x, y: n.y, r: 0 };
    }
    animating = true;
  }

  // --- камера ---

  const groundY = () => ROW * 0.9;
  const LEAF_TOP = 40; // запас над верхним ярусом под листья
  const SOIL = 30; // видимая полоса земли под стволом

  function viewport(area) {
    const w = Math.max(120, area.right - area.left - 72);
    // На узком экране не мельчим ниже читаемого: остальное — перетаскиванием.
    return { w, h: Math.max(120, area.height - 52), minScale: w < 600 ? 0.6 : 0 };
  }
  const widthScale = (view, w) => Math.max(view.minScale, Math.min(1.25, view.w / w));

  // Широкое дерево на высоком экране вытягиваем по высоте: ярусы раздвигаются,
  // ветки становятся стройнее, а экран не пустует.
  function rowFor(area) {
    const b = layout.bounds;
    const depth = Math.round(-b.minY / layout.row);
    if (depth < 1) return ROW;
    const view = viewport(area);
    const s = widthScale(view, b.maxX - b.minX + 60);
    const fill = (view.h / s - LEAF_TOP - SOIL - NODE_H / 2 - groundY()) / depth;
    return Math.max(ROW, Math.min(ROW * 2, fill));
  }

  function fitTarget(area) {
    const b = layout.bounds;
    const bottom = 24;
    const view = viewport(area);
    const w = b.maxX - b.minX + 60; // запас под листья
    const h = groundY() + SOIL - (b.minY - LEAF_TOP);
    const s = Math.min(widthScale(view, w), view.h / h);
    return {
      s,
      x: (area.left + area.right) / 2 - ((b.minX + b.maxX) / 2) * s,
      y: area.height - bottom - (groundY() + SOIL) * s,
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

    if (autoFit) {
      const want = rowFor(area);
      if (Math.abs(want - row) > 2) {
        row = want;
        layout = layoutTree(current, { measure, row });
      }
    }

    const now = performance.now();
    let busy = false;

    if (autoFit) {
      const t = fitTarget(area);
      const k = placed ? EASE : 1;
      placed = true;
      cam = { s: cam.s + (t.s - cam.s) * k, x: cam.x + (t.x - cam.x) * k, y: cam.y + (t.y - cam.y) * k };
      if (!near(cam.s * 100, t.s * 100) || !near(cam.x, t.x) || !near(cam.y, t.y)) busy = true;
      applyCamera();
    }

    for (const id of layout.order) {
      const n = layout.nodes.get(id);
      const item = items.get(id);
      const grow = easeOut(clamp01((now - item.appear) / GROW_MS));
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
      item.node.setAttribute('transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)}) scale(${grow.toFixed(3)})`);
      item.leaves.setAttribute('transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)}) scale(${grow.toFixed(3)})`);
      item.knot.setAttribute('cx', pos.x.toFixed(1));
      item.knot.setAttribute('cy', pos.y.toFixed(1));
      item.knot.setAttribute('r', n.tips > 1 || !parent ? (s.r * 1.15 * grow).toFixed(2) : 0);
      if (item.branch) {
        const r0 = Math.min(s.r, parent.r * 0.92) * Math.max(0.3, grow);
        const r1 = Math.max(1.6, s.r * 0.55) * grow;
        item.branch.setAttribute('d', branchPath(parent, pos, r0, r1));
        drawTwigs(item, branchCurve(parent, pos), (t) => r1 + (r0 - r1) * (1 - t) ** 1.4, grow);
      }
    }

    const root = items.get(ROOT_ID);
    const gy = groundY();
    const tr = root.shown.r * (0.35 + 0.65 * easeOut(clamp01((now - root.appear) / GROW_MS)));
    trunk.setAttribute('d', trunkPath(root.pos, tr * 1.15, gy));
    roots.setAttribute('d', rootsPath(root.pos.x, tr, gy));
    const b = layout.bounds;
    const span = Math.max(600, b.maxX - b.minX + 400);
    hill.setAttribute('cx', (b.minX + b.maxX) / 2);
    hill.setAttribute('cy', gy + 40);
    hill.setAttribute('rx', span * 0.6);
    hill.setAttribute('ry', 46);
    soil.setAttribute('x', (b.minX + b.maxX) / 2 - span * 4);
    soil.setAttribute('y', gy + 18);
    soil.setAttribute('width', span * 8);
    soil.setAttribute('height', 4000);

    animating = busy;
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
    setTree,
    setSelected,
    replay,
    fit,
    frame,
    zoom: (factor) => {
      const area = lastArea ?? { left: 0, right: window.innerWidth, height: window.innerHeight };
      zoomAt((area.left + area.right) / 2, area.height / 2, factor);
    },
    setLeaves: (on) => svg.classList.toggle('no-leaves', !on),
    // Узлы видны: таблички на месте, веточки вне модели приглушены.
    // Скрыты: все ветки одинаковые — просто дерево.
    setNodes: (on) => svg.classList.toggle('show-nodes', on),
    wake: () => {
      animating = true;
    },
  };
}
