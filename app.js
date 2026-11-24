// Ipari MAP – 3D épületnavigáció
// Three.js modell az alaprajzokból, útvonaltervezés (diák/tanár szabályokkal) és fotós "utcakép" mód.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const PHOTO_BASE = document.documentElement.dataset.photoBase || '../pictures/small/corridor/';
const FLOOR_H = 4.2;          // szintmagasság (m)
const WALL_H = 1.4;           // "levágott" falmagasság a modellen
const WALK = 1.3;             // m/s
const STAIR_SEC = 18;         // s / szint
const TYPE = {
  class:   ['#cfe0fb', 'Tanterem'],
  lab:     ['#cfeedd', 'Labor'],
  workshop:['#ffdcb8', 'Műhely'],
  office:  ['#f9d3e1', 'Iroda / tanári'],
  special: ['#fff0b0', 'Közösségi tér'],
  wc:      ['#dfe6ef', 'Mosdó'],
  stair:   ['#f7dd0f', 'Lépcső'],
  storage: ['#e9e3d8', 'Raktár'],
  service: ['#ece8e0', 'Kiszolgáló / t.sz.'],
};
const $ = (id) => document.getElementById(id);
const LEVEL_TO = { 0: 'a földszintre', 1: 'az 1. emeletre', 2: 'a 2. emeletre', 3: 'a tetőtérbe' };
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
const lerp = (a, b, t) => a + (b - a) * t;
// L-szárny szintkülönbsége; a negyed emeletnyit a térképen kicsit eltúlozzuk, hogy látsszon
const DY = (o) => (o.dy || 0) * FLOOR_H * (Math.abs(o.dy || 0) < 0.5 ? 1.6 : 1);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const S = {
  role: 'diak', level: 'all', explode: 2.2, showPhotos: true,
  from: null, to: null, route: null, hoverRoom: null, selected: null,
  sv: null, levelY: {}, levelTarget: {}, levelAlpha: {}, alphaTarget: {},
};

let D; // building data
try {
  D = await (await fetch('data/building.json')).json();
} catch (e) {
  $('loading').textContent = 'Nem sikerült betölteni az épületadatokat (data/building.json). Webszerverről nyisd meg az oldalt.';
  throw e;
}
$('loading').remove();
const LEVELS = D.levels.map((l) => l.level);
const levelName = (lv) => D.levels.find((l) => l.level === lv).name;

// ------------------------------------------------------------ derived data
for (const r of D.rooms) {
  r.cx = r.poly.reduce((s, p) => s + p[0], 0) / r.poly.length;
  r.cz = r.poly.reduce((s, p) => s + p[1], 0) / r.poly.length;
  r.area = Math.abs(r.poly.reduce((s, p, i) => { const q = r.poly[(i + 1) % r.poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  r.key = norm(`${r.name} ${r.sub} ${levelName(r.level)} ${r.keys || ''}`);
}
const nodeAdj = D.nodes.map(() => []);
D.edges.forEach((e, i) => { nodeAdj[e.a].push(i); nodeAdj[e.b].push(i); });
const nodeRestricted = D.nodes.map((n, i) => nodeAdj[i].some((ei) => D.edges[ei].restricted));
const nodeRoom = {};
for (const r of D.rooms) nodeRoom[r.node] = nodeRoom[r.node] || r;

const places = [
  ...D.exits.map((e) => ({ kind: 'exit', name: e.name, sub: levelName(e.level), node: e.node, level: e.level, key: norm(e.name + ' bejarat kijarat') })),
  ...D.rooms.filter((r) => r.type !== 'stair').map((r) => ({ kind: 'room', room: r, name: r.name, sub: [r.sub, levelName(r.level)].filter(Boolean).join(' · '), node: r.node, level: r.level, key: r.key })),
];

// ------------------------------------------------------------ three.js setup
const host = $('map');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'lbls';
host.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe9e6de, 260, 520);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 8;
controls.maxDistance = 330;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-60, 120, 70);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 80, bottom: -80, near: 10, far: 400 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(260, 64), new THREE.ShadowMaterial({ opacity: 0.12 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.4; ground.receiveShadow = true;
scene.add(ground);

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  // keep the model centred in the free area next to the side panel
  if (w > 900) camera.setViewOffset(w, h, -190, 0, w, h);
  else if (w <= 720) camera.setViewOffset(w, h, 0, h * 0.2, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ building geometry
const levelGroups = {};
const roomMeshes = [];
const labels = [];
const pickables = [];

function shapeFrom(poly) {
  const s = new THREE.Shape();
  poly.forEach((p, i) => (i ? s.lineTo(p[0], -p[1]) : s.moveTo(p[0], -p[1])));
  s.closePath();
  return s;
}
function stripeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fbe3e3'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#ef9a9d'; g.lineWidth = 10;
  for (let i = -64; i < 128; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.35, 0.35);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const stripes = stripeTexture();

function wallGeometry(polys, h) {
  const pos = [], line = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      pos.push(p[0], 0, p[1], q[0], 0, q[1], q[0], h, q[1], p[0], 0, p[1], q[0], h, q[1], p[0], h, p[1]);
      line.push(p[0], h, p[1], q[0], h, q[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
  return [g, lg];
}

for (const lv of LEVELS) {
  const grp = new THREE.Group();
  grp.userData = { level: lv, mats: [] };
  levelGroups[lv] = grp;
  scene.add(grp);
  const mats = grp.userData.mats;
  const mk = (m) => { m.transparent = true; mats.push(m); return m; };

  // corridor slab (thick) + teacher corridor stripes
  const slabMat = mk(new THREE.MeshStandardMaterial({ color: 0xf8f6f1, roughness: 0.9 }));
  const edgeMat = mk(new THREE.MeshStandardMaterial({ color: 0xcfc9bc, roughness: 1 }));
  const tMat = mk(new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.9 }));
  const roomPolys = D.rooms.filter((r) => r.level === lv).map((r) => r.poly);
  const corrs = D.corridors.filter((c) => c.level === lv);
  const plinthMat = mk(new THREE.MeshStandardMaterial({ color: 0xb9b2a3, roughness: 1 }));
  for (const c of corrs) {
    const raise = Math.max(0, DY(c));
    const g = new THREE.ExtrudeGeometry(shapeFrom(c.poly), { depth: 0.35 + raise, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.translate(0, -0.35 - raise, 0);
    const m = new THREE.Mesh(g, [c.restricted ? tMat : slabMat, raise ? plinthMat : edgeMat]);
    m.position.y = DY(c);
    m.receiveShadow = true;
    grp.add(m);
  }
  // room floors
  for (const r of D.rooms.filter((x) => x.level === lv)) {
    const rr = Math.max(0, DY(r));
    const g = new THREE.ExtrudeGeometry(shapeFrom(r.poly), { depth: 0.35 + rr, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.translate(0, -0.33 - rr, 0);
    const col = new THREE.Color(TYPE[r.type][0]);
    const mat = mk(new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 }));
    const m = new THREE.Mesh(g, [mat, rr ? plinthMat : edgeMat]);
    m.receiveShadow = true;
    m.userData = { room: r, base: col.clone() };
    r.mesh = m;
    m.position.y = DY(r);
    grp.add(m); roomMeshes.push(m); pickables.push(m);
    // label
    const el = document.createElement('div');
    el.className = 'lbl' + (r.area > 120 ? ' big' : '');
    const wcSub = r.type === 'wc' ? (/női/i.test(r.name + r.sub) ? 'Női WC' : /férfi/i.test(r.name + r.sub) ? 'Férfi WC' : /akadálym/i.test(r.sub) ? 'Akadálymentes WC' : '') : '';
    const showName = r.type === 'wc' && /WC/.test(r.name) && wcSub ? '' : r.name;
    const wcSmall = showName ? (wcSub && wcSub !== showName ? wcSub : '') : (r.staff ? 'tanári' : '');
    el.innerHTML = r.type === 'wc'
      ? `<b>${esc(showName || wcSub)}</b>${wcSmall ? `<small>${esc(wcSmall)}</small>` : ''}`
      : `<b>${esc(r.name)}</b>${r.sub && r.area > 25 ? `<small>${esc(r.sub)}</small>` : ''}`;
    const o = new CSS2DObject(el);
    o.position.set(r.cx, WALL_H + 0.3 + DY(r), r.cz);
    o.userData = { room: r, el };
    grp.add(o); labels.push(o);
  }
  // walls
  const wallMat = mk(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide, opacity: 0.94 }));
  const lineMat = mk(new THREE.LineBasicMaterial({ color: 0x55514a }));
  const items = [...D.rooms.filter((r) => r.level === lv), ...corrs];
  for (const dy of [...new Set(items.map((o) => o.dy || 0))]) {
    const [wg, lg] = wallGeometry(items.filter((o) => (o.dy || 0) === dy).map((o) => o.poly), WALL_H);
    const walls = new THREE.Mesh(wg, wallMat);
    walls.castShadow = true; walls.receiveShadow = true;
    const lines = new THREE.LineSegments(lg, lineMat);
    walls.position.y = lines.position.y = dy * FLOOR_H;
    grp.add(walls, lines);
  }
  // floor tag
  const tagEl = document.createElement('div'); tagEl.className = 'tag lvl'; tagEl.textContent = levelName(lv);
  const xs = [...roomPolys, ...corrs.map((c) => c.poly)].flat();
  const minX = Math.min(...xs.map((p) => p[0])), minZ = Math.min(...xs.map((p) => p[1])), maxZ = Math.max(...xs.map((p) => p[1]));
  const tag = new CSS2DObject(tagEl);
  tag.position.set(minX - 4, 0, (minZ + maxZ) / 2 + 6);
  tag.userData = { levelTag: true };
  grp.add(tag);
  grp.userData.tag = tag;
  grp.userData.bounds = { minX, maxX: Math.max(...xs.map((p) => p[0])), minZ, maxZ };

  S.levelY[lv] = S.levelTarget[lv] = lv * FLOOR_H * S.explode;
  S.levelAlpha[lv] = S.alphaTarget[lv] = 1;
}

// split-level transitions: small flights of steps + a tag on the offset wing
{
  const matsFor = {};
  const getMats = (lv) => matsFor[lv] ||= (() => {
    const m = [new THREE.MeshStandardMaterial({ color: 0xf2d21b, roughness: 0.8, transparent: true }), new THREE.MeshStandardMaterial({ color: 0x9c8a1e, roughness: 0.9, transparent: true })];
    levelGroups[lv].userData.mats.push(...m); return m;
  })();
  for (const e of D.edges) {
    if (e.kind !== 'walk') continue;
    let a = D.nodes[e.a], b = D.nodes[e.b];
    if ((a.dy || 0) === (b.dy || 0)) continue;
    if ((a.dy || 0) > (b.dy || 0)) [a, b] = [b, a]; // a = lower end
    const n = 7, dx = (b.x - a.x) / n, dz = (b.z - a.z) / n, h = (DY(b) - DY(a)) / n;
    const len = Math.hypot(b.x - a.x, b.z - a.z) / n, ang = Math.atan2(b.x - a.x, b.z - a.z);
    const grp = levelGroups[a.level];
    const [stepMat, riserMat] = getMats(a.level);
    for (let i = 0; i < n; i++) {
      const top = DY(a) + h * (i + 1), bottom = Math.min(DY(a), DY(b), 0) - 0.35;
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, top - bottom, len * 1.02), [riserMat, riserMat, stepMat, riserMat, riserMat, riserMat]);
      box.position.set(a.x + dx * (i + 0.5), (top + bottom) / 2, a.z + dz * (i + 0.5));
      box.rotation.y = ang;
      box.castShadow = box.receiveShadow = true;
      grp.add(box);
    }
  }
}
const extraTags = [];
for (const lv of LEVELS) {
  const c = D.corridors.find((x) => x.level === lv && x.dy);
  if (!c) continue;
  const el = document.createElement('div'); el.className = 'tag split';
  el.textContent = lv === 1 ? '▲ L-szárny alsó szintje: fél szinttel a 2. emelet alatt' : '▲ L-szárny felső szintje: negyed szinttel a 2. emelet fölött';
  const o = new CSS2DObject(el);
  const xs = c.poly.map((p) => p[0]), zs = c.poly.map((p) => p[1]);
  o.position.set(Math.min(...xs) + 1.5, DY(c) + WALL_H + 1.2, (Math.min(...zs) + Math.max(...zs)) / 2);
  o.userData = { level: lv };
  levelGroups[lv].add(o); extraTags.push(o);
}
// teacher corridor + exits tags
{
  const t = D.corridors.find((c) => c.restricted);
  const el = document.createElement('div'); el.className = 'tag teacher'; el.textContent = 'Tanári folyosó – diákoknak csak ügyintézéshez';
  const o = new CSS2DObject(el);
  o.position.set(t.poly.reduce((s, p) => s + p[0], 0) / t.poly.length, 0.6, Math.max(...t.poly.map((p) => p[1])) + 0.5);
  o.center.set(0.5, 0);
  o.userData = { level: 2 };
  levelGroups[2].add(o); extraTags.push(o);
  for (const e of D.exits) {
    const n = D.nodes[e.node];
    const el2 = document.createElement('div'); el2.className = 'tag exit'; el2.textContent = '⇥ ' + e.name;
    const o2 = new CSS2DObject(el2); o2.position.set(n.x, 0.8 + DY(n), n.z); o2.userData = { level: e.level };
    levelGroups[e.level].add(o2); extraTags.push(o2);
  }
}

// stair connectors (rebuilt when floors move)
const stairGroup = new THREE.Group();
scene.add(stairGroup);
const stairMat = new THREE.LineDashedMaterial({ color: 0xc9a800, dashSize: 0.8, gapSize: 0.5, transparent: true, opacity: 0.9 });
function buildStairs() {
  stairGroup.clear();
  for (const e of D.edges.filter((x) => x.kind === 'stair')) {
    const a = D.nodes[e.a], b = D.nodes[e.b];
    if (!visibleLevel(a.level) || !visibleLevel(b.level)) continue;
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, S.levelY[a.level] + DY(a) + 0.2, a.z), new THREE.Vector3(b.x, S.levelY[b.level] + DY(b) + 0.2, b.z)]);
    const l = new THREE.Line(g, stairMat); l.computeLineDistances(); stairGroup.add(l);
  }
}

// photo markers
const photoGeo = (() => {
  const s = new THREE.Shape();
  s.absarc(0, 0, 0.55, Math.PI * 0.25 + Math.PI / 2 + 0.0, Math.PI * 2 + Math.PI / 2 - Math.PI * 0.25, false);
  s.lineTo(0, 1.25); s.closePath();
  const g = new THREE.ShapeGeometry(s, 16); g.rotateX(-Math.PI / 2);
  return g;
})();
const photoMats = {};
const photoMeshes = {};
for (const lv of LEVELS) {
  const list = D.photos.filter((p) => p.level === lv);
  if (!list.length) continue;
  const mat = new THREE.MeshBasicMaterial({ color: 0x1a73e8, transparent: true, depthTest: true });
  photoMats[lv] = mat;
  const im = new THREE.InstancedMesh(photoGeo, mat, list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  list.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.heading * Math.PI / 180);
    m4.compose(new THREE.Vector3(p.x, 0.12 + DY(p), p.z), q, new THREE.Vector3(1, 1, 1));
    im.setMatrixAt(i, m4);
    im.setColorAt(i, new THREE.Color(0xffffff));
  });
  im.userData = { photos: list };
  im.renderOrder = 2;
  photoMeshes[lv] = im;
  levelGroups[lv].add(im);
  pickables.push(im);
}

// ------------------------------------------------------------ level visibility / explode
function visibleLevel(lv) { return S.alphaTarget[lv] > 0.01; }
function applyLevelMode() {
  const single = S.level !== 'all';
  for (const lv of LEVELS) {
    let y, a;
    if (!single) { y = lv * FLOOR_H * S.explode; a = 1; }
    else {
      const f = S.level;
      y = lv * FLOOR_H * 1.0 + (lv > f ? 40 : 0);
      a = lv === f ? 1 : lv < f ? 0.16 : 0;
    }
    S.levelTarget[lv] = y; S.alphaTarget[lv] = a;
  }
  document.querySelectorAll('.floors button').forEach((b) => b.classList.toggle('on', String(S.level) === b.dataset.l));
}
function updateLevels(dt) {
  let moved = false;
  for (const lv of LEVELS) {
    const k = 1 - Math.pow(0.0015, dt);
    const ny = lerp(S.levelY[lv], S.levelTarget[lv], k);
    const na = lerp(S.levelAlpha[lv], S.alphaTarget[lv], k);
    if (Math.abs(ny - S.levelY[lv]) > 0.002 || Math.abs(na - S.levelAlpha[lv]) > 0.002) moved = true;
    S.levelY[lv] = Math.abs(ny - S.levelTarget[lv]) < 0.01 ? S.levelTarget[lv] : ny;
    S.levelAlpha[lv] = Math.abs(na - S.alphaTarget[lv]) < 0.005 ? S.alphaTarget[lv] : na;
    const g = levelGroups[lv];
    g.position.y = S.levelY[lv];
    g.visible = S.levelAlpha[lv] > 0.01;
    for (const m of g.userData.mats) m.opacity = (m.userData.baseOpacity ?? (m.userData.baseOpacity = m.opacity)) * S.levelAlpha[lv];
    if (photoMats[lv]) photoMats[lv].opacity = S.showPhotos ? 0.92 * S.levelAlpha[lv] : 0;
  }
  return moved;
}

// ------------------------------------------------------------ routing
function dijkstra(src, dst, mode, all = false) {
  const n = D.nodes.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), pe = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  dist[src] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0 || u === dst) break;
    done[u] = 1;
    for (const ei of nodeAdj[u]) {
      const e = D.edges[ei];
      const v = e.a === u ? e.b : e.a;
      let c = e.len;
      if (e.kind === 'stair') c = e.len + 14 * Math.abs(D.nodes[e.a].level - D.nodes[e.b].level);
      if (e.restricted) {
        if (mode === 'forbid') continue;
        if (mode === 'business') c *= 1.5; // ügyintézés: használhatja, de ne kerülőútnak
      }
      if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u; pe[v] = ei; }
    }
  }
  if (all) return dist;
  if (dist[dst] === Infinity) return null;
  const nodes = [], edges = [];
  for (let v = dst; v !== -1; v = prev[v]) { nodes.unshift(v); if (pe[v] >= 0) edges.unshift(pe[v]); }
  return { nodes, edges, cost: dist[dst] };
}
function pathLength(p) { return p.edges.reduce((s, ei) => s + D.edges[ei].len, 0); }

function planRoute() {
  S.route = null;
  const res = $('result'), notice = $('notice');
  if (!S.from || !S.to) { res.hidden = true; drawRoute(); return; }
  if (S.from.node === S.to.node) { res.hidden = true; drawRoute(); return; }
  notice.hidden = true; notice.className = 'notice';
  const toRoom = S.to.room, fromRoom = S.from.room;
  if (S.role === 'diak' && toRoom && toRoom.staff) {
    res.hidden = false;
    $('sum').innerHTML = `<span class="meta">Ide nem tervezünk útvonalat</span>`;
    notice.hidden = false; notice.classList.add('warn');
    notice.textContent = `${toRoom.name}${toRoom.sub ? ' (' + toRoom.sub + ')' : ''} csak a tanárok használhatják. Ha tanár vagy, válts fent „Tanár” módra.`;
    $('steps').innerHTML = ''; $('walkBtn').hidden = true;
    drawRoute(); return;
  }
  let mode = 'all', info = '';
  if (S.role === 'diak') {
    const business = nodeRestricted[S.to.node] || nodeRestricted[S.from.node];
    mode = business ? 'business' : 'forbid';
    const free = dijkstra(S.from.node, S.to.node, 'all');
    const p = dijkstra(S.from.node, S.to.node, mode);
    if (!p) { $('sum').textContent = 'Nincs útvonal.'; res.hidden = false; return; }
    if (business) {
      const who = nodeRestricted[S.to.node] ? S.to : S.from;
      info = `Ügyintézés: a(z) ${who.name}${who.room && who.room.sub ? ' (' + who.room.sub + ')' : ''} miatt beléphetsz a tanári folyosóra – csak a szükséges szakaszt használd.`;
    } else if (free && pathLength(p) - pathLength(free) > 2) {
      info = `A tanári folyosón diákok és látogatók csak ügyintézés céljából közlekedhetnek, ezért az útvonal kerülővel vezet (+${Math.round(pathLength(p) - pathLength(free))} m).`;
    }
    S.route = p;
  } else {
    S.route = dijkstra(S.from.node, S.to.node, 'all');
  }
  if (!S.route) return;
  if (info) { notice.hidden = false; notice.textContent = info; }
  const r = S.route;
  const len = pathLength(r);
  const lvChanges = r.edges.filter((ei) => D.edges[ei].kind === 'stair').reduce((s, ei) => s + Math.abs(D.nodes[D.edges[ei].a].level - D.nodes[D.edges[ei].b].level), 0);
  const sec = len / WALK + lvChanges * STAIR_SEC;
  $('sum').innerHTML = `<span class="big">${Math.max(1, Math.round(sec / 60))} perc</span><span class="meta">${Math.round(len)} m · ${lvChanges ? lvChanges + ' szintváltás' : 'egy szinten'}</span>`;
  r.steps = buildSteps(r);
  $('steps').innerHTML = r.steps.map((s, i) => `<li class="${s.cls || ''}" data-i="${i}">${esc(s.text)}${s.small ? `<small>${esc(s.small)}</small>` : ''}</li>`).join('');
  $('walkBtn').hidden = !photoNear(r.nodes[r.nodes.length - 1]);
  res.hidden = false;
  // floors with route
  const used = new Set(r.nodes.map((n) => D.nodes[n].level));
  document.querySelectorAll('.floors button').forEach((b) => b.classList.toggle('has-route', used.has(+b.dataset.l)));
  drawRoute();
  frameRoute();
}

function dirOf(a, b) { const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; }
function turnWord(d1, d2) {
  const cross = d1[0] * d2[1] - d1[1] * d2[0], dot = d1[0] * d2[0] + d1[1] * d2[1];
  if (dot > 0.8) return 'Haladj egyenesen';
  if (dot < -0.6) return 'Fordulj vissza';
  return cross > 0 ? 'Fordulj jobbra' : 'Fordulj balra';
}
function buildSteps(r) {
  const steps = [{ text: `Indulás: ${S.from.name}`, small: S.from.sub, node: r.nodes[0] }];
  const groups = [];
  r.edges.forEach((ei, i) => {
    const e = D.edges[ei], a = D.nodes[r.nodes[i]], b = D.nodes[r.nodes[i + 1]];
    const g = groups[groups.length - 1];
    const ddy = e.kind === 'walk' ? (b.dy || 0) - (a.dy || 0) : 0;
    if (g && g.kind === e.kind && g.name === e.name && e.kind === 'walk') { g.len += e.len; g.last = [a, b]; g.end = r.nodes[i + 1]; g.ddy += ddy; }
    else groups.push({ kind: e.kind, name: e.name, len: e.len, first: [a, b], last: [a, b], start: r.nodes[i], end: r.nodes[i + 1], restricted: e.restricted, dl: b.level - a.level, ddy });
  });
  let lastDir = null;
  for (const g of groups) {
    if (g.kind === 'stair') {
      const to = D.nodes[g.end].level;
      steps.push({ text: `${g.dl > 0 ? 'Menj fel' : 'Menj le'} ${LEVEL_TO[to]}`, small: g.name, cls: 'stair', node: g.end });
      lastDir = null; continue;
    }
    if (g.len < 1.5 && groups.length > 1) continue;
    const d = dirOf(g.first[0], g.first[1]);
    const verb = lastDir ? turnWord(lastDir, d) : steps.length > 1 ? 'Folytasd' : 'Indulj el';
    const amt = Math.abs(g.ddy) >= 0.5 ? 'fél' : 'negyed';
    const half = g.ddy > 0 ? ` · ${amt} emeletnyi lépcső fel` : g.ddy < 0 ? ` · ${amt} emeletnyi lépcső le` : '';
    steps.push({ text: `${verb}: ${g.name}`, small: `${levelName(D.nodes[g.start].level)} · kb. ${Math.max(1, Math.round(g.len))} m${g.restricted ? ' · tanári folyosó' : ''}${half}`, node: g.start });
    lastDir = dirOf(g.last[0], g.last[1]);
  }
  let side = '';
  if (S.to.room && lastDir) {
    const n = D.nodes[r.nodes[r.nodes.length - 1]];
    const cross = lastDir[0] * (S.to.room.cz - n.z) - lastDir[1] * (S.to.room.cx - n.x);
    side = cross > 0 ? 'az ajtó jobb kéz felől' : 'az ajtó bal kéz felől';
  }
  steps.push({ text: `Megérkeztél: ${S.to.name}`, small: [S.to.room && S.to.room.sub, side].filter(Boolean).join(' · '), cls: 'end', node: r.nodes[r.nodes.length - 1] });
  return steps;
}

// route visuals
const routeGroup = new THREE.Group();
scene.add(routeGroup);
const routeMat = new THREE.MeshBasicMaterial({ color: 0xe11f26 });
const routeGlow = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
const routeXray = new THREE.MeshBasicMaterial({ color: 0xe11f26, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false });
const chevGeo = new THREE.ConeGeometry(0.32, 0.8, 3); chevGeo.rotateX(Math.PI / 2);
const chevMat = new THREE.MeshBasicMaterial({ color: 0xf7dd0f, depthTest: false, transparent: true });
let routeCurve = null, chevrons = null, pinStart = null, pinEnd = null;
function routePoints() {
  return S.route.nodes.map((ni) => { const n = D.nodes[ni]; return new THREE.Vector3(n.x, S.levelY[n.level] + DY(n) + 0.45, n.z); });
}
function makePin(cls, text) {
  const el = document.createElement('div'); el.className = 'tag pin ' + cls; el.textContent = text;
  const o = new CSS2DObject(el); o.center.set(0.5, 1.4); return o;
}
function drawRoute() {
  routeGroup.clear(); routeCurve = null; chevrons = null;
  D.rooms.forEach((r) => { r.mesh.material[0].color.copy(r.mesh.userData.base); });
  labels.forEach((o) => o.userData.el.classList.remove('target'));
  if (S.to && S.to.room) { S.to.room.mesh.material[0].color.set(0xffb3b5); labelOf(S.to.room)?.userData.el.classList.add('target'); }
  if (!S.route) return;
  const pts = routePoints();
  const path = new THREE.CurvePath();
  for (let i = 0; i < pts.length - 1; i++) if (pts[i].distanceTo(pts[i + 1]) > 0.01) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
  routeCurve = path;
  const L = path.getLength();
  const segs = Math.min(1500, Math.max(40, Math.ceil(L * 2)));
  routeGroup.add(new THREE.Mesh(new THREE.TubeGeometry(path, segs, 0.3, 8, false), routeMat));
  routeGroup.add(new THREE.Mesh(new THREE.TubeGeometry(path, segs, 0.42, 8, false), routeGlow));
  const xr = new THREE.Mesh(new THREE.TubeGeometry(path, segs, 0.26, 6, false), routeXray);
  xr.renderOrder = 10; routeGroup.add(xr);
  const count = Math.max(4, Math.floor(L / 4));
  chevrons = new THREE.InstancedMesh(chevGeo, chevMat, count);
  chevrons.userData.L = L; chevrons.renderOrder = 11;
  routeGroup.add(chevrons);
  pinStart = makePin('start', 'Indulás'); pinStart.position.copy(pts[0]);
  pinEnd = makePin('', S.to.room && S.to.room.sub ? `${S.to.name} · ${S.to.room.sub}` : S.to.name); pinEnd.position.copy(pts[pts.length - 1]);
  routeGroup.add(pinStart, pinEnd);
  const startBall = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 12), new THREE.MeshBasicMaterial({ color: 0x1e8e3e }));
  startBall.position.copy(pts[0]); routeGroup.add(startBall);
  const endBall = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 12), routeMat);
  endBall.position.copy(pts[pts.length - 1]); routeGroup.add(endBall);
}
function labelOf(room) { return labels.find((o) => o.userData.room === room); }
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1);
function animateChevrons(t) {
  if (!chevrons || !routeCurve) return;
  const n = chevrons.count, L = chevrons.userData.L;
  for (let i = 0; i < n; i++) {
    const u = ((i / n) + t * (3.2 / L)) % 1;
    const p = routeCurve.getPointAt(u), tg = routeCurve.getTangentAt(u);
    tmpQ.setFromUnitVectors(up, tg.normalize());
    tmpM.compose(p.add(new THREE.Vector3(0, 0.05, 0)), tmpQ, new THREE.Vector3(1, 1, 1));
    chevrons.setMatrixAt(i, tmpM);
  }
  chevrons.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------ camera helpers
let camAnim = null;
function flyTo(pos, target, ms = 900, done) {
  camAnim = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), ms, done };
}
function fitPoints(pts, pitchDeg = 52, yawDeg = -12, pad = 1.08, ms = 1000) {
  const box = new THREE.Box3().setFromPoints(pts);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const fov = (camera.fov * Math.PI) / 180, aspect = Math.max(0.6, camera.aspect * (innerWidth > 900 ? (innerWidth - 400) / innerWidth : 1));
  const needH = Math.max(size.z * Math.sin((pitchDeg * Math.PI) / 180) + size.y, 18) / (innerWidth <= 720 ? 0.52 : 1);
  const needW = Math.max(size.x, size.z * 0.6, 24);
  const dist = Math.max(needH / 2 / Math.tan(fov / 2), needW / 2 / Math.tan(fov / 2) / aspect) * pad + 6;
  const pr = (pitchDeg * Math.PI) / 180, yr = (yawDeg * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.sin(yr) * Math.cos(pr), Math.sin(pr), Math.cos(yr) * Math.cos(pr));
  flyTo(c.clone().addScaledVector(dir, dist), c, ms);
}
function levelPoints(lvls) {
  const pts = [];
  for (const lv of lvls) { const b = levelGroups[lv].userData.bounds, y = S.levelTarget[lv]; pts.push(new THREE.Vector3(b.minX, y, b.minZ), new THREE.Vector3(b.maxX, y + WALL_H, b.maxZ)); }
  return pts;
}
function homeView() {
  S.level = 'all'; applyLevelMode();
  fitPoints(levelPoints(LEVELS), 50, -10, 0.95);
}
function frameRoute() {
  if (!S.route) return;
  const pts = S.route.nodes.map((ni) => D.nodes[ni]);
  const lvls = new Set(pts.map((p) => p.level));
  if (lvls.size === 1) { S.level = [...lvls][0]; } else { S.level = 'all'; }
  applyLevelMode();
  fitPoints(pts.map((n) => new THREE.Vector3(n.x, S.levelTarget[n.level] + DY(n), n.z)), lvls.size === 1 ? 60 : 48, -10, 1.15);
}

// ------------------------------------------------------------ UI: floors, legend, search
{
  const nav = $('floors');
  const items = [['all', 'Mind'], ...[...LEVELS].reverse().map((l) => [String(l), l === 0 ? 'F' : l === 3 ? 'T' : String(l)])];
  nav.innerHTML = items.map(([k, t]) => `<button data-l="${k}" title="${k === 'all' ? 'Minden szint' : esc(levelName(+k))}">${t}</button>`).join('');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.level = b.dataset.l === 'all' ? 'all' : +b.dataset.l;
    applyLevelMode();
    if (S.level !== 'all') {
      fitPoints(levelPoints([S.level]), 58, -8, 0.95);
    } else homeView();
  });
  $('legend').innerHTML = Object.entries(TYPE).map(([, [c, t]]) => `<span><i style="background:${c}"></i>${t}</span>`).join('') +
    `<span><i style="background:repeating-linear-gradient(45deg,#fbe3e3 0 3px,#ef9a9d 3px 6px)"></i>Tanári folyosó</span>`;
}

function setupSearch(input, box, which) {
  let act = 0, list = [];
  const render = () => {
    const q = norm(input.value);
    const words = q.split(' ').filter(Boolean);
    list = places.filter((p) => words.every((w) => p.key.includes(w)))
      .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1) || a.name.localeCompare(b.name, 'hu', { numeric: true }))
      .slice(0, 9);
    if (!q && which === 'from') list = places.filter((p) => p.kind === 'exit');
    act = 0;
    box.innerHTML = list.map((p, i) => `<button type="button" data-i="${i}" class="${i === act ? 'act' : ''}"><b>${esc(p.name)}</b><small>${esc(p.sub)}${p.room && p.room.staff ? ' · csak tanároknak' : ''}</small></button>`).join('') || '<button type="button" disabled><small>Nincs találat</small></button>';
    box.classList.add('open');
  };
  const choose = (p) => { if (!p) return; input.value = placeLabel(p); box.classList.remove('open'); S[which] = p; planRoute(); };
  input.addEventListener('input', render);
  input.addEventListener('focus', () => { input.select(); render(); });
  input.addEventListener('blur', () => setTimeout(() => box.classList.remove('open'), 160));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % Math.max(1, list.length);
      [...box.children].forEach((c, i) => c.classList.toggle('act', i === act));
    } else if (e.key === 'Enter') { e.preventDefault(); choose(list[act]); input.blur(); }
    else if (e.key === 'Escape') input.blur();
  });
  box.addEventListener('mousedown', (e) => { const b = e.target.closest('button[data-i]'); if (b) { e.preventDefault(); choose(list[+b.dataset.i]); input.blur(); } });
}
// mobile: while typing, the panel jumps to the top so the on-screen keyboard can't cover it
{
  const mq = matchMedia('(max-width: 720px)');
  const setVvh = () => document.documentElement.style.setProperty('--vvh', `${(window.visualViewport ? visualViewport.height : innerHeight)}px`);
  setVvh();
  if (window.visualViewport) { visualViewport.addEventListener('resize', setVvh); visualViewport.addEventListener('scroll', () => window.scrollTo(0, 0)); }
  let blurT = null;
  for (const id of ['fromInput', 'toInput']) {
    $(id).addEventListener('focus', () => {
      clearTimeout(blurT);
      if (!mq.matches) return;
      document.body.classList.add('searching');
      $('panel').scrollTop = 0;
      setTimeout(() => window.scrollTo(0, 0), 50);
    });
    $(id).addEventListener('blur', () => { blurT = setTimeout(() => document.body.classList.remove('searching'), 200); });
  }
}
setupSearch($('fromInput'), $('fromSugg'), 'from');
setupSearch($('toInput'), $('toSugg'), 'to');
function setPlace(which, p) { S[which] = p; $(which + 'Input').value = p ? placeLabel(p) : ''; planRoute(); }
function placeLabel(p) { return p.room && p.room.sub && p.room.type !== 'class' ? `${p.name} – ${p.room.sub}` : p.name; }
const placeByName = (n) => places.find((p) => p.name === n);
setPlace('from', placeByName('Főbejárat (Porta)'));
function nearest(kind) {
  if (!S.from) return;
  const dist = dijkstra(S.from.node, -1, S.role === 'diak' ? 'forbid' : 'all', true);
  const isWc = (p, g) => p.room && p.room.type === 'wc' && !(S.role === 'diak' && p.room.staff) && (g === 'noi' ? /noi/.test(p.key) : /ferfi/.test(p.key));
  const cands = places.filter((p) => p.node !== S.from.node && (kind === 'exit' ? p.kind === 'exit' : isWc(p, kind)));
  let best = null;
  for (const p of cands) if (dist[p.node] < (best ? dist[best.node] : Infinity)) best = p;
  if (best) setPlace('to', best);
}
const QUICK = [['F224', 'Titkárság'], ['F207'], ['F225'], ['Büfé'], ['F109'], ['L016'], ['F218'], ['H008']].map(([n, sub]) => places.find((p) => p.name === n && (!sub || (p.room && p.room.sub === sub)))).filter(Boolean);
$('quick').innerHTML = '<span class="qlab">Legközelebbi:</span><button class="chip strong" data-n="noi">Női mosdó</button><button class="chip strong" data-n="ferfi">Férfi mosdó</button><button class="chip strong" data-n="exit">Kijárat</button><span class="qlab">Népszerű helyek:</span>' +
  QUICK.map((p, i) => `<button class="chip" data-i="${i}">${esc(p.room.type === 'class' ? p.name : p.room.sub || p.name)}</button>`).join('');
$('quick').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  if (b.dataset.n) nearest(b.dataset.n); else setPlace('to', QUICK[+b.dataset.i]);
});
// help / welcome
function showHelp(v) { $('help').hidden = !v; if (v) $('helpOk').focus(); }
$('helpBtn').addEventListener('click', () => showHelp(true));
$('helpOk').addEventListener('click', () => { showHelp(false); try { localStorage.setItem('iparimap-help', '1'); } catch (e) {} });
$('help').addEventListener('click', (e) => { if (e.target.id === 'help') showHelp(false); });
{ let seen = null; try { seen = localStorage.getItem('iparimap-help'); } catch (e) {} if (!seen) showHelp(true); }
$('swapBtn').addEventListener('click', () => { const f = S.from; S.from = S.to; S.to = f; $('fromInput').value = S.from ? placeLabel(S.from) : ''; $('toInput').value = S.to ? placeLabel(S.to) : ''; planRoute(); });
$('clearBtn').addEventListener('click', () => { setPlace('to', null); document.querySelectorAll('.floors button').forEach((b) => b.classList.remove('has-route')); });
$('steps').addEventListener('click', (e) => {
  const li = e.target.closest('li'); if (!li || !S.route) return;
  const n = D.nodes[S.route.steps[+li.dataset.i].node];
  const c = new THREE.Vector3(n.x, S.levelTarget[n.level] + DY(n), n.z);
  flyTo(new THREE.Vector3(n.x - 4, c.y + 30, n.z + 26), c);
});
function setRole(r) {
  S.role = r;
  $('roleDiak').classList.toggle('on', r === 'diak'); $('roleTanar').classList.toggle('on', r === 'tanar');
  $('roleDiak').setAttribute('aria-checked', r === 'diak'); $('roleTanar').setAttribute('aria-checked', r === 'tanar');
  planRoute();
}
$('roleDiak').addEventListener('click', () => setRole('diak'));
$('roleTanar').addEventListener('click', () => setRole('tanar'));
$('photoToggle').addEventListener('change', (e) => { S.showPhotos = e.target.checked; });
$('explode').addEventListener('input', (e) => { S.explode = +e.target.value; if (S.level === 'all') applyLevelMode(); });
$('resetView').addEventListener('click', homeView);

// ------------------------------------------------------------ picking, hover, room card
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const objs = pickables.filter((o) => { let g = o.parent; return g.visible && S.alphaTarget[g.userData.level] > 0.5 && (o.isInstancedMesh ? S.showPhotos : true); });
  const hits = ray.intersectObjects(objs, false);
  // photo markers win if they are hit at all
  const ph = hits.find((h) => h.object.isInstancedMesh);
  if (ph) return { photo: ph.object.userData.photos[ph.instanceId] };
  const rm = hits.find((h) => h.object.userData.room);
  return rm ? { room: rm.object.userData.room } : null;
}
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || S.sv) return;
  const h = pick(e);
  if (h && h.photo) openStreet(h.photo);
  else if (h && h.room) showCard(h.room);
  else $('card').hidden = true;
});
let hoverId = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons || S.sv) return;
  const h = pick(e), tip = $('tip');
  renderer.domElement.style.cursor = h ? 'pointer' : '';
  if (h && h.photo) {
    tip.hidden = false; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px';
    if (hoverId !== h.photo.id) { hoverId = h.photo.id; tip.innerHTML = `<img src="${PHOTO_BASE + h.photo.file}" alt=""><b>${esc(h.photo.caption)}</b><br><small>${esc(levelName(h.photo.level))} · kattints a körülnézéshez</small>`; }
  } else if (h && h.room) {
    tip.hidden = false; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px';
    const key = 'r' + h.room.id;
    if (hoverId !== key) { hoverId = key; tip.innerHTML = `<b>${esc(h.room.name)}</b>${h.room.sub ? ' – ' + esc(h.room.sub) : ''}<br><small>${esc(levelName(h.room.level))}</small>`; }
  } else { tip.hidden = true; hoverId = null; }
});
renderer.domElement.addEventListener('pointerleave', () => { $('tip').hidden = true; });

function nearestPhoto(room) {
  const n = D.nodes[room.node];
  let best = null, bd = Infinity;
  for (const p of D.photos) {
    if (p.level !== room.level) continue;
    const d = Math.hypot(p.x - n.x, p.z - n.z);
    if (d < bd) { bd = d; best = p; }
  }
  return bd < 14 ? best : null;
}
function showCard(room) {
  const c = $('card');
  const p = nearestPhoto(room);
  c.innerHTML = `<button class="x" aria-label="Bezárás">×</button><h3>${esc(room.name)}${room.staff ? '<span class="badge">csak tanároknak</span>' : ''}</h3>
    <p>${esc([room.sub, levelName(room.level)].filter(Boolean).join(' · '))}${room.estimated ? ' · becsült elrendezés' : ''}</p>
    <div class="row"><button class="btn primary" data-a="to">Útvonal ide</button><button class="btn" data-a="from">Innen indulok</button>${p ? '<button class="btn" data-a="photo">Fotó a helyről</button>' : ''}</div>`;
  c.hidden = false;
  c.onclick = (e) => {
    const a = e.target.closest('button'); if (!a) return;
    const place = places.find((x) => x.room === room);
    if (a.classList.contains('x')) c.hidden = true;
    else if (a.dataset.a === 'to') { setPlace('to', place); c.hidden = true; }
    else if (a.dataset.a === 'from') { setPlace('from', place); c.hidden = true; }
    else if (a.dataset.a === 'photo') { c.hidden = true; openStreet(p); }
  };
}

// ------------------------------------------------------------ photo view (look around only)
const sv = { cur: null, img: $('svA'), pan: [0, 0], zoom: 1.3 };
const roomsByLevel = {};
for (const r of D.rooms) (roomsByLevel[r.level] ||= []).push(r);
const DIRS = ['észak', 'északkelet', 'kelet', 'délkelet', 'dél', 'délnyugat', 'nyugat', 'északnyugat'];
function setCaption() {
  const p = sv.cur;
  $('svCap').textContent = p.caption;
  $('svSub').textContent = levelName(p.level);
}
function clampPan() {
  const st = $('svStage'), w = st.clientWidth, h = st.clientHeight;
  const mx = (w * (sv.zoom - 1)) / 2, my = (h * (sv.zoom - 1)) / 2;
  sv.pan = [Math.max(-mx, Math.min(mx, sv.pan[0])), Math.max(-my, Math.min(my, sv.pan[1]))];
}
function applyPan(anim) {
  sv.img.style.transition = anim ? 'transform .45s cubic-bezier(.2,.7,.2,1)' : 'none';
  sv.img.style.transform = `translate(${sv.pan[0]}px, ${sv.pan[1]}px) scale(${sv.zoom})`;
}
function setZoom(z, anim = true) { sv.zoom = Math.max(1, Math.min(3, z)); clampPan(); applyPan(anim); }
function loadImg(img, p) {
  return new Promise((res) => { img.onload = img.onerror = () => res(); img.src = PHOTO_BASE + p.file; img.alt = p.caption; if (img.complete && img.naturalWidth) res(); });
}
async function openStreet(p) {
  if (!p) return;
  $('card').hidden = true; $('tip').hidden = true;
  sv.cur = p;
  // the camera dives into the model at eye height, facing the way the photo was taken
  if (S.level !== 'all' && S.level !== p.level) { S.level = p.level; applyLevelMode(); }
  sv.returnTo = { p: camera.position.clone(), t: controls.target.clone() };
  const h = (p.heading * Math.PI) / 180, y = S.levelTarget[p.level] + DY(p) + 1.5;
  const eye = new THREE.Vector3(p.x - Math.sin(h) * 2.5, y, p.z + Math.cos(h) * 2.5);
  const tgt = new THREE.Vector3(p.x + Math.sin(h) * 6, y, p.z - Math.cos(h) * 6);
  controls.minDistance = 0.5; controls.maxPolarAngle = Math.PI * 0.52;
  const loaded = loadImg(sv.img, p);
  await new Promise((res) => flyTo(eye, tgt, 1100, res));
  await loaded;
  S.sv = true;
  sv.pan = [0, 0]; sv.zoom = 1.6; applyPan(false);
  const el = $('sv'); el.hidden = false; void el.offsetWidth; el.classList.add('show');
  requestAnimationFrame(() => setZoom(1.3));
  setCaption(); drawMini();
  $('svBack').focus();
}
function closeStreet() {
  const el = $('sv'); el.classList.remove('show');
  setTimeout(() => { el.hidden = true; }, 350);
  S.sv = null;
  controls.minDistance = 8; controls.maxPolarAngle = Math.PI * 0.47;
  if (sv.returnTo) { flyTo(sv.returnTo.p, sv.returnTo.t, 1000); sv.returnTo = null; }
}
$('svBack').onclick = closeStreet;
$('svZoomIn').onclick = () => setZoom(sv.zoom * 1.25);
$('svZoomOut').onclick = () => setZoom(sv.zoom / 1.25);
addEventListener('keydown', (e) => {
  if (!S.sv) { if (e.key === 'Escape') { $('card').hidden = true; $('help').hidden = true; } return; }
  const step = 80, k = e.key;
  if (k === 'Escape') return closeStreet();
  if (k === 'ArrowLeft') sv.pan[0] += step; else if (k === 'ArrowRight') sv.pan[0] -= step;
  else if (k === 'ArrowUp') sv.pan[1] += step; else if (k === 'ArrowDown') sv.pan[1] -= step;
  else if (k === '+' || k === '=') return setZoom(sv.zoom * 1.25);
  else if (k === '-') return setZoom(sv.zoom / 1.25);
  else return;
  e.preventDefault(); clampPan(); applyPan(true);
});
// drag (mouse or one finger) to look around, wheel or two fingers to zoom
{
  const st = $('svStage'), pts = new Map();
  let drag = null, pinch = null;
  st.addEventListener('pointerdown', (e) => {
    st.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) drag = [e.clientX, e.clientY, ...sv.pan];
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = [Math.hypot(a[0] - b[0], a[1] - b[1]), sv.zoom]; drag = null; }
    st.classList.add('drag');
  });
  st.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; sv.zoom = Math.max(1, Math.min(3, pinch[1] * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch[0])); clampPan(); applyPan(false); return; }
    if (!drag) return;
    sv.pan = [drag[2] + e.clientX - drag[0], drag[3] + e.clientY - drag[1]];
    clampPan(); applyPan(false);
  });
  const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { drag = null; st.classList.remove('drag'); } };
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  st.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(sv.zoom * (e.deltaY < 0 ? 1.12 : 0.89), false); }, { passive: false });
}
// minimap: where the photo was taken and which way it looks
const mini = $('svMini'), mg = mini.getContext('2d');
function drawMini() {
  const p = sv.cur; if (!p) return;
  const W = mini.width, H = mini.height, sc = 6.5;
  const X = (x) => W / 2 + (x - p.x) * sc, Z = (z) => H / 2 + (z - p.z) * sc;
  mg.clearRect(0, 0, W, H);
  const poly = (pts) => { mg.beginPath(); pts.forEach((q, i) => (i ? mg.lineTo(X(q[0]), Z(q[1])) : mg.moveTo(X(q[0]), Z(q[1])))); mg.closePath(); };
  for (const c of D.corridors.filter((c) => c.level === p.level)) { poly(c.poly); mg.fillStyle = c.restricted ? '#f6c9ca' : '#ece9e2'; mg.fill(); }
  for (const r of roomsByLevel[p.level]) {
    poly(r.poly); mg.fillStyle = TYPE[r.type][0]; mg.fill(); mg.strokeStyle = '#8a857b'; mg.lineWidth = 1.5; mg.stroke();
    if (r.area > 20) { mg.font = '600 15px Barlow, sans-serif'; mg.fillStyle = '#3a3733'; mg.textAlign = 'center'; mg.fillText(r.name, X(r.cx), Z(r.cz) + 5); }
  }
  mg.textAlign = 'start';
  if (S.route) {
    mg.beginPath(); let started = false;
    for (const ni of S.route.nodes) { const n = D.nodes[ni]; if (n.level !== p.level) { started = false; continue; } if (!started) { mg.moveTo(X(n.x), Z(n.z)); started = true; } else mg.lineTo(X(n.x), Z(n.z)); }
    mg.strokeStyle = '#E11F26'; mg.lineWidth = 5; mg.stroke();
  }
  const h = (p.heading * Math.PI) / 180;
  mg.beginPath(); mg.moveTo(W / 2, H / 2);
  mg.arc(W / 2, H / 2, 52, h - Math.PI / 2 - 0.55, h - Math.PI / 2 + 0.55); mg.closePath();
  const gr = mg.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 52); gr.addColorStop(0, 'rgba(26,115,232,.6)'); gr.addColorStop(1, 'rgba(26,115,232,0)');
  mg.fillStyle = gr; mg.fill();
  mg.beginPath(); mg.arc(W / 2, H / 2, 9, 0, 7); mg.fillStyle = '#fff'; mg.fill(); mg.beginPath(); mg.arc(W / 2, H / 2, 6.5, 0, 7); mg.fillStyle = '#1a73e8'; mg.fill();
  mg.fillStyle = 'rgba(255,255,255,.85)'; mg.fillRect(0, 0, W, 34);
  mg.font = '600 20px Barlow, sans-serif'; mg.fillStyle = '#2b2a29'; mg.fillText(`${levelName(p.level)} · itt készült a kép`, 10, 24);
}
// photo nearest to the destination ("így néz ki ott")
function photoNear(node) {
  const n = D.nodes[node]; let best = null, bd = 12;
  for (const p of D.photos) { if (p.level !== n.level) continue; const d = Math.hypot(p.x - n.x, p.z - n.z); if (d < bd) { bd = d; best = p; } }
  return best;
}
$('walkBtn').addEventListener('click', () => { const p = S.route && photoNear(S.route.nodes[S.route.nodes.length - 1]); if (p) openStreet(p); });

// ------------------------------------------------------------ render loop
applyLevelMode();
camera.position.set(-30, 190, 230);
controls.target.set(0, 8, 2);
homeView();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (camAnim) {
    const t = Math.min(1, (now - camAnim.start) / camAnim.ms), k = ease(t);
    camera.position.lerpVectors(camAnim.p0, camAnim.p1, k);
    controls.target.lerpVectors(camAnim.t0, camAnim.t1, k);
    if (t >= 1) { const d = camAnim.done; camAnim = null; d && d(); }
  }
  const moved = updateLevels(dt);
  if (moved || !stairGroup.children.length) { buildStairs(); if (S.route) drawRoute(); }
  animateChevrons(now / 1000);
  // labels: declutter by distance & level visibility
  const camPos = camera.position;
  for (const o of labels) {
    const r = o.userData.room, g = levelGroups[r.level];
    const lvOk = S.alphaTarget[r.level] > 0.5;
    const d = camPos.distanceTo(o.getWorldPosition(tmpV));
    const big = r.area > 70 || r.type === 'special' || r.type === 'stair';
    const isTarget = S.to && S.to.room === r;
    o.visible = !S.sv && g.visible && lvOk && (isTarget || d < (big ? 120 : 62) * (S.level === 'all' ? 0.8 : 1.15));
  }
  for (const lv of LEVELS) levelGroups[lv].userData.tag.visible = S.level === 'all' && !S.sv;
  for (const o of extraTags) o.visible = !S.sv && levelGroups[o.userData.level].visible && S.alphaTarget[o.userData.level] > 0.5;
  if (pinStart) { pinStart.visible = pinEnd.visible = !S.sv; }
  { const dcam = camera.position.distanceTo(controls.target); scene.fog.near = dcam * 1.4 + 40; scene.fog.far = dcam * 3 + 200; }
  if (!S.sv) controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}
const tmpV = new THREE.Vector3();
requestAnimationFrame(frame);
