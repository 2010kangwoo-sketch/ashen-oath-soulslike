import type * as THREE from 'three';
import type { AttackPulse, EnemyDamageResult, LockTargetSnapshot } from '../combat/CombatTypes';

export interface CombatEnemy {
  readonly id: string;
  readonly displayName: string;
  readonly ashReward: number;
  readonly root: THREE.Group;
  fixedUpdate(delta: number, playerPosition: THREE.Vector3): void;
  updateVisual(delta: number): void;
  consumeAttackPulse(): AttackPulse | null;
  getLockSnapshot(): LockTargetSnapshot;
  getPosition(target: THREE.Vector3): THREE.Vector3;
  isActive(): boolean;
  isCommittedAttack(): boolean;
  setAttackAllowed(allowed: boolean): void;
  isExecutable(playerPosition: THREE.Vector3): boolean;
  beginExecution(): void;
  finishExecution(): void;
  receiveParry(): EnemyDamageResult;
  receiveDamage(damage: number, poiseDamage: number, impactDirection: THREE.Vector3): EnemyDamageResult;
  reset(): void;
}
