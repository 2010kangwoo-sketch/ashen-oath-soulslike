import * as THREE from 'three';
import type { AudioDirector } from '../audio/AudioDirector';
import { GAME_CONFIG } from '../config/GameConfig';
import { AshenHound } from '../enemy/AshenHound';
import { AshenSentinel } from '../enemy/AshenSentinel';
import { AshenSpearman } from '../enemy/AshenSpearman';
import { BellKeeper } from '../enemy/BellKeeper';
import type { CombatEnemy } from '../enemy/CombatEnemy';
import {
  GatewardenVarkan,
  type BossPresentationEvent,
} from '../enemy/GatewardenVarkan';
import { InputController } from '../input/InputController';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import type { AttackPulse, BossSnapshot, LockTargetSnapshot } from './CombatTypes';
import { CombatEffects } from './CombatEffects';

export class CombatDirector {
  private readonly regularEnemies: CombatEnemy[];
  private readonly boss: GatewardenVarkan;
  private readonly enemies: CombatEnemy[];
  private readonly effects: CombatEffects;
  private readonly playerPosition = new THREE.Vector3();
  private readonly playerLockPoint = new THREE.Vector3();
  private readonly enemyPosition = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private lockedEnemy: CombatEnemy | null = null;
  private executingEnemy: CombatEnemy | null = null;
  private cameraImpulse = 0;
  private hitStop = 0;
  private pendingAshReward = 0;
  private readonly rewardedEnemies = new Set<string>();
  private bossDefeated = false;

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
    this.boss = new GatewardenVarkan(scene, physics, new THREE.Vector3(0, 3.2, -105.5), audio);
    this.enemies = [...this.regularEnemies, this.boss];
  }

  handleTargeting(input: InputController, player: PlayerController, cameraForward: THREE.Vector3): void {
    if (!input.consumeAction('lockOn')) return;
    if (this.lockedEnemy?.isActive()) {
      this.lockedEnemy = null;
      return;
    }
    player.getWorldPosition(this.playerPosition);
    this.lockedEnemy = this.boss.isEncounterActive()
      ? this.boss
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
    if (!this.bossDefeated && !this.boss.isEncounterActive()
      && this.playerPosition.z <= GAME_CONFIG.world.bossTriggerZ
      && this.playerPosition.y > -2) {
      this.boss.activateEncounter();
      for (const enemy of this.regularEnemies) {
        while (enemy.consumeAttackPulse()) {
          // Clear attacks committed outside the fog wall before the duel begins.
        }
      }
      this.lockedEnemy = this.boss;
      this.executingEnemy = null;
      this.cameraImpulse = Math.max(this.cameraImpulse, 0.22);
    }

    if (player.isDead()) {
      this.lockedEnemy = null;
      this.executingEnemy = null;
      if (this.boss.isEncounterActive() && !this.bossDefeated) this.boss.abortEncounter();
      for (const enemy of this.enemies) {
        while (enemy.consumeAttackPulse()) {
          // Drain all queued attacks so none survive the death transition.
        }
      }
      return;
    }

    this.coordinateAttackSlots();
    const activeEnemies: readonly CombatEnemy[] = this.boss.isEncounterActive()
      ? [this.boss]
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
      const distance = snapshot.position.distanceTo(this.playerPosition);
      if (!snapshot.active || distance > GAME_CONFIG.camera.lockMaxDistance * 1.4) this.lockedEnemy = null;
    }
  }

  reset(): void {
    this.lockedEnemy = null;
    this.executingEnemy = null;
    this.cameraImpulse = 0;
    this.hitStop = 0;
    this.pendingAshReward = 0;
    this.rewardedEnemies.clear();
    this.bossDefeated = false;
    for (const enemy of this.regularEnemies) enemy.reset();
    this.boss.resetEncounter();
  }

  resetAtRest(): void {
    this.lockedEnemy = null;
    this.executingEnemy = null;
    this.cameraImpulse = 0;
    this.hitStop = 0;
    this.pendingAshReward = 0;
    this.rewardedEnemies.clear();
    for (const enemy of this.regularEnemies) enemy.reset();
    if (!this.bossDefeated) this.boss.resetEncounter();
    else this.boss.keepDefeated();
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
    return this.boss.getBossSnapshot();
  }

  consumeBossPresentationEvent(): BossPresentationEvent | null {
    return this.boss.consumePresentationEvent();
  }

  isBossEncounterActive(): boolean {
    return this.boss.isEncounterActive();
  }

  isBossDefeated(): boolean {
    return this.bossDefeated;
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

  private coordinateAttackSlots(): void {
    if (this.boss.isEncounterActive()) {
      this.boss.setAttackAllowed(true);
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
      if (distance > GAME_CONFIG.camera.lockMaxDistance || distance < 0.001) continue;
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
      enemy.getPosition(this.enemyPosition);
      const verticalDifference = Math.abs(this.enemyPosition.y - pulse.position.y);
      this.toTarget.copy(this.enemyPosition).sub(pulse.position).setY(0);
      const distance = this.toTarget.length();
      if (distance > pulse.range || verticalDifference > GAME_CONFIG.combat.hitHeightTolerance || distance < 0.001) continue;
      this.toTarget.multiplyScalar(1 / distance);
      if (pulse.forward.dot(this.toTarget) < pulse.arcCos) continue;
      const result = enemy.receiveDamage(pulse.damage, pulse.poiseDamage, pulse.forward);
      if (result === 'ignored') continue;

      const snapshot = enemy.getLockSnapshot();
      const hitPosition = snapshot.position.clone();
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
      if (result === 'killed') this.awardEnemy(enemy);
      if (result === 'broken') {
        this.effects.spawnPostureBreak(hitPosition);
        this.audio.postureBreak();
        this.cameraImpulse = Math.max(this.cameraImpulse, enemy === this.boss ? 1.05 : 0.72);
        this.hitStop = Math.max(this.hitStop, enemy === this.boss ? 0.14 : 0.105);
        this.lockedEnemy = enemy;
      }
      hitCount += 1;
    }
    if (hitCount === 0) this.cameraImpulse = Math.max(this.cameraImpulse, 0.045);
  }

  private awardEnemy(enemy: CombatEnemy): void {
    if (this.rewardedEnemies.has(enemy.id)) return;
    this.rewardedEnemies.add(enemy.id);
    this.pendingAshReward += enemy.ashReward;
    if (enemy === this.boss) {
      this.bossDefeated = true;
      this.lockedEnemy = null;
      this.executingEnemy = null;
      this.cameraImpulse = Math.max(this.cameraImpulse, 1.25);
      this.hitStop = Math.max(this.hitStop, 0.2);
    }
  }

  private resolveEnemyAttack(
    pulse: AttackPulse,
    player: PlayerController,
    attacker: CombatEnemy,
  ): void {
    player.getLockPoint(this.playerLockPoint);
    const verticalDifference = Math.abs(this.playerLockPoint.y - pulse.position.y);
    this.toTarget.copy(this.playerLockPoint).sub(pulse.position).setY(0);
    const distance = this.toTarget.length();
    if (distance > pulse.range || verticalDifference > GAME_CONFIG.combat.hitHeightTolerance || distance < 0.001) return;
    this.toTarget.multiplyScalar(1 / distance);
    if (!pulse.radial && pulse.forward.dot(this.toTarget) < pulse.arcCos) return;

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
      this.cameraImpulse = Math.max(this.cameraImpulse, attacker === this.boss ? 0.46 : 0.3);
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
