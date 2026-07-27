import * as THREE from 'three';
import RAPIER, {
  type Collider,
  type KinematicCharacterController,
  type RigidBody,
} from '@dimforge/rapier3d-compat';
import type { AudioDirector, SwingWeight } from '../audio/AudioDirector';
import type { AttackPulse, EnemyDamageResult, LockTargetSnapshot } from '../combat/CombatTypes';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { CombatEnemy } from './CombatEnemy';

type SentinelState =
  | 'dormant'
  | 'approach'
  | 'windup'
  | 'active'
  | 'recovery'
  | 'stagger'
  | 'broken'
  | 'executed'
  | 'dead';
type SentinelAttackId = 'overhead' | 'sweep' | 'lunge' | 'shieldBash';

interface SentinelAttackProfile {
  readonly windup: number;
  readonly active: number;
  readonly recovery: number;
  readonly range: number;
  readonly arcCos: number;
  readonly damage: number;
  readonly poiseDamage: number;
  readonly impact: number;
  readonly travel: number;
  readonly weight: SwingWeight;
}

const ATTACKS: Record<SentinelAttackId, SentinelAttackProfile> = {
  overhead: {
    windup: 0.84,
    active: 0.13,
    recovery: 0.74,
    range: 2.75,
    arcCos: 0.42,
    damage: 34,
    poiseDamage: 36,
    impact: 2.8,
    travel: 0.38,
    weight: 'heavy',
  },
  sweep: {
    windup: 0.58,
    active: 0.18,
    recovery: 0.68,
    range: 2.9,
    arcCos: -0.18,
    damage: 25,
    poiseDamage: 25,
    impact: 1.8,
    travel: 0.3,
    weight: 'medium',
  },
  lunge: {
    windup: 0.96,
    active: 0.14,
    recovery: 0.86,
    range: 3.55,
    arcCos: 0.62,
    damage: 41,
    poiseDamage: 48,
    impact: 3.4,
    travel: 1.45,
    weight: 'heavy',
  },
  shieldBash: {
    windup: 0.42,
    active: 0.12,
    recovery: 0.62,
    range: 2.2,
    arcCos: 0.46,
    damage: 18,
    poiseDamage: 52,
    impact: 2.4,
    travel: 0.7,
    weight: 'medium',
  },
};

export class AshenSentinel implements CombatEnemy {
  readonly root = new THREE.Group();
  private readonly rig = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly weaponPivot = new THREE.Group();
  private readonly shieldPivot = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly armorMaterial: THREE.MeshStandardMaterial;
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly toPlayer = new THREE.Vector3();
  private readonly lockPoint = new THREE.Vector3();
  private readonly horizontalStep = new THREE.Vector3();
  private readonly impactVelocity = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly spawn: THREE.Vector3;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly maxHealth: number;
  private readonly maxPoise: number;
  private state: SentinelState = 'dormant';
  private attack: SentinelAttackId = 'overhead';
  private attackCycle = 0;
  private stateTimer = 0;
  private attackPulseEmitted = false;
  private pendingAttackPulse: AttackPulse | null = null;
  private health: number;
  private poise = 0;
  private hitFlash = 0;
  private facingYaw = 0;
  private visualTime = 0;
  private verticalVelocity = 0;
  private grounded = false;
  private gait = 0;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    readonly id: string,
    readonly displayName: string,
    spawn: THREE.Vector3,
    private readonly audio: AudioDirector,
    private readonly variant = 0,
  ) {
    this.spawn = spawn.clone();
    this.maxHealth = variant === 0 ? 142 : 126;
    this.maxPoise = variant === 0 ? 82 : 68;
    this.health = this.maxHealth;

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.spawn.x, this.spawn.y, this.spawn.z),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.7, 0.5).setFriction(0),
      this.body,
    );
    this.controller = physics.world.createCharacterController(0.055);
    this.controller.enableAutostep(0.34, 0.22, false);
    this.controller.enableSnapToGround(0.28);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(45));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(51));
    this.controller.setSlideEnabled(true);

    this.root.name = `enemy-${id}`;
    this.root.position.copy(this.spawn);
    this.root.add(this.rig);
    scene.add(this.root);

    this.armorMaterial = new THREE.MeshStandardMaterial({
      color: variant === 0 ? 0x2b3032 : 0x34302d,
      roughness: 0.48,
      metalness: 0.78,
      emissive: 0x000000,
    });
    const darkIron = new THREE.MeshStandardMaterial({ color: 0x111517, roughness: 0.62, metalness: 0.7 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2a1d18, roughness: 0.92, metalness: 0.02 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x70716c, roughness: 0.3, metalness: 0.9 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x211917, roughness: 0.95, side: THREE.DoubleSide });
    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0xc28b55,
      emissive: 0x8b3512,
      emissiveIntensity: 1.7,
      roughness: 0.3,
      metalness: 0.2,
    });

    this.torso.position.y = 0.18;
    this.rig.add(this.torso);
    const waist = this.mesh(new THREE.CylinderGeometry(0.38, 0.5, 0.42, 10), darkIron);
    waist.position.y = -0.15;
    this.torso.add(waist);
    const chest = this.mesh(new THREE.CylinderGeometry(0.44, 0.56, 0.9, 10), this.armorMaterial);
    chest.scale.z = 0.76;
    chest.position.y = 0.34;
    this.torso.add(chest);
    const chestRib = this.mesh(new THREE.BoxGeometry(0.12, 0.66, 0.08), edge);
    chestRib.position.set(0, 0.36, -0.43);
    this.torso.add(chestRib);
    const helmet = this.mesh(new THREE.DodecahedronGeometry(0.34, 0), darkIron);
    helmet.scale.set(0.95, 1.12, 0.94);
    helmet.position.y = 1.08;
    this.torso.add(helmet);
    const eye = this.mesh(new THREE.BoxGeometry(0.45, 0.055, 0.055), this.eyeMaterial);
    eye.position.set(0, 1.06, -0.327);
    this.torso.add(eye);
    const crest = this.mesh(new THREE.BoxGeometry(0.08, 0.55, 0.38), edge);
    crest.position.set(0, 1.37, 0.02);
    this.torso.add(crest);

    for (const x of [-0.49, 0.49]) {
      const pauldron = this.mesh(new THREE.SphereGeometry(0.26, 10, 7), this.armorMaterial);
      pauldron.scale.set(1.25, 0.7, 1.05);
      pauldron.position.set(x, 0.68, 0);
      this.torso.add(pauldron);
    }

    this.leftLeg.position.set(-0.21, -0.18, 0);
    this.rightLeg.position.set(0.21, -0.18, 0);
    this.rig.add(this.leftLeg, this.rightLeg);
    this.buildLeg(this.leftLeg, darkIron, this.armorMaterial);
    this.buildLeg(this.rightLeg, darkIron, this.armorMaterial);

    for (let index = 0; index < 4; index += 1) {
      const tasset = this.mesh(new THREE.BoxGeometry(0.22, 0.58, 0.08), this.armorMaterial);
      tasset.position.set((index - 1.5) * 0.18, -0.34, index % 2 === 0 ? -0.38 : 0.34);
      tasset.rotation.x = index % 2 === 0 ? 0.08 : -0.08;
      this.torso.add(tasset);
    }
    const tabard = this.mesh(new THREE.PlaneGeometry(0.52, 1.2, 1, 3), cloth);
    tabard.position.set(0, -0.48, 0.34);
    tabard.rotation.x = 0.08;
    this.torso.add(tabard);

    this.weaponPivot.position.set(0.57, 0.62, 0);
    this.torso.add(this.weaponPivot);
    const arm = this.mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.72, 8), leather);
    arm.position.y = -0.3;
    this.weaponPivot.add(arm);
    const blade = this.mesh(new THREE.BoxGeometry(0.13, 1.8, 0.055), edge);
    blade.position.set(0, -1.05, -0.03);
    this.weaponPivot.add(blade);
    const guard = this.mesh(new THREE.BoxGeometry(0.65, 0.09, 0.12), this.eyeMaterial);
    guard.position.y = -0.2;
    this.weaponPivot.add(guard);

    this.shieldPivot.position.set(-0.59, 0.6, -0.02);
    this.torso.add(this.shieldPivot);
    const shield = this.mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.13, 12), this.armorMaterial);
    shield.rotation.z = Math.PI / 2;
    shield.scale.y = 1.35;
    shield.position.y = -0.26;
    this.shieldPivot.add(shield);
    const shieldBoss = this.mesh(new THREE.OctahedronGeometry(0.18, 0), this.eyeMaterial);
    shieldBoss.position.set(-0.08, -0.26, -0.58);
    this.shieldPivot.add(shieldBoss);

    this.rig.scale.setScalar(variant === 0 ? 1.04 : 0.98);
  }

  fixedUpdate(delta: number, playerPosition: THREE.Vector3): void {
    this.syncRootFromBody();
    this.horizontalStep.set(0, 0, 0);
    this.toPlayer.copy(playerPosition).sub(this.root.position).setY(0);
    const distance = this.toPlayer.length();
    if (distance > 0.001) this.toPlayer.multiplyScalar(1 / distance);

    const desiredYaw = Math.atan2(-this.toPlayer.x, -this.toPlayer.z);
    const turnSpeed = this.state === 'windup' ? 2.25 : this.state === 'active' ? 0.85 : 5.4;
    if (this.state !== 'broken' && this.state !== 'executed' && this.state !== 'dead') {
      this.facingYaw = moveAngleTowards(this.facingYaw, desiredYaw, delta * turnSpeed);
    }
    this.forward.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));

    if (this.state === 'dead' || this.state === 'executed') {
      this.stateTimer += delta;
    } else if (this.state === 'broken') {
      this.stateTimer += delta;
      if (this.stateTimer >= 4.6) {
        this.state = 'approach';
        this.stateTimer = -0.35;
        this.poise = this.maxPoise * 0.34;
      }
    } else if (this.state === 'dormant') {
      if (distance < 13.5) {
        this.state = 'approach';
        this.stateTimer = 0;
      }
    } else if (this.state === 'stagger') {
      this.stateTimer += delta;
      if (this.stateTimer >= 0.5) {
        this.state = 'approach';
        this.stateTimer = -0.28;
      }
    } else if (this.state === 'approach') {
      this.stateTimer += delta;
      this.poise = Math.max(0, this.poise - delta * 5.5);
      if (distance > 2.65) {
        const speed = distance > 7 ? 2.4 : 1.72;
        const sideBias = this.variant === 1 && distance < 5.2 ? Math.sin(this.visualTime * 1.7) * 0.34 : 0;
        this.scratch.set(this.toPlayer.z, 0, -this.toPlayer.x);
        this.horizontalStep.copy(this.toPlayer).addScaledVector(this.scratch, sideBias).normalize().multiplyScalar(speed * delta);
      } else if (this.stateTimer >= 0) {
        this.chooseAttack(distance);
      }
    } else {
      const profile = ATTACKS[this.attack];
      this.stateTimer += delta;
      if (this.state === 'windup') {
        if (this.attack === 'lunge' && this.stateTimer > profile.windup * 0.72) {
          this.horizontalStep.copy(this.forward).multiplyScalar(profile.travel * delta * 1.25);
        }
        if (this.stateTimer >= profile.windup) {
          this.state = 'active';
          this.stateTimer = 0;
          this.emitAttackPulse(profile);
          this.audio.swing(profile.weight);
        }
      } else if (this.state === 'active') {
        const speedScale = this.attack === 'lunge' ? 5.1 : this.attack === 'shieldBash' ? 3.2 : 1.6;
        this.horizontalStep.copy(this.forward).multiplyScalar(profile.travel * delta * speedScale);
        if (this.stateTimer >= profile.active) {
          this.state = 'recovery';
          this.stateTimer = 0;
        }
      } else if (this.state === 'recovery' && this.stateTimer >= profile.recovery) {
        this.state = 'approach';
        this.stateTimer = -0.32 - this.variant * 0.12;
        this.attackPulseEmitted = false;
      }
    }

    this.horizontalStep.addScaledVector(this.impactVelocity, delta);
    this.impactVelocity.multiplyScalar(Math.exp(-10 * delta));
    this.applyPhysicsMovement(delta);
  }

  updateVisual(delta: number): void {
    this.syncRootFromBody();
    this.visualTime += delta;
    this.hitFlash = Math.max(0, this.hitFlash - delta * 4.8);
    const brokenPulse = this.state === 'broken' ? 0.35 + Math.sin(this.visualTime * 12) * 0.16 : 0;
    this.armorMaterial.emissive.setRGB(this.hitFlash * 0.75 + brokenPulse, this.hitFlash * 0.16, this.hitFlash * 0.06);
    this.eyeMaterial.emissiveIntensity = 1.45 + Math.sin(this.visualTime * 3.1 + this.variant) * 0.25
      + (this.state === 'windup' ? 1.2 : 0);

    let weaponX = -0.18;
    let weaponZ = -0.12;
    let torsoX = 0;
    let torsoY = 0;
    let shieldX = 0;
    let legSwing = 0;
    if (this.state === 'approach') {
      this.gait += delta * 6.2;
      legSwing = Math.sin(this.gait) * 0.34;
      torsoX = 0.06;
    } else if (this.state === 'windup' || this.state === 'active' || this.state === 'recovery') {
      const profile = ATTACKS[this.attack];
      const total = profile.windup + profile.active + profile.recovery;
      const elapsed = this.state === 'windup'
        ? this.stateTimer
        : this.state === 'active'
          ? profile.windup + this.stateTimer
          : profile.windup + profile.active + this.stateTimer;
      const progress = THREE.MathUtils.clamp(elapsed / total, 0, 1);
      if (this.attack === 'overhead') {
        const swing = THREE.MathUtils.smoothstep(progress, 0.38, 0.62);
        weaponX = THREE.MathUtils.lerp(-2.8, 0.72, swing);
        torsoX = THREE.MathUtils.lerp(-0.16, 0.42, swing);
        shieldX = -0.3;
      } else if (this.attack === 'sweep') {
        const swing = THREE.MathUtils.smoothstep(progress, 0.28, 0.6);
        weaponX = -1.15;
        weaponZ = THREE.MathUtils.lerp(-1.4, 1.25, swing);
        torsoY = THREE.MathUtils.lerp(-0.72, 0.88, swing);
        shieldX = 0.2;
      } else if (this.attack === 'shieldBash') {
        const slam = THREE.MathUtils.smoothstep(progress, 0.2, 0.52);
        shieldX = THREE.MathUtils.lerp(-1.4, 0.82, slam);
        weaponX = -0.85;
        torsoX = THREE.MathUtils.lerp(-0.1, 0.52, slam);
      } else {
        const thrust = THREE.MathUtils.smoothstep(progress, 0.44, 0.66);
        weaponX = THREE.MathUtils.lerp(-1.45, 0.05, thrust);
        weaponZ = -0.08;
        torsoX = THREE.MathUtils.lerp(-0.2, 0.34, thrust);
        shieldX = 0.38;
      }
    } else if (this.state === 'stagger') {
      torsoX = -0.38;
      weaponX = 0.52;
      shieldX = -0.56;
    } else if (this.state === 'broken') {
      torsoX = 0.68;
      torsoY = -0.24;
      weaponX = 0.92;
      shieldX = -1.08;
    } else if (this.state === 'executed') {
      torsoX = 0.2 + Math.min(1, this.stateTimer * 2) * 0.72;
      torsoY = -0.35;
      weaponX = 0.65;
      shieldX = -0.8;
    } else if (this.state === 'dead') {
      torsoX = 1.28;
      weaponX = 0.9;
      shieldX = -0.9;
      this.rig.position.y = Math.max(-1.08, this.rig.position.y - delta * 0.52);
    } else {
      const breathe = Math.sin(this.visualTime * 1.9 + this.variant) * 0.025;
      torsoX = breathe;
      shieldX = -0.08 + breathe;
    }

    const settle = 1 - Math.exp(-14 * delta);
    this.weaponPivot.rotation.x = THREE.MathUtils.lerp(this.weaponPivot.rotation.x, weaponX, settle);
    this.weaponPivot.rotation.z = THREE.MathUtils.lerp(this.weaponPivot.rotation.z, weaponZ, settle);
    this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, torsoX, settle);
    this.torso.rotation.y = THREE.MathUtils.lerp(this.torso.rotation.y, torsoY, settle);
    this.shieldPivot.rotation.x = THREE.MathUtils.lerp(this.shieldPivot.rotation.x, shieldX, settle);
    this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, legSwing, settle);
    this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, -legSwing, settle);
    this.root.rotation.y = this.facingYaw;
  }

  receiveParry(): EnemyDamageResult {
    if (this.state === 'dead' || this.state === 'executed') return 'ignored';
    this.poise += this.maxPoise * 0.72;
    this.hitFlash = 0.7;
    this.pendingAttackPulse = null;
    return this.checkPoiseBreak(true);
  }

  receiveDamage(damage: number, poiseDamage: number, impactDirection: THREE.Vector3): EnemyDamageResult {
    if (this.state === 'dead' || this.state === 'executed') return 'ignored';
    this.health = Math.max(0, this.health - damage);
    this.poise += poiseDamage;
    this.hitFlash = 1;
    const push = this.scratch.copy(impactDirection).setY(0);
    if (push.lengthSq() > 0.001) {
      const pushSpeed = THREE.MathUtils.clamp(0.9 + damage * 0.018, 1.1, 2.4);
      this.impactVelocity.add(push.normalize().multiplyScalar(pushSpeed));
    }
    if (this.health <= 0) {
      this.state = 'dead';
      this.stateTimer = 0;
      this.pendingAttackPulse = null;
      return 'killed';
    }
    return this.checkPoiseBreak(damage >= 50);
  }

  isExecutable(playerPosition: THREE.Vector3): boolean {
    return this.state === 'broken' && this.root.position.distanceToSquared(playerPosition) <= 2.4 * 2.4;
  }

  beginExecution(): void {
    if (this.state !== 'broken') return;
    this.state = 'executed';
    this.stateTimer = 0;
    this.pendingAttackPulse = null;
  }

  finishExecution(): void {
    if (this.state !== 'executed') return;
    this.health = 0;
    this.state = 'dead';
    this.stateTimer = 0;
    this.hitFlash = 1;
  }

  reset(): void {
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.body.setNextKinematicTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
    this.root.position.copy(this.spawn);
    this.root.rotation.set(0, 0, 0);
    this.rig.position.set(0, 0, 0);
    this.impactVelocity.set(0, 0, 0);
    this.state = 'dormant';
    this.attack = 'overhead';
    this.attackCycle = 0;
    this.stateTimer = 0;
    this.attackPulseEmitted = false;
    this.pendingAttackPulse = null;
    this.health = this.maxHealth;
    this.poise = 0;
    this.hitFlash = 0;
    this.facingYaw = 0;
    this.verticalVelocity = 0;
    this.grounded = false;
  }

  consumeAttackPulse(): AttackPulse | null {
    const pulse = this.pendingAttackPulse;
    this.pendingAttackPulse = null;
    return pulse;
  }

  getLockSnapshot(): LockTargetSnapshot {
    this.lockPoint.copy(this.root.position).add(new THREE.Vector3(0, 1.15, 0));
    return {
      name: this.displayName,
      position: this.lockPoint.clone(),
      healthRatio: this.health / this.maxHealth,
      poiseRatio: THREE.MathUtils.clamp(this.poise / this.maxPoise, 0, 1),
      executable: this.state === 'broken',
      active: this.state !== 'dead',
    };
  }

  getPosition(target: THREE.Vector3): THREE.Vector3 { return target.copy(this.root.position); }
  isActive(): boolean { return this.state !== 'dead'; }

  private chooseAttack(distance: number): void {
    const sequence: readonly SentinelAttackId[] = this.variant === 0
      ? ['overhead', 'shieldBash', 'sweep', 'lunge']
      : ['sweep', 'lunge', 'shieldBash', 'overhead'];
    const chosen = sequence[this.attackCycle % sequence.length];
    this.attack = distance > 3.1 ? 'lunge' : chosen ?? 'overhead';
    this.attackCycle += 1;
    this.state = 'windup';
    this.stateTimer = 0;
    this.attackPulseEmitted = false;
    this.audio.enemyTell(ATTACKS[this.attack].weight);
  }

  private emitAttackPulse(profile: SentinelAttackProfile): void {
    if (this.attackPulseEmitted) return;
    this.pendingAttackPulse = {
      source: 'enemy',
      position: this.root.position.clone().add(new THREE.Vector3(0, 0.78, 0)).addScaledVector(this.forward, 0.58),
      forward: this.forward.clone(),
      range: profile.range,
      arcCos: profile.arcCos,
      damage: profile.damage,
      poiseDamage: profile.poiseDamage,
      impact: profile.impact,
      weight: profile.weight,
    };
    this.attackPulseEmitted = true;
  }

  private checkPoiseBreak(force: boolean): EnemyDamageResult {
    if (this.poise >= this.maxPoise || force) {
      this.state = 'broken';
      this.stateTimer = 0;
      this.pendingAttackPulse = null;
      this.poise = this.maxPoise;
      return 'broken';
    }
    this.state = 'stagger';
    this.stateTimer = 0;
    this.pendingAttackPulse = null;
    return 'hit';
  }

  private applyPhysicsMovement(delta: number): void {
    if (this.grounded) this.verticalVelocity = -2.6;
    else this.verticalVelocity = Math.max(-24, this.verticalVelocity - 26 * delta);
    this.controller.computeColliderMovement(this.collider, {
      x: this.horizontalStep.x,
      y: this.verticalVelocity * delta,
      z: this.horizontalStep.z,
    });
    const corrected = this.controller.computedMovement();
    const position = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: position.x + corrected.x,
      y: position.y + corrected.y,
      z: position.z + corrected.z,
    });
    this.grounded = this.controller.computedGrounded();
  }

  private syncRootFromBody(): void {
    const position = this.body.translation();
    this.root.position.set(position.x, position.y, position.z);
  }

  private buildLeg(parent: THREE.Group, darkIron: THREE.Material, armor: THREE.Material): void {
    const thigh = this.mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.56, 8), armor);
    thigh.position.y = -0.26;
    parent.add(thigh);
    const greave = this.mesh(new THREE.BoxGeometry(0.28, 0.55, 0.34), darkIron);
    greave.position.set(0, -0.68, -0.02);
    parent.add(greave);
    const boot = this.mesh(new THREE.BoxGeometry(0.3, 0.2, 0.47), darkIron);
    boot.position.set(0, -1.02, -0.1);
    parent.add(boot);
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function shortestAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function moveAngleTowards(current: number, target: number, maxDelta: number): number {
  const delta = shortestAngle(target - current);
  return current + THREE.MathUtils.clamp(delta, -maxDelta, maxDelta);
}
