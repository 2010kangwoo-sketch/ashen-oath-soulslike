import type * as THREE from 'three';

export type PlayerAttackId = 'light1' | 'light2' | 'heavy';

export interface AttackPulse {
  readonly source: 'player' | 'enemy';
  readonly position: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly range: number;
  readonly arcCos: number;
  readonly damage: number;
  readonly poiseDamage: number;
  readonly impact: number;
}

export interface LockTargetSnapshot {
  readonly name: string;
  readonly position: THREE.Vector3;
  readonly healthRatio: number;
  readonly active: boolean;
}
