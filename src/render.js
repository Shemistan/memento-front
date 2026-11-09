// Отрисовка позы дерева на Canvas 2D: небо, земля, кора, листья, выделение.

const LEAF_GREENS = ['#173f17', '#22521e', '#2d6525', '#3a7a2c', '#4a8f34', '#5fa33f', '#7ab84d', '#97cb60'];
const BARK = { trunk: '#43301f', limb: '#4d3825', twig: '#5b4430' };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const cam = { s: 0, ox: 0 };
  let backdrop = null;
  let size = { w: 0, h: 0, dpr: 1 };
  let screenLimbs = [];

  function resize(w, h, dpr) {
    size = { w, h, dpr };
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    backdrop = null;
  }

  const groundY = () => Math.round(size.h * 0.84);

  function paintBackdrop(area) {
    const { w, h, dpr } = size;
    const off = document.createElement('canvas');
    off.width = Math.round(w * dpr);
    off.height = Math.round(h * dpr);
    const g = off.getContext('2d');
    g.scale(dpr, dpr);
    const gy = groundY();

    const sky = g.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, '#9cc4e4');
    sky.addColorStop(0.55, '#cfe2ee');
    sky.addColorStop(1, '#f3ead6');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, gy + 2);

    const cx = (area.left + area.right) / 2;
    const sun = g.createRadialGradient(cx - w * 0.22, gy * 0.22, 0, cx - w * 0.22, gy * 0.22, w * 0.45);
    sun.addColorStop(0, 'rgba(255, 246, 214, 0.85)');
    sun.addColorStop(0.25, 'rgba(255, 240, 200, 0.35)');
    sun.addColorStop(1, 'rgba(255, 240, 200, 0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, w, gy);

    hills(g, w, gy, gy * 0.12, '#b7cbb6', 0.0021, 3);
    hills(g, w, gy, gy * 0.07, '#9fbb98', 0.0034, 11);

    const ground = g.createLinearGradient(0, gy, 0, h);
    ground.addColorStop(0, '#7f9f55');
    ground.addColorStop(0.35, '#6b8b46');
    ground.addColorStop(1, '#4d6a34');
    g.fillStyle = ground;
    g.fillRect(0, gy, w, h - gy);

    // Травинки по кромке земли.
    g.strokeStyle = 'rgba(60, 90, 35, 0.55)';
    g.lineWidth = 1;
    let s = 7;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.beginPath();
    for (let x = 0; x < w; x += 2.5) {
      const hgt = 3 + rand() * 7;
      const y0 = gy + rand() * (h - gy) * 0.5;
      g.moveTo(x, y0);
      g.quadraticCurveTo(x + (rand() - 0.5) * 3, y0 - hgt * 0.6, x + (rand() - 0.5) * 5, y0 - hgt);
    }
    g.stroke();
    backdrop = off;
  }

  function hills(g, w, gy, amp, color, freq, seed) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, gy);
    for (let x = 0; x <= w + 8; x += 8) {
      const y = gy - amp * (0.55 + 0.3 * Math.sin(x * freq + seed) + 0.15 * Math.sin(x * freq * 2.7 + seed * 2));
      g.lineTo(x, y);
    }
    g.lineTo(w + 8, gy + 1);
    g.closePath();
    g.fill();
  }

  function updateCamera(bounds, area) {
    const gy = groundY();
    const availW = (area.right - area.left) * 0.88;
    const availH = gy - 36;
    const treeW = Math.max(60, bounds.maxX - bounds.minX);
    const treeH = Math.max(60, bounds.maxY);
    const target = Math.min(availW / treeW, availH / treeH, (availH * 0.82) / 170, 3.2);
    const centre = (bounds.minX + bounds.maxX) / 2;
    if (!cam.s) {
      cam.s = target;
      cam.ox = centre;
    }
    cam.s += (target - cam.s) * 0.05;
    cam.ox += (centre - cam.ox) * 0.05;
  }

  function toScreen(area) {
    const cx = (area.left + area.right) / 2;
    const gy = groundY();
    return (x, y) => [cx + (x - cam.ox) * cam.s, gy - y * cam.s];
  }

  function draw(frame, view) {
    const { area, selectedId, hoverId, showLabels, labels } = view;
    if (!backdrop) paintBackdrop(area);
    updateCamera(frame.bounds, area);
    const project = toScreen(area);
    const s = cam.s;
    const { dpr } = size;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Тень кроны на земле.
    const [bx, gy] = project(0, 0);
    const halfW = ((frame.bounds.maxX - frame.bounds.minX) / 2) * s;
    const [shx] = project((frame.bounds.minX + frame.bounds.maxX) / 2, 0);
    const shadowR = Math.max(20, halfW);
    ctx.save();
    ctx.translate(shx, gy + 6);
    ctx.scale(1, 0.14);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowR);
    shadow.addColorStop(0, `rgba(30, 45, 20, ${0.16 + 0.22 * view.leafAmount})`);
    shadow.addColorStop(1, 'rgba(30, 45, 20, 0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, shadowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    screenLimbs = frame.limbs.map((limb) => {
      if (!limb) return null;
      return { userId: limb.userId, level: limb.level, owner: limb.owner, pts: limb.pts.map((p) => {
        const [x, y] = project(p.x, p.y);
        return { x, y, r: Math.max(0.45, p.r * s), a: p.a };
      }) };
    });

    drawRoots(frame, project, s, bx, gy);
    drawLeaves(frame.leaves, project, s, true, frame.bounds);
    // Сначала сплошной силуэт всех веток, потом объём: так развилки без швов.
    for (const limb of screenLimbs) if (limb) fillLimb(limb);
    shadeLimbs(screenLimbs);
    drawLeaves(frame.leaves, project, s, false, frame.bounds);

    for (const limb of screenLimbs) {
      if (!limb || limb.level !== 0) continue;
      if (limb.userId === selectedId) outline(limb, 'rgba(255, 196, 61, 0.95)', 2.4);
      else if (limb.userId === hoverId) outline(limb, 'rgba(255, 255, 255, 0.75)', 1.6);
    }
    if (showLabels) drawLabels(labels, selectedId);
  }

  function drawRoots(frame, project, s, bx, gy) {
    const trunk = frame.limbs[0];
    if (!trunk) return;
    const r = trunk.pts[0].r * s;
    ctx.fillStyle = BARK.trunk;
    // Корневые наплывы: от боков ствола плавно уходят в землю.
    const roots = [-1.15, -0.7, 0.6, 1.05];
    for (const dir of roots) {
      const side = Math.sign(dir);
      const reach = r * (1.5 + Math.abs(dir) * 0.9);
      const topY = gy - r * (0.75 - Math.abs(dir) * 0.2);
      ctx.beginPath();
      ctx.moveTo(bx, topY);
      ctx.lineTo(bx + side * r * 0.55, topY);
      ctx.bezierCurveTo(bx + side * r * 0.75, gy - r * 0.2, bx + dir * reach * 0.6, gy - r * 0.06, bx + dir * reach, gy + r * 0.1);
      ctx.quadraticCurveTo(bx + dir * reach * 0.45, gy + r * 0.28, bx, gy + r * 0.05);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.ellipse(bx, gy + r * 0.12, r * 1.8, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function edgePath(pts, from, to, path = new Path2D()) {
    // Полоса от смещения -from (влево) до +to (вправо), в долях радиуса.
    // Нормаль вправо от направления роста на экране — (cos a, sin a).
    pts.forEach((p, k) => {
      const x = p.x - Math.cos(p.a) * p.r * from;
      const y = p.y - Math.sin(p.a) * p.r * from;
      if (k === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    for (let k = pts.length - 1; k >= 0; k -= 1) {
      const p = pts[k];
      path.lineTo(p.x + Math.cos(p.a) * p.r * to, p.y + Math.sin(p.a) * p.r * to);
    }
    path.closePath();
    return path;
  }

  function limbPath(pts) {
    const path = edgePath(pts, 1, 1);
    const tip = pts[pts.length - 1];
    path.moveTo(tip.x + tip.r, tip.y);
    path.arc(tip.x, tip.y, tip.r, 0, Math.PI * 2);
    return path;
  }

  function fillLimb(limb) {
    ctx.fillStyle = limb.level ? BARK.twig : limb.owner === 'root' ? BARK.trunk : BARK.limb;
    ctx.fill(limbPath(limb.pts));
  }

  // Свет слева сверху: блик по левому краю, тень по правому. Полосы всех
  // веток сливаются в один контур (nonzero), поэтому в развилках не копятся.
  function shadeLimbs(limbs) {
    const light = new Path2D();
    const dark = new Path2D();
    const textured = [];
    for (const limb of limbs) {
      if (!limb || limb.pts[0].r < 1.4) continue;
      // Первый сегмент ветки лежит внутри родителя — его не затеняем.
      const pts = limb.owner === 'root' && limb.level === 0 ? limb.pts : limb.pts.slice(1);
      edgePath(pts, 0.85, -0.2, light);
      edgePath(pts, -0.35, 1, dark);
      if (limb.pts[0].r > 4.5) textured.push(pts);
    }
    ctx.fillStyle = 'rgba(255, 226, 190, 0.16)';
    ctx.fill(light);
    ctx.fillStyle = 'rgba(20, 10, 4, 0.28)';
    ctx.fill(dark);
    for (const pts of textured) barkTexture(pts);
  }

  function barkTexture(pts) {
    ctx.save();
    ctx.strokeStyle = 'rgba(28, 16, 8, 0.38)';
    ctx.lineWidth = 0.9;
    const lanes = [-0.62, -0.25, 0.12, 0.48, 0.78];
    lanes.forEach((f, li) => {
      ctx.setLineDash([6 + li * 3, 3 + (li % 3) * 2, 11 - li, 4]);
      ctx.lineDashOffset = li * 7;
      ctx.beginPath();
      pts.forEach((p, k) => {
        if (p.r < 3) return;
        const off = f * p.r * (1 + 0.08 * Math.sin(k * 1.9 + li));
        const x = p.x + Math.cos(p.a) * off;
        const y = p.y + Math.sin(p.a) * off;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    ctx.restore();
  }

  function outline(limb, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.stroke(limbPath(limb.pts));
    ctx.restore();
  }

  function drawLeaves(leaves, project, s, back, bounds) {
    const buckets = LEAF_GREENS.map(() => new Path2D());
    const span = Math.max(1, bounds.maxY);
    const midX = (bounds.minX + bounds.maxX) / 2;
    const halfW = Math.max(1, (bounds.maxX - bounds.minX) / 2);
    for (const leaf of leaves) {
      if (leaf.back !== back) continue;
      const height = leaf.y / span;
      const sideLight = -(leaf.x - midX) / halfW; // солнце слева
      let shade = leaf.tone * 0.45 + height * 0.55 + sideLight * 0.15 - (back ? 0.42 : 0);
      shade = Math.max(0, Math.min(0.999, shade));
      const path = buckets[Math.floor(shade * LEAF_GREENS.length)];
      const [cx, cy] = project(leaf.x, leaf.y);
      const len = leaf.s * s;
      const dx = Math.sin(leaf.a);
      const dy = -Math.cos(leaf.a);
      const wid = len * 0.42;
      const bxp = cx - dx * len * 0.5;
      const byp = cy - dy * len * 0.5;
      const txp = cx + dx * len * 0.5;
      const typ = cy + dy * len * 0.5;
      path.moveTo(bxp, byp);
      path.quadraticCurveTo(cx - dy * wid, cy + dx * wid, txp, typ);
      path.quadraticCurveTo(cx + dy * wid, cy - dx * wid, bxp, byp);
    }
    buckets.forEach((path, k) => {
      ctx.fillStyle = LEAF_GREENS[k];
      ctx.fill(path);
    });
  }

  function drawLabels(labels, selectedId) {
    ctx.save();
    ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    // Выбранная подпись первой; остальные пропускаем, если налезают на уже стоящие.
    const order = screenLimbs
      .filter((limb) => limb && limb.level === 0 && labels.has(limb.userId))
      .sort((a, b) => (b.userId === selectedId) - (a.userId === selectedId));
    const placed = [];
    for (const limb of order) {
      const name = labels.get(limb.userId);
      const p = limb.pts[Math.floor(limb.pts.length * 0.6)] || limb.pts[0];
      const w = ctx.measureText(name).width + 12;
      const x = p.x - w / 2;
      const y = p.y - p.r - 13;
      const box = { x: x - 2, y: y - 11, w: w + 4, h: 22 };
      if (placed.some((o) => box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h)) continue;
      placed.push(box);
      ctx.fillStyle = limb.userId === selectedId ? 'rgba(255, 196, 61, 0.95)' : 'rgba(255, 252, 244, 0.86)';
      ctx.beginPath();
      ctx.roundRect(x, y - 9, w, 18, 9);
      ctx.fill();
      ctx.fillStyle = '#2b2116';
      ctx.fillText(name, x + 6, y);
    }
    ctx.restore();
  }

  // Ветка пользователя под точкой экрана (ближайшая с запасом в 8px).
  function hitTest(x, y) {
    let best = null;
    let bestScore = 8;
    for (const limb of screenLimbs) {
      if (!limb || limb.level !== 0) continue;
      const { pts } = limb;
      for (let k = 0; k < pts.length - 1; k += 1) {
        const a = pts[k];
        const b = pts[k + 1];
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const l2 = vx * vx + vy * vy || 1;
        const u = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / l2));
        const d = Math.hypot(x - (a.x + vx * u), y - (a.y + vy * u));
        const score = d - (a.r + (b.r - a.r) * u);
        if (score <= bestScore) {
          bestScore = score;
          best = limb.userId;
        }
      }
    }
    return best;
  }

  function invalidateBackdrop() {
    backdrop = null;
  }

  return { resize, draw, hitTest, invalidateBackdrop };
}
