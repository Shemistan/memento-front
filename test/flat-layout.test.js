import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_ID, addBranch, createTree, parseOutline } from '../src/model.js';
import { GAP, ROW, branchPath, estimateWidth, layoutTree, leafSpots, twigLeaves, twigPath, twigSpecs } from '../src/flat/layout.js';

const DEMO = 'Ствол\n  А\n    А1\n    А2\n    А3\n  Б\n  В\n    В1\n      В11\n      В12\n    В2';

// Узлы одного яруса не перекрываются и стоят не ближе зазора.
function assertNoOverlap(layout) {
  const rows = new Map();
  for (const n of layout.nodes.values()) {
    if (!rows.has(n.depth)) rows.set(n.depth, []);
    rows.get(n.depth).push(n);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].x - row[i].width / 2 - (row[i - 1].x + row[i - 1].width / 2);
      assert.ok(gap >= GAP - 1e-6, `${row[i - 1].id} и ${row[i].id}: зазор ${gap}`);
    }
  }
}

test('поколения стоят ярусами, ствол внизу', () => {
  const tree = parseOutline(DEMO);
  const layout = layoutTree(tree);
  assert.equal(layout.nodes.size, tree.nodes.length);
  assert.equal(layout.nodes.get(ROOT_ID).y, 0);
  for (const n of layout.nodes.values()) assert.equal(n.y + 0, -n.depth * ROW + 0);
  assert.equal(layout.order[0], ROOT_ID);
});

test('узлы не перекрываются, порядок детей сохраняется', () => {
  const tree = parseOutline(DEMO);
  const layout = layoutTree(tree);
  assertNoOverlap(layout);
  const xOf = (name) => layout.nodes.get(tree.nodes.find((n) => n.name === name).id).x;
  assert.ok(xOf('А') < xOf('Б') && xOf('Б') < xOf('В'));
  assert.ok(xOf('А1') < xOf('А2') && xOf('А2') < xOf('А3'));
});

test('родитель стоит над серединой своих детей', () => {
  const tree = parseOutline(DEMO);
  const layout = layoutTree(tree);
  for (const n of layout.nodes.values()) {
    const kids = [...layout.nodes.values()].filter((k) => k.parentId === n.id);
    if (!kids.length) continue;
    const mid = (Math.min(...kids.map((k) => k.x)) + Math.max(...kids.map((k) => k.x))) / 2;
    assert.ok(Math.abs(n.x - mid) < 1e-6, n.id);
  }
});

test('длинные имена раздвигают соседей, кончики считаются по поддереву', () => {
  const tree = createTree('Род');
  const a = addBranch(tree, ROOT_ID, 'Очень длинное имя предка');
  addBranch(tree, ROOT_ID, 'Б');
  addBranch(tree, a.id, 'А1');
  addBranch(tree, a.id, 'А2');
  const layout = layoutTree(tree);
  assertNoOverlap(layout);
  assert.equal(layout.nodes.get(ROOT_ID).tips, 3);
  assert.equal(layout.nodes.get(a.id).tips, 2);
  assert.ok(estimateWidth('Очень длинное имя предка') > estimateWidth('Б'));
});

test('большое дерево без перекрытий', () => {
  const tree = createTree();
  for (let i = 0; i < 120; i++) addBranch(tree, tree.nodes[(i * 7) % tree.nodes.length].id, `Узел ${i}`);
  assertNoOverlap(layoutTree(tree));
});

test('ветка и листья детерминированы', () => {
  const d = branchPath({ x: 0, y: 0 }, { x: 80, y: -120 }, 8, 2);
  assert.match(d, /^M.*Z$/);
  assert.equal(d, branchPath({ x: 0, y: 0 }, { x: 80, y: -120 }, 8, 2));
  assert.deepEqual(leafSpots('b1', { tip: true }), leafSpots('b1', { tip: true }));
  assert.ok(leafSpots('b1', { tip: true }).length > leafSpots('b1').length);
  for (const s of leafSpots('b7', { tip: true })) assert.ok(s.y < 0, 'листья над табличкой');
});

test('декоративные веточки: стабильны по id, на кончике есть крона', () => {
  assert.deepEqual(twigSpecs('b3'), twigSpecs('b3'));
  const inner = twigSpecs('b3');
  const tip = twigSpecs('b3', { tip: true });
  assert.ok(tip.length > inner.length, 'у кончика больше веточек');
  for (const twig of inner) assert.ok(twig.t > 0 && twig.t < 1, 'вдоль ветки, не на концах');
  assert.ok(tip.some((twig) => twig.t === 1));
  assert.deepEqual(twigLeaves('b3/0/0'), twigLeaves('b3/0/0'));
});

test('веточка сужается и кончается на заданной длине', () => {
  const twig = twigPath({ x: 0, y: 0 }, -Math.PI / 2, 50, 3);
  assert.ok(Math.abs(twig.tip.x) < 1e-9);
  assert.ok(Math.abs(twig.tip.y + 50) < 1e-9);
  assert.match(twig.d, /^M.*Z$/);
});
