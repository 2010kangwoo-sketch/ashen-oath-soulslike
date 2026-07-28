import * as THREE from 'three';
import { AudioDirector } from '../audio/AudioDirector';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { CombatDirector } from '../combat/CombatDirector';
import { GAME_CONFIG } from '../config/GameConfig';
import { InputController } from '../input/InputController';
import { GameSaveStore } from '../persistence/GameSave';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import { ProgressionDirector } from '../progression/ProgressionDirector';
import { RenderPipeline } from '../render/RenderPipeline';
import {
  DEFAULT_GAME_SETTINGS,
  GameSettingsStore,
  type GameSettings,
} from '../settings/GameSettings';
import { GameHud } from '../ui/GameHud';
import { GameMenu } from '../ui/GameMenu';
import { CathedralApproach } from '../world/CathedralApproach';
import { FrameMonitor } from './FrameMonitor';
import { LoadingReporter } from './LoadingReporter';

export class Game {
  private readonly reporter = new LoadingReporter();
  private readonly hud = new GameHud();
  private readonly frameMonitor = new FrameMonitor();
  private readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private readonly audio = new AudioDirector();
  private readonly saveStore = new GameSaveStore();
  private readonly settingsStore = new GameSettingsStore();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly playerVelocity = new THREE.Vector3();
  private readonly playerPosition = new THREE.Vector3();
  private readonly planarForward = new THREE.Vector3();
  private readonly planarRight = new THREE.Vector3();
  private renderer!: THREE.WebGLRenderer;
  private pipeline!: RenderPipeline;
  private camera!: THREE.PerspectiveCamera;
  private cameraRig!: ThirdPersonCamera;
  private input!: InputController;
  private physics!: PhysicsWorld;
  private world!: CathedralApproach;
  private player!: PlayerController;
  private combat!: CombatDirector;
  private progression!: ProgressionDirector;
  private menu!: GameMenu;
  private endingTitleButton!: HTMLButtonElement;
  private endingNewGameButton!: HTMLButtonElement;
  private moon!: THREE.DirectionalLight;
  private settings: GameSettings = DEFAULT_GAME_SETTINGS;
  private animationFrame = 0;
  private disposed = false;
  private gameActive = false;
  private paused = true;
  private hitStopRemaining = 0;
  private endingPresented = false;
  private playTimeSeconds = 0;
  private autosaveAccumulator = 0;
  private lastSaveFingerprint = '';
  private adaptivePixelScale = 1;
  private lowFpsDuration = 0;
  private highFpsDuration = 0;
  private contextLost = false;
  private readonly debugEnabled = new URLSearchParams(window.location.search).has('debug');

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async start(): Promise<void> {
    this.reporter.update(8, '빛과 그림자를 준비하는 중');
    this.createRenderer();
    this.createCamera();
    this.createLighting();

    this.reporter.update(31, '충돌 세계를 세우는 중');
    this.physics = await PhysicsWorld.create();

    this.reporter.update(53, '대성당 진입로를 복원하는 중');
    this.world = new CathedralApproach(this.scene, this.physics);

    this.reporter.update(73, '잿빛 기사의 무장을 조율하는 중');
    this.input = new InputController(this.canvas);
    this.player = new PlayerController(this.scene, this.physics, this.audio);
    this.combat = new CombatDirector(this.scene, this.physics, this.audio);
    this.progression = new ProgressionDirector(this.scene, this.physics, this.audio);
    this.cameraRig = new ThirdPersonCamera(this.camera, this.canvas, this.world.cameraCollisionObjects);
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera);
    this.menu = new GameMenu(this.settingsStore.load(), {
      onNewGame: () => this.startNewGame(),
      onContinue: () => this.continueGame(),
      onResume: () => this.resumeGame(),
      onRestartCheckpoint: () => this.restartCheckpoint(),
      onReturnToTitle: () => this.returnToTitle(),
      onSettingsChanged: (settings) => this.applySettings(settings),
    });
    this.endingTitleButton = this.requireButton('ending-title-button');
    this.endingNewGameButton = this.requireButton('ending-new-game-button');
    this.settings = this.settingsStore.load();
    this.applySettings(this.settings);
    this.resizeRenderer();

    this.player.getCameraTarget(this.cameraTarget);
    this.player.copyVelocity(this.playerVelocity);
    this.cameraRig.update(
      1,
      this.cameraTarget,
      this.playerVelocity,
      0,
      { horizontal: 0, vertical: 0 },
      null,
    );

    this.bindEvents();
    this.input.setEnabled(false);
    this.cameraRig.setEnabled(false);
    this.hud.reveal();
    this.hud.setMenuSuppressed(true);
    this.menu.showTitle(this.saveStore.getSummary());
    this.reporter.complete();
    this.clock.start();
    this.animate();
  }

  dispose(): void {
    this.saveNow(false, true);
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.input?.dispose();
    this.cameraRig?.dispose();
    this.pipeline?.dispose();
    this.renderer?.dispose();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('pointerdown', this.onAudioUnlock);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    window.removeEventListener('keydown', this.onAudioUnlock);
    this.endingTitleButton?.removeEventListener('click', this.onEndingReturnToTitle);
    this.endingNewGameButton?.removeEventListener('click', this.onEndingNewGame);
  }

  private createRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = GAME_CONFIG.renderer.exposure;
    this.renderer.setClearColor(0x07090b, 1);

    this.scene.background = new THREE.Color(0x090c10);
    this.scene.fog = new THREE.FogExp2(0x0a0d11, 0.0148);
  }

  private createCamera(): void {
    this.camera = new THREE.PerspectiveCamera(
      GAME_CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      GAME_CONFIG.camera.near,
      GAME_CONFIG.camera.far,
    );
  }

  private createLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0x8a9cad, 0x17120f, 0.95);
    this.scene.add(hemisphere);

    this.moon = new THREE.DirectionalLight(0xb8c7d8, 3.8);
    this.moon.position.set(-24, 34, 18);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(GAME_CONFIG.renderer.shadowMapSize, GAME_CONFIG.renderer.shadowMapSize);
    this.moon.shadow.camera.left = -42;
    this.moon.shadow.camera.right = 42;
    this.moon.shadow.camera.top = 48;
    this.moon.shadow.camera.bottom = -34;
    this.moon.shadow.camera.near = 2;
    this.moon.shadow.camera.far = 118;
    this.moon.shadow.bias = -0.00022;
    this.moon.shadow.normalBias = 0.025;
    this.scene.add(this.moon);

    const cathedralGlow = new THREE.SpotLight(0xa36f43, 42, 92, Math.PI * 0.23, 0.72, 1.2);
    cathedralGlow.position.set(0, 18, -36);
    cathedralGlow.target.position.set(0, 3, -9);
    this.scene.add(cathedralGlow, cathedralGlow.target);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('pointerdown', this.onAudioUnlock, { once: true });
    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    window.addEventListener('keydown', this.onAudioUnlock, { once: true });
    this.endingTitleButton.addEventListener('click', this.onEndingReturnToTitle);
    this.endingNewGameButton.addEventListener('click', this.onEndingNewGame);
  }

  private readonly onAudioUnlock = (): void => {
    this.audio.unlock();
  };

  private getPixelRatio(): number {
    const limit = this.settings.quality === 'performance'
      ? 1
      : this.settings.quality === 'cinematic'
        ? 1.8
        : 1.35;
    return Math.min(window.devicePixelRatio, limit) * this.adaptivePixelScale;
  }

  private resizeRenderer(): void {
    const pixelRatio = this.getPixelRatio();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.pipeline?.resize(window.innerWidth, window.innerHeight, pixelRatio);
  }

  private applySettings(settings: GameSettings): void {
    const qualityChanged = this.settings.quality !== settings.quality;
    this.settings = settings;
    if (qualityChanged) {
      this.adaptivePixelScale = 1;
      this.lowFpsDuration = 0;
      this.highFpsDuration = 0;
    }
    this.settingsStore.save(settings);
    this.menu?.setSettings(settings);
    this.audio.setMasterVolume(settings.masterVolume);
    const effectiveShake = settings.reducedMotion ? settings.cameraShake * 0.18 : settings.cameraShake;
    this.cameraRig?.setControlSettings(settings.mouseSensitivity, effectiveShake);
    this.pipeline?.setQuality(settings.quality);
    this.pipeline?.setAccessibility(settings.reducedMotion, settings.highContrastTelegraphs);
    this.combat?.setHighContrastTelegraphs(settings.highContrastTelegraphs);
    this.hud.setControlHelpVisible(settings.showControlHelp);
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
    document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
    document.documentElement.classList.toggle('high-contrast-telegraphs', settings.highContrastTelegraphs);
    if (this.renderer) {
      this.renderer.shadowMap.type = settings.quality === 'performance'
        ? THREE.PCFShadowMap
        : THREE.PCFSoftShadowMap;
      this.moon.castShadow = true;
      this.resizeRenderer();
    }
  }

  private readonly onResize = (): void => {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.resizeRenderer();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      if (this.menu.isSettingsVisible()) {
        this.menu.closeSettings();
      } else if (this.gameActive && !this.progression.isEndingLocked()) {
        if (this.paused) this.resumeGame();
        else this.pauseGame();
      }
      return;
    }
    if (!this.gameActive || this.paused) return;
    if (this.debugEnabled && event.code === 'F8' && !this.progression.isEndingLocked()) {
      this.progression.startNewGame(this.player, this.combat);
      this.playTimeSeconds = 0;
      this.lastSaveFingerprint = '';
      this.saveNow(true);
    }
    if (event.code === 'KeyH') {
      const next = !this.settings.showControlHelp;
      this.applySettings({ ...this.settings, showControlHelp: next });
    }
    if (this.debugEnabled && event.code === 'F3') {
      event.preventDefault();
      this.hud.toggleDebug();
    }
  };

  private readonly onBeforeUnload = (): void => {
    this.saveNow(false, true);
  };

  private readonly onPageHide = (): void => {
    this.saveNow(false, true);
  };

  private readonly onVisibilityChange = (): void => {
    if (!document.hidden || !this.gameActive) return;
    this.saveNow(false, true);
    if (!this.paused && !this.progression.isEndingLocked()) this.pauseGame();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.contextLost) return;
    this.contextLost = true;
    this.saveNow(false, true);
    this.paused = true;
    this.input?.setEnabled(false);
    this.cameraRig?.setEnabled(false);
    this.audio.setDucked(true);
    const fatal = document.getElementById('fatal-error');
    fatal?.classList.remove('is-hidden');
    if (fatal) fatal.textContent = '그래픽 장치 연결이 일시적으로 끊겼습니다. 안전하게 저장했으며, 복구되면 게임을 다시 불러옵니다.';
  };

  private readonly onContextRestored = (): void => {
    window.location.reload();
  };

  private readonly onEndingReturnToTitle = (): void => {
    this.saveNow(false, true);
    this.endingPresented = false;
    this.returnToTitle();
  };

  private readonly onEndingNewGame = (): void => {
    this.startNewGame();
  };

  private startNewGame(): void {
    this.audio.unlock();
    this.saveStore.clear();
    this.progression.startNewGame(this.player, this.combat);
    this.playTimeSeconds = 0;
    this.lastSaveFingerprint = '';
    this.enterGameplay();
    this.saveNow(true);
  }

  private continueGame(): void {
    this.audio.unlock();
    const save = this.saveStore.load();
    if (!save) {
      this.startNewGame();
      return;
    }
    this.combat.restoreSaveState(save.combat);
    this.progression.restoreSaveState(save.progression, this.player);
    this.playTimeSeconds = Math.max(0, save.playTimeSeconds);
    this.lastSaveFingerprint = '';
    this.enterGameplay();
  }

  private enterGameplay(): void {
    this.gameActive = true;
    this.paused = false;
    this.endingPresented = false;
    this.autosaveAccumulator = 0;
    this.pipeline.setEndingState(false, null);
    this.menu.hideAll();
    this.hud.setMenuSuppressed(false);
    this.input.setEnabled(true);
    this.cameraRig.setEnabled(true);
    this.audio.setDucked(false);
    const fatal = document.getElementById('fatal-error');
    fatal?.classList.add('is-hidden');
    this.clock.getDelta();
  }

  private pauseGame(): void {
    if (!this.gameActive || this.paused) return;
    this.paused = true;
    this.input.setEnabled(false);
    this.cameraRig.setEnabled(false);
    this.audio.setDucked(true);
    this.hud.setMenuSuppressed(true);
    this.menu.showPause();
    this.saveNow(false, true);
  }

  private resumeGame(): void {
    if (!this.gameActive) return;
    this.paused = false;
    this.menu.hideAll();
    this.hud.setMenuSuppressed(false);
    this.input.setEnabled(true);
    this.cameraRig.setEnabled(true);
    this.audio.setDucked(false);
    this.clock.getDelta();
  }

  private restartCheckpoint(): void {
    this.progression.restartAtCheckpoint(this.player, this.combat);
    this.hitStopRemaining = 0;
    this.resumeGame();
    this.saveNow(true);
  }

  private returnToTitle(): void {
    this.saveNow(false, true);
    this.gameActive = false;
    this.paused = true;
    this.input.setEnabled(false);
    this.cameraRig.setEnabled(false);
    this.audio.setDucked(true);
    this.hud.setMenuSuppressed(true);
    this.pipeline.setEndingState(false, null);
    this.menu.showTitle(this.saveStore.getSummary());
  }

  private saveNow(showIndicator: boolean, force = false): void {
    if (!this.gameActive) return;
    const payload = {
      playTimeSeconds: this.playTimeSeconds,
      progression: this.progression.getSaveState(),
      combat: this.combat.getSaveState(),
    };
    const fingerprint = JSON.stringify({
      progression: payload.progression,
      combat: payload.combat,
      playTimeBucket: Math.floor(this.playTimeSeconds / 30),
    });
    if (!force && fingerprint === this.lastSaveFingerprint) return;
    const saved = this.saveStore.save(payload);
    if (!saved) return;
    this.lastSaveFingerprint = fingerprint;
    if (showIndicator) this.menu.showAutosave();
  }

  private updateAutosave(delta: number): void {
    if (!this.gameActive || this.paused || this.progression.isEndingLocked()) return;
    this.playTimeSeconds += delta;
    this.autosaveAccumulator += delta;
    if (this.autosaveAccumulator < 1.5) return;
    this.autosaveAccumulator = 0;
    const before = this.lastSaveFingerprint;
    this.saveNow(false);
    if (before !== this.lastSaveFingerprint) this.menu.showAutosave();
  }


  private updatePerformanceGovernor(fps: number, delta: number): void {
    if (fps <= 0 || this.paused || !this.gameActive) return;
    if (fps < 38) {
      this.lowFpsDuration += delta;
      this.highFpsDuration = 0;
    } else if (fps > 55) {
      this.highFpsDuration += delta;
      this.lowFpsDuration = Math.max(0, this.lowFpsDuration - delta * 0.5);
    } else {
      this.lowFpsDuration = Math.max(0, this.lowFpsDuration - delta * 0.4);
      this.highFpsDuration = 0;
    }

    if (this.lowFpsDuration >= 5 && this.adaptivePixelScale > 0.72) {
      this.adaptivePixelScale = Math.max(0.72, this.adaptivePixelScale - 0.12);
      this.lowFpsDuration = 0;
      this.highFpsDuration = 0;
      this.resizeRenderer();
    } else if (this.highFpsDuration >= 14 && this.adaptivePixelScale < 1) {
      this.adaptivePixelScale = Math.min(1, this.adaptivePixelScale + 0.08);
      this.lowFpsDuration = 0;
      this.highFpsDuration = 0;
      this.resizeRenderer();
    }
  }

  private readonly animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);

    if (this.contextLost) return;

    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.input.update();
    this.menu.update();

    if (!this.gameActive || this.paused) {
      const idleDelta = Math.min(delta, 1 / 30);
      this.audio.update(idleDelta);
      this.world.update(idleDelta * 0.35);
      this.player.updateVisual(idleDelta * 0.3);
      this.combat.updateVisual(idleDelta * 0.18);
      this.pipeline.render(idleDelta);
      return;
    }

    this.cameraRig.copyPlanarForward(this.planarForward);
    this.cameraRig.copyPlanarRight(this.planarRight);
    const endingLocked = this.progression.isEndingLocked();
    if (!endingLocked) {
      this.combat.handleTargeting(this.input, this.player, this.planarForward);
      if (this.input.consumeAction('interact')) {
        const executed = this.combat.tryExecution(this.player);
        if (!executed) this.progression.tryInteract(this.player, this.combat);
      }
    }

    this.hitStopRemaining = Math.max(0, this.hitStopRemaining - delta);
    if (!endingLocked && this.hitStopRemaining <= 0) {
      this.physics.step(delta, (fixedDelta) => {
        const lockTarget = this.combat.getLockTargetPosition();
        this.player.fixedUpdate(fixedDelta, this.input, this.planarForward, this.planarRight, lockTarget);
        this.combat.fixedUpdate(fixedDelta, this.player);
      });
      this.hitStopRemaining = Math.max(this.hitStopRemaining, this.combat.consumeHitStop());
    }

    const presentationDelta = this.hitStopRemaining > 0 ? delta * 0.08 : delta;
    this.audio.update(delta);
    while (this.player.consumeFootstep()) this.audio.footstep(this.player.getSprintBlend());
    const bossWorldState = this.combat.getBossWorldState();
    this.world.setBossEncounterState(
      bossWorldState.varkanActive,
      bossWorldState.varkanDefeated,
      bossWorldState.widowActive,
      bossWorldState.widowDefeated,
      bossWorldState.oathkeeperActive,
      bossWorldState.oathkeeperDefeated,
    );
    this.world.update(delta);
    this.player.updateVisual(presentationDelta);
    this.combat.updateVisual(presentationDelta);
    this.progression.update(delta, this.player, this.combat);
    if (this.progression.consumeSaveRequest()) this.saveNow(true);
    this.player.getCameraTarget(this.cameraTarget);
    this.player.copyVelocity(this.playerVelocity);
    this.player.getWorldPosition(this.playerPosition);
    this.world.applyPlayerInfluence(this.playerPosition, this.playerVelocity);
    const lockTarget = this.combat.getLockTargetPosition();
    this.cameraRig.addImpulse(this.combat.consumeCameraImpulse());
    this.cameraRig.update(
      delta,
      this.cameraTarget,
      this.playerVelocity,
      this.player.getSprintBlend(),
      this.input.getLookAxes(),
      lockTarget,
    );

    const fps = this.frameMonitor.update(delta);
    this.updatePerformanceGovernor(fps, delta);
    this.hud.setFps(fps);
    this.hud.setPlayerState(this.player.getMotionState(), this.player.getSpeed(), this.player.isGrounded());
    this.hud.setVitals(this.player.getHealthRatio(), this.player.getStaminaRatio());
    this.hud.setCharge(this.player.getChargeRatio());
    const bossSnapshot = this.combat.getBossSnapshot();
    this.hud.setBoss(bossSnapshot, this.combat.consumeBossPresentationEvent());
    this.pipeline.setBossState(bossSnapshot);
    this.hud.setLockTarget(this.combat.getLockSnapshot(), this.camera);
    this.hud.setDeathState(this.player.isDead());
    const progressionSnapshot = this.progression.getSnapshot(this.player);
    this.hud.setProgression(progressionSnapshot);
    this.pipeline.setEndingState(progressionSnapshot.ending.active, progressionSnapshot.ending.choice);
    if (progressionSnapshot.ending.active && !this.endingPresented) {
      this.saveNow(false);
      this.endingPresented = true;
      if (document.pointerLockElement) document.exitPointerLock();
      this.input.setEnabled(false);
      this.cameraRig.setEnabled(false);
    }
    this.hud.setPointerLocked(this.cameraRig.isLocked());
    this.updateAutosave(delta);
    this.pipeline.render(delta);
  };

  private requireButton(id: string): HTMLButtonElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Required button is missing: #${id}`);
    return element;
  }
}
