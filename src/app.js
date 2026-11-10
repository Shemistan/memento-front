import { ROOT_ID, deserialize as deserializeTree } from './model.js';
import {
  addPerson,
  addUnion,
  childrenOf,
  deserialize,
  fromTree,
  getPerson,
  getUnion,
  isUnionId,
  parseFamily,
  personIdFromTree,
  removePerson,
  removeUnion,
  renamePerson,
  roots,
  serialize,
  setBorn,
  setSince,
  toFamilyText,
  toTree,
  unionsOf,
} from './family/model.js';
import { buildPlan, carryOver, pose } from './layout.js';
import { createRenderer } from './render.js';
import { createFlatView } from './flat/view.js';

const STORAGE_KEY = 'memento-family:v1';
const LEGACY_KEY = 'memento-tree:v1';

const DEMO = `Николай 1926
  + Анна 1929 (1950)
    Пётр 1952
      + @Мария 1955 (1976)
        Ирина 1977
        Андрей 1981
      + Ольга 1960 (1989)
        Дмитрий 1990
    Елена 1956
      + Виктор 1953 (1979)
        Светлана 1980
Сергей 1925
  + Валентина 1930 (1952)
    Мария 1955
    Татьяна 1958`;

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $('scene'),
  flat: $('flat'),
  zoom: $('zoom'),
  zoomIn: $('zoom-in'),
  zoomOut: $('zoom-out'),
  zoomFit: $('zoom-fit'),
  tooltip: $('tooltip'),
  panel: $('panel'),
  panelToggle: $('panel-toggle'),
  leaves: $('leaves-toggle'),
  labels: $('labels-toggle'),
  wind: $('wind-toggle'),
  nodes: $('nodes-toggle'),
  selTitle: $('sel-title'),
  personForm: $('person-form'),
  personName: $('person-name'),
  personBorn: $('person-born'),
  unionBox: $('union-box'),
  unionNames: $('union-names'),
  unionForm: $('union-form'),
  unionSince: $('union-since'),
  childForm: $('child-form'),
  childName: $('child-name'),
  childBorn: $('child-born'),
  childHint: $('child-hint'),
  pairBox: $('pair-box'),
  pairForm: $('pair-form'),
  pairPartner: $('pair-partner'),
  pairNew: $('pair-new'),
  pairName: $('pair-name'),
  pairBorn: $('pair-born'),
  pairSince: $('pair-since'),
  pairError: $('pair-error'),
  remove: $('remove-btn'),
  stats: $('stats'),
  list: $('branch-list'),
  treeForm: $('tree-form'),
  treeName: $('tree-name'),
  treeBorn: $('tree-born'),
  outline: $('outline'),
  outlineApply: $('outline-apply'),
  outlineExport: $('outline-export'),
  outlineError: $('outline-error'),
  replay: $('replay-btn'),
  reset: $('reset-btn'),
};

const state = loadState();
let plan = buildPlan(toTree(state.fam));
let livingLabels = labelsOf();
let epoch = Date.now();
let hoverId = null;
let leafAmount = state.leaves ? 1 : 0;
let windAmount = state.wind ? 1 : 0;
const renderer = createRenderer(els.canvas);
const flat = createFlatView(els.flat, { onSelect: select });

function labelsOf() {
  return new Map(toTree(state.fam).nodes.map((n) => [n.id, n.name]));
}

function exists(id) {
  return Boolean(id && (isUnionId(id) ? getUnion(state.fam, id) : getPerson(state.fam, id)));
}

function loadState() {
  const settings = { leaves: true, labels: false, wind: true, view: 'living', nodes: true };
  const demo = () => {
    const fam = parseFamily(DEMO);
    return { ...settings, fam, selectedId: roots(fam)[0].id };
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (!legacy) return demo();
      const fam = fromTree(deserializeTree(JSON.stringify(JSON.parse(legacy).tree)));
      return { ...settings, fam, selectedId: roots(fam)[0].id };
    }
    const data = JSON.parse(raw);
    const fam = deserialize(JSON.stringify(data.fam));
    if (!fam.people.length) return demo();
    const selected = isUnionId(data.selectedId) ? getUnion(fam, data.selectedId) : getPerson(fam, data.selectedId);
    return {
      fam,
      selectedId: selected ? data.selectedId : roots(fam)[0].id,
      leaves: data.leaves !== false,
      labels: Boolean(data.labels),
      wind: data.wind !== false,
      view: data.view === 'flat' ? 'flat' : 'living',
      nodes: data.nodes !== false,
    };
  } catch {
    return demo();
  }
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        fam: JSON.parse(serialize(state.fam)),
        selectedId: state.selectedId,
        leaves: state.leaves,
        labels: state.labels,
        wind: state.wind,
        view: state.view,
        nodes: state.nodes,
      }),
    );
  } catch {
    // Хранилище недоступно (приватный режим) — семья живёт до перезагрузки.
  }
}

// regrow — семья задана заново и вырастает с нуля; иначе старые ветки
// плавно подстраиваются под новые, а добавленные прорастают.
function familyChanged({ regrow = false } = {}) {
  const tree = toTree(state.fam);
  if (regrow) {
    epoch = Date.now();
    plan = buildPlan(tree);
  } else {
    plan = carryOver(plan, buildPlan(tree), Date.now());
  }
  livingLabels = labelsOf();
  if (!exists(state.selectedId)) state.selectedId = roots(state.fam)[0]?.id ?? null;
  flat.setFamily(state.fam, { regrow });
  saveState();
  renderPanel();
}

function select(id) {
  if (!exists(id)) return;
  state.selectedId = id;
  saveState();
  renderPanel();
}

// В живом дереве нет пар: выбранная пара подсвечивает своего host.
function livingSelected() {
  const id = isUnionId(state.selectedId) ? getUnion(state.fam, state.selectedId)?.host : state.selectedId;
  return id === roots(state.fam)[0]?.id ? ROOT_ID : id;
}

const yearValue = (input) => (input.value.trim() === '' ? null : Number(input.value));
const yearText = (year) => (year === null ? '' : ` · ${year}`);

function renderPanel() {
  const fam = state.fam;
  const union = isUnionId(state.selectedId) ? getUnion(fam, state.selectedId) : null;
  const person = union ? null : getPerson(fam, state.selectedId);
  flat.setSelected(state.selectedId);

  els.selTitle.textContent = union ? 'Выбрана пара' : 'Выбран человек';
  els.personForm.hidden = !person;
  els.unionBox.hidden = !union;
  els.pairBox.hidden = !person;
  if (person) {
    els.personName.value = person.name;
    els.personBorn.value = person.born ?? '';
    els.childName.placeholder = `Ребёнок: ${person.name}`;
    els.childHint.textContent = unionsOf(fam, person.id).length
      ? 'Это ребёнок без пары. Ребёнка пары добавляйте, выбрав значок пары.'
      : '';
    els.remove.textContent = 'Удалить человека';
    els.remove.disabled = fam.people.length === 1;
    els.remove.title = els.remove.disabled ? 'Последнего человека удалить нельзя' : 'Вместе с потомками на его ветке';
    renderPartners(person);
  } else if (union) {
    const host = getPerson(fam, union.host);
    const partner = getPerson(fam, union.partner);
    els.unionNames.textContent = `${host.name} + ${partner.name}`;
    els.unionSince.value = union.since ?? '';
    els.childName.placeholder = `Ребёнок: ${host.name} и ${partner.name}`;
    els.childHint.textContent = '';
    els.remove.textContent = 'Разорвать пару';
    els.remove.disabled = false;
    els.remove.title = 'Дети пары останутся у ' + host.name;
  }
  const people = fam.people.length;
  els.stats.textContent = `${people} ${plural(people, 'человек', 'человека', 'человек')}, ${fam.unions.length} ${plural(fam.unions.length, 'пара', 'пары', 'пар')}`;

  els.list.replaceChildren(...roots(fam).map((root) => personItem(root.id)));
  els.list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
}

// Супругом может стать новый человек (саженец со своим деревом) или любой
// уже существующий, кроме самого человека и тех, с кем пара уже есть.
function renderPartners(person) {
  const taken = new Set(
    state.fam.unions.flatMap((u) => (u.host === person.id ? [u.partner] : u.partner === person.id ? [u.host] : [])),
  );
  const current = els.pairPartner.value;
  const options = [new Option('Новый человек', '')];
  for (const p of state.fam.people) {
    if (p.id !== person.id && !taken.has(p.id)) options.push(new Option(`${p.name}${yearText(p.born)}`, p.id));
  }
  els.pairPartner.replaceChildren(...options);
  els.pairPartner.value = options.some((o) => o.value === current) ? current : '';
  els.pairNew.hidden = els.pairPartner.value !== '';
}

function listButton(id, text, extra = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.dataset.id = id;
  btn.className = extra;
  btn.setAttribute('aria-current', String(id === state.selectedId));
  return btn;
}

function personItem(id) {
  const fam = state.fam;
  const person = getPerson(fam, id);
  const li = document.createElement('li');
  li.append(listButton(id, `${person.name}${yearText(person.born)}`));
  const ul = document.createElement('ul');
  for (const child of childrenOf(fam, id)) ul.append(personItem(child.id));
  for (const union of unionsOf(fam, id)) {
    const partner = getPerson(fam, union.partner);
    const uli = document.createElement('li');
    const since = union.since === null ? '' : ` (${union.since})`;
    uli.append(listButton(union.id, `⚭ ${partner.name}${since}`, 'is-union'));
    const kids = childrenOf(fam, union.id);
    if (kids.length) {
      const kul = document.createElement('ul');
      for (const kid of kids) kul.append(personItem(kid.id));
      uli.append(kul);
    }
    ul.append(uli);
  }
  if (ul.children.length) li.append(ul);
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

els.personForm.addEventListener('submit', (e) => {
  e.preventDefault();
  renamePerson(state.fam, state.selectedId, els.personName.value);
  setBorn(state.fam, state.selectedId, yearValue(els.personBorn));
  familyChanged();
});

els.unionForm.addEventListener('submit', (e) => {
  e.preventDefault();
  setSince(state.fam, state.selectedId, yearValue(els.unionSince));
  familyChanged();
});

els.childForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const child = addPerson(state.fam, {
    name: els.childName.value,
    born: yearValue(els.childBorn),
    parent: state.selectedId,
    added: Date.now(),
  });
  els.childName.value = '';
  els.childBorn.value = '';
  state.selectedId = child.id;
  familyChanged();
});

els.pairPartner.addEventListener('change', () => {
  els.pairNew.hidden = els.pairPartner.value !== '';
});

els.pairForm.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    const partnerId =
      els.pairPartner.value ||
      addPerson(state.fam, { name: els.pairName.value, born: yearValue(els.pairBorn), added: Date.now() }).id;
    const union = addUnion(state.fam, state.selectedId, partnerId, yearValue(els.pairSince));
    els.pairName.value = '';
    els.pairBorn.value = '';
    els.pairSince.value = '';
    els.pairError.hidden = true;
    els.pairBox.open = false;
    state.selectedId = union.id;
    familyChanged();
  } catch (err) {
    els.pairError.textContent = err.message;
    els.pairError.hidden = false;
  }
});

els.remove.addEventListener('click', () => {
  const id = state.selectedId;
  if (isUnionId(id)) {
    const host = getUnion(state.fam, id)?.host;
    removeUnion(state.fam, id);
    state.selectedId = host;
  } else {
    if (state.fam.people.length === 1) return;
    const parent = getPerson(state.fam, id)?.parent;
    removePerson(state.fam, id);
    state.selectedId = parent;
  }
  familyChanged();
});

els.treeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const person = addPerson(state.fam, { name: els.treeName.value, born: yearValue(els.treeBorn), added: Date.now() });
  els.treeName.value = '';
  els.treeBorn.value = '';
  state.selectedId = person.id;
  familyChanged();
});

els.leaves.addEventListener('change', () => {
  state.leaves = els.leaves.checked;
  flat.setLeaves(state.leaves);
  saveState();
});
els.labels.addEventListener('change', () => {
  state.labels = els.labels.checked;
  saveState();
});
els.nodes.addEventListener('change', () => {
  state.nodes = els.nodes.checked;
  flat.setNodes(state.nodes);
  saveState();
});
els.wind.addEventListener('change', () => {
  state.wind = els.wind.checked;
  saveState();
});

els.outlineExport.addEventListener('click', () => {
  els.outline.value = toFamilyText(state.fam);
  els.outlineError.hidden = true;
});

els.outlineApply.addEventListener('click', () => {
  try {
    state.fam = parseFamily(els.outline.value, Date.now());
    state.selectedId = roots(state.fam)[0].id;
    els.outlineError.hidden = true;
    familyChanged({ regrow: true });
  } catch (err) {
    els.outlineError.textContent = err.message;
    els.outlineError.hidden = false;
  }
});

els.replay.addEventListener('click', () => {
  if (state.view === 'flat') flat.replay();
  else epoch = Date.now();
});

function applyView() {
  const isFlat = state.view === 'flat';
  document.body.dataset.view = state.view;
  els.canvas.hidden = isFlat;
  els.flat.toggleAttribute('hidden', !isFlat); // у SVG нет свойства hidden
  els.zoom.hidden = !isFlat;
  els.tooltip.hidden = true;
  hoverId = null;
  for (const radio of document.querySelectorAll('input[name="view"]')) radio.checked = radio.value === state.view;
  if (isFlat) flat.wake();
}

for (const radio of document.querySelectorAll('input[name="view"]')) {
  radio.addEventListener('change', () => {
    state.view = radio.value;
    saveState();
    applyView();
  });
}

els.zoomIn.addEventListener('click', () => flat.zoom(1.25));
els.zoomOut.addEventListener('click', () => flat.zoom(0.8));
els.zoomFit.addEventListener('click', () => flat.fit());

els.reset.addEventListener('click', () => {
  state.fam = parseFamily(DEMO, Date.now());
  state.selectedId = roots(state.fam)[0].id;
  els.outline.value = DEMO;
  familyChanged({ regrow: true });
});

els.panelToggle.addEventListener('click', () => {
  const collapsed = els.panel.classList.toggle('is-collapsed');
  els.panelToggle.setAttribute('aria-expanded', String(!collapsed));
});

// --- события живой сцены ---

els.canvas.addEventListener('pointermove', (e) => {
  hoverId = renderer.hitTest(e.clientX, e.clientY);
  els.canvas.classList.toggle('is-pointer', Boolean(hoverId));
  if (hoverId && e.pointerType === 'mouse') {
    els.tooltip.textContent = getPerson(state.fam, personIdFromTree(state.fam, hoverId))?.name ?? '';
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
  if (id) select(personIdFromTree(state.fam, id));
});

// --- кадр ---

function treeArea() {
  const w = window.innerWidth;
  const desktop = window.matchMedia('(min-width: 721px)').matches;
  const panelW = desktop ? els.panel.offsetWidth + 32 : 0;
  return { left: 0, right: w - panelW, height: window.innerHeight };
}

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
}

function frame() {
  requestAnimationFrame(frame);
  if (state.view === 'flat') {
    flat.frame(treeArea());
    return;
  }
  const now = Date.now();
  leafAmount += ((state.leaves ? 1 : 0) - leafAmount) * 0.045;
  windAmount += ((state.wind ? 1 : 0) - windAmount) * 0.03;
  const scene = pose(plan, { now, epoch, wind: windAmount, leafAmount });
  renderer.draw(scene, {
    area: treeArea(),
    selectedId: livingSelected(),
    hoverId,
    showLabels: state.labels,
    labels: livingLabels,
    leafAmount,
  });
}

window.addEventListener('resize', resize);
els.leaves.checked = state.leaves;
els.labels.checked = state.labels;
els.wind.checked = state.wind;
els.nodes.checked = state.nodes;
els.outline.value = toFamilyText(state.fam);
if (window.matchMedia('(max-width: 720px)').matches) {
  els.panel.classList.add('is-collapsed');
  els.panelToggle.setAttribute('aria-expanded', 'false');
}
flat.setFamily(state.fam, { regrow: true });
flat.setLeaves(state.leaves);
flat.setNodes(state.nodes);
applyView();
resize();
renderPanel();
requestAnimationFrame(frame);
