// Редактор: семья блок-схемой. Предки сверху, потомки снизу, карточки людей
// правятся прямо на месте, рядом с карточкой — добавить родителя, ребёнка,
// пару. Все правки идут в общую модель через act(), их сразу видно в деревьях.
import {
  addParent,
  addPerson,
  addUnion,
  canAddParent,
  checks,
  getPerson,
  getUnion,
  isOutsidePartner,
  isUnionId,
  removePerson,
  removeUnion,
  renamePerson,
  setBorn,
  formatDate,
  parentOptions,
  setDied,
  setParent,
  setSince,
  unionsOf,
} from '../family/model.js';
import { familyLayout } from '../flat/family-layout.js';
import { vineColor } from '../flat/view.js';

export const CARD_W = 264;
export const CARD_H = 108;
const UNION_W = 184;
const UNION_H = 32;
const ROWS = 84; // ярус: человек → пара → дети
const BESIDE_GAP = 20; // между человеком и его супругом «со стороны»
const PAD = 48;
const NS = 'http://www.w3.org/2000/svg';


function html(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

const DATE_HINT = 'Год или дд.мм.гггг';

function personCard(id) {
  return html('article', { class: 'ecard', 'data-id': id }, [
    html('button', { type: 'button', class: 'ecard__up', 'data-act': 'parent', title: 'Добавить родителя', 'aria-label': 'Добавить родителя', text: '+' }),
    // Чей ребёнок: одного родителя или пары. Видно, когда есть выбор.
    html('select', { class: 'ecard__from', 'data-field': 'parent', title: 'Чей ребёнок', 'aria-label': 'Чей ребёнок', hidden: '' }),
    html('label', { class: 'ecard__photo', title: 'Фото: нажмите или перетащите картинку на карточку' }, [
      html('img', { alt: '', hidden: '' }),
      html('span', { class: 'ecard__initials', 'aria-hidden': 'true' }),
      html('input', { type: 'file', accept: 'image/*', 'data-photo': '', 'aria-label': 'Загрузить фото' }),
    ]),
    html('input', { class: 'ecard__name', 'data-field': 'name', maxlength: '60', 'aria-label': 'Имя' }),
    html('div', { class: 'ecard__life' }, [
      html('input', { 'data-field': 'born', inputmode: 'numeric', placeholder: 'рождение', title: DATE_HINT, 'aria-label': 'Дата рождения' }),
      html('span', { class: 'ecard__dash', text: '–' }),
      html('input', { 'data-field': 'died', inputmode: 'numeric', placeholder: 'смерть', title: DATE_HINT, 'aria-label': 'Дата смерти' }),
      html('label', { class: 'ecard__dead', title: 'Нет в живых (дата может быть неизвестна)' }, [
        html('input', { type: 'checkbox', 'data-field': 'dead' }),
        html('span', { text: '†' }),
      ]),
    ]),
    html('div', { class: 'ecard__actions' }, [
      html('button', { type: 'button', 'data-act': 'pair', title: 'Добавить супруга', text: '⚭ Пара' }),
      html('button', { type: 'button', 'data-act': 'child', title: 'Ребёнок без пары', text: '↓ Ребёнок' }),
      html('button', { type: 'button', class: 'ecard__remove', 'data-act': 'remove', title: 'Удалить', 'aria-label': 'Удалить', text: '✕' }),
    ]),
    html('span', { class: 'ecard__warn', text: '!', hidden: '' }),
  ]);
}

function unionCard(id) {
  return html('div', { class: 'eunion', 'data-id': id }, [
    html('span', { class: 'eunion__rings', 'aria-hidden': 'true', text: '⚭' }),
    html('input', { 'data-field': 'since', inputmode: 'numeric', placeholder: 'дата брака', title: DATE_HINT, 'aria-label': 'Дата брака' }),
    html('button', { type: 'button', 'data-act': 'child', title: 'Ребёнок пары', 'aria-label': 'Ребёнок пары', text: '↓' }),
    html('button', { type: 'button', class: 'ecard__remove', 'data-act': 'remove', title: 'Разорвать пару', 'aria-label': 'Разорвать пару', text: '✕' }),
    html('span', { class: 'ecard__warn', text: '!', hidden: '' }),
  ]);
}

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

// Значение в поле не трогаем, пока человек в нём печатает.
function setValue(input, value) {
  if (document.activeElement === input) return;
  if (input.type === 'checkbox') input.checked = Boolean(value);
  else input.value = value ?? '';
}

// act(change) — применить правку к семье; onPhoto(id, file) — загрузить фото;
// photoOf(person) — адрес загруженного портрета или null.
export function createEditor(root, { act, onSelect, onPhoto, photoOf = () => null }) {
  const world = html('div', { class: 'editor-world' });
  const links = document.createElementNS(NS, 'svg');
  links.setAttribute('class', 'editor-links');
  world.append(links);
  root.append(world);

  const cards = new Map();
  let fam = null;
  let selectedId = null;

  function render(family, selected = selectedId) {
    fam = family;
    selectedId = selected;
    // Супруги «со стороны» стоят в одном ряду со своим супругом, справа от него:
    // раскладка считает их пару одним широким узлом.
    const outside = new Set(fam.people.filter((p) => isOutsidePartner(fam, p)).map((p) => p.id));
    const beside = (person) => unionsOf(fam, person.id).map((u) => u.partner).filter((id) => outside.has(id));
    const layout = familyLayout(fam, {
      rows: ROWS,
      measure: (person) => CARD_W + beside(person).length * (CARD_W + BESIDE_GAP),
      nodeH: CARD_H,
      unionW: UNION_W,
      unionH: UNION_H,
      gap: 28,
      skip: outside,
    });
    const b = layout.bounds;
    const ys = [...layout.nodes.values()].map((n) => n.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // Раскладка растит потомков вверх (y < 0) — в редакторе они идут вниз.
    const boxes = new Map(); // id → { x, y, w, h } — центр и размер карточки
    for (const n of layout.nodes.values()) {
      const y = maxY - n.y + PAD + CARD_H / 2;
      const left = n.x - n.width / 2 - b.minX + PAD;
      if (n.kind === 'union') {
        boxes.set(n.id, { x: left + UNION_W / 2, y, w: UNION_W, h: UNION_H });
        continue;
      }
      boxes.set(n.id, { x: left + CARD_W / 2, y, w: CARD_W, h: CARD_H });
      beside(getPerson(fam, n.id)).forEach((id, i) => {
        boxes.set(id, { x: left + CARD_W / 2 + (i + 1) * (CARD_W + BESIDE_GAP), y, w: CARD_W, h: CARD_H });
      });
    }
    const width = b.maxX - b.minX + PAD * 2;
    const height = maxY - minY + CARD_H + PAD * 2;
    world.style.width = `${width}px`;
    world.style.height = `${height}px`;
    links.setAttribute('width', width);
    links.setAttribute('height', height);

    for (const [id, card] of cards) {
      if (!boxes.has(id)) {
        card.remove();
        cards.delete(id);
      }
    }
    const warnings = checks(fam);
    for (const [id, box] of boxes) {
      const union = isUnionId(id);
      let card = cards.get(id);
      if (!card) {
        card = union ? unionCard(id) : personCard(id);
        cards.set(id, card);
        world.append(card);
      }
      card.style.left = `${box.x - box.w / 2}px`;
      card.style.top = `${box.y - box.h / 2}px`;
      card.classList.toggle('is-selected', id === selectedId);
      if (union) fillUnion(card, getUnion(fam, id));
      else fillPerson(card, getPerson(fam, id));
      const warn = card.querySelector('.ecard__warn');
      const list = warnings.get(id);
      warn.hidden = !list;
      warn.title = list ? list.join('\n') : '';
    }
    drawLinks(boxes);
  }

  function fillPerson(card, person) {
    setValue(card.querySelector('[data-field="name"]'), person.name);
    setValue(card.querySelector('[data-field="born"]'), formatDate(person.born, person.bornDate));
    setValue(card.querySelector('[data-field="died"]'), formatDate(person.died, person.diedDate));
    const url = photoOf(person);
    const img = card.querySelector('.ecard__photo img');
    img.hidden = !url;
    if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
    card.querySelector('.ecard__initials').textContent = url ? '' : initials(person.name);
    fillFrom(card.querySelector('[data-field="parent"]'), person);
    setValue(card.querySelector('[data-field="dead"]'), person.dead);
    card.classList.toggle('is-gone', person.dead);
    const up = card.querySelector('[data-act="parent"]');
    up.hidden = !canAddParent(fam, person.id);
    up.title = person.parent === null ? 'Добавить родителя' : 'Добавить второго родителя';
    card.setAttribute('aria-label', person.name);
  }

  function fillUnion(card, union) {
    card.style.setProperty('--vine', vineColor(fam, union.id));
    setValue(card.querySelector('[data-field="since"]'), formatDate(union.since, union.sinceDate));
    const host = getPerson(fam, union.host);
    const partner = getPerson(fam, union.partner);
    card.title = `${host.name} + ${partner.name}`;
    card.setAttribute('aria-label', `Пара: ${host.name} и ${partner.name}`);
  }

  // Выбор «чей ребёнок»: сам родитель или любая его пара.
  function fillFrom(select, person) {
    const options = parentOptions(fam, person.id);
    select.hidden = options.length < 2;
    if (select.hidden) return;
    const label = (id) => {
      if (!isUnionId(id)) return `от: ${getPerson(fam, id).name}`;
      const union = getUnion(fam, id);
      const since = union.since === null ? '' : ` (${formatDate(union.since, union.sinceDate)})`;
      return `от: ${getPerson(fam, union.host).name} + ${getPerson(fam, union.partner).name}${since}`;
    };
    const signature = options.map(label).join('|');
    if (select.dataset.signature !== signature) {
      select.replaceChildren(...options.map((id) => new Option(label(id), id)));
      select.dataset.signature = signature;
    }
    select.value = person.parent;
  }

  // Связи уступом: человек → его пары (каждая — от самого человека, а не от
  // прошлого брака), пара → дети; супруг → пара — пунктир цвета лианы.
  function drawLinks(boxes) {
    const paths = [];
    const elbow = (a, c, color, dashed = false) => {
      const y1 = a.y + a.h / 2;
      const y2 = c.y - c.h / 2;
      const mid = Math.max(y1 + 8, (y1 + y2) / 2);
      paths.push({ d: `M${a.x} ${y1}V${mid}H${c.x}V${y2}`, color, dashed });
    };
    for (const person of fam.people) {
      const box = boxes.get(person.id);
      if (!box || person.parent === null) continue;
      const parent = boxes.get(person.parent);
      if (parent) elbow(parent, box, isUnionId(person.parent) ? vineColor(fam, person.parent) : null);
    }
    for (const union of fam.unions) {
      const u = boxes.get(union.id);
      const host = boxes.get(union.host);
      const partner = boxes.get(union.partner);
      if (!u || !host || !partner) continue;
      const color = vineColor(fam, union.id);
      elbow(host, u, color);
      if (partner.y === host.y) elbow(partner, u, color, true);
      else {
        // Супруг из другого дерева — дугой сбоку к значку пары.
        const side = partner.x < u.x ? -1 : 1;
        const x2 = u.x + (side * u.w) / 2;
        const y1 = partner.y + partner.h / 2;
        paths.push({ d: `M${partner.x} ${y1}C${partner.x} ${y1 + 60} ${x2 + side * 60} ${u.y} ${x2} ${u.y}`, color, dashed: true });
      }
    }
    links.replaceChildren(
      ...paths.map(({ d, color, dashed }) => {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', dashed ? 'editor-link editor-link--pair' : 'editor-link');
        if (color) path.setAttribute('stroke', color);
        return path;
      }),
    );
  }

  function focus(id, field = 'name') {
    const input = cards.get(id)?.querySelector(`[data-field="${field}"]`);
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select?.();
    cards.get(id).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function setSelected(id) {
    selectedId = id;
    for (const [key, card] of cards) card.classList.toggle('is-selected', key === id);
  }

  // --- действия ---

  const actions = {
    parent: (id) => act((f) => addParent(f, id).parent.id),
    child: (id) => act((f) => addPerson(f, { parent: id, added: Date.now() }).id),
    pair: (id) =>
      act((f) => {
        const partner = addPerson(f, { added: Date.now() });
        addUnion(f, id, partner.id);
        return partner.id;
      }),
    remove: (id) => {
      if (isUnionId(id)) {
        act((f) => removeUnion(f, id));
        return null;
      }
      if (fam.people.length === 1) return null;
      const doomed = structuredClone(fam);
      const count = removePerson(doomed, id).length;
      const name = getPerson(fam, id).name;
      if (count > 1 && !confirm(`Удалить «${name}» и ещё ${count - 1} чел. на его ветке?`)) return null;
      act((f) => removePerson(f, id));
      return null;
    },
  };

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('[data-id]');
    if (!card) return;
    onSelect(card.dataset.id);
    if (!btn) return;
    const created = actions[btn.dataset.act](card.dataset.id);
    if (created) {
      onSelect(created);
      focus(created);
    }
  });

  root.addEventListener('focusin', (e) => {
    const card = e.target.closest('[data-id]');
    if (card && card.dataset.id !== selectedId) onSelect(card.dataset.id);
  });

  root.addEventListener('change', (e) => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.matches('[data-photo]')) {
      const [file] = e.target.files;
      e.target.value = '';
      if (file) onPhoto(id, file);
      return;
    }
    const input = e.target.closest('[data-field]');
    if (!input) return;
    const field = input.dataset.field;
    const value = input.value;
    try {
      act((f) => {
        const person = getPerson(f, id);
        if (field === 'name') renamePerson(f, id, value);
        if (field === 'born') setBorn(f, id, value);
        if (field === 'since') setSince(f, id, value);
        if (field === 'parent') setParent(f, id, value);
        if (field === 'died') setDied(f, id, { dead: person.dead, died: value });
        // Сняли «†» — человек жив, дата смерти стирается.
        if (field === 'dead') setDied(f, id, { dead: input.checked, died: input.checked ? person.diedDate ?? person.died : null });
      });
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
      if (input.dataset.hint) input.title = input.dataset.hint;
    } catch (err) {
      // Непонятная дата: поле подсвечено, модель не тронута, текст остаётся для правки.
      input.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
      input.dataset.hint ??= input.title;
      input.title = err.message;
    }
  });

  // Фото можно перетащить прямо на карточку.
  root.addEventListener('dragover', (e) => {
    const card = e.target.closest('.ecard');
    if (!card || ![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    card.classList.add('is-drop');
  });
  root.addEventListener('dragleave', (e) => e.target.closest('.ecard')?.classList.remove('is-drop'));
  root.addEventListener('drop', (e) => {
    const card = e.target.closest('.ecard');
    if (!card) return;
    e.preventDefault();
    card.classList.remove('is-drop');
    const [file] = e.dataTransfer.files;
    if (file) onPhoto(card.dataset.id, file);
  });

  // Enter — сохранить поле.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input[data-field]')) return;
    e.preventDefault();
    e.target.blur();
  });

  return { render, focus, setSelected };
}
