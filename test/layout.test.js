import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_ID, addBranch, createTree, parseOutline } from '../src/model.js';
import { GROW_MS, buildPlan, carryOver, pose, samplePolyline } from '../src/layout.js';

const GROWN = 60_000;
const DEMO = 'Ствол\n  А\n    А1\n    А2\n  Б\n    Б1\n  В';

const userLimbs = (plan) => plan.limbs.filter((l) => l.userId);

test('каждая ветка модели — ровно одна ветка плана, родитель идёт раньше потомка', () => {
  const tree = parseOutline(DEMO);
  const plan = buildPlan(tree);
  assert.deepEqual(userLimbs(plan).map((l) => l.userId).sort(), tree.nodes.map((n) => n.id).sort());
  for (const limb of plan.limbs) {
    if (limb.parent >= 0) assert.ok(limb.parent < limb.idx);
  }
  assert.ok(plan.limbs.length > tree.nodes.length, 'есть процедурные веточки');
  assert.ok(plan.leaves.length > 50, 'есть листья');
});

test('план детерминирован: та же модель — та же геометрия', () => {
  const a = buildPlan(parseOutline(DEMO));
  const b = buildPlan(parseOutline(DEMO));
  assert.deepEqual(
    a.limbs.map((l) => [l.t, l.rel, l.len]),
    b.limbs.map((l) => [l.t, l.rel, l.len]),
  );
});

test('выросшее дерево: ствол толще веток, ветки сужаются к кончику', () => {
  const frame = pose(buildPlan(parseOutline(DEMO)), { now: GROWN, wind: 0 });
  const trunk = frame.limbs[0];
  const user = frame.limbs.filter((l) => l && l.userId && l.userId !== ROOT_ID);
  for (const limb of user) {
    assert.ok(trunk.pts[0].r > limb.pts[0].r);
    assert.ok(limb.pts[0].r >= limb.pts[limb.pts.length - 1].r);
  }
  assert.ok(frame.bounds.maxY > 100);
});

test('новая ветка растёт со временем и утолщает ствол', () => {
  const tree = parseOutline(DEMO);
  const before = pose(buildPlan(tree), { now: GROWN, wind: 0 });
  const born = GROWN + 1000;
  const node = addBranch(tree, ROOT_ID, 'Новая', born);
  const plan = buildPlan(tree);
  const idx = plan.limbs.findIndex((l) => l.userId === node.id);

  assert.equal(pose(plan, { now: born - 1, wind: 0 }).limbs[idx], null, 'до рождения ветки нет');
  const mid = pose(plan, { now: born + GROW_MS.user * 0.3, wind: 0 }).limbs[idx];
  const done = pose(plan, { now: born + 30_000, wind: 0 });
  const length = (pts) => Math.hypot(pts.at(-1).x - pts[0].x, pts.at(-1).y - pts[0].y);
  assert.ok(length(mid.pts) < length(done.limbs[idx].pts));
  assert.ok(done.limbs[0].pts[0].r > before.limbs[0].pts[0].r);
});

test('новая ветка не сдвигает соседей и старые веточки', () => {
  const tree = parseOutline(DEMO);
  const before = buildPlan(tree);
  addBranch(tree, ROOT_ID, 'Новая', GROWN);
  const after = buildPlan(tree);
  const byId = new Map(after.limbs.map((l) => [l.id, l]));
  for (const limb of before.limbs.filter((l) => l.userId)) {
    const same = byId.get(limb.id);
    assert.equal(same.t, limb.t, `${limb.id}: место на родителе`);
    assert.equal(same.rel, limb.rel, `${limb.id}: угол`);
  }
  const kept = before.limbs.filter((l) => !l.userId && byId.has(l.id));
  assert.ok(kept.length > before.limbs.length * 0.6, 'большая часть веточек сохранилась');
});

test('после перестройки форма перетекает плавно, новые веточки растут с нуля', () => {
  const tree = parseOutline(DEMO);
  const prev = buildPlan(tree);
  const now = GROWN;
  const shown = pose(prev, { now, wind: 0 });
  addBranch(tree, ROOT_ID, 'Новая', now);
  const next = carryOver(prev, buildPlan(tree), now);

  const trunkTip = (frame) => frame.limbs[0].pts.at(-1);
  const same = pose(next, { now, wind: 0 });
  assert.ok(Math.abs(trunkTip(same).y - trunkTip(shown).y) < 1e-6, 'в момент перестройки ствол не прыгает');
  const later = pose(next, { now: now + 5000, wind: 0 });
  assert.ok(trunkTip(later).y > trunkTip(shown).y, 'затем ствол дорастает');

  const fresh = next.limbs.filter((l) => !prev.limbs.some((p) => p.id === l.id));
  assert.ok(fresh.length > 0);
  for (const limb of fresh) assert.equal(same.limbs[limb.idx], null, `${limb.id} ещё не вырос`);
});

test('выключенные листья исчезают, ветки остаются', () => {
  const plan = buildPlan(parseOutline(DEMO));
  const on = pose(plan, { now: GROWN, leafAmount: 1 });
  const off = pose(plan, { now: GROWN, leafAmount: 0 });
  assert.ok(on.leaves.length > 50);
  assert.equal(off.leaves.length, 0);
  assert.equal(off.limbs.filter(Boolean).length, plan.limbs.length);
});

test('одинокий ствол тоже рисуется', () => {
  const frame = pose(buildPlan(createTree()), { now: GROWN });
  assert.ok(frame.limbs[0].pts.length > 2);
  assert.ok(frame.leaves.length > 0);
});

test('samplePolyline интерполирует по длине', () => {
  const pts = [
    { x: 0, y: 0, r: 2, a: 0 },
    { x: 0, y: 10, r: 1, a: 0 },
  ];
  assert.deepEqual(samplePolyline(pts, 0.5), { x: 0, y: 5, r: 1.5, a: 0 });
  assert.deepEqual(samplePolyline(pts, 2), { x: 0, y: 10, r: 1, a: 0 });
});
