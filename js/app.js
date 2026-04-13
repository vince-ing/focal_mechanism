// app.js — Controller, state management, and event bindings

import { clamp, n180 } from './utils.js';
import { classify, auxPlane, axisStr } from './geophysics.js';
import { drawBB, drawStereonet, drawMap, drawProfile } from './renderer.js';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  strike: 0,
  dip: 90,
  rake: 180,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const el = id => document.getElementById(id);

// ─── Badge class helper ───────────────────────────────────────────────────────

function badgeCls(cls) {
  return { ss: 'b-ss', nm: 'b-nm', rv: 'b-rv', ob: 'b-ob' }[cls] || 'b-ob';
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

  // Render visuals
  drawBB('bbc', s, d, r);
  drawStereonet('snc', s, d, r);
  drawMap('m1s', s, d, r, false);
  drawMap('m2s', a2.strike, a2.dip, a2.rake, true);
  drawProfile('p1s', s, d, r, false);
  drawProfile('p2s', a2.strike, a2.dip, a2.rake, true);
}

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
