// utils.js — Generic math and DOM helpers (pure functions, no app state)

export const DEG = Math.PI / 180;
export const rad = d => d * DEG;
export const deg = r => r / DEG;
export const n360 = a => ((a % 360) + 360) % 360;
export const n180 = a => { a = n360(a); return a >= 180 ? a - 360 : a; };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

export function ns(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

export function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
