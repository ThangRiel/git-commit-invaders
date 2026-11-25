import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import fallbackContributions from '../../contributions.json';
import { ArcadeAudio } from '../audio';
import { createPlayerShip, PlayerShipRig } from '../models/playerShip';
import {
  createBlockCircuitTexture,
  createContactShadowTexture,
  createDayLabelTexture,
  createDeckGridTexture,
  createStarSpriteTexture,
} from '../textures';
import {
  CameraPreset,
  ContributionEntry,
  EnemyState,
  FireMode,
  GameHudState,
  GamePhase,
  UpgradeKind,
} from '../types';

const ARENA_HALF_WIDTH = 24.5;
const PLAYER_Z = 10.5;
const PLAYER_SPEED = 26.5;
const SHOT_COOLDOWN_MS = 300;
const DIVE_INTERVAL_MS = 1500;
const BULLET_SPEED = 40;
const DIVE_SPEED_BASE = 9.0;
const MAX_BULLETS = 128;
const MAX_PICKUPS = 16;
const MAX_PARTICLES = 480;
const BEST_SCORE_STORAGE_KEY = 'git_commit_invaders_best_score';

const GIT_COLORS_HEX = [0x161b22, 0x0e4429, 0x006d32, 0x26a641, 0x39d353];
const LEVEL_HEIGHTS = [0.2, 0.56, 0.94, 1.34, 1.78];

const UPGRADE_COLORS: Record<UpgradeKind, number> = {
  rapid: 0xfacc15,
  multishot: 0x22d3ee,
  shield: 0x38bdf8,
  double_score: 0x4ade80,
  weapon: 0xe879f9,
};

const UPGRADE_LABELS: Record<UpgradeKind, string> = {
  rapid: 'Overdrive (2x Fire Rate)',
  multishot: 'Multi-Barrel (+Cannons)',
  shield: 'Plasma Shield',
  double_score: '2x Score Surge',
  weapon: 'Weapon Core Boost',
};

const CAMERA_PRESETS: Record<
  CameraPreset,
  { pos: [number, number, number]; look: [number, number, number]; followX: number; lookFollowX: number }
> = {
  arcade: { pos: [0, 23.5, 27.5], look: [0, 0.2, -1.0], followX: 0.82, lookFollowX: 0.92 },
  top: { pos: [0, 39.0, 6.0], look: [0, 0, -2.0], followX: 0.85, lookFollowX: 0.92 },
  dynamic: { pos: [0, 14.5, 25.5], look: [0, 0.8, -3.0], followX: 0.88, lookFollowX: 0.95 },
};

// Reusable math objects (zero GC inside animation loop)
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _diveColor = new THREE.Color(0xff6b57);
const _flashColor = new THREE.Color(0xe0f2fe);
const _raycaster = new THREE.Raycaster();
const _pointerNdc = new THREE.Vector2();
const _arenaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _rayHit = new THREE.Vector3();

interface Bullet {
  active: boolean;
  x: number;
  y: number;
  z: number;
  prevX: number;
  prevZ: number;
  baseX: number;
  vx: number;
  vz: number;
  waveAmp: number;
  wavePhase: number;
  waveFreq: number;
  pierceLeft: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  colorHex: number;
  trailAccum: number;
  hitSet: Set<number>;
}

interface Pickup {
  active: boolean;
  kind: UpgradeKind;
  x: number;
  y: number;
  z: number;
  vz: number;
  spin: number;
  colorHex: number;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

function segmentIntersectsAABB(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  cx: number,
  cz: number,
  halfW: number,
  halfZ: number
): boolean {
  const minX = cx - halfW;
  const maxX = cx + halfW;
  const minZ = cz - halfZ;
  const maxZ = cz + halfZ;

  let tMin = 0;
  let tMax = 1;

  const dx = x1 - x0;
  if (Math.abs(dx) < 1e-6) {
    if (x0 < minX || x0 > maxX) return false;
  } else {
    const invDx = 1 / dx;
    let t1 = (minX - x0) * invDx;
    let t2 = (maxX - x0) * invDx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  const dz = z1 - z0;
  if (Math.abs(dz) < 1e-6) {
    if (z0 < minZ || z0 > maxZ) return false;
  } else {
    const invDz = 1 / dz;
    let t1 = (minZ - z0) * invDz;
    let t2 = (maxZ - z0) * invDz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  return true;
}

function detectSoftwareWebGL(): boolean {
  const probeCanvas = document.createElement('canvas');
  const gl = probeCanvas.getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
}

function getWeekOfYear(dateString: string): number {
  const date = new Date(dateString);
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const startDayOfWeek = startOfYear.getDay();
  const pastDaysOfYear = (date.getTime() - startOfYear.getTime()) / 86400000;
  return Math.floor((pastDaysOfYear + startDayOfWeek) / 7);
}

export class GameEngine {
  private container: HTMLElement;
  private onHudChange: (state: GameHudState) => void;
  private onContextLostChange?: (lost: boolean) => void;

  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private envMap: THREE.Texture | null = null;

  private playerRig: PlayerShipRig;
  private starField: THREE.Points;
  private enemyBodyMesh: THREE.InstancedMesh | null = null;
  private enemyCoreMesh: THREE.InstancedMesh | null = null;
  private bulletMesh: THREE.InstancedMesh;
  private pickupMesh: THREE.InstancedMesh;
  private particleMesh: THREE.InstancedMesh;

  private disposableGeometries: THREE.BufferGeometry[] = [];
  private disposableMaterials: THREE.Material[] = [];
  private disposableTextures: THREE.Texture[] = [];

  private audio = new ArcadeAudio();
  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;

  // Game state
  private contributions: ContributionEntry[] = [];
  private enemies: EnemyState[] = [];
  private bullets: Bullet[] = [];
  private pickups: Pickup[] = [];
  private particles: Particle[] = [];
  private keys: Record<string, boolean> = {};

  private phase: GamePhase = 'loading';
  private score = 0;
  private bestScore = 0;
  private totalCommits = 0;
  private remainingCommits = 0;
  private lastClearedDate: string | null = null;

  private playerX = 0;
  private playerVx = 0;
  private targetDragX: number | null = null;
  private isDragging = false;
  private autoFire = true;
  private fireMode: FireMode = 'pulse';
  private lastShotTime = 0;
  private lastDiveTime = 0;
  private muzzleFlash = 0;
  private cameraShake = 0;
  private cameraPreset: CameraPreset = 'arcade';

  // Random Upgrades state
  private rapidLeft = 0;
  private multiShotLeft = 0;
  private doubleScoreLeft = 0;
  private hasShield = false;
  private shieldInvulnLeft = 0;
  private lastUpgradeLabel: string | null = null;
  private upgradeBannerTimer = 0;
  private hudTickAccum = 0;

  private currentCamPos = new THREE.Vector3(...CAMERA_PRESETS.arcade.pos);
  private currentCamLook = new THREE.Vector3(...CAMERA_PRESETS.arcade.look);

  constructor(
    container: HTMLElement,
    onHudChange: (state: GameHudState) => void,
    onContextLostChange?: (lost: boolean) => void
  ) {
    this.container = container;
    this.onHudChange = onHudChange;
    this.onContextLostChange = onContextLostChange;

    try {
      const saved = localStorage.getItem(BEST_SCORE_STORAGE_KEY);
      if (saved) this.bestScore = Number(saved) || 0;
    } catch {
      this.bestScore = 0;
    }

    this.isSoftwareGl = detectSoftwareWebGL();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050811);
    this.scene.fog = new THREE.FogExp2(0x050811, 0.0115);

    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 220);
    this.camera.position.copy(this.currentCamPos);
    this.camera.lookAt(this.currentCamLook);

    // Studio Environment Reflection (mandatory on all devices)
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    pmremGenerator.dispose();

    // 3-Point Lighting Rig (<= 3 shadow casters, warm/cool contrast)
    const hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x0b1220, 0.75);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1e0, 1.85);
    keyLight.position.set(16, 32, 18);
    if (!this.isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -28;
      keyLight.shadow.camera.right = 28;
      keyLight.shadow.camera.top = 20;
      keyLight.shadow.camera.bottom = -20;
      keyLight.shadow.camera.near = 4;
      keyLight.shadow.camera.far = 75;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.1);
    rimLight.position.set(-20, 14, -26);
    this.scene.add(rimLight);

    // Build Arena & Environment
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const deckTex = createDeckGridTexture(maxAniso);
    const contactShadowTex = createContactShadowTexture();
    const starTex = createStarSpriteTexture();
    this.disposableTextures.push(deckTex, contactShadowTex, starTex);

    this.buildArenaDeck(deckTex, maxAniso);
    this.starField = this.buildStarField(starTex);

    // Composite Player Starfighter
    this.playerRig = createPlayerShip(this.isSoftwareGl, contactShadowTex);
    this.playerRig.group.position.set(0, 0, PLAYER_Z);
    this.scene.add(this.playerRig.group);

    // Pooled Bullet InstancedMesh (supports per-instance colors & varied bolt geometries via scale)
    const bulletGeo = new THREE.CapsuleGeometry(0.12, 0.78, 4, 8);
    bulletGeo.rotateX(Math.PI / 2);
    const bulletMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    this.disposableGeometries.push(bulletGeo);
    this.disposableMaterials.push(bulletMat);
    this.bulletMesh = new THREE.InstancedMesh(bulletGeo, bulletMat, MAX_BULLETS);
    this.bulletMesh.frustumCulled = false;
    this.scene.add(this.bulletMesh);

    for (let i = 0; i < MAX_BULLETS; i++) {
      this.bullets.push({
        active: false,
        x: 0,
        y: 0.72,
        z: 0,
        prevX: 0,
        prevZ: 0,
        baseX: 0,
        vx: 0,
        vz: -BULLET_SPEED,
        waveAmp: 0,
        wavePhase: 0,
        waveFreq: 14,
        pierceLeft: 1,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
        colorHex: 0xff7b29,
        trailAccum: 0,
        hitSet: new Set<number>(),
      });
      _dummy.scale.set(0, 0, 0);
      _dummy.updateMatrix();
      this.bulletMesh.setMatrixAt(i, _dummy.matrix);
      this.bulletMesh.setColorAt(i, _color.setHex(0xff7b29));
    }
    this.bulletMesh.instanceMatrix.needsUpdate = true;
    if (this.bulletMesh.instanceColor) this.bulletMesh.instanceColor.needsUpdate = true;

    // Pooled Upgrade Pickup InstancedMesh (rotating glowing octahedrons)
    const pickupGeo = new THREE.OctahedronGeometry(0.55, 0);
    const pickupMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    this.disposableGeometries.push(pickupGeo);
    this.disposableMaterials.push(pickupMat);
    this.pickupMesh = new THREE.InstancedMesh(pickupGeo, pickupMat, MAX_PICKUPS);
    this.pickupMesh.frustumCulled = false;
    this.scene.add(this.pickupMesh);

    for (let i = 0; i < MAX_PICKUPS; i++) {
      this.pickups.push({
        active: false,
        kind: 'rapid',
        x: 0,
        y: 0.85,
        z: 0,
        vz: 6.4,
        spin: 0,
        colorHex: 0xfacc15,
      });
      _dummy.scale.set(0, 0, 0);
      _dummy.updateMatrix();
      this.pickupMesh.setMatrixAt(i, _dummy.matrix);
      this.pickupMesh.setColorAt(i, _color.setHex(0xfacc15));
    }
    this.pickupMesh.instanceMatrix.needsUpdate = true;
    if (this.pickupMesh.instanceColor) this.pickupMesh.instanceColor.needsUpdate = true;

    // Pooled Particle InstancedMesh
    const particleGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const particleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    this.disposableGeometries.push(particleGeo);
    this.disposableMaterials.push(particleMat);
    this.particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        vrx: 0,
        vry: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        r: 1,
        g: 1,
        b: 1,
      });
      _dummy.scale.set(0, 0, 0);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      this.particleMesh.setColorAt(i, _color.setRGB(1, 1, 1));
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;

    // Post-Processing Bloom on GPU only
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.4,
        0.35,
        0.78
      );
      this.composer.addPass(this.bloomPass);
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    void this.loadAndStart();
  }

  private buildArenaDeck(deckTex: THREE.CanvasTexture, maxAniso: number): void {
    const deckGeo = new THREE.PlaneGeometry(160, 110);
    deckGeo.rotateX(-Math.PI / 2);
    const deckMat = new THREE.MeshStandardMaterial({
      map: deckTex,
      roughness: 0.72,
      metalness: 0.35,
    });
    this.disposableGeometries.push(deckGeo);
    this.disposableMaterials.push(deckMat);

    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(0, 0, -4);
    deck.receiveShadow = true;
    this.scene.add(deck);

    const railMat = new THREE.MeshStandardMaterial({
      color: 0x30363d,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.25,
      metalness: 0.75,
      roughness: 0.3,
    });
    this.disposableMaterials.push(railMat);

    const sideRailGeo = new THREE.BoxGeometry(0.18, 0.14, 30);
    this.disposableGeometries.push(sideRailGeo);

    const leftRail = new THREE.Mesh(sideRailGeo, railMat);
    leftRail.position.set(-ARENA_HALF_WIDTH - 1.8, 0.08, -2.5);
    this.scene.add(leftRail);

    const rightRail = new THREE.Mesh(sideRailGeo, railMat);
    rightRail.position.set(ARENA_HALF_WIDTH + 1.8, 0.08, -2.5);
    this.scene.add(rightRail);

    const trackGeo = new THREE.PlaneGeometry(ARENA_HALF_WIDTH * 2 + 2.2, 0.12);
    trackGeo.rotateX(-Math.PI / 2);
    const trackMat = new THREE.MeshBasicMaterial({
      color: 0x58a6ff,
      transparent: true,
      opacity: 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.disposableGeometries.push(trackGeo);
    this.disposableMaterials.push(trackMat);

    const track = new THREE.Mesh(trackGeo, trackMat);
    track.position.set(0, 0.025, PLAYER_Z);
    this.scene.add(track);

    const dayLabels: Array<{ label: string; dayRow: number }> = [
      { label: 'Mon', dayRow: 1 },
      { label: 'Wed', dayRow: 3 },
      { label: 'Fri', dayRow: 5 },
    ];
    const labelGeo = new THREE.PlaneGeometry(2.7, 1.0);
    labelGeo.rotateX(-Math.PI / 2 + 0.42);
    this.disposableGeometries.push(labelGeo);

    const startZ = -15.4;
    const step = 0.88;
    for (const item of dayLabels) {
      const tex = createDayLabelTexture(item.label, maxAniso);
      this.disposableTextures.push(tex);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.disposableMaterials.push(mat);

      const plate = new THREE.Mesh(labelGeo, mat);
      plate.position.set(-ARENA_HALF_WIDTH - 0.15, 0.36, startZ + item.dayRow * step);
      this.scene.add(plate);
    }
  }

  private buildStarField(starTex: THREE.CanvasTexture): THREE.Points {
    const count = 420;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 140;
      positions[i * 3 + 1] = -8 + Math.random() * 26;
      positions[i * 3 + 2] = -70 + Math.random() * 105;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.75,
      map: starTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.disposableGeometries.push(geo);
    this.disposableMaterials.push(mat);

    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    return points;
  }

  private async loadAndStart(): Promise<void> {
    try {
      const response = await fetch('/contributions.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as ContributionEntry[];
      this.contributions = Array.isArray(data) && data.length > 0 ? data : fallbackContributions;
    } catch {
      this.contributions = fallbackContributions;
    }

    this.buildEnemyInstancedMeshes(this.contributions.length);
    this.resetGame();
    this.clock.start();
    this.startLoop();
  }

  private buildEnemyInstancedMeshes(count: number): void {
    if (this.enemyBodyMesh) {
      this.scene.remove(this.enemyBodyMesh);
      this.enemyBodyMesh.geometry.dispose();
      (this.enemyBodyMesh.material as THREE.Material).dispose();
    }
    if (this.enemyCoreMesh) {
      this.scene.remove(this.enemyCoreMesh);
      this.enemyCoreMesh.geometry.dispose();
      (this.enemyCoreMesh.material as THREE.Material).dispose();
    }

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const blockTex = createBlockCircuitTexture(maxAniso);
    this.disposableTextures.push(blockTex);

    const w = 0.33;
    const shape = new THREE.Shape();
    shape.moveTo(-w, -w);
    shape.lineTo(w, -w);
    shape.lineTo(w, w);
    shape.lineTo(-w, w);
    shape.closePath();

    const bodyGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 1.0,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 1,
    });
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.translate(0, 0.04, 0);

    const bodyMat = new THREE.MeshStandardMaterial({
      map: blockTex,
      roughness: 0.36,
      metalness: 0.28,
    });

    this.enemyBodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
    this.enemyBodyMesh.castShadow = !this.isSoftwareGl;
    this.enemyBodyMesh.receiveShadow = true;
    this.enemyBodyMesh.frustumCulled = false;
    this.scene.add(this.enemyBodyMesh);

    const coreGeo = new THREE.BoxGeometry(0.42, 0.09, 0.42);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    this.enemyCoreMesh = new THREE.InstancedMesh(coreGeo, coreMat, count);
    this.enemyCoreMesh.frustumCulled = false;
    this.scene.add(this.enemyCoreMesh);
  }

  public resetGame(): void {
    const startX = -22.6;
    const startZ = -15.4;
    const step = 0.88;

    this.enemies = this.contributions.map((item, idx) => {
      const dateObj = new Date(item.date);
      const dayOfWeek = dateObj.getDay();
      const weekOfYear = getWeekOfYear(item.date);

      const count = item.count;
      let level = 1;
      if (count > 10) level = 4;
      else if (count > 5) level = 3;
      else if (count > 2) level = 2;

      const ox = startX + weekOfYear * step;
      const oz = startZ + dayOfWeek * step;

      return {
        index: idx,
        originX: ox,
        originZ: oz,
        x: ox,
        y: 0.04,
        z: oz,
        vx: 0,
        vz: 0,
        targetX: 0,
        targetZ: 0,
        colorLevel: level,
        initialLevel: level,
        maxHp: count,
        date: item.date,
        isDiving: false,
        diveState: 'none',
        diveSpeed: DIVE_SPEED_BASE + Math.random() * 1.8,
        hitFlash: 0,
        spinAngle: 0,
      };
    });

    for (const b of this.bullets) {
      b.active = false;
      b.hitSet.clear();
    }
    for (const pk of this.pickups) {
      pk.active = false;
    }
    for (const p of this.particles) {
      p.active = false;
    }

    this.score = 0;
    this.totalCommits = this.enemies.length;
    this.remainingCommits = this.enemies.length;
    this.lastClearedDate = null;
    this.playerX = 0;
    this.playerVx = 0;
    this.targetDragX = null;
    this.muzzleFlash = 0;
    this.cameraShake = 0;
    this.rapidLeft = 0;
    this.multiShotLeft = 0;
    this.doubleScoreLeft = 0;
    this.hasShield = false;
    this.shieldInvulnLeft = 0;
    this.lastUpgradeLabel = null;
    this.upgradeBannerTimer = 0;
    this.lastShotTime = performance.now();
    this.lastDiveTime = performance.now();
    this.phase = 'playing';

    this.syncEnemyInstances(0);
    this.syncBulletInstances();
    this.syncPickupInstances();
    this.syncParticleInstances();
    this.emitHud();
  }

  public togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.emitHud();
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
      this.lastDiveTime = performance.now();
      this.lastShotTime = performance.now();
      this.emitHud();
    }
  }

  public setCameraPreset(preset: CameraPreset): void {
    this.cameraPreset = preset;
    this.emitHud();
  }

  public setFireMode(mode: FireMode): void {
    this.fireMode = mode;
    this.emitHud();
  }

  public toggleAutoFire(): void {
    this.autoFire = !this.autoFire;
    this.emitHud();
  }

  public toggleMute(): void {
    this.audio.setMuted(!this.audio.isMuted());
    this.emitHud();
  }

  private emitHud(): void {
    let activeDivers = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].colorLevel > 0 && this.enemies[i].isDiving) {
        activeDivers++;
      }
    }

    this.onHudChange({
      phase: this.phase,
      score: this.score,
      bestScore: this.bestScore,
      remainingCommits: this.remainingCommits,
      totalCommits: this.totalCommits,
      activeDivers,
      autoFire: this.autoFire,
      muted: this.audio.isMuted(),
      cameraPreset: this.cameraPreset,
      fireMode: this.fireMode,
      rapidLeft: Math.ceil(this.rapidLeft),
      multiShotLeft: Math.ceil(this.multiShotLeft),
      doubleScoreLeft: Math.ceil(this.doubleScoreLeft),
      hasShield: this.hasShield,
      lastUpgradeLabel: this.lastUpgradeLabel,
      lastClearedDate: this.lastClearedDate,
    });
  }

  private allocBullet(
    x: number,
    z: number,
    vx: number,
    vz: number,
    colorHex: number,
    options?: {
      waveAmp?: number;
      wavePhase?: number;
      waveFreq?: number;
      pierceLeft?: number;
      scaleX?: number;
      scaleY?: number;
      scaleZ?: number;
    }
  ): void {
    for (let i = 0; i < MAX_BULLETS; i++) {
      const b = this.bullets[i];
      if (!b.active) {
        b.active = true;
        b.x = x;
        b.y = 0.72;
        b.z = z;
        b.prevX = x;
        b.prevZ = z;
        b.baseX = x;
        b.vx = vx;
        b.vz = vz;
        b.waveAmp = options?.waveAmp ?? 0;
        b.wavePhase = options?.wavePhase ?? 0;
        b.waveFreq = options?.waveFreq ?? 14;
        b.pierceLeft = options?.pierceLeft ?? 1;
        b.scaleX = options?.scaleX ?? 1;
        b.scaleY = options?.scaleY ?? 1;
        b.scaleZ = options?.scaleZ ?? 1;
        b.colorHex = colorHex;
        b.trailAccum = 0;
        b.hitSet.clear();
        return;
      }
    }
  }

  private fireVolley(): void {
    const extra = this.multiShotLeft > 0;
    const rapidGlow = this.rapidLeft > 0;
    const spawnZ = PLAYER_Z - 1.9;

    if (this.fireMode === 'pulse') {
      const col = rapidGlow ? 0xfacc15 : 0xff7b29;
      if (extra) {
        this.allocBullet(this.playerX - 0.92, spawnZ + 0.5, 0, -42, col, { scaleZ: 1.25 });
        this.allocBullet(this.playerX, spawnZ, 0, -44, col, { scaleX: 1.2, scaleZ: 1.4 });
        this.allocBullet(this.playerX + 0.92, spawnZ + 0.5, 0, -42, col, { scaleZ: 1.25 });
      } else {
        this.allocBullet(this.playerX, spawnZ, 0, -42, col, { scaleX: 1.15, scaleZ: 1.3 });
      }
    } else if (this.fireMode === 'spread') {
      const col = rapidGlow ? 0x67e8f9 : 0x38bdf8;
      const angles = extra ? [-0.36, -0.18, 0, 0.18, 0.36] : [-0.22, 0, 0.22];
      const spd = 39;
      for (const ang of angles) {
        this.allocBullet(
          this.playerX + Math.sin(ang) * 0.6,
          spawnZ,
          Math.sin(ang) * spd,
          -Math.cos(ang) * spd,
          col,
          { scaleX: 1.05, scaleZ: 1.15 }
        );
      }
    } else if (this.fireMode === 'helix') {
      const col = rapidGlow ? 0x86efac : 0x39d353;
      const spd = 35;
      this.allocBullet(this.playerX, spawnZ, 0, -spd, col, {
        waveAmp: 1.25,
        wavePhase: 0,
        waveFreq: 15,
        scaleX: 1.15,
        scaleZ: 1.2,
      });
      this.allocBullet(this.playerX, spawnZ, 0, -spd, col, {
        waveAmp: 1.25,
        wavePhase: Math.PI,
        waveFreq: 15,
        scaleX: 1.15,
        scaleZ: 1.2,
      });
      if (extra) {
        this.allocBullet(this.playerX - 1.05, spawnZ + 0.4, 0, -spd, col, {
          waveAmp: 0.9,
          wavePhase: Math.PI * 0.5,
          waveFreq: 15,
        });
        this.allocBullet(this.playerX + 1.05, spawnZ + 0.4, 0, -spd, col, {
          waveAmp: 0.9,
          wavePhase: Math.PI * 1.5,
          waveFreq: 15,
        });
      }
    } else if (this.fireMode === 'rail') {
      const col = rapidGlow ? 0xf0abfc : 0xc084fc;
      if (extra) {
        this.allocBullet(this.playerX - 0.72, spawnZ, 0, -60, col, {
          pierceLeft: 3,
          scaleX: 1.35,
          scaleY: 1.25,
          scaleZ: 2.5,
        });
        this.allocBullet(this.playerX + 0.72, spawnZ, 0, -60, col, {
          pierceLeft: 3,
          scaleX: 1.35,
          scaleY: 1.25,
          scaleZ: 2.5,
        });
      } else {
        this.allocBullet(this.playerX, spawnZ, 0, -62, col, {
          pierceLeft: 3,
          scaleX: 1.45,
          scaleY: 1.3,
          scaleZ: 2.6,
        });
      }
    }

    this.muzzleFlash = 1.0;
    this.audio.playShoot(this.fireMode);
  }

  private maybeSpawnPickup(x: number, z: number, initialLevel: number): void {
    let activeCount = 0;
    for (let i = 0; i < MAX_PICKUPS; i++) {
      if (this.pickups[i].active) activeCount++;
    }
    if (activeCount >= 5) return;

    const dropChance = 0.18 + (initialLevel - 1) * 0.1;
    if (Math.random() > dropChance) return;

    const kinds: UpgradeKind[] = ['rapid', 'multishot', 'shield', 'double_score', 'weapon'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];

    for (let i = 0; i < MAX_PICKUPS; i++) {
      const pk = this.pickups[i];
      if (!pk.active) {
        pk.active = true;
        pk.kind = kind;
        pk.x = THREE.MathUtils.clamp(x, -ARENA_HALF_WIDTH + 1, ARENA_HALF_WIDTH - 1);
        pk.y = 0.9;
        pk.z = z;
        pk.vz = 6.2 + Math.random() * 1.4;
        pk.spin = Math.random() * Math.PI * 2;
        pk.colorHex = UPGRADE_COLORS[kind];
        return;
      }
    }
  }

  private applyUpgrade(kind: UpgradeKind): void {
    if (kind === 'rapid') {
      this.rapidLeft = Math.min(20, this.rapidLeft + 10);
      this.lastUpgradeLabel = UPGRADE_LABELS.rapid;
    } else if (kind === 'multishot') {
      this.multiShotLeft = Math.min(24, this.multiShotLeft + 12);
      this.lastUpgradeLabel = UPGRADE_LABELS.multishot;
    } else if (kind === 'shield') {
      this.hasShield = true;
      this.lastUpgradeLabel = UPGRADE_LABELS.shield;
    } else if (kind === 'double_score') {
      this.doubleScoreLeft = Math.min(24, this.doubleScoreLeft + 12);
      this.lastUpgradeLabel = UPGRADE_LABELS.double_score;
    } else {
      const specialModes: FireMode[] = ['spread', 'helix', 'rail'];
      const choices = specialModes.filter((m) => m !== this.fireMode);
      const picked = choices[Math.floor(Math.random() * choices.length)] ?? 'spread';
      this.fireMode = picked;
      this.rapidLeft = Math.max(this.rapidLeft, 6);
      const modeNames: Record<FireMode, string> = {
        pulse: 'Pulse Laser',
        spread: 'Triple Spread + Overdrive',
        helix: 'Twin Helix + Overdrive',
        rail: 'Piercing Railgun + Overdrive',
      };
      this.lastUpgradeLabel = modeNames[picked];
    }

    this.upgradeBannerTimer = 4.5;
    this.audio.playPowerUp();
    this.spawnParticles(this.playerX, 0.9, PLAYER_Z, 22, UPGRADE_COLORS[kind], 1.1, 1.0);
    this.emitHud();
  }

  private spawnParticles(
    x: number,
    y: number,
    z: number,
    count: number,
    hexColor: number,
    speedScale = 1.0,
    sizeScale = 1.0
  ): void {
    _color.setHex(hexColor);
    let spawned = 0;
    for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.x = x;
        p.y = y;
        p.z = z;
        const angle = Math.random() * Math.PI * 2;
        const horiz = (2.2 + Math.random() * 6.5) * speedScale;
        p.vx = Math.cos(angle) * horiz;
        p.vy = (2.5 + Math.random() * 6.0) * speedScale;
        p.vz = Math.sin(angle) * horiz;
        p.rx = Math.random() * Math.PI;
        p.ry = Math.random() * Math.PI;
        p.rz = Math.random() * Math.PI;
        p.vrx = (Math.random() - 0.5) * 14;
        p.vry = (Math.random() - 0.5) * 14;
        p.maxLife = 0.32 + Math.random() * 0.38;
        p.life = p.maxLife;
        p.size = (0.65 + Math.random() * 0.9) * sizeScale;
        p.r = _color.r;
        p.g = _color.g;
        p.b = _color.b;
        spawned++;
      }
    }
  }

  private damageEnemy(e: EnemyState, hitX: number, hitZ: number): boolean {
    const prevHex = GIT_COLORS_HEX[e.colorLevel];
    e.colorLevel -= 1;
    e.hitFlash = 1.0;

    if (e.colorLevel === 0) {
      const multiplier = this.doubleScoreLeft > 0 ? 2 : 1;
      this.score += e.maxHp * multiplier;
      if (this.score > this.bestScore) {
        this.bestScore = this.score;
        try {
          localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(this.bestScore));
        } catch {
          // Ignore storage quota issues
        }
      }
      this.remainingCommits -= 1;
      this.lastClearedDate = e.date;
      e.isDiving = false;
      e.diveState = 'none';
      this.cameraShake = Math.min(0.45, this.cameraShake + 0.14);
      this.spawnParticles(e.x, e.y + 0.6, e.z, 18, prevHex, 1.15, 1.15);
      this.maybeSpawnPickup(e.x, e.z, e.initialLevel);
      this.audio.playDestroy();

      if (this.remainingCommits <= 0) {
        this.phase = 'victory';
        this.audio.playVictory();
      }
      return true;
    }

    this.spawnParticles(hitX, 0.72, hitZ, 7, prevHex, 0.75, 0.7);
    this.audio.playHit();
    return false;
  }

  private updateGame(dt: number, elapsed: number): void {
    const now = performance.now();
    this.starField.position.z = (elapsed * 0.8) % 12;

    if (this.phase === 'playing') {
      // Tick upgrade timers
      let timersChanged = false;
      if (this.rapidLeft > 0) {
        this.rapidLeft = Math.max(0, this.rapidLeft - dt);
        if (this.rapidLeft === 0) timersChanged = true;
      }
      if (this.multiShotLeft > 0) {
        this.multiShotLeft = Math.max(0, this.multiShotLeft - dt);
        if (this.multiShotLeft === 0) timersChanged = true;
      }
      if (this.doubleScoreLeft > 0) {
        this.doubleScoreLeft = Math.max(0, this.doubleScoreLeft - dt);
        if (this.doubleScoreLeft === 0) timersChanged = true;
      }
      if (this.shieldInvulnLeft > 0) {
        this.shieldInvulnLeft = Math.max(0, this.shieldInvulnLeft - dt);
      }
      if (this.upgradeBannerTimer > 0) {
        this.upgradeBannerTimer = Math.max(0, this.upgradeBannerTimer - dt);
        if (this.upgradeBannerTimer === 0) {
          this.lastUpgradeLabel = null;
          timersChanged = true;
        }
      }

      this.hudTickAccum += dt;
      if (
        (this.rapidLeft > 0 || this.multiShotLeft > 0 || this.doubleScoreLeft > 0) &&
        this.hudTickAccum >= 0.5
      ) {
        this.hudTickAccum = 0;
        timersChanged = true;
      }

      // 1. Player Movement (Keyboard + Smooth Drag)
      let moveDir = 0;
      if (this.keys['ArrowLeft'] || this.keys['a'] || this.keys['A']) moveDir -= 1;
      if (this.keys['ArrowRight'] || this.keys['d'] || this.keys['D']) moveDir += 1;

      const prevX = this.playerX;
      if (moveDir !== 0) {
        this.targetDragX = null;
        this.playerX += moveDir * PLAYER_SPEED * dt;
      } else if (this.isDragging && this.targetDragX !== null) {
        this.playerX = THREE.MathUtils.damp(this.playerX, this.targetDragX, 18, dt);
      }

      this.playerX = THREE.MathUtils.clamp(this.playerX, -ARENA_HALF_WIDTH, ARENA_HALF_WIDTH);
      this.playerVx = dt > 0 ? (this.playerX - prevX) / dt : 0;

      // 2. Shooting (Auto-fire or Spacebar, scaled by Overdrive & weapon mode)
      const wantsFire = this.autoFire || Boolean(this.keys[' ']);
      let baseCooldown = SHOT_COOLDOWN_MS;
      if (this.fireMode === 'rail') baseCooldown = 390;
      else if (this.fireMode === 'spread') baseCooldown = 320;
      const effectiveCooldown = this.rapidLeft > 0 ? baseCooldown * 0.5 : baseCooldown;

      if (wantsFire && now - this.lastShotTime >= effectiveCooldown) {
        this.fireVolley();
        this.lastShotTime = now;
      }

      // 3. Move Bullets (record prevX / prevZ for zero-tunneling swept hit detection)
      for (let i = 0; i < MAX_BULLETS; i++) {
        const b = this.bullets[i];
        if (!b.active) continue;
        b.prevX = b.x;
        b.prevZ = b.z;
        b.baseX += b.vx * dt;
        b.z += b.vz * dt;
        if (b.waveAmp > 0) {
          b.wavePhase += dt * b.waveFreq;
          b.x = b.baseX + Math.sin(b.wavePhase) * b.waveAmp;
        } else {
          b.x = b.baseX;
        }

        // Subtle plasma trail for railgun & helix shots
        if (b.pierceLeft > 1 || b.waveAmp > 0) {
          b.trailAccum += dt;
          if (b.trailAccum >= 0.035) {
            b.trailAccum = 0;
            this.spawnParticles(b.x, b.y, b.z + 0.3, 1, b.colorHex, 0.2, 0.45);
          }
        }

        if (b.z < -20 || Math.abs(b.x) > ARENA_HALF_WIDTH + 6) {
          b.active = false;
        }
      }

      // 4. Update Falling Upgrade Pickups & Catch Check
      for (let i = 0; i < MAX_PICKUPS; i++) {
        const pk = this.pickups[i];
        if (!pk.active) continue;
        pk.z += pk.vz * dt;
        pk.spin += dt * 3.4;
        pk.y = 0.9 + Math.sin(elapsed * 5 + i) * 0.16;

        if (Math.abs(pk.x - this.playerX) < 2.25 && Math.abs(pk.z - PLAYER_Z) < 1.55) {
          pk.active = false;
          this.applyUpgrade(pk.kind);
          continue;
        }

        if (pk.z > PLAYER_Z + 5.5) {
          pk.active = false;
        }
      }

      // 5. Trigger Kamikaze Divers every 1500ms
      let hudDirty = timersChanged;
      if (now - this.lastDiveTime >= DIVE_INTERVAL_MS) {
        const candidates: EnemyState[] = [];
        for (let i = 0; i < this.enemies.length; i++) {
          const e = this.enemies[i];
          if (e.colorLevel > 0 && !e.isDiving) {
            candidates.push(e);
          }
        }

        if (candidates.length > 0) {
          const numDivers = Math.min(2, candidates.length);
          for (let i = 0; i < numDivers; i++) {
            const pickIdx = Math.floor(Math.random() * candidates.length);
            const diver = candidates[pickIdx];
            diver.isDiving = true;
            diver.diveState = 'down';
            diver.targetX = this.playerX;
            diver.targetZ = PLAYER_Z;

            const dx = diver.targetX - diver.x;
            const dz = diver.targetZ - diver.z;
            const dist = Math.hypot(dx, dz) || 1;
            diver.vx = (dx / dist) * diver.diveSpeed;
            diver.vz = (dz / dist) * diver.diveSpeed;

            candidates.splice(pickIdx, 1);
          }
          this.audio.playDive();
          hudDirty = true;
        }
        this.lastDiveTime = now;
      }

      // 6. Update Diving Enemies & Player Collision
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (e.hitFlash > 0) {
          e.hitFlash = Math.max(0, e.hitFlash - dt * 7.5);
        }

        if (e.colorLevel <= 0 || !e.isDiving) continue;

        e.spinAngle += dt * 4.5;

        if (e.diveState === 'down') {
          e.x += e.vx * dt;
          e.z += e.vz * dt;
          const progress = THREE.MathUtils.clamp((e.z - e.originZ) / (e.targetZ - e.originZ || 1), 0, 1);
          e.y = 0.04 + Math.sin(progress * Math.PI) * 1.4 + 0.35;

          // Check collision with player ship
          if (Math.abs(e.x - this.playerX) < 1.85 && Math.abs(e.z - PLAYER_Z) < 1.25) {
            if (this.hasShield || this.shieldInvulnLeft > 0) {
              if (this.hasShield) {
                this.hasShield = false;
                this.shieldInvulnLeft = 0.85;
                this.audio.playShieldBreak();
                this.spawnParticles(this.playerX, 0.9, PLAYER_Z, 30, 0x38bdf8, 1.35, 1.1);
              }
              // Shatter the diving enemy on shield impact
              e.colorLevel = 1;
              this.damageEnemy(e, e.x, e.z);
              hudDirty = true;
            } else {
              this.triggerGameOver();
              break;
            }
          }

          if (e.colorLevel > 0 && e.z >= e.targetZ) {
            e.diveState = 'up';
            const dx = e.originX - e.x;
            const dz = e.originZ - e.z;
            const dist = Math.hypot(dx, dz) || 1;
            e.vx = (dx / dist) * (e.diveSpeed * 1.15);
            e.vz = (dz / dist) * (e.diveSpeed * 1.15);
          }
        } else if (e.diveState === 'up') {
          e.x += e.vx * dt;
          e.z += e.vz * dt;
          const dx = e.originX - e.x;
          const dz = e.originZ - e.z;
          const dist = Math.hypot(dx, dz);
          e.y = 0.04 + Math.min(1.0, dist * 0.08);

          if (dist < 0.35) {
            e.x = e.originX;
            e.z = e.originZ;
            e.y = 0.04;
            e.isDiving = false;
            e.diveState = 'none';
            e.spinAngle = 0;
            hudDirty = true;
          }
        }
      }

      // 7. Continuous Swept Segment-vs-AABB Bullet Collision (zero tunneling, ultra-responsive)
      for (let bi = 0; bi < MAX_BULLETS; bi++) {
        const b = this.bullets[bi];
        if (!b.active) continue;

        for (let ei = 0; ei < this.enemies.length; ei++) {
          const e = this.enemies[ei];
          if (e.colorLevel <= 0) continue;
          if (b.pierceLeft > 1 && b.hitSet.has(e.index)) continue;

          // Expanded hitbox accounting for bullet capsule width, bloom, and diving motion
          const hitHalfW = (e.isDiving ? 0.72 : 0.64) + (b.scaleX - 1) * 0.14;
          const hitHalfZ = (e.isDiving ? 0.78 : 0.7) + (b.scaleZ - 1) * 0.18;

          if (segmentIntersectsAABB(b.prevX, b.prevZ, b.x, b.z, e.x, e.z, hitHalfW, hitHalfZ)) {
            b.hitSet.add(e.index);
            b.pierceLeft -= 1;

            const killed = this.damageEnemy(e, b.x, b.z);
            if (killed) hudDirty = true;

            if (b.pierceLeft <= 0) {
              b.active = false;
              break;
            }
          }
        }
      }

      if (hudDirty) {
        this.emitHud();
      }
    }

    // 8. Update Player Ship Kinematics, Shield Ring & Thruster Plumes
    this.playerRig.group.position.x = this.playerX;
    this.playerRig.group.visible = this.phase !== 'gameover';

    this.playerRig.shieldRing.visible = this.hasShield || this.shieldInvulnLeft > 0;
    if (this.playerRig.shieldRing.visible) {
      this.playerRig.shieldRing.rotation.y = elapsed * 2.6;
      const pulse = 1 + Math.sin(elapsed * 8) * 0.04;
      this.playerRig.shieldRing.scale.setScalar(pulse);
    }

    const targetRoll = THREE.MathUtils.clamp(-this.playerVx * 0.022, -0.42, 0.42);
    const targetPitch = Math.abs(this.playerVx) > 0.5 ? -0.06 : 0.02;
    this.playerRig.hullPivot.rotation.z = THREE.MathUtils.damp(
      this.playerRig.hullPivot.rotation.z,
      targetRoll,
      12,
      dt
    );
    this.playerRig.hullPivot.rotation.x = THREE.MathUtils.damp(
      this.playerRig.hullPivot.rotation.x,
      targetPitch,
      10,
      dt
    );
    this.playerRig.hullPivot.position.y = 0.65 + Math.sin(elapsed * 4.2) * 0.05;

    const flameFlicker =
      0.85 + Math.sin(elapsed * 42) * 0.22 + Math.min(0.35, Math.abs(this.playerVx) * 0.015);
    this.playerRig.leftFlame.scale.set(1, 1, flameFlicker);
    this.playerRig.rightFlame.scale.set(1, 1, flameFlicker);

    if (this.muzzleFlash > 0) {
      this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 11);
    }
    const muzzleMat = this.playerRig.muzzleGlow.material as THREE.MeshBasicMaterial;
    muzzleMat.opacity = this.muzzleFlash * 0.75;
    this.playerRig.muzzleGlow.scale.setScalar(0.6 + this.muzzleFlash * 0.7);

    // 9. Update Particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy -= 18 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.1) {
        p.y = 0.1;
        p.vy *= -0.45;
      }
      p.rx += p.vrx * dt;
      p.ry += p.vry * dt;
    }

    // 10. Smooth Camera Damping + Tighter Player Tracking + Screen Shake
    const preset = CAMERA_PRESETS[this.cameraPreset];
    const aspect = this.camera.aspect || 1;
    const narrowBoost = aspect < 1.25 ? Math.min(1.38, 1.25 / Math.max(aspect, 0.6)) : 1.0;
    const followX = aspect < 1.25 ? Math.min(0.95, preset.followX + 0.08) : preset.followX;
    const lookFollowX = aspect < 1.25 ? Math.min(0.98, preset.lookFollowX + 0.04) : preset.lookFollowX;

    this.currentCamPos.x = THREE.MathUtils.damp(
      this.currentCamPos.x,
      preset.pos[0] + this.playerX * followX,
      9.0,
      dt
    );
    this.currentCamPos.y = THREE.MathUtils.damp(
      this.currentCamPos.y,
      preset.pos[1] * narrowBoost,
      6.5,
      dt
    );
    this.currentCamPos.z = THREE.MathUtils.damp(
      this.currentCamPos.z,
      preset.pos[2] * narrowBoost,
      6.5,
      dt
    );

    this.currentCamLook.x = THREE.MathUtils.damp(
      this.currentCamLook.x,
      preset.look[0] + this.playerX * lookFollowX,
      9.5,
      dt
    );
    this.currentCamLook.y = THREE.MathUtils.damp(this.currentCamLook.y, preset.look[1], 6.5, dt);
    this.currentCamLook.z = THREE.MathUtils.damp(this.currentCamLook.z, preset.look[2], 6.5, dt);

    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.4);
    }

    const shakeAmp = this.cameraShake * 0.55;
    this.camera.position.set(
      this.currentCamPos.x + (Math.random() - 0.5) * shakeAmp,
      this.currentCamPos.y + (Math.random() - 0.5) * shakeAmp,
      this.currentCamPos.z
    );
    this.camera.lookAt(this.currentCamLook);

    // 11. Sync InstancedMeshes
    this.syncEnemyInstances(elapsed);
    this.syncBulletInstances();
    this.syncPickupInstances();
    this.syncParticleInstances();
  }

  private triggerGameOver(): void {
    this.phase = 'gameover';
    this.cameraShake = 0.9;
    this.spawnParticles(this.playerX, 0.8, PLAYER_Z, 44, 0x38bdf8, 1.5, 1.35);
    this.spawnParticles(this.playerX, 0.8, PLAYER_Z, 26, 0xf97316, 1.3, 1.1);
    this.audio.playGameOver();
    this.emitHud();
  }

  private syncEnemyInstances(elapsed: number): void {
    if (!this.enemyBodyMesh || !this.enemyCoreMesh) return;

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.colorLevel <= 0) {
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.enemyBodyMesh.setMatrixAt(i, _dummy.matrix);
        this.enemyCoreMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      const h = LEVEL_HEIGHTS[e.colorLevel];
      const bob = e.isDiving ? 0 : Math.sin(elapsed * 2.2 + e.originX * 0.35 + e.originZ * 0.4) * 0.04;

      _dummy.position.set(e.x, e.y + bob, e.z);
      if (e.isDiving) {
        _dummy.rotation.set(0.32, e.spinAngle, Math.sin(e.spinAngle) * 0.15);
      } else {
        _dummy.rotation.set(0, 0, 0);
      }
      _dummy.scale.set(1, h, 1);
      _dummy.updateMatrix();
      this.enemyBodyMesh.setMatrixAt(i, _dummy.matrix);

      _color.setHex(GIT_COLORS_HEX[e.colorLevel]);
      if (e.isDiving) {
        const pulse = 0.55 + Math.sin(elapsed * 14 + i) * 0.25;
        _color.lerp(_diveColor, pulse);
      }
      if (e.hitFlash > 0) {
        _color.lerp(_flashColor, e.hitFlash);
      }
      this.enemyBodyMesh.setColorAt(i, _color);

      _dummy.position.set(e.x, e.y + bob + h + 0.07, e.z);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.enemyCoreMesh.setMatrixAt(i, _dummy.matrix);

      if (e.isDiving) {
        _color.setHex(0xff5a36).multiplyScalar(1.35);
      } else {
        _color.setHex(GIT_COLORS_HEX[e.colorLevel]).multiplyScalar(1.25 + e.colorLevel * 0.12);
      }
      this.enemyCoreMesh.setColorAt(i, _color);
    }

    this.enemyBodyMesh.instanceMatrix.needsUpdate = true;
    if (this.enemyBodyMesh.instanceColor) this.enemyBodyMesh.instanceColor.needsUpdate = true;
    this.enemyCoreMesh.instanceMatrix.needsUpdate = true;
    if (this.enemyCoreMesh.instanceColor) this.enemyCoreMesh.instanceColor.needsUpdate = true;
  }

  private syncBulletInstances(): void {
    for (let i = 0; i < MAX_BULLETS; i++) {
      const b = this.bullets[i];
      if (!b.active) {
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.bulletMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      _dummy.position.set(b.x, b.y, b.z);
      const yaw = Math.atan2(-(b.x - b.prevX), -(b.z - b.prevZ));
      _dummy.rotation.set(0, yaw, 0);
      _dummy.scale.set(b.scaleX, b.scaleY, b.scaleZ);
      _dummy.updateMatrix();
      this.bulletMesh.setMatrixAt(i, _dummy.matrix);
      this.bulletMesh.setColorAt(i, _color.setHex(b.colorHex).multiplyScalar(1.35));
    }
    this.bulletMesh.instanceMatrix.needsUpdate = true;
    if (this.bulletMesh.instanceColor) this.bulletMesh.instanceColor.needsUpdate = true;
  }

  private syncPickupInstances(): void {
    for (let i = 0; i < MAX_PICKUPS; i++) {
      const pk = this.pickups[i];
      if (!pk.active) {
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.pickupMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const pulse = 1.0 + Math.sin(pk.spin * 2) * 0.14;
      _dummy.position.set(pk.x, pk.y, pk.z);
      _dummy.rotation.set(pk.spin * 0.7, pk.spin, 0);
      _dummy.scale.setScalar(pulse);
      _dummy.updateMatrix();
      this.pickupMesh.setMatrixAt(i, _dummy.matrix);
      this.pickupMesh.setColorAt(i, _color.setHex(pk.colorHex).multiplyScalar(1.35));
    }
    this.pickupMesh.instanceMatrix.needsUpdate = true;
    if (this.pickupMesh.instanceColor) this.pickupMesh.instanceColor.needsUpdate = true;
  }

  private syncParticleInstances(): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) {
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const scale = p.size * (p.life / p.maxLife);
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(p.rx, p.ry, p.rz);
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      this.particleMesh.setColorAt(i, _color.setRGB(p.r, p.g, p.b));
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return;

      const rawDelta = this.clock.getDelta();
      const dt = Math.min(rawDelta, 0.05);
      const elapsed = this.clock.getElapsedTime();

      this.updateGame(dt, elapsed);

      if (this.isSoftwareGl || !this.composer) {
        this.renderer.render(this.scene, this.camera);
      } else {
        this.composer.render();
      }

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    tick();
  }

  private updateDragFromPointer(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_pointerNdc, this.camera);
    if (_raycaster.ray.intersectPlane(_arenaPlane, _rayHit)) {
      this.targetDragX = THREE.MathUtils.clamp(_rayHit.x, -ARENA_HALF_WIDTH, ARENA_HALF_WIDTH);
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.audio.unlock();
    this.keys[e.key] = true;

    if (e.key === 'Enter' && (this.phase === 'gameover' || this.phase === 'victory')) {
      this.resetGame();
    } else if (e.key === 'p' || e.key === 'P') {
      this.togglePause();
    } else if (e.key === 'm' || e.key === 'M') {
      this.toggleMute();
    } else if (e.key === '1') {
      this.setFireMode('pulse');
    } else if (e.key === '2') {
      this.setFireMode('spread');
    } else if (e.key === '3') {
      this.setFireMode('helix');
    } else if (e.key === '4') {
      this.setFireMode('rail');
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys[e.key] = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.audio.unlock();
    if (this.phase !== 'playing') return;
    this.isDragging = true;
    this.updateDragFromPointer(e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDragging || this.phase !== 'playing') return;
    this.updateDragFromPointer(e.clientX, e.clientY);
  };

  private onPointerUp = (): void => {
    this.isDragging = false;
    this.targetDragX = null;
  };

  private onResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.onContextLostChange?.(true);
  };

  private onContextRestored = (): void => {
    this.onContextLostChange?.(false);
    this.startLoop();
  };

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    const canvas = this.renderer.domElement;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.playerRig.dispose();
    if (this.enemyBodyMesh) {
      this.enemyBodyMesh.geometry.dispose();
      (this.enemyBodyMesh.material as THREE.Material).dispose();
    }
    if (this.enemyCoreMesh) {
      this.enemyCoreMesh.geometry.dispose();
      (this.enemyCoreMesh.material as THREE.Material).dispose();
    }
    this.disposableGeometries.forEach((g) => g.dispose());
    this.disposableMaterials.forEach((m) => m.dispose());
    this.disposableTextures.forEach((t) => t.dispose());
    this.envMap?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();

    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
