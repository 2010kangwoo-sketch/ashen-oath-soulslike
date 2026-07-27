import * as THREE from 'three';
import RAPIER, { type Collider, type KinematicCharacterController, type RigidBody } from '@dimforge/rapier3d-compat';
import { GAME_CONFIG } from '../config/GameConfig';
import { InputController } from '../input/InputController';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { AshenKnightVisual, type LocomotionVisualState } from './AshenKnightVisual';

export type PlayerMotionState = LocomotionVisualState;

export class PlayerController {
  readonly visual: THREE.Group;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly knight = new AshenKnightVisual();
  private readonly horizontalVelocity = new THREE.Vector3();
  private readonly desiredDirection = new THREE.Vector3();
  private readonly actualVelocity = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private verticalVelocity = 0;
  private grounded = false;
  private actualSpeed = 0;
  private state: PlayerMotionState = 'airborne';
  private facingYaw = 0;
  private turnRate = 0;
  private sprintBlend = 0;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.visual = this.knight.root;
    scene.add(this.visual);

    const spawn = GAME_CONFIG.player.spawn;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn[0], spawn[1], spawn[2]),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(
        GAME_CONFIG.player.capsuleHalfHeight,
        GAME_CONFIG.player.capsuleRadius,
      ).setFriction(0),
      this.body,
    );

    this.controller = physics.world.createCharacterController(GAME_CONFIG.player.controllerOffset);
    this.controller.enableAutostep(GAME_CONFIG.player.maxStepHeight, GAME_CONFIG.player.minStepWidth, false);
    this.controller.enableSnapToGround(GAME_CONFIG.player.snapToGroundDistance);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(GAME_CONFIG.player.maxSlopeAngleDegrees));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(GAME_CONFIG.player.slideSlopeAngleDegrees));
    this.controller.setSlideEnabled(true);
    this.syncVisual();
  }

  fixedUpdate(
    delta: number,
    input: InputController,
    planarForward: THREE.Vector3,
    planarRight: THREE.Vector3,
  ): void {
    const axes = input.getMoveAxes();
    const inputMagnitude = Math.min(1, Math.hypot(axes.horizontal, axes.vertical));
    this.cameraForward.copy(planarForward);
    this.cameraRight.copy(planarRight);
    this.desiredDirection
      .copy(this.cameraForward)
      .multiplyScalar(axes.vertical)
      .addScaledVector(this.cameraRight, axes.horizontal);
    if (this.desiredDirection.lengthSq() > 0.0001) this.desiredDirection.normalize();

    const hasInput = inputMagnitude > 0.04;
    const sprintRequested = hasInput && input.isRunning();
    const targetSpeed = hasInput
      ? (sprintRequested ? GAME_CONFIG.player.runSpeed : GAME_CONFIG.player.walkSpeed) * inputMagnitude
      : 0;
    const targetVelocityX = this.desiredDirection.x * targetSpeed;
    const targetVelocityZ = this.desiredDirection.z * targetSpeed;

    const currentPlanarLength = this.horizontalVelocity.length();
    const currentDirection = currentPlanarLength > 0.05
      ? this.horizontalVelocity.clone().multiplyScalar(1 / currentPlanarLength)
      : this.desiredDirection;
    const reversal = hasInput ? currentDirection.dot(this.desiredDirection) < -0.2 : false;
    const acceleration = !this.grounded
      ? GAME_CONFIG.player.airAcceleration
      : reversal
        ? GAME_CONFIG.player.reversalAcceleration
        : hasInput
          ? sprintRequested ? GAME_CONFIG.player.sprintAcceleration : GAME_CONFIG.player.groundAcceleration
          : GAME_CONFIG.player.groundDeceleration;

    this.horizontalVelocity.x = moveTowards(this.horizontalVelocity.x, targetVelocityX, acceleration * delta);
    this.horizontalVelocity.z = moveTowards(this.horizontalVelocity.z, targetVelocityZ, acceleration * delta);

    if (this.grounded) this.verticalVelocity = GAME_CONFIG.player.groundedPull;
    else {
      this.verticalVelocity = Math.max(
        GAME_CONFIG.player.maxFallSpeed,
        this.verticalVelocity + GAME_CONFIG.physics.gravity * delta,
      );
    }

    this.controller.computeColliderMovement(this.collider, {
      x: this.horizontalVelocity.x * delta,
      y: this.verticalVelocity * delta,
      z: this.horizontalVelocity.z * delta,
    });
    const corrected = this.controller.computedMovement();
    const position = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: position.x + corrected.x,
      y: position.y + corrected.y,
      z: position.z + corrected.z,
    });

    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = GAME_CONFIG.player.groundedPull;
    this.actualVelocity.set(corrected.x / delta, corrected.y / delta, corrected.z / delta);
    this.actualSpeed = Math.hypot(this.actualVelocity.x, this.actualVelocity.z);
    this.state = !this.grounded
      ? 'airborne'
      : this.actualSpeed < 0.12
        ? 'idle'
        : sprintRequested && this.actualSpeed > GAME_CONFIG.player.walkSpeed * 1.08
          ? 'run'
          : 'walk';

    const previousYaw = this.facingYaw;
    if (hasInput) {
      const targetYaw = Math.atan2(-this.desiredDirection.x, -this.desiredDirection.z);
      const maxTurnSpeed = this.state === 'run' ? GAME_CONFIG.player.turnSpeedRun : GAME_CONFIG.player.turnSpeedWalk;
      this.facingYaw = moveAngleTowards(this.facingYaw, targetYaw, maxTurnSpeed * delta);
    }
    this.turnRate = shortestAngle(this.facingYaw - previousYaw) / Math.max(delta, 0.0001);
    const sprintTarget = this.state === 'run' ? 1 : 0;
    this.sprintBlend += (sprintTarget - this.sprintBlend) * (1 - Math.exp(-8 * delta));
  }

  updateVisual(delta: number): void {
    this.syncVisual();
    this.knight.update({
      delta,
      state: this.state,
      speedRatio: THREE.MathUtils.clamp(this.actualSpeed / GAME_CONFIG.player.runSpeed, 0, 1),
      turnRate: THREE.MathUtils.clamp(this.turnRate, -8, 8),
      verticalSpeed: this.actualVelocity.y,
    });
  }

  reset(): void {
    const [x, y, z] = GAME_CONFIG.player.spawn;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.horizontalVelocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.actualSpeed = 0;
    this.grounded = false;
    this.state = 'airborne';
    this.sprintBlend = 0;
    this.syncVisual();
  }

  getCameraTarget(target: THREE.Vector3): THREE.Vector3 {
    const position = this.body.translation();
    return target.set(position.x, position.y + GAME_CONFIG.camera.targetHeight, position.z);
  }

  copyVelocity(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.actualVelocity);
  }

  getMotionState(): PlayerMotionState {
    return this.state;
  }

  getSpeed(): number {
    return this.actualSpeed;
  }

  getSprintBlend(): number {
    return this.sprintBlend;
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  private syncVisual(): void {
    const position = this.body.translation();
    this.visual.position.set(position.x, position.y, position.z);
    this.visual.rotation.y = this.facingYaw;
    if (position.y < -20) this.reset();
  }
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function shortestAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function moveAngleTowards(current: number, target: number, maxDelta: number): number {
  const delta = shortestAngle(target - current);
  return current + THREE.MathUtils.clamp(delta, -maxDelta, maxDelta);
}
