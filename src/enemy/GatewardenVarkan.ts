import * as THREE from 'three';
import RAPIER, {
  type Collider,
  type KinematicCharacterController,
  type RigidBody,
} from '@dimforge/rapier3d-compat';
import type { AudioDirector, SwingWeight } from '../audio/AudioDirector';
import type {
  AttackPulse,
  BossCounterSnapshot,
  BossPresentationEvent,
  BossSnapshot,
  BossSummonRequest,
  EnemyDamageResult,
  LockTargetSnapshot,
} from '../combat/CombatTypes';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { BossEnemy } from './BossEnemy';

type BossState =
  | 'sealed'
  | 'intro'
  | 'approach'
  | 'windup'
  | 'active'
  | 'recovery'
  | 'phaseBreak'
  | 'stagger'
  | 'dead';

type BossAttackId =
  | 'shieldRush'
  | 'shieldSlam'
  | 'bladeChain'
  | 'delayedOverhead'
  | 'frenzyChain'
  | 'leapSlam'
  | 'oathfireSweep'
  | 'crossCut';

interface BossAttackEvent {
  readonly time: number;
  readonly range: number;
  readonly arcCos: number;
  readonly damage: number;
  readonly poiseDamage: number;
  readonly impact: number;
  readonly weight: SwingWeight;
  readonly guardable?: boolean;
  readonly parryable?: boolean;
  readonly radial?: boolean;
}

interface BossAttackProfile {
  readonly windup: number;
  readonly active: number;
  readonly recovery: number;
  readonly events: readonly BossAttackEvent[];
}

const ATTACKS: Record<BossAttackId, BossAttackProfile> = {
  shieldRush: {
    windup: 0.72,
    active: 0.9,
    recovery: 0.82,
    events: [
      { time: 0.2, range: 2.65, arcCos: 0.48, damage: 32, poiseDamage: 54, impact: 4.7, weight: 'heavy' },
    ],
  },
  shieldSlam: {
    windup: 0.92,
    active: 0.36,
    recovery: 0.96,
    events: [
      { time: 0.1, range: 3.75, arcCos: -1, damage: 37, poiseDamage: 68, impact: 4.4, weight: 'heavy', guardable: false, parryable: false, radial: true },
    ],
  },
  bladeChain: {
    windup: 0.5,
    active: 1.08,
    recovery: 0.78,
    events: [
      { time: 0.08, range: 3.05, arcCos: -0.1, damage: 21, poiseDamage: 24, impact: 1.7, weight: 'medium' },
      { time: 0.43, range: 3.15, arcCos: -0.22, damage: 23, poiseDamage: 27, impact: 1.9, weight: 'medium' },
      { time: 0.87, range: 3.35, arcCos: 0.18, damage: 36, poiseDamage: 44, impact: 3.1, weight: 'heavy' },
    ],
  },
  delayedOverhead: {
    windup: 1.18,
    active: 0.24,
    recovery: 1.02,
    events: [
      { time: 0.08, range: 3.45, arcCos: 0.36, damage: 46, poiseDamage: 58, impact: 4.2, weight: 'heavy' },
    ],
  },
  frenzyChain: {
    windup: 0.42,
    active: 1.36,
    recovery: 0.68,
    events: [
      { time: 0.06, range: 3.2, arcCos: -0.2, damage: 18, poiseDamage: 20, impact: 1.4, weight: 'light' },
      { time: 0.34, range: 3.25, arcCos: -0.26, damage: 20, poiseDamage: 22, impact: 1.5, weight: 'medium' },
      { time: 0.67, range: 3.35, arcCos: 0.02, damage: 24, poiseDamage: 28, impact: 1.9, weight: 'medium' },
      { time: 1.08, range: 3.7, arcCos: -0.38, damage: 39, poiseDamage: 48, impact: 3.6, weight: 'heavy' },
    ],
  },
  leapSlam: {
    windup: 0.68,
    active: 0.88,
    recovery: 1.0,
    events: [
      { time: 0.66, range: 4.7, arcCos: -1, damage: 45, poiseDamage: 72, impact: 5.3, weight: 'heavy', guardable: false, parryable: false, radial: true },
    ],
  },
  oathfireSweep: {
    windup: 0.82,
    active: 1.22,
    recovery: 0.84,
    events: [
      { time: 0.08, range: 3.7, arcCos: -0.32, damage: 23, poiseDamage: 27, impact: 2.0, weight: 'medium', parryable: false },
      { time: 0.46, range: 4.1, arcCos: -0.46, damage: 26, poiseDamage: 30, impact: 2.3, weight: 'medium', parryable: false },
      { time: 0.88, range: 4.5, arcCos: -0.62, damage: 34, poiseDamage: 42, impact: 3.2, weight: 'heavy', guardable: false, parryable: false },
    ],
  },
  crossCut: {
    windup: 0.62,
    active: 0.78,
    recovery: 0.76,
    events: [
      { time: 0.08, range: 3.45, arcCos: -0.12, damage: 28, poiseDamage: 32, impact: 2.4, weight: 'medium' },
      { time: 0.46, range: 3.65, arcCos: 0.08, damage: 35, poiseDamage: 42, impact: 3.1, weight: 'heavy' },
    ],
  },
};

const ARENA_MIN_X = -14.7;
const ARENA_MAX_X = 14.7;
const ARENA_MIN_Z = -118.0;
const ARENA_MAX_Z = -87.0;
const ARENA_MIN_Y = -4.0;
const ARENA_MAX_Y = 14.0;

export class GatewardenVarkan implements BossEnemy {
  readonly id = 'gatewarden-varkan';
  readonly displayName = '문지기 바르칸';
  readonly ashReward = 1400;
  readonly root = new THREE.Group();

  private readonly rig = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly swordShoulder = new THREE.Group();
  private readonly swordElbow = new THREE.Group();
  private readonly swordPivot = new THREE.Group();
  private readonly shieldShoulder = new THREE.Group();
  private readonly shieldElbow = new THREE.Group();
  private readonly shieldPivot = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftKnee = new THREE.Group();
  private readonly rightKnee = new THREE.Group();
  private readonly cloakPanels: THREE.Mesh[] = [];
  private readonly oathEmbers: THREE.Mesh[] = [];
  private readonly armorMaterial: THREE.MeshStandardMaterial;
  private readonly shieldMaterial: THREE.MeshStandardMaterial;
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly oathfireMaterial: THREE.MeshStandardMaterial;
  private readonly tellRing: THREE.Mesh;
  private readonly groundScar: THREE.Mesh;
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly toPlayer = new THREE.Vector3();
  private readonly horizontalStep = new THREE.Vector3();
  private readonly impactVelocity = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly lockPoint = new THREE.Vector3();
  private readonly spawn: THREE.Vector3;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly attackQueue: AttackPulse[] = [];
  private readonly maxHealth = 1280;
  private readonly maxPoise = 230;
  private readonly maxShieldIntegrity = 250;
  private health = this.maxHealth;
  private poise = 0;
  private shieldIntegrity = 0;
  private phase: 1 | 2 = 1;
  private state: BossState = 'sealed';
  private attack: BossAttackId = 'shieldRush';
  private attackCycle = 0;
  private stateTimer = 0;
  private nextAttackEvent = 0;
  private facingYaw = Math.PI;
  private visualTime = 0;
  private gait = 0;
  private verticalVelocity = 0;
  private grounded = false;
  private attackAllowed = true;
  private hitFlash = 0;
  private shieldBroken = false;
  private phaseBreakTriggered = false;
  private presentationEvent: BossPresentationEvent | null = null;
  private highContrastTelegraphs = false;
  private shieldDebrisMesh: THREE.Mesh | null = null;
  private shieldDebrisBody: RigidBody | null = null;
  private shieldDebrisLife = 0;
  private counterDowned = false;

  constructor(
    scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    spawn: THREE.Vector3,
    private readonly audio: AudioDirector,
  ) {
    this.spawn = spawn.clone();
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.93, 0.69).setFriction(0),
      this.body,
    );
    this.controller = physics.world.createCharacterController(0.065);
    this.controller.enableAutostep(0.42, 0.26, false);
    this.controller.enableSnapToGround(0.34);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(44));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(50));
    this.controller.setSlideEnabled(true);
    this.collider.setEnabled(false);

    this.root.name = 'boss-gatewarden-varkan';
    this.root.position.copy(spawn);
    this.root.visible = false;
    this.root.add(this.rig);
    scene.add(this.root);

    this.armorMaterial = new THREE.MeshStandardMaterial({
      color: 0x302e2b,
      roughness: 0.42,
      metalness: 0.82,
      emissive: 0x000000,
    });
    this.shieldMaterial = new THREE.MeshStandardMaterial({
      color: 0x292a28,
      roughness: 0.36,
      metalness: 0.88,
      emissive: 0x2f1608,
      emissiveIntensity: 0.2,
    });
    const blackIron = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.56, metalness: 0.78 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.26, metalness: 0.94 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x241618, roughness: 0.94, side: THREE.DoubleSide });
    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0xdfaa61,
      emissive: 0xa74415,
      emissiveIntensity: 2.1,
      roughness: 0.25,
    });
    this.oathfireMaterial = new THREE.MeshStandardMaterial({
      color: 0xe2a65d,
      emissive: 0xbb4617,
      emissiveIntensity: 2.2,
      roughness: 0.28,
      transparent: true,
      opacity: 0.92,
    });

    this.rig.scale.setScalar(1.18);
    this.rig.add(this.hips);
    this.hips.position.y = 0.05;
    this.hips.add(this.torso);
    this.torso.position.y = 0.38;

    const waist = this.mesh(new THREE.CylinderGeometry(0.47, 0.61, 0.52, 12), blackIron);
    waist.position.y = -0.2;
    this.torso.add(waist);
    const chest = this.mesh(new THREE.CylinderGeometry(0.6, 0.78, 1.22, 12), this.armorMaterial);
    chest.scale.z = 0.72;
    chest.position.y = 0.48;
    this.torso.add(chest);
    for (let index = 0; index < 4; index += 1) {
      const rib = this.mesh(new THREE.BoxGeometry(0.82 - index * 0.08, 0.08, 0.1), edge);
      rib.position.set(0, 0.17 + index * 0.22, -0.53);
      this.torso.add(rib);
    }

    this.head.position.set(0, 1.28, 0);
    this.torso.add(this.head);
    const helm = this.mesh(new THREE.DodecahedronGeometry(0.45, 1), blackIron);
    helm.scale.set(0.96, 1.16, 0.92);
    this.head.add(helm);
    const visor = this.mesh(new THREE.BoxGeometry(0.66, 0.08, 0.07), this.eyeMaterial);
    visor.position.set(0, -0.02, -0.42);
    this.head.add(visor);
    const crown = this.mesh(new THREE.BoxGeometry(0.1, 0.82, 0.55), edge);
    crown.position.set(0, 0.55, 0.04);
    crown.rotation.x = -0.1;
    this.head.add(crown);

    for (const x of [-0.72, 0.72]) {
      const pauldron = this.mesh(new THREE.SphereGeometry(0.36, 12, 8), this.armorMaterial);
      pauldron.scale.set(1.35, 0.72, 1.1);
      pauldron.position.set(x, 0.82, 0.02);
      this.torso.add(pauldron);
      const spike = this.mesh(new THREE.ConeGeometry(0.11, 0.55, 6), edge);
      spike.position.set(x * 1.17, 0.96, 0.02);
      spike.rotation.z = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.torso.add(spike);
    }

    this.buildLeg(this.leftLeg, this.leftKnee, -0.27, blackIron, this.armorMaterial);
    this.buildLeg(this.rightLeg, this.rightKnee, 0.27, blackIron, this.armorMaterial);
    this.hips.add(this.leftLeg, this.rightLeg);

    for (let index = 0; index < 6; index += 1) {
      const panel = this.mesh(new THREE.PlaneGeometry(0.42, 1.42, 1, 3), cloth.clone());
      const angle = (index / 6) * Math.PI * 2;
      panel.position.set(Math.sin(angle) * 0.38, -0.72, Math.cos(angle) * 0.34);
      panel.rotation.y = angle;
      panel.rotation.x = 0.1;
      this.hips.add(panel);
      this.cloakPanels.push(panel);
    }

    this.swordShoulder.position.set(0.72, 0.88, 0);
    this.torso.add(this.swordShoulder);
    const swordUpperArm = this.mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.72, 9), this.armorMaterial);
    swordUpperArm.position.y = -0.32;
    this.swordShoulder.add(swordUpperArm);
    this.swordElbow.position.y = -0.68;
    this.swordShoulder.add(this.swordElbow);
    const swordForearm = this.mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.68, 9), blackIron);
    swordForearm.position.y = -0.3;
    this.swordElbow.add(swordForearm);
    this.swordPivot.position.y = -0.62;
    this.swordElbow.add(this.swordPivot);
    const blade = this.mesh(new THREE.BoxGeometry(0.17, 2.65, 0.075), edge);
    blade.position.y = -1.45;
    this.swordPivot.add(blade);
    const bladeCore = this.mesh(new THREE.BoxGeometry(0.045, 2.45, 0.085), this.oathfireMaterial);
    bladeCore.position.set(0, -1.45, -0.02);
    this.swordPivot.add(bladeCore);
    const guard = this.mesh(new THREE.BoxGeometry(0.9, 0.1, 0.16), this.armorMaterial);
    guard.position.y = -0.18;
    this.swordPivot.add(guard);

    this.shieldShoulder.position.set(-0.74, 0.84, 0);
    this.torso.add(this.shieldShoulder);
    const shieldUpperArm = this.mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.68, 9), this.armorMaterial);
    shieldUpperArm.position.y = -0.3;
    this.shieldShoulder.add(shieldUpperArm);
    this.shieldElbow.position.y = -0.64;
    this.shieldShoulder.add(this.shieldElbow);
    const shieldForearm = this.mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.62, 9), blackIron);
    shieldForearm.position.y = -0.27;
    this.shieldElbow.add(shieldForearm);
    this.shieldPivot.position.y = -0.58;
    this.shieldElbow.add(this.shieldPivot);
    const shield = this.mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.17, 16), this.shieldMaterial);
    shield.rotation.z = Math.PI / 2;
    shield.scale.y = 1.34;
    shield.position.set(-0.08, -0.18, -0.12);
    shield.name = 'varkan-shield';
    this.shieldPivot.add(shield);
    const shieldBoss = this.mesh(new THREE.OctahedronGeometry(0.28, 0), this.eyeMaterial);
    shieldBoss.position.set(-0.18, -0.18, -0.88);
    this.shieldPivot.add(shieldBoss);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xd96b32,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.tellRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.72, 48), ringMaterial);
    this.tellRing.rotation.x = -Math.PI / 2;
    this.tellRing.position.y = -0.88;
    this.rig.add(this.tellRing);
    this.groundScar = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.32, 64), ringMaterial.clone());
    this.groundScar.rotation.x = -Math.PI / 2;
    this.groundScar.position.y = -0.87;
    this.groundScar.visible = false;
    this.rig.add(this.groundScar);

    for (let index = 0; index < 8; index += 1) {
      const ember = this.mesh(new THREE.OctahedronGeometry(0.09 + (index % 3) * 0.025, 0), this.oathfireMaterial.clone());
      ember.visible = false;
      this.rig.add(ember);
      this.oathEmbers.push(ember);
    }
  }


  setHighContrastTelegraphs(enabled: boolean): void {
    this.highContrastTelegraphs = enabled;
    const scarMaterial = this.groundScar.material as THREE.MeshBasicMaterial;
    scarMaterial.color.setHex(enabled ? 0xfff0a8 : 0xd96b32);
  }

  activateEncounter(): void {
    if (this.state !== 'sealed' || this.health <= 0) return;
    this.root.visible = true;
    this.collider.setEnabled(true);
    this.state = 'intro';
    this.stateTimer = 0;
    this.presentationEvent = 'intro';
    this.audio.bossIntro();
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
    this.shieldIntegrity = 0;
    this.phase = 1;
    this.state = 'sealed';
    this.attack = 'shieldRush';
    this.attackCycle = 0;
    this.stateTimer = 0;
    this.nextAttackEvent = 0;
    this.facingYaw = Math.PI;
    this.verticalVelocity = 0;
    this.grounded = false;
    this.impactVelocity.set(0, 0, 0);
    this.attackQueue.length = 0;
    this.hitFlash = 0;
    this.shieldBroken = false;
    this.phaseBreakTriggered = false;
    this.counterDowned = false;
    this.presentationEvent = null;
    this.root.visible = false;
    this.collider.setEnabled(false);
    this.shieldPivot.visible = true;
    this.oathEmbers.forEach((ember) => { ember.visible = false; });
    this.removeShieldDebris();
  }

  keepDefeated(): void {
    this.state = 'dead';
    this.health = 0;
    this.root.visible = true;
    this.collider.setEnabled(false);
    this.attackQueue.length = 0;
  }

  fixedUpdate(delta: number, playerPosition: THREE.Vector3): void {
    if (this.state === 'sealed') return;
    this.syncRootFromBody();
    this.horizontalStep.set(0, 0, 0);
    this.toPlayer.copy(playerPosition).sub(this.root.position).setY(0);
    const distance = this.toPlayer.length();
    if (distance > 0.001) this.toPlayer.multiplyScalar(1 / distance);
    const desiredYaw = Math.atan2(-this.toPlayer.x, -this.toPlayer.z);
    const turnSpeed = this.getTurnSpeed();
    if (this.state !== 'phaseBreak' && this.state !== 'stagger' && this.state !== 'dead') {
      this.facingYaw = moveAngleTowards(this.facingYaw, desiredYaw, delta * turnSpeed);
    }
    this.forward.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));

    if (this.state === 'dead') {
      this.stateTimer += delta;
    } else if (this.state === 'intro') {
      this.stateTimer += delta;
      if (this.stateTimer >= 2.35) {
        this.state = 'approach';
        this.stateTimer = -0.45;
      }
    } else if (this.state === 'phaseBreak') {
      this.stateTimer += delta;
      if (!this.phaseBreakTriggered && this.stateTimer >= 0.92) {
        this.phaseBreakTriggered = true;
        this.breakShield();
        this.audio.bossPhase();
        this.presentationEvent = 'phase2';
      }
      if (this.stateTimer >= 2.65) {
        this.phase = 2;
        this.poise = 0;
        this.state = 'approach';
        this.stateTimer = -0.38;
      }
    } else if (this.state === 'stagger') {
      this.stateTimer += delta;
      this.poise = Math.max(0, this.poise - delta * 18);
      const staggerDuration = this.counterDowned ? 3.2 : (this.phase === 2 ? 1.65 : 1.1);
      if (this.stateTimer >= staggerDuration) {
        this.counterDowned = false;
        this.state = 'approach';
        this.stateTimer = -0.5;
      }
    } else if (this.state === 'approach') {
      this.stateTimer += delta;
      this.poise = Math.max(0, this.poise - delta * (this.phase === 2 ? 8 : 5));
      const preferredDistance = this.phase === 1 ? 3.4 : 3.0;
      if (distance > preferredDistance) {
        const speed = this.phase === 1 ? (distance > 7 ? 3.15 : 2.2) : (distance > 7 ? 4.15 : 2.85);
        const sideBias = this.phase === 2 && distance < 6 ? Math.sin(this.visualTime * 1.35) * 0.42 : 0;
        this.scratch.set(this.toPlayer.z, 0, -this.toPlayer.x);
        this.horizontalStep.copy(this.toPlayer).addScaledVector(this.scratch, sideBias).normalize().multiplyScalar(speed * delta);
      } else if (this.stateTimer >= 0 && this.attackAllowed) {
        this.chooseAttack(distance);
      }
    } else {
      this.updateAttack(delta);
    }

    this.horizontalStep.addScaledVector(this.impactVelocity, delta);
    this.impactVelocity.multiplyScalar(Math.exp(-8 * delta));
    this.applyPhysicsMovement(delta);
  }

  updateVisual(delta: number): void {
    if (this.state === 'sealed') return;
    this.syncRootFromBody();
    this.visualTime += delta;
    this.hitFlash = Math.max(0, this.hitFlash - delta * 4.6);
    const counterActive = this.getCounterSnapshot().active;
    const phaseGlow = this.phase === 2 || this.state === 'phaseBreak' ? 0.24 + Math.sin(this.visualTime * 5.2) * 0.08 : 0;
    this.armorMaterial.emissive.setRGB(this.hitFlash * 0.7 + phaseGlow, this.hitFlash * 0.11 + phaseGlow * 0.22, this.hitFlash * 0.04);
    this.eyeMaterial.emissive.setHex(counterActive ? 0x45d8ff : 0x8f2d12);
    this.eyeMaterial.emissiveIntensity = 2.0 + Math.sin(this.visualTime * 4.2) * 0.32 + (this.state === 'windup' ? 1.4 : 0) + (counterActive ? 2.4 : 0);
    this.oathfireMaterial.color.setHex(counterActive ? 0x74dfff : 0xc87335);
    this.oathfireMaterial.emissiveIntensity = 1.8 + phaseGlow * 4.5 + (this.state === 'active' ? 0.85 : 0);
    this.shieldMaterial.emissiveIntensity += ((this.state === 'windup' ? 0.72 : 0.2) - this.shieldMaterial.emissiveIntensity) * (1 - Math.exp(-8 * delta));
    this.updateTelegraph(delta);
    this.updatePose(delta);
    this.updateShieldDebris(delta);
    this.root.rotation.y = this.facingYaw;
  }

  consumeAttackPulse(): AttackPulse | null {
    return this.attackQueue.shift() ?? null;
  }

  getLockSnapshot(): LockTargetSnapshot {
    this.lockPoint.copy(this.root.position).add(new THREE.Vector3(0, 1.65, 0));
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
    return {
      name: this.displayName,
      epithet: this.phase === 1 ? '검은 방패의 서약자' : '방패를 버린 맹세의 칼날',
      healthRatio: this.health / this.maxHealth,
      poiseRatio: THREE.MathUtils.clamp(this.poise / this.maxPoise, 0, 1),
      shieldRatio: this.phase === 1 && !this.shieldBroken
        ? THREE.MathUtils.clamp(1 - this.shieldIntegrity / this.maxShieldIntegrity, 0, 1)
        : 0,
      phase: this.phase,
      active: this.state !== 'sealed' && this.state !== 'dead',
      intro: this.state === 'intro',
      phaseTransition: this.state === 'phaseBreak',
      defeated: this.state === 'dead',
      phaseLabel: this.phase === 1 ? 'I · 검은 방패' : 'II · 맹세의 칼날',
      secondaryLabel: '방패 내구도',
      transitionKicker: '두 번째 서약',
      transitionTitle: '방패를 버린 맹세의 칼날',
      victoryKicker: '서약의 문이 열렸습니다',
      victoryTitle: '문지기 격파',
      counterable: this.getCounterSnapshot().active,
      counterProgress: this.getCounterSnapshot().progress,
      counterDowned: this.counterDowned,
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
    return this.state !== 'sealed' && this.state !== 'dead';
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

  getCounterSnapshot(): BossCounterSnapshot {
    const profile = ATTACKS[this.attack];
    const active = this.state === 'windup'
      && (this.attack === 'shieldRush' || this.attack === 'leapSlam')
      && this.stateTimer >= profile.windup * 0.42
      && this.stateTimer <= profile.windup * 0.82;
    const progress = active
      ? THREE.MathUtils.clamp(
        (this.stateTimer - profile.windup * 0.42) / Math.max(0.001, profile.windup * 0.4),
        0,
        1,
      )
      : 0;
    return { active, progress, downed: this.counterDowned };
  }

  receiveCounter(): EnemyDamageResult {
    if (!this.getCounterSnapshot().active) return 'ignored';
    this.counterDowned = true;
    this.state = 'stagger';
    this.stateTimer = 0;
    this.poise = this.maxPoise;
    this.hitFlash = 1.2;
    this.attackQueue.length = 0;
    this.impactVelocity.addScaledVector(this.forward, -2.2);
    return 'broken';
  }

  consumeSummonRequest(): BossSummonRequest | null {
    return null;
  }

  receiveParry(): EnemyDamageResult {
    if (!this.isActive() || this.state === 'phaseBreak' || this.state === 'intro') return 'ignored';
    const gain = this.phase === 1 ? 38 : 62;
    this.poise += gain;
    this.hitFlash = 0.75;
    this.attackQueue.length = 0;
    if (this.poise >= this.maxPoise) {
      this.state = 'stagger';
      this.stateTimer = 0;
      this.poise = this.maxPoise;
      return 'broken';
    }
    this.state = 'stagger';
    this.stateTimer = 0;
    return 'hit';
  }

  receiveDamage(damage: number, poiseDamage: number, impactDirection: THREE.Vector3): EnemyDamageResult {
    if (!this.isActive() || this.state === 'phaseBreak' || this.state === 'intro') return 'ignored';
    const incomingDot = this.forward.dot(this.scratch.copy(impactDirection).setY(0).normalize());
    const shielding = this.phase === 1 && !this.shieldBroken && incomingDot < -0.02
      && this.state !== 'active' && this.state !== 'recovery';
    if (shielding) {
      this.health = Math.max(1, this.health - damage * 0.24);
      this.shieldIntegrity += poiseDamage * 1.35 + damage * 0.18;
      this.poise = Math.min(this.maxPoise * 0.62, this.poise + poiseDamage * 0.22);
      this.hitFlash = 0.52;
      this.shieldMaterial.emissiveIntensity = 1.25;
      if (this.shieldIntegrity >= this.maxShieldIntegrity || this.health <= this.maxHealth * 0.55) {
        this.beginPhaseBreak();
        return 'broken';
      }
      return 'hit';
    }

    const damageScale = (this.phase === 1 ? 0.82 : 1) * (this.counterDowned ? 1.5 : 1);
    this.health = Math.max(0, this.health - damage * damageScale);
    this.poise += poiseDamage * (this.phase === 1 ? 0.68 : 1);
    this.hitFlash = 1;
    const push = this.scratch.copy(impactDirection).setY(0);
    if (push.lengthSq() > 0.001) {
      this.impactVelocity.add(push.normalize().multiplyScalar(this.phase === 1 ? 0.45 : 0.75));
    }
    if (this.health <= 0) {
      this.state = 'dead';
      this.stateTimer = 0;
      this.attackQueue.length = 0;
      this.presentationEvent = 'defeated';
      this.collider.setEnabled(false);
      this.audio.bossDefeat();
      return 'killed';
    }
    if (this.phase === 1 && this.health <= this.maxHealth * 0.55) {
      this.beginPhaseBreak();
      return 'broken';
    }
    if (this.poise >= this.maxPoise) {
      this.state = 'stagger';
      this.stateTimer = 0;
      this.poise = this.maxPoise;
      this.attackQueue.length = 0;
      return 'broken';
    }
    return 'hit';
  }

  isExecutable(_playerPosition: THREE.Vector3): boolean {
    return false;
  }

  beginExecution(): void {}
  finishExecution(): void {}

  reset(): void {
    this.resetEncounter();
  }

  private beginPhaseBreak(): void {
    if (this.phase === 2 || this.state === 'phaseBreak') return;
    this.state = 'phaseBreak';
    this.stateTimer = 0;
    this.phaseBreakTriggered = false;
    this.attackQueue.length = 0;
    this.poise = 0;
  }

  private chooseAttack(distance: number): void {
    const phaseOne: readonly BossAttackId[] = ['shieldRush', 'bladeChain', 'shieldSlam', 'delayedOverhead', 'bladeChain'];
    const phaseTwo: readonly BossAttackId[] = ['crossCut', 'frenzyChain', 'leapSlam', 'oathfireSweep', 'crossCut', 'frenzyChain'];
    const sequence = this.phase === 1 ? phaseOne : phaseTwo;
    const fallback: BossAttackId = this.phase === 1 ? 'shieldRush' : 'crossCut';
    let chosen: BossAttackId = sequence[this.attackCycle % sequence.length] ?? fallback;
    if (this.phase === 1 && distance > 5.4) chosen = 'shieldRush';
    if (this.phase === 2 && distance > 6.2) chosen = 'leapSlam';
    if (this.phase === 2 && distance < 2.4 && this.attackCycle % 2 === 0) chosen = 'oathfireSweep';
    this.attack = chosen;
    this.attackCycle += 1;
    this.state = 'windup';
    this.stateTimer = 0;
    this.nextAttackEvent = 0;
    this.audio.enemyTell(chosen === 'frenzyChain' || chosen === 'crossCut' ? 'medium' : 'heavy');
  }

  private updateAttack(delta: number): void {
    const profile = ATTACKS[this.attack];
    this.stateTimer += delta;
    if (this.state === 'windup') {
      if (this.attack === 'shieldRush' && this.stateTimer > profile.windup * 0.68) {
        this.horizontalStep.copy(this.forward).multiplyScalar(2.1 * delta);
      }
      if (this.attack === 'leapSlam' && this.stateTimer > profile.windup * 0.72) {
        this.horizontalStep.copy(this.forward).multiplyScalar(1.5 * delta);
      }
      if (this.stateTimer >= profile.windup) {
        this.state = 'active';
        this.stateTimer = 0;
        this.nextAttackEvent = 0;
        if (this.attack === 'leapSlam') {
          this.verticalVelocity = 9.4;
          this.grounded = false;
        }
        this.audio.swing(this.attack === 'frenzyChain' || this.attack === 'crossCut' ? 'medium' : 'heavy');
      }
      return;
    }

    if (this.state === 'active') {
      while (this.nextAttackEvent < profile.events.length) {
        const event = profile.events[this.nextAttackEvent];
        if (!event || this.stateTimer < event.time) break;
        this.emitAttack(event);
        this.nextAttackEvent += 1;
      }
      this.applyAttackMovement(delta);
      if (this.stateTimer >= profile.active) {
        this.state = 'recovery';
        this.stateTimer = 0;
      }
      return;
    }

    if (this.state === 'recovery' && this.stateTimer >= profile.recovery) {
      this.state = 'approach';
      this.stateTimer = this.phase === 1 ? -0.42 : -0.26;
    }
  }

  private applyAttackMovement(delta: number): void {
    if (this.attack === 'shieldRush') {
      this.horizontalStep.copy(this.forward).multiplyScalar(7.8 * delta);
    } else if (this.attack === 'bladeChain') {
      const burst = this.stateTimer < 0.18 || (this.stateTimer > 0.38 && this.stateTimer < 0.56) || this.stateTimer > 0.78;
      if (burst) this.horizontalStep.copy(this.forward).multiplyScalar(2.2 * delta);
    } else if (this.attack === 'delayedOverhead') {
      this.horizontalStep.copy(this.forward).multiplyScalar(2.6 * delta);
    } else if (this.attack === 'frenzyChain') {
      this.horizontalStep.copy(this.forward).multiplyScalar(2.45 * delta);
    } else if (this.attack === 'leapSlam') {
      this.horizontalStep.copy(this.forward).multiplyScalar(this.stateTimer < 0.62 ? 6.2 * delta : 0.9 * delta);
    } else if (this.attack === 'oathfireSweep') {
      this.horizontalStep.copy(this.forward).multiplyScalar(1.15 * delta);
    } else if (this.attack === 'crossCut') {
      this.horizontalStep.copy(this.forward).multiplyScalar(2.8 * delta);
    }
  }

  private emitAttack(event: BossAttackEvent): void {
    const position = this.root.position.clone().add(new THREE.Vector3(0, 1.05, 0));
    if (!event.radial) position.addScaledVector(this.forward, 0.82);
    this.attackQueue.push({
      source: 'enemy',
      position,
      forward: this.forward.clone(),
      range: event.range,
      arcCos: event.arcCos,
      damage: event.damage,
      poiseDamage: event.poiseDamage,
      impact: event.impact,
      weight: event.weight,
      guardable: event.guardable,
      parryable: event.parryable,
      radial: event.radial,
    });
    if (event.radial) {
      this.groundScar.visible = true;
      this.groundScar.scale.setScalar(0.6);
      (this.groundScar.material as THREE.MeshBasicMaterial).opacity = 0.9;
    }
  }

  private getTurnSpeed(): number {
    if (this.state === 'windup') return this.phase === 1 ? 2.1 : 3.15;
    if (this.state === 'active') return this.attack === 'shieldRush' || this.attack === 'leapSlam' ? 0.8 : 1.45;
    if (this.state === 'recovery') return 2.4;
    return this.phase === 1 ? 4.6 : 6.1;
  }

  private applyPhysicsMovement(delta: number): void {
    if (this.state === 'sealed') return;
    const position = this.body.translation();
    if (!isFinitePosition(position) || position.y < ARENA_MIN_Y || position.y > ARENA_MAX_Y) {
      this.recoverArenaPosition();
      return;
    }
    if (this.grounded && this.verticalVelocity <= 0) this.verticalVelocity = -3.2;
    else this.verticalVelocity = Math.max(-28, this.verticalVelocity - 26 * delta);
    this.controller.computeColliderMovement(this.collider, {
      x: this.horizontalStep.x,
      y: this.verticalVelocity * delta,
      z: this.horizontalStep.z,
    });
    const corrected = this.controller.computedMovement();
    const next = {
      x: THREE.MathUtils.clamp(position.x + corrected.x, ARENA_MIN_X, ARENA_MAX_X),
      y: position.y + corrected.y,
      z: THREE.MathUtils.clamp(position.z + corrected.z, ARENA_MIN_Z, ARENA_MAX_Z),
    };
    if (!isFinitePosition(next) || next.y < ARENA_MIN_Y || next.y > ARENA_MAX_Y) {
      this.recoverArenaPosition();
      return;
    }
    this.body.setNextKinematicTranslation(next);
    this.grounded = this.controller.computedGrounded();
  }

  private recoverArenaPosition(): void {
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.body.setNextKinematicTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
    this.root.position.copy(this.spawn);
    this.horizontalStep.set(0, 0, 0);
    this.impactVelocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.grounded = false;
    this.attackQueue.length = 0;
    this.nextAttackEvent = 0;
    this.counterDowned = false;
    if (this.state !== 'dead') {
      this.state = 'approach';
      this.stateTimer = -0.55;
    }
  }

  private syncRootFromBody(): void {
    const position = this.body.translation();
    this.root.position.set(position.x, position.y, position.z);
  }

  private updateTelegraph(delta: number): void {
    const tellMaterial = this.tellRing.material as THREE.MeshBasicMaterial;
    const scarMaterial = this.groundScar.material as THREE.MeshBasicMaterial;
    if (this.state === 'windup') {
      const profile = ATTACKS[this.attack];
      const ratio = THREE.MathUtils.clamp(this.stateTimer / profile.windup, 0, 1);
      const radius = this.attack === 'shieldSlam' || this.attack === 'leapSlam' ? 3.2 : 1.2;
      this.tellRing.scale.setScalar(THREE.MathUtils.lerp(radius, 0.6, ratio));
      tellMaterial.opacity = this.highContrastTelegraphs ? 0.32 + ratio * 0.66 : 0.15 + ratio * 0.72;
      tellMaterial.color.setHex(this.highContrastTelegraphs
        ? (this.attack === 'oathfireSweep' || this.phase === 2 ? 0xff5a2f : 0xffe08a)
        : (this.attack === 'oathfireSweep' || this.phase === 2 ? 0xe15926 : 0xd5a261));
      this.tellRing.visible = true;
    } else if (this.state === 'phaseBreak') {
      this.tellRing.visible = true;
      this.tellRing.scale.setScalar(1.4 + this.stateTimer * 1.2);
      tellMaterial.opacity = Math.max(0, (this.highContrastTelegraphs ? 1 : 0.8) - this.stateTimer * 0.22);
      tellMaterial.color.setHex(this.highContrastTelegraphs ? 0xff5a2f : 0xf06b28);
    } else {
      tellMaterial.opacity = Math.max(0, tellMaterial.opacity - delta * 5);
      if (tellMaterial.opacity <= 0.01) this.tellRing.visible = false;
    }
    if (this.groundScar.visible) {
      this.groundScar.scale.multiplyScalar(1 + delta * 7.5);
      scarMaterial.opacity = Math.max(0, scarMaterial.opacity - delta * 2.4);
      if (scarMaterial.opacity <= 0.01) this.groundScar.visible = false;
    }
  }

  private updatePose(delta: number): void {
    let torsoX = 0;
    let torsoY = 0;
    let hipsY = 0;
    let swordShoulderX = -0.18;
    let swordShoulderZ = -0.12;
    let swordElbowX = 0.16;
    let shieldShoulderX = -0.1;
    let shieldElbowX = 0.22;
    let legSwing = 0;
    let crouch = 0;

    if (this.state === 'intro') {
      const rise = THREE.MathUtils.smoothstep(this.stateTimer, 0.2, 1.4);
      torsoX = THREE.MathUtils.lerp(0.58, -0.03, rise);
      swordShoulderX = THREE.MathUtils.lerp(0.92, -0.35, rise);
      shieldShoulderX = THREE.MathUtils.lerp(-0.9, -0.2, rise);
      crouch = THREE.MathUtils.lerp(-0.22, 0, rise);
    } else if (this.state === 'approach') {
      this.gait += delta * (this.phase === 1 ? 5.4 : 7.2);
      legSwing = Math.sin(this.gait) * (this.phase === 1 ? 0.34 : 0.46);
      torsoY = Math.sin(this.gait) * 0.045;
      swordShoulderX = -0.24 + Math.sin(this.gait + Math.PI) * 0.12;
      shieldShoulderX = -0.18 + Math.sin(this.gait) * 0.08;
    } else if (this.state === 'windup' || this.state === 'active' || this.state === 'recovery') {
      const profile = ATTACKS[this.attack];
      const elapsed = this.state === 'windup'
        ? this.stateTimer
        : this.state === 'active'
          ? profile.windup + this.stateTimer
          : profile.windup + profile.active + this.stateTimer;
      const total = profile.windup + profile.active + profile.recovery;
      const progress = THREE.MathUtils.clamp(elapsed / total, 0, 1);
      const strike = THREE.MathUtils.smoothstep(progress, 0.28, 0.58);
      if (this.attack === 'shieldRush') {
        torsoX = 0.42;
        shieldShoulderX = THREE.MathUtils.lerp(-1.15, 0.55, strike);
        shieldElbowX = -0.52;
        swordShoulderX = -0.72;
        crouch = -0.16;
      } else if (this.attack === 'shieldSlam') {
        torsoX = THREE.MathUtils.lerp(-0.32, 0.72, strike);
        shieldShoulderX = THREE.MathUtils.lerp(-2.2, 0.9, strike);
        shieldElbowX = -0.48;
        swordShoulderX = -0.5;
      } else if (this.attack === 'delayedOverhead' || this.attack === 'leapSlam') {
        torsoX = THREE.MathUtils.lerp(-0.28, 0.62, strike);
        swordShoulderX = THREE.MathUtils.lerp(-2.65, 0.75, strike);
        swordElbowX = THREE.MathUtils.lerp(-0.5, 0.35, strike);
        shieldShoulderX = -0.5;
      } else if (this.attack === 'oathfireSweep') {
        torsoY = THREE.MathUtils.lerp(-1.0, 1.2, strike);
        swordShoulderX = -1.15;
        swordShoulderZ = THREE.MathUtils.lerp(-1.25, 1.35, strike);
        shieldShoulderX = 0.18;
      } else {
        const wave = Math.sin(progress * Math.PI * (this.attack === 'frenzyChain' ? 5 : this.attack === 'bladeChain' ? 4 : 2));
        torsoY = wave * 0.72;
        hipsY = -wave * 0.24;
        swordShoulderX = -1.02 + wave * 0.5;
        swordShoulderZ = wave * 1.15;
        shieldShoulderX = this.phase === 1 ? -0.24 : 0.3;
      }
    } else if (this.state === 'phaseBreak') {
      const pulse = Math.sin(this.stateTimer * 8) * Math.max(0, 1 - this.stateTimer / 2.65);
      torsoX = -0.12 + pulse * 0.08;
      torsoY = pulse * 0.12;
      swordShoulderX = -1.8 + pulse * 0.3;
      shieldShoulderX = -1.5;
      crouch = -0.18;
    } else if (this.state === 'stagger') {
      torsoX = -0.48;
      torsoY = 0.22;
      swordShoulderX = 0.45;
      shieldShoulderX = -0.72;
      crouch = -0.24;
    } else if (this.state === 'dead') {
      torsoX = 1.28;
      torsoY = -0.28;
      swordShoulderX = 0.82;
      shieldShoulderX = -0.9;
      crouch = -0.38;
      this.rig.position.y = Math.max(-1.45, this.rig.position.y - delta * 0.5);
    } else {
      torsoX = Math.sin(this.visualTime * 1.5) * 0.02;
    }

    const settle = 1 - Math.exp(-13 * delta);
    this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, torsoX, settle);
    this.torso.rotation.y = THREE.MathUtils.lerp(this.torso.rotation.y, torsoY, settle);
    this.hips.rotation.y = THREE.MathUtils.lerp(this.hips.rotation.y, hipsY, settle);
    this.hips.position.y = THREE.MathUtils.lerp(this.hips.position.y, 0.05 + crouch, settle);
    this.swordShoulder.rotation.x = THREE.MathUtils.lerp(this.swordShoulder.rotation.x, swordShoulderX, settle);
    this.swordShoulder.rotation.z = THREE.MathUtils.lerp(this.swordShoulder.rotation.z, swordShoulderZ, settle);
    this.swordElbow.rotation.x = THREE.MathUtils.lerp(this.swordElbow.rotation.x, swordElbowX, settle);
    this.shieldShoulder.rotation.x = THREE.MathUtils.lerp(this.shieldShoulder.rotation.x, shieldShoulderX, settle);
    this.shieldElbow.rotation.x = THREE.MathUtils.lerp(this.shieldElbow.rotation.x, shieldElbowX, settle);
    this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, legSwing, settle);
    this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, -legSwing, settle);
    this.leftKnee.rotation.x = THREE.MathUtils.lerp(this.leftKnee.rotation.x, Math.max(0, -legSwing) * 0.55, settle);
    this.rightKnee.rotation.x = THREE.MathUtils.lerp(this.rightKnee.rotation.x, Math.max(0, legSwing) * 0.55, settle);
    this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, -torsoY * 0.3, settle);
    this.cloakPanels.forEach((panel, index) => {
      const phase = index * 0.85;
      const target = 0.1 + Math.sin(this.visualTime * 2.2 + phase) * 0.035 + Math.abs(legSwing) * 0.18;
      panel.rotation.x = THREE.MathUtils.lerp(panel.rotation.x, target, 1 - Math.exp(-7 * delta));
    });
    this.oathEmbers.forEach((ember, index) => {
      const active = this.phase === 2 || this.state === 'phaseBreak';
      ember.visible = active && this.state !== 'dead';
      if (!ember.visible) return;
      const angle = this.visualTime * (0.9 + (index % 3) * 0.18) + index * Math.PI * 0.25;
      const radius = 1.05 + (index % 2) * 0.35;
      ember.position.set(Math.cos(angle) * radius, 1.15 + Math.sin(angle * 1.7) * 0.55, Math.sin(angle) * radius);
      ember.rotation.y += delta * 2.4;
    });
  }

  private breakShield(): void {
    if (this.shieldBroken) return;
    this.shieldBroken = true;
    this.phase = 2;
    this.shieldPivot.visible = false;
    this.audio.shieldBreak();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.88, 0.88, 0.17, 16),
      this.shieldMaterial.clone(),
    );
    mesh.rotation.z = Math.PI / 2;
    mesh.scale.y = 1.34;
    mesh.position.copy(this.root.position).add(new THREE.Vector3(-0.75, 1.15, 0));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.parent?.add(mesh);
    mesh.updateMatrixWorld(true);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
        .setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w })
        .setLinearDamping(0.45)
        .setAngularDamping(0.35),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.16, 0.86, 0.86).setDensity(3.4).setFriction(0.72).setRestitution(0.08),
      body,
    );
    body.applyImpulse({ x: -this.forward.x * 2.4 - 1.2, y: 3.8, z: -this.forward.z * 2.4 }, true);
    body.applyTorqueImpulse({ x: 2.4, y: 1.8, z: -3.1 }, true);
    this.shieldDebrisMesh = mesh;
    this.shieldDebrisBody = body;
    this.shieldDebrisLife = 12;
  }

  private updateShieldDebris(delta: number): void {
    if (!this.shieldDebrisMesh || !this.shieldDebrisBody) return;
    this.shieldDebrisLife -= delta;
    const position = this.shieldDebrisBody.translation();
    const rotation = this.shieldDebrisBody.rotation();
    this.shieldDebrisMesh.position.set(position.x, position.y, position.z);
    this.shieldDebrisMesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    if (this.shieldDebrisLife <= 0 || position.y < -8) this.removeShieldDebris();
  }

  private removeShieldDebris(): void {
    if (this.shieldDebrisMesh) {
      this.shieldDebrisMesh.parent?.remove(this.shieldDebrisMesh);
      this.shieldDebrisMesh.geometry.dispose();
      (this.shieldDebrisMesh.material as THREE.Material).dispose();
    }
    if (this.shieldDebrisBody) this.physics.world.removeRigidBody(this.shieldDebrisBody);
    this.shieldDebrisMesh = null;
    this.shieldDebrisBody = null;
    this.shieldDebrisLife = 0;
  }

  private buildLeg(
    upper: THREE.Group,
    knee: THREE.Group,
    x: number,
    darkIron: THREE.Material,
    armor: THREE.Material,
  ): void {
    upper.position.set(x, -0.28, 0);
    const thigh = this.mesh(new THREE.CylinderGeometry(0.18, 0.23, 0.72, 9), armor);
    thigh.position.y = -0.33;
    upper.add(thigh);
    knee.position.y = -0.69;
    upper.add(knee);
    const greave = this.mesh(new THREE.BoxGeometry(0.36, 0.72, 0.42), darkIron);
    greave.position.y = -0.32;
    knee.add(greave);
    const boot = this.mesh(new THREE.BoxGeometry(0.38, 0.22, 0.58), darkIron);
    boot.position.set(0, -0.72, -0.12);
    knee.add(boot);
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


function isFinitePosition(position: { readonly x: number; readonly y: number; readonly z: number }): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function moveAngleTowards(current: number, target: number, maxDelta: number): number {
  const delta = shortestAngle(target - current);
  return current + THREE.MathUtils.clamp(delta, -maxDelta, maxDelta);
}
