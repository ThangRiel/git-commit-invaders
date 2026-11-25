export interface ContributionEntry {
  date: string;
  count: number;
  color: string;
}

export type DiveState = 'none' | 'down' | 'up';

export type CameraPreset = 'arcade' | 'top' | 'dynamic';

export type FireMode = 'pulse' | 'spread' | 'helix' | 'rail';

export type UpgradeKind = 'rapid' | 'multishot' | 'shield' | 'double_score' | 'weapon';

export type GamePhase = 'loading' | 'playing' | 'paused' | 'gameover' | 'victory';

export interface EnemyState {
  index: number;
  originX: number;
  originZ: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  targetX: number;
  targetZ: number;
  colorLevel: number;
  initialLevel: number;
  maxHp: number;
  date: string;
  isDiving: boolean;
  diveState: DiveState;
  diveSpeed: number;
  hitFlash: number;
  spinAngle: number;
}

export interface GameHudState {
  phase: GamePhase;
  score: number;
  bestScore: number;
  remainingCommits: number;
  totalCommits: number;
  activeDivers: number;
  autoFire: boolean;
  muted: boolean;
  cameraPreset: CameraPreset;
  fireMode: FireMode;
  rapidLeft: number;
  multiShotLeft: number;
  doubleScoreLeft: number;
  hasShield: boolean;
  lastUpgradeLabel: string | null;
  lastClearedDate: string | null;
}
