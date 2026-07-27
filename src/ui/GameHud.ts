import type { Camera } from 'three';
import type { LockTargetSnapshot } from '../combat/CombatTypes';
import type { PlayerMotionState } from '../player/PlayerController';

export class GameHud {
  private readonly root: HTMLElement;
  private readonly help: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly fpsStatus: HTMLElement;
  private readonly movementStatus: HTMLElement;
  private readonly speedStatus: HTMLElement;
  private readonly groundedStatus: HTMLElement;
  private readonly pointerHint: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly lockPanel: HTMLElement;
  private readonly lockName: HTMLElement;
  private readonly lockHealthFill: HTMLElement;
  private readonly lockPoiseFill: HTMLElement;
  private readonly executionPrompt: HTMLElement;
  private readonly chargeMeter: HTMLElement;
  private readonly chargeFill: HTMLElement;
  private readonly lockReticle: HTMLElement;
  private readonly deathPanel: HTMLElement;
  private debugVisible = false;

  constructor() {
    this.root = this.requireElement('hud');
    this.help = this.requireElement('control-help');
    this.debug = this.requireElement('debug-panel');
    this.fpsStatus = this.requireElement('fps-status');
    this.movementStatus = this.requireElement('movement-status');
    this.speedStatus = this.requireElement('speed-status');
    this.groundedStatus = this.requireElement('grounded-status');
    this.pointerHint = this.requireElement('pointer-hint');
    this.healthFill = this.requireElement('health-fill');
    this.staminaFill = this.requireElement('stamina-fill');
    this.lockPanel = this.requireElement('lock-target-panel');
    this.lockName = this.requireElement('lock-target-name');
    this.lockHealthFill = this.requireElement('lock-target-health-fill');
    this.lockPoiseFill = this.requireElement('lock-target-poise-fill');
    this.executionPrompt = this.requireElement('execution-prompt');
    this.chargeMeter = this.requireElement('charge-meter');
    this.chargeFill = this.requireElement('charge-fill');
    this.lockReticle = this.requireElement('lock-reticle');
    this.deathPanel = this.requireElement('death-panel');
  }

  reveal(): void {
    this.root.classList.remove('is-hidden');
    window.setTimeout(() => this.root.classList.add('hud-settled'), 4200);
  }

  setFps(fps: number): void {
    if (fps > 0) this.fpsStatus.textContent = `${fps} FPS`;
  }

  setPlayerState(state: PlayerMotionState, speed: number, grounded: boolean): void {
    const labels: Record<PlayerMotionState, string> = {
      idle: '대기',
      walk: '걷기',
      run: '질주',
      airborne: '낙하',
      dodge: '회피',
      light1: '약공격 1',
      light2: '약공격 2',
      light3: '연계 마무리',
      heavyCharge: '강공격 모으기',
      heavy: '강공격',
      execute: '처형',
      guard: '방어',
      parry: '패링',
      stagger: '경직',
      dead: '쓰러짐',
    };
    this.movementStatus.textContent = labels[state];
    this.speedStatus.textContent = `${speed.toFixed(1)} m/s`;
    this.groundedStatus.textContent = grounded ? '접지' : '공중';
  }

  setVitals(healthRatio: number, staminaRatio: number): void {
    this.healthFill.style.transform = `scaleX(${clamp01(healthRatio)})`;
    this.staminaFill.style.transform = `scaleX(${clamp01(staminaRatio)})`;
    this.healthFill.parentElement?.classList.toggle('critical', healthRatio <= 0.25);
  }

  setLockTarget(snapshot: LockTargetSnapshot | null, camera: Camera): void {
    const projected = snapshot?.position.clone().project(camera);
    const visible = (snapshot?.active ?? false) && Boolean(projected && projected.z < 1);
    this.lockPanel.classList.toggle('is-hidden', !visible);
    this.lockReticle.classList.toggle('is-hidden', !visible);
    if (!snapshot || !visible) {
      this.executionPrompt.classList.add('is-hidden');
      return;
    }
    this.lockName.textContent = snapshot.name;
    this.lockHealthFill.style.transform = `scaleX(${clamp01(snapshot.healthRatio)})`;
    this.lockPoiseFill.style.transform = `scaleX(${clamp01(snapshot.poiseRatio)})`;
    this.executionPrompt.classList.toggle('is-hidden', !snapshot.executable);
    if (projected) {
      this.lockReticle.style.left = `${(projected.x * 0.5 + 0.5) * 100}%`;
      this.lockReticle.style.top = `${(-projected.y * 0.5 + 0.5) * 100}%`;
    }
  }

  setCharge(ratio: number): void {
    const visible = ratio > 0.005;
    this.chargeMeter.classList.toggle('is-hidden', !visible);
    this.chargeFill.style.transform = `scaleX(${clamp01(ratio)})`;
    this.chargeMeter.classList.toggle('fully-charged', ratio >= 0.995);
  }

  setDeathState(dead: boolean): void {
    this.deathPanel.classList.toggle('is-hidden', !dead);
  }

  setPointerLocked(locked: boolean): void {
    this.pointerHint.classList.toggle('is-hidden', locked);
  }

  toggleHelp(): void {
    this.help.classList.toggle('is-hidden');
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.debug.classList.toggle('is-hidden', !this.debugVisible);
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Required UI element is missing: #${id}`);
    return element;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
