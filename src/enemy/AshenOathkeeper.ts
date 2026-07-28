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

type OathkeeperState =
  | 'sealed'
  | 'intro'
  | 'duel'
  | 'windup'
  | 'active'
  | 'recovery'
  | 'phaseBreak'
  | 'stagger'
  | 'dead';

type OathkeeperAttackId =
  | 'measuredCut'
  | 'pursuitThrust'
  | 'mirrorCounter'
  | 'guardSever'
  | 'echoCross'
  | 'shadowStep'
  | 'ashSpiral'
  | 'mirrorPunish'
  | 'crownRain'
  | 'severedWorld'
  | 'finalSequence'
  | 'lastOath';

interface AttackTiming {
  readonly windup: number;
  readonly active: number;
  readonly recovery: number;
}

interface EchoNode {
  readonly root: THREE.Group;
  readonly material: THREE.MeshStandardMaterial;
  readonly anchor: THREE.Vector3;
  opacity: number;
  targetOpacity: number;
  life: number;
}

interface FallingBlade {
  readonly root: THREE.Group;
  readonly velocity: THREE.Vector3;
  readonly spin: THREE.Vector3;
  life: number;
}

const ATTACKS: Record<OathkeeperAttackId, AttackTiming> = {
  measuredCut: { windup: 0.48, active: 1.18, recovery: 0.62 },
  pursuitThrust: { windup: 0.68, active: 0.48, recovery: 0.74 },
  mirrorCounter: { windup: 1.12, active: 0.3, recovery: 0.86 },
  guardSever: { windup: 0.78, active: 0.42, recovery: 0.84 },
  echoCross: { windup: 1.22, active: 0.78, recovery: 0.8 },
  shadowStep: { windup: 0.62, active: 0.62, recovery: 0.66 },
  ashSpiral: { windup: 0.86, active: 1.35, recovery: 0.72 },
  mirrorPunish: { windup: 0.9, active: 0.5, recovery: 0.76 },
  crownRain: { windup: 1.28, active: 1.5, recovery: 0.82 },
  severedWorld: { windup: 1.18, active: 0.94, recovery: 0.94 },
  finalSequence: { windup: 0.58, active: 1.72, recovery: 0.66 },
  lastOath: { windup: 1.68, active: 1.36, recovery: 1.05 },
};

const ARENA_CENTER = new THREE.Vector3(0, 2.72, -207.5);
const ARENA_MIN_X = -13.2;
const ARENA_MAX_X = 13.2;
const ARENA_MIN_Z = -220.8;
const ARENA_MAX_Z = -194.2;

export class AshenOathkeeper implements BossEnemy {
  readonly id = 'ashen-oathkeeper';
  readonly displayName = '재의 서약자';
  readonly ashReward = 4200;
  readonly root = new THREE.Group();

  private readonly rig = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly chest = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly swordShoulder = new THREE.Group();
  private readonly swordElbow = new THREE.Group();
  private readonly swordPivot = new THREE.Group();
  private readonly offShoulder = new THREE.Group();
  private readonly offElbow = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftKnee = new THREE.Group();
  private readonly rightKnee = new THREE.Group();
  private readonly cloakPanels: THREE.Mesh[] = [];
  private readonly hairStrands: THREE.Mesh[] = [];
  private readonly crownFragments: THREE.Mesh[] = [];
  private readonly echoes: EchoNode[] = [];
  private readonly fallingBlades: FallingBlade[] = [];
  private readonly attackQueue: AttackPulse[] = [];
  private readonly arenaFx = new THREE.Group();
  private readonly lineTelegraphs: THREE.Mesh[] = [];
  private readonly strikeTelegraphs: THREE.Mesh[] = [];
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly right = new THREE.Vector3(1, 0, 0);
  private readonly toPlayer = new THREE.Vector3();
  private readonly horizontalStep = new THREE.Vector3();
  private readonly impactVelocity = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly lockPoint = new THREE.Vector3();
  private readonly lastPlayerPosition = new THREE.Vector3();
  private readonly playerVelocity = new THREE.Vector3();
  private readonly targetAnchor = new THREE.Vector3();
  private readonly strikeAnchors = Array.from({ length: 6 }, () => new THREE.Vector3());
  private readonly echoAnchors = Array.from({ length: 4 }, () => new THREE.Vector3());
  private readonly spawn: THREE.Vector3;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly armorMaterial: THREE.MeshStandardMaterial;
  private readonly clothMaterial: THREE.MeshStandardMaterial;
  private readonly skinMaterial: THREE.MeshStandardMaterial;
  private readonly hairMaterial: THREE.MeshStandardMaterial;
  private readonly bladeMaterial: THREE.MeshStandardMaterial;
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly ashMaterial: THREE.MeshStandardMaterial;
  private readonly tellRing: THREE.Mesh;
  private readonly arenaRing: THREE.Mesh;
  private readonly safeSigil: THREE.Mesh;
  private readonly maxHealth = 2360;
  private readonly maxPoise = 340;
  private health = this.maxHealth;
  private poise = 0;
  private phase: 1 | 2 | 3 = 1;
  private state: OathkeeperState = 'sealed';
  private attack: OathkeeperAttackId = 'measuredCut';
  private attackCycle = 0;
  private stateTimer = 0;
  private nextAttackEvent = 0;
  private facingYaw = Math.PI;
  private visualTime = 0;
  private verticalVelocity = 0;
  private grounded = false;
  private attackAllowed = true;
  private hitFlash = 0;
  private presentationEvent: BossPresentationEvent | null = null;
  private phaseBreakTarget: 2 | 3 = 2;
  private phaseBreakTriggered = false;
  private mechanicName = '';
  private mechanicHint = '';
  private mechanicProgress = 0;
  private mechanicDanger = false;
  private safeLane = 0;
  private teleported = false;
  private highContrastTelegraphs = false;
  private counterDowned = false;

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
      RAPIER.ColliderDesc.capsule(0.82, 0.58).setFriction(0),
      this.body,
    );
    this.controller = physics.world.createCharacterController(0.06);
    this.controller.enableAutostep(0.4, 0.25, false);
    this.controller.enableSnapToGround(0.34);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(44));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(50));
    this.controller.setSlideEnabled(true);
    this.collider.setEnabled(false);

    this.root.name = 'boss-ashen-oathkeeper';
    this.root.position.copy(spawn);
    this.root.visible = false;
    this.root.add(this.rig);
    scene.add(this.root);

    this.arenaFx.name = 'oathkeeper-arena-combat-effects';
    scene.add(this.arenaFx);

    this.armorMaterial = new THREE.MeshStandardMaterial({
      color: 0x292b30,
      roughness: 0.34,
      metalness: 0.86,
      emissive: 0x16090a,
      emissiveIntensity: 0.08,
    });
    this.clothMaterial = new THREE.MeshStandardMaterial({
      color: 0x24191e,
      roughness: 0.88,
      metalness: 0.02,
      emissive: 0x15080c,
      emissiveIntensity: 0.12,
      side: THREE.DoubleSide,
    });
    this.skinMaterial = new THREE.MeshStandardMaterial({
      color: 0xa87968,
      roughness: 0.72,
      metalness: 0,
    });
    this.hairMaterial = new THREE.MeshStandardMaterial({
      color: 0xc8c4bb,
      roughness: 0.58,
      metalness: 0.08,
      emissive: 0x2c1b1d,
      emissiveIntensity: 0.18,
    });
    this.bladeMaterial = new THREE.MeshStandardMaterial({
      color: 0xcfd2d1,
      roughness: 0.2,
      metalness: 0.94,
      emissive: 0x5b1d20,
      emissiveIntensity: 0.5,
    });
    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0c3a0,
      emissive: 0xc74535,
      emissiveIntensity: 3.2,
      roughness: 0.2,
    });
    this.ashMaterial = new THREE.MeshStandardMaterial({
      color: 0x8c4d46,
      roughness: 0.38,
      metalness: 0.36,
      emissive: 0x8e241e,
      emissiveIntensity: 1.45,
      transparent: true,
      opacity: 0.82,
    });

    this.buildRig();
    this.buildEchoes();
    this.buildArenaTelegraphs();

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xd14f43,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.tellRing = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.35, 80), ringMaterial);
    this.tellRing.rotation.x = -Math.PI / 2;
    this.tellRing.position.set(0, 1.235, ARENA_CENTER.z);
    this.tellRing.visible = false;
    this.arenaFx.add(this.tellRing);

    this.arenaRing = new THREE.Mesh(new THREE.RingGeometry(11.4, 12.2, 96), ringMaterial.clone());
    this.arenaRing.rotation.x = -Math.PI / 2;
    this.arenaRing.position.set(0, 1.24, ARENA_CENTER.z);
    this.arenaRing.visible = false;
    this.arenaFx.add(this.arenaRing);

    const safeMaterial = new THREE.MeshBasicMaterial({
      color: 0xd8c7a1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.safeSigil = new THREE.Mesh(new THREE.RingGeometry(1.5, 3.2, 64, 1, 0, Math.PI * 0.42), safeMaterial);
    this.safeSigil.rotation.x = -Math.PI / 2;
    this.safeSigil.position.set(0, 1.245, ARENA_CENTER.z);
    this.safeSigil.visible = false;
    this.arenaFx.add(this.safeSigil);
  }


  setHighContrastTelegraphs(enabled: boolean): void {
    this.highContrastTelegraphs = enabled;
    const danger = enabled ? 0xff3f35 : 0xd14f43;
    const safe = enabled ? 0x54d8ff : 0xd8c7a1;
    (this.tellRing.material as THREE.MeshBasicMaterial).color.setHex(danger);
    (this.arenaRing.material as THREE.MeshBasicMaterial).color.setHex(danger);
    (this.safeSigil.material as THREE.MeshBasicMaterial).color.setHex(safe);
    for (const line of this.lineTelegraphs) {
      (line.material as THREE.MeshBasicMaterial).color.setHex(danger);
    }
    for (const circle of this.strikeTelegraphs) {
      (circle.material as THREE.MeshBasicMaterial).color.setHex(danger);
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
    this.lastPlayerPosition.copy(this.root.position);
    this.clearMechanic();
  }

  abortEncounter(): void {
    if (this.state === 'dead') return;
    this.resetEncounter();
  }

  resetEncounter(): void {
    this.health = this.maxHealth;
    this.poise = 0;
    this.phase = 1;
    this.state = 'sealed';
    this.attack = 'measuredCut';
    this.attackCycle = 0;
    this.stateTimer = 0;
    this.nextAttackEvent = 0;
    this.facingYaw = Math.PI;
    this.verticalVelocity = 0;
    this.grounded = false;
    this.hitFlash = 0;
    this.presentationEvent = null;
    this.phaseBreakTarget = 2;
    this.phaseBreakTriggered = false;
    this.counterDowned = false;
    this.teleported = false;
    this.attackQueue.length = 0;
    this.impactVelocity.set(0, 0, 0);
    this.body.setNextKinematicTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.root.position.copy(this.spawn);
    this.root.visible = false;
    this.collider.setEnabled(false);
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.clearMechanic();
    this.hideTelegraphs();
    this.clearFallingBlades();
    for (const echo of this.echoes) {
      echo.opacity = 0;
      echo.targetOpacity = 0;
      echo.life = 0;
      echo.root.visible = false;
    }
  }

  keepDefeated(): void {
    this.health = 0;
    this.state = 'dead';
    this.root.visible = false;
    this.collider.setEnabled(false);
    this.attackQueue.length = 0;
    this.clearMechanic();
    this.hideTelegraphs();
  }

  fixedUpdate(delta: number, playerPosition: THREE.Vector3): void {
    this.updatePlayerMotion(delta, playerPosition);
    this.horizontalStep.set(0, 0, 0);

    if (this.state === 'sealed' || this.state === 'dead') {
      this.syncRootFromBody();
      return;
    }

    this.toPlayer.copy(playerPosition).sub(this.root.position).setY(0);
    const distance = this.toPlayer.length();
    if (distance > 0.001) this.toPlayer.multiplyScalar(1 / distance);
    this.updateFacing(delta, playerPosition);

    if (this.state === 'intro') {
      this.stateTimer += delta;
      if (this.stateTimer >= 2.35) {
        this.state = 'duel';
        this.stateTimer = -0.36;
      }
    } else if (this.state === 'phaseBreak') {
      this.updatePhaseBreak(delta);
    } else if (this.state === 'stagger') {
      this.stateTimer += delta;
      this.horizontalStep.addScaledVector(this.impactVelocity, delta);
      this.impactVelocity.multiplyScalar(Math.exp(-7.5 * delta));
      const staggerDuration = this.counterDowned ? 2.85 : (this.phase === 3 ? 0.72 : 0.9);
      if (this.stateTimer >= staggerDuration) {
        this.counterDowned = false;
        this.state = 'duel';
        this.stateTimer = -0.22;
        this.poise = 0;
      }
    } else if (this.state === 'windup' || this.state === 'active' || this.state === 'recovery') {
      this.updateAttack(delta, playerPosition);
    } else {
      this.stateTimer += delta;
      this.updateDuelMovement(delta, distance);
      if (this.attackAllowed && this.stateTimer >= 0) this.chooseAttack(distance);
    }

    this.horizontalStep.addScaledVector(this.impactVelocity, delta);
    this.impactVelocity.multiplyScalar(Math.exp(-8 * delta));
    this.applyMovement(delta);
    this.syncRootFromBody();
  }

  updateVisual(delta: number): void {
    this.visualTime += delta;
    this.hitFlash = Math.max(0, this.hitFlash - delta * 4.5);
    const counterActive = this.getCounterSnapshot().active;
    this.root.rotation.y = this.facingYaw;
    this.updatePose(delta);
    this.updateMaterials();
    this.updateTelegraphs();
    this.updateEchoes(delta);
    this.updateFallingBlades(delta);
    this.eyeMaterial.emissive.setHex(counterActive ? 0x46dbff : 0x7f1b25);
    if (counterActive) this.eyeMaterial.emissiveIntensity = Math.max(this.eyeMaterial.emissiveIntensity, 6.4);
  }

  consumeAttackPulse(): AttackPulse | null {
    return this.attackQueue.shift() ?? null;
  }

  getLockSnapshot(): LockTargetSnapshot {
    this.lockPoint.copy(this.root.position).add(new THREE.Vector3(0, 1.45, 0));
    return {
      name: this.displayName,
      position: this.lockPoint.clone(),
      healthRatio: this.health / this.maxHealth,
      poiseRatio: THREE.MathUtils.clamp(this.poise / this.maxPoise, 0, 1),
      executable: false,
      active: this.isActive(),
    };
  }

  getBossSnapshot(): BossSnapshot {
    const phaseLabel = this.phase === 1
      ? 'I · 검과 검'
      : this.phase === 2
        ? 'II · 되비치는 잔상'
        : 'III · 마지막 서약';
    const epithet = this.phase === 1
      ? '왕관을 거부한 마지막 기사'
      : this.phase === 2
        ? '모든 움직임을 되비추는 검'
        : '재 위에 홀로 남은 서약';
    const transitionTitle = this.phase === 2
      ? '되비치는 잿빛 검'
      : '왕관 없는 마지막 서약';
    return {
      name: this.displayName,
      epithet,
      healthRatio: this.health / this.maxHealth,
      poiseRatio: THREE.MathUtils.clamp(this.poise / this.maxPoise, 0, 1),
      shieldRatio: this.phase === 2
        ? THREE.MathUtils.clamp(1 - this.poise / this.maxPoise, 0, 1)
        : 0,
      phase: this.phase,
      active: this.state !== 'sealed' && this.state !== 'dead',
      intro: this.state === 'intro',
      phaseTransition: this.state === 'phaseBreak',
      defeated: this.state === 'dead',
      phaseLabel,
      secondaryLabel: '거울 공명',
      transitionKicker: this.phase === 2 ? '두 번째 서약' : '마지막 서약',
      transitionTitle,
      victoryKicker: '잿빛 왕좌가 침묵했습니다',
      victoryTitle: '서약의 끝',
      mechanicName: this.mechanicName || undefined,
      mechanicHint: this.mechanicHint || undefined,
      mechanicProgress: this.mechanicName ? this.mechanicProgress : undefined,
      mechanicDanger: this.mechanicDanger,
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
      && (this.attack === 'pursuitThrust' || this.attack === 'shadowStep')
      && this.stateTimer >= profile.windup * 0.38
      && this.stateTimer <= profile.windup * 0.78;
    const progress = active
      ? THREE.MathUtils.clamp(
        (this.stateTimer - profile.windup * 0.38) / Math.max(0.001, profile.windup * 0.4),
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
    this.hitFlash = 1.25;
    this.attackQueue.length = 0;
    this.impactVelocity.addScaledVector(this.forward, -2.0);
    this.clearMechanic();
    return 'broken';
  }

  consumeSummonRequest(): BossSummonRequest | null {
    return null;
  }

  receiveParry(): EnemyDamageResult {
    if (!this.isActive() || this.state === 'phaseBreak' || this.state === 'intro') return 'ignored';
    const gain = this.phase === 1 ? 54 : this.phase === 2 ? 42 : 28;
    this.poise += gain;
    this.hitFlash = 0.8;
    this.attackQueue.length = 0;
    if (this.poise >= this.maxPoise) {
      this.poise = this.maxPoise;
      this.state = 'stagger';
      this.stateTimer = 0;
      return 'broken';
    }
    this.state = 'stagger';
    this.stateTimer = 0;
    return 'hit';
  }

  receiveDamage(damage: number, poiseDamage: number, impactDirection: THREE.Vector3): EnemyDamageResult {
    if (!this.isActive() || this.state === 'phaseBreak' || this.state === 'intro') return 'ignored';
    const damageScale = (this.phase === 1 ? 0.88 : this.phase === 2 ? 0.96 : 1)
      * (this.counterDowned ? 1.5 : 1);
    this.health = Math.max(0, this.health - damage * damageScale);
    this.poise += poiseDamage * (this.phase === 3 ? 0.68 : 0.86);
    this.hitFlash = 1;
    const push = this.scratch.copy(impactDirection).setY(0);
    if (push.lengthSq() > 0.001) {
      this.impactVelocity.add(push.normalize().multiplyScalar(this.phase === 3 ? 0.35 : 0.58));
    }

    if (this.health <= 0) {
      this.state = 'dead';
      this.stateTimer = 0;
      this.attackQueue.length = 0;
      this.presentationEvent = 'defeated';
      this.collider.setEnabled(false);
      this.audio.bossDefeat();
      this.audio.oathCrown(true);
      this.clearMechanic();
      return 'killed';
    }

    if (this.phase === 1 && this.health <= this.maxHealth * 0.66) {
      this.beginPhaseBreak(2);
      return 'broken';
    }
    if (this.phase === 2 && this.health <= this.maxHealth * 0.33) {
      this.beginPhaseBreak(3);
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

  isExecutable(_playerPosition: THREE.Vector3): boolean {
    return false;
  }

  beginExecution(): void {}
  finishExecution(): void {}

  reset(): void {
    this.resetEncounter();
  }

  private updatePlayerMotion(delta: number, playerPosition: THREE.Vector3): void {
    if (this.lastPlayerPosition.lengthSq() === 0) this.lastPlayerPosition.copy(playerPosition);
    this.playerVelocity.copy(playerPosition).sub(this.lastPlayerPosition).multiplyScalar(1 / Math.max(delta, 0.001));
    if (this.playerVelocity.length() > 10) this.playerVelocity.setLength(10);
    this.lastPlayerPosition.copy(playerPosition);
  }

  private beginPhaseBreak(target: 2 | 3): void {
    if (this.state === 'phaseBreak' || this.state === 'dead' || target <= this.phase) return;
    this.phaseBreakTarget = target;
    this.phaseBreakTriggered = false;
    this.state = 'phaseBreak';
    this.stateTimer = 0;
    this.poise = 0;
    this.attackQueue.length = 0;
    this.mechanicName = target === 2 ? '거울의 개안' : '왕관의 붕괴';
    this.mechanicHint = target === 2 ? '잔상이 검을 들기 전에 거리를 벌려라' : '무너지는 왕좌의 중심에서 벗어나라';
    this.mechanicProgress = 0;
    this.mechanicDanger = true;
    this.audio.raidWarning();
  }

  private updatePhaseBreak(delta: number): void {
    this.stateTimer += delta;
    const duration = this.phaseBreakTarget === 2 ? 2.2 : 2.75;
    this.mechanicProgress = THREE.MathUtils.clamp(this.stateTimer / duration, 0, 1);
    this.horizontalStep.copy(this.scratch.set(ARENA_CENTER.x, 0, ARENA_CENTER.z).sub(this.root.position).setY(0));
    if (this.horizontalStep.lengthSq() > 0.01) this.horizontalStep.setLength(Math.min(2.8 * delta, this.horizontalStep.length()));

    if (!this.phaseBreakTriggered && this.stateTimer >= duration * 0.52) {
      this.phaseBreakTriggered = true;
      this.phase = this.phaseBreakTarget;
      this.presentationEvent = this.phase === 2 ? 'phase2' : 'phase3';
      this.audio.bossPhase();
      this.audio.oathCrown(this.phase === 3);
      this.spawnPhaseEchoes();
      this.spawnCrownBurst();
    }
    if (this.stateTimer >= duration) {
      this.state = 'duel';
      this.stateTimer = -0.4;
      this.clearMechanic();
    }
  }

  private chooseAttack(distance: number): void {
    const phaseOne: readonly OathkeeperAttackId[] = [
      'measuredCut', 'pursuitThrust', 'mirrorCounter', 'guardSever', 'measuredCut',
    ];
    const phaseTwo: readonly OathkeeperAttackId[] = [
      'echoCross', 'shadowStep', 'ashSpiral', 'mirrorPunish', 'measuredCut', 'echoCross',
    ];
    const phaseThree: readonly OathkeeperAttackId[] = [
      'crownRain', 'finalSequence', 'severedWorld', 'lastOath', 'shadowStep', 'finalSequence',
    ];
    const sequence = this.phase === 1 ? phaseOne : this.phase === 2 ? phaseTwo : phaseThree;
    const fallback: OathkeeperAttackId = this.phase === 1 ? 'measuredCut' : this.phase === 2 ? 'echoCross' : 'finalSequence';
    let chosen = sequence[this.attackCycle % sequence.length] ?? fallback;
    const playerSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
    if (this.phase === 1 && distance > 6.3) chosen = 'pursuitThrust';
    if (this.phase === 1 && distance < 2.4 && this.attackCycle % 2 === 1) chosen = 'guardSever';
    if (this.phase === 2 && playerSpeed > 5.2) chosen = 'mirrorPunish';
    if (this.phase === 2 && distance > 7.2) chosen = 'shadowStep';
    if (this.phase === 3 && distance > 7.4) chosen = 'crownRain';
    if (this.phase === 3 && this.attackCycle % 5 === 3) chosen = 'lastOath';

    this.attack = chosen;
    this.attackCycle += 1;
    this.state = 'windup';
    this.stateTimer = 0;
    this.nextAttackEvent = 0;
    this.teleported = false;
    this.prepareAttackTargets();
    this.audio.enemyTell(this.attackWeight(chosen));
    if (chosen === 'lastOath' || chosen === 'severedWorld') this.audio.raidWarning();
  }

  private prepareAttackTargets(): void {
    this.targetAnchor.copy(this.lastPlayerPosition);
    if (this.attack === 'mirrorPunish') {
      this.scratch.copy(this.playerVelocity).setY(0);
      if (this.scratch.lengthSq() > 0.01) this.scratch.normalize().multiplyScalar(3.4);
      this.targetAnchor.add(this.scratch);
      this.targetAnchor.x = THREE.MathUtils.clamp(this.targetAnchor.x, ARENA_MIN_X + 1, ARENA_MAX_X - 1);
      this.targetAnchor.z = THREE.MathUtils.clamp(this.targetAnchor.z, ARENA_MIN_Z + 1, ARENA_MAX_Z - 1);
    }
    if (this.attack === 'crownRain') {
      for (let index = 0; index < this.strikeAnchors.length; index += 1) {
        const angle = (index / this.strikeAnchors.length) * Math.PI * 2 + this.attackCycle * 0.37;
        const radius = index === 0 ? 0 : 2.3 + (index % 3) * 1.65;
        this.strikeAnchors[index]!
          .copy(this.lastPlayerPosition)
          .add(new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius));
        this.strikeAnchors[index]!.x = THREE.MathUtils.clamp(this.strikeAnchors[index]!.x, ARENA_MIN_X + 1.2, ARENA_MAX_X - 1.2);
        this.strikeAnchors[index]!.z = THREE.MathUtils.clamp(this.strikeAnchors[index]!.z, ARENA_MIN_Z + 1.2, ARENA_MAX_Z - 1.2);
      }
    }
    if (this.attack === 'echoCross') {
      const center = this.lastPlayerPosition;
      this.echoAnchors[0]!.set(-9.4, 2.72, center.z - 3.2);
      this.echoAnchors[1]!.set(9.4, 2.72, center.z + 3.2);
      this.echoAnchors[2]!.set(center.x - 3.4, 2.72, ARENA_MIN_Z + 2.1);
      this.echoAnchors[3]!.set(center.x + 3.4, 2.72, ARENA_MAX_Z - 2.1);
    }
    if (this.attack === 'lastOath') {
      this.safeLane = this.attackCycle % 4;
    }
  }

  private updateAttack(delta: number, playerPosition: THREE.Vector3): void {
    const profile = ATTACKS[this.attack];
    this.stateTimer += delta;
    if (this.state === 'windup') {
      this.updateMechanicDuringWindup(profile.windup);
      if (this.attack === 'shadowStep' && this.stateTimer >= profile.windup * 0.62 && !this.teleported) {
        this.teleported = true;
        this.performShadowStep(playerPosition);
      }
      if (this.stateTimer >= profile.windup) {
        this.state = 'active';
        this.stateTimer = 0;
        this.nextAttackEvent = 0;
        this.audio.swing(this.attackWeight(this.attack));
      }
      return;
    }

    if (this.state === 'active') {
      this.updateMechanicDuringActive(profile.active);
      this.emitAttackEvents();
      this.applyAttackMovement(delta);
      if (this.stateTimer >= profile.active) {
        this.state = 'recovery';
        this.stateTimer = 0;
      }
      return;
    }

    if (this.state === 'recovery') {
      if (this.stateTimer >= profile.recovery) {
        this.state = 'duel';
        this.stateTimer = this.phase === 3 ? -0.16 : -0.28;
        this.clearMechanic();
        this.hideTelegraphs();
      }
    }
  }

  private updateMechanicDuringWindup(duration: number): void {
    const ratio = THREE.MathUtils.clamp(this.stateTimer / Math.max(duration, 0.001), 0, 1);
    if (this.attack === 'echoCross') {
      this.setMechanic('교차하는 잔상', '빛나는 실선 사이의 빈 공간을 찾아라', ratio, ratio > 0.72);
    } else if (this.attack === 'mirrorPunish') {
      this.setMechanic('움직임의 대가', '현재 달리는 방향에서 벗어나라', ratio, ratio > 0.74);
    } else if (this.attack === 'crownRain') {
      this.setMechanic('잿빛 검우', '겹치는 낙하지점에서 계속 이동하라', ratio, ratio > 0.68);
    } else if (this.attack === 'severedWorld') {
      this.setMechanic('갈라진 세계', '십자선과 고리 사이의 안전지대를 읽어라', ratio, ratio > 0.7);
    } else if (this.attack === 'lastOath') {
      this.setMechanic('마지막 서약', '희게 빛나는 방향으로 이동하라', ratio, ratio > 0.66);
    }
  }

  private updateMechanicDuringActive(duration: number): void {
    if (!this.mechanicName) return;
    this.mechanicProgress = THREE.MathUtils.clamp(this.stateTimer / Math.max(duration, 0.001), 0, 1);
    this.mechanicDanger = true;
  }

  private emitAttackEvents(): void {
    if (this.attack === 'measuredCut') {
      const times = [0.08, 0.44, 0.88] as const;
      while (this.nextAttackEvent < times.length && this.stateTimer >= times[this.nextAttackEvent]!) {
        const index = this.nextAttackEvent;
        this.emitCone(index === 2 ? 3.8 : 3.25, index === 2 ? -0.2 : -0.08, index === 2 ? 40 : 24, index === 2 ? 48 : 28, index === 2 ? 3.4 : 1.8, index === 2 ? 'heavy' : 'medium', true, true, (index - 1) * 0.32);
        this.nextAttackEvent += 1;
      }
    } else if (this.attack === 'pursuitThrust') {
      if (this.nextAttackEvent === 0 && this.stateTimer >= 0.12) {
        this.emitLine(this.root.position, this.forward, 8.2, 0.72, 42, 52, 4.3, 'heavy', true, true);
        this.nextAttackEvent = 1;
      }
    } else if (this.attack === 'mirrorCounter') {
      if (this.nextAttackEvent === 0 && this.stateTimer >= 0.08) {
        this.emitCone(4.1, 0.12, 48, 60, 4.7, 'heavy', true, true, 0);
        this.nextAttackEvent = 1;
      }
    } else if (this.attack === 'guardSever') {
      if (this.nextAttackEvent === 0 && this.stateTimer >= 0.08) {
        this.emitRadial(this.root.position, 4.0, 39, 64, 4.6, 'heavy', false, false);
        this.nextAttackEvent = 1;
      }
    } else if (this.attack === 'echoCross') {
      const times = [0.08, 0.22, 0.46, 0.62] as const;
      while (this.nextAttackEvent < times.length && this.stateTimer >= times[this.nextAttackEvent]!) {
        const index = this.nextAttackEvent;
        const origin = this.echoAnchors[index]!;
        const direction = this.scratch.copy(this.lastPlayerPosition).sub(origin).setY(0).normalize();
        this.emitLine(origin, direction, 21, 0.82, index >= 2 ? 36 : 30, 36, 3.3, index >= 2 ? 'heavy' : 'medium', true, false);
        this.flashEcho(index, origin, direction);
        this.nextAttackEvent += 1;
      }
    } else if (this.attack === 'shadowStep') {
      if (this.nextAttackEvent === 0 && this.stateTimer >= 0.1) {
        this.emitCone(4.2, -0.34, 42, 52, 4.2, 'heavy', true, true, 0);
        this.nextAttackEvent = 1;
      }
    } else if (this.attack === 'ashSpiral') {
      const times = [0.06, 0.31, 0.58, 0.87, 1.12] as const;
      while (this.nextAttackEvent < times.length && this.stateTimer >= times[this.nextAttackEvent]!) {
        const index = this.nextAttackEvent;
        this.emitCone(4.4, -0.5, index === 4 ? 39 : 22, index === 4 ? 50 : 24, index === 4 ? 4.1 : 2.2, index === 4 ? 'heavy' : 'medium', index !== 4, false, index * 0.82);
        this.nextAttackEvent += 1;
      }
    } else if (this.attack === 'mirrorPunish') {
      if (this.nextAttackEvent === 0 && this.stateTimer >= 0.14) {
        const direction = this.scratch.copy(this.targetAnchor).sub(this.root.position).setY(0).normalize();
        this.emitLine(this.root.position, direction, 10.5, 1.0, 47, 58, 4.5, 'heavy', false, false);
        this.nextAttackEvent = 1;
      }
    } else if (this.attack === 'crownRain') {
      const times = [0.08, 0.28, 0.5, 0.74, 0.98, 1.22] as const;
      while (this.nextAttackEvent < times.length && this.stateTimer >= times[this.nextAttackEvent]!) {
        const index = this.nextAttackEvent;
        const anchor = this.strikeAnchors[index]!;
        this.emitRadial(anchor, index === 5 ? 3.6 : 2.35, index === 5 ? 45 : 28, 46, index === 5 ? 4.8 : 2.7, index === 5 ? 'heavy' : 'medium', false, false);
        this.spawnFallingBlade(anchor, index === 5);
        this.nextAttackEvent += 1;
      }
    } else if (this.attack === 'severedWorld') {
      const times = [0.08, 0.26, 0.54, 0.72] as const;
      while (this.nextAttackEvent < times.length && this.stateTimer >= times[this.nextAttackEvent]!) {
        const index = this.nextAttackEvent;
        if (index === 0) this.emitDonut(ARENA_CENTER, 10.8, 4.2, 38, 52, 4.1, 'heavy');
        else {
          const angle = index === 1 ? 0 : index === 2 ? Math.PI / 2 : Math.PI / 4;
          this.emitLine(ARENA_CENTER, this.scratch.set(Math.sin(angle), 0, Math.cos(angle)), 17, 1.05, 34, 42, 3.7, 'heavy', false, false);
        }
        this.nextAttackEvent += 1;
      }
    } else if (this.attack === 'finalSequence') {
      const times = [0.05, 0.32, 0.58, 0.88, 1.17, 1.48] as const;
      while (this.nextAttackEvent < times.length && this.stateTimer >= times[this.nextAttackEvent]!) {
        const index = this.nextAttackEvent;
        if (index === 5) this.emitRadial(this.root.position, 5.1, 48, 68, 5.4, 'heavy', false, false);
        else this.emitCone(3.8 + index * 0.16, -0.34, index >= 4 ? 38 : 22, index >= 4 ? 46 : 26, index >= 4 ? 4.0 : 2.0, index >= 4 ? 'heavy' : 'medium', index < 4, index < 3, (index - 2) * 0.38);
        this.nextAttackEvent += 1;
      }
    } else if (this.attack === 'lastOath') {
      const times = [0.05, 0.32, 0.6, 0.92, 1.16] as const;
      while (this.nextAttackEvent < times.length && this.stateTimer >= times[this.nextAttackEvent]!) {
        const index = this.nextAttackEvent;
        if (index < 4) {
          if (index !== this.safeLane) {
            const angle = index * Math.PI / 2;
            const origin = ARENA_CENTER.clone().add(new THREE.Vector3(Math.sin(angle) * 11.5, 0, Math.cos(angle) * 11.5));
            const direction = ARENA_CENTER.clone().sub(origin).setY(0).normalize();
            this.emitLine(origin, direction, 23, 2.35, 42, 58, 4.8, 'heavy', false, false);
          }
        } else {
          this.emitDonut(ARENA_CENTER, 12.4, 3.4, 52, 76, 5.8, 'heavy');
        }
        this.nextAttackEvent += 1;
      }
    }
  }

  private updateDuelMovement(delta: number, distance: number): void {
    const phaseSpeed = this.phase === 1 ? 3.2 : this.phase === 2 ? 4.1 : 4.7;
    if (distance > 4.6) {
      this.horizontalStep.copy(this.toPlayer).multiplyScalar(phaseSpeed * delta);
    } else if (distance < 2.7) {
      this.horizontalStep.copy(this.toPlayer).multiplyScalar(-2.15 * delta);
    } else {
      this.right.set(Math.cos(this.facingYaw), 0, -Math.sin(this.facingYaw));
      const direction = (this.attackCycle + this.phase) % 2 === 0 ? 1 : -1;
      this.horizontalStep.copy(this.right).multiplyScalar(direction * (this.phase === 1 ? 1.4 : 2.15) * delta);
    }
  }

  private applyAttackMovement(delta: number): void {
    if (this.attack === 'measuredCut') {
      const burst = this.stateTimer < 0.18 || (this.stateTimer > 0.36 && this.stateTimer < 0.56) || this.stateTimer > 0.78;
      if (burst) this.horizontalStep.copy(this.forward).multiplyScalar(2.8 * delta);
    } else if (this.attack === 'pursuitThrust') {
      this.horizontalStep.copy(this.forward).multiplyScalar(8.6 * delta);
    } else if (this.attack === 'mirrorCounter') {
      this.horizontalStep.copy(this.forward).multiplyScalar(3.2 * delta);
    } else if (this.attack === 'shadowStep') {
      this.horizontalStep.copy(this.forward).multiplyScalar(4.8 * delta);
    } else if (this.attack === 'ashSpiral') {
      this.horizontalStep.copy(this.forward).multiplyScalar(1.25 * delta);
    } else if (this.attack === 'mirrorPunish') {
      this.horizontalStep.copy(this.forward).multiplyScalar(7.2 * delta);
    } else if (this.attack === 'finalSequence') {
      this.horizontalStep.copy(this.forward).multiplyScalar(3.4 * delta);
    }
  }

  private performShadowStep(playerPosition: THREE.Vector3): void {
    this.scratch.copy(this.playerVelocity).setY(0);
    if (this.scratch.lengthSq() < 0.05) this.scratch.copy(this.forward);
    this.scratch.normalize();
    this.scratchB.set(-this.scratch.z, 0, this.scratch.x);
    const side = this.attackCycle % 2 === 0 ? 1 : -1;
    const destination = this.targetAnchor
      .copy(playerPosition)
      .addScaledVector(this.scratch, -2.5)
      .addScaledVector(this.scratchB, side * 1.9);
    destination.x = THREE.MathUtils.clamp(destination.x, ARENA_MIN_X + 1, ARENA_MAX_X - 1);
    destination.z = THREE.MathUtils.clamp(destination.z, ARENA_MIN_Z + 1, ARENA_MAX_Z - 1);
    destination.y = this.root.position.y;
    this.spawnEcho(this.root.position, this.forward, 0.82);
    this.body.setNextKinematicTranslation({ x: destination.x, y: destination.y, z: destination.z });
    this.body.setTranslation({ x: destination.x, y: destination.y, z: destination.z }, true);
    this.root.position.copy(destination);
    this.facingYaw = Math.atan2(playerPosition.x - destination.x, playerPosition.z - destination.z);
    this.forward.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw)).normalize();
    this.spawnEcho(destination, this.forward, 0.9);
    this.audio.oathEcho(true);
  }

  private updateFacing(delta: number, playerPosition: THREE.Vector3): void {
    if (this.state === 'active' && this.attack !== 'ashSpiral' && this.attack !== 'finalSequence') return;
    this.scratch.copy(playerPosition).sub(this.root.position).setY(0);
    if (this.scratch.lengthSq() < 0.001) return;
    const targetYaw = Math.atan2(this.scratch.x, this.scratch.z);
    const speed = this.state === 'windup' ? 2.7 : this.phase === 3 ? 7.8 : 6.2;
    this.facingYaw = moveAngleTowards(this.facingYaw, targetYaw, speed * delta);
    this.forward.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw)).normalize();
  }

  private applyMovement(delta: number): void {
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
    if (!isFinitePosition(current) || current.y < -4 || current.y > 14) {
      this.recoverArenaPosition();
      return;
    }
    const next = {
      x: THREE.MathUtils.clamp(current.x + movement.x, ARENA_MIN_X, ARENA_MAX_X),
      y: current.y + movement.y,
      z: THREE.MathUtils.clamp(current.z + movement.z, ARENA_MIN_Z, ARENA_MAX_Z),
    };
    this.body.setNextKinematicTranslation(next);
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = -2.8;
  }

  private recoverArenaPosition(): void {
    const destination = { x: ARENA_CENTER.x, y: this.spawn.y, z: ARENA_CENTER.z };
    this.body.setTranslation(destination, true);
    this.body.setNextKinematicTranslation(destination);
    this.root.position.set(destination.x, destination.y, destination.z);
    this.horizontalStep.set(0, 0, 0);
    this.impactVelocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.grounded = false;
    this.attackQueue.length = 0;
    this.nextAttackEvent = 0;
    this.counterDowned = false;
    if (this.state !== 'dead') {
      this.state = 'duel';
      this.stateTimer = -0.55;
      this.clearMechanic();
      this.hideTelegraphs();
    }
  }

  private emitCone(
    range: number,
    arcCos: number,
    damage: number,
    poiseDamage: number,
    impact: number,
    weight: SwingWeight,
    guardable: boolean,
    parryable: boolean,
    angleOffset: number,
  ): void {
    const forward = this.scratch.copy(this.forward).applyAxisAngle(THREE.Object3D.DEFAULT_UP, angleOffset).normalize();
    const position = this.root.position.clone().add(new THREE.Vector3(0, 1.05, 0)).addScaledVector(forward, 0.7);
    this.attackQueue.push({
      source: 'enemy',
      position,
      forward: forward.clone(),
      range,
      arcCos,
      damage,
      poiseDamage,
      impact,
      weight,
      guardable,
      parryable,
      shape: 'cone',
    });
    this.audio.swing(weight);
  }

  private emitLine(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    range: number,
    width: number,
    damage: number,
    poiseDamage: number,
    impact: number,
    weight: SwingWeight,
    guardable: boolean,
    parryable: boolean,
  ): void {
    const forward = direction.clone().setY(0).normalize();
    this.attackQueue.push({
      source: 'enemy',
      position: origin.clone().add(new THREE.Vector3(0, 0.9, 0)),
      forward,
      range,
      arcCos: -1,
      damage,
      poiseDamage,
      impact,
      weight,
      guardable,
      parryable,
      shape: 'line',
      width,
    });
    this.audio.oathEcho(weight === 'heavy');
  }

  private emitRadial(
    origin: THREE.Vector3,
    range: number,
    damage: number,
    poiseDamage: number,
    impact: number,
    weight: SwingWeight,
    guardable: boolean,
    parryable: boolean,
  ): void {
    this.attackQueue.push({
      source: 'enemy',
      position: origin.clone().add(new THREE.Vector3(0, 0.4, 0)),
      forward: this.forward.clone(),
      range,
      arcCos: -1,
      damage,
      poiseDamage,
      impact,
      weight,
      guardable,
      parryable,
      shape: 'radial',
      radial: true,
    });
    this.audio.oathCrown(weight === 'heavy');
  }

  private emitDonut(
    origin: THREE.Vector3,
    range: number,
    innerRange: number,
    damage: number,
    poiseDamage: number,
    impact: number,
    weight: SwingWeight,
  ): void {
    this.attackQueue.push({
      source: 'enemy',
      position: origin.clone().add(new THREE.Vector3(0, 0.4, 0)),
      forward: this.forward.clone(),
      range,
      innerRange,
      arcCos: -1,
      damage,
      poiseDamage,
      impact,
      weight,
      guardable: false,
      parryable: false,
      shape: 'donut',
    });
    this.audio.oathCrown(true);
  }

  private attackWeight(attack: OathkeeperAttackId): SwingWeight {
    if (attack === 'measuredCut' || attack === 'ashSpiral' || attack === 'echoCross') return 'medium';
    return 'heavy';
  }

  private setMechanic(name: string, hint: string, progress: number, danger: boolean): void {
    this.mechanicName = name;
    this.mechanicHint = hint;
    this.mechanicProgress = progress;
    this.mechanicDanger = danger;
  }

  private clearMechanic(): void {
    this.mechanicName = '';
    this.mechanicHint = '';
    this.mechanicProgress = 0;
    this.mechanicDanger = false;
  }

  private buildRig(): void {
    const hipsArmor = this.mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.46, 10), this.armorMaterial);
    this.hips.position.y = 0.9;
    this.hips.add(hipsArmor);
    this.rig.add(this.hips);

    const waist = this.mesh(new THREE.CylinderGeometry(0.3, 0.39, 0.48, 10), this.clothMaterial);
    waist.position.y = 0.42;
    this.hips.add(waist);

    this.chest.position.y = 0.43;
    const cuirass = this.mesh(new THREE.CylinderGeometry(0.47, 0.34, 0.72, 10), this.armorMaterial);
    cuirass.position.y = 0.35;
    cuirass.scale.z = 0.78;
    this.chest.add(cuirass);
    const collar = this.mesh(new THREE.TorusGeometry(0.35, 0.07, 6, 16, Math.PI * 1.45), this.armorMaterial);
    collar.position.set(0, 0.77, -0.02);
    collar.rotation.x = Math.PI / 2;
    this.chest.add(collar);
    this.hips.add(this.chest);

    this.head.position.set(0, 0.96, 0);
    const face = this.mesh(new THREE.SphereGeometry(0.24, 16, 12), this.skinMaterial);
    face.scale.set(0.82, 1.08, 0.78);
    this.head.add(face);
    const mask = this.mesh(new THREE.BoxGeometry(0.36, 0.16, 0.18), this.armorMaterial);
    mask.position.set(0, -0.02, -0.17);
    mask.rotation.x = 0.12;
    this.head.add(mask);
    for (const x of [-0.09, 0.09]) {
      const eye = this.mesh(new THREE.SphereGeometry(0.027, 8, 6), this.eyeMaterial);
      eye.position.set(x, 0.065, -0.205);
      this.head.add(eye);
    }
    this.chest.add(this.head);

    const hairCap = this.mesh(new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.68), this.hairMaterial);
    hairCap.position.set(0, 0.12, 0.02);
    hairCap.rotation.x = -0.12;
    this.head.add(hairCap);
    for (let index = 0; index < 7; index += 1) {
      const strand = this.mesh(new THREE.ConeGeometry(0.08 + (index % 2) * 0.025, 0.7 + (index % 3) * 0.12, 7), this.hairMaterial.clone());
      const angle = (index / 7) * Math.PI * 1.5 + Math.PI * 0.25;
      strand.position.set(Math.sin(angle) * 0.2, -0.24 - (index % 2) * 0.08, Math.cos(angle) * 0.18 + 0.08);
      strand.rotation.z = Math.sin(angle) * 0.22;
      strand.rotation.x = -0.1 + Math.cos(angle) * 0.18;
      strand.userData.phase = index * 0.88;
      this.head.add(strand);
      this.hairStrands.push(strand);
    }

    this.swordShoulder.position.set(-0.5, 0.66, 0);
    this.swordElbow.position.set(0, -0.48, 0);
    this.swordPivot.position.set(0, -0.5, -0.02);
    const swordUpper = this.mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.5, 8), this.armorMaterial);
    swordUpper.position.y = -0.25;
    this.swordShoulder.add(swordUpper, this.swordElbow);
    const swordForearm = this.mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.52, 8), this.armorMaterial);
    swordForearm.position.y = -0.26;
    this.swordElbow.add(swordForearm, this.swordPivot);
    const hilt = this.mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.58, 8), this.armorMaterial);
    hilt.position.y = -0.08;
    const blade = this.mesh(new THREE.BoxGeometry(0.13, 2.3, 0.055), this.bladeMaterial);
    blade.position.y = -1.45;
    blade.geometry.translate(0, -0.1, 0);
    const guard = this.mesh(new THREE.BoxGeometry(0.76, 0.08, 0.08), this.armorMaterial);
    guard.position.y = -0.5;
    this.swordPivot.add(hilt, guard, blade);
    this.chest.add(this.swordShoulder);

    this.offShoulder.position.set(0.5, 0.66, 0);
    this.offElbow.position.set(0, -0.48, 0);
    const offUpper = this.mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 8), this.armorMaterial);
    offUpper.position.y = -0.25;
    this.offShoulder.add(offUpper, this.offElbow);
    const offForearm = this.mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 8), this.armorMaterial);
    offForearm.position.y = -0.25;
    this.offElbow.add(offForearm);
    this.chest.add(this.offShoulder);

    this.leftLeg.position.set(-0.22, -0.02, 0);
    this.rightLeg.position.set(0.22, -0.02, 0);
    this.leftKnee.position.set(0, -0.58, 0);
    this.rightKnee.position.set(0, -0.58, 0);
    this.leftLeg.add(this.limbSegment(0.14, 0.6), this.leftKnee);
    this.rightLeg.add(this.limbSegment(0.14, 0.6), this.rightKnee);
    this.leftKnee.add(this.limbSegment(0.12, 0.62));
    this.rightKnee.add(this.limbSegment(0.12, 0.62));
    this.hips.add(this.leftLeg, this.rightLeg);

    for (let index = 0; index < 6; index += 1) {
      const panel = this.mesh(new THREE.PlaneGeometry(0.42, 1.35, 2, 4), this.clothMaterial.clone());
      const angle = (index / 6) * Math.PI * 2;
      panel.position.set(Math.sin(angle) * 0.34, -0.42, Math.cos(angle) * 0.28 + 0.1);
      panel.rotation.y = angle;
      panel.userData.phase = index * 1.13;
      this.hips.add(panel);
      this.cloakPanels.push(panel);
    }

    const crownRoot = new THREE.Group();
    crownRoot.position.set(0, 1.38, 0.02);
    this.chest.add(crownRoot);
    for (let index = 0; index < 7; index += 1) {
      const fragment = this.mesh(new THREE.ConeGeometry(0.08, 0.48 + (index % 2) * 0.14, 5), this.ashMaterial.clone());
      const angle = (index / 7) * Math.PI * 2;
      fragment.position.set(Math.sin(angle) * 0.42, Math.cos(index * 1.7) * 0.08, Math.cos(angle) * 0.42);
      fragment.rotation.z = -Math.sin(angle) * 0.7;
      fragment.rotation.x = Math.cos(angle) * 0.7;
      fragment.userData.phase = angle;
      crownRoot.add(fragment);
      this.crownFragments.push(fragment);
    }
  }

  private buildEchoes(): void {
    for (let index = 0; index < 4; index += 1) {
      const material = new THREE.MeshStandardMaterial({
        color: index % 2 === 0 ? 0x91413d : 0xb6aea5,
        emissive: 0x7c1e1a,
        emissiveIntensity: 1.8,
        roughness: 0.34,
        metalness: 0.52,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const root = new THREE.Group();
      root.name = `oathkeeper-echo-${index}`;
      const body = this.mesh(new THREE.CylinderGeometry(0.35, 0.48, 1.5, 8), material);
      body.position.y = 0.78;
      const head = this.mesh(new THREE.SphereGeometry(0.2, 10, 8), material);
      head.position.y = 1.72;
      const sword = this.mesh(new THREE.BoxGeometry(0.08, 2.1, 0.04), material);
      sword.position.set(-0.45, 0.8, -0.15);
      sword.rotation.z = 0.28;
      root.add(body, head, sword);
      root.visible = false;
      this.arenaFx.add(root);
      this.echoes.push({
        root,
        material,
        anchor: new THREE.Vector3(),
        opacity: 0,
        targetOpacity: 0,
        life: 0,
      });
    }
  }

  private buildArenaTelegraphs(): void {
    const lineMaterial = new THREE.MeshBasicMaterial({
      color: 0xd84d43,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    for (let index = 0; index < 6; index += 1) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 24), lineMaterial.clone());
      line.rotation.x = -Math.PI / 2;
      line.position.y = 1.245;
      line.visible = false;
      this.arenaFx.add(line);
      this.lineTelegraphs.push(line);

      const circle = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.2, 48), lineMaterial.clone());
      circle.rotation.x = -Math.PI / 2;
      circle.position.y = 1.25;
      circle.visible = false;
      this.arenaFx.add(circle);
      this.strikeTelegraphs.push(circle);
    }
  }

  private updatePose(delta: number): void {
    const gait = this.visualTime * (this.phase === 1 ? 5.2 : this.phase === 2 ? 6.8 : 8.6);
    const moving = this.horizontalStep.lengthSq() > 0.0001;
    const windupRatio = this.state === 'windup'
      ? THREE.MathUtils.clamp(this.stateTimer / ATTACKS[this.attack].windup, 0, 1)
      : 0;
    this.rig.position.y += ((this.state === 'dead' ? -1.15 : Math.sin(this.visualTime * 1.7) * 0.025) - this.rig.position.y) * (1 - Math.exp(-5 * delta));
    this.hips.rotation.y = moving ? Math.sin(gait) * 0.12 : Math.sin(this.visualTime * 1.3) * 0.035;
    this.chest.rotation.y = -this.hips.rotation.y * 0.75;
    this.chest.rotation.x = this.state === 'windup' ? -0.08 - windupRatio * 0.16 : this.state === 'active' ? 0.18 : 0.02;
    this.head.rotation.y = Math.sin(this.visualTime * 1.1) * 0.06;
    this.head.rotation.x = this.state === 'windup' ? 0.08 : -0.02;

    const attackSwing = this.state === 'active' ? this.stateTimer / ATTACKS[this.attack].active : 0;
    this.swordShoulder.rotation.z = -0.2 - windupRatio * 0.75 + Math.sin(attackSwing * Math.PI * 2.4) * (this.state === 'active' ? 1.0 : 0);
    this.swordShoulder.rotation.x = -0.18 + windupRatio * 0.42;
    this.swordElbow.rotation.x = -0.35 - windupRatio * 0.4 + (this.state === 'active' ? Math.sin(attackSwing * Math.PI * 1.8) * 0.7 : 0);
    this.swordPivot.rotation.z = -0.16 + (this.state === 'active' ? Math.sin(attackSwing * Math.PI * 2) * 0.32 : 0);
    this.offShoulder.rotation.z = 0.28 + windupRatio * 0.28;
    this.offElbow.rotation.x = -0.2 - windupRatio * 0.5;

    const stride = moving ? Math.sin(gait) * 0.36 : 0;
    this.leftLeg.rotation.x = stride;
    this.rightLeg.rotation.x = -stride;
    this.leftKnee.rotation.x = Math.max(0, -stride) * 0.55;
    this.rightKnee.rotation.x = Math.max(0, stride) * 0.55;

    this.cloakPanels.forEach((panel, index) => {
      const phase = Number(panel.userData.phase ?? index);
      panel.rotation.x += ((0.08 + Math.sin(this.visualTime * 2.7 + phase) * 0.09 + (moving ? 0.16 : 0)) - panel.rotation.x) * (1 - Math.exp(-5 * delta));
      panel.rotation.z = Math.sin(this.visualTime * 2.2 + phase) * (this.phase === 3 ? 0.18 : 0.08);
    });
    this.hairStrands.forEach((strand, index) => {
      const phase = Number(strand.userData.phase ?? index);
      strand.rotation.z += (Math.sin(this.visualTime * 3.1 + phase) * (0.12 + this.phase * 0.035) - strand.rotation.z) * (1 - Math.exp(-7 * delta));
      strand.rotation.x += ((-0.08 + Math.cos(this.visualTime * 2.4 + phase) * 0.11) - strand.rotation.x) * (1 - Math.exp(-6 * delta));
    });
    this.crownFragments.forEach((fragment, index) => {
      const phase = Number(fragment.userData.phase ?? index);
      const radius = this.phase === 1 ? 0.42 : this.phase === 2 ? 0.55 : 0.72;
      fragment.position.x = Math.sin(this.visualTime * (0.6 + index * 0.03) + phase) * radius;
      fragment.position.z = Math.cos(this.visualTime * (0.6 + index * 0.03) + phase) * radius;
      fragment.position.y = Math.sin(this.visualTime * 1.4 + phase) * 0.12;
      fragment.rotation.y += delta * (0.8 + this.phase * 0.25);
    });
  }

  private updateMaterials(): void {
    const phaseGlow = this.phase === 1 ? 0.15 : this.phase === 2 ? 0.72 : 1.35;
    this.armorMaterial.emissiveIntensity = phaseGlow + this.hitFlash * 0.75;
    this.bladeMaterial.emissiveIntensity = 0.45 + this.phase * 0.35 + this.hitFlash * 1.2;
    this.eyeMaterial.emissiveIntensity = 2.8 + this.phase * 0.8 + this.hitFlash * 1.5;
    this.ashMaterial.emissiveIntensity = 1.1 + this.phase * 0.65 + this.hitFlash;
  }

  private updateTelegraphs(): void {
    this.hideTelegraphs();
    const windupRatio = this.state === 'windup'
      ? THREE.MathUtils.clamp(this.stateTimer / ATTACKS[this.attack].windup, 0, 1)
      : this.state === 'active' ? 1 : 0;
    const activeOpacity = this.state === 'active'
      ? (this.highContrastTelegraphs ? 0.98 : 0.78)
      : (this.highContrastTelegraphs ? 0.28 + windupRatio * 0.54 : 0.08 + windupRatio * 0.34);

    if (this.state !== 'windup' && this.state !== 'active') return;
    if (this.attack === 'pursuitThrust' || this.attack === 'mirrorPunish') {
      const line = this.lineTelegraphs[0]!;
      const direction = this.attack === 'mirrorPunish'
        ? this.scratch.copy(this.targetAnchor).sub(this.root.position).setY(0).normalize()
        : this.forward;
      this.placeLineTelegraph(line, this.root.position, direction, this.attack === 'mirrorPunish' ? 10.5 : 8.2, this.attack === 'mirrorPunish' ? 2.0 : 1.45, activeOpacity);
    } else if (this.attack === 'echoCross') {
      for (let index = 0; index < 4; index += 1) {
        const origin = this.echoAnchors[index]!;
        const direction = this.scratch.copy(this.lastPlayerPosition).sub(origin).setY(0).normalize();
        this.placeLineTelegraph(this.lineTelegraphs[index]!, origin, direction, 21, 1.7, activeOpacity);
      }
    } else if (this.attack === 'crownRain') {
      for (let index = 0; index < this.strikeAnchors.length; index += 1) {
        const circle = this.strikeTelegraphs[index]!;
        circle.visible = true;
        circle.position.x = this.strikeAnchors[index]!.x;
        circle.position.z = this.strikeAnchors[index]!.z;
        circle.scale.setScalar(index === 5 ? 1.55 : 1);
        (circle.material as THREE.MeshBasicMaterial).opacity = activeOpacity;
        circle.rotation.z += 0.018;
      }
    } else if (this.attack === 'severedWorld') {
      this.tellRing.visible = true;
      this.tellRing.position.set(ARENA_CENTER.x, 1.245, ARENA_CENTER.z);
      this.tellRing.scale.setScalar(2.1);
      (this.tellRing.material as THREE.MeshBasicMaterial).opacity = activeOpacity;
      this.placeLineTelegraph(this.lineTelegraphs[0]!, ARENA_CENTER, this.scratch.set(1, 0, 0), 24, 2.1, activeOpacity);
      this.placeLineTelegraph(this.lineTelegraphs[1]!, ARENA_CENTER, this.scratch.set(0, 0, 1), 24, 2.1, activeOpacity);
    } else if (this.attack === 'lastOath') {
      this.arenaRing.visible = true;
      (this.arenaRing.material as THREE.MeshBasicMaterial).opacity = activeOpacity * 0.72;
      this.safeSigil.visible = true;
      this.safeSigil.rotation.z = -this.safeLane * Math.PI / 2 + Math.PI * 0.29;
      (this.safeSigil.material as THREE.MeshBasicMaterial).opacity = this.highContrastTelegraphs
        ? 0.48 + windupRatio * 0.5
        : 0.22 + windupRatio * 0.65;
      for (let index = 0; index < 4; index += 1) {
        if (index === this.safeLane) continue;
        const angle = index * Math.PI / 2;
        const origin = this.scratchB.copy(ARENA_CENTER).add(new THREE.Vector3(Math.sin(angle) * 11.5, 0, Math.cos(angle) * 11.5));
        const direction = this.scratch.copy(ARENA_CENTER).sub(origin).setY(0).normalize();
        this.placeLineTelegraph(this.lineTelegraphs[index]!, origin, direction, 23, 4.7, activeOpacity);
      }
    } else {
      this.tellRing.visible = true;
      this.tellRing.position.set(this.root.position.x, 1.245, this.root.position.z);
      this.tellRing.scale.setScalar(this.attack === 'guardSever' ? 1.65 : 1);
      (this.tellRing.material as THREE.MeshBasicMaterial).opacity = activeOpacity * 0.72;
    }
  }

  private placeLineTelegraph(
    line: THREE.Mesh,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    length: number,
    width: number,
    opacity: number,
  ): void {
    line.visible = true;
    line.position.set(origin.x + direction.x * length * 0.5, 1.245, origin.z + direction.z * length * 0.5);
    line.rotation.z = -Math.atan2(direction.x, direction.z);
    line.scale.set(width / 1.5, length / 24, 1);
    (line.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private hideTelegraphs(): void {
    this.tellRing.visible = false;
    this.arenaRing.visible = false;
    this.safeSigil.visible = false;
    for (const line of this.lineTelegraphs) line.visible = false;
    for (const circle of this.strikeTelegraphs) circle.visible = false;
  }

  private spawnEcho(position: THREE.Vector3, forward: THREE.Vector3, opacity: number): void {
    const echo = this.echoes.find((candidate) => candidate.life <= 0) ?? this.echoes[0]!;
    echo.anchor.copy(position);
    echo.root.position.copy(position);
    echo.root.rotation.y = Math.atan2(forward.x, forward.z);
    echo.opacity = opacity;
    echo.targetOpacity = 0;
    echo.life = 0.75;
    echo.root.visible = true;
  }

  private flashEcho(index: number, position: THREE.Vector3, direction: THREE.Vector3): void {
    const echo = this.echoes[index % this.echoes.length]!;
    echo.anchor.copy(position);
    echo.root.position.copy(position);
    echo.root.rotation.y = Math.atan2(direction.x, direction.z);
    echo.opacity = 0.88;
    echo.targetOpacity = 0.12;
    echo.life = 0.8;
    echo.root.visible = true;
  }

  private spawnPhaseEchoes(): void {
    for (let index = 0; index < this.echoes.length; index += 1) {
      const angle = (index / this.echoes.length) * Math.PI * 2;
      const position = ARENA_CENTER.clone().add(new THREE.Vector3(Math.sin(angle) * 5.5, 0, Math.cos(angle) * 5.5));
      const direction = ARENA_CENTER.clone().sub(position).setY(0).normalize();
      this.flashEcho(index, position, direction);
    }
  }

  private updateEchoes(delta: number): void {
    for (const echo of this.echoes) {
      if (echo.life <= 0) {
        echo.root.visible = false;
        echo.opacity = 0;
        continue;
      }
      echo.life -= delta;
      echo.opacity += (echo.targetOpacity - echo.opacity) * (1 - Math.exp(-7 * delta));
      echo.root.position.y = echo.anchor.y + Math.sin(this.visualTime * 7 + echo.anchor.x) * 0.04;
      echo.root.scale.setScalar(1 + Math.sin(this.visualTime * 9 + echo.anchor.z) * 0.025);
      echo.material.opacity = THREE.MathUtils.clamp(echo.opacity * Math.min(1, echo.life * 3), 0, 0.92);
      echo.material.emissiveIntensity = 1.4 + echo.opacity * 2.4;
      if (echo.life <= 0) echo.root.visible = false;
    }
  }

  private spawnFallingBlade(anchor: THREE.Vector3, heavy: boolean): void {
    const root = new THREE.Group();
    const material = this.bladeMaterial.clone();
    material.transparent = true;
    material.opacity = 0.9;
    const blade = this.mesh(new THREE.BoxGeometry(0.13, heavy ? 2.8 : 2.15, 0.06), material);
    blade.position.y = heavy ? 1.4 : 1.08;
    root.add(blade);
    root.position.copy(anchor).add(new THREE.Vector3(0, 7.5, 0));
    root.rotation.z = 0.12;
    this.arenaFx.add(root);
    this.fallingBlades.push({
      root,
      velocity: new THREE.Vector3(0, heavy ? -17 : -14, 0),
      spin: new THREE.Vector3(0.2, heavy ? 3.4 : 2.5, 0.1),
      life: 1.3,
    });
  }

  private spawnCrownBurst(): void {
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const anchor = ARENA_CENTER.clone().add(new THREE.Vector3(Math.sin(angle) * (2.5 + this.phase), 0, Math.cos(angle) * (2.5 + this.phase)));
      this.spawnFallingBlade(anchor, this.phase === 3);
    }
  }

  private updateFallingBlades(delta: number): void {
    for (let index = this.fallingBlades.length - 1; index >= 0; index -= 1) {
      const falling = this.fallingBlades[index]!;
      falling.life -= delta;
      falling.root.position.addScaledVector(falling.velocity, delta);
      falling.root.rotation.x += falling.spin.x * delta;
      falling.root.rotation.y += falling.spin.y * delta;
      falling.root.rotation.z += falling.spin.z * delta;
      if (falling.root.position.y < 1.22) {
        falling.root.position.y = 1.22;
        falling.velocity.y = 0;
      }
      const material = (falling.root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (falling.life < 0.35) {
        material.opacity = THREE.MathUtils.clamp(falling.life / 0.35, 0, 1);
      }
      if (falling.life <= 0) {
        falling.root.removeFromParent();
        this.fallingBlades.splice(index, 1);
      }
    }
  }

  private clearFallingBlades(): void {
    for (const falling of this.fallingBlades) falling.root.removeFromParent();
    this.fallingBlades.length = 0;
  }

  private syncRootFromBody(): void {
    const translation = this.body.translation();
    this.root.position.set(translation.x, translation.y, translation.z);
  }

  private limbSegment(radius: number, length: number): THREE.Mesh {
    const segment = this.mesh(new THREE.CylinderGeometry(radius * 0.82, radius, length, 8), this.armorMaterial);
    segment.position.y = -length * 0.5;
    return segment;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}


function isFinitePosition(position: { readonly x: number; readonly y: number; readonly z: number }): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function moveAngleTowards(current: number, target: number, maxDelta: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + THREE.MathUtils.clamp(difference, -maxDelta, maxDelta);
}
