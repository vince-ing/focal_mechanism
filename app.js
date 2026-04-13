// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
const DEG = Math.PI / 180;
const rad = d => d * DEG;
const deg = r => r / DEG;
const n360 = a => ((a % 360) + 360) % 360;
const n180 = a => { a = n360(a); return a >= 180 ? a - 360 : a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Fault geometry
// ---------------------------------------------------------------------------
function faultVectors(strike, dip, rake) {
  const s = rad(strike), d = rad(dip), r = rad(rake);
  return {
    n: [-Math.sin(d) * Math.sin(s), Math.sin(d) * Math.cos(s), -Math.cos(d)],
    l: [
      Math.cos(r) * Math.cos(s) + Math.sin(r) * Math.cos(d) * Math.sin(s),
      Math.cos(r) * Math.sin(s) - Math.sin(r) * Math.cos(d) * Math.cos(s),
      -Math.sin(r) * Math.sin(d)
    ]
  };
}

function vec2sdr(n, l) {
  let [nx, ny, nz] = [...n];
  let [lx, ly, lz] = [...l];
  if (nz > 0) { nx = -nx; ny = -ny; nz = -nz; lx = -lx; ly = -ly; lz = -lz; }
  const dip = deg(Math.acos(clamp(-nz, -1, 1)));
  const sd = dip < 0.01 ? 0 : n360(deg(Math.atan2(-nx, ny)));
  const sr = rad(sd), dr = rad(dip);
  const strDir = [Math.cos(sr), Math.sin(sr), 0];
  const dipDir = [-Math.cos(dr) * Math.sin(sr), Math.cos(dr) * Math.cos(sr), Math.sin(dr)];
  const ss = lx * strDir[0] + ly * strDir[1] + lz * strDir[2];
  const ds = -(lx * dipDir[0] + ly * dipDir[1] + lz * dipDir[2]);
  return { strike: Math.round(sd), dip: Math.round(dip), rake: Math.round(n180(deg(Math.atan2(ds, ss)))) };
}

function auxPlane(s, d, r) {
  const { n, l } = faultVectors(s, d, r);
  return vec2sdr(l, n);
}

// ---------------------------------------------------------------------------
// Stereonet equal-area projection
// ---------------------------------------------------------------------------
function lproj(az_deg, inc_deg, R = 100) {
  const a = rad(az_deg), i = rad(inc_deg);
  const r = R * Math.SQRT2 * Math.sin(i / 2);
  return [r * Math.sin(a), -r * Math.cos(a)];
}

// ---------------------------------------------------------------------------
// Fault-type classification
// ---------------------------------------------------------------------------
function classify(rake) {
  const r = n180(rake);
  const a = Math.abs(r);
  if (a <= 20 || a >= 160) {
    const isLL = (a <= 20);
    return isLL
      ? { main: 'Strike-slip', sub: 'Left-lateral (sinistral)', cls: 'ss', sense: 'Left-lateral' }
      : { main: 'Strike-slip', sub: 'Right-lateral (dextral)', cls: 'ss', sense: 'Right-lateral' };
  }
  if (a >= 70 && a <= 110) return r > 0
    ? { main: 'Reverse / thrust', sub: 'Compressional regime', cls: 'rv', sense: 'Reverse' }
    : { main: 'Normal', sub: 'Extensional regime', cls: 'nm', sense: 'Normal' };
  if (r > 0 && a < 70)  return { main: 'Oblique-reverse', sub: 'Reverse + left-lateral',  cls: 'ob', sense: 'Rev-LL' };
  if (r > 0 && a > 110) return { main: 'Oblique-reverse', sub: 'Reverse + right-lateral', cls: 'ob', sense: 'Rev-RL' };
  if (r < 0 && a < 70)  return { main: 'Oblique-normal',  sub: 'Normal + left-lateral',   cls: 'ob', sense: 'Norm-LL' };
  return                       { main: 'Oblique-normal',  sub: 'Normal + right-lateral',  cls: 'ob', sense: 'Norm-RL' };
}

function badgeCls(cls) {
  return { ss: 'b-ss', nm: 'b-nm', rv: 'b-rv', ob: 'b-ob' }[cls] || 'b-ob';
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function isDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getColors() {
  return {
    compress:  getCSSVar('--compress'),
    dilate:    getCSSVar('--dilate'),
    border:    getCSSVar('--border'),
    np1:       getCSSVar('--np1'),
    np2:       getCSSVar('--np2'),
    gridLine:  isDark() ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
    text3:     getCSSVar('--text-3'),
    surface:   getCSSVar('--surface'),
    text:      getCSSVar('--text'),
    text2:     getCSSVar('--text-2'),
  };
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

// ---------------------------------------------------------------------------
// Canvas: Beach Ball
// ---------------------------------------------------------------------------
function drawBB(strike, dip, rake) {
  const c = document.getElementById('bbc'), ctx = c.getContext('2d');
  const W = 220, H = 220, R = 100, CX = W / 2, CY = H / 2;
  const col = getColors();
  ctx.clearRect(0, 0, W, H);
  const { n, l } = faultVectors(strike, dip, rake);
  const img = ctx.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = px - CX, y = py - CY;
      if (x * x + y * y > R * R) continue;
      const rr = Math.sqrt(x * x + y * y) / R;
      const inc = 2 * Math.asin(clamp(rr / Math.SQRT2, -1, 1));
      const az = Math.atan2(x, -y);
      const vN = Math.sin(inc) * Math.cos(az), vE = Math.sin(inc) * Math.sin(az), vD = Math.cos(inc);
      const comp = (n[0] * vN + n[1] * vE + n[2] * vD) * (l[0] * vN + l[1] * vE + l[2] * vD) >= 0;
      const idx = (py * W + px) * 4;
      const rgb = hexToRgb(comp ? col.compress : col.dilate);
      img.data[idx] = rgb[0]; img.data[idx + 1] = rgb[1]; img.data[idx + 2] = rgb[2]; img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.save(); ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.stroke();
  drawNPCanvas(ctx, strike, dip, col.np1, 2, R, CX, CY, false);
  const a2 = auxPlane(strike, dip, rake);
  drawNPCanvas(ctx, a2.strike, a2.dip, col.np2, 1.5, R, CX, CY, true);
  drawPTCanvas(ctx, strike, dip, rake, R, CX, CY, col);
  drawCompass(ctx, CX, CY, R, col.text3);
}

// ---------------------------------------------------------------------------
// Canvas: nodal-plane great circle
// ---------------------------------------------------------------------------
function drawNPCanvas(ctx, strike, dip, color, lw, R, CX, CY, dashed) {
  const sr = rad(strike), dr = rad(dip);
  const u = [Math.cos(sr), Math.sin(sr), 0];
  const v = [-Math.cos(dr) * Math.sin(sr), Math.cos(dr) * Math.cos(sr), Math.sin(dr)];
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = lw;
  if (dashed) ctx.setLineDash([7, 4]); else ctx.setLineDash([]);
  let moved = false, lx = 0, ly = 0;
  for (let t = 0; t <= 180; t++) {
    const a = rad(t);
    const pD = Math.cos(a) * u[2] + Math.sin(a) * v[2];
    const inc = deg(Math.acos(clamp(pD, -1, 1)));
    const az = n360(deg(Math.atan2(
      Math.cos(a) * u[1] + Math.sin(a) * v[1],
      Math.cos(a) * u[0] + Math.sin(a) * v[0]
    )));
    const [sx, sy] = lproj(az, inc, R);
    const x = CX + sx, y = CY + sy;
    const gap = moved && Math.sqrt((x - lx) ** 2 + (y - ly) ** 2) > 20;
    if (!moved || gap) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    moved = true; lx = x; ly = y;
  }
  ctx.stroke(); ctx.setLineDash([]);
}

// ---------------------------------------------------------------------------
// Canvas: P & T axis dots
// ---------------------------------------------------------------------------
function drawPTCanvas(ctx, strike, dip, rake, R, CX, CY, col) {
  const { n, l } = faultVectors(strike, dip, rake);
  const nm = v => { const m = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return v.map(x => x / m); };
  [
    [nm([n[0] - l[0], n[1] - l[1], n[2] - l[2]]), 'P', col.np2],
    [nm([n[0] + l[0], n[1] + l[1], n[2] + l[2]]), 'T', col.np1]
  ].forEach(([ax, label, c]) => {
    let [vx, vy, vz] = [...ax];
    if (vz < 0) { vx = -vx; vy = -vy; vz = -vz; }
    const inc = deg(Math.acos(clamp(vz, -1, 1)));
    const az = n360(deg(Math.atan2(vy, vx)));
    const [sx, sy] = lproj(az, inc, R);
    const x = CX + sx, y = CY + sy;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = c; ctx.fill();
    ctx.strokeStyle = col.surface; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = c; ctx.font = 'bold 11px Space Mono, monospace';
    ctx.textAlign = 'left'; ctx.fillText(label, x + 7, y + 4);
    if (Math.sqrt((x - CX) ** 2 + (y - CY) ** 2) < R - 18) {
      const trend = Math.round(n360(deg(Math.atan2(vy, vx))));
      const plunge = Math.round(deg(Math.asin(clamp(vz, -1, 1))));
      ctx.font = '500 8px IBM Plex Sans, sans-serif';
      ctx.fillStyle = col.text3;
      ctx.textAlign = 'left';
      ctx.fillText(`${trend}°/${plunge}°`, x + 7, y + 14);
    }
  });
}

// ---------------------------------------------------------------------------
// Canvas: compass rose labels
// ---------------------------------------------------------------------------
function drawCompass(ctx, CX, CY, R, color) {
  ctx.font = '600 11px IBM Plex Sans, sans-serif';
  ctx.fillStyle = color; ctx.textAlign = 'center';
  ctx.fillText('N', CX, CY - R - 8);
  ctx.fillText('S', CX, CY + R + 16);
  ctx.fillText('E', CX + R + 14, CY + 4);
  ctx.fillText('W', CX - R - 14, CY + 4);
}

// ---------------------------------------------------------------------------
// Canvas: Schmidt net
// ---------------------------------------------------------------------------
function drawStereonet(strike, dip, rake) {
  const c = document.getElementById('snc'), ctx = c.getContext('2d');
  const W = 220, H = 220, R = 100, CX = W / 2, CY = H / 2;
  const col = getColors();
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.fillStyle = col.surface; ctx.fill();
  ctx.strokeStyle = col.gridLine; ctx.lineWidth = 0.8;
  for (let az = 0; az < 360; az += 30) {
    ctx.beginPath(); let moved = false, lx = 0, ly = 0;
    for (let inc = 0; inc <= 90; inc += 2) {
      const [x, y] = lproj(az, inc, R);
      const px = CX + x, py = CY + y;
      if (!moved) { ctx.moveTo(px, py); moved = true; }
      else {
        const gap = Math.sqrt((px - lx) ** 2 + (py - ly) ** 2) > 20;
        if (gap) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      lx = px; ly = py;
    }
    ctx.stroke();
  }
  for (const rinc of [30, 60]) {
    ctx.beginPath();
    for (let az = 0; az <= 360; az++) {
      const [x, y] = lproj(az, rinc, R);
      if (az === 0) ctx.moveTo(CX + x, CY + y); else ctx.lineTo(CX + x, CY + y);
    }
    ctx.stroke();
    const [lx, ly] = lproj(90, rinc, R);
    ctx.font = '500 9px IBM Plex Sans, sans-serif';
    ctx.fillStyle = col.gridLine;
    ctx.textAlign = 'left';
    ctx.fillText(rinc + '°', CX + lx + 3, CY + ly + 3);
  }
  drawNPCanvas(ctx, strike, dip, col.np1, 2, R, CX, CY, false);
  const a2 = auxPlane(strike, dip, rake);
  drawNPCanvas(ctx, a2.strike, a2.dip, col.np2, 1.5, R, CX, CY, true);
  drawPTCanvas(ctx, strike, dip, rake, R, CX, CY, col);
  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.stroke();
  drawCompass(ctx, CX, CY, R, col.text3);
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------
function ns(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function svgArrow(svg, x1, y1, x2, y2, color, aSize, sw = 2, isHalf = false, halfSide = 1) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const ax = x2 - ux * aSize, ay = y2 - uy * aSize;
  let pts;
  if (isHalf) {
    pts = `${x2.toFixed(1)},${y2.toFixed(1)} ${(ax + px * aSize * 0.5 * halfSide).toFixed(1)},${(ay + py * aSize * 0.5 * halfSide).toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)}`;
  } else {
    pts = `${x2.toFixed(1)},${y2.toFixed(1)} ${(ax + px * aSize * 0.42).toFixed(1)},${(ay + py * aSize * 0.42).toFixed(1)} ${(ax - px * aSize * 0.42).toFixed(1)},${(ay - py * aSize * 0.42).toFixed(1)}`;
  }
  svg.appendChild(ns('line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), stroke: color, 'stroke-width': sw }));
  svg.appendChild(ns('polygon', { points: pts, fill: color }));
}

// ---------------------------------------------------------------------------
// SVG: map-view plan traces
// ---------------------------------------------------------------------------
function drawMap(svgId, strike, dip, rake, isAux) {
  const svg = document.getElementById(svgId); svg.innerHTML = '';
  const W = 260, H = 190, cx = 130, cy = 95;
  const col = getColors();
  const color = isAux ? col.np2 : col.np1;
  const gridCol = isDark() ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  for (let x = 10; x < W; x += 20) svg.appendChild(ns('line', { x1: x, y1: 0, x2: x, y2: H, stroke: gridCol, 'stroke-width': 1 }));
  for (let y = 10; y < H; y += 20) svg.appendChild(ns('line', { x1: 0, y1: y, x2: W, y2: y, stroke: gridCol, 'stroke-width': 1 }));
  // North arrow
  const nax = 20, nay = 26, naLen = 16;
  svg.appendChild(ns('line', { x1: nax, y1: nay, x2: nax, y2: nay - naLen, stroke: col.text3, 'stroke-width': 1.5 }));
  svg.appendChild(ns('polygon', { points: `${nax},${nay - naLen} ${nax - 4},${nay - naLen + 7} ${nax + 4},${nay - naLen + 7}`, fill: col.text3 }));
  const nLbl = ns('text', { x: nax, y: nay + 10, 'font-size': 10, 'font-weight': '700', fill: col.text3, 'text-anchor': 'middle', 'font-family': 'IBM Plex Sans, sans-serif' });
  nLbl.textContent = 'N'; svg.appendChild(nLbl);
  const s = rad(strike);
  const sUx = Math.sin(s), sUy = -Math.cos(s), dUx = Math.cos(s), dUy = Math.sin(s);
  const fLen = 155, x1 = cx - sUx * fLen / 2, y1 = cy - sUy * fLen / 2, x2 = cx + sUx * fLen / 2, y2 = cy + sUy * fLen / 2;
  svg.appendChild(ns('line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), stroke: color, 'stroke-width': isAux ? 2 : 2.5, 'stroke-dasharray': isAux ? '8,5' : 'none' }));
  const rn = n180(rake), ssC = Math.cos(rad(rn)), dsC = Math.sin(rad(rn));
  if (Math.abs(ssC) > 0.05) {
    const offset = 18, aLen = 15 + 15 * Math.abs(ssC), shiftX = sUx * 40, shiftY = sUy * 40;
    const baseX = cx - shiftX, baseY = cy - shiftY, barbSide = ssC > 0 ? 1 : -1;
    svgArrow(svg, baseX + dUx * offset - ssC * sUx * aLen / 2, baseY + dUy * offset - ssC * sUy * aLen / 2, baseX + dUx * offset + ssC * sUx * aLen / 2, baseY + dUy * offset + ssC * sUy * aLen / 2, color, 9, 1.8, true, barbSide);
    svgArrow(svg, baseX - dUx * offset + ssC * sUx * aLen / 2, baseY - dUy * offset + ssC * sUy * aLen / 2, baseX - dUx * offset - ssC * sUx * aLen / 2, baseY - dUy * offset - ssC * sUy * aLen / 2, color, 9, 1.8, true, barbSide);
  }
  if (Math.abs(dsC) > 0.05) {
    const reverse = dsC > 0, step = fLen / 6;
    for (let i = -2; i <= 2; i++) {
      const bx = cx + sUx * step * i, by = cy + sUy * step * i;
      if (reverse) {
        const pts = `${(bx - sUx * 5).toFixed(1)},${(by - sUy * 5).toFixed(1)} ${(bx + sUx * 5).toFixed(1)},${(by + sUy * 5).toFixed(1)} ${(bx + dUx * 10).toFixed(1)},${(by + dUy * 10).toFixed(1)}`;
        svg.appendChild(ns('polygon', { points: pts, fill: color }));
      } else {
        svg.appendChild(ns('line', { x1: bx.toFixed(1), y1: by.toFixed(1), x2: (bx + dUx * 11).toFixed(1), y2: (by + dUy * 11).toFixed(1), stroke: color, 'stroke-width': 1.5 }));
        svg.appendChild(ns('circle', { cx: (bx + dUx * 11).toFixed(1), cy: (by + dUy * 11).toFixed(1), r: 2.5, fill: color }));
      }
    }
    const ad = 24, al = 22, sc = col.text;
    if (reverse) {
      svgArrow(svg, cx + dUx * (ad + al), cy + dUy * (ad + al), cx + dUx * ad, cy + dUy * ad, sc, 8, 2);
      svgArrow(svg, cx - dUx * (ad + al), cy - dUy * (ad + al), cx - dUx * ad, cy - dUy * ad, sc, 8, 2);
    } else {
      svgArrow(svg, cx + dUx * ad, cy + dUy * ad, cx + dUx * (ad + al), cy + dUy * (ad + al), sc, 8, 2);
      svgArrow(svg, cx - dUx * ad, cy - dUy * ad, cx - dUx * (ad + al), cy - dUy * (ad + al), sc, 8, 2);
    }
  }
  // u / d hanging-wall / footwall labels
  if (Math.abs(dsC) > 0.05) {
    const isRev = dsC > 0;
    const hwLabel = isRev ? 'u' : 'd', fwLabel = isRev ? 'd' : 'u';
    const udOpts = { 'font-size': 11, 'font-weight': '700', 'font-family': 'IBM Plex Sans, sans-serif', 'text-anchor': 'middle' };
    const hwU = ns('text', { x: (cx + dUx * 30).toFixed(1), y: (cy + dUy * 30 + 4).toFixed(1), ...udOpts, fill: color, opacity: '0.75' });
    hwU.textContent = hwLabel; svg.appendChild(hwU);
    const fwU = ns('text', { x: (cx - dUx * 30).toFixed(1), y: (cy - dUy * 30 + 4).toFixed(1), ...udOpts, fill: color, opacity: '0.75' });
    fwU.textContent = fwLabel; svg.appendChild(fwU);
  }
  const tcx = cx + sUx * 42, tcy = cy + sUy * 42;
  svg.appendChild(ns('line', { x1: tcx.toFixed(1), y1: tcy.toFixed(1), x2: (tcx + dUx * 14).toFixed(1), y2: (tcy + dUy * 14).toFixed(1), stroke: color, 'stroke-width': 2, 'stroke-opacity': 0.6 }));
  const dl = ns('text', { x: (tcx + dUx * 28).toFixed(1), y: (tcy + dUy * 28 + 4).toFixed(1), 'font-size': 10, fill: color, 'text-anchor': 'middle', 'font-family': 'Space Mono, monospace', 'font-weight': '700' });
  dl.textContent = dip + '°'; svg.appendChild(dl);
}

// ---------------------------------------------------------------------------
// SVG: cross-section profile helpers
// ---------------------------------------------------------------------------
function drawInOut(g, x, y, isCross, color) {
  g.appendChild(ns('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 5.5, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
  if (isCross) {
    g.appendChild(ns('line', { x1: (x - 3.5).toFixed(1), y1: (y - 3.5).toFixed(1), x2: (x + 3.5).toFixed(1), y2: (y + 3.5).toFixed(1), stroke: color, 'stroke-width': 1.5 }));
    g.appendChild(ns('line', { x1: (x - 3.5).toFixed(1), y1: (y + 3.5).toFixed(1), x2: (x + 3.5).toFixed(1), y2: (y - 3.5).toFixed(1), stroke: color, 'stroke-width': 1.5 }));
  } else {
    g.appendChild(ns('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2, fill: color }));
  }
}

function bearingLabel(az) {
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((az % 360) + 360) % 360 / 45) % 8;
  return pts[idx];
}

// ---------------------------------------------------------------------------
// SVG: cross-section profile
// ---------------------------------------------------------------------------
function drawProfile(svgId, strike, dip, rake, isAux) {
  const svg = document.getElementById(svgId); svg.innerHTML = '';
  const col = getColors();
  const color = isAux ? col.np2 : col.np1;
  const clipId = 'clip_' + svgId;
  const defs = ns('defs', {});
  const cp = ns('clipPath', { id: clipId });
  cp.appendChild(ns('rect', { x: 20, y: 28, width: 220, height: 138, rx: 3 }));
  defs.appendChild(cp); svg.appendChild(defs);
  svg.appendChild(ns('rect', { x: 20, y: 28, width: 220, height: 138, fill: col.surface, stroke: col.border, rx: 3 }));
  svg.appendChild(ns('line', { x1: 20, y1: 28, x2: 240, y2: 28, stroke: col.border, 'stroke-width': 3 }));
  const surfLbl = ns('text', { x: 130, y: 24, 'font-size': 10, 'font-weight': '600', fill: col.text3, 'text-anchor': 'middle', 'font-family': 'IBM Plex Sans, sans-serif' });
  surfLbl.textContent = 'surface'; svg.appendChild(surfLbl);
  const g = ns('g', { 'clip-path': `url(#${clipId})` });
  const gridCol = isDark() ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  for (let x = 20; x < 240; x += 20) g.appendChild(ns('line', { x1: x, y1: 28, x2: x, y2: 166, stroke: gridCol, 'stroke-width': 1 }));
  for (let y = 28; y < 166; y += 20) g.appendChild(ns('line', { x1: 20, y1: y, x2: 240, y2: y, stroke: gridCol, 'stroke-width': 1 }));
  const cx = 40 + (dip / 90) * 90, cy = 28;
  const rdip = rad(dip), fdx = Math.cos(rdip), fdy = Math.sin(rdip), fLen = 300;
  g.appendChild(ns('line', { x1: cx.toFixed(1), y1: cy.toFixed(1), x2: (cx + fdx * fLen).toFixed(1), y2: (cy + fdy * fLen).toFixed(1), stroke: color, 'stroke-width': isAux ? 2 : 2.5, 'stroke-dasharray': isAux ? '8,5' : 'none' }));
  const midDist = Math.min(110, 60 / Math.sin(rdip));
  const mx = cx + fdx * midDist, my = cy + fdy * midDist;
  const nx = Math.sin(rdip), ny = -Math.cos(rdip);
  const hwD = 28;
  const txtOpts = { 'font-size': 10, 'font-weight': '600', fill: col.text2, 'text-anchor': 'middle', 'font-family': 'IBM Plex Sans, sans-serif', opacity: 0.5 };
  const hwT = ns('text', { x: (mx + nx * hwD).toFixed(1), y: (my + ny * hwD + 4).toFixed(1), ...txtOpts }); hwT.textContent = 'HW'; g.appendChild(hwT);
  const fwT = ns('text', { x: (mx - nx * hwD).toFixed(1), y: (my - ny * hwD + 4).toFixed(1), ...txtOpts }); fwT.textContent = 'FW'; g.appendChild(fwT);
  const rn = n180(rake), ssC = Math.cos(rad(rn)), dsC = Math.sin(rad(rn)), kD = 15;
  if (Math.abs(ssC) > 0.05) {
    drawInOut(g, mx + nx * kD - fdx * 22, my + ny * kD - fdy * 22, ssC > 0, color);
    drawInOut(g, mx - nx * kD - fdx * 22, my - ny * kD - fdy * 22, ssC <= 0, color);
  }
  if (Math.abs(dsC) > 0.05) {
    const isRev = dsC > 0, aLen = 20;
    const aDx = isRev ? -fdx : fdx, aDy = isRev ? -fdy : fdy;
    svgArrow(g, mx + nx * kD + fdx * 15 - aDx * aLen / 2, my + ny * kD + fdy * 15 - aDy * aLen / 2, mx + nx * kD + fdx * 15 + aDx * aLen / 2, my + ny * kD + fdy * 15 + aDy * aLen / 2, color, 7, 1.8);
    svgArrow(g, mx - nx * kD + fdx * 15 + aDx * aLen / 2, my - ny * kD + fdy * 15 + aDy * aLen / 2, mx - nx * kD + fdx * 15 - aDx * aLen / 2, my - ny * kD + fdy * 15 - aDy * aLen / 2, color, 7, 1.8);
  }
  const dipAnglePath = `M ${(cx + fdx * 30).toFixed(1)} ${(cy + fdy * 30).toFixed(1)} A 30 30 0 0 0 ${(cx + 30).toFixed(1)} ${cy.toFixed(1)}`;
  g.appendChild(ns('path', { d: dipAnglePath, fill: 'none', stroke: color, opacity: '0.5', 'stroke-width': 1 }));
  const dipMidAngle = rdip / 2;
  const dipTxt = ns('text', { x: (cx + 42 * Math.cos(dipMidAngle)).toFixed(1), y: (cy + 42 * Math.sin(dipMidAngle) + 4).toFixed(1), 'font-size': 10, fill: color, 'text-anchor': 'middle', 'font-family': 'Space Mono, monospace', 'font-weight': '700' });
  dipTxt.textContent = dip + '°'; g.appendChild(dipTxt);
  svg.appendChild(g);
  // Compass direction labels on section walls
  const dipAz = n360(strike + 90);
  const oppAz = n360(strike + 270);
  const lblLeft = bearingLabel(oppAz);
  const lblRight = bearingLabel(dipAz);
  const dirOpts = { 'font-size': 10, 'font-weight': '700', fill: col.text3, 'font-family': 'IBM Plex Sans, sans-serif' };
  const lx = 18, ly = 97;
  svg.appendChild(ns('line', { x1: lx, y1: ly, x2: lx, y2: ly - 12, stroke: col.text3, 'stroke-width': 1.5 }));
  svg.appendChild(ns('polygon', { points: `${lx},${ly - 12} ${lx - 3},${ly - 5} ${lx + 3},${ly - 5}`, fill: col.text3 }));
  const lLbl = ns('text', { x: lx, y: ly + 10, ...dirOpts, 'text-anchor': 'middle' });
  lLbl.textContent = lblLeft; svg.appendChild(lLbl);
  const rx = 242, ry = 97;
  svg.appendChild(ns('line', { x1: rx, y1: ry, x2: rx, y2: ry - 12, stroke: col.text3, 'stroke-width': 1.5 }));
  svg.appendChild(ns('polygon', { points: `${rx},${ry - 12} ${rx - 3},${ry - 5} ${rx + 3},${ry - 5}`, fill: col.text3 }));
  const rLbl = ns('text', { x: rx, y: ry + 10, ...dirOpts, 'text-anchor': 'middle' });
  rLbl.textContent = lblRight; svg.appendChild(rLbl);
}

// ---------------------------------------------------------------------------
// Axis trend/plunge string for sidebar readout
// ---------------------------------------------------------------------------
function axisStr(strike, dip, rake, which) {
  const { n, l } = faultVectors(strike, dip, rake);
  const nm = v => { const m = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return v.map(x => x / m); };
  const P = nm([n[0] - l[0], n[1] - l[1], n[2] - l[2]]);
  const T = nm([n[0] + l[0], n[1] + l[1], n[2] + l[2]]);
  let [vx, vy, vz] = [...(which === 'P' ? P : T)];
  if (vz < 0) { vx = -vx; vy = -vy; vz = -vz; }
  const plunge = Math.round(deg(Math.asin(clamp(vz, -1, 1))));
  const trend = Math.round(n360(deg(Math.atan2(vy, vx))));
  return `${trend}° trend / ${plunge}° plunge`;
}

// ---------------------------------------------------------------------------
// Input sync helpers
// ---------------------------------------------------------------------------
function syncVal(el, sliderId, min, max) {
  let val = parseInt(el.textContent.replace(/[^\d-]/g, ''), 10);
  const slider = document.getElementById(sliderId);
  if (isNaN(val)) val = parseInt(slider.value, 10);
  else val = clamp(val, min, max);
  slider.value = val;
  update();
}

function checkEnter(e, el) {
  if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
}

// ---------------------------------------------------------------------------
// Master update — called on every input change
// ---------------------------------------------------------------------------
function update() {
  const s = +document.getElementById('strike').value;
  const d = +document.getElementById('dip').value;
  const r = +document.getElementById('rake').value;
  document.getElementById('sv').textContent = s + '°';
  document.getElementById('dv').textContent = d + '°';
  document.getElementById('rv').textContent = r + '°';
  const cls = classify(r);
  document.getElementById('ft-main').textContent = cls.main;
  document.getElementById('ft-sub').textContent = cls.sub;
  const a2 = auxPlane(s, d, r);
  document.getElementById('np1-data').textContent = `${s}° / ${d}° / ${r}°`;
  document.getElementById('np2-data').textContent = `${a2.strike}° / ${a2.dip}° / ${a2.rake}°`;
  document.getElementById('p-axis').textContent = axisStr(s, d, r, 'P');
  document.getElementById('t-axis').textContent = axisStr(s, d, r, 'T');
  document.getElementById('m1l').textContent = `S${s}° D${d}° R${r}°`;
  document.getElementById('m2l').textContent = `S${a2.strike}° D${a2.dip}° R${a2.rake}°`;
  const cls2 = classify(a2.rake);
  const b1 = document.getElementById('m1b'), b2 = document.getElementById('m2b');
  b1.textContent = cls.sense; b1.className = 'badge ' + badgeCls(cls.cls);
  b2.textContent = cls2.sense; b2.className = 'badge ' + badgeCls(cls2.cls);
  const b3 = document.getElementById('p1b'), b4 = document.getElementById('p2b');
  b3.textContent = d + '° dip'; b4.textContent = a2.dip + '° dip';
  document.getElementById('hd-regime').textContent = cls.main + ' — ' + cls.sub;
  document.getElementById('hd-params').textContent = `φ ${s}°  δ ${d}°  λ ${r}°`;
  drawBB(s, d, r);
  drawStereonet(s, d, r);
  drawMap('m1s', s, d, r, false);
  drawMap('m2s', a2.strike, a2.dip, a2.rake, true);
  drawProfile('p1s', s, d, r, false);
  drawProfile('p2s', a2.strike, a2.dip, a2.rake, true);
}

// ---------------------------------------------------------------------------
// Preset loader (called from HTML onclick)
// ---------------------------------------------------------------------------
function setPreset(s, d, r) {
  document.getElementById('strike').value = s;
  document.getElementById('dip').value = d;
  document.getElementById('rake').value = r;
  update();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
update();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', update);
