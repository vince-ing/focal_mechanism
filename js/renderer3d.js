// renderer3d.js — Three.js 3D block diagram renderer for fault kinematics
//
// COORDINATE SYSTEM:
// geophysics.js uses geological NED: X=North, Y=East, Z=Down
// Three.js uses Y=Up right-handed.
// Transform: threeX = geoEast, threeY = -geoDown, threeZ = -geoNorth

import { rad, getCSSVar } from './utils.js';
import { faultVectors } from './geophysics.js';

let THREE = null;
async function getThree() {
  if (THREE) return THREE;
  THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  return THREE;
}

const scenes = {};
function getScene(id) {
  if (!scenes[id]) scenes[id] = {};
  return scenes[id];
}

function isDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function nedToThree(T, N, E, D) {
  return new T.Vector3(E, -D, -N);
}

function getFaultVectorsThree(T, strike, dip, rake) {
  const { n, l } = faultVectors(strike, dip, rake);
  const normal = nedToThree(T, n[0], n[1], n[2]).normalize();
  const slip   = nedToThree(T, l[0], l[1], l[2]).normalize();
  return { normal, slip };
}

// ─── Build two half-blocks ────────────────────────────────────────────────────
function buildBlocks(T, strike, dip) {
  const { normal: n } = getFaultVectorsThree(T, strike, dip, 0);

  const BX = 1.0, BY = 0.75, BZ = 1.0;
  const corners = [];
  for (let i = 0; i < 8; i++) {
    corners.push(new T.Vector3(
      i & 1 ? BX : -BX,
      i & 2 ? BY : -BY,
      i & 4 ? BZ : -BZ,
    ));
  }

  const side = corners.map(p => p.dot(n));
  const hwCorners = corners.filter((_, i) => side[i] >  0.0001);
  const fwCorners = corners.filter((_, i) => side[i] < -0.0001);

  const edgePairs = [
    [0,1],[2,3],[4,5],[6,7],
    [0,2],[1,3],[4,6],[5,7],
    [0,4],[1,5],[2,6],[3,7],
  ];
  const crossings = [];
  for (const [a, b] of edgePairs) {
    const sa = side[a], sb = side[b];
    if (Math.sign(sa) !== Math.sign(sb) && sa !== 0 && sb !== 0) {
      const t = sa / (sa - sb);
      crossings.push(new T.Vector3().lerpVectors(corners[a], corners[b], t));
    }
  }

  return {
    hw: convexHullGeometry(T, [...hwCorners, ...crossings]),
    fw: convexHullGeometry(T, [...fwCorners, ...crossings]),
    faultNormal: n,
    crossings,
    BX, BY, BZ,
  };
}

function convexHullGeometry(T, points) {
  if (points.length < 3) return new T.BufferGeometry();
  const faceNormals = [
    new T.Vector3( 1,0,0), new T.Vector3(-1,0,0),
    new T.Vector3(0, 1,0), new T.Vector3(0,-1,0),
    new T.Vector3(0,0, 1), new T.Vector3(0,0,-1),
  ];
  const positions = [];
  for (const fn of faceNormals) {
    const projs   = points.map(p => p.dot(fn));
    const maxP    = Math.max(...projs);
    const facePts = points.filter((_, i) => projs[i] > maxP - 0.002);
    if (facePts.length < 3) continue;
    const center = new T.Vector3();
    facePts.forEach(p => center.add(p));
    center.divideScalar(facePts.length);
    const up    = Math.abs(fn.y) < 0.9 ? new T.Vector3(0,1,0) : new T.Vector3(1,0,0);
    const right = new T.Vector3().crossVectors(fn, up).normalize();
    const fup   = new T.Vector3().crossVectors(right, fn).normalize();
    const sorted = facePts.slice().sort((a, b) => {
      const da = a.clone().sub(center), db = b.clone().sub(center);
      return Math.atan2(da.dot(fup), da.dot(right)) - Math.atan2(db.dot(fup), db.dot(right));
    });
    for (let i = 1; i < sorted.length - 1; i++) {
      positions.push(sorted[0].x, sorted[0].y, sorted[0].z);
      positions.push(sorted[i].x, sorted[i].y, sorted[i].z);
      positions.push(sorted[i+1].x, sorted[i+1].y, sorted[i+1].z);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function sortPolygon(T, points, normal) {
  if (points.length < 3) return points;
  const c = new T.Vector3();
  points.forEach(p => c.add(p));
  c.divideScalar(points.length);
  const n     = normal.clone().normalize();
  const up    = Math.abs(n.y) < 0.9 ? new T.Vector3(0,1,0) : new T.Vector3(1,0,0);
  const right = new T.Vector3().crossVectors(n, up).normalize();
  const fup   = new T.Vector3().crossVectors(right, n).normalize();
  return points.slice().sort((a, b) => {
    const da = a.clone().sub(c), db = b.clone().sub(c);
    return Math.atan2(da.dot(fup), da.dot(right)) - Math.atan2(db.dot(fup), db.dot(right));
  });
}

// ─── Disposal ────────────────────────────────────────────────────────────────
function taggedAdd(scene, obj) {
  obj.userData.disposable = true;
  obj.traverse(child => { child.userData.disposable = true; });
  scene.add(obj);
}

function disposeObjects(st) {
  if (!st.scene) return;
  const toRemove = [];
  st.scene.traverse(obj => {
    if (obj.userData.disposable) toRemove.push(obj);
  });
  for (const obj of toRemove) {
    if (obj.parent === st.scene) {
      st.scene.remove(obj);
    }
    obj.geometry?.dispose();
    if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
    else obj.material?.dispose();
  }
}

// ─── Find the centroid of a block face identified by an outward normal ────────
// Returns the average position of all geometry vertices whose face normal
// best matches `faceDir`, clamped to lie on that face's bounding plane.
function getFaceCentroid(T, geo, faceDir) {
  const pos = geo.attributes.position;
  const fd  = faceDir.clone().normalize();
  let best = -Infinity;
  // Find the extreme projection value in faceDir
  for (let i = 0; i < pos.count; i++) {
    const v = new T.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const d = v.dot(fd);
    if (d > best) best = d;
  }
  // Collect vertices on that face
  const onFace = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new T.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (v.dot(fd) > best - 0.01) onFace.push(v);
  }
  if (!onFace.length) return new T.Vector3();
  const c = new T.Vector3();
  onFace.forEach(v => c.add(v));
  c.divideScalar(onFace.length);
  return c;
}

// ─── Place a motion arrow on a visible face of a block ───────────────────────
// blockGeo  — BufferGeometry of that block (in local space, before offset)
// blockPos  — the world-space offset Vector3
// faceDir   — outward face normal to place the arrow on (world space)
// arrowDir  — direction the arrow should point (the slip component projected onto face)
// color     — THREE.Color
// st.scene  — scene to add into
function addFaceArrow(T, st, blockGeo, blockPos, faceDir, arrowDir, color) {
  const arrowLen  = 0.55;
  const arrowHead = 0.16;
  const arrowW    = 0.07;

  // Get face centroid in local block space, then shift to world
  const localCentroid = getFaceCentroid(T, blockGeo, faceDir);
  const worldCentroid = localCentroid.clone().add(blockPos);

  // Push arrow origin slightly off the face surface so it's visible
  const origin = worldCentroid.clone().addScaledVector(faceDir.clone().normalize(), 0.04);

  // Center the arrow shaft on the origin (ArrowHelper places tail at origin)
  // Shift origin back by half arrow length so arrow is centered on face centroid
  const tailOrigin = origin.clone().addScaledVector(arrowDir.clone().normalize(), -arrowLen * 0.5);

  const arrow = new T.ArrowHelper(
    arrowDir.clone().normalize(),
    tailOrigin,
    arrowLen,
    color,
    arrowHead,
    arrowW
  );
  taggedAdd(st.scene, arrow);
}

// ─── Main draw ────────────────────────────────────────────────────────────────
export async function draw3DBlock(canvasId, strike, dip, rake, isAux) {
  const T  = await getThree();
  const st = getScene(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const W = canvas.clientWidth  || 260;
  const H = canvas.clientHeight || 220;

  const dark        = isDark();
  const np1Color    = getCSSVar('--np1');
  const np2Color    = getCSSVar('--np2');
  const edgeColor   = getCSSVar('--text');
  const accentColor = isAux ? np2Color : np1Color;
  const hwColor     = dark ? '#3e3d3a' : '#d5d2cc';
  const fwColor     = dark ? '#1e1d1b' : '#f0eeea';

  // ── Init renderer/scene/camera once per canvas ──
  if (!st.renderer) {
    st.renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
    st.renderer.setPixelRatio(window.devicePixelRatio);
    st.renderer.setClearColor(0x000000, 0);
    st.scene = new T.Scene();

    const aspect  = W / H;
    const frustum = 1.9;
    st.camera = new T.OrthographicCamera(
      -frustum * aspect,  frustum * aspect,
       frustum,          -frustum,
      0.1, 100
    );
    st.spherical = { theta: 0.7, phi: 0.38, r: 4.5 };
    updateCamera(st);
    setupOrbitControls(canvas, st);

    st.scene.add(new T.AmbientLight(0xffffff, 0.65));
    const dir = new T.DirectionalLight(0xffffff, 0.75);
    dir.position.set(3, 6, 4);
    st.scene.add(dir);
  }
  st.renderer.setSize(W, H, false);

  disposeObjects(st);

  const { hw, fw, faultNormal, crossings } = buildBlocks(T, strike, dip);
  const { slip } = getFaultVectorsThree(T, strike, dip, rake);

  const offset   = 0.15;
  const hwOffset = slip.clone().multiplyScalar( offset);
  const fwOffset = slip.clone().multiplyScalar(-offset);

  // ── Block meshes ──
  const hwMesh = new T.Mesh(hw, new T.MeshLambertMaterial({ color: hwColor, transparent: true, opacity: 0.90, side: T.DoubleSide }));
  const fwMesh = new T.Mesh(fw, new T.MeshLambertMaterial({ color: fwColor, transparent: true, opacity: 0.90, side: T.DoubleSide }));
  hwMesh.position.copy(hwOffset);
  fwMesh.position.copy(fwOffset);
  taggedAdd(st.scene, hwMesh);
  taggedAdd(st.scene, fwMesh);

  // ── Edge outlines ──
  const edgeMat = new T.LineBasicMaterial({ color: edgeColor });
  const hwEdges = new T.LineSegments(new T.EdgesGeometry(hw, 12), edgeMat);
  const fwEdges = new T.LineSegments(new T.EdgesGeometry(fw, 12), edgeMat.clone());
  hwEdges.position.copy(hwOffset);
  fwEdges.position.copy(fwOffset);
  taggedAdd(st.scene, hwEdges);
  taggedAdd(st.scene, fwEdges);

  // ── Fault plane ──
  if (crossings.length >= 3) {
    const sorted = sortPolygon(T, crossings, faultNormal);

    for (const off of [hwOffset, fwOffset]) {
      const loop    = [...sorted, sorted[0]];
      const lineGeo = new T.BufferGeometry().setFromPoints(loop);
      const line    = new T.Line(lineGeo, new T.LineBasicMaterial({ color: accentColor }));
      line.position.copy(off);
      taggedAdd(st.scene, line);
    }

    // Fault fill
    const fc = new T.Vector3();
    sorted.forEach(p => fc.add(p));
    fc.divideScalar(sorted.length);
    const fillVerts = [];
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i], b = sorted[(i + 1) % sorted.length];
      fillVerts.push(fc.x, fc.y, fc.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const fillGeo = new T.BufferGeometry();
    fillGeo.setAttribute('position', new T.Float32BufferAttribute(fillVerts, 3));
    const fillMesh = new T.Mesh(fillGeo, new T.MeshBasicMaterial({
      color: accentColor, transparent: true, opacity: 0.18,
      side: T.DoubleSide, depthWrite: false,
    }));
    taggedAdd(st.scene, fillMesh);
  }

  // ── Motion arrows ─────────────────────────────────────────────────────────
  const aColor = new T.Color(accentColor);

  // Use the rake angle to mathematically isolate components, ignoring 3D vector spread
  const rakeRad = rad(rake);
  const ssComp  = Math.cos(rakeRad);
  const dsComp  = Math.sin(rakeRad);
  
  // Threshold to determine if a component is significant enough to draw
  const hasStrike = Math.abs(ssComp) > 0.15;
  const hasDip    = Math.abs(dsComp) > 0.15;

  // ── Dip-slip arrows (Front face) ──
  if (hasDip) {
    const frontFace = new T.Vector3(0, 0, 1);
    
    // Flatten the true slip vector onto the front face so the arrow lies perfectly flat on the surface
    const slipOnFront = slip.clone().sub(frontFace.clone().multiplyScalar(slip.dot(frontFace))).normalize();
    
    addFaceArrow(T, st, hw, hwOffset, frontFace, slipOnFront, aColor);
    addFaceArrow(T, st, fw, fwOffset, frontFace, slipOnFront.clone().negate(), aColor);
  }

  // ── Strike-slip arrows (Top face) ──
  if (hasStrike) {
    const upFace  = new T.Vector3(0, 1, 0);
    
    // Flatten the true slip vector onto the top face
    const slipTop = slip.clone().sub(upFace.clone().multiplyScalar(slip.dot(upFace))).normalize();
    
    addFaceArrow(T, st, hw, hwOffset, upFace, slipTop, aColor);
    addFaceArrow(T, st, fw, fwOffset, upFace, slipTop.clone().negate(), aColor);
  }

  startLoop(st);
}

// ─── Render loop ──────────────────────────────────────────────────────────────
function startLoop(st) {
  if (st.animating) return;
  st.animating = true;
  const loop = () => {
    if (!st.animating) return;
    st.rafId = requestAnimationFrame(loop);
    st.renderer?.render(st.scene, st.camera);
  };
  loop();
}

export function stop3DLoop(canvasId) {
  const st = scenes[canvasId];
  if (!st) return;
  st.animating = false;
  if (st.rafId) cancelAnimationFrame(st.rafId);
}

export function dispose3D(canvasId) {
  stop3DLoop(canvasId);
  const st = scenes[canvasId];
  if (!st) return;
  disposeObjects(st);
  st.renderer?.dispose();
  delete scenes[canvasId];
}

// ─── Camera ───────────────────────────────────────────────────────────────────
function updateCamera(st) {
  const { theta, phi, r } = st.spherical;
  st.camera.position.set(
    r * Math.cos(phi) * Math.sin(theta),
    r * Math.sin(phi),
    r * Math.cos(phi) * Math.cos(theta),
  );
  st.camera.lookAt(0, 0, 0);
}

function setupOrbitControls(canvas, st) {
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', e => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    st.spherical.theta -= dx * 0.012;
    st.spherical.phi = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, st.spherical.phi + dy * 0.012));
    updateCamera(st);
  });
  canvas.addEventListener('pointerup',     () => { dragging = false; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('pointercancel', () => { dragging = false; canvas.style.cursor = 'grab'; });
}