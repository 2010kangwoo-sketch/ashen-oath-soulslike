import * as THREE from 'three';
import RAPIER, { type Collider, type KinematicCharacterController, type RigidBody } from '@dimforge/rapier3d-compat';
import { GAME_CONFIG } from '../config/GameConfig';
import type { AttackPulse, PlayerAttackId } from '../combat/CombatTypes';
import { InputController } from '../input/InputController';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { AshenKnightVisual, type KnightVisualState } from './AshenKnightVisual';

export type PlayerMotionState = KnightVisualState;
export type DamageResult = 'hit' | 'evaded' | 'guarded' | 'parried';
type PlayerAction = 'none' | 'dodge' | PlayerAttackId | 'guard' | 'parry' | 'stagger' | 'dead';

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
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly dodgeDirection = new THREE.Vector3(0, 0, -1);
  private readonly knockbackVelocity = new THREE.Vector3();
  private readonly scratchDirection = new THREE.Vector3();
  private verticalVelocity = 0;
  private grounded = false;
  private actualSpeed = 0;
  private state: PlayerMotionState = 'airborne';
  private action: PlayerAction = 'none';
  private actionTimer = 0;
  private actionProgress = 0;
  private facingYaw = 0;
  private turnRate = 0;
  private sprintBlend = 0;
  private health: number = GAME_CONFIG.player.maxHealth;
  private stamina: number = GAME_CONFIG.player.maxStamina;
  private staminaRegenDelay = 0;
  private queuedLightAttack = false;
  private attackPulseEmitted = false;
  private pendingAttackPulse: AttackPulse | null = null;
  private invulnerable = false;

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
    lockTarget: THREE.Vector3 | null,
  ): void {
    this.updateResourceTimers(delta);
    this.cameraForward.copy(planarForward);
    this.cameraRight.copy(planarRight);
    const axes = input.getMoveAxes();
    const inputMagnitude = Math.min(1, Math.hypot(axes.horizontal, axes.vertical));
    this.desiredDirection
      .copy(this.cameraForward)
      .multiplyScalar(axes.vertical)
      .addScaledVector(this.cameraRight, axes.horizontal);
    if (this.desiredDirection.lengthSq() > 0.0001) this.desiredDirection.normalize();

    const previousActionTimer = this.actionTimer;
    if (this.action !== 'none') this.actionTimer += delta;
    this.handleActionInput(input, lockTarget);
    this.updateInvulnerability();

    const movement = this.computePlanarMovement(delta, inputMagnitude, input.isRunning(), lockTarget);
    this.applyCharacterMovement(delta, movement);
    this.updateFacing(delta, inputMagnitude > 0.04, lockTarget);
    this.updateActionTimeline(previousActionTimer, lockTarget);
    this.updateMotionState(input.isRunning());
  }

  updateVisual(delta: number): void {
    this.syncVisual();
    this.knight.update({
      delta,
      state: this.state,
      speedRatio: THREE.MathUtils.clamp(this.actualSpeed / GAME_CONFIG.player.runSpeed, 0, 1),
      turnRate: THREE.MathUtils.clamp(this.turnRate, -8, 8),
      verticalSpeed: this.actualVelocity.y,
      actionProgress: this.actionProgress,
    });
  }

  receiveDamage(amount: number, impactDirection: THREE.Vector3, impact: number): DamageResult {
    if (this.invulnerable || this.action === 'dead') return 'evaded';

    const incoming = this.scratchDirection.copy(impactDirection).setY(0).normalize().negate();
    const frontFacing = this.forward.dot(incoming) > 0.05;
    const parryActive = this.action === 'parry'
      && this.actionTimer >= GAME_CONFIG.player.parryWindowStart
      && this.actionTimer <= GAME_CONFIG.player.parryWindowEnd;
    if (parryActive && frontFacing) {
      this.staminaRegenDelay = GAME_CONFIG.player.staminaRegenDelay;
      return 'parried';
    }

    if (this.action === 'guard' && frontFacing) {
      const staminaDamage = amount * GAME_CONFIG.player.guardStaminaMultiplier;
      if (this.stamina >= staminaDamage) {
        this.stamina -= staminaDamage;
        this.health = Math.max(0, this.health - amount * GAME_CONFIG.player.guardDamageLeak);
        this.staminaRegenDelay = 1.05;
        this.knockbackVelocity.copy(impactDirection).setY(0).multiplyScalar(impact * 0.24);
        if (this.health <= 0) {
          this.action = 'dead';
          this.actionTimer = 0;
          this.actionProgress = 0;
          return 'hit';
        }
        return 'guarded';
      }
      this.stamina = 0;
      amount *= 0.48;
      impact *= 1.25;
    }

    this.health = Math.max(0, this.health - amount);
    this.staminaRegenDelay = Math.max(this.staminaRegenDelay, 0.9);
    this.knockbackVelocity.copy(impactDirection).setY(0);
    if (this.knockbackVelocity.lengthSq() > 0.001) this.knockbackVelocity.normalize().multiplyScalar(impact);
    this.action = this.health <= 0 ? 'dead' : 'stagger';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.horizontalVelocity.multiplyScalar(0.18);
    this.queuedLightAttack = false;
    return 'hit';
  }

  consumeAttackPulse(): AttackPulse | null {
    const pulse = this.pendingAttackPulse;
    this.pendingAttackPulse = null;
    return pulse;
  }

  reset(): void {
    const [x, y, z] = GAME_CONFIG.player.spawn;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.horizontalVelocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.knockbackVelocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.actualSpeed = 0;
    this.grounded = false;
    this.action = 'none';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.health = GAME_CONFIG.player.maxHealth;
    this.stamina = GAME_CONFIG.player.maxStamina;
    this.staminaRegenDelay = 0;
    this.state = 'airborne';
    this.sprintBlend = 0;
    this.invulnerable = false;
    this.pendingAttackPulse = null;
    this.syncVisual();
  }

  getCameraTarget(target: THREE.Vector3): THREE.Vector3 {
    const position = this.body.translation();
    return target.set(position.x, position.y + GAME_CONFIG.camera.targetHeight, position.z);
  }

  getWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    const position = this.body.translation();
    return target.set(position.x, position.y, position.z);
  }

  getLockPoint(target: THREE.Vector3): THREE.Vector3 {
    const position = this.body.translation();
    return target.set(position.x, position.y + 0.72, position.z);
  }

  copyVelocity(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.actualVelocity);
  }

  copyForward(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.forward);
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

  getHealthRatio(): number {
    return this.health / GAME_CONFIG.player.maxHealth;
  }

  getStaminaRatio(): number {
    return this.stamina / GAME_CONFIG.player.maxStamina;
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  isDead(): boolean {
    return this.action === 'dead';
  }

  private handleActionInput(input: InputController, lockTarget: THREE.Vector3 | null): void {
    const dodgePressed = input.consumeAction('dodge');
    const lightPressed = input.consumeAction('lightAttack');
    const heavyPressed = input.consumeAction('heavyAttack');
    const parryPressed = input.consumeAction('parry');

    if (this.action === 'dead' || this.action === 'stagger') return;

    if (parryPressed && this.grounded && this.stamina >= GAME_CONFIG.player.parryCost
      && (this.action === 'none' || this.action === 'guard')) {
      this.startParry();
      return;
    }

    if (dodgePressed && this.canDodge()) {
      this.startDodge(lockTarget);
      return;
    }

    if (this.action === 'guard') {
      if (lightPressed) this.startAttack('light1', lockTarget);
      else if (heavyPressed) this.startAttack('heavy', lockTarget);
      else if (!input.isGuarding()) this.finishAction();
      return;
    }

    if (this.action === 'light1' && lightPressed) {
      const comboOpen = GAME_CONFIG.combat.attacks.light1.comboOpen;
      if (this.actionTimer >= comboOpen) this.queuedLightAttack = true;
      return;
    }

    if (this.action !== 'none') return;
    if (lightPressed) this.startAttack('light1', lockTarget);
    else if (heavyPressed) this.startAttack('heavy', lockTarget);
    else if (input.isGuarding() && this.grounded) this.startGuard();
  }

  private canDodge(): boolean {
    if (!this.grounded || this.stamina < GAME_CONFIG.player.dodgeCost) return false;
    if (this.action === 'none' || this.action === 'guard') return true;
    if (this.action === 'light1' || this.action === 'light2' || this.action === 'heavy') {
      const profile = GAME_CONFIG.combat.attacks[this.action];
      return this.actionTimer > profile.activeEnd + 0.09;
    }
    return false;
  }

  private startGuard(): void {
    this.action = 'guard';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.horizontalVelocity.multiplyScalar(0.45);
  }

  private startParry(): void {
    this.spendStamina(GAME_CONFIG.player.parryCost);
    this.action = 'parry';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.horizontalVelocity.multiplyScalar(0.1);
    this.queuedLightAttack = false;
  }

  private startDodge(lockTarget: THREE.Vector3 | null): void {
    this.spendStamina(GAME_CONFIG.player.dodgeCost);
    this.action = 'dodge';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.queuedLightAttack = false;
    this.attackPulseEmitted = false;
    this.dodgeDirection.copy(this.desiredDirection);
    if (this.dodgeDirection.lengthSq() < 0.001) {
      if (lockTarget) {
        this.scratchDirection.copy(lockTarget).sub(this.getWorldPosition(new THREE.Vector3())).setY(0);
        this.dodgeDirection.copy(this.scratchDirection.lengthSq() > 0.001 ? this.scratchDirection.normalize().negate() : this.forward);
      } else {
        this.dodgeDirection.copy(this.forward);
      }
    }
    this.dodgeDirection.normalize();
    const targetYaw = Math.atan2(-this.dodgeDirection.x, -this.dodgeDirection.z);
    this.facingYaw = targetYaw;
    this.horizontalVelocity.set(0, 0, 0);
  }

  private startAttack(attack: PlayerAttackId, lockTarget: THREE.Vector3 | null): void {
    const profile = GAME_CONFIG.combat.attacks[attack];
    if (this.stamina < profile.staminaCost) return;
    this.spendStamina(profile.staminaCost);
    this.action = attack;
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.attackPulseEmitted = false;
    if (attack !== 'light1') this.queuedLightAttack = false;
    if (lockTarget) {
      const position = this.getWorldPosition(new THREE.Vector3());
      const direction = this.scratchDirection.copy(lockTarget).sub(position).setY(0);
      if (direction.lengthSq() > 0.001) this.facingYaw = Math.atan2(-direction.x, -direction.z);
    } else if (this.desiredDirection.lengthSq() > 0.001) {
      this.facingYaw = Math.atan2(-this.desiredDirection.x, -this.desiredDirection.z);
    }
    this.forward.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));
    this.horizontalVelocity.multiplyScalar(0.12);
  }

  private computePlanarMovement(
    delta: number,
    inputMagnitude: number,
    runRequested: boolean,
    lockTarget: THREE.Vector3 | null,
  ): THREE.Vector3 {
    if (this.action === 'dodge') {
      const progress = THREE.MathUtils.clamp(this.actionTimer / GAME_CONFIG.player.dodgeDuration, 0, 1);
      const shapedSpeed = (GAME_CONFIG.player.dodgeDistance / GAME_CONFIG.player.dodgeDuration)
        * (0.48 + Math.sin(progress * Math.PI) * 0.88);
      return this.horizontalVelocity.copy(this.dodgeDirection).multiplyScalar(shapedSpeed);
    }

    if (this.action === 'light1' || this.action === 'light2' || this.action === 'heavy') {
      const profile = GAME_CONFIG.combat.attacks[this.action];
      const progress = THREE.MathUtils.clamp(this.actionTimer / profile.duration, 0, 1);
      const rootWindow = Math.sin(Math.min(1, progress / 0.72) * Math.PI);
      return this.horizontalVelocity.copy(this.forward).multiplyScalar(
        (profile.rootDistance / profile.duration) * Math.max(0, rootWindow) * 1.55,
      );
    }

    if (this.action === 'guard') {
      const target = this.scratchDirection.copy(this.desiredDirection).multiplyScalar(
        inputMagnitude > 0.04 ? GAME_CONFIG.player.guardMoveSpeed * inputMagnitude : 0,
      );
      this.horizontalVelocity.lerp(target, 1 - Math.exp(-18 * delta));
      return this.horizontalVelocity;
    }

    if (this.action === 'parry') {
      this.horizontalVelocity.multiplyScalar(Math.exp(-18 * delta));
      return this.horizontalVelocity;
    }

    if (this.action === 'stagger') {
      this.knockbackVelocity.multiplyScalar(Math.exp(-9 * delta));
      return this.horizontalVelocity.copy(this.knockbackVelocity);
    }

    if (this.action === 'dead') {
      this.horizontalVelocity.multiplyScalar(Math.exp(-12 * delta));
      return this.horizontalVelocity;
    }

    const hasInput = inputMagnitude > 0.04;
    const canSprint = hasInput && runRequested && this.stamina > 0.5;
    if (canSprint && this.grounded) {
      this.stamina = Math.max(0, this.stamina - GAME_CONFIG.player.sprintStaminaPerSecond * delta);
      this.staminaRegenDelay = GAME_CONFIG.player.staminaRegenDelay;
    }
    const targetSpeed = hasInput
      ? (canSprint ? GAME_CONFIG.player.runSpeed : GAME_CONFIG.player.walkSpeed) * inputMagnitude
      : 0;
    const targetVelocityX = this.desiredDirection.x * targetSpeed;
    const targetVelocityZ = this.desiredDirection.z * targetSpeed;

    const currentPlanarLength = this.horizontalVelocity.length();
    const currentDirection = currentPlanarLength > 0.05
      ? this.scratchDirection.copy(this.horizontalVelocity).multiplyScalar(1 / currentPlanarLength)
      : this.desiredDirection;
    const reversal = hasInput ? currentDirection.dot(this.desiredDirection) < -0.2 : false;
    const acceleration = !this.grounded
      ? GAME_CONFIG.player.airAcceleration
      : reversal
        ? GAME_CONFIG.player.reversalAcceleration
        : hasInput
          ? canSprint ? GAME_CONFIG.player.sprintAcceleration : GAME_CONFIG.player.groundAcceleration
          : GAME_CONFIG.player.groundDeceleration;

    this.horizontalVelocity.x = moveTowards(this.horizontalVelocity.x, targetVelocityX, acceleration * delta);
    this.horizontalVelocity.z = moveTowards(this.horizontalVelocity.z, targetVelocityZ, acceleration * delta);
    if (lockTarget && !hasInput) this.horizontalVelocity.multiplyScalar(Math.exp(-18 * delta));
    return this.horizontalVelocity;
  }

  private applyCharacterMovement(delta: number, planarMovement: THREE.Vector3): void {
    if (this.grounded) this.verticalVelocity = GAME_CONFIG.player.groundedPull;
    else {
      this.verticalVelocity = Math.max(
        GAME_CONFIG.player.maxFallSpeed,
        this.verticalVelocity + GAME_CONFIG.physics.gravity * delta,
      );
    }

    this.controller.computeColliderMovement(this.collider, {
      x: planarMovement.x * delta,
      y: this.verticalVelocity * delta,
      z: planarMovement.z * delta,
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
  }

  private updateFacing(delta: number, hasInput: boolean, lockTarget: THREE.Vector3 | null): void {
    const previousYaw = this.facingYaw;
    if (this.action === 'none' || this.action === 'guard' || this.action === 'parry') {
      let targetYaw: number | null = null;
      let turnSpeed: number = GAME_CONFIG.player.turnSpeedWalk;
      if (lockTarget) {
        const position = this.getWorldPosition(new THREE.Vector3());
        const direction = this.scratchDirection.copy(lockTarget).sub(position).setY(0);
        if (direction.lengthSq() > 0.001) targetYaw = Math.atan2(-direction.x, -direction.z);
        turnSpeed = GAME_CONFIG.player.lockTurnSpeed;
      } else if (hasInput) {
        targetYaw = Math.atan2(-this.desiredDirection.x, -this.desiredDirection.z);
        turnSpeed = this.actualSpeed > GAME_CONFIG.player.walkSpeed * 1.1
          ? GAME_CONFIG.player.turnSpeedRun
          : GAME_CONFIG.player.turnSpeedWalk;
      }
      if (targetYaw !== null) this.facingYaw = moveAngleTowards(this.facingYaw, targetYaw, turnSpeed * delta);
    }
    this.forward.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw)).normalize();
    this.turnRate = shortestAngle(this.facingYaw - previousYaw) / Math.max(delta, 0.0001);
  }

  private updateActionTimeline(previousTimer: number, lockTarget: THREE.Vector3 | null): void {
    if (this.action === 'none') {
      this.actionProgress = 0;
      return;
    }
    if (this.action === 'dodge') {
      this.actionProgress = THREE.MathUtils.clamp(this.actionTimer / GAME_CONFIG.player.dodgeDuration, 0, 1);
      if (this.actionTimer >= GAME_CONFIG.player.dodgeDuration) this.finishAction();
      return;
    }
    if (this.action === 'guard') {
      this.actionProgress = 0;
      return;
    }
    if (this.action === 'parry') {
      this.actionProgress = THREE.MathUtils.clamp(this.actionTimer / GAME_CONFIG.player.parryDuration, 0, 1);
      if (this.actionTimer >= GAME_CONFIG.player.parryDuration) this.finishAction();
      return;
    }
    if (this.action === 'stagger') {
      this.actionProgress = THREE.MathUtils.clamp(this.actionTimer / GAME_CONFIG.player.staggerDuration, 0, 1);
      if (this.actionTimer >= GAME_CONFIG.player.staggerDuration) this.finishAction();
      return;
    }
    if (this.action === 'dead') {
      this.actionProgress = THREE.MathUtils.clamp(this.actionTimer / 1.4, 0, 1);
      return;
    }

    const attack = this.action;
    const profile = GAME_CONFIG.combat.attacks[attack];
    this.actionProgress = THREE.MathUtils.clamp(this.actionTimer / profile.duration, 0, 1);
    if (!this.attackPulseEmitted && previousTimer < profile.activeStart && this.actionTimer >= profile.activeStart) {
      const position = this.getLockPoint(new THREE.Vector3()).addScaledVector(this.forward, 0.45);
      this.pendingAttackPulse = {
        source: 'player',
        position,
        forward: this.forward.clone(),
        range: profile.range,
        arcCos: profile.arcCos,
        damage: profile.damage,
        poiseDamage: profile.poiseDamage,
        impact: attack === 'heavy' ? 2.6 : 1.45,
      };
      this.attackPulseEmitted = true;
    }
    if (this.actionTimer >= profile.duration) {
      if (attack === 'light1' && this.queuedLightAttack) {
        this.queuedLightAttack = false;
        this.startAttack('light2', lockTarget);
      } else {
        this.finishAction();
      }
    }
  }

  private updateInvulnerability(): void {
    this.invulnerable = this.action === 'dodge'
      && this.actionTimer >= GAME_CONFIG.player.dodgeInvulnerableStart
      && this.actionTimer <= GAME_CONFIG.player.dodgeInvulnerableEnd;
  }

  private finishAction(): void {
    this.action = 'none';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.attackPulseEmitted = false;
    this.invulnerable = false;
  }

  private updateMotionState(runRequested: boolean): void {
    if (this.action !== 'none') {
      this.state = this.action;
    } else {
      this.state = !this.grounded
        ? 'airborne'
        : this.actualSpeed < 0.12
          ? 'idle'
          : runRequested && this.actualSpeed > GAME_CONFIG.player.walkSpeed * 1.08
            ? 'run'
            : 'walk';
    }
    const sprintTarget = this.state === 'run' ? 1 : 0;
    this.sprintBlend += (sprintTarget - this.sprintBlend) * (1 - Math.exp(-8 * GAME_CONFIG.physics.fixedStep));
  }

  private updateResourceTimers(delta: number): void {
    this.staminaRegenDelay = Math.max(0, this.staminaRegenDelay - delta);
    if (this.staminaRegenDelay <= 0 && this.action !== 'dodge' && this.action !== 'guard'
      && this.action !== 'parry' && this.action !== 'dead') {
      this.stamina = Math.min(
        GAME_CONFIG.player.maxStamina,
        this.stamina + GAME_CONFIG.player.staminaRegenPerSecond * delta,
      );
    }
  }

  private spendStamina(amount: number): void {
    this.stamina = Math.max(0, this.stamina - amount);
    this.staminaRegenDelay = GAME_CONFIG.player.staminaRegenDelay;
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
