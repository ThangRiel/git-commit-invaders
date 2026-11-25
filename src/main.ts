import { GameEngine } from './game/GameEngine';
import { CameraPreset, FireMode, GameHudState } from './types';

const mountEl = document.getElementById('webgl-mount');
const scoreEl = document.getElementById('hud-score');
const bestEl = document.getElementById('hud-best');
const remainingEl = document.getElementById('hud-remaining');
const upgradeStatusEl = document.getElementById('upgrade-status');

const stateOverlay = document.getElementById('state-overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySubtitle = document.getElementById('overlay-subtitle');
const overlayScore = document.getElementById('overlay-score');
const overlayBest = document.getElementById('overlay-best');
const overlayPrimaryBtn = document.getElementById('overlay-primary-btn');
const overlaySecondaryBtn = document.getElementById('overlay-secondary-btn');
const overlayKeyHint = document.getElementById('overlay-keyhint');

const dockWrapper = document.getElementById('dock-wrapper');
const dockToggleBtn = document.getElementById('dock-toggle-btn');
const autoFireBtn = document.getElementById('autofire-btn');
const muteBtn = document.getElementById('mute-btn');
const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement | null;
const restartBtn = document.getElementById('restart-btn');
const camButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.cam-btn'));
const weaponButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.weapon-btn'));

let dockCollapsed = false;
let currentPhase: GameHudState['phase'] = 'loading';

const WEAPON_ACTIVE_STYLES: Record<FireMode, string> = {
  pulse: 'bg-amber-500/20 text-amber-300',
  spread: 'bg-sky-500/20 text-sky-300',
  helix: 'bg-emerald-500/20 text-emerald-300',
  rail: 'bg-fuchsia-500/20 text-fuchsia-300',
};

function setDockCollapsed(collapsed: boolean): void {
  dockCollapsed = collapsed;
  if (!dockWrapper || !dockToggleBtn) return;
  dockWrapper.classList.toggle('is-collapsed', collapsed);
  dockToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  dockToggleBtn.textContent = collapsed ? 'Show Controls (H)' : 'Hide Controls (H)';
}

function updateHud(state: GameHudState): void {
  currentPhase = state.phase;

  if (scoreEl) scoreEl.textContent = state.score.toLocaleString();
  if (bestEl) bestEl.textContent = state.bestScore.toLocaleString();
  if (remainingEl) {
    remainingEl.textContent = `${state.remainingCommits}/${state.totalCommits}`;
  }

  if (upgradeStatusEl) {
    const parts: string[] = [];
    if (state.rapidLeft > 0) parts.push(`Overdrive ${state.rapidLeft}s`);
    if (state.multiShotLeft > 0) parts.push(`Multi-Barrel ${state.multiShotLeft}s`);
    if (state.doubleScoreLeft > 0) parts.push(`2x Score ${state.doubleScoreLeft}s`);
    if (state.hasShield) parts.push('Plasma Shield Active');
    if (parts.length === 0 && state.lastUpgradeLabel) {
      parts.push(`Picked up: ${state.lastUpgradeLabel}`);
    }

    if (parts.length > 0) {
      upgradeStatusEl.textContent = parts.join(' · ');
      upgradeStatusEl.classList.remove('hidden');
    } else {
      upgradeStatusEl.textContent = '';
      upgradeStatusEl.classList.add('hidden');
    }
  }

  weaponButtons.forEach((btn) => {
    const mode = btn.dataset.weapon as FireMode | undefined;
    const active = mode === state.fireMode;
    btn.className = active && mode
      ? `weapon-btn px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${WEAPON_ACTIVE_STYLES[mode]}`
      : 'weapon-btn px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap text-slate-400 hover:text-slate-100';
  });

  if (autoFireBtn) {
    autoFireBtn.textContent = state.autoFire ? 'Auto-Fire: On' : 'Auto-Fire: Off';
    autoFireBtn.className = state.autoFire
      ? 'px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap'
      : 'px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap';
  }

  if (muteBtn) {
    muteBtn.textContent = state.muted ? 'Sound: Off' : 'Sound: On';
    muteBtn.className = state.muted
      ? 'px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-400 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap'
      : 'px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap';
  }

  if (pauseBtn) {
    pauseBtn.textContent = state.phase === 'paused' ? 'Resume' : 'Pause';
    pauseBtn.disabled = state.phase !== 'playing' && state.phase !== 'paused';
  }

  camButtons.forEach((btn) => {
    const preset = btn.dataset.camera as CameraPreset | undefined;
    const active = preset === state.cameraPreset;
    btn.className = active
      ? 'cam-btn px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap bg-sky-500/20 text-sky-300'
      : 'cam-btn px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap text-slate-400 hover:text-slate-100';
  });

  if (stateOverlay && overlayTitle && overlaySubtitle && overlayScore && overlayBest && overlayPrimaryBtn && overlaySecondaryBtn && overlayKeyHint) {
    if (state.phase === 'gameover' || state.phase === 'victory' || state.phase === 'paused') {
      stateOverlay.classList.remove('hidden');
      stateOverlay.classList.add('flex');
      overlayScore.textContent = state.score.toLocaleString();
      overlayBest.textContent = state.bestScore.toLocaleString();

      if (state.phase === 'gameover') {
        overlayTitle.textContent = 'Game Over';
        overlayTitle.className = 'font-display text-3xl font-bold text-rose-400';
        overlaySubtitle.textContent = 'A diving commit breached your starfighter.';
        overlayPrimaryBtn.textContent = 'Play Again';
        overlaySecondaryBtn.classList.add('hidden');
        overlayKeyHint.textContent = 'Press Enter to restart';
      } else if (state.phase === 'victory') {
        overlayTitle.textContent = 'Contribution Wall Cleared';
        overlayTitle.className = 'font-display text-3xl font-bold text-emerald-400';
        overlaySubtitle.textContent = 'Every commit invader across the year has been cleared.';
        overlayPrimaryBtn.textContent = 'Play Again';
        overlaySecondaryBtn.classList.add('hidden');
        overlayKeyHint.textContent = 'Press Enter to restart';
      } else {
        overlayTitle.textContent = 'Paused';
        overlayTitle.className = 'font-display text-3xl font-bold text-sky-400';
        overlaySubtitle.textContent = 'Simulation paused. Resume when ready.';
        overlayPrimaryBtn.textContent = 'Resume';
        overlaySecondaryBtn.classList.remove('hidden');
        overlayKeyHint.textContent = 'Press P to resume';
      }
    } else {
      stateOverlay.classList.add('hidden');
      stateOverlay.classList.remove('flex');
    }
  }
}

function handleContextLost(lost: boolean): void {
  if (!stateOverlay || !overlayTitle || !overlaySubtitle || !overlayPrimaryBtn || !overlaySecondaryBtn || !overlayKeyHint) {
    return;
  }
  if (lost) {
    stateOverlay.classList.remove('hidden');
    stateOverlay.classList.add('flex');
    overlayTitle.textContent = 'Graphics Context Paused';
    overlayTitle.className = 'font-display text-2xl font-bold text-amber-400';
    overlaySubtitle.textContent = 'WebGL context was temporarily suspended by the browser.';
    overlayPrimaryBtn.textContent = 'Reload';
    overlaySecondaryBtn.classList.add('hidden');
    overlayKeyHint.textContent = '';
  } else {
    stateOverlay.classList.add('hidden');
    stateOverlay.classList.remove('flex');
  }
}

if (mountEl) {
  const engine = new GameEngine(mountEl, updateHud, handleContextLost);

  dockToggleBtn?.addEventListener('click', () => setDockCollapsed(!dockCollapsed));
  autoFireBtn?.addEventListener('click', () => engine.toggleAutoFire());
  muteBtn?.addEventListener('click', () => engine.toggleMute());
  pauseBtn?.addEventListener('click', () => engine.togglePause());
  restartBtn?.addEventListener('click', () => engine.resetGame());

  overlayPrimaryBtn?.addEventListener('click', () => {
    if (currentPhase === 'paused') {
      engine.togglePause();
    } else {
      engine.resetGame();
    }
  });
  overlaySecondaryBtn?.addEventListener('click', () => engine.resetGame());

  camButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.camera as CameraPreset | undefined;
      if (preset) engine.setCameraPreset(preset);
    });
  });

  weaponButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.weapon as FireMode | undefined;
      if (mode) engine.setFireMode(mode);
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') {
      setDockCollapsed(!dockCollapsed);
    }
  });

  window.addEventListener('beforeunload', () => engine.dispose());
}
