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
import { PerformanceGovernor, type FrameStats } from './PerformanceGovernor';
import { ScreenTransition } from './ScreenTransition';
import { LoadingReporter } from './LoadingReporter';

export class Game {
  private readonly reporter = new LoadingReporter();
  private readonly hud = new GameHud();
  private readonly frameMonitor = new FrameMonitor();
  private readonly performanceGovernor = new PerformanceGovernor();
  private readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private readonly audio = new AudioDirector();
  private readonly saveStore = new GameSaveStore();
  private readonly settingsStore = new GameSettingsStore();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly playerVelocity = new THREE.Vector3();
  private readonly playerPosition = new THREE.Vector3();
  private readonly playerForward = new THREE.Vector3(0, 0, -1);
  private readonly moonColor = new THREE.Color();
  private readonly hemisphereSkyTarget = new THREE.Color();
  private readonly hemisphereGroundTarget = new THREE.Color();
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
  private screenTransition!: ScreenTransition;
  private endingTitleButton!: HTMLButtonElement;
  private endingNewGameButton!: HTMLButtonElement;
  private moon!: THREE.DirectionalLight;
  private moonTarget!: THREE.Object3D;
  private hemisphere!: THREE.HemisphereLight;
  private heroFill!: THREE.SpotLight;
  private heroFillTarget!: THREE.Object3D;
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
  private performanceTier: 0 | 1 | 2 = 0;
  private shadowFrame = 0;
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
    this.screenTransition = new ScreenTransition(this.requireElement('screen-transition'));
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
    const initialPerformance = this.performanceGovernor.setQuality(this.settings.quality);
    this.performanceTier = initialPerformance.effectTier;
    this.world.setPresentationQuality(this.settings.quality, this.performanceTier);
    this.pipeline.setPerformanceTier(this.performanceTier);
    this.applySettings(this.settings);
    this.resizeRenderer();

    this.player.getCameraTarget(this.cameraTarget);
    this.player.copyVelocity(this.playerVelocity);
    this.player.copyForward(this.playerForward);
    this.cameraRig.update(
      1,
      this.cameraTarget,
      this.playerVelocity,
      this.playerForward,
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
    this.hemisphere = new THREE.HemisphereLight(0x91a6ba, 0x211a16, 1.08);
    this.scene.add(this.hemisphere);

    this.moonTarget = new THREE.Object3D();
    this.moonTarget.position.set(0, 2.2, 0);
    this.scene.add(this.moonTarget);
    this.moon = new THREE.DirectionalLight(0xc4d8ea, 4.1);
    this.moon.position.set(-24, 34, 18);
    this.moon.target = this.moonTarget;
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

    const cathedralGlow = new THREE.SpotLight(0xb77b48, 46, 96, Math.PI * 0.23, 0.72, 1.2);
    cathedralGlow.position.set(0, 18, -36);
    cathedralGlow.target.position.set(0, 3, -9);
    this.scene.add(cathedralGlow, cathedralGlow.target);

    this.heroFillTarget = new THREE.Object3D();
    this.scene.add(this.heroFillTarget);
    this.heroFill = new THREE.SpotLight(0xdde8f2, 9.5, 18, Math.PI * 0.32, 0.78, 1.35);
    this.heroFill.castShadow = false;
    this.heroFill.target = this.heroFillTarget;
    this.scene.add(this.heroFill);
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
    return Math.min(window.devicePixelRatio, limit) * this.performanceGovernor.getState().resolutionScale;
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
      const state = this.performanceGovernor.setQuality(settings.quality);
      this.performanceTier = state.effectTier;
      this.world?.setPresentationQuality(settings.quality, this.performanceTier);
      this.pipeline?.setPerformanceTier(this.performanceTier);
    }
    this.settingsStore.save(settings);
    this.menu?.setSettings(settings);
    this.audio.setMasterVolume(settings.masterVolume);
    const effectiveShake = settings.reducedMotion ? settings.cameraShake * 0.18 : settings.cameraShake;
    this.cameraRig?.setControlSettings(settings.mouseSensitivity, effectiveShake);
    this.pipeline?.setQuality(settings.quality);
    this.world?.setPresentationQuality(settings.quality, this.performanceTier);
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
      const shadowSize = settings.quality === 'performance' ? 1024 : settings.quality === 'cinematic' ? 2048 : 1536;
      if (this.moon.shadow.mapSize.x !== shadowSize) {
        this.moon.shadow.mapSize.set(shadowSize, shadowSize);
        this.moon.shadow.map?.dispose();
        this.moon.shadow.map = null;
      }
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
    if (event.repeat || this.screenTransition?.isActive()) return;
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
    this.runScreenTransition(
      () => {
        this.saveStore.clear();
        this.progression.startNewGame(this.player, this.combat);
        this.playTimeSeconds = 0;
        this.lastSaveFingerprint = '';
        this.prepareGameplay();
        this.saveNow(true);
      },
      () => this.finishGameplayTransition(),
    );
  }

  private continueGame(): void {
    this.audio.unlock();
    const save = this.saveStore.load();
    if (!save) {
      this.startNewGame();
      return;
    }
    this.runScreenTransition(
      () => {
        this.combat.restoreSaveState(save.combat);
        this.progression.restoreSaveState(save.progression, this.player);
        this.playTimeSeconds = Math.max(0, save.playTimeSeconds);
        this.lastSaveFingerprint = '';
        this.prepareGameplay();
      },
      () => this.finishGameplayTransition(),
    );
  }

  private prepareGameplay(): void {
    this.gameActive = true;
    this.paused = true;
    this.endingPresented = false;
    this.autosaveAccumulator = 0;
    this.pipeline.setEndingState(false, null);
    this.menu.hideAll();
    this.hud.setMenuSuppressed(false);
    this.input.setEnabled(false);
    this.cameraRig.setEnabled(false);
    this.audio.setDucked(true);
    const fatal = document.getElementById('fatal-error');
    fatal?.classList.add('is-hidden');
    this.snapCameraToPlayer();
    this.clock.getDelta();
  }

  private finishGameplayTransition(): void {
    if (!this.gameActive || this.progression.isEndingLocked()) return;
    this.paused = false;
    this.input.setEnabled(true);
    this.cameraRig.setEnabled(true);
    this.audio.setDucked(false);
    this.clock.getDelta();
  }

  private pauseGame(): void {
    if (!this.gameActive || this.paused || this.screenTransition.isActive()) return;
    this.paused = true;
    this.input.setEnabled(false);
    this.cameraRig.setEnabled(false);
    this.audio.setDucked(true);
    this.hud.setMenuSuppressed(true);
    this.menu.showPause();
    this.saveNow(false, true);
  }

  private resumeGame(): void {
    if (!this.gameActive || this.screenTransition.isActive()) return;
    this.paused = false;
    this.menu.hideAll();
    this.hud.setMenuSuppressed(false);
    this.input.setEnabled(true);
    this.cameraRig.setEnabled(true);
    this.audio.setDucked(false);
    this.clock.getDelta();
  }

  private restartCheckpoint(): void {
    if (!this.gameActive) return;
    this.runScreenTransition(
      () => {
        this.progression.restartAtCheckpoint(this.player, this.combat);
        this.hitStopRemaining = 0;
        this.prepareGameplay();
        this.saveNow(true);
      },
      () => this.finishGameplayTransition(),
    );
  }

  private returnToTitle(): void {
    this.saveNow(false, true);
    this.runScreenTransition(() => {
      this.gameActive = false;
      this.paused = true;
      this.input.setEnabled(false);
      this.cameraRig.setEnabled(false);
      this.audio.setDucked(true);
      this.hud.setMenuSuppressed(true);
      this.pipeline.setEndingState(false, null);
      this.menu.showTitle(this.saveStore.getSummary());
    });
  }

  private runScreenTransition(action: () => void, complete?: () => void): void {
    if (this.screenTransition.isActive()) return;
    this.paused = true;
    this.input.setEnabled(false);
    this.cameraRig.setEnabled(false);
    this.audio.setDucked(true);
    this.screenTransition.coverAndRun(action, 0.08, complete);
  }

  private snapCameraToPlayer(): void {
    this.player.getCameraTarget(this.cameraTarget);
    this.player.copyForward(this.playerForward);
    this.cameraRig.snapBehind(this.playerForward, this.cameraTarget);
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


  private updatePerformanceGovernor(stats: FrameStats, delta: number): void {
    const state = this.performanceGovernor.update(stats, delta, this.gameActive && !this.paused);
    if (state.changed) {
      this.performanceTier = state.effectTier;
      this.world.setPresentationQuality(this.settings.quality, this.performanceTier);
      this.pipeline.setPerformanceTier(this.performanceTier);
      this.resizeRenderer();
    }
    this.hud.setPerformance(
      stats,
      state.resolutionScale,
      this.performanceTier,
      this.cameraRig.getCollisionRatio(),
      this.renderer.info.render.calls,
      this.renderer.info.render.triangles,
    );
  }

  private updateLighting(delta: number): void {
    this.world.copyMoonColor(this.moonColor);
    const lightAlpha = 1 - Math.exp(-1.4 * delta);
    this.moon.color.lerp(this.moonColor, lightAlpha);
    this.moon.intensity += (this.world.getMoonIntensity() - this.moon.intensity) * lightAlpha;
    this.hemisphereSkyTarget.copy(this.moonColor).multiplyScalar(0.78).offsetHSL(0, -0.08, 0.08);
    this.hemisphereGroundTarget.copy(this.moonColor).multiplyScalar(0.18).offsetHSL(0.04, 0.08, -0.08);
    this.hemisphere.color.lerp(this.hemisphereSkyTarget, lightAlpha);
    this.hemisphere.groundColor.lerp(this.hemisphereGroundTarget, lightAlpha);

    const shadowSpan = 84;
    const shadowMapSize = Math.max(512, this.moon.shadow.mapSize.x);
    const texelSize = shadowSpan / shadowMapSize;
    const snappedX = Math.round(this.playerPosition.x / texelSize) * texelSize;
    const snappedZ = Math.round(this.playerPosition.z / texelSize) * texelSize;
    this.moonTarget.position.set(snappedX, this.playerPosition.y + 1.1, snappedZ);
    this.moon.position.set(snappedX - 24, this.playerPosition.y + 34, snappedZ + 18);
    this.moonTarget.updateMatrixWorld();

    this.shadowFrame += 1;
    const shadowInterval = this.performanceTier === 2 ? 4 : this.performanceTier === 1 ? 2 : 1;
    this.renderer.shadowMap.autoUpdate = shadowInterval === 1;
    if (shadowInterval > 1 && this.shadowFrame % shadowInterval === 0) this.renderer.shadowMap.needsUpdate = true;

    this.heroFill.position.copy(this.camera.position).addScaledVector(this.planarRight, -0.9);
    this.heroFill.position.y += 1.4;
    this.heroFillTarget.position.copy(this.playerPosition);
    this.heroFillTarget.position.y += 1.15;
    this.heroFillTarget.updateMatrixWorld();
    const fillTarget = this.settings.quality === 'performance' ? 6.2 : 8.5;
    this.heroFill.intensity += (fillTarget - this.heroFill.intensity) * (1 - Math.exp(-4 * delta));

    const exposureTarget = this.world.getExposure();
    this.renderer.toneMappingExposure += (exposureTarget - this.renderer.toneMappingExposure) * (1 - Math.exp(-1.5 * delta));
  }

  private readonly animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);

    if (this.contextLost) return;

    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.input.update();
    this.menu.update();
    this.screenTransition.update(delta);

    if (!this.gameActive || this.paused) {
      const idleDelta = Math.min(delta, 1 / 30);
      this.player.getWorldPosition(this.playerPosition);
      this.audio.update(idleDelta);
      this.world.update(idleDelta * 0.35, this.playerPosition);
      this.updateLighting(idleDelta * 0.5);
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
    this.player.getCameraTarget(this.cameraTarget);
    this.player.copyVelocity(this.playerVelocity);
    this.player.copyForward(this.playerForward);
    this.player.getWorldPosition(this.playerPosition);
    this.world.update(delta, this.playerPosition);
    this.updateLighting(delta);
    this.player.updateVisual(presentationDelta);
    this.combat.updateVisual(presentationDelta);
    this.progression.update(delta, this.player, this.combat);
    if (this.progression.consumeSaveRequest()) this.saveNow(true);
    this.world.applyPlayerInfluence(this.playerPosition, this.playerVelocity);
    const lockTarget = this.combat.getLockTargetPosition();
    this.cameraRig.addImpulse(this.combat.consumeCameraImpulse());
    this.cameraRig.update(
      delta,
      this.cameraTarget,
      this.playerVelocity,
      this.playerForward,
      this.player.getSprintBlend(),
      this.input.getLookAxes(),
      lockTarget,
    );

    const frameStats = this.frameMonitor.update(delta);
    this.updatePerformanceGovernor(frameStats, delta);
    this.hud.setFps(frameStats.fps);
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

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Required element is missing: #${id}`);
    return element;
  }

  private requireButton(id: string): HTMLButtonElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Required button is missing: #${id}`);
    return element;
  }
}
