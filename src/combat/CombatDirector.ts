import * as THREE from 'three';
import type { AudioDirector } from '../audio/AudioDirector';
import { GAME_CONFIG } from '../config/GameConfig';
import { AshenHound } from '../enemy/AshenHound';
import { AshenSentinel } from '../enemy/AshenSentinel';
import { AshenSpearman } from '../enemy/AshenSpearman';
import { AshenOathkeeper } from '../enemy/AshenOathkeeper';
import { BellDevouringWidow } from '../enemy/BellDevouringWidow';
import { BellKeeper } from '../enemy/BellKeeper';
import type { BossEnemy } from '../enemy/BossEnemy';
import type { CombatEnemy } from '../enemy/CombatEnemy';
import { GatewardenVarkan } from '../enemy/GatewardenVarkan';
import { InputController } from '../input/InputController';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import type {
  AttackPulse,
  BossPresentationEvent,
  BossSnapshot,
  EnemyDamageResult,
  LockTargetSnapshot,
} from './CombatTypes';
import { CombatEffects } from './CombatEffects';

export interface BossWorldState {
  readonly varkanActive: boolean;
  readonly varkanDefeated: boolean;
  readonly widowActive: boolean;
  readonly widowDefeated: boolean;
  readonly oathkeeperActive: boolean;
  readonly oathkeeperDefeated: boolean;
}

export interface CombatSaveState {
  readonly varkanDefeated: boolean;
  readonly widowDefeated: boolean;
  readonly oathkeeperDefeated: boolean;
}

export class CombatDirector {
  private readonly regularEnemies: CombatEnemy[];
  private readonly varkan: GatewardenVarkan;
  private readonly widow: BellDevouringWidow;
  private readonly oathkeeper: AshenOathkeeper;
  private readonly bosses: BossEnemy[];
  private readonly enemies: CombatEnemy[];
  private readonly effects: CombatEffects;
  private readonly playerPosition = new THREE.Vector3();
  private readonly playerLockPoint = new THREE.Vector3();
  private readonly enemyPosition = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly attackForward = new THREE.Vector3();
  private lockedEnemy: CombatEnemy | null = null;
  private executingEnemy: CombatEnemy | null = null;
  private activeBoss: BossEnemy | null = null;
  private presentedBoss!: BossEnemy;
  private cameraImpulse = 0;
  private hitStop = 0;
  private pendingAshReward = 0;
  private readonly rewardedEnemies = new Set<string>();
  private varkanDefeated = false;
  private widowDefeated = false;
  private oathkeeperDefeated = false;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    private readonly audio: AudioDirector,
  ) {
    this.effects = new CombatEffects(scene);
    this.regularEnemies = [
      new AshenSentinel(scene, physics, 'gate-sentinel', '잿빛 문지기', new THREE.Vector3(0, 1.12, 5.5), audio, 0),
      new AshenHound(scene, physics, 'west-hound', '재를 핥는 사냥개', new THREE.Vector3(-6.8, 0.82, -2.6), audio, 1),
      new AshenSpearman(scene, physics, 'processional-spearman', '서약을 잃은 창병', new THREE.Vector3(6.4, 1.12, -4.8), audio, -1),
      new AshenSentinel(scene, physics, 'east-sentinel', '부서진 방패의 기사', new THREE.Vector3(7.4, 1.12, -12.5), audio, 1),
      new AshenHound(scene, physics, 'nave-hound', '종지기의 사냥개', new THREE.Vector3(4.8, 1.34, -20.6), audio, -1),
      new BellKeeper(scene, physics, 'forecourt-bellkeeper', '침묵한 종지기', new THREE.Vector3(-5.4, 1.34, -25.4), audio, false),
      new AshenSpearman(scene, physics, 'cloister-spearman', '종루의 창지기', new THREE.Vector3(28.2, 3.56, -20.0), audio, 1),
      new AshenHound(scene, physics, 'cloister-hound', '회랑의 잿불 사냥개', new THREE.Vector3(29.0, 3.26, -47.0), audio, -1),
      new BellKeeper(scene, physics, 'bell-warden', '정예 · 검은 종의 수호자', new THREE.Vector3(23.5, 3.56, -53.8), audio, true),
      new AshenSentinel(scene, physics, 'oathbound-captain', '정예 · 서약대장', new THREE.Vector3(0, 1.62, -72.8), audio, 2),
    ];
    this.varkan = new GatewardenVarkan(scene, physics, new THREE.Vector3(0, 3.2, -105.5), audio);
    this.widow = new BellDevouringWidow(scene, physics, new THREE.Vector3(0, 2.78, -151.5), audio);
    this.oathkeeper = new AshenOathkeeper(scene, physics, new THREE.Vector3(0, 2.72, -207.5), audio);
    this.bosses = [this.varkan, this.widow, this.oathkeeper];
    this.presentedBoss = this.varkan;
    this.enemies = [...this.regularEnemies, ...this.bosses];
  }

  handleTargeting(input: InputController, player: PlayerController, cameraForward: THREE.Vector3): void {
    if (!input.consumeAction('lockOn')) return;
    if (this.lockedEnemy?.isActive()) {
      this.lockedEnemy = null;
      return;
    }
    player.getWorldPosition(this.playerPosition);
    this.lockedEnemy = this.activeBoss?.isEncounterActive()
      ? this.activeBoss
      : this.findBestTarget(cameraForward, this.playerPosition);
  }

  tryExecution(player: PlayerController): boolean {
    if (this.executingEnemy || player.isDead()) return false;
    player.getWorldPosition(this.playerPosition);
    const candidate = this.lockedEnemy;
    if (!candidate || !candidate.isExecutable(this.playerPosition)) return false;
    const snapshot = candidate.getLockSnapshot();
    if (!player.beginExecution(snapshot.position)) return false;
    candidate.beginExecution();
    this.executingEnemy = candidate;
    this.audio.postureBreak();
    this.effects.spawnPostureBreak(snapshot.position);
    this.cameraImpulse = Math.max(this.cameraImpulse, 0.34);
    this.hitStop = Math.max(this.hitStop, 0.055);
    return true;
  }

  fixedUpdate(delta: number, player: PlayerController): void {
    player.getWorldPosition(this.playerPosition);
    this.tryStartBossEncounter();

    if (player.isDead()) {
      this.lockedEnemy = null;
      this.executingEnemy = null;
      if (this.activeBoss?.isEncounterActive()) this.activeBoss.abortEncounter();
      this.activeBoss = null;
      for (const enemy of this.enemies) {
        while (enemy.consumeAttackPulse()) {
          // No queued attack is allowed to survive the death transition.
        }
      }
      return;
    }

    this.coordinateAttackSlots();
    const activeEnemies: readonly CombatEnemy[] = this.activeBoss?.isEncounterActive()
      ? [this.activeBoss]
      : this.regularEnemies;
    for (const enemy of activeEnemies) enemy.fixedUpdate(delta, this.playerPosition);

    const playerPulse = player.consumeAttackPulse();
    if (playerPulse) this.resolvePlayerAttack(playerPulse);

    for (const enemy of activeEnemies) {
      if (player.isDead()) break;
      let pulse = enemy.consumeAttackPulse();
      while (pulse) {
        this.resolveEnemyAttack(pulse, player, enemy);
        pulse = enemy.consumeAttackPulse();
      }
    }

    if (player.consumeExecutionImpact() && this.executingEnemy) {
      const snapshot = this.executingEnemy.getLockSnapshot();
      const executed = this.executingEnemy;
      executed.finishExecution();
      this.awardEnemy(executed);
      this.effects.spawnExecution(snapshot.position);
      this.audio.execution();
      this.cameraImpulse = Math.max(this.cameraImpulse, 0.92);
      this.hitStop = Math.max(this.hitStop, 0.16);
      this.executingEnemy = null;
    }

    if (this.lockedEnemy) {
      const snapshot = this.lockedEnemy.getLockSnapshot();
      const maximumDistance = this.lockedEnemy === this.widow
        ? GAME_CONFIG.camera.lockMaxDistance * 1.8
        : this.lockedEnemy === this.oathkeeper
          ? GAME_CONFIG.camera.lockMaxDistance * 1.65
          : GAME_CONFIG.camera.lockMaxDistance * 1.4;
      const distance = snapshot.position.distanceTo(this.playerPosition);
      if (!snapshot.active || distance > maximumDistance) this.lockedEnemy = null;
    }
  }

  reset(): void {
    this.lockedEnemy = null;
    this.executingEnemy = null;
    this.activeBoss = null;
    this.presentedBoss = this.varkan;
    this.cameraImpulse = 0;
    this.hitStop = 0;
    this.pendingAshReward = 0;
    this.rewardedEnemies.clear();
    this.varkanDefeated = false;
    this.widowDefeated = false;
    this.oathkeeperDefeated = false;
    for (const enemy of this.regularEnemies) enemy.reset();
    this.varkan.resetEncounter();
    this.widow.resetEncounter();
    this.oathkeeper.resetEncounter();
  }

  resetAtRest(): void {
    this.lockedEnemy = null;
    this.executingEnemy = null;
    this.activeBoss = null;
    this.cameraImpulse = 0;
    this.hitStop = 0;
    this.pendingAshReward = 0;
    this.rewardedEnemies.clear();
    for (const enemy of this.regularEnemies) enemy.reset();
    if (!this.varkanDefeated) this.varkan.resetEncounter();
    else this.varkan.keepDefeated();
    if (!this.widowDefeated) this.widow.resetEncounter();
    else this.widow.keepDefeated();
    if (!this.oathkeeperDefeated) this.oathkeeper.resetEncounter();
    else this.oathkeeper.keepDefeated();
  }


  getSaveState(): CombatSaveState {
    return {
      varkanDefeated: this.varkanDefeated,
      widowDefeated: this.widowDefeated,
      oathkeeperDefeated: this.oathkeeperDefeated,
    };
  }

  restoreSaveState(state: CombatSaveState): void {
    this.varkanDefeated = Boolean(state.varkanDefeated);
    this.widowDefeated = Boolean(state.widowDefeated);
    this.oathkeeperDefeated = Boolean(state.oathkeeperDefeated);
    this.presentedBoss = this.oathkeeperDefeated
      ? this.oathkeeper
      : this.widowDefeated
        ? this.widow
        : this.varkan;
    this.resetAtRest();
  }

  consumeAshReward(): number {
    const reward = this.pendingAshReward;
    this.pendingAshReward = 0;
    return reward;
  }

  hasThreatNear(position: THREE.Vector3, radius: number): boolean {
    const radiusSquared = radius * radius;
    for (const enemy of this.enemies) {
      if (!enemy.isActive()) continue;
      enemy.getPosition(this.enemyPosition);
      if (this.enemyPosition.distanceToSquared(position) <= radiusSquared) return true;
    }
    return false;
  }

  updateVisual(delta: number): void {
    for (const enemy of this.enemies) enemy.updateVisual(delta);
    this.effects.update(delta);
  }

  setHighContrastTelegraphs(enabled: boolean): void {
    for (const boss of this.bosses) boss.setHighContrastTelegraphs(enabled);
  }

  getLockTargetPosition(): THREE.Vector3 | null {
    return this.lockedEnemy?.getLockSnapshot().position ?? null;
  }

  getLockSnapshot(): LockTargetSnapshot | null {
    if (!this.lockedEnemy) return null;
    const snapshot = this.lockedEnemy.getLockSnapshot();
    return {
      ...snapshot,
      executable: snapshot.executable && this.lockedEnemy.isExecutable(this.playerPosition),
    };
  }

  getBossSnapshot(): BossSnapshot {
    return (this.activeBoss ?? this.presentedBoss).getBossSnapshot();
  }

  consumeBossPresentationEvent(): BossPresentationEvent | null {
    for (const boss of this.bosses) {
      const event = boss.consumePresentationEvent();
      if (event) return event;
    }
    return null;
  }

  isBossEncounterActive(): boolean {
    return Boolean(this.activeBoss?.isEncounterActive());
  }

  isBossDefeated(): boolean {
    return this.varkanDefeated;
  }

  isWidowEncounterActive(): boolean {
    return this.widow.isEncounterActive();
  }

  isWidowDefeated(): boolean {
    return this.widowDefeated;
  }

  isOathkeeperEncounterActive(): boolean {
    return this.oathkeeper.isEncounterActive();
  }

  isOathkeeperDefeated(): boolean {
    return this.oathkeeperDefeated;
  }

  areAllBossesDefeated(): boolean {
    return this.varkanDefeated && this.widowDefeated && this.oathkeeperDefeated;
  }

  getBossWorldState(): BossWorldState {
    return {
      varkanActive: this.varkan.isEncounterActive(),
      varkanDefeated: this.varkanDefeated,
      widowActive: this.widow.isEncounterActive(),
      widowDefeated: this.widowDefeated,
      oathkeeperActive: this.oathkeeper.isEncounterActive(),
      oathkeeperDefeated: this.oathkeeperDefeated,
    };
  }

  consumeHitStop(): number {
    const duration = this.hitStop;
    this.hitStop = 0;
    return duration;
  }

  consumeCameraImpulse(): number {
    const impulse = this.cameraImpulse;
    this.cameraImpulse = 0;
    return impulse;
  }

  private tryStartBossEncounter(): void {
    if (this.activeBoss?.isEncounterActive()) return;
    this.activeBoss = null;
    if (!this.varkanDefeated
      && this.playerPosition.z <= GAME_CONFIG.world.bossTriggerZ
      && this.playerPosition.z > GAME_CONFIG.world.widowTriggerZ
      && this.playerPosition.y > -2) {
      this.activateBoss(this.varkan);
      return;
    }
    if (this.varkanDefeated
      && !this.widowDefeated
      && this.playerPosition.z <= GAME_CONFIG.world.widowTriggerZ
      && this.playerPosition.z > GAME_CONFIG.world.oathkeeperTriggerZ
      && this.playerPosition.y > -2) {
      this.activateBoss(this.widow);
      return;
    }
    if (this.widowDefeated
      && !this.oathkeeperDefeated
      && this.playerPosition.z <= GAME_CONFIG.world.oathkeeperTriggerZ
      && this.playerPosition.y > -2) {
      this.activateBoss(this.oathkeeper);
    }
  }

  private activateBoss(boss: BossEnemy): void {
    this.activeBoss = boss;
    this.presentedBoss = boss;
    boss.activateEncounter();
    for (const enemy of this.regularEnemies) {
      while (enemy.consumeAttackPulse()) {
        // Clear attacks committed outside the fog wall before the duel begins.
      }
    }
    this.lockedEnemy = boss;
    this.executingEnemy = null;
    this.cameraImpulse = Math.max(this.cameraImpulse, boss === this.oathkeeper ? 0.52 : boss === this.widow ? 0.36 : 0.22);
  }

  private coordinateAttackSlots(): void {
    if (this.activeBoss?.isEncounterActive()) {
      this.activeBoss.setAttackAllowed(true);
      for (const enemy of this.regularEnemies) enemy.setAttackAllowed(false);
      return;
    }

    const ranked = this.regularEnemies
      .filter((enemy) => enemy.isActive())
      .map((enemy) => {
        enemy.getPosition(this.enemyPosition);
        return { enemy, distanceSquared: this.enemyPosition.distanceToSquared(this.playerPosition) };
      })
      .sort((a, b) => a.distanceSquared - b.distanceSquared);

    let availableSlots = 2;
    for (const entry of ranked) {
      if (entry.enemy.isCommittedAttack()) {
        entry.enemy.setAttackAllowed(true);
        availableSlots = Math.max(0, availableSlots - 1);
      } else {
        entry.enemy.setAttackAllowed(false);
      }
    }
    for (const entry of ranked) {
      if (entry.enemy.isCommittedAttack()) continue;
      const closeEnough = entry.distanceSquared <= GAME_CONFIG.world.threatRadius * GAME_CONFIG.world.threatRadius;
      const allowed = closeEnough && availableSlots > 0;
      entry.enemy.setAttackAllowed(allowed);
      if (allowed) availableSlots -= 1;
    }
  }

  private findBestTarget(cameraForward: THREE.Vector3, playerPosition: THREE.Vector3): CombatEnemy | null {
    let best: CombatEnemy | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemies) {
      if (!enemy.isActive()) continue;
      enemy.getPosition(this.enemyPosition);
      this.toTarget.copy(this.enemyPosition).sub(playerPosition).setY(0);
      const distance = this.toTarget.length();
      const maxDistance = enemy === this.widow
        ? GAME_CONFIG.camera.lockMaxDistance * 1.55
        : enemy === this.oathkeeper
          ? GAME_CONFIG.camera.lockMaxDistance * 1.45
          : GAME_CONFIG.camera.lockMaxDistance;
      if (distance > maxDistance || distance < 0.001) continue;
      this.toTarget.multiplyScalar(1 / distance);
      const alignment = cameraForward.dot(this.toTarget);
      if (alignment < GAME_CONFIG.combat.lockSearchAngleCos) continue;
      const score = distance * (1.25 - alignment * 0.7);
      if (score < bestScore) {
        best = enemy;
        bestScore = score;
      }
    }
    return best;
  }

  private resolvePlayerAttack(pulse: AttackPulse): void {
    let hitCount = 0;
    for (const enemy of this.enemies) {
      if (!enemy.isActive()) continue;
      if (enemy === this.widow) {
        const bellResult = this.widow.tryHitBell(pulse);
        if (bellResult) {
          this.widow.getLastBellHitPosition(this.enemyPosition);
          this.resolvePlayerHitFeedback(bellResult, this.enemyPosition, pulse, enemy, false);
          hitCount += 1;
          continue;
        }
      }
      enemy.getPosition(this.enemyPosition);
      const verticalDifference = Math.abs(this.enemyPosition.y - pulse.position.y);
      this.toTarget.copy(this.enemyPosition).sub(pulse.position).setY(0);
      const distance = this.toTarget.length();
      if (distance > pulse.range || verticalDifference > GAME_CONFIG.combat.hitHeightTolerance || distance < 0.001) continue;
      this.toTarget.multiplyScalar(1 / distance);
      if (pulse.forward.dot(this.toTarget) < pulse.arcCos) continue;
      const result = enemy.receiveDamage(pulse.damage, pulse.poiseDamage, pulse.forward);
      if (result === 'ignored') continue;
      const hitPosition = enemy.getLockSnapshot().position.clone();
      this.resolvePlayerHitFeedback(result, hitPosition, pulse, enemy, true);
      hitCount += 1;
    }
    if (hitCount === 0) this.cameraImpulse = Math.max(this.cameraImpulse, 0.045);
  }

  private resolvePlayerHitFeedback(
    result: EnemyDamageResult,
    hitPosition: THREE.Vector3,
    pulse: AttackPulse,
    enemy: CombatEnemy,
    canAward: boolean,
  ): void {
    this.effects.spawnHit(hitPosition, pulse.weight === 'heavy');
    this.audio.impact(pulse.weight);
    this.cameraImpulse = Math.max(
      this.cameraImpulse,
      pulse.weight === 'heavy' ? 0.58 : pulse.weight === 'medium' ? 0.34 : 0.24,
    );
    this.hitStop = Math.max(
      this.hitStop,
      pulse.weight === 'heavy' ? 0.085 : pulse.weight === 'medium' ? 0.055 : 0.038,
    );
    if (result === 'killed' && canAward) this.awardEnemy(enemy);
    if (result === 'broken') {
      this.effects.spawnPostureBreak(hitPosition);
      this.audio.postureBreak();
      const bossHit = this.bosses.includes(enemy as BossEnemy);
      this.cameraImpulse = Math.max(this.cameraImpulse, bossHit ? 1.05 : 0.72);
      this.hitStop = Math.max(this.hitStop, bossHit ? 0.14 : 0.105);
      if (canAward) this.lockedEnemy = enemy;
    }
  }

  private awardEnemy(enemy: CombatEnemy): void {
    if (this.rewardedEnemies.has(enemy.id)) return;
    this.rewardedEnemies.add(enemy.id);
    this.pendingAshReward += enemy.ashReward;
    if (enemy === this.varkan || enemy === this.widow || enemy === this.oathkeeper) {
      this.presentedBoss = enemy as BossEnemy;
      if (enemy === this.varkan) this.varkanDefeated = true;
      if (enemy === this.widow) this.widowDefeated = true;
      if (enemy === this.oathkeeper) this.oathkeeperDefeated = true;
      this.activeBoss = null;
      this.lockedEnemy = null;
      this.executingEnemy = null;
      this.cameraImpulse = Math.max(this.cameraImpulse, enemy === this.oathkeeper ? 1.85 : enemy === this.widow ? 1.55 : 1.25);
      this.hitStop = Math.max(this.hitStop, enemy === this.oathkeeper ? 0.3 : enemy === this.widow ? 0.24 : 0.2);
    }
  }

  private resolveEnemyAttack(
    pulse: AttackPulse,
    player: PlayerController,
    attacker: CombatEnemy,
  ): void {
    player.getLockPoint(this.playerLockPoint);
    const verticalDifference = Math.abs(this.playerLockPoint.y - pulse.position.y);
    if (verticalDifference > (pulse.shape === 'line' ? 3.2 : GAME_CONFIG.combat.hitHeightTolerance)) return;
    this.toTarget.copy(this.playerLockPoint).sub(pulse.position).setY(0);
    const distance = this.toTarget.length();
    if (distance < 0.001) return;

    const shape = pulse.shape ?? (pulse.radial ? 'radial' : 'cone');
    if (shape === 'line') {
      this.attackForward.copy(pulse.forward).setY(0).normalize();
      const along = this.toTarget.dot(this.attackForward);
      const lateralSquared = Math.max(0, this.toTarget.lengthSq() - along * along);
      if (along < -0.3 || along > pulse.range || Math.sqrt(lateralSquared) > (pulse.width ?? 0.8)) return;
    } else if (shape === 'donut') {
      if (distance > pulse.range || distance < (pulse.innerRange ?? 0)) return;
    } else if (shape === 'radial') {
      if (distance > pulse.range) return;
    } else {
      if (distance > pulse.range) return;
      this.toTarget.multiplyScalar(1 / distance);
      if (pulse.forward.dot(this.toTarget) < pulse.arcCos) return;
    }

    const result = player.receiveDamage(
      pulse.damage,
      pulse.forward,
      pulse.impact,
      pulse.guardable ?? true,
      pulse.parryable ?? true,
    );
    if (result === 'hit') {
      this.effects.spawnHit(this.playerLockPoint, pulse.weight === 'heavy');
      this.audio.impact(pulse.weight);
      this.cameraImpulse = Math.max(this.cameraImpulse, pulse.weight === 'heavy' ? 0.78 : 0.44);
      this.hitStop = Math.max(this.hitStop, pulse.weight === 'heavy' ? 0.085 : 0.048);
    } else if (result === 'guarded') {
      this.effects.spawnGuard(this.playerLockPoint);
      this.audio.guard();
      const bossAttack = this.bosses.includes(attacker as BossEnemy);
      this.cameraImpulse = Math.max(this.cameraImpulse, bossAttack ? 0.46 : 0.3);
      this.hitStop = Math.max(this.hitStop, 0.03);
    } else if (result === 'parried') {
      const parryResult = attacker.receiveParry();
      this.effects.spawnParry(pulse.position.clone().addScaledVector(pulse.forward, 0.7));
      this.audio.parry();
      this.cameraImpulse = Math.max(this.cameraImpulse, parryResult === 'broken' ? 0.92 : 0.6);
      this.hitStop = Math.max(this.hitStop, 0.115);
      if (parryResult === 'broken') this.lockedEnemy = attacker;
    } else {
      this.effects.spawnEvade(this.playerLockPoint.clone().setY(this.playerPosition.y + 0.1));
      this.cameraImpulse = Math.max(this.cameraImpulse, pulse.weight === 'heavy' ? 0.2 : 0.14);
    }
  }
}
