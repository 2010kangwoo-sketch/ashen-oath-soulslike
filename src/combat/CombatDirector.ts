import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import { AshenSentinel } from '../enemy/AshenSentinel';
import { InputController } from '../input/InputController';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import type { AttackPulse, LockTargetSnapshot } from './CombatTypes';
import { CombatEffects } from './CombatEffects';

export class CombatDirector {
  private readonly enemies: AshenSentinel[];
  private readonly effects: CombatEffects;
  private readonly playerPosition = new THREE.Vector3();
  private readonly playerLockPoint = new THREE.Vector3();
  private readonly enemyPosition = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private lockedEnemy: AshenSentinel | null = null;
  private cameraImpulse = 0;
  private hitStop = 0;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.effects = new CombatEffects(scene);
    this.enemies = [
      new AshenSentinel(scene, physics, 'gate-sentinel', '잿빛 문지기', new THREE.Vector3(0, 1.12, 5.5), 0),
      new AshenSentinel(scene, physics, 'east-sentinel', '부서진 방패의 기사', new THREE.Vector3(7.4, 1.12, -7.5), 1),
    ];
  }

  handleTargeting(input: InputController, player: PlayerController, cameraForward: THREE.Vector3): void {
    if (!input.consumeAction('lockOn')) return;
    if (this.lockedEnemy?.isActive()) {
      this.lockedEnemy = null;
      return;
    }
    player.getWorldPosition(this.playerPosition);
    let best: AshenSentinel | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemies) {
      if (!enemy.isActive()) continue;
      enemy.getPosition(this.enemyPosition);
      this.toTarget.copy(this.enemyPosition).sub(this.playerPosition).setY(0);
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
    this.lockedEnemy = best;
  }

  fixedUpdate(delta: number, player: PlayerController): void {
    player.getWorldPosition(this.playerPosition);
    if (player.isDead()) {
      this.lockedEnemy = null;
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

    if (this.lockedEnemy) {
      const snapshot = this.lockedEnemy.getLockSnapshot();
      const distance = snapshot.position.distanceTo(this.playerPosition);
      if (!snapshot.active || distance > GAME_CONFIG.camera.lockMaxDistance * 1.25) this.lockedEnemy = null;
    }
  }

  reset(): void {
    this.lockedEnemy = null;
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
    return this.lockedEnemy?.getLockSnapshot() ?? null;
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
      if (enemy.receiveDamage(pulse.damage, pulse.poiseDamage, pulse.forward)) {
        const hitPosition = this.enemyPosition.clone().add(new THREE.Vector3(0, 0.9, 0));
        const heavy = pulse.damage >= 50;
        this.effects.spawnHit(hitPosition, heavy);
        this.cameraImpulse = Math.max(this.cameraImpulse, heavy ? 0.5 : 0.24);
        this.hitStop = Math.max(this.hitStop, heavy ? 0.075 : 0.038);
        hitCount += 1;
      }
    }
    if (hitCount === 0) this.cameraImpulse = Math.max(this.cameraImpulse, 0.05);
  }

  private resolveEnemyAttack(
    pulse: AttackPulse,
    player: PlayerController,
    attacker: AshenSentinel,
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
      this.effects.spawnHit(this.playerLockPoint, pulse.damage >= 38);
      this.cameraImpulse = Math.max(this.cameraImpulse, pulse.damage >= 38 ? 0.66 : 0.42);
      this.hitStop = Math.max(this.hitStop, pulse.damage >= 38 ? 0.07 : 0.048);
    } else if (result === 'guarded') {
      this.effects.spawnHit(this.playerLockPoint, false);
      this.cameraImpulse = Math.max(this.cameraImpulse, 0.28);
      this.hitStop = Math.max(this.hitStop, 0.026);
    } else if (result === 'parried') {
      attacker.receiveParry();
      this.effects.spawnHit(pulse.position.clone().addScaledVector(pulse.forward, 0.7), true);
      this.cameraImpulse = Math.max(this.cameraImpulse, 0.58);
      this.hitStop = Math.max(this.hitStop, 0.11);
    } else {
      this.effects.spawnEvade(this.playerLockPoint.clone().setY(this.playerPosition.y + 0.1));
      this.cameraImpulse = Math.max(this.cameraImpulse, 0.14);
    }
  }
}
