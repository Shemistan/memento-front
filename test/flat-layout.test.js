import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchPath, leafSpots, twigLeaves, twigPath, twigSpecs, vineCurve, vinePath, wrapPath, branchCurve } from '../src/flat/layout.js';

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

test('лиана и обвивка — непрерывные линии, растут по upTo', () => {
  const at = vineCurve({ x: 0, y: 0 }, { x: 200, y: -150 });
  const full = vinePath(at, 1);
  const half = vinePath(at, 0.5);
  assert.match(full, /^M[\d.-]+ [\d.-]+(L[\d.-]+ [\d.-]+)+$/);
  assert.ok(half.length < full.length);
  const wrap = wrapPath(branchCurve({ x: 0, y: 0 }, { x: 40, y: -120 }), () => 3);
  assert.match(wrap, /^M/);
});
