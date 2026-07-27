import type * as THREE from 'three';

export type PlayerAttackId = 'light1' | 'light2' | 'light3' | 'heavy';

export interface AttackPulse {
  readonly source: 'player' | 'enemy';
  readonly position: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly range: number;
  readonly arcCos: number;
  readonly damage: number;
  readonly poiseDamage: number;
  readonly impact: number;
  readonly weight: 'light' | 'medium' | 'heavy';
  readonly guardable?: boolean;
  readonly parryable?: boolean;
  readonly radial?: boolean;
}

export type EnemyDamageResult = 'ignored' | 'hit' | 'broken' | 'killed';

export interface LockTargetSnapshot {
  readonly name: string;
  readonly position: THREE.Vector3;
  readonly healthRatio: number;
  readonly poiseRatio: number;
  readonly executable: boolean;
  readonly active: boolean;
}

export interface BossSnapshot {
  readonly name: string;
  readonly epithet: string;
  readonly healthRatio: number;
  readonly poiseRatio: number;
  readonly shieldRatio: number;
  readonly phase: 1 | 2;
  readonly active: boolean;
  readonly intro: boolean;
  readonly phaseTransition: boolean;
  readonly defeated: boolean;
}
