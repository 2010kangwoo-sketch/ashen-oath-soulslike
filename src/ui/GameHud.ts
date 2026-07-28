import type { Camera } from 'three';
import type { BossPresentationEvent, BossSnapshot, LockTargetSnapshot } from '../combat/CombatTypes';
import type { PlayerMotionState } from '../player/PlayerController';
import type { EndingSnapshot, ProgressionSnapshot } from '../progression/ProgressionDirector';
import type { FrameStats } from '../core/PerformanceGovernor';

export class GameHud {
  private readonly root: HTMLElement;
  private readonly help: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly fpsStatus: HTMLElement;
  private readonly movementStatus: HTMLElement;
  private readonly speedStatus: HTMLElement;
  private readonly groundedStatus: HTMLElement;
  private readonly frameTimeStatus: HTMLElement;
  private readonly renderScaleStatus: HTMLElement;
  private readonly effectTierStatus: HTMLElement;
  private readonly cameraSpaceStatus: HTMLElement;
  private readonly drawCallStatus: HTMLElement;
  private readonly triangleStatus: HTMLElement;
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
  private readonly bossSecondaryLabel: HTMLElement;
  private readonly bossPhaseLabel: HTMLElement;
  private readonly bossIntro: HTMLElement;
  private readonly bossIntroEpithet: HTMLElement;
  private readonly bossIntroName: HTMLElement;
  private readonly bossPhaseBanner: HTMLElement;
  private readonly bossPhaseKicker: HTMLElement;
  private readonly bossPhaseTitle: HTMLElement;
  private readonly bossVictory: HTMLElement;
  private readonly bossVictoryKicker: HTMLElement;
  private readonly bossVictoryTitle: HTMLElement;
  private readonly raidMechanic: HTMLElement;
  private readonly raidMechanicName: HTMLElement;
  private readonly raidMechanicHint: HTMLElement;
  private readonly raidMechanicFill: HTMLElement;
  private readonly endingPanel: HTMLElement;
  private readonly endingKicker: HTMLElement;
  private readonly endingTitle: HTMLElement;
  private readonly endingSubtitle: HTMLElement;
  private readonly endingQuote: HTMLElement;
  private readonly endingCredits: HTMLElement;
  private readonly endingCreditRoll: HTMLElement;
  private readonly endingActions: HTMLElement;
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
    this.frameTimeStatus = this.requireElement('frame-time-status');
    this.renderScaleStatus = this.requireElement('render-scale-status');
    this.effectTierStatus = this.requireElement('effect-tier-status');
    this.cameraSpaceStatus = this.requireElement('camera-space-status');
    this.drawCallStatus = this.requireElement('draw-call-status');
    this.triangleStatus = this.requireElement('triangle-status');
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
    this.bossSecondaryLabel = this.requireElement('boss-secondary-label');
    this.bossPhaseLabel = this.requireElement('boss-phase-label');
    this.bossIntro = this.requireElement('boss-intro');
    this.bossIntroEpithet = this.requireElement('boss-intro-epithet');
    this.bossIntroName = this.requireElement('boss-intro-name');
    this.bossPhaseBanner = this.requireElement('boss-phase-banner');
    this.bossPhaseKicker = this.requireElement('boss-phase-kicker');
    this.bossPhaseTitle = this.requireElement('boss-phase-title');
    this.bossVictory = this.requireElement('boss-victory');
    this.bossVictoryKicker = this.requireElement('boss-victory-kicker');
    this.bossVictoryTitle = this.requireElement('boss-victory-title');
    this.raidMechanic = this.requireElement('raid-mechanic');
    this.raidMechanicName = this.requireElement('raid-mechanic-name');
    this.raidMechanicHint = this.requireElement('raid-mechanic-hint');
    this.raidMechanicFill = this.requireElement('raid-mechanic-fill');
    this.endingPanel = this.requireElement('ending-panel');
    this.endingKicker = this.requireElement('ending-kicker');
    this.endingTitle = this.requireElement('ending-title');
    this.endingSubtitle = this.requireElement('ending-subtitle');
    this.endingQuote = this.requireElement('ending-quote');
    this.endingCredits = this.requireElement('ending-credits');
    this.endingCreditRoll = this.requireElement('ending-credit-roll');
    this.endingActions = this.requireElement('ending-actions');
  }

  reveal(): void {
    this.root.classList.remove('is-hidden');
    window.setTimeout(() => this.root.classList.add('hud-settled'), 4200);
  }


  setMenuSuppressed(suppressed: boolean): void {
    this.root.classList.toggle('menu-suppressed', suppressed);
  }

  setControlHelpVisible(visible: boolean): void {
    this.help.classList.toggle('is-hidden', !visible);
  }

  setFps(fps: number): void {
    if (fps > 0) this.fpsStatus.textContent = `${fps} FPS`;
  }


  setPerformance(
    stats: FrameStats,
    resolutionScale: number,
    effectTier: 0 | 1 | 2,
    cameraCollisionRatio: number,
    drawCalls: number,
    triangles: number,
  ): void {
    if (stats.fps <= 0) return;
    this.frameTimeStatus.textContent = `${stats.averageFrameMs.toFixed(1)} / ${stats.p95FrameMs.toFixed(1)} ms`;
    this.renderScaleStatus.textContent = `${Math.round(resolutionScale * 100)}%`;
    this.effectTierStatus.textContent = effectTier === 0 ? '전체' : effectTier === 1 ? '절약' : '최소';
    this.cameraSpaceStatus.textContent = `${Math.round(cameraCollisionRatio * 100)}%`;
    this.drawCallStatus.textContent = drawCalls.toLocaleString('ko-KR');
    this.triangleStatus.textContent = triangles.toLocaleString('ko-KR');
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
      this.bossShieldTrack.classList.toggle('is-hidden', snapshot.shieldRatio <= 0);
      this.bossSecondaryLabel.textContent = snapshot.secondaryLabel ?? '보조 내구도';
      this.bossPhaseLabel.textContent = snapshot.phaseLabel ?? (snapshot.phase === 1 ? 'I' : snapshot.phase === 2 ? 'II' : 'III');
      this.root.classList.toggle('boss-phase-two', snapshot.phase === 2 || (snapshot.phaseTransition && snapshot.phase < 3));
      this.root.classList.toggle('boss-phase-three', snapshot.phase === 3);
      const mechanicVisible = Boolean(snapshot.mechanicName);
      this.raidMechanic.classList.toggle('is-hidden', !mechanicVisible);
      this.raidMechanic.classList.toggle('danger', snapshot.mechanicDanger ?? false);
      if (mechanicVisible) {
        this.raidMechanicName.textContent = snapshot.mechanicName ?? '';
        this.raidMechanicHint.textContent = snapshot.mechanicHint ?? '';
        this.raidMechanicFill.style.transform = `scaleX(${clamp01(snapshot.mechanicProgress ?? 0)})`;
      }
    } else {
      this.root.classList.remove('boss-phase-two', 'boss-phase-three');
      this.raidMechanic.classList.add('is-hidden');
    }

    if (event === 'intro') {
      this.bossIntroEpithet.textContent = snapshot.epithet;
      this.bossIntroName.textContent = snapshot.name;
      this.showTimedPanel(this.bossIntro, 2700);
    } else if (event === 'phase2') {
      this.bossPhaseKicker.textContent = snapshot.transitionKicker ?? '두 번째 서약';
      this.bossPhaseTitle.textContent = snapshot.transitionTitle ?? snapshot.epithet;
      this.showTimedPanel(this.bossPhaseBanner, 2300);
    } else if (event === 'phase3') {
      this.bossPhaseKicker.textContent = snapshot.transitionKicker ?? '마지막 서약';
      this.bossPhaseTitle.textContent = snapshot.transitionTitle ?? snapshot.epithet;
      this.showTimedPanel(this.bossPhaseBanner, 2700);
    } else if (event === 'defeated') {
      this.bossVictoryKicker.textContent = snapshot.victoryKicker ?? '전투가 끝났습니다';
      this.bossVictoryTitle.textContent = snapshot.victoryTitle ?? `${snapshot.name} 격파`;
      this.bossPanel.classList.add('is-hidden');
      this.raidMechanic.classList.add('is-hidden');
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
    this.setEnding(snapshot.ending);
    this.deathProgressFill.style.transform = `scaleX(${clamp01(snapshot.deathProgress)})`;
    if (snapshot.areaName !== this.currentArea) {
      this.currentArea = snapshot.areaName;
      this.areaTitleName.textContent = snapshot.areaName;
      this.areaTitle.style.animation = 'none';
      void this.areaTitle.offsetWidth;
      this.areaTitle.style.animation = '';
    }
  }


  private setEnding(snapshot: EndingSnapshot): void {
    this.endingPanel.classList.toggle('is-hidden', !snapshot.active);
    this.root.classList.toggle('ending-active', snapshot.active);
    if (!snapshot.active || !snapshot.choice) {
      this.endingActions.classList.add('is-hidden');
      return;
    }
    const inherit = snapshot.choice === 'inherit';
    this.endingPanel.classList.toggle('ending-inherit', inherit);
    this.endingPanel.classList.toggle('ending-sever', !inherit);
    this.endingKicker.textContent = inherit ? 'THE OATH ENDURES' : 'THE OATH IS BROKEN';
    this.endingTitle.textContent = snapshot.title;
    this.endingSubtitle.textContent = snapshot.subtitle;
    this.endingQuote.textContent = snapshot.quote;
    const progress = clamp01(snapshot.creditsProgress);
    const reducedMotion = document.documentElement.classList.contains('reduced-motion');
    this.endingCredits.style.opacity = reducedMotion ? '0' : String(clamp01((progress - 0.02) * 3.2));
    this.endingCreditRoll.style.transform = reducedMotion
      ? 'translate(-50%, 0)'
      : `translate(-50%, ${THREELESS_LERP(34, -38, progress)}vh)`;
    this.endingActions.classList.toggle('is-hidden', progress < (reducedMotion ? 0.18 : 0.88));
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

function THREELESS_LERP(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
