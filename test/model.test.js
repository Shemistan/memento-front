import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOT_ID,
  addBranch,
  childrenOf,
  createTree,
  depthOf,
  deserialize,
  getNode,
  parseOutline,
  removeBranch,
  renameBranch,
  serialize,
  toOutline,
} from '../src/model.js';

test('новая ветка получает уникальный id и родителя', () => {
  const tree = createTree();
  const a = addBranch(tree, ROOT_ID, 'А');
  const b = addBranch(tree, a.id, '  Б  ');
  assert.notEqual(a.id, b.id);
  assert.equal(b.parentId, a.id);
  assert.equal(b.name, 'Б');
  assert.equal(depthOf(tree, b.id), 2);
});

test('пустое имя заменяется номером, к несуществующей ветке добавить нельзя', () => {
  const tree = createTree();
  assert.match(addBranch(tree, ROOT_ID, '   ').name, /^Ветка \d+$/);
  assert.throws(() => addBranch(tree, 'nope', 'x'));
});

test('удаление уносит всех потомков, ствол не удаляется', () => {
  const tree = createTree();
  const a = addBranch(tree, ROOT_ID, 'А');
  const b = addBranch(tree, a.id, 'Б');
  addBranch(tree, b.id, 'В');
  const keep = addBranch(tree, ROOT_ID, 'Г');
  assert.deepEqual(removeBranch(tree, ROOT_ID), []);
  assert.equal(removeBranch(tree, a.id).length, 3);
  assert.deepEqual(tree.nodes.map((n) => n.id), [ROOT_ID, keep.id]);
});

test('переименование игнорирует пустую строку', () => {
  const tree = createTree();
  const a = addBranch(tree, ROOT_ID, 'А');
  renameBranch(tree, a.id, '');
  assert.equal(getNode(tree, a.id).name, 'А');
  renameBranch(tree, a.id, 'Новое');
  assert.equal(getNode(tree, a.id).name, 'Новое');
});

test('текстовая структура разбирается по отступам и собирается обратно', () => {
  const text = 'Дуб\n  Левая\n    Тонкая\n  Правая\n\n# комментарий\n';
  const tree = parseOutline(text);
  assert.equal(getNode(tree, ROOT_ID).name, 'Дуб');
  assert.deepEqual(childrenOf(tree, ROOT_ID).map((n) => n.name), ['Левая', 'Правая']);
  const left = childrenOf(tree, ROOT_ID)[0];
  assert.deepEqual(childrenOf(tree, left.id).map((n) => n.name), ['Тонкая']);
  assert.equal(toOutline(tree), 'Дуб\n  Левая\n    Тонкая\n  Правая');
});

test('строки без отступа после ствола становятся его ветками, маркеры списков снимаются', () => {
  const tree = parseOutline('Ствол\n- Один\n\t- Два');
  const [one] = childrenOf(tree, ROOT_ID);
  assert.equal(one.name, 'Один');
  assert.equal(childrenOf(tree, one.id)[0].name, 'Два');
});

test('пустую структуру разобрать нельзя', () => {
  assert.throws(() => parseOutline('  \n# только комментарий'));
});

test('сериализация сохраняет дерево, сироты отбрасываются, id не повторяются', () => {
  const tree = parseOutline('Ствол\n  А\n    Б');
  const copy = deserialize(serialize(tree));
  assert.deepEqual(copy.nodes, tree.nodes);

  const broken = deserialize(JSON.stringify({ seq: 0, nodes: [...tree.nodes, { id: 'b9', name: 'x', parentId: 'gone' }] }));
  assert.equal(broken.nodes.length, 3);
  const fresh = addBranch(broken, ROOT_ID, 'В');
  assert.ok(!tree.nodes.some((n) => n.id === fresh.id));
  assert.throws(() => deserialize('{"nodes": []}'));
});
