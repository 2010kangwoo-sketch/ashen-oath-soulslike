import * as THREE from 'three';
import RAPIER, { type Collider, type KinematicCharacterController, type RigidBody } from '@dimforge/rapier3d-compat';
import { GAME_CONFIG } from '../config/GameConfig';
import { InputController } from '../input/InputController';
import { PhysicsWorld } from '../physics/PhysicsWorld';

export type PlayerMotionState = '대기' | '걷기' | '달리기' | '공중';

export class PlayerController {
  readonly visual = new THREE.Group();
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly model = new THREE.Group();
  private readonly leftLeg: THREE.Group;
  private readonly rightLeg: THREE.Group;
  private readonly cloak: THREE.Mesh;
  private readonly horizontalVelocity = new THREE.Vector3();
  private readonly desiredDirection = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private verticalVelocity = 0;
  private grounded = false;
  private actualSpeed = 0;
  private state: PlayerMotionState = '공중';
  private facingYaw = 0;
  private stridePhase = 0;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.visual.name = 'player-visual';
    scene.add(this.visual);

    const spawn = GAME_CONFIG.player.spawn;
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn[0], spawn[1], spawn[2]);
    this.body = physics.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.capsule(
      GAME_CONFIG.player.capsuleHalfHeight,
      GAME_CONFIG.player.capsuleRadius,
    ).setFriction(0);
    this.collider = physics.world.createCollider(colliderDesc, this.body);

    this.controller = physics.world.createCharacterController(GAME_CONFIG.player.controllerOffset);
    this.controller.enableAutostep(
      GAME_CONFIG.player.maxStepHeight,
      GAME_CONFIG.player.minStepWidth,
      false,
    );
    this.controller.enableSnapToGround(GAME_CONFIG.player.snapToGroundDistance);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(GAME_CONFIG.player.maxSlopeAngleDegrees));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(GAME_CONFIG.player.slideSlopeAngleDegrees));
    this.controller.setSlideEnabled(true);

    const limbs = this.createVisualModel();
    this.leftLeg = limbs.leftLeg;
    this.rightLeg = limbs.rightLeg;
    this.cloak = limbs.cloak;
    this.syncVisual(0);
  }

  fixedUpdate(
    delta: number,
    input: InputController,
    planarForward: THREE.Vector3,
    planarRight: THREE.Vector3,
  ): void {
    const axes = input.getMoveAxes();
    this.cameraForward.copy(planarForward);
    this.cameraRight.copy(planarRight);
    this.desiredDirection
      .copy(this.cameraForward)
      .multiplyScalar(axes.vertical)
      .addScaledVector(this.cameraRight, axes.horizontal);

    const hasInput = this.desiredDirection.lengthSq() > 0.001;
    if (hasInput) this.desiredDirection.normalize();

    const running = hasInput && input.isRunning();
    const targetSpeed = hasInput
      ? running ? GAME_CONFIG.player.runSpeed : GAME_CONFIG.player.walkSpeed
      : 0;
    const targetX = this.desiredDirection.x * targetSpeed;
    const targetZ = this.desiredDirection.z * targetSpeed;
    const acceleration = this.grounded
      ? hasInput ? GAME_CONFIG.player.groundAcceleration : GAME_CONFIG.player.groundDeceleration
      : GAME_CONFIG.player.airAcceleration;
    const maxVelocityChange = acceleration * delta;
    this.horizontalVelocity.x = moveTowards(this.horizontalVelocity.x, targetX, maxVelocityChange);
    this.horizontalVelocity.z = moveTowards(this.horizontalVelocity.z, targetZ, maxVelocityChange);

    if (this.grounded) this.verticalVelocity = GAME_CONFIG.player.groundedPull;
    else {
      this.verticalVelocity = Math.max(
        GAME_CONFIG.player.maxFallSpeed,
        this.verticalVelocity + GAME_CONFIG.physics.gravity * delta,
      );
    }

    const desiredMovement = {
      x: this.horizontalVelocity.x * delta,
      y: this.verticalVelocity * delta,
      z: this.horizontalVelocity.z * delta,
    };
    this.controller.computeColliderMovement(this.collider, desiredMovement);
    const corrected = this.controller.computedMovement();
    const position = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: position.x + corrected.x,
      y: position.y + corrected.y,
      z: position.z + corrected.z,
    });

    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = GAME_CONFIG.player.groundedPull;
    this.actualSpeed = Math.hypot(corrected.x, corrected.z) / Math.max(delta, 0.0001);
    this.state = !this.grounded ? '공중' : this.actualSpeed < 0.15 ? '대기' : running ? '달리기' : '걷기';

    if (hasInput) {
      const targetYaw = Math.atan2(-this.desiredDirection.x, -this.desiredDirection.z);
      const angleDelta = Math.atan2(Math.sin(targetYaw - this.facingYaw), Math.cos(targetYaw - this.facingYaw));
      const turnAlpha = 1 - Math.exp(-GAME_CONFIG.player.turnSharpness * delta);
      this.facingYaw += angleDelta * turnAlpha;
    }
  }

  updateVisual(delta: number): void {
    this.syncVisual(delta);
  }

  reset(): void {
    const [x, y, z] = GAME_CONFIG.player.spawn;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.horizontalVelocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.actualSpeed = 0;
    this.grounded = false;
    this.state = '공중';
    this.syncVisual(0);
  }

  getCameraTarget(target: THREE.Vector3): THREE.Vector3 {
    const position = this.body.translation();
    return target.set(position.x, position.y + GAME_CONFIG.camera.targetHeight, position.z);
  }

  getMotionState(): PlayerMotionState {
    return this.state;
  }

  getSpeed(): number {
    return this.actualSpeed;
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  private syncVisual(delta: number): void {
    const position = this.body.translation();
    this.visual.position.set(position.x, position.y, position.z);
    this.visual.rotation.y = this.facingYaw;

    const normalizedPace = THREE.MathUtils.clamp(this.actualSpeed / GAME_CONFIG.player.runSpeed, 0, 1);
    if (this.grounded && normalizedPace > 0.02) this.stridePhase += delta * (6.5 + normalizedPace * 5.5);
    const stride = Math.sin(this.stridePhase) * normalizedPace;
    this.leftLeg.rotation.x = stride * 0.52;
    this.rightLeg.rotation.x = -stride * 0.52;
    this.model.position.y = this.grounded ? Math.abs(Math.sin(this.stridePhase * 2)) * 0.025 * normalizedPace : 0;
    this.cloak.rotation.x = 0.08 + normalizedPace * 0.15 + Math.sin(this.stridePhase) * 0.025;

    if (position.y < -18) this.reset();
  }

  private createVisualModel(): { leftLeg: THREE.Group; rightLeg: THREE.Group; cloak: THREE.Mesh } {
    this.visual.add(this.model);
    const armor = new THREE.MeshStandardMaterial({ color: 0x353a3c, roughness: 0.62, metalness: 0.58 });
    const darkArmor = new THREE.MeshStandardMaterial({ color: 0x171b1d, roughness: 0.72, metalness: 0.35 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x251d1b, roughness: 0.96, side: THREE.DoubleSide });
    const ember = new THREE.MeshStandardMaterial({ color: 0xb7a47d, emissive: 0x392814, roughness: 0.48, metalness: 0.28 });

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 0.86, 8), armor);
    torso.position.y = 0.18;
    torso.castShadow = true;
    this.model.add(torso);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.48, 0.38), darkArmor);
    chest.position.set(0, 0.27, -0.12);
    chest.castShadow = true;
    this.model.add(chest);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), darkArmor);
    head.scale.y = 1.08;
    head.position.y = 0.84;
    head.castShadow = true;
    this.model.add(head);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.12, 0.08), ember);
    visor.position.set(0, 0.85, -0.255);
    visor.castShadow = true;
    this.model.add(visor);

    const shoulderGeometry = new THREE.SphereGeometry(0.21, 8, 6);
    for (const x of [-0.48, 0.48]) {
      const shoulder = new THREE.Mesh(shoulderGeometry, armor);
      shoulder.scale.set(1.25, 0.72, 1);
      shoulder.position.set(x, 0.45, 0);
      shoulder.castShadow = true;
      this.model.add(shoulder);
    }

    const leftLeg = this.createLeg(-0.2, armor, darkArmor);
    const rightLeg = this.createLeg(0.2, armor, darkArmor);
    this.model.add(leftLeg, rightLeg);

    const cloak = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.25, 1, 3), cloth);
    cloak.position.set(0, 0.18, 0.34);
    cloak.rotation.x = 0.08;
    cloak.castShadow = true;
    this.model.add(cloak);

    const sword = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 0.035), armor);
    blade.position.y = -0.4;
    blade.castShadow = true;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.09), ember);
    guard.position.y = 0.2;
    sword.add(blade, guard);
    sword.position.set(0.62, 0.42, 0.12);
    sword.rotation.z = -0.18;
    this.model.add(sword);

    return { leftLeg, rightLeg, cloak };
  }

  private createLeg(x: number, armor: THREE.Material, boot: THREE.Material): THREE.Group {
    const leg = new THREE.Group();
    leg.position.set(x, -0.38, 0);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.56, 7), armor);
    upper.position.y = -0.12;
    upper.castShadow = true;
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.48, 0.31), boot);
    lower.position.set(0, -0.52, -0.04);
    lower.castShadow = true;
    leg.add(upper, lower);
    return leg;
  }
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}
