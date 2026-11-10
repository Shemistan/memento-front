import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchPath, leafSpots, twigCount, twigLeaves, twigPath, twigSpecs, vineCurve, vinePath, wrapPath, branchCurve } from '../src/flat/layout.js';

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

test('густота: веточек больше на длинной ветке, коэффициент их умножает', () => {
  assert.equal(twigCount(undefined), 3, 'без длины — как раньше');
  assert.equal(twigCount(70), 1);
  assert.equal(twigCount(700), 10);
  assert.equal(twigCount(700, 0.5), 5);
  assert.equal(twigCount(700, 0), 0, 'густота 0 — голые ветки');
  assert.equal(twigCount(10, 1), 1, 'короткой ветке — хотя бы одна');
  assert.ok(twigCount(1e6, 3) <= 14, 'есть предел');

  const short = twigSpecs('b9', { length: 140 });
  const long = twigSpecs('b9', { length: 700 });
  assert.equal(short.length, 2);
  assert.equal(long.length, 10);
  assert.deepEqual(long, twigSpecs('b9', { length: 700 }), 'стабильны по id и длине');
  for (const twig of long) assert.ok(twig.t > 0.1 && twig.t < 0.92, 'вдоль ветки, не у развилки и не под табличкой');
  const ts = long.map((twig) => twig.t);
  assert.ok(Math.max(...ts) - Math.min(...ts) > 0.6, 'распределены по всей длине');
  const avg = (list) => list.reduce((s, twig) => s + twig.len, 0) / list.length;
  assert.ok(avg(long) > avg(short), 'на длинной ветке веточки длиннее');
  assert.equal(twigSpecs('b9', { length: 700, density: 0, tip: true }).filter((twig) => twig.t < 1).length, 0);
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
