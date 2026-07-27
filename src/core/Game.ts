import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GAME_CONFIG } from '../config/GameConfig';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PrototypeWorld } from '../world/PrototypeWorld';
import { DiagnosticsHud } from '../ui/DiagnosticsHud';
import { FrameMonitor } from './FrameMonitor';
import { LoadingReporter } from './LoadingReporter';

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly reporter = new LoadingReporter();
  private readonly hud = new DiagnosticsHud();
  private readonly frameMonitor = new FrameMonitor();
  private readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private physics!: PhysicsWorld;
  private world!: PrototypeWorld;
  private animationFrame = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async start(): Promise<void> {
    this.reporter.update(12, '렌더러 준비');
    this.createRenderer();
    this.createCamera();
    this.createLighting();
    this.hud.setRenderReady();

    this.reporter.update(45, 'Rapier 3D 물리 모듈 초기화');
    this.physics = await PhysicsWorld.create();
    this.hud.setPhysicsReady();

    this.reporter.update(72, '기반 검증 장면 생성');
    this.world = new PrototypeWorld(this.scene, this.physics);
    this.world.resetProbe();

    this.bindEvents();
    this.hud.reveal();
    this.reporter.complete();
    this.clock.start();
    this.animate();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.controls?.dispose();
    this.renderer?.dispose();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private createRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, GAME_CONFIG.renderer.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;

    this.scene.background = new THREE.Color(0x0a0d10);
    this.scene.fog = new THREE.FogExp2(0x0a0d10, 0.023);
  }

  private createCamera(): void {
    this.camera = new THREE.PerspectiveCamera(
      GAME_CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      GAME_CONFIG.camera.near,
      GAME_CONFIG.camera.far,
    );
    this.camera.position.fromArray(GAME_CONFIG.camera.startPosition);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.fromArray(GAME_CONFIG.camera.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 42;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.enablePan = false;
    this.controls.update();
  }

  private createLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0x7d8ea0, 0x18130e, 1.25);
    this.scene.add(hemisphere);

    const moon = new THREE.DirectionalLight(0xbfc9d4, 3.1);
    moon.position.set(-12, 22, 11);
    moon.castShadow = true;
    moon.shadow.mapSize.set(GAME_CONFIG.renderer.shadowMapSize, GAME_CONFIG.renderer.shadowMapSize);
    moon.shadow.camera.left = -24;
    moon.shadow.camera.right = 24;
    moon.shadow.camera.top = 24;
    moon.shadow.camera.bottom = -24;
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 70;
    moon.shadow.bias = -0.0003;
    this.scene.add(moon);

    const altar = new THREE.PointLight(0xc29a62, 38, 22, 1.7);
    altar.position.set(0, 5.3, -5.6);
    altar.castShadow = true;
    this.scene.add(altar);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
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
    if (event.code === 'KeyR') this.world.resetProbe();
    if (event.code === 'KeyH') this.hud.toggleHelp();
  };

  private readonly animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.physics.step(delta);
    this.world.update();
    this.controls.update();

    const fps = this.frameMonitor.update(delta);
    this.hud.setFps(fps);
    this.renderer.render(this.scene, this.camera);
  };
}
