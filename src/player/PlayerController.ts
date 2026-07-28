import * as THREE from 'three';
import RAPIER, { type Collider, type KinematicCharacterController, type RigidBody } from '@dimforge/rapier3d-compat';
import type { AudioDirector } from '../audio/AudioDirector';
import { GAME_CONFIG } from '../config/GameConfig';
import type { AttackPulse, PlayerAttackId } from '../combat/CombatTypes';
import { InputController } from '../input/InputController';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { AshenKnightVisual, type KnightVisualState } from './AshenKnightVisual';

export type PlayerMotionState = KnightVisualState;
export type DamageResult = 'hit' | 'evaded' | 'guarded' | 'parried';
type PlayerAction = 'none' | 'dodge' | PlayerAttackId | 'heavyCharge' | 'execute' | 'heal' | 'guard' | 'parry' | 'stagger' | 'dead';

export class PlayerController {
  readonly visual: THREE.Group;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly knight = new AshenKnightVisual();
  private readonly horizontalVelocity = new THREE.Vector3();
  private readonly targetVelocity = new THREE.Vector3();
  private readonly velocityDelta = new THREE.Vector3();
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
  private chargeRatio = 0;
  private attackDamageScale = 1;
  private attackPoiseScale = 1;
  private executionTarget: THREE.Vector3 | null = null;
  private executionImpactPending = false;
  private executionImpactEmitted = false;
  private footstepDistance = 0;
  private pendingFootsteps = 0;
  private attackPulseEmitted = false;
  private pendingAttackPulse: AttackPulse | null = null;
  private invulnerable = false;
  private flaskCharges: number = GAME_CONFIG.player.flaskCapacity;
  private healApplied = false;

  constructor(scene: THREE.Scene, physics: PhysicsWorld, private readonly audio: AudioDirector) {
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
      chargeRatio: this.chargeRatio,
    });
  }

  receiveDamage(
    amount: number,
    impactDirection: THREE.Vector3,
    impact: number,
    guardable = true,
    parryable = true,
  ): DamageResult {
    if (this.invulnerable || this.action === 'dead') return 'evaded';

    const incoming = this.scratchDirection.copy(impactDirection).setY(0).normalize().negate();
    const frontFacing = this.forward.dot(incoming) > 0.05;
    const parryActive = this.action === 'parry'
      && this.actionTimer >= GAME_CONFIG.player.parryWindowStart
      && this.actionTimer <= GAME_CONFIG.player.parryWindowEnd;
    if (parryable && parryActive && frontFacing) {
      this.staminaRegenDelay = GAME_CONFIG.player.staminaRegenDelay;
      return 'parried';
    }

    if (guardable && this.action === 'guard' && frontFacing) {
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
    this.chargeRatio = 0;
    this.executionTarget = null;
    this.executionImpactPending = false;
    this.pendingAttackPulse = null;
    this.attackPulseEmitted = false;
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
    this.chargeRatio = 0;
    this.attackDamageScale = 1;
    this.attackPoiseScale = 1;
    this.executionTarget = null;
    this.executionImpactPending = false;
    this.executionImpactEmitted = false;
    this.footstepDistance = 0;
    this.pendingFootsteps = 0;
    this.flaskCharges = GAME_CONFIG.player.flaskCapacity;
    this.healApplied = false;
    this.syncVisual();
  }

  respawnAt(position: THREE.Vector3): void {
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.body.setNextKinematicTranslation({ x: position.x, y: position.y, z: position.z });
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
    this.chargeRatio = 0;
    this.attackDamageScale = 1;
    this.attackPoiseScale = 1;
    this.executionTarget = null;
    this.executionImpactPending = false;
    this.executionImpactEmitted = false;
    this.queuedLightAttack = false;
    this.healApplied = false;
    this.footstepDistance = 0;
    this.pendingFootsteps = 0;
    this.syncVisual();
  }

  restAtCheckpoint(): void {
    this.health = GAME_CONFIG.player.maxHealth;
    this.stamina = GAME_CONFIG.player.maxStamina;
    this.flaskCharges = GAME_CONFIG.player.flaskCapacity;
    this.staminaRegenDelay = 0;
    if (this.action !== 'dead') this.finishAction();
  }

  refillFlasks(): void {
    this.flaskCharges = GAME_CONFIG.player.flaskCapacity;
  }

  getFlaskCharges(): number {
    return this.flaskCharges;
  }

  getHealth(): number {
    return this.health;
  }

  getMaxHealth(): number {
    return GAME_CONFIG.player.maxHealth;
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

  getChargeRatio(): number {
    return this.action === 'heavyCharge' ? this.chargeRatio : 0;
  }

  consumeFootstep(): boolean {
    if (this.pendingFootsteps <= 0) return false;
    this.pendingFootsteps -= 1;
    return true;
  }

  beginExecution(target: THREE.Vector3): boolean {
    if (this.action !== 'none' && this.action !== 'guard') return false;
    this.executionTarget = target.clone();
    const position = this.getWorldPosition(new THREE.Vector3());
    const direction = this.scratchDirection.copy(target).sub(position).setY(0);
    if (direction.lengthSq() > 0.001) {
      direction.normalize();
      this.facingYaw = Math.atan2(-direction.x, -direction.z);
      this.forward.copy(direction);
    }
    this.action = 'execute';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.executionImpactPending = false;
    this.executionImpactEmitted = false;
    this.horizontalVelocity.set(0, 0, 0);
    return true;
  }

  consumeExecutionImpact(): boolean {
    const pending = this.executionImpactPending;
    this.executionImpactPending = false;
    return pending;
  }


  isDead(): boolean {
    return this.action === 'dead';
  }

  private handleActionInput(input: InputController, lockTarget: THREE.Vector3 | null): void {
    const dodgePressed = input.consumeAction('dodge');
    const lightPressed = input.consumeAction('lightAttack');
    const heavyPressed = input.consumeAction('heavyAttack');
    const parryPressed = input.consumeAction('parry');
    const healPressed = input.consumeAction('heal');

    if (this.action === 'dead' || this.action === 'stagger' || this.action === 'execute') return;

    if (this.action === 'heal') {
      if (dodgePressed && this.canDodge()) this.startDodge(lockTarget);
      return;
    }

    if (this.action === 'heavyCharge') {
      this.chargeRatio = THREE.MathUtils.clamp(
        this.actionTimer / GAME_CONFIG.player.heavyChargeMax,
        0,
        1,
      );
      if (dodgePressed && this.canDodge()) {
        this.chargeRatio = 0;
        this.startDodge(lockTarget);
        return;
      }
      const fullyCharged = this.actionTimer >= GAME_CONFIG.player.heavyChargeMax;
      const released = !input.isHeavyHeld() && this.actionTimer >= GAME_CONFIG.player.heavyChargeMin;
      if (fullyCharged || released) this.releaseHeavyAttack(lockTarget);
      return;
    }

    if (parryPressed && this.grounded && this.stamina >= GAME_CONFIG.player.parryCost
      && (this.action === 'none' || this.action === 'guard')) {
      this.startParry();
      return;
    }

    if (dodgePressed && this.canDodge()) {
      this.startDodge(lockTarget);
      return;
    }

    if (healPressed && this.canHeal()) {
      this.startHeal();
      return;
    }

    if (this.action === 'guard') {
      if (lightPressed) this.startAttack('light1', lockTarget);
      else if (heavyPressed) this.startHeavyCharge(lockTarget);
      else if (!input.isGuarding()) this.finishAction();
      return;
    }

    if ((this.action === 'light1' || this.action === 'light2') && lightPressed) {
      const profile = GAME_CONFIG.combat.attacks[this.action];
      const bufferOpen = Math.max(0.12, profile.comboOpen - 0.22);
      if (this.actionTimer >= bufferOpen) this.queuedLightAttack = true;
      return;
    }

    if (this.action !== 'none') return;
    if (lightPressed) this.startAttack('light1', lockTarget);
    else if (heavyPressed) this.startHeavyCharge(lockTarget);
    else if (input.isGuarding() && this.grounded) this.startGuard();
  }

  private canHeal(): boolean {
    return this.grounded
      && this.flaskCharges > 0
      && this.health > 0
      && this.health < GAME_CONFIG.player.maxHealth
      && (this.action === 'none' || this.action === 'guard');
  }

  private startHeal(): void {
    this.action = 'heal';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.healApplied = false;
    this.horizontalVelocity.multiplyScalar(0.12);
    this.queuedLightAttack = false;
  }

  private canDodge(): boolean {
    if (!this.grounded || this.stamina < GAME_CONFIG.player.dodgeCost) return false;
    if (this.action === 'none' || this.action === 'guard') return true;
    if (this.action === 'light1' || this.action === 'light2' || this.action === 'light3' || this.action === 'heavy') {
      const profile = GAME_CONFIG.combat.attacks[this.action];
      return this.actionTimer > profile.activeEnd + 0.09;
    }
    if (this.action === 'heavyCharge') return this.actionTimer >= 0.08;
    return false;
  }

  private startHeavyCharge(lockTarget: THREE.Vector3 | null): void {
    if (!this.grounded || this.stamina < GAME_CONFIG.player.heavyChargeStaminaBase) return;
    this.action = 'heavyCharge';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.chargeRatio = 0;
    this.queuedLightAttack = false;
    this.attackPulseEmitted = false;
    this.alignAttackFacing(lockTarget);
    this.horizontalVelocity.multiplyScalar(0.1);
  }

  private releaseHeavyAttack(lockTarget: THREE.Vector3 | null): void {
    const charge = THREE.MathUtils.clamp(this.chargeRatio, 0, 1);
    const cost = GAME_CONFIG.player.heavyChargeStaminaBase
      + GAME_CONFIG.player.heavyChargeStaminaBonus * charge;
    if (this.stamina < cost) {
      this.chargeRatio = 0;
      this.finishAction();
      return;
    }
    this.spendStamina(cost);
    this.attackDamageScale = THREE.MathUtils.lerp(1, 1.7, charge);
    this.attackPoiseScale = THREE.MathUtils.lerp(1, 1.95, charge);
    this.action = 'heavy';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.attackPulseEmitted = false;
    this.alignAttackFacing(lockTarget);
    this.horizontalVelocity.multiplyScalar(0.08);
    this.audio.swing('heavy');
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
    this.audio.swing('light');
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
    this.audio.dodge();
  }

  private startAttack(attack: PlayerAttackId, lockTarget: THREE.Vector3 | null): void {
    const profile = GAME_CONFIG.combat.attacks[attack];
    if (this.stamina < profile.staminaCost) return;
    this.spendStamina(profile.staminaCost);
    this.attackDamageScale = 1;
    this.attackPoiseScale = 1;
    this.chargeRatio = 0;
    this.action = attack;
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.attackPulseEmitted = false;
    if (attack !== 'light1') this.queuedLightAttack = false;
    this.alignAttackFacing(lockTarget);
    this.horizontalVelocity.multiplyScalar(0.12);
    this.audio.swing(attack === 'light3' ? 'medium' : 'light');
  }

  private alignAttackFacing(lockTarget: THREE.Vector3 | null): void {
    if (lockTarget) {
      const position = this.getWorldPosition(new THREE.Vector3());
      const direction = this.scratchDirection.copy(lockTarget).sub(position).setY(0);
      if (direction.lengthSq() > 0.001) this.facingYaw = Math.atan2(-direction.x, -direction.z);
    } else if (this.desiredDirection.lengthSq() > 0.001) {
      this.facingYaw = Math.atan2(-this.desiredDirection.x, -this.desiredDirection.z);
    }
    this.forward.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));
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

    if (this.action === 'light1' || this.action === 'light2' || this.action === 'light3' || this.action === 'heavy') {
      const profile = GAME_CONFIG.combat.attacks[this.action];
      const progress = THREE.MathUtils.clamp(this.actionTimer / profile.duration, 0, 1);
      const rootWindow = Math.sin(Math.min(1, progress / 0.72) * Math.PI);
      return this.horizontalVelocity.copy(this.forward).multiplyScalar(
        (profile.rootDistance / profile.duration) * Math.max(0, rootWindow) * 1.55,
      );
    }

    if (this.action === 'heavyCharge') {
      const target = this.scratchDirection.copy(this.desiredDirection).multiplyScalar(
        inputMagnitude > 0.04 ? 0.55 * inputMagnitude : 0,
      );
      this.horizontalVelocity.lerp(target, 1 - Math.exp(-20 * delta));
      return this.horizontalVelocity;
    }

    if (this.action === 'heal') {
      const target = this.scratchDirection.copy(this.desiredDirection).multiplyScalar(
        inputMagnitude > 0.04 ? 0.72 * inputMagnitude : 0,
      );
      this.horizontalVelocity.lerp(target, 1 - Math.exp(-18 * delta));
      return this.horizontalVelocity;
    }

    if (this.action === 'execute') {
      if (this.executionTarget) {
        const position = this.getWorldPosition(new THREE.Vector3());
        const distance = this.scratchDirection.copy(this.executionTarget).sub(position).setY(0).length();
        const forwardSpeed = distance > 1.35 && this.actionTimer < 0.45 ? Math.min(2.8, distance * 2.1) : 0;
        return this.horizontalVelocity.copy(this.forward).multiplyScalar(forwardSpeed);
      }
      this.horizontalVelocity.set(0, 0, 0);
      return this.horizontalVelocity;
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
    this.targetVelocity.copy(this.desiredDirection).multiplyScalar(targetSpeed);

    const currentPlanarLength = this.horizontalVelocity.length();
    const currentDirection = currentPlanarLength > 0.05
      ? this.scratchDirection.copy(this.horizontalVelocity).multiplyScalar(1 / currentPlanarLength)
      : this.desiredDirection;
    const steeringDot = hasInput ? currentDirection.dot(this.desiredDirection) : 1;
    const reversal = hasInput && steeringDot < -0.2;
    const acceleration = !this.grounded
      ? GAME_CONFIG.player.airAcceleration
      : reversal
        ? GAME_CONFIG.player.reversalAcceleration
        : hasInput
          ? canSprint ? GAME_CONFIG.player.sprintAcceleration : GAME_CONFIG.player.groundAcceleration
          : GAME_CONFIG.player.groundDeceleration;

    // Limit the whole planar velocity change instead of clamping X/Z independently.
    // This keeps diagonal acceleration and sharp reversals from feeling like a digital snap.
    this.velocityDelta.copy(this.targetVelocity).sub(this.horizontalVelocity).setY(0);
    const maxVelocityChange = acceleration * delta;
    if (this.velocityDelta.lengthSq() > maxVelocityChange * maxVelocityChange) {
      this.velocityDelta.setLength(maxVelocityChange);
    }
    this.horizontalVelocity.add(this.velocityDelta).setY(0);
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
    if (this.grounded && this.action === 'none' && this.actualSpeed > 0.65) {
      this.footstepDistance += Math.hypot(corrected.x, corrected.z);
      const strideDistance = this.actualSpeed > GAME_CONFIG.player.walkSpeed * 1.15 ? 1.55 : 1.18;
      while (this.footstepDistance >= strideDistance) {
        this.footstepDistance -= strideDistance;
        this.pendingFootsteps += 1;
      }
    } else if (!this.grounded || this.actualSpeed < 0.2) {
      this.footstepDistance = Math.min(this.footstepDistance, 0.4);
    }
  }

  private updateFacing(delta: number, hasInput: boolean, lockTarget: THREE.Vector3 | null): void {
    const previousYaw = this.facingYaw;
    const currentAction = this.action;
    const attackAction = isPlayerAttack(currentAction);
    const attackProfile = attackAction ? GAME_CONFIG.combat.attacks[currentAction] : null;
    const trackingOpen = attackProfile !== null && this.actionTimer < attackProfile.activeStart * 0.82;
    const canTrack = this.action === 'none' || this.action === 'guard' || this.action === 'parry'
      || this.action === 'heavyCharge' || this.action === 'heal' || this.action === 'execute' || trackingOpen;
    if (canTrack) {
      let targetYaw: number | null = null;
      let turnSpeed: number = GAME_CONFIG.player.turnSpeedWalk;
      const trackingTarget = this.action === 'execute' ? this.executionTarget : lockTarget;
      if (trackingTarget) {
        const position = this.getWorldPosition(new THREE.Vector3());
        const direction = this.scratchDirection.copy(trackingTarget).sub(position).setY(0);
        if (direction.lengthSq() > 0.001) targetYaw = Math.atan2(-direction.x, -direction.z);
        turnSpeed = attackAction
          ? THREE.MathUtils.degToRad(GAME_CONFIG.combat.attackTrackingDegrees) / 0.24
          : GAME_CONFIG.player.lockTurnSpeed;
      } else if (hasInput && (this.action === 'none' || this.action === 'guard' || this.action === 'heavyCharge' || this.action === 'heal')) {
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
    if (this.action === 'heavyCharge') {
      this.chargeRatio = THREE.MathUtils.clamp(this.actionTimer / GAME_CONFIG.player.heavyChargeMax, 0, 1);
      this.actionProgress = this.chargeRatio;
      return;
    }
    if (this.action === 'heal') {
      this.actionProgress = THREE.MathUtils.clamp(this.actionTimer / GAME_CONFIG.player.healDuration, 0, 1);
      if (!this.healApplied
        && previousTimer < GAME_CONFIG.player.healImpactTime
        && this.actionTimer >= GAME_CONFIG.player.healImpactTime) {
        this.healApplied = true;
        this.flaskCharges = Math.max(0, this.flaskCharges - 1);
        this.health = Math.min(GAME_CONFIG.player.maxHealth, this.health + GAME_CONFIG.player.healAmount);
        this.audio.heal();
      }
      if (this.actionTimer >= GAME_CONFIG.player.healDuration) this.finishAction();
      return;
    }
    if (this.action === 'execute') {
      this.actionProgress = THREE.MathUtils.clamp(
        this.actionTimer / GAME_CONFIG.player.executionDuration,
        0,
        1,
      );
      if (!this.executionImpactEmitted
        && previousTimer < GAME_CONFIG.player.executionImpactTime
        && this.actionTimer >= GAME_CONFIG.player.executionImpactTime) {
        this.executionImpactPending = true;
        this.executionImpactEmitted = true;
      }
      if (this.actionTimer >= GAME_CONFIG.player.executionDuration) this.finishAction();
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
      const weight = attack === 'heavy' ? 'heavy' : attack === 'light3' ? 'medium' : 'light';
      this.pendingAttackPulse = {
        source: 'player',
        position,
        forward: this.forward.clone(),
        range: profile.range,
        arcCos: profile.arcCos,
        damage: profile.damage * this.attackDamageScale,
        poiseDamage: profile.poiseDamage * this.attackPoiseScale,
        impact: attack === 'heavy' ? 2.8 + this.chargeRatio * 0.7 : attack === 'light3' ? 2.15 : 1.45,
        weight,
      };
      this.attackPulseEmitted = true;
    }
    if (this.actionTimer >= profile.duration) {
      if (attack === 'light1' && this.queuedLightAttack) {
        this.queuedLightAttack = false;
        this.startAttack('light2', lockTarget);
      } else if (attack === 'light2' && this.queuedLightAttack) {
        this.queuedLightAttack = false;
        this.startAttack('light3', lockTarget);
      } else {
        this.finishAction();
      }
    }
  }

  private updateInvulnerability(): void {
    this.invulnerable = this.action === 'execute'
      || (this.action === 'dodge'
        && this.actionTimer >= GAME_CONFIG.player.dodgeInvulnerableStart
        && this.actionTimer <= GAME_CONFIG.player.dodgeInvulnerableEnd);
  }

  private finishAction(): void {
    this.action = 'none';
    this.actionTimer = 0;
    this.actionProgress = 0;
    this.attackPulseEmitted = false;
    this.invulnerable = false;
    this.chargeRatio = 0;
    this.attackDamageScale = 1;
    this.attackPoiseScale = 1;
    this.executionTarget = null;
    this.healApplied = false;
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
      && this.action !== 'parry' && this.action !== 'heavyCharge'
      && this.action !== 'execute' && this.action !== 'heal' && this.action !== 'dead') {
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
    if (position.y < -20 && this.action !== 'dead') {
      this.health = 0;
      this.action = 'dead';
      this.actionTimer = 0;
      this.actionProgress = 0;
      this.horizontalVelocity.set(0, 0, 0);
      this.knockbackVelocity.set(0, 0, 0);
      this.pendingAttackPulse = null;
    }
  }
}

function shortestAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function moveAngleTowards(current: number, target: number, maxDelta: number): number {
  const delta = shortestAngle(target - current);
  return current + THREE.MathUtils.clamp(delta, -maxDelta, maxDelta);
}

function isPlayerAttack(action: PlayerAction): action is PlayerAttackId {
  return action === 'light1' || action === 'light2' || action === 'light3' || action === 'heavy';
}
