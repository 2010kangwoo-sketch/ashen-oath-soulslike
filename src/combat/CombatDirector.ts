import * as THREE from 'three';
import type { AudioDirector } from '../audio/AudioDirector';
import { GAME_CONFIG } from '../config/GameConfig';
import { AshenHound } from '../enemy/AshenHound';
import type { CombatEnemy } from '../enemy/CombatEnemy';
import { AshenSentinel } from '../enemy/AshenSentinel';
import { InputController } from '../input/InputController';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import type { AttackPulse, LockTargetSnapshot } from './CombatTypes';
import { CombatEffects } from './CombatEffects';

export class CombatDirector {
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

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    private readonly audio: AudioDirector,
  ) {
    this.effects = new CombatEffects(scene);
    this.enemies = [
      new AshenSentinel(
        scene,
        physics,
        'gate-sentinel',
        '잿빛 문지기',
        new THREE.Vector3(0, 1.12, 5.5),
        audio,
        0,
      ),
      new AshenSentinel(
        scene,
        physics,
        'east-sentinel',
        '부서진 방패의 기사',
        new THREE.Vector3(7.4, 1.12, -7.5),
        audio,
        1,
      ),
      new AshenHound(
        scene,
        physics,
        'west-hound',
        '재를 핥는 사냥개',
        new THREE.Vector3(-6.8, 0.82, -2.6),
        audio,
        1,
      ),
      new AshenHound(
        scene,
        physics,
        'nave-hound',
        '종지기의 사냥개',
        new THREE.Vector3(4.8, 0.82, -19.6),
        audio,
        -1,
      ),
    ];
  }

  handleTargeting(input: InputController, player: PlayerController, cameraForward: THREE.Vector3): void {
    if (!input.consumeAction('lockOn')) return;
    if (this.lockedEnemy?.isActive()) {
      this.lockedEnemy = null;
      return;
    }
    player.getWorldPosition(this.playerPosition);
    this.lockedEnemy = this.findBestTarget(cameraForward, this.playerPosition);
  }

  handleExecution(input: InputController, player: PlayerController): void {
    if (!input.consumeAction('execute') || this.executingEnemy || player.isDead()) return;
    player.getWorldPosition(this.playerPosition);
    const candidate = this.lockedEnemy;
    if (!candidate || !candidate.isExecutable(this.playerPosition)) return;
    const snapshot = candidate.getLockSnapshot();
    if (!player.beginExecution(snapshot.position)) return;
    candidate.beginExecution();
    this.executingEnemy = candidate;
    this.audio.postureBreak();
    this.effects.spawnPostureBreak(snapshot.position);
    this.cameraImpulse = Math.max(this.cameraImpulse, 0.34);
    this.hitStop = Math.max(this.hitStop, 0.055);
  }

  fixedUpdate(delta: number, player: PlayerController): void {
    player.getWorldPosition(this.playerPosition);
    if (player.isDead()) {
      this.lockedEnemy = null;
      this.executingEnemy = null;
      for (const enemy of this.enemies) enemy.consumeAttackPulse();
      return;
    }

    for (const enemy of this.enemies) enemy.fixedUpdate(delta, this.playerPosition);

    const playerPulse = player.consumeAttackPulse();
    if (playerPulse) this.resolvePlayerAttack(playerPulse);

    for (const enemy of this.enemies) {
      if (player.isDead()) break;
      const pulse = enemy.consumeAttackPulse();
      if (pulse) this.resolveEnemyAttack(pulse, player, enemy);
    }

    if (player.consumeExecutionImpact() && this.executingEnemy) {
      const snapshot = this.executingEnemy.getLockSnapshot();
      this.executingEnemy.finishExecution();
      this.effects.spawnExecution(snapshot.position);
      this.audio.execution();
      this.cameraImpulse = Math.max(this.cameraImpulse, 0.92);
      this.hitStop = Math.max(this.hitStop, 0.16);
      this.executingEnemy = null;
    }

    if (this.lockedEnemy) {
      const snapshot = this.lockedEnemy.getLockSnapshot();
      const distance = snapshot.position.distanceTo(this.playerPosition);
      if (!snapshot.active || distance > GAME_CONFIG.camera.lockMaxDistance * 1.25) this.lockedEnemy = null;
    }
  }

  reset(): void {
    this.lockedEnemy = null;
    this.executingEnemy = null;
    this.cameraImpulse = 0;
    this.hitStop = 0;
    for (const enemy of this.enemies) enemy.reset();
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
      if (result === 'broken') {
        this.effects.spawnPostureBreak(hitPosition);
        this.audio.postureBreak();
        this.cameraImpulse = Math.max(this.cameraImpulse, 0.72);
        this.hitStop = Math.max(this.hitStop, 0.105);
        this.lockedEnemy = enemy;
      }
      hitCount += 1;
    }
    if (hitCount === 0) this.cameraImpulse = Math.max(this.cameraImpulse, 0.045);
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
    if (pulse.forward.dot(this.toTarget) < pulse.arcCos) return;

    const result = player.receiveDamage(pulse.damage, pulse.forward, pulse.impact);
    if (result === 'hit') {
      this.effects.spawnHit(this.playerLockPoint, pulse.weight === 'heavy');
      this.audio.impact(pulse.weight);
      this.cameraImpulse = Math.max(this.cameraImpulse, pulse.weight === 'heavy' ? 0.68 : 0.44);
      this.hitStop = Math.max(this.hitStop, pulse.weight === 'heavy' ? 0.075 : 0.048);
    } else if (result === 'guarded') {
      this.effects.spawnGuard(this.playerLockPoint);
      this.audio.guard();
      this.cameraImpulse = Math.max(this.cameraImpulse, 0.3);
      this.hitStop = Math.max(this.hitStop, 0.03);
    } else if (result === 'parried') {
      const parryResult = attacker.receiveParry();
      this.effects.spawnParry(pulse.position.clone().addScaledVector(pulse.forward, 0.7));
      this.audio.parry();
      this.cameraImpulse = Math.max(this.cameraImpulse, parryResult === 'broken' ? 0.82 : 0.6);
      this.hitStop = Math.max(this.hitStop, 0.115);
      if (parryResult === 'broken') this.lockedEnemy = attacker;
    } else {
      this.effects.spawnEvade(this.playerLockPoint.clone().setY(this.playerPosition.y + 0.1));
      this.cameraImpulse = Math.max(this.cameraImpulse, 0.14);
    }
  }
}
