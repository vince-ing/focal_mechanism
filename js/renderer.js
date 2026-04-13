// renderer.js — Canvas and SVG drawing execution (no direct DOM state queries)

import { rad, deg, n360, n180, clamp, hexToRgb, ns, getCSSVar } from './utils.js';
import { faultVectors, auxPlane, lproj, bearingLabel } from './geophysics.js';

function isDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getColors() {
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

export function drawBB(canvasId, strike, dip, rake) {
  const c = document.getElementById(canvasId);
  const ctx = c.getContext('2d');
  const W = 220, H = 220, R = 100, CX = W / 2, CY = H / 2;
  const col = getColors();

  // 1. High-DPI Scaling for crisp lines/text on modern screens
  const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr;
  c.height = H * dpr;
  c.style.width = W + 'px';
  c.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, W, H);
  const { n, l } = faultVectors(strike, dip, rake);

  // 2. Supersampling via a high-res offscreen canvas
  const scale = 2; // 2x resolution for smooth edges
  const oW = W * scale, oH = H * scale, oR = R * scale, oCX = oW / 2, oCY = oH / 2;
  const offC = document.createElement('canvas');
  offC.width = oW;
  offC.height = oH;
  const offCtx = offC.getContext('2d');
  const img = offCtx.createImageData(oW, oH);

  // Optimization: Parse colors once instead of every pixel
  const rgbComp = hexToRgb(col.compress);
  const rgbDilate = hexToRgb(col.dilate);

  for (let py = 0; py < oH; py++) {
    for (let px = 0; px < oW; px++) {
      const x = px - oCX, y = py - oCY;
      if (x * x + y * y > oR * oR) continue;
      
      const rr = Math.sqrt(x * x + y * y) / oR;
      const inc = 2 * Math.asin(clamp(rr / Math.SQRT2, -1, 1));
      const az = Math.atan2(x, -y);
      const vN = Math.sin(inc) * Math.cos(az), vE = Math.sin(inc) * Math.sin(az), vD = Math.cos(inc);
      
      const comp = (n[0] * vN + n[1] * vE + n[2] * vD) * (l[0] * vN + l[1] * vE + l[2] * vD) >= 0;
      const idx = (py * oW + px) * 4;
      const rgb = comp ? rgbComp : rgbDilate;
      
      img.data[idx] = rgb[0]; 
      img.data[idx + 1] = rgb[1]; 
      img.data[idx + 2] = rgb[2]; 
      img.data[idx + 3] = 255;
    }
  }
  offCtx.putImageData(img, 0, 0);

  // Draw the high-res image down to the standard canvas (handles anti-aliasing natively)
  ctx.drawImage(offC, 0, 0, W, H);

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

export function drawNPCanvas(ctx, strike, dip, color, lw, R, CX, CY, dashed) {
  const sr = rad(strike), dr = rad(dip);
  const u = [Math.cos(sr), Math.sin(sr), 0];
  const v = [-Math.cos(dr) * Math.sin(sr), Math.cos(dr) * Math.cos(sr), Math.sin(dr)];
  
  ctx.beginPath(); 
  let moved = false, lx = 0, ly = 0;
  for (let t = 0; t <= 180; t++) {
    const a = rad(t);
    const pD = Math.cos(a) * u[2] + Math.sin(a) * v[2];
    const inc = deg(Math.acos(clamp(pD, -1, 1)));
    const az = n360(deg(Math.atan2(Math.cos(a) * u[1] + Math.sin(a) * v[1], Math.cos(a) * u[0] + Math.sin(a) * v[0])));
    const [sx, sy] = lproj(az, inc, R);
    const x = CX + sx, y = CY + sy;
    const gap = moved && Math.sqrt((x - lx) ** 2 + (y - ly) ** 2) > 20;
    if (!moved || gap) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    moved = true; lx = x; ly = y;
  }

  if (dashed) {
    ctx.setLineDash([7, 4]); 
    ctx.lineWidth = lw + 0.5; // Slightly bolder line
  } else {
    ctx.setLineDash([]);
    ctx.lineWidth = lw;
  }

  ctx.strokeStyle = color;
  ctx.stroke(); 
  ctx.setLineDash([]);
}

export function drawPTCanvas(ctx, strike, dip, rake, R, CX, CY, col) {
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
    
    // Dynamically align text so it never clips off the canvas
    const isRightSide = x > CX;
    const xOffset = isRightSide ? -8 : 8;
    ctx.textAlign = isRightSide ? 'right' : 'left';

    ctx.fillStyle = c; ctx.font = 'bold 11px Space Mono, monospace';
    ctx.fillText(label, x + xOffset, y + 4);
    
    if (Math.sqrt((x - CX) ** 2 + (y - CY) ** 2) < R - 18) {
      const trend = Math.round(n360(deg(Math.atan2(vy, vx))));
      const plunge = Math.round(deg(Math.asin(clamp(vz, -1, 1))));
      ctx.font = '500 8px IBM Plex Sans, sans-serif';
      ctx.fillStyle = col.text3;
      ctx.fillText(`${trend}°/${plunge}°`, x + xOffset, y + 14);
    }
  });
}

export function drawCompass(ctx, CX, CY, R, color) {
  ctx.font = '600 11px IBM Plex Sans, sans-serif';
  ctx.fillStyle = color; ctx.textAlign = 'center';
  ctx.fillText('N', CX, CY - R - 8);
  ctx.fillText('S', CX, CY + R + 16);
  ctx.fillText('E', CX + R + 14, CY + 4);
  ctx.fillText('W', CX - R - 14, CY + 4);
}

export function drawStereonet(canvasId, strike, dip, rake) {
  const c = document.getElementById(canvasId);
  const ctx = c.getContext('2d');
  const W = 220, H = 220, R = 100, CX = W / 2, CY = H / 2;
  const col = getColors();

  // High-DPI Scaling required here too to keep both canvases matching in sharpness
  const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr;
  c.height = H * dpr;
  c.style.width = W + 'px';
  c.style.height = H + 'px';
  ctx.scale(dpr, dpr);

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
      else { const gap = Math.sqrt((px - lx) ** 2 + (py - ly) ** 2) > 20; if (gap) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
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

export function svgArrow(svg, x1, y1, x2, y2, color, aSize, sw = 2, isHalf = false, halfSide = 1, drawShaft = true) {
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
  
  if (drawShaft) {
    svg.appendChild(ns('line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), stroke: color, 'stroke-width': sw }));
  }
  svg.appendChild(ns('polygon', { points: pts, fill: color }));
}

export function drawMap(svgId, strike, dip, rake, isAux, colors) {
  const svg = document.getElementById(svgId);
  svg.innerHTML = '';
  const W = 260, H = 190, cx = 130, cy = 95;
  const col = colors || getColors();
  const color = isAux ? col.np2 : col.np1;
  const gridCol = isDark() ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  
  for (let x = 10; x < W; x += 20) svg.appendChild(ns('line', { x1: x, y1: 0, x2: x, y2: H, stroke: gridCol, 'stroke-width': 1 }));
  for (let y = 10; y < H; y += 20) svg.appendChild(ns('line', { x1: 0, y1: y, x2: W, y2: y, stroke: gridCol, 'stroke-width': 1 }));
  
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
    // By setting the base length to 9 (the exact size of the arrowhead), 
    // the stem smoothly shrinks to 0 before disappearing completely.
    const offset = 18, aLen = 9 + 21 * Math.abs(ssC), shiftX = sUx * 40, shiftY = sUy * 40;
    const baseX = cx - shiftX, baseY = cy - shiftY, barbSide = ssC > 0 ? 1 : -1;
    const ssDir = Math.sign(ssC); 

    svgArrow(svg, 
      baseX + dUx * offset - ssDir * sUx * aLen / 2, 
      baseY + dUy * offset - ssDir * sUy * aLen / 2, 
      baseX + dUx * offset + ssDir * sUx * aLen / 2, 
      baseY + dUy * offset + ssDir * sUy * aLen / 2, 
      color, 9, 1.8, true, barbSide
    );
    svgArrow(svg, 
      baseX - dUx * offset + ssDir * sUx * aLen / 2, 
      baseY - dUy * offset + ssDir * sUy * aLen / 2, 
      baseX - dUx * offset - ssDir * sUx * aLen / 2, 
      baseY - dUy * offset - ssDir * sUy * aLen / 2, 
      color, 9, 1.8, true, barbSide
    );
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
  
  if (Math.abs(dsC) > 0.05) {
    const isRev = dsC > 0;
    const hwLabel = isRev ? 'u' : 'd', fwLabel = isRev ? 'd' : 'u';
    const udOpts = { 'font-size': 11, 'font-weight': '700', 'font-family': 'IBM Plex Sans, sans-serif', 'text-anchor': 'middle' };
    
    // Evaluate if the strike is pointing top or bottom, and slide labels "upward"
    const slideDir = sUy <= 0 ? 1 : -1;
    const slideDist = 62 * slideDir; 
    const labelOffset = 26; 
    
    const hwU = ns('text', { 
      x: (cx + sUx * slideDist + dUx * labelOffset).toFixed(1), 
      y: (cy + sUy * slideDist + dUy * labelOffset + 4).toFixed(1), 
      ...udOpts, fill: color, opacity: '0.75' 
    });
    hwU.textContent = hwLabel; 
    svg.appendChild(hwU);
    
    const fwU = ns('text', { 
      x: (cx + sUx * slideDist - dUx * labelOffset).toFixed(1), 
      y: (cy + sUy * slideDist - dUy * labelOffset + 4).toFixed(1), 
      ...udOpts, fill: color, opacity: '0.75' 
    });
    fwU.textContent = fwLabel; 
    svg.appendChild(fwU);
  }
  
  const tcx = cx + sUx * 42, tcy = cy + sUy * 42;
  svg.appendChild(ns('line', { x1: tcx.toFixed(1), y1: tcy.toFixed(1), x2: (tcx + dUx * 14).toFixed(1), y2: (tcy + dUy * 14).toFixed(1), stroke: color, 'stroke-width': 2, 'stroke-opacity': 0.6 }));
  const dl = ns('text', { x: (tcx + dUx * 28).toFixed(1), y: (tcy + dUy * 28 + 4).toFixed(1), 'font-size': 10, fill: color, 'text-anchor': 'middle', 'font-family': 'Space Mono, monospace', 'font-weight': '700' });
  dl.textContent = dip + '°'; 
  svg.appendChild(dl);
}

export function drawInOut(g, x, y, isCross, color) {
  g.appendChild(ns('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 5.5, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
  if (isCross) {
    g.appendChild(ns('line', { x1: (x - 3.5).toFixed(1), y1: (y - 3.5).toFixed(1), x2: (x + 3.5).toFixed(1), y2: (y + 3.5).toFixed(1), stroke: color, 'stroke-width': 1.5 }));
    g.appendChild(ns('line', { x1: (x - 3.5).toFixed(1), y1: (y + 3.5).toFixed(1), x2: (x + 3.5).toFixed(1), y2: (y - 3.5).toFixed(1), stroke: color, 'stroke-width': 1.5 }));
  } else {
    g.appendChild(ns('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2, fill: color }));
  }
}

export function drawProfile(svgId, strike, dip, rake, isAux, colors) {
  const svg = document.getElementById(svgId);
  svg.innerHTML = '';
  
  // Dynamically expand the viewBox horizontally so centered text doesn't clip on the edges
  svg.setAttribute('viewBox', '-15 0 290 190');
  svg.style.overflow = 'visible'; 

  const col = colors || getColors();
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
  
  const nx = Math.sin(rdip), ny = -Math.cos(rdip);
  const rn = n180(rake), ssC = Math.cos(rad(rn)), dsC = Math.sin(rad(rn));
  const hasSS = Math.abs(ssC) > 0.05;
  const hasDS = Math.abs(dsC) > 0.05;
  
  const tSS = (hasSS && hasDS) ? 60 : 85;
  const tDS = (hasSS && hasDS) ? 95 : 85;
  const tLbl = 125;
  const kD = 14;
  
  if (hasSS) {
    const ssX = cx + fdx * tSS, ssY = cy + fdy * tSS;
    drawInOut(g, ssX + nx * kD, ssY + ny * kD, ssC > 0, color);
    drawInOut(g, ssX - nx * kD, ssY - ny * kD, ssC <= 0, color);
  }
  
  if (hasDS) {
    const dsX = cx + fdx * tDS, dsY = cy + fdy * tDS;
    const isRev = dsC > 0, aLen = 22;
    const aDx = isRev ? -fdx : fdx, aDy = isRev ? -fdy : fdy;
    svgArrow(g,
      dsX + nx * kD - aDx * aLen / 2, dsY + ny * kD - aDy * aLen / 2,
      dsX + nx * kD + aDx * aLen / 2, dsY + ny * kD + aDy * aLen / 2,
      color, 7, 1.8
    );
    svgArrow(g,
      dsX - nx * kD + aDx * aLen / 2, dsY - ny * kD + aDy * aLen / 2,
      dsX - nx * kD - aDx * aLen / 2, dsY - ny * kD - aDy * aLen / 2,
      color, 7, 1.8
    );
  }
  
  const lxHW = cx + fdx * tLbl, lyHW = cy + fdy * tLbl;
  const hwTxtD = 22;
  const txtOpts = { 'font-size': 10, 'font-weight': '600', fill: col.text2, 'text-anchor': 'middle', 'font-family': 'IBM Plex Sans, sans-serif', opacity: 0.5 };
  const hwT = ns('text', { x: (lxHW + nx * hwTxtD).toFixed(1), y: (lyHW + ny * hwTxtD + 4).toFixed(1), ...txtOpts }); hwT.textContent = 'HW'; g.appendChild(hwT);
  const fwT = ns('text', { x: (lxHW - nx * hwTxtD).toFixed(1), y: (lyHW - ny * hwTxtD + 4).toFixed(1), ...txtOpts }); fwT.textContent = 'FW'; g.appendChild(fwT);
  
  const dipAnglePath = `M ${(cx + fdx * 30).toFixed(1)} ${(cy + fdy * 30).toFixed(1)} A 30 30 0 0 0 ${(cx + 30).toFixed(1)} ${cy.toFixed(1)}`;
  g.appendChild(ns('path', { d: dipAnglePath, fill: 'none', stroke: color, opacity: '0.4', 'stroke-width': 1, 'stroke-dasharray': '2,2' }));
  const dipMidAngle = rdip / 2;
  const dipTxt = ns('text', { x: (cx + 40 * Math.cos(dipMidAngle)).toFixed(1), y: (cy + 40 * Math.sin(dipMidAngle) + 4).toFixed(1), 'font-size': 10, fill: color, 'text-anchor': 'middle', 'font-family': 'Space Mono, monospace', 'font-weight': '700' });
  dipTxt.textContent = dip + '°'; g.appendChild(dipTxt);
  svg.appendChild(g);
  
  const dipAz = ((strike + 90) % 360 + 360) % 360;
  const oppAz = ((strike + 270) % 360 + 360) % 360;
  const lblLeft = bearingLabel(oppAz);
  const lblRight = bearingLabel(dipAz);
  
  const dirOpts = { 'font-size': 13, 'font-weight': '700', fill: col.text3, 'font-family': 'IBM Plex Sans, sans-serif' };
  
  // Left side: Calculate tip and tail from center 'lx' so text is perfectly centered under arrow
  const lx = 5, ly = 97, lay = ly - 6;
  const lTip = lx - 7, lTail = lx + 7;
  svg.appendChild(ns('line', { x1: lTail, y1: lay, x2: lTip, y2: lay, stroke: col.text3, 'stroke-width': 2 }));
  svg.appendChild(ns('polygon', { points: `${lTip},${lay} ${lTip+7},${lay - 4.5} ${lTip+7},${lay + 4.5}`, fill: col.text3 }));
  const lLbl = ns('text', { x: lx, y: ly + 13, ...dirOpts, 'text-anchor': 'middle' });
  lLbl.textContent = lblLeft; svg.appendChild(lLbl);
  
  // Right side: Calculate tip and tail from center 'rx' so text is perfectly centered under arrow
  const rx = 255, ry = 97, ray = ry - 6;
  const rTip = rx + 7, rTail = rx - 7;
  svg.appendChild(ns('line', { x1: rTail, y1: ray, x2: rTip, y2: ray, stroke: col.text3, 'stroke-width': 2 }));
  svg.appendChild(ns('polygon', { points: `${rTip},${ray} ${rTip-7},${ray - 4.5} ${rTip-7},${ray + 4.5}`, fill: col.text3 }));
  const rLbl = ns('text', { x: rx, y: ry + 13, ...dirOpts, 'text-anchor': 'middle' });
  rLbl.textContent = lblRight; svg.appendChild(rLbl);
}