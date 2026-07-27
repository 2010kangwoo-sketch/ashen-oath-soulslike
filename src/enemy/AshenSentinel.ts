import * as THREE from 'three';
import RAPIER, { type RigidBody } from '@dimforge/rapier3d-compat';
import type { AttackPulse, LockTargetSnapshot } from '../combat/CombatTypes';
import { PhysicsWorld } from '../physics/PhysicsWorld';

type SentinelState = 'dormant' | 'approach' | 'windup' | 'active' | 'recovery' | 'stagger' | 'dead';
type SentinelAttackId = 'overhead' | 'sweep' | 'lunge';

interface SentinelAttackProfile {
  readonly windup: number;
  readonly active: number;
  readonly recovery: number;
  readonly range: number;
  readonly arcCos: number;
  readonly damage: number;
  readonly poiseDamage: number;
  readonly impact: number;
  readonly lungeDistance: number;
}

const ATTACKS: Record<SentinelAttackId, SentinelAttackProfile> = {
  overhead: {
    windup: 0.82,
    active: 0.13,
    recovery: 0.72,
    range: 2.75,
    arcCos: 0.42,
    damage: 34,
    poiseDamage: 36,
    impact: 2.8,
    lungeDistance: 0.38,
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
    lungeDistance: 0.3,
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
    lungeDistance: 1.45,
  },
};

export class AshenSentinel {
  readonly root = new THREE.Group();
  private readonly rig = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly weaponPivot = new THREE.Group();
  private readonly shieldPivot = new THREE.Group();
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly armorMaterial: THREE.MeshStandardMaterial;
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly toPlayer = new THREE.Vector3();
  private readonly lockPoint = new THREE.Vector3();
  private state: SentinelState = 'dormant';
  private attack: SentinelAttackId = 'overhead';
  private attackCycle = 0;
  private stateTimer = 0;
  private attackPulseEmitted = false;
  private pendingAttackPulse: AttackPulse | null = null;
  private health = 118;
  private poise = 0;
  private hitFlash = 0;
  private facingYaw = 0;
  private visualTime = 0;
  private readonly spawn: THREE.Vector3;
  private readonly body: RigidBody;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    readonly id: string,
    readonly displayName: string,
    spawn: THREE.Vector3,
    private readonly variant = 0,
  ) {
    this.spawn = spawn.clone();
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.spawn.x, this.spawn.y, this.spawn.z),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.7, 0.5).setFriction(0),
      this.body,
    );

    this.root.name = `enemy-${id}`;
    this.root.position.copy(this.spawn);
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.body.setNextKinematicTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
    this.root.add(this.rig);
    scene.add(this.root);

    this.armorMaterial = new THREE.MeshStandardMaterial({
      color: variant === 0 ? 0x2b3032 : 0x34302d,
      roughness: 0.52,
      metalness: 0.74,
      emissive: 0x000000,
    });
    const darkIron = new THREE.MeshStandardMaterial({ color: 0x141719, roughness: 0.65, metalness: 0.65 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2a1d18, roughness: 0.92, metalness: 0.02 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x656562, roughness: 0.36, metalness: 0.88 });
    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0xc28b55,
      emissive: 0x8b3512,
      emissiveIntensity: 1.7,
      roughness: 0.3,
      metalness: 0.2,
    });

    this.torso.position.y = 0.18;
    this.rig.add(this.torso);
    const waist = this.mesh(new THREE.CylinderGeometry(0.38, 0.5, 0.42, 9), darkIron);
    waist.position.y = -0.15;
    this.torso.add(waist);
    const chest = this.mesh(new THREE.CylinderGeometry(0.44, 0.56, 0.9, 9), this.armorMaterial);
    chest.scale.z = 0.76;
    chest.position.y = 0.34;
    this.torso.add(chest);
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

    for (const x of [-0.48, 0.48]) {
      const leg = this.mesh(new THREE.BoxGeometry(0.28, 0.9, 0.34), darkIron);
      leg.position.set(x * 0.48, -0.58, 0);
      this.rig.add(leg);
    }

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
    const shield = this.mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.13, 10), this.armorMaterial);
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
    if (this.state === 'dead') {
      this.stateTimer += delta;
      return;
    }

    this.toPlayer.copy(playerPosition).sub(this.root.position).setY(0);
    const distance = this.toPlayer.length();
    if (distance > 0.001) this.toPlayer.multiplyScalar(1 / distance);
    const desiredYaw = Math.atan2(-this.toPlayer.x, -this.toPlayer.z);
    this.facingYaw = moveAngleTowards(this.facingYaw, desiredYaw, delta * (this.state === 'windup' ? 2.4 : 5.7));
    this.forward.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));
    this.root.rotation.y = this.facingYaw;

    if (this.state === 'dormant') {
      if (distance < 12.5) {
        this.state = 'approach';
        this.stateTimer = 0;
      }
      return;
    }

    if (this.state === 'stagger') {
      this.stateTimer += delta;
      if (this.stateTimer >= 0.48) {
        this.state = 'approach';
        this.stateTimer = -0.24;
        this.poise = 0;
      }
      return;
    }

    if (this.state === 'approach') {
      this.stateTimer += delta;
      if (distance > 2.65) {
        const speed = distance > 7 ? 2.35 : 1.65;
        this.moveRoot(this.toPlayer, speed * delta);
      } else if (this.stateTimer >= 0) {
        this.chooseAttack(distance);
      }
      return;
    }

    const profile = ATTACKS[this.attack];
    this.stateTimer += delta;
    if (this.state === 'windup') {
      if (this.attack === 'lunge' && this.stateTimer > profile.windup * 0.72) {
        this.moveRoot(this.forward, profile.lungeDistance * delta * 1.4);
      }
      if (this.stateTimer >= profile.windup) {
        this.state = 'active';
        this.stateTimer = 0;
        this.emitAttackPulse(profile);
      }
      return;
    }

    if (this.state === 'active') {
      if (this.attack === 'lunge') {
        this.moveRoot(this.forward, profile.lungeDistance * delta * 5.4);
      }
      if (this.stateTimer >= profile.active) {
        this.state = 'recovery';
        this.stateTimer = 0;
      }
      return;
    }

    if (this.state === 'recovery' && this.stateTimer >= profile.recovery) {
      this.state = 'approach';
      this.stateTimer = -0.32 - this.variant * 0.12;
      this.attackPulseEmitted = false;
    }
  }

  updateVisual(delta: number): void {
    this.visualTime += delta;
    this.hitFlash = Math.max(0, this.hitFlash - delta * 4.8);
    this.armorMaterial.emissive.setRGB(this.hitFlash * 0.75, this.hitFlash * 0.16, this.hitFlash * 0.06);
    this.eyeMaterial.emissiveIntensity = 1.45 + Math.sin(this.visualTime * 3.1 + this.variant) * 0.25
      + (this.state === 'windup' ? 1.2 : 0);

    let weaponX = -0.18;
    let weaponZ = -0.12;
    let torsoX = 0;
    let torsoY = 0;
    let shieldX = 0;
    if (this.state === 'windup' || this.state === 'active' || this.state === 'recovery') {
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
    } else if (this.state === 'dead') {
      torsoX = 1.2;
      weaponX = 0.9;
      shieldX = -0.9;
      this.rig.position.y = Math.max(-1.15, this.rig.position.y - delta * 0.12);
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
  }


  receiveParry(): void {
    if (this.state === 'dead') return;
    this.state = 'stagger';
    this.stateTimer = -0.58;
    this.poise = 0;
    this.pendingAttackPulse = null;
    this.hitFlash = 0.65;
  }

  receiveDamage(damage: number, poiseDamage: number, impactDirection: THREE.Vector3): boolean {
    if (this.state === 'dead') return false;
    this.health = Math.max(0, this.health - damage);
    this.poise += poiseDamage;
    this.hitFlash = 1;
    this.moveRoot(impactDirection.clone().setY(0).normalize(), 0.12);
    if (this.health <= 0) {
      this.state = 'dead';
      this.stateTimer = 0;
      this.pendingAttackPulse = null;
    } else if (this.poise >= 48 || damage >= 50) {
      this.state = 'stagger';
      this.stateTimer = 0;
      this.pendingAttackPulse = null;
    }
    return true;
  }


  reset(): void {
    this.root.position.copy(this.spawn);
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.body.setNextKinematicTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
    this.root.rotation.set(0, 0, 0);
    this.rig.position.set(0, 0, 0);
    this.state = 'dormant';
    this.attack = 'overhead';
    this.attackCycle = 0;
    this.stateTimer = 0;
    this.attackPulseEmitted = false;
    this.pendingAttackPulse = null;
    this.health = 118;
    this.poise = 0;
    this.hitFlash = 0;
    this.facingYaw = 0;
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
      position: this.lockPoint,
      healthRatio: this.health / 118,
      active: this.state !== 'dead',
    };
  }

  getPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.root.position);
  }

  isActive(): boolean {
    return this.state !== 'dead';
  }

  private chooseAttack(distance: number): void {
    const sequence: readonly SentinelAttackId[] = this.variant === 0
      ? ['overhead', 'sweep', 'lunge']
      : ['sweep', 'lunge', 'overhead'];
    const chosen = sequence[this.attackCycle % sequence.length];
    this.attack = distance > 3.05 ? 'lunge' : chosen ?? 'overhead';
    this.attackCycle += 1;
    this.state = 'windup';
    this.stateTimer = 0;
    this.attackPulseEmitted = false;
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
    };
    this.attackPulseEmitted = true;
  }


  private moveRoot(direction: THREE.Vector3, distance: number): void {
    this.root.position.addScaledVector(direction, distance);
    this.body.setNextKinematicTranslation({
      x: this.root.position.x,
      y: this.root.position.y,
      z: this.root.position.z,
    });
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
