import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import type { LookAxes } from '../input/InputController';

const COLLISION_SAMPLE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [-0.24, 0], [0.24, 0], [0, 0.2], [0, -0.16],
];

export class ThirdPersonCamera {
  private readonly raycaster = new THREE.Raycaster();
  private readonly smoothedTarget = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly cameraVector = new THREE.Vector3();
  private readonly velocityLookAhead = new THREE.Vector3();
  private readonly toLock = new THREE.Vector3();
  private readonly weightedLockTarget = new THREE.Vector3();
  private readonly castOrigin = new THREE.Vector3();
  private readonly sampleOrigin = new THREE.Vector3();
  private readonly collisionVector = new THREE.Vector3();
  private readonly collisionRight = new THREE.Vector3();
  private readonly collisionUp = new THREE.Vector3(0, 1, 0);
  private readonly planarForward = new THREE.Vector3(0, 0, -1);
  private readonly planarRight = new THREE.Vector3(1, 0, 0);
  private pointerLocked = false;
  private dragging = false;
  private pointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private yaw: number = GAME_CONFIG.camera.yaw;
  private pitch: number = GAME_CONFIG.camera.pitch;
  private distance: number = GAME_CONFIG.camera.distance;
  private collisionDistance: number = GAME_CONFIG.camera.distance;
  private currentShoulderOffset = GAME_CONFIG.camera.shoulderOffset;
  private initialized = false;
  private lockBlend = 0;
  private cameraImpulse = 0;
  private shakeTime = 0;
  private enabled = false;
  private sensitivityScale = 1;
  private shakeScale = 1;
  private secondsSinceLook = 10;
  private collisionRatio = 1;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly blockers: THREE.Object3D[],
  ) {
    this.bindEvents();
  }

  update(
    delta: number,
    target: THREE.Vector3,
    velocity: THREE.Vector3,
    playerForward: THREE.Vector3,
    sprintBlend: number,
    gamepadLook: LookAxes,
    lockTarget: THREE.Vector3 | null,
  ): void {
    const lookActivity = this.consumeLook(delta, gamepadLook);
    this.secondsSinceLook = lookActivity ? 0 : this.secondsSinceLook + delta;
    this.lockBlend += ((lockTarget ? 1 : 0) - this.lockBlend) * (1 - Math.exp(-10 * delta));

    if (lockTarget) {
      this.toLock.copy(lockTarget).sub(target).setY(0);
      if (this.toLock.lengthSq() > 0.001) {
        const lockYaw = Math.atan2(-this.toLock.x, -this.toLock.z);
        this.yaw = moveAngleTowards(this.yaw, lockYaw, GAME_CONFIG.camera.lockYawSharpness * delta);
      }
    } else if (this.secondsSinceLook > 1.15 && sprintBlend > 0.22 && playerForward.lengthSq() > 0.25) {
      const travelYaw = Math.atan2(-playerForward.x, -playerForward.z);
      const recenterStrength = THREE.MathUtils.smoothstep(sprintBlend, 0.22, 0.92);
      this.yaw = moveAngleTowards(this.yaw, travelYaw, (0.34 + recenterStrength * 0.58) * delta);
      const travelPitch = GAME_CONFIG.camera.pitch + sprintBlend * 0.025;
      this.pitch += (travelPitch - this.pitch) * (1 - Math.exp(-0.9 * recenterStrength * delta));
    }

    this.planarForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    this.planarRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    this.velocityLookAhead.copy(velocity).setY(0).multiplyScalar(GAME_CONFIG.camera.lookAheadSeconds);
    if (this.velocityLookAhead.length() > GAME_CONFIG.camera.maxLookAhead) {
      this.velocityLookAhead.setLength(GAME_CONFIG.camera.maxLookAhead);
    }
    this.desiredTarget.copy(target).add(this.velocityLookAhead);
    let verticalLockSpan = 0;
    if (lockTarget) {
      this.weightedLockTarget.copy(lockTarget);
      verticalLockSpan = Math.abs(lockTarget.y - target.y);
      const verticalWeight = THREE.MathUtils.clamp(0.4 - verticalLockSpan * 0.014, 0.24, 0.4);
      this.weightedLockTarget.y = THREE.MathUtils.lerp(target.y, lockTarget.y, verticalWeight);
      this.desiredTarget.lerp(this.weightedLockTarget, GAME_CONFIG.camera.lockTargetWeight * this.lockBlend);
    }
    const targetAlpha = 1 - Math.exp(-GAME_CONFIG.camera.targetSharpness * delta);
    if (!this.initialized) {
      this.smoothedTarget.copy(this.desiredTarget);
      this.initialized = true;
    } else {
      this.smoothedTarget.lerp(this.desiredTarget, targetAlpha);
    }

    const encounterFraming = THREE.MathUtils.clamp(verticalLockSpan * 0.24, 0, 2.65) * this.lockBlend;
    const framedDistance = this.distance + encounterFraming;
    const horizontal = Math.cos(this.pitch) * framedDistance;
    this.cameraVector.set(
      Math.sin(this.yaw) * horizontal,
      Math.sin(this.pitch) * framedDistance,
      Math.cos(this.yaw) * horizontal,
    );

    const lockShoulderScale = THREE.MathUtils.lerp(1, 0.46, this.lockBlend);
    const desiredShoulder = GAME_CONFIG.camera.shoulderOffset * lockShoulderScale * THREE.MathUtils.lerp(0.3, 1, this.collisionRatio);
    this.currentShoulderOffset += (desiredShoulder - this.currentShoulderOffset) * (1 - Math.exp(-12 * delta));
    this.shoulder.copy(this.planarRight).multiplyScalar(this.currentShoulderOffset);
    this.desiredPosition.copy(this.smoothedTarget).add(this.shoulder).add(this.cameraVector);

    this.castOrigin.copy(this.smoothedTarget).addScaledVector(this.shoulder, 0.28);
    this.collisionVector.copy(this.desiredPosition).sub(this.castOrigin);
    const fullDistance = this.collisionVector.length();
    let safeDistance = fullDistance;
    if (fullDistance > 0.001) {
      this.collisionVector.normalize();
      this.collisionRight.crossVectors(this.collisionVector, this.collisionUp).normalize();
      for (const [sideOffset, heightOffset] of COLLISION_SAMPLE_OFFSETS) {
        this.sampleOrigin.copy(this.castOrigin)
          .addScaledVector(this.collisionRight, sideOffset)
          .addScaledVector(this.collisionUp, heightOffset);
        this.raycaster.set(this.sampleOrigin, this.collisionVector);
        this.raycaster.near = 0.12;
        this.raycaster.far = fullDistance;
        const hit = this.raycaster.intersectObjects(this.blockers, true)[0];
        if (!hit) continue;
        safeDistance = Math.min(
          safeDistance,
          Math.max(GAME_CONFIG.camera.collisionMinDistance, hit.distance - GAME_CONFIG.camera.collisionPadding),
        );
      }
    }

    const collisionSharpness = safeDistance < this.collisionDistance
      ? GAME_CONFIG.camera.collisionInSharpness
      : GAME_CONFIG.camera.collisionOutSharpness;
    this.collisionDistance += (safeDistance - this.collisionDistance) * (1 - Math.exp(-collisionSharpness * delta));
    this.collisionRatio = fullDistance > 0.001
      ? THREE.MathUtils.clamp(this.collisionDistance / fullDistance, 0, 1)
      : 1;
    if (fullDistance > 0.001) {
      this.desiredPosition.copy(this.castOrigin).addScaledVector(this.collisionVector, this.collisionDistance);
    } else {
      this.desiredPosition.copy(this.castOrigin);
    }

    const positionAlpha = 1 - Math.exp(-GAME_CONFIG.camera.positionSharpness * delta);
    if (this.camera.position.lengthSq() === 0) this.camera.position.copy(this.desiredPosition);
    else this.camera.position.lerp(this.desiredPosition, positionAlpha);
    this.shakeTime += delta;
    this.cameraImpulse *= Math.exp(-11 * delta);
    if (this.cameraImpulse > 0.001) {
      const shake = this.cameraImpulse;
      this.camera.position.x += Math.sin(this.shakeTime * 71) * shake * 0.075;
      this.camera.position.y += Math.sin(this.shakeTime * 93 + 1.7) * shake * 0.055;
      this.camera.position.z += Math.sin(this.shakeTime * 59 + 0.8) * shake * 0.05;
    }
    this.camera.lookAt(this.smoothedTarget);

    const locomotionFov = THREE.MathUtils.lerp(GAME_CONFIG.camera.fov, GAME_CONFIG.camera.sprintFov, sprintBlend);
    const targetFov = THREE.MathUtils.lerp(locomotionFov, GAME_CONFIG.camera.lockFov, this.lockBlend);
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-6 * delta));
    this.camera.updateProjectionMatrix();
  }

  copyPlanarForward(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.planarForward);
  }

  copyPlanarRight(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.planarRight);
  }

  addImpulse(strength: number): void {
    this.cameraImpulse = Math.max(this.cameraImpulse, strength * this.shakeScale);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    if (!enabled && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  setControlSettings(sensitivityScale: number, shakeScale: number): void {
    this.sensitivityScale = THREE.MathUtils.clamp(sensitivityScale, 0.5, 1.6);
    this.shakeScale = THREE.MathUtils.clamp(shakeScale, 0, 1);
  }

  snapBehind(playerForward: THREE.Vector3, target: THREE.Vector3): void {
    if (playerForward.lengthSq() > 0.001) this.yaw = Math.atan2(-playerForward.x, -playerForward.z);
    this.pitch = GAME_CONFIG.camera.pitch;
    this.smoothedTarget.copy(target);
    this.desiredTarget.copy(target);
    this.collisionDistance = this.distance;
    this.collisionRatio = 1;
    this.currentShoulderOffset = GAME_CONFIG.camera.shoulderOffset;
    this.initialized = true;
  }

  getCollisionRatio(): number {
    return this.collisionRatio;
  }

  isLocked(): boolean {
    return this.pointerLocked;
  }

  dispose(): void {
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private bindEvents(): void {
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('click', this.onClick);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private consumeLook(delta: number, gamepadLook: LookAxes): boolean {
    if (!this.enabled) {
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
      return false;
    }
    const mouseMagnitude = Math.abs(this.mouseDeltaX) + Math.abs(this.mouseDeltaY);
    const gamepadMagnitude = Math.abs(gamepadLook.horizontal) + Math.abs(gamepadLook.vertical);
    this.yaw -= this.mouseDeltaX * GAME_CONFIG.camera.mouseSensitivity * this.sensitivityScale;
    this.pitch += this.mouseDeltaY * GAME_CONFIG.camera.mouseSensitivity * this.sensitivityScale;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.yaw -= gamepadLook.horizontal * GAME_CONFIG.camera.gamepadLookSpeed * delta * this.sensitivityScale;
    this.pitch += gamepadLook.vertical * GAME_CONFIG.camera.gamepadLookSpeed * delta * this.sensitivityScale;
    this.pitch = THREE.MathUtils.clamp(this.pitch, 0.08, 0.9);
    return mouseMagnitude > 0.1 || gamepadMagnitude > 0.05;
  }

  private readonly onClick = (): void => {
    if (!this.enabled) return;
    if (!this.pointerLocked && document.pointerLockElement === null) {
      const requestPointerLock = this.canvas.requestPointerLock?.bind(this.canvas);
      if (requestPointerLock) void requestPointerLock();
    }
  };

  private readonly onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    this.dragging = false;
    this.pointerId = null;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled || !this.pointerLocked) return;
    this.mouseDeltaX += event.movementX;
    this.mouseDeltaY += event.movementY;
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.pointerLocked || (event.button !== 0 && event.button !== 2)) return;
    this.dragging = true;
    this.pointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || this.pointerLocked || event.pointerId !== this.pointerId) return;
    const deltaX = event.clientX - this.lastPointerX;
    const deltaY = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.mouseDeltaX += deltaX * (GAME_CONFIG.camera.dragSensitivity / GAME_CONFIG.camera.mouseSensitivity);
    this.mouseDeltaY += deltaY * (GAME_CONFIG.camera.dragSensitivity / GAME_CONFIG.camera.mouseSensitivity);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.distance = THREE.MathUtils.clamp(
      this.distance + event.deltaY * GAME_CONFIG.camera.zoomSensitivity,
      GAME_CONFIG.camera.minDistance,
      GAME_CONFIG.camera.maxDistance,
    );
  };
}

function shortestAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function moveAngleTowards(current: number, target: number, maxDelta: number): number {
  const delta = shortestAngle(target - current);
  return current + THREE.MathUtils.clamp(delta, -maxDelta, maxDelta);
}
