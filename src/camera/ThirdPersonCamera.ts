import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';

export class ThirdPersonCamera {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly blockers: THREE.Object3D[];
  private readonly raycaster = new THREE.Raycaster();
  private readonly smoothedTarget = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly planarForward = new THREE.Vector3(0, 0, -1);
  private readonly planarRight = new THREE.Vector3(1, 0, 0);
  private yaw: number = GAME_CONFIG.camera.yaw;
  private pitch: number = GAME_CONFIG.camera.pitch;
  private distance: number = GAME_CONFIG.camera.distance;
  private dragging = false;
  private pointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private initialized = false;

  constructor(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, blockers: THREE.Object3D[]) {
    this.camera = camera;
    this.canvas = canvas;
    this.blockers = blockers;
    this.bindEvents();
  }

  update(delta: number, target: THREE.Vector3): void {
    const targetAlpha = 1 - Math.exp(-GAME_CONFIG.camera.targetSharpness * delta);
    if (!this.initialized) {
      this.smoothedTarget.copy(target);
      this.initialized = true;
    } else {
      this.smoothedTarget.lerp(target, targetAlpha);
    }

    const horizontal = Math.cos(this.pitch) * this.distance;
    this.cameraDirection.set(
      Math.sin(this.yaw) * horizontal,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * horizontal,
    );
    this.desiredPosition.copy(this.smoothedTarget).add(this.cameraDirection);

    const collisionVector = this.desiredPosition.clone().sub(this.smoothedTarget);
    const desiredDistance = collisionVector.length();
    if (desiredDistance > 0.001) {
      collisionVector.normalize();
      this.raycaster.set(this.smoothedTarget, collisionVector);
      this.raycaster.near = 0.28;
      this.raycaster.far = desiredDistance;
      const hit = this.raycaster.intersectObjects(this.blockers, true)[0];
      if (hit) {
        const safeDistance = Math.max(GAME_CONFIG.camera.collisionMinDistance, hit.distance - GAME_CONFIG.camera.collisionPadding);
        this.desiredPosition.copy(this.smoothedTarget).addScaledVector(collisionVector, safeDistance);
      }
    }

    const positionAlpha = 1 - Math.exp(-GAME_CONFIG.camera.positionSharpness * delta);
    if (this.camera.position.lengthSq() === 0) this.camera.position.copy(this.desiredPosition);
    else this.camera.position.lerp(this.desiredPosition, positionAlpha);
    this.camera.lookAt(this.smoothedTarget);

    this.planarForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    this.planarRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }

  copyPlanarForward(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.planarForward);
  }

  copyPlanarRight(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.planarRight);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 2) return;
    this.dragging = true;
    this.pointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.pointerId) return;
    const deltaX = event.clientX - this.lastPointerX;
    const deltaY = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    this.yaw -= deltaX * GAME_CONFIG.camera.orbitSensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + deltaY * GAME_CONFIG.camera.orbitSensitivity,
      0.12,
      0.92,
    );
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.distance = THREE.MathUtils.clamp(
      this.distance + event.deltaY * GAME_CONFIG.camera.zoomSensitivity,
      GAME_CONFIG.camera.minDistance,
      GAME_CONFIG.camera.maxDistance,
    );
  };
}
