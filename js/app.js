// app.js — Controller, state management, and event bindings

import { clamp, n180 } from './utils.js';
import { classify, auxPlane, axisStr } from './geophysics.js';
import { drawBB, drawStereonet, drawMap, drawProfile } from './renderer.js';
import { draw3DBlock, stop3DLoop } from './renderer3d.js';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  strike: 0,
  dip: 90,
  rake: 180,
  viewMode: '2d',  // '2d' | '3d'
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const el = id => document.getElementById(id);

// ─── Badge class helper ───────────────────────────────────────────────────────

function badgeCls(cls) {
  return { ss: 'b-ss', nm: 'b-nm', rv: 'b-rv', ob: 'b-ob' }[cls] || 'b-ob';
}

// ─── View mode switching ──────────────────────────────────────────────────────

function setViewMode(mode) {
  state.viewMode = mode;

  const is3d = mode === '3d';

  // Toggle visibility of SVG vs canvas elements
  document.querySelectorAll('.profile-2d').forEach(el => {
    el.style.display = is3d ? 'none' : '';
  });
  document.querySelectorAll('.profile-3d').forEach(el => {
    el.style.display = is3d ? 'block' : 'none';
  });

  // Toggle hint text and card tag
  el('hint-3d').style.display = is3d ? 'flex' : 'none';
  el('profile-card-tag').textContent = is3d ? 'Block diagram · drag to orbit' : 'Perpendicular to strike';

  // Update toggle button states
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Stop 3D loops if switching back to 2D
  if (!is3d) {
    stop3DLoop('p1c');
    stop3DLoop('p2c');
  }

  update();
}

// ─── Core update pipeline ─────────────────────────────────────────────────────

function update() {
  const s = state.strike;
  const d = state.dip;
  const r = state.rake;

  // Sync value displays
  el('sv').textContent = s + '°';
  el('dv').textContent = d + '°';
  el('rv').textContent = r + '°';

  // Sync sliders
  el('strike').value = s;
  el('dip').value = d;
  el('rake').value = r;

  // Regime classification
  const cls = classify(r);
  el('ft-main').textContent = cls.main;
  el('ft-sub').textContent = cls.sub;

  // Nodal plane data
  const a2 = auxPlane(s, d, r);
  el('np1-data').textContent = `${s}° / ${d}° / ${r}°`;
  el('np2-data').textContent = `${a2.strike}° / ${a2.dip}° / ${a2.rake}°`;

  // Principal axes
  el('p-axis').textContent = axisStr(s, d, r, 'P');
  el('t-axis').textContent = axisStr(s, d, r, 'T');

  // Map labels
  el('m1l').textContent = `S${s}° D${d}° R${r}°`;
  el('m2l').textContent = `S${a2.strike}° D${a2.dip}° R${a2.rake}°`;

  // Map badges
  const cls2 = classify(a2.rake);
  const b1 = el('m1b'), b2 = el('m2b');
  b1.textContent = cls.sense;  b1.className = 'badge ' + badgeCls(cls.cls);
  b2.textContent = cls2.sense; b2.className = 'badge ' + badgeCls(cls2.cls);

  // Profile badges
  el('p1b').textContent = d + '° dip';
  el('p2b').textContent = a2.dip + '° dip';

  // Header
  el('hd-regime').textContent = cls.main + ' — ' + cls.sub;
  el('hd-params').textContent = `φ ${s}°  δ ${d}°  λ ${r}°`;

  // Always render 2D views
  drawBB('bbc', s, d, r);
  drawStereonet('snc', s, d, r);
  drawMap('m1s', s, d, r, false);
  drawMap('m2s', a2.strike, a2.dip, a2.rake, true);

  if (state.viewMode === '2d') {
    drawProfile('p1s', s, d, r, false);
    drawProfile('p2s', a2.strike, a2.dip, a2.rake, true);
  } else {
    // 3D block diagrams — async but fire-and-forget
    draw3DBlock('p1c', s, d, r, false);
    draw3DBlock('p2c', a2.strike, a2.dip, a2.rake, true);
  }
}

// ─── View toggle button clicks ────────────────────────────────────────────────

el('view-toggle').addEventListener('click', e => {
  const btn = e.target.closest('.view-btn');
  if (!btn) return;
  const mode = btn.dataset.mode;
  if (mode !== state.viewMode) setViewMode(mode);
});

// ─── Slider inputs ────────────────────────────────────────────────────────────

el('strike').addEventListener('input', e => {
  state.strike = +e.target.value;
  update();
});

el('dip').addEventListener('input', e => {
  state.dip = +e.target.value;
  update();
});

el('rake').addEventListener('input', e => {
  state.rake = +e.target.value;
  update();
});

// ─── Contenteditable value spans ──────────────────────────────────────────────

function syncVal(spanId, stateKey, sliderId, min, max) {
  const span = el(spanId);
  span.addEventListener('blur', () => {
    let val = parseInt(span.textContent.replace(/[^\d-]/g, ''), 10);
    if (isNaN(val)) val = state[stateKey];
    else val = clamp(val, min, max);
    state[stateKey] = val;
    update();
  });
  span.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
  });
}

syncVal('sv', 'strike', 'strike', 0, 360);
syncVal('dv', 'dip',    'dip',    1, 89);
syncVal('rv', 'rake',   'rake',  -180, 180);

// ─── Preset buttons (event delegation) ────────────────────────────────────────

document.querySelector('.presets').addEventListener('click', e => {
  const btn = e.target.closest('[data-strike]');
  if (!btn) return;
  state.strike = +btn.dataset.strike;
  state.dip    = +btn.dataset.dip;
  state.rake   = +btn.dataset.rake;
  update();
});

// ─── Theme sync ───────────────────────────────────────────────────────────────

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', update);

// ─── Initial render ───────────────────────────────────────────────────────────

update();