import * as THREE from 'three';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { GAME_CONFIG } from '../config/GameConfig';
import { InputController } from '../input/InputController';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import { DiagnosticsHud } from '../ui/DiagnosticsHud';
import { PrototypeWorld } from '../world/PrototypeWorld';
import { FrameMonitor } from './FrameMonitor';
import { LoadingReporter } from './LoadingReporter';

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly reporter = new LoadingReporter();
  private readonly hud = new DiagnosticsHud();
  private readonly frameMonitor = new FrameMonitor();
  private readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly planarForward = new THREE.Vector3();
  private readonly planarRight = new THREE.Vector3();
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private cameraRig!: ThirdPersonCamera;
  private input!: InputController;
  private physics!: PhysicsWorld;
  private world!: PrototypeWorld;
  private player!: PlayerController;
  private animationFrame = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async start(): Promise<void> {
    this.reporter.update(10, '렌더러 준비');
    this.createRenderer();
    this.createCamera();
    this.createLighting();
    this.hud.setRenderReady();

    this.reporter.update(38, 'Rapier 3D 물리 모듈 초기화');
    this.physics = await PhysicsWorld.create();
    this.hud.setPhysicsReady();

    this.reporter.update(64, '이동 검증 성역 생성');
    this.world = new PrototypeWorld(this.scene, this.physics);

    this.reporter.update(82, '플레이어와 추적 카메라 연결');
    this.input = new InputController();
    this.player = new PlayerController(this.scene, this.physics);
    this.cameraRig = new ThirdPersonCamera(this.camera, this.canvas, this.world.cameraCollisionObjects);
    this.player.getCameraTarget(this.cameraTarget);
    this.cameraRig.update(1, this.cameraTarget);

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, GAME_CONFIG.renderer.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;

    this.scene.background = new THREE.Color(0x090c0f);
    this.scene.fog = new THREE.FogExp2(0x090c0f, 0.0185);
  }

  private createCamera(): void {
    this.camera = new THREE.PerspectiveCamera(
      GAME_CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      GAME_CONFIG.camera.near,
      GAME_CONFIG.camera.far,
    );
    this.camera.position.set(0, 0, 0);
  }

  private createLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0x8193a7, 0x17120e, 1.2);
    this.scene.add(hemisphere);

    const moon = new THREE.DirectionalLight(0xc5d0dc, 3.25);
    moon.position.set(-15, 24, 14);
    moon.castShadow = true;
    moon.shadow.mapSize.set(GAME_CONFIG.renderer.shadowMapSize, GAME_CONFIG.renderer.shadowMapSize);
    moon.shadow.camera.left = -32;
    moon.shadow.camera.right = 32;
    moon.shadow.camera.top = 32;
    moon.shadow.camera.bottom = -32;
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 85;
    moon.shadow.bias = -0.00025;
    this.scene.add(moon);

    const shrine = new THREE.PointLight(0xc19a63, 46, 28, 1.65);
    shrine.position.set(0, 6.2, -9.5);
    shrine.castShadow = true;
    this.scene.add(shrine);

    const gate = new THREE.PointLight(0x718ba1, 24, 21, 1.8);
    gate.position.set(0, 5.2, 19);
    this.scene.add(gate);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onResize = (): void => {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, GAME_CONFIG.renderer.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'KeyR') this.player.reset();
    if (event.code === 'KeyH') this.hud.toggleHelp();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.cameraRig.copyPlanarForward(this.planarForward);
    this.cameraRig.copyPlanarRight(this.planarRight);
    this.physics.step(delta, (fixedDelta) => {
      this.player.fixedUpdate(fixedDelta, this.input, this.planarForward, this.planarRight);
    });

    this.world.update();
    this.player.updateVisual(delta);
    this.player.getCameraTarget(this.cameraTarget);
    this.cameraRig.update(delta, this.cameraTarget);

    const fps = this.frameMonitor.update(delta);
    this.hud.setFps(fps);
    this.hud.setPlayerState(this.player.getMotionState(), this.player.getSpeed(), this.player.isGrounded());
    this.renderer.render(this.scene, this.camera);
  };
}
