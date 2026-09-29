// ============================================================
// fmd 生日 · 3D 第一人称自由飞行祝福游戏
// 你驾驶一架小飞机在真实地球上空自由飞行，没有固定航线；
// 20 位朋友分别驾驶小飞机，散落在一颗巨大的爱心路线上等你靠近，
// 靠近即收到祝福。集齐 20 份祝福后镜头拉高，揭晓你一路飞出的轨迹——
// 因为朋友都沿着爱心排布，你的航迹自然汇成一颗爱心，
// 随后烟花绽放、生日蛋糕升起、祝福横幅亮出。
// 技术栈：Three.js（本地引入，无外部依赖）
// ============================================================

import * as THREE from './three.module.js';
import { BLESSINGS } from './blessings.js';
import { Music } from './audio.js';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const startOverlay = $('startOverlay');
const startBtn = $('startBtn');
const blessingCard = $('blessingCard');
const successOverlay = $('successOverlay');
const replayBtn = $('replayBtn');
const soundBtn = $('soundBtn');
const hud = $('hud');
const progressBar = $('progressBar');
const countNum = $('countNum');
const hudTip = $('hudTip');
const blessingAvatar = $('blessingAvatar');
const blessingName = $('blessingName');
const blessingMessage = $('blessingMessage');
const cockpit = $('cockpit');
const friendArrow = $('friendArrow');

// ---------- 常量 ----------
const TOTAL = BLESSINGS.length;    // 20
const SPEED = 2;                   // 前进速度（世界单位/秒，最慢）
const TURN_RATE = 1.5;             // 偏航角速度（弧度/秒）
const PITCH_RATE = 1.0;            // 俯仰角速度（弧度/秒）
const PITCH_LIMIT = 0.9;           // 俯仰角限制（弧度）
const ROLL_FACTOR = 1.3;           // 转弯时自动滚转的强度
const COLLECT_RADIUS = 18;         // 靠近即触发
const MIN_ALT = 7;                 // 最低飞行高度（贴海面/地面飞）
const MAX_ALT = 30;                // 最高飞行高度
const BOUND_RADIUS = 150;          // 世界软边界
const SMOOTH = 6.0;

const ALTITUDE = 10;               // 朋友爱心航线所在的基准高度（贴地）
const GROUND_CLEARANCE = 4;        // 飞机离地表的固定间隙（始终贴地飞）

// ---------- 状态 ----------
let state = 'idle';                // idle | playing | reading | success
let collected = new Array(TOTAL).fill(false);
let count = 0;
let readingTimer = 0;

// 自由飞行状态
const planePos = new THREE.Vector3(0, ALTITUDE, 55);   // 出生在爱心前方偏后
let heading = 0;      // 偏航角（绕 Y）
let pitchV = 0;       // 俯仰角（绕 X）
let roll = 0;         // 滚转角（绕 Z，自动）
let turnInput = 0;    // -1..1，+1 右转
let pitchInput = 0;   // -1..1，+1 爬升
let forward = new THREE.Vector3(0, 0, -1);

// 揭晓镜头
let revealStart = -1;
let revealFromPos = new THREE.Vector3();
let revealFromQuat = new THREE.Quaternion();
let revealPos = new THREE.Vector3();
let revealQuat = new THREE.Quaternion();

// ---------- 渲染器 / 场景 / 相机 ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe8ff, 260, 900);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1400);
camera.position.set(0, ALTITUDE, 90);

// ---------- 天空 ----------
function makeSky(sky) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, sky[0]);
  g.addColorStop(0.55, sky[1]);
  g.addColorStop(1, sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}

// ---------- 纹理工具 ----------
function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function emojiTexture(emoji, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(size * 0.8)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}



// ---------- 场景预设（多场景：不同海岛配色 + 天空 + 云量） ----------
const SCENES = [
  {
    name: '暮光海岛',
    sky: ['#34527f', '#5d74b0', '#8a86c0'], fog: 0x5f6fae,
    ocean: 0x2f5f8f, beach: 0x6f8f86, grass: 0x5a8f68, deep: 0x3d7452, rock: 0x62786e, snow: 0xb8c6c2,
    cloudCount: 26,
  },
  {
    name: '雾蓝湖泊',
    sky: ['#2c4468', '#50679a', '#7a7fae'], fog: 0x50648f,
    ocean: 0x2a5880, beach: 0x64887c, grass: 0x528a62, deep: 0x3c704d, rock: 0x58706a, snow: 0xb4c4c0,
    cloudCount: 20,
  },
  {
    name: '靛紫星河',
    sky: ['#202650', '#3c4480', '#5c5e92'], fog: 0x404a86,
    ocean: 0x264778, beach: 0x647e8c, grass: 0x4c7868, deep: 0x375e4c, rock: 0x556878, snow: 0xaebcc6,
    cloudCount: 18,
  },
];

const world = new THREE.Group();
scene.add(world);

// 用于记录云朵，供主循环轻微漂移
const clouds = [];
let sceneIndex = 0;
let sceneName = SCENES[0].name;

// 当前场景的岛屿数据 + 地形高度采样（贴地飞行需要每帧采样地形高度）
let ISLANDS = [];
function heightAt(x, z) {
  let h = 0;
  for (const is of ISLANDS) {
    const dx = x - is.x, dz = z - is.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < is.radius) {
      const t = 1 - d / is.radius;   // 0（边缘）~ 1（中心）
      const ridge = 0.7 + 0.3 * Math.sin(x * 0.18 + is.seed) * Math.cos(z * 0.15 + is.seed);
      const bump = Math.pow(t, 1.6) * is.height * ridge;
      if (bump > h) h = bump;
    }
  }
  return h;
}

function buildTerrain(cfg) {
  // 清空上一场景的地形与云朵
  while (world.children.length) world.remove(world.children[0]);
  clouds.length = 0;

  const SIZE = 520;   // 地形总边长
  const SEG = 96;     // 网格分段（决定低多边形的面数）
  const SEA = 0;      // 海平面

  // 岛屿：位置 + 半径 + 高度 + 随机种子，散落在飞行区域四周（更密一些）
  ISLANDS = [
    { x: 0, z: 0, radius: 40, height: 9, seed: 1.3 },
  ];
  const N = 24;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.random() * 0.5;
    const r = 30 + Math.random() * 78;
    ISLANDS.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      radius: 16 + Math.random() * 26,
      height: 3 + Math.random() * 5,
      seed: Math.random() * Math.PI * 2,
    });
  }

  // 非索引化，保证每个三角面有独立顶点 → 真正的低多边形硬边 + 每面纯色
  let geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  geo = geo.toNonIndexed();

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);

    // 按高度给每个面着色：海 → 浅滩 → 草地 → 深绿 → 山岩 → 雪
    if (y <= SEA + 0.5) c.set(cfg.ocean);
    else if (y <= 1.8) c.set(cfg.beach);
    else if (y <= 6) c.set(cfg.grass);
    else if (y <= 12) c.set(cfg.deep);
    else if (y <= 18) c.set(cfg.rock);
    else c.set(cfg.snow);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0.0 })
  );
  world.add(terrain);

  // 卷云：白色半透明丝带状面片（参考 Tiny Skies 的流动卷云）
  const cloudTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 32, 6, 128, 32, 120);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 64);
    return new THREE.CanvasTexture(c);
  })();
  for (let i = 0; i < cfg.cloudCount; i++) {
    const w = 30 + Math.random() * 34;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, opacity: 0.28 + Math.random() * 0.22, depthWrite: false,
    }));
    spr.scale.set(w, w * 0.2, 1);
    spr.position.set((Math.random() - 0.5) * 420, 66 + Math.random() * 42, (Math.random() - 0.5) * 420);
    world.add(spr);
    clouds.push(spr);
  }
}

// 应用某个场景：切换天空、雾色、地形配色与云量
function applyScene(i) {
  sceneIndex = i;
  const cfg = SCENES[i];
  sceneName = cfg.name;
  scene.fog.color.set(cfg.fog);
  makeSky(cfg.sky);
  buildTerrain(cfg);
}
applyScene(Math.floor(Math.random() * SCENES.length));

// ---------- 爱心（朋友航点的排布，非固定航线） ----------
const HEART_N = 720;
function buildHeartPath(halfWidth) {
  const raw = [];
  const M = 720;
  for (let i = 0; i <= M; i++) {
    const t = (i / M) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push({ x, y });
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of raw) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY);
  const scale = (halfWidth * 2) / span;
  return raw.map(p => new THREE.Vector3((p.x - cx) * scale, ALTITUDE, -(p.y - cy) * scale));
}

const heartPath = buildHeartPath(58);   // 更大的爱心（半宽 58）
const HEART_RADIUS = 58;

// 揭晓用的发光爱心管（仅在结局渐显，作为轨迹的光晕底衬）
let heartGlow = null;
let heartCoreGlow = null;
(function buildHeartGlow() {
  const curve = new THREE.CatmullRomCurve3(heartPath, true, 'centripetal', 0.5);
  heartGlow = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 360, 1.4, 16, true),
    new THREE.MeshBasicMaterial({ color: 0xff8fb8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  heartGlow.visible = false;
  scene.add(heartGlow);
  heartCoreGlow = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 360, 0.34, 12, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  heartCoreGlow.visible = false;
  scene.add(heartCoreGlow);
})();

// 玩家实际飞行轨迹（随记录逐渐绘出，结局揭示爱心）
const TRAIL_MAX = 4000;
const trailPts = [];
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
  color: 0xffd9ec, transparent: true, opacity: 0.95,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
trailLine.visible = false;
scene.add(trailLine);

// ---------- 飞机构造 ----------
function buildPlane({ accent = 0xff6fa5, body = 0xffffff, scale = 1 } = {}) {
  const g = new THREE.Group();
  const fus = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 2.0, 14),
    new THREE.MeshStandardMaterial({ color: body, roughness: 0.5 })
  );
  fus.rotation.x = Math.PI / 2;   // 机身沿 Z 轴
  g.add(fus);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.7, 14),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4 })
  );
  nose.rotation.x = Math.PI / 2;  // 尖指向 -Z（机头方向）
  nose.position.z = -1.3;
  g.add(nose);

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x9fd0ff, roughness: 0.3 })
  );
  canopy.scale.set(0.7, 0.7, 1.2);
  canopy.position.set(0, 0.26, -0.3);
  g.add(canopy);

  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.07, 0.85),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 })
  );
  wing.position.z = 0.05;
  g.add(wing);

  const tailWing = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.07, 0.4),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 })
  );
  tailWing.position.z = 0.85;
  g.add(tailWing);

  const fin = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.5, 0.42),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 })
  );
  fin.position.set(0, 0.27, 0.82);
  g.add(fin);

  const prop = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.95, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xffd98a, roughness: 0.4 })
    );
    blade.rotation.z = (i / 3) * Math.PI * 2;
    prop.add(blade);
  }
  prop.position.z = -1.7;
  g.add(prop);
  g.userData.prop = prop;
  g.scale.setScalar(scale);
  return g;
}

// 玩家飞机：第三人称时显示整机，第一人称时隐藏
const plane = buildPlane({ body: 0x9fce90, accent: 0xe8d8ae, scale: 0.95 });
plane.visible = true;
scene.add(plane);

// ---------- 视角模式：默认第三人称追尾，按 C 切换第一人称 ----------
let viewMode = 'third';   // 'third' | 'first'
// 第一人称轻微下俯（只需一点点，看向机头前方）
const camDownQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0, 0));

// 根据视角切换飞机显隐 + 挡风框显隐
function applyViewMode() {
  const first = (viewMode === 'first');
  plane.visible = !first;
  cockpit.hidden = !first;   // 只有第一人称显示挡风框，第三人称不要
}
function toggleView() {
  viewMode = (viewMode === 'third') ? 'first' : 'third';
  applyViewMode();
}

// ---------- 灯光（偏冷的柔和漫射，贴合暮光氛围） ----------
scene.add(new THREE.AmbientLight(0xe8ecff, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(50, 90, 35);
scene.add(sun);
const rim = new THREE.DirectionalLight(0xa8c4ff, 0.5);
rim.position.set(-35, 30, -25);
scene.add(rim);

// ---------- 20 位朋友的小飞机 ----------
const friends = [];
function buildFriendPlane(color, emoji) {
  // 每位朋友 = 一架低多边形小飞机（机身用专属主题色，机翼米白）
  const g = buildPlane({ body: color, accent: 0xf0e8d4, scale: 0.72 });

  // 头顶一个「小号」emoji + 一圈细而亮的彩色光环：明显但不过分
  const emojiSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(emoji), transparent: true, depthWrite: false }));
  emojiSpr.scale.set(1.4, 1.4, 1);
  emojiSpr.position.y = 1.2;
  g.add(emojiSpr);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'),
    color, transparent: true, opacity: 0.5, depthWrite: false,
  }));
  glow.scale.set(4.5, 4.5, 1);
  glow.position.y = 0.2;
  g.add(glow);

  return g;
}

function makeFriends() {
  const curve = new THREE.CatmullRomCurve3(heartPath, true, 'centripetal', 0.5);
  for (let i = 0; i < TOTAL; i++) {
    const t = (i / TOTAL) + (Math.random() - 0.5) * 0.025 + 1;
    const tt = t % 1;
    const pt = curve.getPointAt(tt);
    const tan = curve.getTangentAt(tt);
    const n = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const lat = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.9);
    const vert = (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.9);

    const friend = buildFriendPlane(BLESSINGS[i].color, BLESSINGS[i].emoji);
    const p = pt.clone().addScaledVector(n, lat * 9);
    p.y += vert * 5;
    friend.position.copy(p);
    friend.up.set(0, 1, 0);
    // 让机头（-Z）指向切线方向，正确向前飞
    friend.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tan.normalize());

    scene.add(friend);
    friends.push({
      group: friend,
      pos: p,
      collected: false,
      baseY: p.y,
      phase: Math.random() * Math.PI * 2,
    });
  }
}
makeFriends();

// ---------- 粒子系统 ----------
class Particles {
  constructor(max, { size = 0.5, gravity = 0, map } = {}) {
    this.max = max;
    this.gravity = gravity;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.p = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.alive = new Array(max).fill(false);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({
      size, map: map || glowTexture(),
      vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
  }

  spawn(worldPos, vel, color, life = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = worldPos.x; this.pos[i * 3 + 1] = worldPos.y; this.pos[i * 3 + 2] = worldPos.z;
    this.p[i * 3] = vel.x; this.p[i * 3 + 1] = vel.y; this.p[i * 3 + 2] = vel.z;
    this.life[i] = life; this.maxLife[i] = life;
    const c = new THREE.Color(color);
    this.base[i * 3] = c.r; this.base[i * 3 + 1] = c.g; this.base[i * 3 + 2] = c.b;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.alive[i] = true;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = false;
        this.pos[i * 3 + 1] = -9999;
        this.col[i * 3] = 0; this.col[i * 3 + 1] = 0; this.col[i * 3 + 2] = 0;
        continue;
      }
      this.p[i * 3 + 1] -= this.gravity * dt;
      this.pos[i * 3] += this.p[i * 3] * dt;
      this.pos[i * 3 + 1] += this.p[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.p[i * 3 + 2] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  burst(pos, color, n = 40, speed = 7, life = 1) {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.spawn(pos, new THREE.Vector3(sp * Math.sin(ph) * Math.cos(th), sp * Math.sin(ph) * Math.sin(th), sp * Math.cos(ph)), color, life * (0.7 + Math.random() * 0.6));
    }
  }
}

const trailFx = new Particles(320, { size: 0.9, gravity: 0 });
const collectBurst = new Particles(600, { size: 0.7, gravity: 1.0 });
const firework = new Particles(2200, { size: 0.7, gravity: 2.4 });
const fireColors = [0xffd98a, 0xff9ec7, 0xc9b6ff, 0xffc9a9, 0xffffff, 0xffa0a0];
let fireworkTimer = 0;

function spawnFirework() {
  const x = (Math.random() - 0.5) * 56;
  const y = ALTITUDE + 8 + Math.random() * 30;
  const z = (Math.random() - 0.5) * 48;
  const color = fireColors[Math.floor(Math.random() * fireColors.length)];
  for (let i = 0; i < 110; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const sp = 10 * (0.5 + Math.random());
    firework.spawn(new THREE.Vector3(x, y, z), new THREE.Vector3(sp * Math.sin(ph) * Math.cos(th), sp * Math.sin(ph) * Math.sin(th), sp * Math.cos(ph) * 0.5), color, 1.4 * (0.6 + Math.random() * 0.6));
  }
}

// ---------- 蛋糕 ----------
const cake = buildCake();
cake.visible = false;
scene.add(cake);
let cakeLight = null;

function buildCake() {
  const g = new THREE.Group();
  const make = (r, h, color) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 }));

  const plate = make(3.6, 0.3, 0xfff3e0); plate.position.y = -2.5; g.add(plate);
  const l1 = make(3.1, 1.5, 0xff9ec7); l1.position.y = -1.55; g.add(l1);
  const l2 = make(2.4, 1.3, 0xfff7ef); l2.position.y = -0.12; g.add(l2);
  const l3 = make(1.65, 1.1, 0xffd98a); l3.position.y = 1.0; g.add(l3);

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
    dot.position.set(Math.cos(a) * 3.1, -0.8, Math.sin(a) * 3.1);
    g.add(dot);
  }

  const flames = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.75, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    candle.position.set(Math.cos(a) * 1.05, 1.9, Math.sin(a) * 1.05);
    g.add(candle);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffc966 }));
    flame.position.set(Math.cos(a) * 1.05, 2.38, Math.sin(a) * 1.05);
    g.add(flame);
    flames.push(flame);
  }

  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.6;
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 10), new THREE.MeshStandardMaterial({ color: 0xe5484d, roughness: 0.35 }));
    berry.position.set(Math.cos(a) * 1.65, 1.6, Math.sin(a) * 1.65);
    g.add(berry);
  }

  const num = new THREE.Sprite(new THREE.SpriteMaterial({
    map: (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const ctx = c.getContext('2d');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 170px "ZCOOL KuaiLe", "Microsoft YaHei", sans-serif';
      ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 14; ctx.strokeText('20', 128, 140);
      ctx.fillStyle = '#ffffff'; ctx.fillText('20', 128, 140);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
    })(),
    transparent: true, depthWrite: false,
  }));
  num.scale.set(3.6, 3.6, 1);
  num.position.y = 4.5;
  g.add(num);

  g.userData.flames = flames;
  g.position.set(0, ALTITUDE, 0);
  g.scale.setScalar(0.01);
  return g;
}

// ---------- 输入 ----------
let keyActive = false;
let keyTurn = 0, keyPitch = 0;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function onPointer(clientX, clientY) {
  if (keyActive) return;
  turnInput = clamp((clientX / window.innerWidth) * 2 - 1, -1, 1);
  pitchInput = clamp(-((clientY / window.innerHeight) * 2 - 1), -1, 1);
}
window.addEventListener('pointermove', (e) => onPointer(e.clientX, e.clientY));
window.addEventListener('pointerdown', (e) => onPointer(e.clientX, e.clientY));

function recomputeKeys() {
  if (keyTurn !== 0 || keyPitch !== 0) {
    keyActive = true;
    turnInput = keyTurn;
    pitchInput = keyPitch;
  } else {
    keyActive = false;
  }
}

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'c' || k === 'C') { toggleView(); return; }
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') keyTurn = -1;
  if (k === 'ArrowRight' || k === 'd' || k === 'D') keyTurn = 1;
  if (k === 'ArrowUp' || k === 'w' || k === 'W') keyPitch = 1;
  if (k === 'ArrowDown' || k === 's' || k === 'S') keyPitch = -1;
  recomputeKeys();
});
window.addEventListener('keyup', (e) => {
  const k = e.key;
  if (['ArrowLeft', 'a', 'A'].includes(k)) keyTurn = keyTurn === -1 ? 0 : keyTurn;
  if (['ArrowRight', 'd', 'D'].includes(k)) keyTurn = keyTurn === 1 ? 0 : keyTurn;
  if (['ArrowUp', 'w', 'W'].includes(k)) keyPitch = keyPitch === 1 ? 0 : keyPitch;
  if (['ArrowDown', 's', 'S'].includes(k)) keyPitch = keyPitch === -1 ? 0 : keyPitch;
  recomputeKeys();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 收集逻辑 ----------
function collectFriend(i) {
  collected[i] = true;
  friends[i].collected = true;
  friends[i].group.visible = false;
  count++;
  updateHUD();

  collectBurst.burst(friends[i].pos, BLESSINGS[i].color, 40, 9, 1.1);

  blessingAvatar.textContent = BLESSINGS[i].emoji;
  blessingName.style.display = 'none';
  blessingMessage.textContent = BLESSINGS[i].msg;
  blessingCard.hidden = false;

  state = 'reading';
  readingTimer = 5.5;
}

function dismissCard() {
  blessingCard.hidden = true;
  if (state === 'reading') {
    if (count >= TOTAL) beginSuccess();
    else state = 'playing';
  }
}
blessingCard.addEventListener('click', dismissCard);
blessingCard.addEventListener('touchend', (e) => { e.preventDefault(); dismissCard(); });

function updateHUD() {
  countNum.textContent = count;
  progressBar.style.width = `${(count / TOTAL) * 100}%`;
  if (count === 0) hudTip.textContent = `「${sceneName}」自由飞行，飞到朋友身边`;
  else if (count < TOTAL) hudTip.textContent = `已收到 ${count} 份祝福，继续飞 ✨`;
}

// 屏幕上的「最近朋友」方向箭头：指向离玩家最近、还没收集的朋友
function updateArrow() {
  if (state !== 'playing') { friendArrow.hidden = true; return; }
  let best = null, bestD = Infinity;
  for (const f of friends) {
    if (f.collected) continue;
    const d = planePos.distanceToSquared(f.group.position);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (!best) { friendArrow.hidden = true; return; }

  const camDir = best.group.position.clone().sub(camera.position);
  const inv = new THREE.Quaternion().copy(camera.quaternion).invert();
  camDir.applyQuaternion(inv);   // 转到相机局部空间：x 右、y 上、-z 前方
  const horiz = Math.atan2(camDir.x, -camDir.z);   // 相对正前方的水平方位角
  friendArrow.style.transform = `translate(-50%, -50%) rotate(${horiz}rad)`;
  friendArrow.hidden = false;
}

// ---------- 成功流程 ----------
function smoothstep(x) { return x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x); }

function beginSuccess() {
  state = 'success';
  revealStart = elapsed;
  hudTip.textContent = '飞行成功！看看你飞出的爱心吧 🎉';
  plane.visible = true;

  revealFromPos.copy(camera.position);
  revealFromQuat.copy(camera.quaternion);

  // 计算能容纳整颗爱心的揭晓镜头
  const vh = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const d = HEART_RADIUS * 1.35 * vh * Math.max(1, 1 / camera.aspect);
  revealPos.set(0, ALTITUDE + d * 0.85, d * 0.5);
  const rm = new THREE.Matrix4().lookAt(revealPos, new THREE.Vector3(0, ALTITUDE, 0), new THREE.Vector3(0, 1, 0));
  revealQuat.setFromRotationMatrix(rm);

  // 把已记录的轨迹写进线段几何，准备揭晓
  const arr = trailGeo.getAttribute('position').array;
  for (let i = 0; i < trailPts.length && i < TRAIL_MAX; i++) {
    arr[i * 3] = trailPts[i].x; arr[i * 3 + 1] = trailPts[i].y; arr[i * 3 + 2] = trailPts[i].z;
  }
  trailGeo.setDrawRange(0, Math.min(trailPts.length, TRAIL_MAX));
  trailGeo.getAttribute('position').needsUpdate = true;
  trailLine.visible = true;

  cake.visible = true;
  cakeLight = new THREE.PointLight(0xffc966, 90, 90, 1.6);
  cakeLight.position.set(0, ALTITUDE + 8, 10);
  scene.add(cakeLight);

  setTimeout(() => { successOverlay.hidden = false; }, 3400);
}

function resetRun() {
  collected = new Array(TOTAL).fill(false);
  count = 0;
  heading = 0; pitchV = 0; roll = 0;
  turnInput = 0; pitchInput = 0;
  planePos.set(0, ALTITUDE, 55);
  forward.set(0, 0, -1);
  trailPts.length = 0;
  fireworkTimer = 0; revealStart = -1;
  // 每局换个场景，增加飞行新鲜感
  applyScene((sceneIndex + 1) % SCENES.length);
  updateHUD();
  blessingCard.hidden = true;
  successOverlay.hidden = true;
  cake.visible = false;
  cake.scale.setScalar(0.01);
  applyViewMode();
  trailLine.visible = false;
  heartGlow.visible = false; heartGlow.material.opacity = 0;
  heartCoreGlow.visible = false; heartCoreGlow.material.opacity = 0;
  if (cakeLight) { scene.remove(cakeLight); cakeLight = null; }
  friends.forEach((f) => { f.collected = false; f.group.visible = true; });
  state = 'playing';
}

// ---------- 首屏 / 重播 / 音乐 ----------
const music = new Music();

startBtn.addEventListener('click', () => {
  music.start();
  music.muted = false;
  soundBtn.textContent = '🔊';
  startOverlay.hidden = true;
  hud.hidden = false;
  soundBtn.hidden = false;
  applyViewMode();
  state = 'playing';
});

replayBtn.addEventListener('click', () => {
  successOverlay.hidden = true;
  resetRun();
});

soundBtn.addEventListener('click', () => {
  const muted = music.toggleMute();
  soundBtn.textContent = muted ? '🔇' : '🔊';
});

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let elapsed = 0;

function recordTrail() {
  const last = trailPts[trailPts.length - 1];
  if (!last || last.distanceToSquared(planePos) > 1.2) {
    trailPts.push(planePos.clone());
    if (trailPts.length > TRAIL_MAX) trailPts.shift();
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  let targetSpeed = 0;
  if (state === 'playing') targetSpeed = 1;
  else if (state === 'reading') targetSpeed = 0.06;

  // 自由飞行：偏航转向 + 恒定速度前进，机身一路贴着地形表面
  if (state === 'playing' || state === 'reading') {
    heading += turnInput * TURN_RATE * dt * targetSpeed;
    const bankTarget = clamp(turnInput * ROLL_FACTOR, -0.85, 0.85);
    roll += (bankTarget - roll) * (1 - Math.exp(-6 * dt));

    // 机头俯仰跟随地形坡度，自动贴着地表起伏（不再受按键控制、也不会飞高）
    const slope = clamp(Math.atan2(heightAt(planePos.x + forward.x * 8, planePos.z + forward.z * 8) - heightAt(planePos.x, planePos.z), 8) * 0.7, -0.5, 0.5);
    pitchV += (slope - pitchV) * (1 - Math.exp(-5 * dt));

    // 摆正机头（-Z 即前进方向）
    plane.quaternion.setFromEuler(new THREE.Euler(pitchV, heading, roll, 'YXZ'));
    forward.set(0, 0, -1).applyQuaternion(plane.quaternion);

    planePos.addScaledVector(forward, SPEED * targetSpeed);

    // 高度锁定贴地：始终 = 地形高度 + 固定离地间隙
    planePos.y += (heightAt(planePos.x, planePos.z) + GROUND_CLEARANCE - planePos.y) * (1 - Math.exp(-10 * dt));

    // 水平边界约束（软性拉回）
    const hdist = Math.hypot(planePos.x, planePos.z);
    if (hdist > BOUND_RADIUS) {
      const k = BOUND_RADIUS / hdist;
      planePos.x *= k; planePos.z *= k;
    }

    plane.position.copy(planePos);
    if (plane.userData.prop) plane.userData.prop.rotation.z -= dt * 45;

    recordTrail();

    // 尾迹粒子
    const tail = planePos.clone().addScaledVector(forward, -2.4);
    trailFx.spawn(tail.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8)), new THREE.Vector3(), 0xfff2d9, 0.9);
  }

  // 相机：默认第三人称追尾，切第一人称时贴到机头
  if (state === 'playing' || state === 'reading') {
    if (viewMode === 'first') {
      const camOffset = new THREE.Vector3(0, 0.55, 0.5).applyQuaternion(plane.quaternion);
      camera.position.copy(planePos).add(camOffset);
      camera.quaternion.copy(plane.quaternion).multiply(camDownQuat);
    } else {
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);  // 机尾方向
      const desired = planePos.clone().addScaledVector(back, 20).add(new THREE.Vector3(0, 9, 0));
      camera.position.lerp(desired, 1 - Math.exp(-5 * dt));
      const lookTarget = planePos.clone().addScaledVector(forward, 10);
      camera.lookAt(lookTarget);
    }
  }

  // 朋友飞机：浮动 + 靠近检测
  for (let i = 0; i < TOTAL; i++) {
    const f = friends[i];
    if (f.collected) continue;
    const sway = Math.sin(elapsed * 1.6 + f.phase) * 0.5;
    f.group.position.y = f.baseY + sway;
    f.group.rotation.z += Math.sin(elapsed * 0.8 + f.phase) * 0.002;
    if (state === 'playing') {
      if (planePos.distanceTo(f.group.position) < COLLECT_RADIUS) collectFriend(i);
    }
  }

  // 读取计时
  if (state === 'reading') {
    readingTimer -= dt;
    if (readingTimer <= 0) dismissCard();
  }

  // 成功阶段
  if (state === 'success') {
    const reveal = revealStart < 0 ? 0 : Math.min(1, (elapsed - revealStart) / 3.0);
    const t = smoothstep(reveal);

    camera.position.lerpVectors(revealFromPos, revealPos, t);
    camera.quaternion.slerpQuaternions(revealFromQuat, revealQuat, t);

    if (reveal > 0.2) {
      heartGlow.visible = true; heartCoreGlow.visible = true;
      heartGlow.material.opacity = Math.min(0.8, t * 1.3);
      heartCoreGlow.material.opacity = Math.min(1, t * 1.3);
    }
    if (reveal > 0.35) {
      fireworkTimer -= dt;
      if (fireworkTimer <= 0) { spawnFirework(); spawnFirework(); fireworkTimer = 0.26; }
    }
    if (reveal > 0.1) {
      const k = 1 - Math.exp(-3.5 * dt);
      cake.scale.setScalar(cake.scale.x + (1 - cake.scale.x) * k);
      cake.rotation.y += dt * 0.5;
    }
    if (cake.userData.flames) {
      cake.userData.flames.forEach((f, idx) => { f.scale.setScalar(0.9 + Math.sin(elapsed * 18 + idx) * 0.15); });
    }
  }

  // 云朵轻微漂移
  for (let i = 0; i < clouds.length; i++) {
    clouds[i].position.x += dt * 2.2;
    if (clouds[i].position.x > 260) clouds[i].position.x = -260;
  }

  // 更新粒子
  trailFx.update(dt);
  collectBurst.update(dt);
  firework.update(dt);

  updateArrow();

  renderer.render(scene, camera);
}

animate();