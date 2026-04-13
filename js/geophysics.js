// geophysics.js — Domain-specific structural geology mathematics (no DOM interaction)

import { rad, deg, n360, n180, clamp } from './utils.js';

export function faultVectors(strike, dip, rake) {
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

export function vec2sdr(n, l) {
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
  return {
    strike: Math.round(sd),
    dip: Math.round(dip),
    rake: Math.round(n180(deg(Math.atan2(ds, ss))))
  };
}

export function auxPlane(s, d, r) {
  const { n, l } = faultVectors(s, d, r);
  return vec2sdr(l, n);
}

export function lproj(az_deg, inc_deg, R = 100) {
  const a = rad(az_deg), i = rad(inc_deg);
  const r = R * Math.SQRT2 * Math.sin(i / 2);
  return [r * Math.sin(a), -r * Math.cos(a)];
}

export function classify(rake) {
  const r = n180(rake);
  const a = Math.abs(r);
  if (a <= 20 || a >= 160) {
    const isLL = a <= 20;
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

export function axisStr(strike, dip, rake, which) {
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

export function bearingLabel(az) {
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((az % 360) + 360) % 360 / 45) % 8;
  return pts[idx];
}
