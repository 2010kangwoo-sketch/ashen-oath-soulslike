import * as THREE from 'three';
import RAPIER, { type Collider, type KinematicCharacterController, type RigidBody } from '@dimforge/rapier3d-compat';
import type { AudioDirector, SwingWeight } from '../audio/AudioDirector';
import type { AttackPulse, EnemyDamageResult, LockTargetSnapshot } from '../combat/CombatTypes';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { CombatEnemy } from './CombatEnemy';

type SpearState = 'dormant' | 'position' | 'windup' | 'active' | 'recovery' | 'stagger' | 'broken' | 'executed' | 'dead';
type SpearAttack = 'thrust' | 'lowSweep' | 'retreatJab';

interface SpearProfile {
  windup: number;
  active: number;
  recovery: number;
  range: number;
  arcCos: number;
  damage: number;
  poiseDamage: number;
  impact: number;
  travel: number;
  weight: SwingWeight;
}

const ATTACKS: Record<SpearAttack, SpearProfile> = {
  thrust: { windup: 0.72, active: 0.12, recovery: 0.66, range: 4.1, arcCos: 0.72, damage: 31, poiseDamage: 32, impact: 2.4, travel: 1.35, weight: 'medium' },
  lowSweep: { windup: 0.9, active: 0.2, recovery: 0.78, range: 3.5, arcCos: -0.3, damage: 27, poiseDamage: 42, impact: 2.1, travel: 0.25, weight: 'heavy' },
  retreatJab: { windup: 0.46, active: 0.1, recovery: 0.58, range: 3.55, arcCos: 0.62, damage: 22, poiseDamage: 25, impact: 1.8, travel: 0.35, weight: 'light' },
};

export class AshenSpearman implements CombatEnemy {
  readonly root = new THREE.Group();
  readonly ashReward = 82;
  private readonly rig = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly spearPivot = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly armorMaterial: THREE.MeshStandardMaterial;
  private readonly spawn: THREE.Vector3;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly toPlayer = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly step = new THREE.Vector3();
  private readonly impactVelocity = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly lockPoint = new THREE.Vector3();
  private state: SpearState = 'dormant';
  private attack: SpearAttack = 'thrust';
  private stateTimer = 0;
  private attackCycle = 0;
  private attackPulseEmitted = false;
  private pendingAttackPulse: AttackPulse | null = null;
  private health = 154;
  private readonly maxHealth = 154;
  private poise = 0;
  private readonly maxPoise = 72;
  private facingYaw = 0;
  private verticalVelocity = 0;
  private grounded = false;
  private visualTime = 0;
  private gait = 0;
  private hitFlash = 0;
  private attackAllowed = true;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    readonly id: string,
    readonly displayName: string,
    spawn: THREE.Vector3,
    private readonly audio: AudioDirector,
    private readonly side = 1,
  ) {
    this.spawn = spawn.clone();
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.69, 0.46).setFriction(0), this.body);
    this.controller = physics.world.createCharacterController(0.055);
    this.controller.enableAutostep(0.34, 0.22, false);
    this.controller.enableSnapToGround(0.28);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(45));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(51));
    this.controller.setSlideEnabled(true);

    this.root.name = `enemy-${id}`;
    this.root.position.copy(spawn);
    this.root.add(this.rig);
    scene.add(this.root);

    this.armorMaterial = new THREE.MeshStandardMaterial({ color: 0x34393b, roughness: 0.5, metalness: 0.76, emissive: 0x000000 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x121619, roughness: 0.64, metalness: 0.66 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x7e7b70, roughness: 0.28, metalness: 0.9 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2b1718, roughness: 0.96, side: THREE.DoubleSide });
    this.eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xcfaa72, emissive: 0x843811, emissiveIntensity: 1.55, roughness: 0.3 });

    this.torso.position.y = 0.18;
    this.rig.add(this.torso);
    const chest = this.mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.82, 10), this.armorMaterial);
    chest.scale.z = 0.7;
    chest.position.y = 0.3;
    this.torso.add(chest);
    const helm = this.mesh(new THREE.ConeGeometry(0.34, 0.76, 8), dark);
    helm.position.y = 1.08;
    this.torso.add(helm);
    const visor = this.mesh(new THREE.BoxGeometry(0.42, 0.055, 0.055), this.eyeMaterial);
    visor.position.set(0, 0.98, -0.28);
    this.torso.add(visor);
    const mantle = this.mesh(new THREE.PlaneGeometry(0.82, 1.35, 1, 4), cloth);
    mantle.position.set(0, 0.08, 0.34);
    mantle.rotation.x = 0.12;
    this.torso.add(mantle);

    this.leftLeg.position.set(-0.18, -0.22, 0);
    this.rightLeg.position.set(0.18, -0.22, 0);
    this.rig.add(this.leftLeg, this.rightLeg);
    this.buildLeg(this.leftLeg, dark, this.armorMaterial);
    this.buildLeg(this.rightLeg, dark, this.armorMaterial);

    this.spearPivot.position.set(0.48, 0.72, -0.04);
    this.torso.add(this.spearPivot);
    const shaft = this.mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.55, 8), dark);
    shaft.position.y = -1.35;
    this.spearPivot.add(shaft);
    const head = this.mesh(new THREE.ConeGeometry(0.13, 0.55, 6), edge);
    head.position.y = -3.38;
    this.spearPivot.add(head);
    const tassel = this.mesh(new THREE.ConeGeometry(0.16, 0.42, 7), cloth);
    tassel.position.y = -3.04;
    tassel.rotation.x = Math.PI;
    this.spearPivot.add(tassel);
    this.rig.scale.setScalar(1.02);
  }

  fixedUpdate(delta: number, playerPosition: THREE.Vector3): void {
    this.syncFromBody();
    this.step.set(0, 0, 0);
    this.toPlayer.copy(playerPosition).sub(this.root.position).setY(0);
    const distance = this.toPlayer.length();
    if (distance > 0.001) this.toPlayer.multiplyScalar(1 / distance);
    const desiredYaw = Math.atan2(-this.toPlayer.x, -this.toPlayer.z);
    const turnSpeed = this.state === 'windup' ? 2.2 : this.state === 'active' ? 0.7 : 6.1;
    if (!['broken', 'executed', 'dead'].includes(this.state)) this.facingYaw = moveAngleTowards(this.facingYaw, desiredYaw, turnSpeed * delta);
    this.forward.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));

    if (this.state === 'dead' || this.state === 'executed') {
      this.stateTimer += delta;
    } else if (this.state === 'broken') {
      this.stateTimer += delta;
      if (this.stateTimer >= 4.2) {
        this.state = 'position';
        this.stateTimer = -0.25;
        this.poise = this.maxPoise * 0.3;
      }
    } else if (this.state === 'dormant') {
      if (distance < 14.5) this.enterPosition();
    } else if (this.state === 'stagger') {
      this.stateTimer += delta;
      if (this.stateTimer >= 0.44) this.enterPosition(-0.22);
    } else if (this.state === 'position') {
      this.stateTimer += delta;
      this.poise = Math.max(0, this.poise - delta * 6.5);
      this.tangent.set(this.toPlayer.z * this.side, 0, -this.toPlayer.x * this.side);
      if (distance < 2.25) {
        this.step.copy(this.toPlayer).multiplyScalar(-2.65 * delta).addScaledVector(this.tangent, 0.65 * delta);
        if (this.attackAllowed && this.stateTimer > 0.3) this.beginAttack('retreatJab');
      } else if (distance > 4.8) {
        this.step.copy(this.toPlayer).multiplyScalar((distance > 8 ? 2.65 : 1.9) * delta);
      } else {
        const idealCorrection = THREE.MathUtils.clamp((distance - 3.55) * 0.65, -0.55, 0.55);
        this.step.copy(this.tangent).multiplyScalar(1.25 * delta).addScaledVector(this.toPlayer, idealCorrection * delta);
        if (this.attackAllowed && this.stateTimer >= 0.66) this.beginAttack(this.attackCycle % 3 === 2 ? 'lowSweep' : 'thrust');
      }
    } else {
      const profile = ATTACKS[this.attack];
      this.stateTimer += delta;
      if (this.state === 'windup') {
        if (this.attack === 'retreatJab') this.step.copy(this.forward).multiplyScalar(-1.4 * delta);
        if (this.stateTimer >= profile.windup) {
          this.state = 'active';
          this.stateTimer = 0;
          this.emitPulse(profile);
          this.audio.swing(profile.weight);
        }
      } else if (this.state === 'active') {
        const travelScale = this.attack === 'thrust' ? 4.8 : this.attack === 'retreatJab' ? 2.2 : 1.2;
        this.step.copy(this.forward).multiplyScalar(profile.travel * travelScale * delta);
        if (this.stateTimer >= profile.active) {
          this.state = 'recovery';
          this.stateTimer = 0;
        }
      } else if (this.state === 'recovery' && this.stateTimer >= profile.recovery) {
        this.enterPosition(-0.24);
        this.attackPulseEmitted = false;
      }
    }

    this.step.addScaledVector(this.impactVelocity, delta);
    this.impactVelocity.multiplyScalar(Math.exp(-9 * delta));
    this.applyMovement(delta);
  }

  updateVisual(delta: number): void {
    this.syncFromBody();
    this.visualTime += delta;
    this.hitFlash = Math.max(0, this.hitFlash - delta * 5);
    const broken = this.state === 'broken' ? 0.3 + Math.sin(this.visualTime * 12) * 0.12 : 0;
    this.armorMaterial.emissive.setRGB(this.hitFlash * 0.65 + broken, this.hitFlash * 0.12, this.hitFlash * 0.04);
    this.eyeMaterial.emissiveIntensity = 1.45 + (this.state === 'windup' ? 1.5 : 0) + Math.sin(this.visualTime * 3.4) * 0.18;

    let spearX = -0.32;
    let spearZ = -0.22;
    let torsoX = 0;
    let torsoY = 0;
    let legSwing = 0;
    if (this.state === 'position') {
      this.gait += delta * 5.6;
      legSwing = Math.sin(this.gait) * 0.28;
      torsoX = 0.05;
    } else if (this.state === 'windup' || this.state === 'active' || this.state === 'recovery') {
      const profile = ATTACKS[this.attack];
      const total = profile.windup + profile.active + profile.recovery;
      const elapsed = this.state === 'windup' ? this.stateTimer : this.state === 'active' ? profile.windup + this.stateTimer : profile.windup + profile.active + this.stateTimer;
      const p = THREE.MathUtils.clamp(elapsed / total, 0, 1);
      if (this.attack === 'lowSweep') {
        const swing = THREE.MathUtils.smoothstep(p, 0.36, 0.64);
        spearX = -1.25;
        spearZ = THREE.MathUtils.lerp(-1.45, 1.25, swing);
        torsoY = THREE.MathUtils.lerp(-0.58, 0.74, swing);
      } else {
        const thrust = THREE.MathUtils.smoothstep(p, 0.4, 0.63);
        spearX = THREE.MathUtils.lerp(-1.45, 0.2, thrust);
        spearZ = -0.1;
        torsoX = THREE.MathUtils.lerp(-0.22, 0.34, thrust);
      }
    } else if (this.state === 'stagger') {
      torsoX = -0.42;
      spearX = 0.5;
    } else if (this.state === 'broken') {
      torsoX = 0.72;
      spearX = 0.94;
    } else if (this.state === 'executed') {
      torsoX = 0.88;
      spearX = 0.7;
    } else if (this.state === 'dead') {
      torsoX = 1.3;
      spearX = 0.8;
      this.rig.position.y = Math.max(-1.05, this.rig.position.y - delta * 0.5);
    }
    const settle = 1 - Math.exp(-15 * delta);
    this.spearPivot.rotation.x = THREE.MathUtils.lerp(this.spearPivot.rotation.x, spearX, settle);
    this.spearPivot.rotation.z = THREE.MathUtils.lerp(this.spearPivot.rotation.z, spearZ, settle);
    this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, torsoX, settle);
    this.torso.rotation.y = THREE.MathUtils.lerp(this.torso.rotation.y, torsoY, settle);
    this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, legSwing, settle);
    this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, -legSwing, settle);
    this.root.rotation.y = this.facingYaw;
  }

  consumeAttackPulse(): AttackPulse | null { const pulse = this.pendingAttackPulse; this.pendingAttackPulse = null; return pulse; }
  getPosition(target: THREE.Vector3): THREE.Vector3 { return target.copy(this.root.position); }
  isActive(): boolean { return this.state !== 'dead'; }
  isCommittedAttack(): boolean { return this.state === 'windup' || this.state === 'active' || this.state === 'recovery'; }
  setAttackAllowed(allowed: boolean): void { this.attackAllowed = allowed; }

  getLockSnapshot(): LockTargetSnapshot {
    this.lockPoint.copy(this.root.position).add(new THREE.Vector3(0, 1.18, 0));
    return { name: this.displayName, position: this.lockPoint.clone(), healthRatio: this.health / this.maxHealth, poiseRatio: THREE.MathUtils.clamp(this.poise / this.maxPoise, 0, 1), executable: this.state === 'broken', active: this.state !== 'dead' };
  }

  receiveParry(): EnemyDamageResult {
    if (!this.isActive() || this.state === 'executed') return 'ignored';
    this.poise += this.maxPoise * 0.9;
    this.pendingAttackPulse = null;
    return this.checkBreak(true);
  }

  receiveDamage(damage: number, poiseDamage: number, impactDirection: THREE.Vector3): EnemyDamageResult {
    if (!this.isActive() || this.state === 'executed') return 'ignored';
    this.health = Math.max(0, this.health - damage);
    this.poise += poiseDamage;
    this.hitFlash = 1;
    const push = this.scratch.copy(impactDirection).setY(0);
    if (push.lengthSq() > 0.001) this.impactVelocity.add(push.normalize().multiplyScalar(THREE.MathUtils.clamp(1 + damage * 0.018, 1.1, 2.5)));
    if (this.health <= 0) {
      this.state = 'dead';
      this.stateTimer = 0;
      this.pendingAttackPulse = null;
      return 'killed';
    }
    return this.checkBreak(damage >= 52);
  }

  isExecutable(playerPosition: THREE.Vector3): boolean { return this.state === 'broken' && this.root.position.distanceToSquared(playerPosition) <= 2.45 * 2.45; }
  beginExecution(): void { if (this.state === 'broken') { this.state = 'executed'; this.stateTimer = 0; this.pendingAttackPulse = null; } }
  finishExecution(): void { if (this.state === 'executed') { this.health = 0; this.state = 'dead'; this.stateTimer = 0; } }

  reset(): void {
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.body.setNextKinematicTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
    this.root.position.copy(this.spawn);
    this.rig.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.state = 'dormant';
    this.attack = 'thrust';
    this.stateTimer = 0;
    this.attackCycle = 0;
    this.health = this.maxHealth;
    this.poise = 0;
    this.hitFlash = 0;
    this.pendingAttackPulse = null;
    this.attackPulseEmitted = false;
    this.impactVelocity.set(0, 0, 0);
    this.facingYaw = 0;
    this.verticalVelocity = 0;
    this.grounded = false;
    this.attackAllowed = true;
  }

  private enterPosition(timer = 0): void { this.state = 'position'; this.stateTimer = timer; }
  private beginAttack(attack: SpearAttack): void { this.attack = attack; this.attackCycle += 1; this.state = 'windup'; this.stateTimer = 0; this.attackPulseEmitted = false; this.audio.enemyTell(ATTACKS[attack].weight); }

  private emitPulse(profile: SpearProfile): void {
    if (this.attackPulseEmitted) return;
    this.pendingAttackPulse = { source: 'enemy', position: this.root.position.clone().add(new THREE.Vector3(0, 0.88, 0)).addScaledVector(this.forward, 0.78), forward: this.forward.clone(), range: profile.range, arcCos: profile.arcCos, damage: profile.damage, poiseDamage: profile.poiseDamage, impact: profile.impact, weight: profile.weight };
    this.attackPulseEmitted = true;
  }

  private checkBreak(force: boolean): EnemyDamageResult {
    if (this.poise >= this.maxPoise || force) { this.state = 'broken'; this.stateTimer = 0; this.poise = this.maxPoise; this.pendingAttackPulse = null; return 'broken'; }
    this.state = 'stagger'; this.stateTimer = 0; this.pendingAttackPulse = null; return 'hit';
  }

  private applyMovement(delta: number): void {
    if (this.grounded) this.verticalVelocity = -2.6;
    else this.verticalVelocity = Math.max(-24, this.verticalVelocity - 26 * delta);
    this.controller.computeColliderMovement(this.collider, { x: this.step.x, y: this.verticalVelocity * delta, z: this.step.z });
    const corrected = this.controller.computedMovement();
    const position = this.body.translation();
    this.body.setNextKinematicTranslation({ x: position.x + corrected.x, y: position.y + corrected.y, z: position.z + corrected.z });
    this.grounded = this.controller.computedGrounded();
  }

  private syncFromBody(): void { const p = this.body.translation(); this.root.position.set(p.x, p.y, p.z); }
  private buildLeg(parent: THREE.Group, dark: THREE.Material, armor: THREE.Material): void { const thigh = this.mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.55, 8), armor); thigh.position.y = -0.27; parent.add(thigh); const boot = this.mesh(new THREE.BoxGeometry(0.27, 0.62, 0.39), dark); boot.position.set(0, -0.74, -0.04); parent.add(boot); }
  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh { const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }
}

function shortestAngle(angle: number): number { return Math.atan2(Math.sin(angle), Math.cos(angle)); }
function moveAngleTowards(current: number, target: number, maxDelta: number): number { return current + THREE.MathUtils.clamp(shortestAngle(target - current), -maxDelta, maxDelta); }
