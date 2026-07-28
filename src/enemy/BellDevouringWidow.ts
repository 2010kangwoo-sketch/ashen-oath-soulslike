import * as THREE from 'three';
import RAPIER, {
  type Collider,
  type KinematicCharacterController,
  type RigidBody,
} from '@dimforge/rapier3d-compat';
import type { AudioDirector, SwingWeight } from '../audio/AudioDirector';
import type {
  AttackPulse,
  BossPresentationEvent,
  BossSnapshot,
  EnemyDamageResult,
  LockTargetSnapshot,
} from '../combat/CombatTypes';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { BossEnemy } from './BossEnemy';

type WidowState =
  | 'sealed'
  | 'intro'
  | 'stalk'
  | 'windup'
  | 'active'
  | 'recovery'
  | 'phaseBreak'
  | 'stagger'
  | 'dead';

type WidowAttackId =
  | 'ceilingDrop'
  | 'bodySweep'
  | 'silkLanes'
  | 'devouringChime'
  | 'threadLance'
  | 'scuttleDrops'
  | 'widowRush'
  | 'ruptureRing';

interface AttackTiming {
  readonly windup: number;
  readonly active: number;
  readonly recovery: number;
}

interface BellNode {
  readonly root: THREE.Group;
  readonly shell: THREE.Mesh;
  readonly ring: THREE.Mesh;
  readonly glow: THREE.PointLight;
  readonly position: THREE.Vector3;
  health: number;
  alive: boolean;
  pulse: number;
}

interface FallingShard {
  readonly mesh: THREE.Mesh;
  readonly velocity: THREE.Vector3;
  readonly spin: THREE.Vector3;
  life: number;
}

const ATTACKS: Record<WidowAttackId, AttackTiming> = {
  ceilingDrop: { windup: 1.46, active: 0.54, recovery: 0.92 },
  bodySweep: { windup: 0.7, active: 0.68, recovery: 0.78 },
  silkLanes: { windup: 1.28, active: 0.48, recovery: 0.96 },
  devouringChime: { windup: 1.72, active: 1.18, recovery: 1.05 },
  threadLance: { windup: 0.76, active: 0.34, recovery: 0.64 },
  scuttleDrops: { windup: 0.92, active: 1.62, recovery: 0.86 },
  widowRush: { windup: 0.5, active: 0.78, recovery: 0.72 },
  ruptureRing: { windup: 1.18, active: 0.58, recovery: 0.9 },
};

const ARENA_CENTER = new THREE.Vector3(0, 2.32, -151.5);
const GROUND_BODY_Y = 2.78;
const CEILING_BODY_Y = 11.4;
const BELL_MAX_HEALTH = 115;

export class BellDevouringWidow implements BossEnemy {
  readonly id = 'bell-devouring-widow';
  readonly displayName = '종을 삼킨 과부';
  readonly ashReward = 2600;
  readonly root = new THREE.Group();

  private readonly rig = new THREE.Group();
  private readonly abdomen = new THREE.Group();
  private readonly thorax = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly legs: THREE.Group[] = [];
  private readonly veilStrands: THREE.Mesh[] = [];
  private readonly silkTendrils: THREE.Mesh[] = [];
  private readonly arenaFx = new THREE.Group();
  private readonly laneTelegraphs: THREE.Mesh[] = [];
  private readonly bells: BellNode[] = [];
  private readonly shards: FallingShard[] = [];
  private readonly attackQueue: AttackPulse[] = [];
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly toPlayer = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly horizontalStep = new THREE.Vector3();
  private readonly impactVelocity = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly lockPoint = new THREE.Vector3();
  private readonly targetAnchor = new THREE.Vector3();
  private readonly lastBellHit = new THREE.Vector3();
  private readonly secondaryAnchor = new THREE.Vector3();
  private readonly spawn: THREE.Vector3;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly carapaceMaterial: THREE.MeshStandardMaterial;
  private readonly fleshMaterial: THREE.MeshStandardMaterial;
  private readonly silkMaterial: THREE.MeshStandardMaterial;
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly bellMaterial: THREE.MeshStandardMaterial;
  private readonly dropShadow: THREE.Mesh;
  private readonly ruptureDisc: THREE.Mesh;
  private readonly arenaRing: THREE.Mesh;
  private readonly maxHealth = 1640;
  private readonly maxPoise = 270;
  private health = this.maxHealth;
  private poise = 0;
  private phase: 1 | 2 = 1;
  private state: WidowState = 'sealed';
  private attack: WidowAttackId = 'ceilingDrop';
  private attackCycle = 0;
  private stateTimer = 0;
  private nextAttackEvent = 0;
  private facingYaw = Math.PI;
  private visualTime = 0;
  private verticalVelocity = 0;
  private grounded = false;
  private onCeiling = false;
  private attackAllowed = true;
  private hitFlash = 0;
  private phaseBreakTriggered = false;
  private presentationEvent: BossPresentationEvent | null = null;
  private mechanicName = '';
  private mechanicHint = '';
  private mechanicProgress = 0;
  private mechanicDanger = false;
  private highContrastTelegraphs = false;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    spawn: THREE.Vector3,
    private readonly audio: AudioDirector,
  ) {
    this.spawn = spawn.clone();
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.82, 0.88).setFriction(0),
      this.body,
    );
    this.controller = physics.world.createCharacterController(0.07);
    this.controller.enableAutostep(0.42, 0.26, false);
    this.controller.enableSnapToGround(0.34);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(43));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(49));
    this.controller.setSlideEnabled(true);
    this.collider.setEnabled(false);

    this.root.name = 'boss-bell-devouring-widow';
    this.root.position.copy(spawn);
    this.root.visible = false;
    this.root.add(this.rig);
    scene.add(this.root);

    this.arenaFx.name = 'widow-arena-combat-effects';
    scene.add(this.arenaFx);

    this.carapaceMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c2023,
      roughness: 0.34,
      metalness: 0.72,
      emissive: 0x120508,
      emissiveIntensity: 0.08,
    });
    this.fleshMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3034,
      roughness: 0.78,
      metalness: 0.02,
      emissive: 0x1c070b,
      emissiveIntensity: 0.16,
    });
    this.silkMaterial = new THREE.MeshStandardMaterial({
      color: 0xbab0a3,
      roughness: 0.58,
      metalness: 0.08,
      emissive: 0x2d2220,
      emissiveIntensity: 0.24,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    });
    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf1b16d,
      emissive: 0xc44725,
      emissiveIntensity: 3.2,
      roughness: 0.2,
    });
    this.bellMaterial = new THREE.MeshStandardMaterial({
      color: 0x8f704a,
      roughness: 0.31,
      metalness: 0.9,
      emissive: 0x4a1d0e,
      emissiveIntensity: 0.48,
    });

    this.buildRig();
    this.buildArenaMechanics();

    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0xa63527,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.dropShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 64), shadowMaterial);
    this.dropShadow.rotation.x = -Math.PI / 2;
    this.dropShadow.position.set(0, 1.235, -151.5);
    this.dropShadow.visible = false;
    this.arenaFx.add(this.dropShadow);

    this.ruptureDisc = new THREE.Mesh(new THREE.RingGeometry(2.4, 8.6, 96), shadowMaterial.clone());
    this.ruptureDisc.rotation.x = -Math.PI / 2;
    this.ruptureDisc.position.set(0, 1.24, -151.5);
    this.ruptureDisc.visible = false;
    this.arenaFx.add(this.ruptureDisc);

    this.arenaRing = new THREE.Mesh(new THREE.RingGeometry(11.7, 12.0, 96), shadowMaterial.clone());
    this.arenaRing.rotation.x = -Math.PI / 2;
    this.arenaRing.position.set(0, 1.25, -151.5);
    this.arenaRing.visible = false;
    this.arenaFx.add(this.arenaRing);
  }


  setHighContrastTelegraphs(enabled: boolean): void {
    this.highContrastTelegraphs = enabled;
    const danger = enabled ? 0xff4f38 : 0xa63527;
    (this.dropShadow.material as THREE.MeshBasicMaterial).color.setHex(danger);
    (this.ruptureDisc.material as THREE.MeshBasicMaterial).color.setHex(danger);
    (this.arenaRing.material as THREE.MeshBasicMaterial).color.setHex(enabled ? 0xffe089 : danger);
    for (const lane of this.laneTelegraphs) {
      (lane.material as THREE.MeshBasicMaterial).color.setHex(enabled ? 0xffffff : 0xd7b6a2);
    }
  }

  activateEncounter(): void {
    if (this.state !== 'sealed' || this.health <= 0) return;
    this.root.visible = true;
    this.collider.setEnabled(true);
    this.state = 'intro';
    this.stateTimer = 0;
    this.presentationEvent = 'intro';
    this.audio.bossIntro();
    this.audio.widowChime(true);
    this.bells.forEach((bell) => { bell.root.visible = true; });
  }

  abortEncounter(): void {
    if (this.state === 'sealed' || this.state === 'dead') return;
    this.resetEncounter();
  }

  resetEncounter(): void {
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.body.setNextKinematicTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
    this.root.position.copy(this.spawn);
    this.root.rotation.set(0, Math.PI, 0);
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.health = this.maxHealth;
    this.poise = 0;
    this.phase = 1;
    this.state = 'sealed';
    this.attack = 'ceilingDrop';
    this.attackCycle = 0;
    this.stateTimer = 0;
    this.nextAttackEvent = 0;
    this.facingYaw = Math.PI;
    this.verticalVelocity = 0;
    this.grounded = false;
    this.onCeiling = false;
    this.attackAllowed = true;
    this.impactVelocity.set(0, 0, 0);
    this.attackQueue.length = 0;
    this.hitFlash = 0;
    this.phaseBreakTriggered = false;
    this.presentationEvent = null;
    this.mechanicName = '';
    this.mechanicHint = '';
    this.mechanicProgress = 0;
    this.mechanicDanger = false;
    this.root.visible = false;
    this.collider.setEnabled(false);
    this.dropShadow.visible = false;
    this.ruptureDisc.visible = false;
    this.arenaRing.visible = false;
    this.laneTelegraphs.forEach((lane) => { lane.visible = false; });
    this.bells.forEach((bell) => {
      bell.health = BELL_MAX_HEALTH;
      bell.alive = true;
      bell.pulse = 0;
      bell.root.visible = true;
      bell.shell.visible = true;
      bell.ring.visible = true;
      bell.glow.intensity = 5;
    });
    for (const shard of this.shards) shard.mesh.removeFromParent();
    this.shards.length = 0;
  }

  keepDefeated(): void {
    this.state = 'dead';
    this.health = 0;
    this.root.visible = true;
    this.collider.setEnabled(false);
    this.attackQueue.length = 0;
    this.bells.forEach((bell) => { bell.root.visible = false; });
  }

  fixedUpdate(delta: number, playerPosition: THREE.Vector3): void {
    if (this.state === 'sealed') return;
    this.syncRootFromBody();
    this.horizontalStep.set(0, 0, 0);
    this.toPlayer.copy(playerPosition).sub(this.root.position).setY(0);
    const distance = this.toPlayer.length();
    if (distance > 0.001) this.toPlayer.multiplyScalar(1 / distance);
    const desiredYaw = Math.atan2(-this.toPlayer.x, -this.toPlayer.z);
    const turnRate = this.state === 'active' ? 1.4 : this.phase === 2 ? 5.5 : 4.2;
    if (this.state !== 'phaseBreak' && this.state !== 'stagger' && this.state !== 'dead') {
      this.facingYaw = moveAngleTowards(this.facingYaw, desiredYaw, delta * turnRate);
    }
    this.forward.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));

    if (this.state === 'dead') {
      this.stateTimer += delta;
    } else if (this.state === 'intro') {
      this.stateTimer += delta;
      this.moveCeiling(delta, ARENA_CENTER.x, CEILING_BODY_Y, ARENA_CENTER.z - 1.5, 4.5);
      if (this.stateTimer >= 2.75) {
        this.state = 'stalk';
        this.stateTimer = -0.35;
        this.onCeiling = true;
      }
    } else if (this.state === 'phaseBreak') {
      this.stateTimer += delta;
      this.horizontalStep.set(0, 0, 0);
      if (!this.phaseBreakTriggered && this.stateTimer >= 0.82) {
        this.phaseBreakTriggered = true;
        this.phase = 2;
        this.onCeiling = false;
        this.breakRemainingBells();
        this.presentationEvent = 'phase2';
        this.audio.bossPhase();
        this.audio.silkSnap(true);
      }
      if (this.stateTimer >= 2.55) {
        this.poise = 0;
        this.state = 'stalk';
        this.stateTimer = -0.28;
      }
    } else if (this.state === 'stagger') {
      this.stateTimer += delta;
      this.poise = Math.max(0, this.poise - delta * 16);
      if (this.stateTimer >= (this.phase === 2 ? 1.35 : 1.05)) {
        this.state = 'stalk';
        this.stateTimer = -0.38;
      }
    } else if (this.state === 'stalk') {
      this.stateTimer += delta;
      this.poise = Math.max(0, this.poise - delta * (this.phase === 2 ? 9 : 6));
      if (this.onCeiling) {
        const orbit = this.visualTime * (this.phase === 2 ? 0.58 : 0.42) + this.attackCycle * 0.7;
        const x = ARENA_CENTER.x + Math.sin(orbit) * 7.6;
        const z = ARENA_CENTER.z + Math.cos(orbit * 0.91) * 6.8;
        this.moveCeiling(delta, x, CEILING_BODY_Y, z, this.phase === 2 ? 6.4 : 4.8);
      } else {
        const preferred = this.phase === 1 ? 4.2 : 3.5;
        if (distance > preferred) {
          this.side.set(this.toPlayer.z, 0, -this.toPlayer.x);
          const strafe = Math.sin(this.visualTime * 1.6) * (this.phase === 2 ? 0.55 : 0.34);
          this.horizontalStep.copy(this.toPlayer).addScaledVector(this.side, strafe).normalize()
            .multiplyScalar((this.phase === 2 ? 3.65 : 2.65) * delta);
        }
      }
      if (this.stateTimer >= 0 && this.attackAllowed) this.chooseAttack(distance, playerPosition);
    } else {
      this.updateAttack(delta, playerPosition);
    }

    if (!this.onCeiling) {
      this.horizontalStep.addScaledVector(this.impactVelocity, delta);
      this.impactVelocity.multiplyScalar(Math.exp(-8 * delta));
      this.applyGroundMovement(delta);
    }
  }

  updateVisual(delta: number): void {
    if (this.state === 'sealed') return;
    this.syncRootFromBody();
    this.visualTime += delta;
    this.hitFlash = Math.max(0, this.hitFlash - delta * 4.5);
    const phasePulse = this.phase === 2 ? 0.34 + Math.sin(this.visualTime * 5.8) * 0.12 : 0.08;
    this.carapaceMaterial.emissive.setRGB(this.hitFlash * 0.65 + phasePulse * 0.38, this.hitFlash * 0.05, this.hitFlash * 0.08 + phasePulse * 0.2);
    this.fleshMaterial.emissiveIntensity = 0.15 + this.hitFlash * 0.7 + phasePulse;
    this.eyeMaterial.emissiveIntensity = 2.8 + Math.sin(this.visualTime * 7.2) * 0.45 + (this.state === 'windup' ? 1.6 : 0);
    this.updatePose(delta);
    this.updateTelegraphs();
    this.updateBells(delta);
    this.updateShards(delta);
    this.root.rotation.y = this.facingYaw;
  }

  consumeAttackPulse(): AttackPulse | null {
    return this.attackQueue.shift() ?? null;
  }

  getLockSnapshot(): LockTargetSnapshot {
    const height = this.onCeiling ? -1.1 : 1.15;
    this.lockPoint.copy(this.root.position).add(new THREE.Vector3(0, height, 0));
    return {
      name: this.displayName,
      position: this.lockPoint.clone(),
      healthRatio: this.health / this.maxHealth,
      poiseRatio: THREE.MathUtils.clamp(this.poise / this.maxPoise, 0, 1),
      executable: false,
      active: this.state !== 'sealed' && this.state !== 'dead',
    };
  }

  getBossSnapshot(): BossSnapshot {
    const bellRatio = this.bells.reduce((sum, bell) => sum + Math.max(0, bell.health), 0) / (BELL_MAX_HEALTH * this.bells.length);
    return {
      name: this.displayName,
      epithet: this.phase === 1 ? '공허한 종루의 포식자' : '끊어진 종의 어머니',
      healthRatio: this.health / this.maxHealth,
      poiseRatio: THREE.MathUtils.clamp(this.poise / this.maxPoise, 0, 1),
      shieldRatio: this.phase === 1 ? bellRatio : 0,
      phase: this.phase,
      active: this.state !== 'sealed' && this.state !== 'dead',
      intro: this.state === 'intro',
      phaseTransition: this.state === 'phaseBreak',
      defeated: this.state === 'dead',
      phaseLabel: this.phase === 1 ? 'I · 매달린 종' : 'II · 끊어진 자장가',
      secondaryLabel: '매달린 종',
      transitionKicker: '종이 끊어졌습니다',
      transitionTitle: '끊어진 종의 어머니',
      victoryKicker: '공허한 종루가 침묵합니다',
      victoryTitle: '과부 격파',
      mechanicName: this.mechanicName || undefined,
      mechanicHint: this.mechanicHint || undefined,
      mechanicProgress: this.mechanicName ? this.mechanicProgress : undefined,
      mechanicDanger: this.mechanicDanger,
    };
  }

  consumePresentationEvent(): BossPresentationEvent | null {
    const event = this.presentationEvent;
    this.presentationEvent = null;
    return event;
  }

  getPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.root.position);
  }

  isActive(): boolean {
    return this.state !== 'sealed' && this.state !== 'dead';
  }

  isEncounterActive(): boolean {
    return this.isActive();
  }

  isDefeated(): boolean {
    return this.state === 'dead';
  }

  isCommittedAttack(): boolean {
    return this.state === 'windup' || this.state === 'active' || this.state === 'recovery' || this.state === 'phaseBreak';
  }

  setAttackAllowed(allowed: boolean): void {
    this.attackAllowed = allowed;
  }

  receiveParry(): EnemyDamageResult {
    if (!this.isActive() || this.onCeiling || this.state === 'intro' || this.state === 'phaseBreak') return 'ignored';
    this.poise += this.phase === 1 ? 34 : 52;
    this.hitFlash = 0.75;
    this.attackQueue.length = 0;
    this.state = 'stagger';
    this.stateTimer = 0;
    if (this.poise >= this.maxPoise) {
      this.poise = this.maxPoise;
      return 'broken';
    }
    return 'hit';
  }

  receiveDamage(damage: number, poiseDamage: number, impactDirection: THREE.Vector3): EnemyDamageResult {
    if (!this.isActive() || this.onCeiling || this.state === 'intro' || this.state === 'phaseBreak') return 'ignored';
    const aliveBells = this.bells.filter((bell) => bell.alive).length;
    const protection = this.phase === 1 ? 0.58 + (3 - aliveBells) * 0.12 : 1;
    this.health = Math.max(0, this.health - damage * protection);
    this.poise += poiseDamage * (this.phase === 1 ? 0.72 : 1);
    this.hitFlash = 1;
    this.impactVelocity.addScaledVector(this.scratch.copy(impactDirection).setY(0).normalize(), damage * 0.0035);

    if (this.health <= 0) {
      this.state = 'dead';
      this.stateTimer = 0;
      this.attackQueue.length = 0;
      this.collider.setEnabled(false);
      this.mechanicName = '';
      this.presentationEvent = 'defeated';
      this.audio.bossDefeat();
      return 'killed';
    }
    if (this.phase === 1 && (this.health <= this.maxHealth * 0.55 || aliveBells === 0)) {
      this.beginPhaseBreak();
      return 'broken';
    }
    if (this.poise >= this.maxPoise) {
      this.poise = this.maxPoise;
      this.state = 'stagger';
      this.stateTimer = 0;
      this.attackQueue.length = 0;
      return 'broken';
    }
    return 'hit';
  }

  tryHitBell(pulse: AttackPulse): EnemyDamageResult | null {
    if (!this.isActive() || this.phase !== 1) return null;
    for (const bell of this.bells) {
      if (!bell.alive) continue;
      this.toPlayer.copy(bell.position).sub(pulse.position);
      const vertical = Math.abs(this.toPlayer.y);
      this.toPlayer.setY(0);
      const distance = this.toPlayer.length();
      if (distance > pulse.range + 0.55 || vertical > 2.6 || distance < 0.001) continue;
      this.toPlayer.multiplyScalar(1 / distance);
      if (pulse.forward.dot(this.toPlayer) < pulse.arcCos) continue;
      this.lastBellHit.copy(bell.position).add(new THREE.Vector3(0, 0.35, 0));
      bell.health = Math.max(0, bell.health - pulse.damage - pulse.poiseDamage * 0.42);
      bell.pulse = 1;
      if (bell.health <= 0) {
        this.breakBell(bell);
        if (this.bells.every((node) => !node.alive)) this.beginPhaseBreak();
        return 'broken';
      }
      return 'hit';
    }
    return null;
  }

  getLastBellHitPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.lastBellHit);
  }

  isExecutable(_playerPosition: THREE.Vector3): boolean { return false; }
  beginExecution(): void {}
  finishExecution(): void {}
  reset(): void { this.resetEncounter(); }

  private buildRig(): void {
    this.rig.scale.setScalar(1.12);
    const abdomenMesh = this.mesh(new THREE.SphereGeometry(1.25, 18, 12), this.carapaceMaterial);
    abdomenMesh.scale.set(1.22, 0.84, 1.55);
    abdomenMesh.position.set(0, 0.4, 0.65);
    this.abdomen.add(abdomenMesh);
    for (let index = 0; index < 5; index += 1) {
      const plate = this.mesh(new THREE.TorusGeometry(0.72 + index * 0.1, 0.08, 8, 24, Math.PI * 1.45), this.carapaceMaterial);
      plate.rotation.set(Math.PI / 2, 0, Math.PI * 0.28);
      plate.position.set(0, 0.5 + index * 0.05, 0.25 + index * 0.28);
      this.abdomen.add(plate);
    }
    this.rig.add(this.abdomen);

    this.thorax.position.set(0, 1.05, -0.15);
    const torso = this.mesh(new THREE.CylinderGeometry(0.52, 0.72, 1.4, 10), this.fleshMaterial);
    torso.scale.z = 0.78;
    this.thorax.add(torso);
    const breastplate = this.mesh(new THREE.ConeGeometry(0.77, 1.3, 8, 1, true), this.carapaceMaterial);
    breastplate.rotation.z = Math.PI;
    breastplate.position.y = 0.05;
    this.thorax.add(breastplate);
    this.rig.add(this.thorax);

    this.head.position.set(0, 2.0, -0.38);
    const face = this.mesh(new THREE.SphereGeometry(0.43, 14, 10), this.fleshMaterial);
    face.scale.set(0.8, 1.15, 0.72);
    this.head.add(face);
    const mask = this.mesh(new THREE.ConeGeometry(0.45, 0.9, 7, 1, true), this.carapaceMaterial);
    mask.rotation.x = Math.PI / 2;
    mask.position.set(0, -0.02, -0.36);
    this.head.add(mask);
    for (let index = 0; index < 6; index += 1) {
      const eye = this.mesh(new THREE.SphereGeometry(0.055, 8, 6), this.eyeMaterial);
      eye.position.set((index % 2 ? 1 : -1) * (0.12 + Math.floor(index / 2) * 0.06), 0.14 - Math.floor(index / 2) * 0.13, -0.36);
      this.head.add(eye);
    }
    this.thorax.add(this.head);

    for (const side of [-1, 1]) {
      for (let index = 0; index < 2; index += 1) {
        const shoulder = new THREE.Group();
        shoulder.position.set(side * (0.58 + index * 0.08), 0.45 - index * 0.45, -0.05);
        const upper = this.mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 7), this.fleshMaterial);
        upper.position.y = -0.42;
        shoulder.add(upper);
        const claw = this.mesh(new THREE.ConeGeometry(0.15, 0.72, 6), this.carapaceMaterial);
        claw.position.set(0, -1.05, -0.18);
        claw.rotation.x = -0.42;
        shoulder.add(claw);
        this.thorax.add(shoulder);
        this.arms.push(shoulder);
      }
    }

    for (let index = 0; index < 8; index += 1) {
      const side = index < 4 ? -1 : 1;
      const local = index % 4;
      const hip = new THREE.Group();
      hip.position.set(side * (0.72 + local * 0.1), 0.3 - local * 0.08, 0.18 + local * 0.36);
      hip.rotation.y = side * (0.55 + local * 0.18);
      const upper = this.mesh(new THREE.CylinderGeometry(0.13, 0.19, 1.55, 7), this.carapaceMaterial);
      upper.position.y = -0.68;
      upper.rotation.z = side * 0.55;
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.set(side * 0.72, -1.22, 0);
      const lower = this.mesh(new THREE.CylinderGeometry(0.08, 0.13, 1.55, 7), this.carapaceMaterial);
      lower.position.set(side * 0.48, -0.63, 0);
      lower.rotation.z = side * 0.72;
      knee.add(lower);
      const tip = new THREE.Group();
      tip.position.set(side * 0.9, -1.2, 0);
      const spike = this.mesh(new THREE.ConeGeometry(0.11, 0.8, 6), this.carapaceMaterial);
      spike.rotation.z = side * Math.PI / 2;
      spike.position.x = side * 0.34;
      tip.add(spike);
      knee.add(tip);
      hip.add(knee);
      this.rig.add(hip);
      this.legs.push(hip);
    }

    for (let index = 0; index < 18; index += 1) {
      const strand = this.mesh(new THREE.CylinderGeometry(0.018, 0.045, 1.5 + (index % 4) * 0.25, 5), this.silkMaterial.clone());
      const angle = (index / 18) * Math.PI * 2;
      strand.position.set(Math.sin(angle) * 0.42, 1.72, -0.1 + Math.cos(angle) * 0.36);
      strand.rotation.z = Math.sin(angle) * 0.26;
      strand.rotation.x = Math.cos(angle) * 0.25;
      strand.userData.phase = angle;
      this.rig.add(strand);
      this.veilStrands.push(strand);
    }
    for (let index = 0; index < 10; index += 1) {
      const tendril = this.mesh(new THREE.CylinderGeometry(0.015, 0.05, 2.4 + (index % 3) * 0.45, 5), this.silkMaterial.clone());
      const angle = (index / 10) * Math.PI * 2;
      tendril.position.set(Math.sin(angle) * 0.92, 0.85, 0.55 + Math.cos(angle) * 0.7);
      tendril.rotation.z = Math.sin(angle) * 0.55;
      tendril.rotation.x = Math.cos(angle) * 0.48;
      tendril.userData.phase = angle;
      this.rig.add(tendril);
      this.silkTendrils.push(tendril);
    }
  }

  private buildArenaMechanics(): void {
    const positions = [
      new THREE.Vector3(-8.2, 2.7, -147.6),
      new THREE.Vector3(8.2, 2.7, -147.6),
      new THREE.Vector3(0, 2.7, -160.2),
    ];
    positions.forEach((position, index) => {
      const root = new THREE.Group();
      root.name = `widow-breakable-bell-${index + 1}`;
      root.position.copy(position);
      const shell = this.mesh(new THREE.CylinderGeometry(0.56, 1.05, 1.55, 16, 1, true), this.bellMaterial.clone());
      shell.position.y = 0.35;
      root.add(shell);
      const ring = this.mesh(new THREE.TorusGeometry(1.05, 0.12, 8, 28), this.bellMaterial.clone());
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.45;
      root.add(ring);
      const crown = this.mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 18), this.carapaceMaterial);
      crown.position.y = 1.25;
      crown.rotation.x = Math.PI / 2;
      root.add(crown);
      const glow = new THREE.PointLight(0xc36f43, 5, 9, 1.5);
      glow.position.y = 0.25;
      root.add(glow);
      this.arenaFx.add(root);
      this.bells.push({ root, shell, ring, glow, position: position.clone(), health: BELL_MAX_HEALTH, alive: true, pulse: 0 });
    });

    const laneMaterial = new THREE.MeshBasicMaterial({
      color: 0xd7b6a2,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let index = 0; index < 5; index += 1) {
      const lane = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.035, 27), laneMaterial.clone());
      lane.position.set(0, 1.27, -151.5);
      lane.rotation.y = (index - 2) * 0.48;
      lane.visible = false;
      lane.userData.index = index;
      this.arenaFx.add(lane);
      this.laneTelegraphs.push(lane);
    }
  }

  private chooseAttack(distance: number, playerPosition: THREE.Vector3): void {
    const phaseOne: WidowAttackId[] = ['ceilingDrop', 'silkLanes', 'bodySweep', 'devouringChime'];
    const phaseTwo: WidowAttackId[] = ['scuttleDrops', 'threadLance', 'widowRush', 'ruptureRing', 'silkLanes'];
    const table = this.phase === 1 ? phaseOne : phaseTwo;
    let selected = table[this.attackCycle % table.length]!;
    if (!this.onCeiling && distance > 7 && this.phase === 1) selected = 'ceilingDrop';
    if (this.onCeiling && selected === 'bodySweep') selected = 'ceilingDrop';
    if (!this.onCeiling && selected === 'scuttleDrops') this.onCeiling = true;
    this.attackCycle += 1;
    this.beginAttack(selected, playerPosition);
  }

  private beginAttack(attack: WidowAttackId, playerPosition: THREE.Vector3): void {
    this.attack = attack;
    this.state = 'windup';
    this.stateTimer = 0;
    this.nextAttackEvent = 0;
    this.targetAnchor.copy(playerPosition).setY(1.24);
    this.secondaryAnchor.copy(playerPosition).setY(1.24);
    this.mechanicDanger = true;
    if (attack === 'ceilingDrop' || attack === 'scuttleDrops') {
      this.onCeiling = true;
      this.collider.setEnabled(false);
    }
    if (attack === 'ceilingDrop') {
      this.mechanicName = '낙하 그림자';
      this.mechanicHint = '붉은 그림자 밖으로 빠져나가라';
    } else if (attack === 'silkLanes') {
      this.mechanicName = '절단의 실';
      this.mechanicHint = '빛나는 실선 사이의 빈틈을 찾아라';
    } else if (attack === 'devouringChime') {
      this.mechanicName = '종의 공명';
      this.mechanicHint = '울리는 종에서 멀어져라';
      this.audio.widowChime(false);
      this.audio.raidWarning();
    } else if (attack === 'scuttleDrops') {
      this.mechanicName = '세 번의 장송';
      this.mechanicHint = '그림자가 고정된 뒤 방향을 바꿔라';
    } else if (attack === 'ruptureRing') {
      this.mechanicName = '끊어진 자장가';
      this.mechanicHint = '과부에게 붙거나 바깥으로 벗어나라';
      this.audio.raidWarning();
    } else {
      this.mechanicName = '';
      this.mechanicHint = '';
      this.mechanicDanger = false;
    }
    this.audio.enemyTell(attack === 'devouringChime' || attack === 'ruptureRing' ? 'heavy' : 'medium');
  }

  private updateAttack(delta: number, playerPosition: THREE.Vector3): void {
    const profile = ATTACKS[this.attack];
    this.stateTimer += delta;
    const total = profile.windup + profile.active + profile.recovery;
    this.mechanicProgress = THREE.MathUtils.clamp(this.stateTimer / Math.max(0.001, profile.windup + profile.active), 0, 1);

    if (this.stateTimer < profile.windup) this.state = 'windup';
    else if (this.stateTimer < profile.windup + profile.active) this.state = 'active';
    else this.state = 'recovery';

    this.updateAttackMovement(delta, playerPosition, profile);
    this.emitAttackEvents(profile);

    if (this.stateTimer >= total) {
      this.state = 'stalk';
      this.stateTimer = this.phase === 2 ? -0.18 : -0.34;
      this.nextAttackEvent = 0;
      this.mechanicName = '';
      this.mechanicHint = '';
      this.mechanicProgress = 0;
      this.mechanicDanger = false;
      this.dropShadow.visible = false;
      this.ruptureDisc.visible = false;
      this.arenaRing.visible = false;
      this.laneTelegraphs.forEach((lane) => { lane.visible = false; });
      if (this.attack === 'ceilingDrop' || this.attack === 'scuttleDrops') {
        this.onCeiling = false;
        this.collider.setEnabled(true);
      }
    }
  }

  private updateAttackMovement(delta: number, playerPosition: THREE.Vector3, profile: AttackTiming): void {
    const activeTime = this.stateTimer - profile.windup;
    if (this.attack === 'ceilingDrop') {
      if (this.state === 'windup') {
        const track = THREE.MathUtils.clamp(this.stateTimer / (profile.windup * 0.62), 0, 1);
        if (track < 0.92) this.targetAnchor.lerp(playerPosition, 1 - Math.exp(-7 * delta));
        this.moveCeiling(delta, this.targetAnchor.x, CEILING_BODY_Y, this.targetAnchor.z, 8.5);
      } else if (this.state === 'active') {
        const t = THREE.MathUtils.clamp(activeTime / profile.active, 0, 1);
        const y = THREE.MathUtils.lerp(CEILING_BODY_Y, GROUND_BODY_Y, easeInCubic(t));
        this.moveCeiling(delta, this.targetAnchor.x, y, this.targetAnchor.z, 24);
        if (t > 0.72) this.collider.setEnabled(true);
      }
    } else if (this.attack === 'scuttleDrops') {
      const orbit = this.visualTime * 1.4;
      const x = THREE.MathUtils.clamp(playerPosition.x + Math.sin(orbit) * 4.4, -10.2, 10.2);
      const z = THREE.MathUtils.clamp(playerPosition.z + Math.cos(orbit) * 3.8, -162.3, -140.2);
      if (this.state !== 'recovery') this.moveCeiling(delta, x, CEILING_BODY_Y, z, 8.5);
      else {
        const t = THREE.MathUtils.clamp((this.stateTimer - profile.windup - profile.active) / profile.recovery, 0, 1);
        this.moveCeiling(delta, ARENA_CENTER.x, THREE.MathUtils.lerp(CEILING_BODY_Y, GROUND_BODY_Y, easeInOut(t)), ARENA_CENTER.z, 16);
        if (t > 0.75) this.collider.setEnabled(true);
      }
    } else if (this.attack === 'widowRush' && this.state === 'active') {
      this.horizontalStep.addScaledVector(this.forward, delta * 8.6);
    } else if (this.attack === 'bodySweep' && this.state === 'active') {
      this.horizontalStep.addScaledVector(this.forward, delta * 2.4);
    }
  }

  private emitAttackEvents(profile: AttackTiming): void {
    const activeTime = this.stateTimer - profile.windup;
    if (activeTime < 0) return;
    // Attack events are ordered by their active-window timestamp.
    const events: Array<{ time: number; fire: () => void }> = [];
    if (this.attack === 'ceilingDrop') {
      events.push({ time: 0.38, fire: () => this.queueRadial(this.targetAnchor, 4.7, 46, 74, 5.4, false, false) });
    } else if (this.attack === 'bodySweep') {
      events.push({ time: 0.08, fire: () => this.queueCone(3.9, -0.46, 31, 38, 2.8, 'heavy') });
      events.push({ time: 0.42, fire: () => this.queueCone(4.25, -0.58, 35, 43, 3.2, 'heavy') });
    } else if (this.attack === 'silkLanes') {
      for (let index = 0; index < 5; index += 1) {
        events.push({
          time: 0.08 + index * 0.055,
          fire: () => {
            const angle = (index - 2) * 0.48 + (this.phase === 2 ? 0.18 : 0);
            const direction = this.scratch.set(Math.sin(angle), 0, -Math.cos(angle));
            this.queueLine(ARENA_CENTER, direction, 27, 0.7, 34, 44, 3.2);
            this.audio.silkSnap(false);
          },
        });
      }
    } else if (this.attack === 'devouringChime') {
      this.bells.forEach((bell, index) => {
        if (!bell.alive) return;
        events.push({
          time: 0.14 + index * 0.18,
          fire: () => {
            this.queueRadial(bell.position, 6.4, 32, 36, 2.6, false, false);
            bell.pulse = 1;
            this.audio.widowChime(false);
      this.audio.raidWarning();
          },
        });
      });
    } else if (this.attack === 'threadLance') {
      events.push({ time: 0.06, fire: () => this.queueLine(this.root.position, this.forward, 12.5, 0.82, 36, 48, 3.6) });
    } else if (this.attack === 'scuttleDrops') {
      for (let index = 0; index < 3; index += 1) {
        events.push({
          time: 0.22 + index * 0.46,
          fire: () => {
            const offset = this.scratch.set(Math.sin(this.visualTime + index * 2.1), 0, Math.cos(this.visualTime * 0.8 + index * 1.7)).multiplyScalar(1.6);
            const point = this.secondaryAnchor.copy(this.targetAnchor).add(offset);
            this.queueRadial(point, 3.7, 30, 46, 3.7, false, false);
          },
        });
      }
    } else if (this.attack === 'widowRush') {
      events.push({ time: 0.2, fire: () => this.queueLine(this.root.position, this.forward, 7.2, 1.35, 39, 52, 4.1) });
    } else if (this.attack === 'ruptureRing') {
      events.push({ time: 0.1, fire: () => this.queueDonut(ARENA_CENTER, 9.6, 3.2, 44, 62, 4.8) });
    }

    while (this.nextAttackEvent < events.length && activeTime >= events[this.nextAttackEvent]!.time) {
      events[this.nextAttackEvent]!.fire();
      this.nextAttackEvent += 1;
    }
  }

  private queueCone(range: number, arcCos: number, damage: number, poiseDamage: number, impact: number, weight: SwingWeight): void {
    this.attackQueue.push({
      source: 'enemy',
      position: this.root.position.clone().add(new THREE.Vector3(0, 0.45, 0)),
      forward: this.forward.clone(),
      range,
      arcCos,
      damage,
      poiseDamage,
      impact,
      weight,
      guardable: true,
      parryable: true,
      shape: 'cone',
    });
  }

  private queueRadial(position: THREE.Vector3, range: number, damage: number, poiseDamage: number, impact: number, guardable: boolean, parryable: boolean): void {
    this.attackQueue.push({
      source: 'enemy',
      position: position.clone(),
      forward: this.forward.clone(),
      range,
      arcCos: -1,
      damage,
      poiseDamage,
      impact,
      weight: 'heavy',
      guardable,
      parryable,
      radial: true,
      shape: 'radial',
    });
  }

  private queueLine(position: THREE.Vector3, forward: THREE.Vector3, range: number, width: number, damage: number, poiseDamage: number, impact: number): void {
    this.attackQueue.push({
      source: 'enemy',
      position: position.clone().setY(1.7),
      forward: forward.clone().setY(0).normalize(),
      range,
      arcCos: -1,
      damage,
      poiseDamage,
      impact,
      weight: 'heavy',
      guardable: false,
      parryable: false,
      shape: 'line',
      width,
    });
  }

  private queueDonut(position: THREE.Vector3, range: number, innerRange: number, damage: number, poiseDamage: number, impact: number): void {
    this.attackQueue.push({
      source: 'enemy',
      position: position.clone(),
      forward: this.forward.clone(),
      range,
      innerRange,
      arcCos: -1,
      damage,
      poiseDamage,
      impact,
      weight: 'heavy',
      guardable: false,
      parryable: false,
      radial: true,
      shape: 'donut',
    });
  }

  private updateTelegraphs(): void {
    const profile = ATTACKS[this.attack];
    const windupRatio = this.state === 'windup' ? THREE.MathUtils.clamp(this.stateTimer / profile.windup, 0, 1) : 0;
    this.dropShadow.visible = (this.attack === 'ceilingDrop' || this.attack === 'scuttleDrops') && (this.state === 'windup' || this.state === 'active');
    if (this.dropShadow.visible) {
      this.dropShadow.position.x = this.targetAnchor.x;
      this.dropShadow.position.z = this.targetAnchor.z;
      const scale = this.attack === 'ceilingDrop' ? 1.2 + windupRatio * 3.3 : 1.1 + windupRatio * 1.7;
      this.dropShadow.scale.setScalar(scale);
      (this.dropShadow.material as THREE.MeshBasicMaterial).opacity = this.highContrastTelegraphs
        ? 0.28 + windupRatio * 0.62
        : 0.12 + windupRatio * 0.45;
      this.dropShadow.rotation.z += 0.012;
    }

    const lanesVisible = this.attack === 'silkLanes' && (this.state === 'windup' || this.state === 'active');
    this.laneTelegraphs.forEach((lane, index) => {
      lane.visible = lanesVisible;
      if (!lanesVisible) return;
      lane.rotation.y = (index - 2) * 0.48 + (this.phase === 2 ? 0.18 : 0);
      const material = lane.material as THREE.MeshBasicMaterial;
      material.opacity = this.state === 'active'
        ? (this.highContrastTelegraphs ? 0.96 : 0.72)
        : (this.highContrastTelegraphs ? 0.24 + windupRatio * 0.48 : 0.08 + windupRatio * 0.28);
      lane.scale.x = 0.45 + windupRatio * 0.7;
    });

    const ruptureVisible = this.attack === 'ruptureRing' && (this.state === 'windup' || this.state === 'active');
    this.ruptureDisc.visible = ruptureVisible;
    this.arenaRing.visible = ruptureVisible;
    if (ruptureVisible) {
      const opacity = this.state === 'active'
        ? (this.highContrastTelegraphs ? 0.96 : 0.7)
        : (this.highContrastTelegraphs ? 0.26 + windupRatio * 0.5 : 0.08 + windupRatio * 0.32);
      (this.ruptureDisc.material as THREE.MeshBasicMaterial).opacity = opacity;
      (this.arenaRing.material as THREE.MeshBasicMaterial).opacity = opacity * 0.75;
      this.ruptureDisc.rotation.z -= 0.018;
      this.arenaRing.rotation.z += 0.013;
    }
  }

  private updatePose(delta: number): void {
    const gait = this.visualTime * (this.phase === 2 ? 8.2 : 5.6);
    const ceilingSign = this.onCeiling ? -1 : 1;
    this.rig.rotation.z += ((this.onCeiling ? Math.PI : 0) - this.rig.rotation.z) * (1 - Math.exp(-5 * delta));
    this.rig.position.y += ((this.state === 'dead' ? -1.15 : 0) - this.rig.position.y) * (1 - Math.exp(-4 * delta));
    this.abdomen.rotation.x = Math.sin(this.visualTime * 1.7) * 0.05 + (this.state === 'windup' ? -0.12 : 0);
    this.thorax.rotation.x = this.state === 'active' ? 0.22 : Math.sin(this.visualTime * 2.1) * 0.035;
    this.head.rotation.y = Math.sin(this.visualTime * 1.4) * 0.09;
    this.head.rotation.x = this.onCeiling ? -0.35 : 0.08;

    this.legs.forEach((leg, index) => {
      const side = index < 4 ? -1 : 1;
      const phase = index * 0.9;
      leg.rotation.x = Math.sin(gait + phase) * 0.22 * ceilingSign;
      leg.rotation.z = side * (0.15 + Math.cos(gait * 0.55 + phase) * 0.1);
    });
    this.arms.forEach((arm, index) => {
      const side = index < 2 ? -1 : 1;
      arm.rotation.z = side * (0.32 + Math.sin(gait * 0.6 + index) * 0.12);
      arm.rotation.x = this.state === 'windup' ? -0.55 : Math.sin(gait + index) * 0.15;
    });
    this.veilStrands.forEach((strand, index) => {
      const phase = Number(strand.userData.phase ?? index);
      strand.rotation.z += (Math.sin(this.visualTime * 3.2 + phase) * 0.18 - strand.rotation.z) * (1 - Math.exp(-7 * delta));
      strand.rotation.x = Math.cos(this.visualTime * 2.6 + phase) * 0.12;
    });
    this.silkTendrils.forEach((tendril, index) => {
      const phase = Number(tendril.userData.phase ?? index);
      tendril.rotation.z += (Math.sin(this.visualTime * 2.5 + phase) * 0.3 - tendril.rotation.z) * (1 - Math.exp(-5 * delta));
    });
  }

  private updateBells(delta: number): void {
    for (const bell of this.bells) {
      if (!bell.root.visible) continue;
      bell.pulse = Math.max(0, bell.pulse - delta * 2.2);
      bell.root.rotation.y += delta * (bell.alive ? 0.16 : 0.55);
      bell.root.rotation.z = Math.sin(this.visualTime * 1.9 + bell.position.x) * (bell.alive ? 0.035 : 0.12);
      const material = bell.shell.material as THREE.MeshStandardMaterial;
      const ratio = Math.max(0, bell.health / BELL_MAX_HEALTH);
      material.emissiveIntensity = 0.35 + bell.pulse * 2.4 + (1 - ratio) * 0.65;
      bell.glow.intensity = bell.alive ? 3.5 + bell.pulse * 12 : 0;
      bell.ring.scale.setScalar(1 + bell.pulse * 0.18);
    }
  }

  private breakBell(bell: BellNode): void {
    if (!bell.alive) return;
    bell.alive = false;
    bell.shell.visible = false;
    bell.ring.visible = false;
    bell.glow.intensity = 0;
    this.audio.shieldBreak();
    this.audio.widowChime(true);
    for (let index = 0; index < 9; index += 1) {
      const mesh = this.mesh(new THREE.DodecahedronGeometry(0.14 + (index % 3) * 0.045, 0), this.bellMaterial.clone());
      mesh.position.copy(bell.position).add(new THREE.Vector3((index % 3 - 1) * 0.22, 0.2 + Math.floor(index / 3) * 0.2, (Math.floor(index / 3) - 1) * 0.2));
      this.arenaFx.add(mesh);
      const angle = (index / 9) * Math.PI * 2;
      this.shards.push({
        mesh,
        velocity: new THREE.Vector3(Math.sin(angle) * (2.4 + index * 0.08), 3.1 + (index % 3) * 0.55, Math.cos(angle) * (2.4 + index * 0.08)),
        spin: new THREE.Vector3(2.3 + index * 0.2, 3.1 - index * 0.1, 1.7 + index * 0.13),
        life: 2.6,
      });
    }
  }

  private breakRemainingBells(): void {
    for (const bell of this.bells) if (bell.alive) this.breakBell(bell);
  }

  private updateShards(delta: number): void {
    for (let index = this.shards.length - 1; index >= 0; index -= 1) {
      const shard = this.shards[index]!;
      shard.life -= delta;
      shard.velocity.y -= 18 * delta;
      shard.mesh.position.addScaledVector(shard.velocity, delta);
      shard.mesh.rotation.x += shard.spin.x * delta;
      shard.mesh.rotation.y += shard.spin.y * delta;
      shard.mesh.rotation.z += shard.spin.z * delta;
      if (shard.mesh.position.y < 1.25) {
        shard.mesh.position.y = 1.25;
        shard.velocity.y *= -0.18;
        shard.velocity.x *= 0.7;
        shard.velocity.z *= 0.7;
      }
      const material = shard.mesh.material as THREE.MeshStandardMaterial;
      material.transparent = shard.life < 0.6;
      material.opacity = THREE.MathUtils.clamp(shard.life / 0.6, 0, 1);
      if (shard.life <= 0) {
        shard.mesh.removeFromParent();
        this.shards.splice(index, 1);
      }
    }
  }

  private beginPhaseBreak(): void {
    if (this.phase !== 1 || this.state === 'phaseBreak' || this.state === 'dead') return;
    this.state = 'phaseBreak';
    this.stateTimer = 0;
    this.attackQueue.length = 0;
    this.phaseBreakTriggered = false;
    this.mechanicName = '종의 단절';
    this.mechanicHint = '무너지는 실에서 벗어나라';
    this.mechanicProgress = 0;
    this.mechanicDanger = true;
    this.onCeiling = false;
    this.collider.setEnabled(true);
    this.body.setNextKinematicTranslation({ x: ARENA_CENTER.x, y: GROUND_BODY_Y, z: ARENA_CENTER.z });
  }

  private moveCeiling(delta: number, x: number, y: number, z: number, speed: number): void {
    const current = this.body.translation();
    this.scratch.set(x - current.x, y - current.y, z - current.z);
    const distance = this.scratch.length();
    if (distance > 0.001) this.scratch.multiplyScalar(Math.min(distance, speed * delta) / distance);
    const next = {
      x: THREE.MathUtils.clamp(current.x + this.scratch.x, -11.2, 11.2),
      y: THREE.MathUtils.clamp(current.y + this.scratch.y, GROUND_BODY_Y, CEILING_BODY_Y),
      z: THREE.MathUtils.clamp(current.z + this.scratch.z, -163.2, -139.3),
    };
    this.body.setNextKinematicTranslation(next);
  }

  private applyGroundMovement(delta: number): void {
    this.verticalVelocity += -26 * delta;
    if (this.grounded && this.verticalVelocity < -2.8) this.verticalVelocity = -2.8;
    this.horizontalStep.y = this.verticalVelocity * delta;
    this.controller.computeColliderMovement(this.collider, {
      x: this.horizontalStep.x,
      y: this.horizontalStep.y,
      z: this.horizontalStep.z,
    });
    const movement = this.controller.computedMovement();
    const current = this.body.translation();
    const next = {
      x: THREE.MathUtils.clamp(current.x + movement.x, -11.5, 11.5),
      y: current.y + movement.y,
      z: THREE.MathUtils.clamp(current.z + movement.z, -163.5, -139.0),
    };
    this.body.setNextKinematicTranslation(next);
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = -2.8;
  }

  private syncRootFromBody(): void {
    const translation = this.body.translation();
    this.root.position.set(translation.x, translation.y, translation.z);
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function moveAngleTowards(current: number, target: number, maxDelta: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + THREE.MathUtils.clamp(difference, -maxDelta, maxDelta);
}

function easeInOut(value: number): number {
  return value * value * (3 - 2 * value);
}

function easeInCubic(value: number): number {
  return value * value * value;
}
