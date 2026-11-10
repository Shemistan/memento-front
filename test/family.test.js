import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_ID } from '../src/model.js';
import {
  addPerson,
  addUnion,
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
