import type { Camera } from 'three';
import type { BossSnapshot, LockTargetSnapshot } from '../combat/CombatTypes';
import type { BossPresentationEvent } from '../enemy/GatewardenVarkan';
import type { PlayerMotionState } from '../player/PlayerController';
import type { ProgressionSnapshot } from '../progression/ProgressionDirector';

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
  private readonly deathProgressFill: HTMLElement;
  private readonly flaskCount: HTMLElement;
  private readonly ashCount: HTMLElement;
  private readonly interactionPrompt: HTMLElement;
  private readonly noticePanel: HTMLElement;
  private readonly areaTitle: HTMLElement;
  private readonly areaTitleName: HTMLElement;
  private readonly objectiveText: HTMLElement;
  private readonly bossPanel: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossEpithet: HTMLElement;
  private readonly bossHealthFill: HTMLElement;
  private readonly bossPoiseFill: HTMLElement;
  private readonly bossShieldTrack: HTMLElement;
  private readonly bossShieldFill: HTMLElement;
  private readonly bossPhaseLabel: HTMLElement;
  private readonly bossIntro: HTMLElement;
  private readonly bossIntroEpithet: HTMLElement;
  private readonly bossIntroName: HTMLElement;
  private readonly bossPhaseBanner: HTMLElement;
  private readonly bossVictory: HTMLElement;
  private currentArea = '';
  private bossActive = false;
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
    this.deathProgressFill = this.requireElement('death-progress-fill');
    this.flaskCount = this.requireElement('flask-count');
    this.ashCount = this.requireElement('ash-count');
    this.interactionPrompt = this.requireElement('interaction-prompt');
    this.noticePanel = this.requireElement('notice-panel');
    this.areaTitle = this.requireElement('area-title');
    this.areaTitleName = this.requireElement('area-title-name');
    this.objectiveText = this.requireElement('objective-text');
    this.bossPanel = this.requireElement('boss-panel');
    this.bossName = this.requireElement('boss-name');
    this.bossEpithet = this.requireElement('boss-epithet');
    this.bossHealthFill = this.requireElement('boss-health-fill');
    this.bossPoiseFill = this.requireElement('boss-poise-fill');
    this.bossShieldTrack = this.requireElement('boss-shield-track');
    this.bossShieldFill = this.requireElement('boss-shield-fill');
    this.bossPhaseLabel = this.requireElement('boss-phase-label');
    this.bossIntro = this.requireElement('boss-intro');
    this.bossIntroEpithet = this.requireElement('boss-intro-epithet');
    this.bossIntroName = this.requireElement('boss-intro-name');
    this.bossPhaseBanner = this.requireElement('boss-phase-banner');
    this.bossVictory = this.requireElement('boss-victory');
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
      heal: '회복',
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
    this.lockPanel.classList.toggle('is-hidden', !visible || this.bossActive);
    this.lockReticle.classList.toggle('is-hidden', !visible);
    if (!snapshot || !visible) {
      this.executionPrompt.classList.add('is-hidden');
      return;
    }
    this.lockName.textContent = snapshot.name;
    this.lockHealthFill.style.transform = `scaleX(${clamp01(snapshot.healthRatio)})`;
    this.lockPoiseFill.style.transform = `scaleX(${clamp01(snapshot.poiseRatio)})`;
    this.executionPrompt.classList.toggle('is-hidden', !snapshot.executable || this.bossActive);
    if (projected) {
      this.lockReticle.style.left = `${(projected.x * 0.5 + 0.5) * 100}%`;
      this.lockReticle.style.top = `${(-projected.y * 0.5 + 0.5) * 100}%`;
    }
  }

  setBoss(snapshot: BossSnapshot, event: BossPresentationEvent | null): void {
    this.bossActive = snapshot.active;
    this.bossPanel.classList.toggle('is-hidden', !snapshot.active);
    if (snapshot.active) {
      this.bossName.textContent = snapshot.name;
      this.bossEpithet.textContent = snapshot.epithet;
      this.bossHealthFill.style.transform = `scaleX(${clamp01(snapshot.healthRatio)})`;
      this.bossPoiseFill.style.transform = `scaleX(${clamp01(snapshot.poiseRatio)})`;
      this.bossShieldFill.style.transform = `scaleX(${clamp01(snapshot.shieldRatio)})`;
      this.bossShieldTrack.classList.toggle('is-hidden', snapshot.phase !== 1 || snapshot.shieldRatio <= 0);
      this.bossPhaseLabel.textContent = snapshot.phase === 1 ? 'I · 검은 방패' : 'II · 맹세의 칼날';
      this.root.classList.toggle('boss-phase-two', snapshot.phase === 2 || snapshot.phaseTransition);
    } else {
      this.root.classList.remove('boss-phase-two');
    }

    if (event === 'intro') {
      this.bossIntroEpithet.textContent = snapshot.epithet;
      this.bossIntroName.textContent = snapshot.name;
      this.showTimedPanel(this.bossIntro, 2700);
    } else if (event === 'phase2') {
      this.showTimedPanel(this.bossPhaseBanner, 2300);
    } else if (event === 'defeated') {
      this.bossPanel.classList.add('is-hidden');
      this.showTimedPanel(this.bossVictory, 4200);
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

  setProgression(snapshot: ProgressionSnapshot): void {
    this.ashCount.textContent = snapshot.ash.toLocaleString('ko-KR');
    this.flaskCount.textContent = `${snapshot.flaskCharges}/${snapshot.flaskCapacity}`;
    this.interactionPrompt.classList.toggle('is-hidden', !snapshot.interaction);
    if (snapshot.interaction) this.interactionPrompt.textContent = snapshot.interaction;
    this.noticePanel.classList.toggle('is-hidden', !snapshot.notice);
    if (snapshot.notice) this.noticePanel.textContent = snapshot.notice;
    this.objectiveText.textContent = snapshot.objective;
    this.deathProgressFill.style.transform = `scaleX(${clamp01(snapshot.deathProgress)})`;
    if (snapshot.areaName !== this.currentArea) {
      this.currentArea = snapshot.areaName;
      this.areaTitleName.textContent = snapshot.areaName;
      this.areaTitle.style.animation = 'none';
      void this.areaTitle.offsetWidth;
      this.areaTitle.style.animation = '';
    }
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

  private showTimedPanel(element: HTMLElement, duration: number): void {
    const previousTimer = Number(element.dataset.hideTimer ?? 0);
    if (previousTimer) window.clearTimeout(previousTimer);
    element.classList.remove('is-hidden');
    element.style.animation = 'none';
    void element.offsetWidth;
    element.style.animation = '';
    const timer = window.setTimeout(() => {
      element.classList.add('is-hidden');
      element.dataset.hideTimer = '0';
    }, duration);
    element.dataset.hideTimer = String(timer);
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
