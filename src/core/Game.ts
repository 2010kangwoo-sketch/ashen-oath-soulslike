import * as THREE from 'three';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { GAME_CONFIG } from '../config/GameConfig';
import { InputController } from '../input/InputController';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import { RenderPipeline } from '../render/RenderPipeline';
import { GameHud } from '../ui/GameHud';
import { CathedralApproach } from '../world/CathedralApproach';
import { FrameMonitor } from './FrameMonitor';
import { LoadingReporter } from './LoadingReporter';

export class Game {
  private readonly reporter = new LoadingReporter();
  private readonly hud = new GameHud();
  private readonly frameMonitor = new FrameMonitor();
  private readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly playerVelocity = new THREE.Vector3();
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
  private animationFrame = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async start(): Promise<void> {
    this.reporter.update(8, '빛과 그림자를 준비하는 중');
    this.createRenderer();
    this.createCamera();
    this.createLighting();

    this.reporter.update(34, '충돌 세계를 세우는 중');
    this.physics = await PhysicsWorld.create();

    this.reporter.update(58, '대성당 진입로를 복원하는 중');
    this.world = new CathedralApproach(this.scene, this.physics);

    this.reporter.update(78, '잿빛 기사를 깨우는 중');
    this.input = new InputController();
    this.player = new PlayerController(this.scene, this.physics);
    this.cameraRig = new ThirdPersonCamera(this.camera, this.canvas, this.world.cameraCollisionObjects);
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera);
    this.resizeRenderer();

    this.player.getCameraTarget(this.cameraTarget);
    this.player.copyVelocity(this.playerVelocity);
    this.cameraRig.update(1, this.cameraTarget, this.playerVelocity, 0, { horizontal: 0, vertical: 0 });

    this.bindEvents();
    this.hud.reveal();
    this.reporter.complete();
    this.clock.start();
    this.animate();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.input?.dispose();
    this.cameraRig?.dispose();
    this.pipeline?.dispose();
    this.renderer?.dispose();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
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

    const moon = new THREE.DirectionalLight(0xb8c7d8, 3.8);
    moon.position.set(-24, 34, 18);
    moon.castShadow = true;
    moon.shadow.mapSize.set(GAME_CONFIG.renderer.shadowMapSize, GAME_CONFIG.renderer.shadowMapSize);
    moon.shadow.camera.left = -42;
    moon.shadow.camera.right = 42;
    moon.shadow.camera.top = 48;
    moon.shadow.camera.bottom = -34;
    moon.shadow.camera.near = 2;
    moon.shadow.camera.far = 118;
    moon.shadow.bias = -0.00022;
    moon.shadow.normalBias = 0.025;
    this.scene.add(moon);

    const cathedralGlow = new THREE.SpotLight(0xa36f43, 42, 92, Math.PI * 0.23, 0.72, 1.2);
    cathedralGlow.position.set(0, 18, -36);
    cathedralGlow.target.position.set(0, 3, -9);
    this.scene.add(cathedralGlow, cathedralGlow.target);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private resizeRenderer(): void {
    const pixelRatio = Math.min(window.devicePixelRatio, GAME_CONFIG.renderer.maxPixelRatio);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.pipeline?.resize(window.innerWidth, window.innerHeight, pixelRatio);
  }

  private readonly onResize = (): void => {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.resizeRenderer();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'KeyR') this.player.reset();
    if (event.code === 'KeyH') this.hud.toggleHelp();
    if (event.code === 'F3') {
      event.preventDefault();
      this.hud.toggleDebug();
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.input.update();
    this.cameraRig.copyPlanarForward(this.planarForward);
    this.cameraRig.copyPlanarRight(this.planarRight);
    this.physics.step(delta, (fixedDelta) => {
      this.player.fixedUpdate(fixedDelta, this.input, this.planarForward, this.planarRight);
    });

    this.world.update(delta);
    this.player.updateVisual(delta);
    this.player.getCameraTarget(this.cameraTarget);
    this.player.copyVelocity(this.playerVelocity);
    this.cameraRig.update(
      delta,
      this.cameraTarget,
      this.playerVelocity,
      this.player.getSprintBlend(),
      this.input.getLookAxes(),
    );

    const fps = this.frameMonitor.update(delta);
    this.hud.setFps(fps);
    this.hud.setPlayerState(this.player.getMotionState(), this.player.getSpeed(), this.player.isGrounded());
    this.hud.setPointerLocked(this.cameraRig.isLocked());
    this.pipeline.render(delta);
  };
}
