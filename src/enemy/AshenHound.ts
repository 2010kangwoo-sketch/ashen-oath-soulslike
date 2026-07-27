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

type HoundState =
  | 'dormant'
  | 'stalk'
  | 'circle'
  | 'windup'
  | 'active'
  | 'recovery'
  | 'stagger'
  | 'broken'
  | 'executed'
  | 'dead';
type HoundAttackId = 'bite' | 'pounce';

interface HoundAttackProfile {
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

const ATTACKS: Record<HoundAttackId, HoundAttackProfile> = {
  bite: {
    windup: 0.34,
    active: 0.12,
    recovery: 0.48,
    range: 1.85,
    arcCos: 0.25,
    damage: 20,
    poiseDamage: 18,
    impact: 1.35,
    travel: 0.62,
    weight: 'light',
  },
  pounce: {
    windup: 0.62,
    active: 0.18,
    recovery: 0.78,
    range: 2.55,
    arcCos: 0.52,
    damage: 31,
    poiseDamage: 36,
    impact: 2.7,
    travel: 2.25,
    weight: 'medium',
  },
};

export class AshenHound implements CombatEnemy {
  readonly root = new THREE.Group();
  readonly ashReward = 56;
  private readonly rig = new THREE.Group();
  private readonly bodyPivot = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly jawPivot = new THREE.Group();
  private readonly frontLegs: THREE.Group[] = [];
  private readonly rearLegs: THREE.Group[] = [];
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly hideMaterial: THREE.MeshStandardMaterial;
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly toPlayer = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly horizontalStep = new THREE.Vector3();
  private readonly impactVelocity = new THREE.Vector3();
  private readonly lockPoint = new THREE.Vector3();
  private readonly spawn: THREE.Vector3;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly maxHealth = 82;
  private readonly maxPoise = 46;
  private state: HoundState = 'dormant';
  private attack: HoundAttackId = 'bite';
  private stateTimer = 0;
  private health = this.maxHealth;
  private poise = 0;
  private attackPulseEmitted = false;
  private pendingAttackPulse: AttackPulse | null = null;
  private facingYaw = 0;
  private verticalVelocity = 0;
  private grounded = false;
  private visualTime = 0;
  private gait = 0;
  private attackAllowed = true;
  private hitFlash = 0;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    readonly id: string,
    readonly displayName: string,
    spawn: THREE.Vector3,
    private readonly audio: AudioDirector,
    private side = 1,
  ) {
    this.spawn = spawn.clone();
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.34, 0.42).setFriction(0),
      this.body,
    );
    this.controller = physics.world.createCharacterController(0.05);
    this.controller.enableAutostep(0.26, 0.19, false);
    this.controller.enableSnapToGround(0.24);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(44));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(50));
    this.controller.setSlideEnabled(true);

    this.root.name = `enemy-${id}`;
    this.root.add(this.rig);
    this.root.position.copy(spawn);
    scene.add(this.root);

    this.hideMaterial = new THREE.MeshStandardMaterial({
      color: 0x282421,
      roughness: 0.9,
      metalness: 0.06,
      emissive: 0x000000,
    });
    const bone = new THREE.MeshStandardMaterial({ color: 0x746b5f, roughness: 0.72, metalness: 0.12 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x252b2c, roughness: 0.55, metalness: 0.72 });
    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0xd19b5b,
      emissive: 0x8f2d0f,
      emissiveIntensity: 1.9,
      roughness: 0.3,
    });

    this.bodyPivot.position.y = 0.52;
    this.rig.add(this.bodyPivot);
    const chest = this.mesh(new THREE.SphereGeometry(0.56, 12, 8), this.hideMaterial);
    chest.scale.set(0.82, 0.68, 1.52);
    this.bodyPivot.add(chest);
    const ribCage = this.mesh(new THREE.TorusGeometry(0.4, 0.045, 6, 16, Math.PI * 1.35), bone);
    ribCage.rotation.set(Math.PI / 2, 0, Math.PI * 0.82);
    ribCage.position.set(0, 0.1, 0.06);
    this.bodyPivot.add(ribCage);
    const shoulderPlate = this.mesh(new THREE.BoxGeometry(0.88, 0.18, 0.58), iron);
    shoulderPlate.position.set(0, 0.22, -0.24);
    shoulderPlate.rotation.x = -0.12;
    this.bodyPivot.add(shoulderPlate);

    this.headPivot.position.set(0, 0.18, -0.82);
    this.bodyPivot.add(this.headPivot);
    const skull = this.mesh(new THREE.DodecahedronGeometry(0.34, 0), bone);
    skull.scale.set(0.82, 0.72, 1.28);
    this.headPivot.add(skull);
    const muzzle = this.mesh(new THREE.BoxGeometry(0.42, 0.24, 0.55), this.hideMaterial);
    muzzle.position.set(0, -0.08, -0.39);
    this.headPivot.add(muzzle);
    this.jawPivot.position.set(0, -0.18, -0.35);
    this.headPivot.add(this.jawPivot);
    const jaw = this.mesh(new THREE.BoxGeometry(0.38, 0.1, 0.46), bone);
    jaw.position.z = -0.08;
    this.jawPivot.add(jaw);
    for (const x of [-0.15, 0.15]) {
      const eye = this.mesh(new THREE.SphereGeometry(0.045, 8, 6), this.eyeMaterial);
      eye.position.set(x, 0.08, -0.34);
      this.headPivot.add(eye);
    }
    for (const x of [-0.2, 0.2]) {
      const ear = this.mesh(new THREE.ConeGeometry(0.12, 0.42, 4), this.hideMaterial);
      ear.position.set(x, 0.37, 0);
      ear.rotation.z = x < 0 ? -0.18 : 0.18;
      this.headPivot.add(ear);
    }

    for (const x of [-0.3, 0.3]) {
      const front = this.buildLeg(x, -0.45, iron, bone);
      const rear = this.buildLeg(x, 0.48, iron, bone);
      this.frontLegs.push(front);
      this.rearLegs.push(rear);
      this.bodyPivot.add(front, rear);
    }

    const tail = this.mesh(new THREE.CylinderGeometry(0.045, 0.12, 1.15, 7), bone);
    tail.position.set(0, 0.05, 0.86);
    tail.rotation.x = -0.85;
    this.bodyPivot.add(tail);
  }

  fixedUpdate(delta: number, playerPosition: THREE.Vector3): void {
    this.syncRootFromBody();
    this.horizontalStep.set(0, 0, 0);
    this.toPlayer.copy(playerPosition).sub(this.root.position).setY(0);
    const distance = this.toPlayer.length();
    if (distance > 0.001) this.toPlayer.multiplyScalar(1 / distance);
    const desiredYaw = Math.atan2(-this.toPlayer.x, -this.toPlayer.z);
    const turnSpeed = this.state === 'windup' ? 3.2 : this.state === 'active' ? 1.2 : 8.5;
    if (!['broken', 'executed', 'dead'].includes(this.state)) {
      this.facingYaw = moveAngleTowards(this.facingYaw, desiredYaw, turnSpeed * delta);
    }
    this.forward.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));

    if (this.state === 'dead' || this.state === 'executed') {
      this.stateTimer += delta;
    } else if (this.state === 'broken') {
      this.stateTimer += delta;
      if (this.stateTimer >= 3.7) {
        this.state = 'stalk';
        this.stateTimer = -0.3;
        this.poise = this.maxPoise * 0.28;
      }
    } else if (this.state === 'dormant') {
      if (distance < 11.5) {
        this.state = 'stalk';
        this.stateTimer = 0;
      }
    } else if (this.state === 'stagger') {
      this.stateTimer += delta;
      if (this.stateTimer >= 0.38) {
        this.state = 'circle';
        this.stateTimer = -0.2;
      }
    } else if (this.state === 'stalk') {
      this.stateTimer += delta;
      this.poise = Math.max(0, this.poise - delta * 8);
      if (distance > 4.2) {
        this.horizontalStep.copy(this.toPlayer).multiplyScalar(3.55 * delta);
      } else {
        this.state = 'circle';
        this.stateTimer = 0;
      }
    } else if (this.state === 'circle') {
      this.stateTimer += delta;
      this.tangent.set(this.toPlayer.z * this.side, 0, -this.toPlayer.x * this.side);
      const radialCorrection = THREE.MathUtils.clamp((distance - 3.15) * 0.8, -0.65, 0.65);
      this.horizontalStep.copy(this.tangent).addScaledVector(this.toPlayer, radialCorrection).normalize().multiplyScalar(2.7 * delta);
      if (this.attackAllowed && this.stateTimer >= 0.72 && distance < 4.6) {
        this.attack = distance > 2.45 ? 'pounce' : 'bite';
        this.state = 'windup';
        this.stateTimer = 0;
        this.attackPulseEmitted = false;
        this.audio.enemyTell(ATTACKS[this.attack].weight);
      }
    } else {
      const profile = ATTACKS[this.attack];
      this.stateTimer += delta;
      if (this.state === 'windup') {
        if (this.attack === 'pounce' && this.stateTimer > profile.windup * 0.68) {
          this.horizontalStep.copy(this.forward).multiplyScalar(profile.travel * delta * 0.85);
        }
        if (this.stateTimer >= profile.windup) {
          this.state = 'active';
          this.stateTimer = 0;
          this.emitAttackPulse(profile);
          this.audio.swing(profile.weight);
        }
      } else if (this.state === 'active') {
        const speed = this.attack === 'pounce' ? 5.8 : 3.4;
        this.horizontalStep.copy(this.forward).multiplyScalar(profile.travel * delta * speed);
        if (this.stateTimer >= profile.active) {
          this.state = 'recovery';
          this.stateTimer = 0;
        }
      } else if (this.state === 'recovery' && this.stateTimer >= profile.recovery) {
        this.state = 'circle';
        this.stateTimer = -0.26;
        this.attackPulseEmitted = false;
        this.side *= -1;
      }
    }

    this.horizontalStep.addScaledVector(this.impactVelocity, delta);
    this.impactVelocity.multiplyScalar(Math.exp(-10 * delta));
    this.applyPhysicsMovement(delta);
  }

  updateVisual(delta: number): void {
    this.syncRootFromBody();
    this.visualTime += delta;
    this.hitFlash = Math.max(0, this.hitFlash - delta * 5.5);
    const brokenPulse = this.state === 'broken' ? 0.32 + Math.sin(this.visualTime * 14) * 0.12 : 0;
    this.hideMaterial.emissive.setRGB(this.hitFlash * 0.55 + brokenPulse, this.hitFlash * 0.08, this.hitFlash * 0.03);
    this.eyeMaterial.emissiveIntensity = 1.7 + Math.sin(this.visualTime * 5.2) * 0.25 + (this.state === 'windup' ? 1.4 : 0);

    const moving = this.state === 'stalk' || this.state === 'circle';
    if (moving) this.gait += delta * (this.state === 'stalk' ? 10.8 : 8.2);
    const legSwing = moving ? Math.sin(this.gait) * 0.62 : 0;
    const crouch = this.state === 'windup' ? Math.sin(Math.min(1, this.stateTimer / ATTACKS[this.attack].windup) * Math.PI * 0.5) : 0;
    let bodyY = 0;
    let bodyX = 0;
    let headX = -0.08;
    let jawX = 0.12;
    if (this.state === 'active') {
      bodyX = this.attack === 'pounce' ? -0.28 : 0.18;
      bodyY = this.attack === 'pounce' ? 0.22 : 0.05;
      headX = 0.42;
      jawX = 0.68;
    } else if (this.state === 'windup') {
      bodyX = 0.22 * crouch;
      bodyY = -0.16 * crouch;
      headX = -0.3;
      jawX = 0.35;
    } else if (this.state === 'stagger') {
      bodyX = -0.42;
      headX = -0.55;
      jawX = 0.5;
    } else if (this.state === 'broken') {
      bodyX = 0.68;
      bodyY = -0.28;
      headX = 0.55;
      jawX = 0.78;
    } else if (this.state === 'executed') {
      bodyX = 0.9;
      bodyY = -0.24;
      headX = 0.7;
      jawX = 0.8;
    } else if (this.state === 'dead') {
      bodyX = 1.25;
      bodyY = -0.42;
      headX = 0.9;
      jawX = 0.9;
    }

    const settle = 1 - Math.exp(-18 * delta);
    this.bodyPivot.rotation.x = THREE.MathUtils.lerp(this.bodyPivot.rotation.x, bodyX, settle);
    this.bodyPivot.position.y = THREE.MathUtils.lerp(this.bodyPivot.position.y, 0.52 + bodyY, settle);
    this.headPivot.rotation.x = THREE.MathUtils.lerp(this.headPivot.rotation.x, headX, settle);
    this.jawPivot.rotation.x = THREE.MathUtils.lerp(this.jawPivot.rotation.x, jawX, settle);
    for (let index = 0; index < this.frontLegs.length; index += 1) {
      const front = this.frontLegs[index];
      const rear = this.rearLegs[index];
      if (front) front.rotation.x = THREE.MathUtils.lerp(front.rotation.x, index % 2 === 0 ? legSwing : -legSwing, settle);
      if (rear) rear.rotation.x = THREE.MathUtils.lerp(rear.rotation.x, index % 2 === 0 ? -legSwing : legSwing, settle);
    }
    this.root.rotation.y = this.facingYaw;
  }

  receiveParry(): EnemyDamageResult {
    if (this.state === 'dead' || this.state === 'executed') return 'ignored';
    this.poise += this.maxPoise;
    this.hitFlash = 0.8;
    return this.breakPosture();
  }

  receiveDamage(damage: number, poiseDamage: number, impactDirection: THREE.Vector3): EnemyDamageResult {
    if (this.state === 'dead' || this.state === 'executed') return 'ignored';
    this.health = Math.max(0, this.health - damage);
    this.poise += poiseDamage;
    this.hitFlash = 1;
    const push = this.scratch.copy(impactDirection).setY(0);
    if (push.lengthSq() > 0.001) {
      const pushSpeed = THREE.MathUtils.clamp(1.2 + damage * 0.022, 1.4, 2.8);
      this.impactVelocity.add(push.normalize().multiplyScalar(pushSpeed));
    }
    if (this.health <= 0) {
      this.state = 'dead';
      this.stateTimer = 0;
      this.pendingAttackPulse = null;
      return 'killed';
    }
    if (this.poise >= this.maxPoise || damage >= 48) return this.breakPosture();
    this.state = 'stagger';
    this.stateTimer = 0;
    this.pendingAttackPulse = null;
    return 'hit';
  }

  isExecutable(playerPosition: THREE.Vector3): boolean {
    return this.state === 'broken' && this.root.position.distanceToSquared(playerPosition) <= 2.2 * 2.2;
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
  }

  reset(): void {
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.body.setNextKinematicTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
    this.root.position.copy(this.spawn);
    this.root.rotation.set(0, 0, 0);
    this.bodyPivot.position.y = 0.52;
    this.rig.position.set(0, 0, 0);
    this.impactVelocity.set(0, 0, 0);
    this.state = 'dormant';
    this.attack = 'bite';
    this.stateTimer = 0;
    this.health = this.maxHealth;
    this.poise = 0;
    this.attackPulseEmitted = false;
    this.pendingAttackPulse = null;
    this.facingYaw = 0;
    this.verticalVelocity = 0;
    this.grounded = false;
    this.attackAllowed = true;
    this.hitFlash = 0;
  }

  consumeAttackPulse(): AttackPulse | null {
    const pulse = this.pendingAttackPulse;
    this.pendingAttackPulse = null;
    return pulse;
  }

  getLockSnapshot(): LockTargetSnapshot {
    this.lockPoint.copy(this.root.position).add(new THREE.Vector3(0, 0.72, 0));
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
  isCommittedAttack(): boolean { return this.state === 'windup' || this.state === 'active' || this.state === 'recovery'; }
  setAttackAllowed(allowed: boolean): void { this.attackAllowed = allowed; }

  private emitAttackPulse(profile: HoundAttackProfile): void {
    if (this.attackPulseEmitted) return;
    this.pendingAttackPulse = {
      source: 'enemy',
      position: this.root.position.clone().add(new THREE.Vector3(0, 0.58, 0)).addScaledVector(this.forward, 0.48),
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

  private breakPosture(): EnemyDamageResult {
    this.state = 'broken';
    this.stateTimer = 0;
    this.poise = this.maxPoise;
    this.pendingAttackPulse = null;
    return 'broken';
  }

  private applyPhysicsMovement(delta: number): void {
    if (this.grounded) this.verticalVelocity = -2.4;
    else this.verticalVelocity = Math.max(-22, this.verticalVelocity - 26 * delta);
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

  private buildLeg(x: number, z: number, iron: THREE.Material, bone: THREE.Material): THREE.Group {
    const root = new THREE.Group();
    root.position.set(x, -0.15, z);
    const upper = this.mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.46, 7), bone);
    upper.position.y = -0.2;
    root.add(upper);
    const cuff = this.mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.22, 7), iron);
    cuff.position.y = -0.48;
    root.add(cuff);
    const paw = this.mesh(new THREE.BoxGeometry(0.22, 0.13, 0.34), this.hideMaterial);
    paw.position.set(0, -0.64, -0.08);
    root.add(paw);
    return root;
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
