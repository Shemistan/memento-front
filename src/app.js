import {
  ROOT_ID,
  addBranch,
  childrenOf,
  deserialize,
  getNode,
  parseOutline,
  removeBranch,
  renameBranch,
  serialize,
  toOutline,
} from './model.js';
import { buildPlan, carryOver, pose } from './layout.js';
import { createRenderer } from './render.js';

const STORAGE_KEY = 'memento-tree:v1';

const DEMO = `Ствол
  Детство
    Двор
    Школа
      Первый учитель
  Семья
    Родители
    Сёстры и братья
  Друзья
    Университет
    Путешествия
  Работа
    Первый проект
    Команда
  Увлечения
    Музыка
    Горы`;

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $('scene'),
  tooltip: $('tooltip'),
  panel: $('panel'),
  panelToggle: $('panel-toggle'),
  leaves: $('leaves-toggle'),
  labels: $('labels-toggle'),
  wind: $('wind-toggle'),
  renameForm: $('rename-form'),
  renameInput: $('rename-input'),
  addForm: $('add-form'),
  addInput: $('add-input'),
  remove: $('remove-btn'),
  stats: $('stats'),
  list: $('branch-list'),
  outline: $('outline'),
  outlineApply: $('outline-apply'),
  outlineExport: $('outline-export'),
  outlineError: $('outline-error'),
  replay: $('replay-btn'),
  reset: $('reset-btn'),
};

const state = loadState();
let plan = buildPlan(state.tree);
let epoch = Date.now();
let hoverId = null;
let leafAmount = state.leaves ? 1 : 0;
let windAmount = state.wind ? 1 : 0;
const renderer = createRenderer(els.canvas);

function loadState() {
  const fallback = { tree: parseOutline(DEMO), selectedId: ROOT_ID, leaves: true, labels: false, wind: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    const tree = deserialize(JSON.stringify(data.tree));
    return {
      tree,
      selectedId: getNode(tree, data.selectedId) ? data.selectedId : ROOT_ID,
      leaves: data.leaves !== false,
      labels: Boolean(data.labels),
      wind: data.wind !== false,
    };
  } catch {
    return fallback;
  }
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tree: JSON.parse(serialize(state.tree)),
        selectedId: state.selectedId,
        leaves: state.leaves,
        labels: state.labels,
        wind: state.wind,
      }),
    );
  } catch {
    // Хранилище недоступно (приватный режим) — дерево живёт до перезагрузки.
  }
}

// regrow — дерево задано заново и вырастает с нуля; иначе старые ветки
// плавно подстраиваются под новые, а добавленные прорастают.
function treeChanged({ regrow = false } = {}) {
  if (regrow) {
    epoch = Date.now();
    plan = buildPlan(state.tree);
  } else {
    plan = carryOver(plan, buildPlan(state.tree), Date.now());
  }
  if (!getNode(state.tree, state.selectedId)) state.selectedId = ROOT_ID;
  saveState();
  renderPanel();
}

function select(id) {
  if (!id || !getNode(state.tree, id)) return;
  state.selectedId = id;
  saveState();
  renderPanel();
}

function renderPanel() {
  const node = getNode(state.tree, state.selectedId);
  els.renameInput.value = node.name;
  els.addInput.placeholder = `Новая ветка от «${node.name}»`;
  els.remove.disabled = node.id === ROOT_ID;
  els.remove.title = node.id === ROOT_ID ? 'Ствол удалить нельзя' : '';
  const count = state.tree.nodes.length - 1;
  els.stats.textContent = `${count} ${plural(count, 'ветка', 'ветки', 'веток')}`;

  els.list.replaceChildren(listItem(ROOT_ID));
  els.list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
}

function listItem(id) {
  const node = getNode(state.tree, id);
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = node.name;
  btn.dataset.id = id;
  btn.setAttribute('aria-current', String(id === state.selectedId));
  li.append(btn);
  const kids = childrenOf(state.tree, id);
  if (kids.length) {
    const ul = document.createElement('ul');
    for (const kid of kids) ul.append(listItem(kid.id));
    li.append(ul);
  }
  return li;
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// --- события панели ---

els.list.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (btn) select(btn.dataset.id);
});

els.addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const node = addBranch(state.tree, state.selectedId, els.addInput.value, Date.now());
  els.addInput.value = '';
  state.selectedId = node.id;
  treeChanged();
});

els.renameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  renameBranch(state.tree, state.selectedId, els.renameInput.value);
  treeChanged();
});

els.remove.addEventListener('click', () => {
  const node = getNode(state.tree, state.selectedId);
  if (!node || node.id === ROOT_ID) return;
  const parentId = node.parentId;
  removeBranch(state.tree, node.id);
  state.selectedId = parentId;
  treeChanged();
});

els.leaves.addEventListener('change', () => {
  state.leaves = els.leaves.checked;
  saveState();
});
els.labels.addEventListener('change', () => {
  state.labels = els.labels.checked;
  saveState();
});
els.wind.addEventListener('change', () => {
  state.wind = els.wind.checked;
  saveState();
});

els.outlineExport.addEventListener('click', () => {
  els.outline.value = toOutline(state.tree);
  els.outlineError.hidden = true;
});

els.outlineApply.addEventListener('click', () => {
  try {
    state.tree = parseOutline(els.outline.value);
    state.selectedId = ROOT_ID;
    els.outlineError.hidden = true;
    treeChanged({ regrow: true });
  } catch (err) {
    els.outlineError.textContent = err.message;
    els.outlineError.hidden = false;
  }
});

els.replay.addEventListener('click', () => {
  epoch = Date.now();
});

els.reset.addEventListener('click', () => {
  state.tree = parseOutline(DEMO);
  state.selectedId = ROOT_ID;
  treeChanged({ regrow: true });
});

els.panelToggle.addEventListener('click', () => {
  const collapsed = els.panel.classList.toggle('is-collapsed');
  els.panelToggle.setAttribute('aria-expanded', String(!collapsed));
});

// --- события сцены ---

els.canvas.addEventListener('pointermove', (e) => {
  hoverId = renderer.hitTest(e.clientX, e.clientY);
  els.canvas.classList.toggle('is-pointer', Boolean(hoverId));
  if (hoverId && e.pointerType === 'mouse') {
    els.tooltip.textContent = getNode(state.tree, hoverId)?.name ?? '';
    els.tooltip.style.left = `${e.clientX}px`;
    els.tooltip.style.top = `${e.clientY}px`;
    els.tooltip.hidden = false;
  } else {
    els.tooltip.hidden = true;
  }
});

els.canvas.addEventListener('pointerleave', () => {
  hoverId = null;
  els.tooltip.hidden = true;
});

els.canvas.addEventListener('click', (e) => {
  const id = renderer.hitTest(e.clientX, e.clientY);
  if (id) select(id);
});

// --- кадр ---

function treeArea() {
  const w = window.innerWidth;
  const desktop = window.matchMedia('(min-width: 721px)').matches;
  const panelW = desktop ? els.panel.offsetWidth + 32 : 0;
  return { left: 0, right: w - panelW };
}

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
}

function frame() {
  const now = Date.now();
  leafAmount += ((state.leaves ? 1 : 0) - leafAmount) * 0.045;
  windAmount += ((state.wind ? 1 : 0) - windAmount) * 0.03;
  const scene = pose(plan, { now, epoch, wind: windAmount, leafAmount });
  const labels = new Map(state.tree.nodes.map((n) => [n.id, n.name]));
  renderer.draw(scene, {
    area: treeArea(),
    selectedId: state.selectedId,
    hoverId,
    showLabels: state.labels,
    labels,
    leafAmount,
  });
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
els.leaves.checked = state.leaves;
els.labels.checked = state.labels;
els.wind.checked = state.wind;
els.outline.value = toOutline(state.tree);
if (window.matchMedia('(max-width: 720px)').matches) {
  els.panel.classList.add('is-collapsed');
  els.panelToggle.setAttribute('aria-expanded', 'false');
}
resize();
renderPanel();
requestAnimationFrame(frame);
