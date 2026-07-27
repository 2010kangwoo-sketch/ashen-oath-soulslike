import * as THREE from 'three';
import RAPIER, { type Collider, type KinematicCharacterController, type RigidBody } from '@dimforge/rapier3d-compat';
import type { AudioDirector, SwingWeight } from '../audio/AudioDirector';
import type { AttackPulse, EnemyDamageResult, LockTargetSnapshot } from '../combat/CombatTypes';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { CombatEnemy } from './CombatEnemy';

type BellState = 'dormant' | 'advance' | 'windup' | 'active' | 'recovery' | 'stagger' | 'broken' | 'executed' | 'dead';
type BellAttack = 'bellSlam' | 'soundBurst' | 'chainSweep';

interface BellProfile {
  windup: number;
  active: number;
  recovery: number;
  range: number;
  arcCos: number;
  damage: number;
  poiseDamage: number;
  impact: number;
  weight: SwingWeight;
}

const NORMAL_ATTACKS: Record<BellAttack, BellProfile> = {
  bellSlam: { windup: 1.05, active: 0.16, recovery: 0.88, range: 3.2, arcCos: 0.1, damage: 39, poiseDamage: 55, impact: 3.4, weight: 'heavy' },
  soundBurst: { windup: 1.22, active: 0.12, recovery: 1.0, range: 4.65, arcCos: -1, damage: 25, poiseDamage: 34, impact: 1.8, weight: 'medium' },
  chainSweep: { windup: 0.72, active: 0.2, recovery: 0.76, range: 3.8, arcCos: -0.36, damage: 29, poiseDamage: 38, impact: 2.3, weight: 'medium' },
};

export class BellKeeper implements CombatEnemy {
  readonly root = new THREE.Group();
  readonly ashReward: number;
  private readonly rig = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly bellPivot = new THREE.Group();
  private readonly chainPivot = new THREE.Group();
  private readonly cloakPanels: THREE.Mesh[] = [];
  private readonly spawn: THREE.Vector3;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly toPlayer = new THREE.Vector3();
  private readonly step = new THREE.Vector3();
  private readonly impactVelocity = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly lockPoint = new THREE.Vector3();
  private readonly armorMaterial: THREE.MeshStandardMaterial;
  private readonly bellMaterial: THREE.MeshStandardMaterial;
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly soundRing: THREE.Mesh;
  private readonly maxHealth: number;
  private readonly maxPoise: number;
  private health: number;
  private poise = 0;
  private state: BellState = 'dormant';
  private attack: BellAttack = 'bellSlam';
  private stateTimer = 0;
  private cycle = 0;
  private facingYaw = 0;
  private verticalVelocity = 0;
  private grounded = false;
  private pulseEmitted = false;
  private pendingPulse: AttackPulse | null = null;
  private hitFlash = 0;
  private visualTime = 0;
  private gait = 0;
  private attackAllowed = true;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    readonly id: string,
    readonly displayName: string,
    spawn: THREE.Vector3,
    private readonly audio: AudioDirector,
    private readonly elite = false,
  ) {
    this.spawn = spawn.clone();
    this.maxHealth = elite ? 330 : 178;
    this.maxPoise = elite ? 172 : 92;
    this.health = this.maxHealth;
    this.ashReward = elite ? 290 : 96;

    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(elite ? 0.82 : 0.72, elite ? 0.61 : 0.53).setFriction(0), this.body);
    this.controller = physics.world.createCharacterController(0.06);
    this.controller.enableAutostep(0.34, 0.24, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(44));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(51));
    this.controller.setSlideEnabled(true);

    this.root.name = `enemy-${id}`;
    this.root.position.copy(spawn);
    this.root.add(this.rig);
    scene.add(this.root);

    this.armorMaterial = new THREE.MeshStandardMaterial({ color: elite ? 0x4a3531 : 0x302c2c, roughness: 0.58, metalness: 0.66, emissive: 0x000000 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.72, metalness: 0.58 });
    const cloth = new THREE.MeshStandardMaterial({ color: elite ? 0x3d1617 : 0x251719, roughness: 0.98, side: THREE.DoubleSide });
    this.bellMaterial = new THREE.MeshStandardMaterial({ color: elite ? 0x8c6944 : 0x675238, roughness: 0.38, metalness: 0.82, emissive: 0x3b1709, emissiveIntensity: 0.25 });
    this.eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xe2bc7a, emissive: 0xa74b18, emissiveIntensity: 1.7, roughness: 0.25 });

    this.torso.position.y = 0.2;
    this.rig.add(this.torso);
    const body = this.mesh(new THREE.CylinderGeometry(0.47, 0.66, 1.05, 10), this.armorMaterial);
    body.scale.z = 0.78;
    body.position.y = 0.28;
    this.torso.add(body);
    const hood = this.mesh(new THREE.SphereGeometry(0.42, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.78), cloth);
    hood.position.y = 1.02;
    hood.scale.set(0.95, 1.08, 0.95);
    this.torso.add(hood);
    const mask = this.mesh(new THREE.CylinderGeometry(0.25, 0.31, 0.4, 8), dark);
    mask.position.set(0, 0.9, -0.17);
    mask.rotation.x = Math.PI / 2;
    this.torso.add(mask);
    for (const x of [-0.1, 0.1]) {
      const eye = this.mesh(new THREE.SphereGeometry(0.035, 8, 6), this.eyeMaterial);
      eye.position.set(x, 0.98, -0.35);
      this.torso.add(eye);
    }
    for (let index = 0; index < 5; index += 1) {
      const panel = this.mesh(new THREE.PlaneGeometry(0.28, 1.45, 1, 5), cloth);
      panel.position.set((index - 2) * 0.2, -0.35, 0.31 + Math.abs(index - 2) * 0.02);
      panel.rotation.x = 0.08;
      this.torso.add(panel);
      this.cloakPanels.push(panel);
    }

    this.bellPivot.position.set(0.48, 0.72, -0.06);
    this.torso.add(this.bellPivot);
    const handle = this.mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 8), dark);
    handle.position.y = -0.32;
    this.bellPivot.add(handle);
    const bell = this.mesh(new THREE.CylinderGeometry(0.26, 0.48, 0.62, 12, 1, true), this.bellMaterial);
    bell.position.y = -0.92;
    this.bellPivot.add(bell);
    const rim = this.mesh(new THREE.TorusGeometry(0.48, 0.055, 8, 20), this.bellMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -1.22;
    this.bellPivot.add(rim);
    const clapper = this.mesh(new THREE.SphereGeometry(0.1, 8, 6), dark);
    clapper.position.y = -1.34;
    this.bellPivot.add(clapper);

    this.chainPivot.position.set(-0.48, 0.65, 0);
    this.torso.add(this.chainPivot);
    for (let index = 0; index < 11; index += 1) {
      const link = this.mesh(new THREE.TorusGeometry(0.095, 0.022, 5, 10), dark);
      link.position.y = -index * 0.21;
      link.rotation.y = index % 2 === 0 ? 0 : Math.PI / 2;
      this.chainPivot.add(link);
    }
    const weight = this.mesh(new THREE.OctahedronGeometry(0.22, 0), this.bellMaterial);
    weight.position.y = -2.3;
    this.chainPivot.add(weight);
    this.soundRing = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.0, 64),
      new THREE.MeshBasicMaterial({ color: elite ? 0xd29b5d : 0xb9824d, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    this.soundRing.rotation.x = -Math.PI / 2;
    this.soundRing.position.y = -0.78;
    this.soundRing.visible = false;
    this.root.add(this.soundRing);
    this.rig.scale.setScalar(elite ? 1.18 : 1.0);
  }

  fixedUpdate(delta: number, playerPosition: THREE.Vector3): void {
    this.syncFromBody();
    this.step.set(0, 0, 0);
    this.toPlayer.copy(playerPosition).sub(this.root.position).setY(0);
    const distance = this.toPlayer.length();
    if (distance > 0.001) this.toPlayer.multiplyScalar(1 / distance);
    const desiredYaw = Math.atan2(-this.toPlayer.x, -this.toPlayer.z);
    const turnSpeed = this.state === 'windup' ? 1.6 : this.state === 'active' ? 0.55 : 4.8;
    if (!['broken', 'executed', 'dead'].includes(this.state)) this.facingYaw = moveAngleTowards(this.facingYaw, desiredYaw, turnSpeed * delta);
    this.forward.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));

    if (this.state === 'dead' || this.state === 'executed') {
      this.stateTimer += delta;
    } else if (this.state === 'broken') {
      this.stateTimer += delta;
      if (this.stateTimer >= (this.elite ? 3.7 : 4.5)) {
        this.state = 'advance';
        this.stateTimer = -0.3;
        this.poise = this.maxPoise * 0.36;
      }
    } else if (this.state === 'dormant') {
      if (distance < (this.elite ? 16 : 13)) this.enterAdvance();
    } else if (this.state === 'stagger') {
      this.stateTimer += delta;
      if (this.stateTimer >= (this.elite ? 0.32 : 0.5)) this.enterAdvance(-0.2);
    } else if (this.state === 'advance') {
      this.stateTimer += delta;
      this.poise = Math.max(0, this.poise - delta * (this.elite ? 4.2 : 5.5));
      const desiredRange = this.elite ? 3.4 : 3.0;
      if (distance > desiredRange + 0.65) this.step.copy(this.toPlayer).multiplyScalar((this.elite ? 2.15 : 1.55) * delta);
      else if (distance < desiredRange - 0.65) this.step.copy(this.toPlayer).multiplyScalar(-0.9 * delta);
      if (this.attackAllowed && this.stateTimer > (this.elite ? 0.42 : 0.72) && distance < 5.1) {
        const sequence: readonly BellAttack[] = this.elite
          ? ['chainSweep', 'soundBurst', 'bellSlam', 'chainSweep', 'soundBurst']
          : ['bellSlam', 'chainSweep', 'soundBurst'];
        this.beginAttack(sequence[this.cycle % sequence.length] ?? 'bellSlam');
      }
    } else {
      const profile = NORMAL_ATTACKS[this.attack];
      this.stateTimer += delta;
      if (this.state === 'windup') {
        if (this.stateTimer >= profile.windup * (this.elite ? 0.88 : 1)) {
          this.state = 'active';
          this.stateTimer = 0;
          this.emitPulse(profile);
          this.audio.swing(profile.weight);
        }
      } else if (this.state === 'active') {
        if (this.attack === 'bellSlam') this.step.copy(this.forward).multiplyScalar(1.15 * delta);
        if (this.stateTimer >= profile.active) {
          this.state = 'recovery';
          this.stateTimer = 0;
        }
      } else if (this.state === 'recovery' && this.stateTimer >= profile.recovery * (this.elite ? 0.78 : 1)) {
        this.enterAdvance(-0.18);
        this.pulseEmitted = false;
      }
    }

    this.step.addScaledVector(this.impactVelocity, delta);
    this.impactVelocity.multiplyScalar(Math.exp(-8.5 * delta));
    this.applyMovement(delta);
  }

  updateVisual(delta: number): void {
    this.syncFromBody();
    this.visualTime += delta;
    this.hitFlash = Math.max(0, this.hitFlash - delta * 4.5);
    const broken = this.state === 'broken' ? 0.34 + Math.sin(this.visualTime * 11) * 0.15 : 0;
    this.armorMaterial.emissive.setRGB(this.hitFlash * 0.68 + broken, this.hitFlash * 0.1, this.hitFlash * 0.04);
    this.bellMaterial.emissiveIntensity = 0.24 + (this.state === 'windup' ? 1.4 : 0) + (this.elite ? 0.35 : 0);
    this.eyeMaterial.emissiveIntensity = 1.55 + Math.sin(this.visualTime * 2.7) * 0.22 + (this.state === 'windup' ? 1.0 : 0);

    let bellX = -0.25;
    let bellZ = -0.3;
    let chainZ = 0.2;
    let torsoX = 0;
    let torsoY = 0;
    if (this.state === 'advance') {
      this.gait += delta * 4.1;
      torsoX = 0.04 + Math.sin(this.gait) * 0.035;
      bellZ = -0.3 + Math.sin(this.gait) * 0.12;
      chainZ = 0.2 - Math.sin(this.gait) * 0.16;
    } else if (this.state === 'windup' || this.state === 'active' || this.state === 'recovery') {
      const p = this.attackProgress();
      if (this.attack === 'bellSlam') {
        const slam = THREE.MathUtils.smoothstep(p, 0.36, 0.62);
        bellX = THREE.MathUtils.lerp(-2.45, 0.78, slam);
        torsoX = THREE.MathUtils.lerp(-0.22, 0.52, slam);
      } else if (this.attack === 'soundBurst') {
        const ring = Math.sin(THREE.MathUtils.clamp(p * 1.25, 0, 1) * Math.PI);
        bellX = -1.3 + ring * 0.5;
        bellZ = ring * 0.8;
        torsoX = -0.1;
      } else {
        const sweep = THREE.MathUtils.smoothstep(p, 0.3, 0.65);
        chainZ = THREE.MathUtils.lerp(-1.4, 1.45, sweep);
        torsoY = THREE.MathUtils.lerp(-0.65, 0.72, sweep);
        bellX = -0.8;
      }
    } else if (this.state === 'stagger') {
      torsoX = -0.42;
      bellX = 0.5;
      chainZ = -0.7;
    } else if (this.state === 'broken') {
      torsoX = 0.72;
      bellX = 1.0;
      chainZ = -1.0;
    } else if (this.state === 'executed') {
      torsoX = 0.95;
      bellX = 0.75;
    } else if (this.state === 'dead') {
      torsoX = 1.32;
      bellX = 0.8;
      this.rig.position.y = Math.max(-1.12, this.rig.position.y - delta * 0.48);
    }
    const settle = 1 - Math.exp(-14 * delta);
    this.bellPivot.rotation.x = THREE.MathUtils.lerp(this.bellPivot.rotation.x, bellX, settle);
    this.bellPivot.rotation.z = THREE.MathUtils.lerp(this.bellPivot.rotation.z, bellZ, settle);
    this.chainPivot.rotation.z = THREE.MathUtils.lerp(this.chainPivot.rotation.z, chainZ, settle);
    this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, torsoX, settle);
    this.torso.rotation.y = THREE.MathUtils.lerp(this.torso.rotation.y, torsoY, settle);
    for (let index = 0; index < this.cloakPanels.length; index += 1) {
      const panel = this.cloakPanels[index];
      if (panel) panel.rotation.x = 0.08 + Math.sin(this.visualTime * 2.2 + index * 0.7) * 0.035 + (this.state === 'active' ? 0.18 : 0);
    }
    const ringMaterial = this.soundRing.material as THREE.MeshBasicMaterial;
    const ringActive = this.attack === 'soundBurst' && (this.state === 'windup' || this.state === 'active' || this.state === 'recovery');
    this.soundRing.visible = ringActive;
    if (ringActive) {
      const progress = this.attackProgress();
      const scale = THREE.MathUtils.lerp(0.45, this.elite ? 5.2 : 4.5, THREE.MathUtils.smoothstep(progress, 0.34, 0.76));
      this.soundRing.scale.setScalar(scale);
      ringMaterial.opacity = Math.sin(Math.min(1, progress * 1.18) * Math.PI) * (this.elite ? 0.5 : 0.38);
      this.soundRing.rotation.z += delta * 0.35;
    } else {
      ringMaterial.opacity = 0;
    }
    this.root.rotation.y = this.facingYaw;
  }

  consumeAttackPulse(): AttackPulse | null { const pulse = this.pendingPulse; this.pendingPulse = null; return pulse; }
  getPosition(target: THREE.Vector3): THREE.Vector3 { return target.copy(this.root.position); }
  isActive(): boolean { return this.state !== 'dead'; }
  isCommittedAttack(): boolean { return this.state === 'windup' || this.state === 'active' || this.state === 'recovery'; }
  setAttackAllowed(allowed: boolean): void { this.attackAllowed = allowed; }

  getLockSnapshot(): LockTargetSnapshot {
    this.lockPoint.copy(this.root.position).add(new THREE.Vector3(0, this.elite ? 1.42 : 1.2, 0));
    return { name: this.displayName, position: this.lockPoint.clone(), healthRatio: this.health / this.maxHealth, poiseRatio: THREE.MathUtils.clamp(this.poise / this.maxPoise, 0, 1), executable: this.state === 'broken', active: this.state !== 'dead' };
  }

  receiveParry(): EnemyDamageResult {
    if (!this.isActive() || this.state === 'executed') return 'ignored';
    this.poise += this.maxPoise * (this.elite ? 0.55 : 0.85);
    this.pendingPulse = null;
    return this.checkBreak(!this.elite);
  }

  receiveDamage(damage: number, poiseDamage: number, impactDirection: THREE.Vector3): EnemyDamageResult {
    if (!this.isActive() || this.state === 'executed') return 'ignored';
    this.health = Math.max(0, this.health - damage);
    this.poise += poiseDamage * (this.elite ? 0.78 : 1);
    this.hitFlash = 1;
    const push = this.scratch.copy(impactDirection).setY(0);
    if (push.lengthSq() > 0.001) this.impactVelocity.add(push.normalize().multiplyScalar(THREE.MathUtils.clamp(0.7 + damage * 0.012, 0.8, this.elite ? 1.45 : 2.0)));
    if (this.health <= 0) {
      this.state = 'dead'; this.stateTimer = 0; this.pendingPulse = null; return 'killed';
    }
    return this.checkBreak(damage >= (this.elite ? 78 : 55));
  }

  isExecutable(playerPosition: THREE.Vector3): boolean { return this.state === 'broken' && this.root.position.distanceToSquared(playerPosition) <= (this.elite ? 2.75 : 2.45) ** 2; }
  beginExecution(): void { if (this.state === 'broken') { this.state = 'executed'; this.stateTimer = 0; this.pendingPulse = null; } }
  finishExecution(): void { if (this.state === 'executed') { this.health = 0; this.state = 'dead'; this.stateTimer = 0; } }

  reset(): void {
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.body.setNextKinematicTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
    this.root.position.copy(this.spawn); this.root.rotation.set(0, 0, 0); this.rig.position.set(0, 0, 0);
    this.state = 'dormant'; this.attack = 'bellSlam'; this.stateTimer = 0; this.cycle = 0;
    this.health = this.maxHealth; this.poise = 0; this.pendingPulse = null; this.pulseEmitted = false;
    this.hitFlash = 0; this.impactVelocity.set(0, 0, 0); this.facingYaw = 0; this.verticalVelocity = 0; this.grounded = false; this.attackAllowed = true;
  }

  private enterAdvance(timer = 0): void { this.state = 'advance'; this.stateTimer = timer; }
  private beginAttack(attack: BellAttack): void { this.attack = attack; this.cycle += 1; this.state = 'windup'; this.stateTimer = 0; this.pulseEmitted = false; this.audio.enemyTell(NORMAL_ATTACKS[attack].weight); }
  private attackProgress(): number { const p = NORMAL_ATTACKS[this.attack]; const total = p.windup + p.active + p.recovery; const elapsed = this.state === 'windup' ? this.stateTimer : this.state === 'active' ? p.windup + this.stateTimer : p.windup + p.active + this.stateTimer; return THREE.MathUtils.clamp(elapsed / total, 0, 1); }

  private emitPulse(profile: BellProfile): void {
    if (this.pulseEmitted) return;
    this.pendingPulse = { source: 'enemy', position: this.root.position.clone().add(new THREE.Vector3(0, 0.88, 0)).addScaledVector(this.forward, this.attack === 'soundBurst' ? 0 : 0.45), forward: this.forward.clone(), range: profile.range * (this.elite ? 1.08 : 1), arcCos: profile.arcCos, damage: profile.damage * (this.elite ? 1.12 : 1), poiseDamage: profile.poiseDamage * (this.elite ? 1.18 : 1), impact: profile.impact * (this.elite ? 1.12 : 1), weight: profile.weight };
    this.pulseEmitted = true;
  }

  private checkBreak(force: boolean): EnemyDamageResult {
    if (this.poise >= this.maxPoise || force) { this.state = 'broken'; this.stateTimer = 0; this.poise = this.maxPoise; this.pendingPulse = null; return 'broken'; }
    this.state = 'stagger'; this.stateTimer = 0; this.pendingPulse = null; return 'hit';
  }

  private applyMovement(delta: number): void {
    if (this.grounded) this.verticalVelocity = -2.7;
    else this.verticalVelocity = Math.max(-24, this.verticalVelocity - 26 * delta);
    this.controller.computeColliderMovement(this.collider, { x: this.step.x, y: this.verticalVelocity * delta, z: this.step.z });
    const corrected = this.controller.computedMovement();
    const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + corrected.x, y: p.y + corrected.y, z: p.z + corrected.z });
    this.grounded = this.controller.computedGrounded();
  }

  private syncFromBody(): void { const p = this.body.translation(); this.root.position.set(p.x, p.y, p.z); }
  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh { const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }
}

function shortestAngle(angle: number): number { return Math.atan2(Math.sin(angle), Math.cos(angle)); }
function moveAngleTowards(current: number, target: number, maxDelta: number): number { return current + THREE.MathUtils.clamp(shortestAngle(target - current), -maxDelta, maxDelta); }
