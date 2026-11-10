import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_ID } from '../src/model.js';
import {
  addParent,
  addPerson,
  addUnion,
  canAddParent,
  checks,
  childrenOf,
  createFamily,
  deserialize,
  fromTree,
  getPerson,
  parseFamily,
  removePerson,
  removeUnion,
  roots,
  serialize,
  setDied,
  toFamilyText,
  toTree,
  unionsOf,
} from '../src/family/model.js';
import { GAP, MIN_DY, familyLayout } from '../src/flat/family-layout.js';

const DEMO = `Николай 1926
  + Анна 1929 (1950)
    Пётр 1952
      + @Мария 1955 (1976)
        Ирина 1977
        Андрей 1981
      + Ольга 1960 (1989)
        Дмитрий 1990
    Елена 1956
Сергей 1925
  + Валентина 1930 (1952)
    Мария 1955
    Татьяна 1958`;

const byName = (fam, name) => fam.people.find((p) => p.name === name);

test('текст: люди, пары, дети пар и ссылка на человека из другого дерева', () => {
  const fam = parseFamily(DEMO);
  const petr = byName(fam, 'Пётр');
  const [first, second] = unionsOf(fam, petr.id);
  assert.equal(getPerson(fam, first.partner), byName(fam, 'Мария'), '@Мария — та же, что в дереве Сергея');
  assert.equal(first.since, 1976);
  assert.deepEqual(childrenOf(fam, first.id).map((p) => p.name), ['Ирина', 'Андрей']);
  assert.deepEqual(childrenOf(fam, second.id).map((p) => p.name), ['Дмитрий']);
  assert.deepEqual(roots(fam).map((p) => p.name), ['Николай', 'Анна', 'Ольга', 'Сергей', 'Валентина']);
});

test('текст туда и обратно не меняет семью', () => {
  const fam = parseFamily(DEMO);
  const again = parseFamily(toFamilyText(fam));
  assert.equal(toFamilyText(again), toFamilyText(fam));
  assert.equal(again.people.length, fam.people.length);
  assert.equal(again.unions.length, fam.unions.length);
});

test('ошибки текста понятны', () => {
  assert.throws(() => parseFamily(''), /Пустая/);
  assert.throws(() => parseFamily('+ Анна'), /под человеком/);
  assert.throws(() => parseFamily('Иван\n  + @Нет'), /не найден/);
});

test('пары: нельзя с собой и дважды; пары упорядочены по году брака', () => {
  const fam = createFamily();
  const a = addPerson(fam, { name: 'А', born: 1950 });
  const b = addPerson(fam, { name: 'Б', born: 1952 });
  const c = addPerson(fam, { name: 'В', born: 1955 });
  assert.throws(() => addUnion(fam, a.id, a.id), /одного/);
  const late = addUnion(fam, a.id, c.id, 1990);
  const early = addUnion(fam, a.id, b.id, 1975);
  assert.throws(() => addUnion(fam, b.id, a.id), /уже есть/);
  assert.deepEqual(unionsOf(fam, a.id), [early, late]);
});

test('удаление: потомки уходят, дети распавшейся пары остаются у host', () => {
  const fam = parseFamily(DEMO);
  const maria = byName(fam, 'Мария');
  const petr = byName(fam, 'Пётр');
  removePerson(fam, maria.id);
  assert.equal(unionsOf(fam, petr.id).length, 1, 'пара с Марией распалась');
  assert.equal(byName(fam, 'Ирина').parent, petr.id, 'дети остались у Петра');

  removePerson(fam, petr.id);
  for (const name of ['Пётр', 'Ирина', 'Андрей', 'Дмитрий']) assert.equal(byName(fam, name), undefined, name);
  assert.ok(byName(fam, 'Ольга'), 'супруга со своим деревом остаётся');

  const fam2 = parseFamily(DEMO);
  const union = unionsOf(fam2, byName(fam2, 'Николай').id)[0];
  removeUnion(fam2, union.id);
  assert.equal(byName(fam2, 'Пётр').parent, byName(fam2, 'Николай').id);
});

test('сохранение отбрасывает битые ссылки и циклы', () => {
  const fam = parseFamily(DEMO);
  const data = JSON.parse(serialize(fam));
  data.unions.push({ id: 'u999', host: 'p1', partner: 'нет', since: 2000 });
  data.people[0].parent = data.people[3].id; // цикл: Николай — ребёнок своего внука
  const back = deserialize(JSON.stringify(data));
  assert.equal(back.unions.length, fam.unions.length);
  assert.equal(back.people[0].parent, null);
});

test('старое дерево веток превращается в семью, живой вид видит главное дерево', () => {
  const tree = { seq: 2, nodes: [{ id: ROOT_ID, name: 'Ствол', parentId: null, born: 0 }, { id: 'b1', name: 'А', parentId: ROOT_ID, born: 0 }] };
  const fam = fromTree(tree);
  assert.equal(fam.people.length, 2);
  assert.equal(fam.people[1].parent, fam.people[0].id);

  const projected = toTree(parseFamily(DEMO));
  const names = projected.nodes.map((n) => n.name);
  assert.equal(projected.nodes[0].id, ROOT_ID);
  assert.ok(names.includes('Дмитрий') && names.includes('Ирина'));
  assert.ok(!names.includes('Сергей'), 'чужие деревья в живом виде не показываются');
});

// --- раскладка ---

test('кто родился раньше, стоит ниже; ребёнок выше родителя', () => {
  const fam = parseFamily(DEMO);
  const layout = familyLayout(fam);
  const y = (name) => layout.nodes.get(byName(fam, name).id).y;
  assert.ok(y('Сергей') > y('Николай'), '1925 ниже 1926');
  assert.ok(y('Ирина') > y('Андрей'), '1977 ниже 1981');
  assert.ok(y('Валентина') > y('Мария'));
  for (const n of layout.nodes.values()) {
    if (n.parentId) assert.ok(layout.nodes.get(n.parentId).y - n.y >= MIN_DY - 1e-9, `${n.id} выше родителя`);
  }
});

test('второй брак — новый узел выше первого на ветке того же человека', () => {
  const fam = parseFamily(DEMO);
  const layout = familyLayout(fam);
  const [first, second] = unionsOf(fam, byName(fam, 'Пётр').id);
  assert.equal(layout.nodes.get(first.id).parentId, byName(fam, 'Пётр').id);
  assert.equal(layout.nodes.get(second.id).parentId, first.id);
  assert.ok(layout.nodes.get(second.id).y < layout.nodes.get(first.id).y);
  assert.equal(layout.nodes.get(byName(fam, 'Дмитрий').id).parentId, second.id);
});

test('узлы на одной высоте не перекрываются, у каждого корня своё дерево', () => {
  const fam = parseFamily(DEMO);
  for (let i = 0; i < 40; i++) addPerson(fam, { name: `Внук ${i}`, born: 1990 + (i % 12), parent: fam.people[(i * 5) % fam.people.length].id });
  const layout = familyLayout(fam);
  const list = [...layout.nodes.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (Math.abs(a.y - b.y) >= 30) continue;
      const gap = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
      assert.ok(gap >= GAP - 1e-6 || gap > 0, `${a.id} и ${b.id} накладываются (${gap.toFixed(1)})`);
    }
  }
  assert.equal(new Set(list.map((n) => n.root)).size, roots(fam).length);
});

test('одинокий человек и пустые годы раскладываются', () => {
  const fam = createFamily();
  const a = addPerson(fam, { name: 'Один' });
  let layout = familyLayout(fam);
  assert.equal(layout.nodes.get(a.id).y, 0);
  const b = addPerson(fam, { name: 'Супруг' });
  const u = addUnion(fam, a.id, b.id);
  addPerson(fam, { name: 'Ребёнок', parent: u.id });
  layout = familyLayout(fam);
  assert.equal(layout.nodes.size, 4);
  for (const n of layout.nodes.values()) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
});

// --- годы смерти, родители, проверки ---

test('годы жизни в тексте: смерть с годом, без года, неизвестное рождение', () => {
  const text = 'Николай 1926–1998\n  + Анна 1929–? (1950)\n    Пётр 1952\n    Ваня ?–2001';
  const fam = parseFamily(text);
  const [nik, anna, petr, vanya] = ['Николай', 'Анна', 'Пётр', 'Ваня'].map((n) => byName(fam, n));
  assert.deepEqual([nik.dead, nik.died], [true, 1998]);
  assert.deepEqual([anna.dead, anna.died], [true, null]);
  assert.deepEqual([petr.dead, petr.died], [false, null]);
  assert.deepEqual([vanya.born, vanya.died], [null, 2001]);
  assert.equal(toFamilyText(fam), text);
  const back = deserialize(serialize(fam));
  assert.deepEqual([byName(back, 'Анна').dead, byName(back, 'Анна').died], [true, null]);
});

test('год смерти делает ушедшим, снятие отметки — живым', () => {
  const fam = createFamily();
  const p = addPerson(fam, { name: 'А', born: 1950 });
  setDied(fam, p.id, { died: 2000 });
  assert.deepEqual([p.dead, p.died], [true, 2000]);
  setDied(fam, p.id, { dead: false });
  assert.deepEqual([p.dead, p.died], [false, null]);
});

test('родитель у корня — новый предок, дерево остаётся главным', () => {
  const fam = parseFamily(DEMO);
  const nik = byName(fam, 'Николай');
  const { parent } = addParent(fam, nik.id, { name: 'Прадед', born: 1900 });
  assert.equal(nik.parent, parent.id);
  assert.equal(roots(fam)[0], parent, 'новый корень стоит первым — главное дерево то же');
  assert.equal(toTree(fam).nodes[0].name, 'Прадед');
  const layout = familyLayout(fam);
  assert.ok(layout.nodes.get(parent.id).y > layout.nodes.get(nik.id).y, 'предок ниже');
});

test('второй родитель превращает одного родителя в пару; третьего не бывает', () => {
  const fam = createFamily();
  const mom = addPerson(fam, { name: 'Мама', born: 1960 });
  const kid = addPerson(fam, { name: 'Сын', born: 1985, parent: mom.id });
  assert.ok(canAddParent(fam, kid.id));
  const { parent, union } = addParent(fam, kid.id, { name: 'Папа' });
  assert.equal(kid.parent, union.id);
  assert.deepEqual([union.host, union.partner], [mom.id, parent.id]);
  assert.ok(!canAddParent(fam, kid.id));
  assert.throws(() => addParent(fam, kid.id), /Оба родителя/);
});

test('проверки ловят вероятные опечатки в годах', () => {
  const fam = parseFamily('Отец 1950–1970\n  + Мать 1952 (1975)\n    Сын 1980\n  Дочь 1955\nОшибка 2000–1990');
  const warn = checks(fam);
  assert.match(warn.get(byName(fam, 'Сын').id).join(), /после смерти/);
  assert.match(warn.get(byName(fam, 'Дочь').id).join(), /слишком молод/);
  assert.match(warn.get(byName(fam, 'Ошибка').id).join(), /раньше года рождения/);
  assert.match(warn.get(fam.unions[0].id).join(), /после смерти/);
  assert.equal(warn.get(byName(fam, 'Мать').id), undefined);
});

test('редактор: ярусы поколений, карточки не накладываются', () => {
  const fam = parseFamily(DEMO);
  addPerson(fam, { name: 'Без пары', born: 1958, parent: byName(fam, 'Николай').id });
  const W = 228;
  const H = 104;
  const layout = familyLayout(fam, { rows: 84, measure: () => W, nodeH: H, unionW: 168, unionH: 32, gap: 28 });
  const box = (n) => (n.kind === 'union' ? { w: 168, h: 32 } : { w: W, h: H });
  const list = [...layout.nodes.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      const overlapX = Math.abs(a.x - b.x) < (box(a).w + box(b).w) / 2;
      const overlapY = Math.abs(a.y - b.y) < (box(a).h + box(b).h) / 2;
      assert.ok(!(overlapX && overlapY), `${a.id} и ${b.id} накладываются`);
    }
  }
  const nik = layout.nodes.get(byName(fam, 'Николай').id);
  assert.ok(layout.nodes.get(byName(fam, 'Пётр').id).y < nik.y, 'потомки на другом ярусе');
});
