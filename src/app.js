import { ROOT_ID, deserialize as deserializeTree } from './model.js';
import {
  addParent,
  addPerson,
  addUnion,
  canAddParent,
  checks,
  childrenOf,
  deserialize,
  editAsSeen,
  fromTree,
  getPerson,
  getUnion,
  isUnionId,
  mainRoot,
  parseFamily,
  personIdFromTree,
  removePerson,
  removeUnion,
  renamePerson,
  roots,
  serialize,
  formatDate,
  parentOptions,
  setBorn,
  setDied,
  setParent,
  setPhoto,
  setSince,
  toFamilyText,
  toTree,
  unionsOf,
  viewFrom,
} from './family/model.js';
import { buildPlan, carryOver, pose } from './layout.js';
import { createRenderer } from './render.js';
import { createFlatView } from './flat/view.js';
import { createEditor } from './editor/view.js';
import { cachedPhoto, deletePhoto, loadPhoto, photoBlob, portraitFrom, prunePhotos, putPhoto, savePhoto } from './family/photos.js';
import { makeBundle, readBundle } from './family/bundle.js';
import { logIn, logOut, publish, publishedFamily, whoAmI } from './api.js';

const STORAGE_KEY = 'memento-family:v1';
const LEGACY_KEY = 'memento-tree:v1';

const DEMO = `Николай 1926–1998
  + Анна 1929–2011 (1950)
    Пётр 1952
      + @Мария 1955 (1976)
        Ирина 1977
        Андрей 1981
      + Ольга 1960 (1989)
        Дмитрий 1990
    Елена 1956
      + Виктор 1953 (1979)
        Светлана 1980
Сергей 1925–1987
  + Валентина 1930–? (1952)
    Мария 1955
    Татьяна 1958`;

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $('scene'),
  flat: $('flat'),
  editor: $('editor'),
  autumn: $('autumn-toggle'),
  personDied: $('person-died'),
  personDead: $('person-dead'),
  personWarn: $('person-warn'),
  parentBtn: $('parent-btn'),
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
  personPhoto: $('person-photo'),
  personInitials: $('person-initials'),
  photoInputs: [$('photo-input'), $('photo-input-2')],
  photoRemove: $('photo-remove'),
  fromRow: $('from-row'),
  personFrom: $('person-from'),
  selError: $('sel-error'),
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
  viewer: $('viewer'),
  viewerBtn: $('viewer-btn'),
  adminBox: $('admin-box'),
  syncNote: $('sync-note'),
  loginForm: $('login-form'),
  loginName: $('login-name'),
  loginPassword: $('login-password'),
  adminTools: $('admin-tools'),
  adminName: $('admin-name'),
  publishBtn: $('publish-btn'),
  pullBtn: $('pull-btn'),
  exportBtn: $('export-btn'),
  importInput: $('import-input'),
  logoutBtn: $('logout-btn'),
  adminStatus: $('admin-status'),
  adminError: $('admin-error'),
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
// Семья глазами того, кто смотрит (state.viewer): её показывают все виды.
// Хранится state.fam как записано, правки идут через edit().
let shown = viewFrom(state.fam, state.viewer);
let revision = 0; // растёт с каждой правкой: правки во время публикации не теряются
let plan = buildPlan(toTree(shown));
let livingLabels = labelsOf();
let epoch = Date.now();
let hoverId = null;
let leafAmount = state.leaves ? 1 : 0;
let windAmount = state.wind ? 1 : 0;
const renderer = createRenderer(els.canvas);
const photoOf = (person) => cachedPhoto(person.photo);
const flat = createFlatView(els.flat, { onSelect: select, photoOf });
const editor = createEditor(els.editor, { act: edit, onSelect: select, onPhoto: uploadPhoto, photoOf });

// Фото: сжать до портрета, положить в хранилище, старое удалить.
async function uploadPhoto(id, file) {
  try {
    const photoId = await savePhoto(await portraitFrom(file));
    const old = getPerson(state.fam, id)?.photo;
    setPhoto(state.fam, id, photoId);
    familyChanged();
    if (old) deletePhoto(old).catch(() => {});
    showError('');
  } catch (err) {
    showError(`Фото не загрузилось: ${err.message}`);
  }
}

function removePhoto(id) {
  const old = getPerson(state.fam, id)?.photo;
  setPhoto(state.fam, id, null);
  familyChanged();
  if (old) deletePhoto(old).catch(() => {});
}

// Портреты грузятся из хранилища после старта; лишние (удалённых людей) — стираем.
async function loadPhotos({ prune = false } = {}) {
  const ids = new Set(state.fam.people.map((p) => p.photo).filter(Boolean));
  try {
    await Promise.all([...ids].map(loadPhoto));
    if (prune) await prunePhotos(ids);
  } catch {
    // Хранилище фото недоступно — дерево работает без портретов.
  }
  if (ids.size) familyChanged({ touched: false });
}

function showError(message) {
  els.selError.textContent = message;
  els.selError.hidden = !message;
}

// Правка семьи так, как её видит смотрящий, и показ результата во всех видах.
function edit(change) {
  const result = editAsSeen(state.fam, state.viewer, change);
  familyChanged();
  return result;
}

function labelsOf() {
  return new Map(toTree(shown).nodes.map((n) => [n.id, n.name]));
}

function exists(id) {
  return Boolean(id && (isUnionId(id) ? getUnion(state.fam, id) : getPerson(state.fam, id)));
}

function loadState() {
  // source — savedAt опубликованной версии, от которой идёт семья в этом
  // браузере; dirty — с тех пор её правили здесь.
  const settings = { leaves: true, labels: false, wind: true, view: 'living', nodes: true, autumn: true, viewer: null, source: null, dirty: false };
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
      view: ['flat', 'editor'].includes(data.view) ? data.view : 'living',
      nodes: data.nodes !== false,
      autumn: data.autumn !== false,
      viewer: getPerson(fam, data.viewer) ? data.viewer : null,
      source: typeof data.source === 'string' ? data.source : null,
      dirty: Boolean(data.dirty),
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
        autumn: state.autumn,
        viewer: state.viewer,
        source: state.source,
        dirty: state.dirty,
      }),
    );
  } catch {
    // Хранилище недоступно (приватный режим) — семья живёт до перезагрузки.
  }
}

// regrow — семья задана заново и вырастает с нуля; иначе старые ветки
// плавно подстраиваются под новые, а добавленные прорастают.
// touched — семью правили здесь (а не просто перерисовали или взяли с сервера).
function familyChanged({ regrow = false, touched = true } = {}) {
  if (touched) {
    state.dirty = true;
    revision += 1;
  }
  if (!getPerson(state.fam, state.viewer)) state.viewer = null;
  shown = viewFrom(state.fam, state.viewer);
  const tree = toTree(shown);
  if (regrow) {
    epoch = Date.now();
    plan = buildPlan(tree);
  } else {
    plan = carryOver(plan, buildPlan(tree), Date.now());
  }
  livingLabels = labelsOf();
  if (!exists(state.selectedId)) state.selectedId = mainRoot(shown)?.id ?? null;
  flat.setFamily(shown, { regrow });
  editor.render(shown, state.selectedId);
  saveState();
  renderPanel();
}

// Кто смотрит: его дерево становится главным, и семья вырастает заново.
function setViewer(id) {
  state.viewer = getPerson(state.fam, id) ? id : null;
  familyChanged({ regrow: true, touched: false });
}

// «Кто смотрит» в другой семье — тот же человек по имени и году, иначе никто.
function viewerIn(fam) {
  const viewer = getPerson(state.fam, state.viewer);
  return (viewer && fam.people.find((p) => p.name === viewer.name && p.born === viewer.born)?.id) ?? null;
}

// Новая семья целиком: из текста, файла, примера или с сервера.
function replaceFamily(fam, { touched = true } = {}) {
  state.viewer = viewerIn(fam);
  state.fam = fam;
  state.selectedId = mainRoot(viewFrom(fam, state.viewer))?.id ?? roots(fam)[0].id;
  familyChanged({ regrow: true, touched });
  loadPhotos({ prune: true });
}

function select(id) {
  if (!exists(id)) return;
  state.selectedId = id;
  saveState();
  renderPanel();
}

// В живом дереве нет пар: выбранная пара подсвечивает своего host.
function livingSelected() {
  const id = isUnionId(state.selectedId) ? getUnion(shown, state.selectedId)?.host : state.selectedId;
  return id === mainRoot(shown)?.id ? ROOT_ID : id;
}

const dateValue = (input) => input.value.trim();
const yearText = (year) => (year === null ? '' : ` · ${year}`);

function renderPanel() {
  const fam = shown;
  const union = isUnionId(state.selectedId) ? getUnion(fam, state.selectedId) : null;
  const person = union ? null : getPerson(fam, state.selectedId);
  flat.setSelected(state.selectedId);
  editor.setSelected(state.selectedId);
  const warnings = checks(fam).get(state.selectedId);
  els.personWarn.hidden = !warnings;
  els.personWarn.textContent = warnings ? warnings.join('. ') : '';

  els.selTitle.textContent = union ? 'Выбрана пара' : 'Выбран человек';
  els.personForm.hidden = !person;
  els.unionBox.hidden = !union;
  els.pairBox.hidden = !person;
  if (person) {
    els.personName.value = person.name;
    els.personBorn.value = formatDate(person.born, person.bornDate);
    els.personDied.value = formatDate(person.died, person.diedDate);
    const url = photoOf(person);
    els.personPhoto.hidden = !url;
    if (url) els.personPhoto.src = url;
    els.personInitials.textContent = url ? '' : person.name.slice(0, 1).toUpperCase();
    els.photoRemove.hidden = !person.photo;
    renderFrom(person);
    els.personDead.checked = person.dead;
    els.parentBtn.hidden = !canAddParent(fam, person.id);
    els.childName.placeholder = `Ребёнок: ${person.name}`;
    els.childHint.textContent = unionsOf(fam, person.id).length
      ? 'Это ребёнок без пары. Ребёнка пары добавляйте, выбрав значок пары.'
      : '';
    els.remove.textContent = 'Удалить человека';
    els.remove.disabled = fam.people.length === 1;
    els.remove.title = els.remove.disabled ? 'Последнего человека удалить нельзя' : 'Вместе с потомками на его ветке';
    renderPartners(person);
    els.viewerBtn.hidden = state.viewer === person.id;
  } else if (union) {
    els.viewerBtn.hidden = true;
    const host = getPerson(fam, union.host);
    const partner = getPerson(fam, union.partner);
    els.unionNames.textContent = `${host.name} + ${partner.name}`;
    els.unionSince.value = formatDate(union.since, union.sinceDate);
    els.childName.placeholder = `Ребёнок: ${host.name} и ${partner.name}`;
    els.childHint.textContent = '';
    els.remove.textContent = 'Разорвать пару';
    els.parentBtn.hidden = true;
    els.remove.disabled = false;
    els.remove.title = 'Дети пары останутся у ' + host.name;
  }
  const people = fam.people.length;
  els.stats.textContent = `${people} ${plural(people, 'человек', 'человека', 'человек')}, ${fam.unions.length} ${plural(fam.unions.length, 'пара', 'пары', 'пар')}`;

  const main = mainRoot(fam);
  const trees = main ? [main, ...roots(fam).filter((r) => r !== main)] : [];
  els.list.replaceChildren(...trees.map((root) => personItem(root.id)));
  els.list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  renderViewer();
  renderAdmin();
}

function renderViewer() {
  const people = [...state.fam.people].sort((a, b) => a.name.localeCompare(b.name, 'ru') || (a.born ?? 0) - (b.born ?? 0));
  els.viewer.replaceChildren(
    new Option('Никто — как записано', ''),
    ...people.map((p) => new Option(`${p.name}${yearText(p.born)}`, p.id)),
  );
  els.viewer.value = state.viewer ?? '';
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

function renderFrom(person) {
  const options = parentOptions(shown, person.id);
  els.fromRow.hidden = options.length < 2;
  if (els.fromRow.hidden) return;
  els.personFrom.replaceChildren(
    ...options.map((id) => {
      if (!isUnionId(id)) return new Option(getPerson(shown, id).name, id);
      const union = getUnion(shown, id);
      const since = union.since === null ? '' : ` (${formatDate(union.since, union.sinceDate)})`;
      return new Option(`${getPerson(shown, union.host).name} + ${getPerson(shown, union.partner).name}${since}`, id);
    }),
  );
  els.personFrom.value = person.parent;
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
  const fam = shown;
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
  // Сначала проверяем обе даты, чтобы не сохранить половину правки.
  try {
    const probe = structuredClone(state.fam);
    setBorn(probe, state.selectedId, dateValue(els.personBorn));
    setDied(probe, state.selectedId, { dead: els.personDead.checked, died: dateValue(els.personDied) });
  } catch (err) {
    showError(err.message);
    return;
  }
  renamePerson(state.fam, state.selectedId, els.personName.value);
  setBorn(state.fam, state.selectedId, dateValue(els.personBorn));
  setDied(state.fam, state.selectedId, { dead: els.personDead.checked, died: dateValue(els.personDied) });
  showError('');
  familyChanged();
});

els.unionForm.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    setSince(state.fam, state.selectedId, dateValue(els.unionSince));
  } catch (err) {
    showError(err.message);
    return;
  }
  showError('');
  familyChanged();
});

els.childForm.addEventListener('submit', (e) => {
  e.preventDefault();
  let child;
  try {
    const parent = state.selectedId;
    child = edit((f) => addPerson(f, { name: els.childName.value, born: dateValue(els.childBorn), parent, added: Date.now() }).id);
  } catch (err) {
    showError(err.message);
    return;
  }
  showError('');
  els.childName.value = '';
  els.childBorn.value = '';
  select(child);
});

els.pairPartner.addEventListener('change', () => {
  els.pairNew.hidden = els.pairPartner.value !== '';
});

els.pairForm.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    const host = state.selectedId;
    const union = edit((f) => {
      const partnerId = els.pairPartner.value || addPerson(f, { name: els.pairName.value, born: dateValue(els.pairBorn), added: Date.now() }).id;
      return addUnion(f, host, partnerId, dateValue(els.pairSince)).id;
    });
    els.pairName.value = '';
    els.pairBorn.value = '';
    els.pairSince.value = '';
    els.pairError.hidden = true;
    els.pairBox.open = false;
    select(union);
  } catch (err) {
    els.pairError.textContent = err.message;
    els.pairError.hidden = false;
  }
});

els.remove.addEventListener('click', () => {
  const id = state.selectedId;
  if (isUnionId(id)) {
    state.selectedId = getUnion(shown, id)?.host;
    edit((f) => removeUnion(f, id));
  } else {
    if (state.fam.people.length === 1) return;
    state.selectedId = getPerson(state.fam, id)?.parent;
    edit((f) => removePerson(f, id));
  }
});

els.viewerBtn.addEventListener('click', () => setViewer(state.selectedId));
els.viewer.addEventListener('change', () => setViewer(els.viewer.value || null));

els.parentBtn.addEventListener('click', () => {
  const child = state.selectedId;
  select(edit((f) => addParent(f, child, { added: Date.now() }).parent.id));
  els.personName.focus();
  els.personName.select();
});

for (const input of els.photoInputs) {
  input.addEventListener('change', () => {
    const [file] = input.files;
    input.value = '';
    if (file && !isUnionId(state.selectedId)) uploadPhoto(state.selectedId, file);
  });
}
els.photoRemove.addEventListener('click', () => removePhoto(state.selectedId));
els.personFrom.addEventListener('change', () => {
  try {
    const child = state.selectedId;
    edit((f) => setParent(f, child, els.personFrom.value));
  } catch (err) {
    showError(err.message);
  }
});

els.treeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  let person;
  try {
    person = addPerson(state.fam, { name: els.treeName.value, born: dateValue(els.treeBorn), added: Date.now() });
  } catch (err) {
    showError(err.message);
    return;
  }
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
els.autumn.addEventListener('change', () => {
  state.autumn = els.autumn.checked;
  flat.setAutumn(state.autumn);
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
    const fam = parseFamily(els.outline.value, Date.now());
    // Фото и «кто смотрит» в тексте не пишутся: узнаём людей по имени и году.
    for (const person of fam.people) {
      const same = state.fam.people.find((p) => p.photo && p.name === person.name && p.born === person.born);
      if (same) person.photo = same.photo;
    }
    els.outlineError.hidden = true;
    replaceFamily(fam);
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
  els.canvas.hidden = state.view !== 'living';
  els.editor.hidden = state.view !== 'editor';
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
  state.viewer = null;
  els.outline.value = DEMO;
  replaceFamily(parseFamily(DEMO, Date.now()));
});

// --- сервер: опубликованная семья и админка ---

let admin = null; // логин вошедшего администратора
let remote = null; // последняя известная опубликованная версия { savedAt, by, family }

const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromBase64 = (b64) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' });
const photoIds = (fam) => new Set(fam.people.map((p) => p.photo).filter(Boolean));
const when = (iso) => new Date(iso).toLocaleString('ru', { dateStyle: 'medium', timeStyle: 'short' });

// Файл семьи с фото; skip — фото, которые получателю присылать не нужно.
async function bundleOf(fam, skip = new Set()) {
  const photos = {};
  for (const id of photoIds(fam)) {
    if (skip.has(id)) continue;
    const blob = await photoBlob(id).catch(() => null);
    if (blob) photos[id] = await toBase64(blob);
  }
  return makeBundle(fam, photos);
}

function adminMessage(text, { error = false } = {}) {
  els.adminStatus.hidden = error || !text;
  els.adminError.hidden = !error || !text;
  (error ? els.adminError : els.adminStatus).textContent = text;
}

function renderAdmin() {
  els.loginForm.hidden = Boolean(admin);
  els.adminTools.hidden = !admin;
  els.adminName.textContent = admin ?? '';
  // Взять опубликованную может каждый: это меняет только этот браузер.
  els.pullBtn.hidden = !remote || (state.source === remote.savedAt && !state.dirty);
  const parts = [remote ? `Опубликовано ${when(remote.savedAt)}${remote.by ? `, ${remote.by}` : ''}.` : 'Семья ещё не опубликована.'];
  if (state.dirty) parts.push(admin ? 'Здесь есть неопубликованные правки.' : 'Ваши правки видны только в этом браузере.');
  if (remote && state.source !== remote.savedAt) parts.push('На сервере версия новее той, что у вас.');
  els.syncNote.textContent = parts.join(' ');
}

function adoptRemote() {
  state.source = remote.savedAt;
  state.dirty = false;
  replaceFamily(deserialize(JSON.stringify(remote.family)), { touched: false });
}

// При открытии: опубликованная семья приходит ко всем. Только у администратора
// с неопубликованными правками она их не затирает — он решает сам.
async function syncFromServer() {
  const [published, me] = await Promise.all([publishedFamily(), whoAmI()]);
  els.adminBox.hidden = me === null; // без сервера админки нет
  admin = me?.admin ?? null;
  remote = published;
  if (remote && remote.savedAt !== state.source && !(admin && state.dirty)) adoptRemote();
  renderAdmin();
}

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    admin = (await logIn(els.loginName.value.trim(), els.loginPassword.value)).admin;
    els.loginPassword.value = '';
    adminMessage('');
  } catch (err) {
    adminMessage(err.message, { error: true });
  }
  renderAdmin();
});

els.logoutBtn.addEventListener('click', async () => {
  await logOut().catch(() => {});
  admin = null;
  adminMessage('');
  renderAdmin();
});

els.publishBtn.addEventListener('click', async () => {
  els.publishBtn.disabled = true;
  try {
    // Фото, уже лежащие на сервере (у них тот же id), второй раз не шлём.
    const onServer = remote ? photoIds(remote.family) : new Set();
    const sent = revision;
    const bundle = await bundleOf(state.fam, onServer);
    const { savedAt } = await publish(bundle, remote ? state.source : null);
    remote = { savedAt, by: admin, family: bundle.family };
    state.source = savedAt;
    state.dirty = revision !== sent; // правили, пока шла публикация
    saveState();
    adminMessage('Опубликовано. Родственники увидят семью, когда откроют или обновят страницу.');
  } catch (err) {
    if (err.status === 401) admin = null;
    const hint = err.status === 409 ? ' Скачайте файл, чтобы не потерять свои правки, и нажмите «Взять опубликованную».' : '';
    if (err.status === 409) remote = (await publishedFamily()) ?? remote;
    adminMessage(`Не опубликовано: ${err.message}.${hint}`, { error: true });
  }
  els.publishBtn.disabled = false;
  renderAdmin();
});

els.pullBtn.addEventListener('click', async () => {
  remote = (await publishedFamily()) ?? remote;
  if (!remote) return;
  if (state.dirty && !confirm('Заменить семью в этом браузере опубликованной? Неопубликованные правки пропадут.')) return;
  adoptRemote();
  adminMessage('Взята опубликованная семья.');
  renderAdmin();
});

els.exportBtn.addEventListener('click', async () => {
  const bundle = await bundleOf(state.fam);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
  link.download = `memento-family-${bundle.savedAt.slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  adminMessage(`Файл скачан: ${state.fam.people.length} ${plural(state.fam.people.length, 'человек', 'человека', 'человек')}, фото — ${Object.keys(bundle.photos).length}.`);
});

els.importInput.addEventListener('change', async () => {
  const [file] = els.importInput.files;
  els.importInput.value = '';
  if (!file) return;
  try {
    const { fam, photos } = readBundle(await file.text());
    if (!confirm(`Заменить семью в этом браузере семьёй из файла (${fam.people.length} чел.)?`)) return;
    for (const [id, b64] of Object.entries(photos)) await putPhoto(id, fromBase64(b64));
    replaceFamily(fam);
    els.outline.value = toFamilyText(fam);
    adminMessage('Файл загружен. Его видите только вы — чтобы увидели все, нажмите «Опубликовать для всех».');
  } catch (err) {
    adminMessage(`Файл не загружен: ${err.message}`, { error: true });
  }
  renderAdmin();
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
    const person = getPerson(shown, personIdFromTree(shown, hoverId));
    const url = person && photoOf(person);
    const img = document.createElement('img');
    if (url) img.src = url;
    els.tooltip.replaceChildren(...(url ? [img] : []), person?.name ?? '');
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
  if (id) select(personIdFromTree(shown, id));
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
  if (state.view === 'editor') return;
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
els.autumn.checked = state.autumn;
els.outline.value = toFamilyText(state.fam);
if (window.matchMedia('(max-width: 720px)').matches) {
  els.panel.classList.add('is-collapsed');
  els.panelToggle.setAttribute('aria-expanded', 'false');
}
flat.setFamily(shown, { regrow: true });
flat.setLeaves(state.leaves);
flat.setNodes(state.nodes);
flat.setAutumn(state.autumn);
editor.render(shown, state.selectedId);
applyView();
resize();
renderPanel();
// Сначала узнаём, что опубликовано, потом чистим фото — иначе чистка сотрёт
// только что взятые с сервера портреты.
syncFromServer().finally(() => loadPhotos({ prune: true }));
requestAnimationFrame(frame);
