import type * as THREE from 'three';

export type PlayerAttackId = 'light1' | 'light2' | 'light3' | 'heavy';
export type PlayerSkillId = 'ashStep' | 'oathCounter' | 'cinderArc';

export type AttackShape = 'cone' | 'radial' | 'line' | 'donut';

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
  readonly shape?: AttackShape;
  readonly innerRange?: number;
  readonly width?: number;
  readonly skillId?: PlayerSkillId;
  readonly counterPower?: number;
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

export type BossPresentationEvent = 'intro' | 'phase2' | 'phase3' | 'defeated';

export interface BossSnapshot {
  readonly name: string;
  readonly epithet: string;
  readonly healthRatio: number;
  readonly poiseRatio: number;
  readonly shieldRatio: number;
  readonly phase: 1 | 2 | 3;
  readonly active: boolean;
  readonly intro: boolean;
  readonly phaseTransition: boolean;
  readonly defeated: boolean;
  readonly phaseLabel?: string;
  readonly secondaryLabel?: string;
  readonly transitionKicker?: string;
  readonly transitionTitle?: string;
  readonly victoryKicker?: string;
  readonly victoryTitle?: string;
  readonly mechanicName?: string;
  readonly mechanicHint?: string;
  readonly mechanicProgress?: number;
  readonly mechanicDanger?: boolean;
  readonly counterable?: boolean;
  readonly counterProgress?: number;
  readonly counterDowned?: boolean;
  readonly summonedAdds?: number;
}

export interface BossCounterSnapshot {
  readonly active: boolean;
  readonly progress: number;
  readonly downed: boolean;
}

export type BossSummonKind = 'oathguard' | 'broodling' | 'mirrorEcho';

export interface BossSummonRequest {
  readonly kind: BossSummonKind;
  readonly count: number;
  readonly origin: THREE.Vector3;
}

export interface PlayerSkillEvent {
  readonly skillId: PlayerSkillId;
  readonly phase: 'cast' | 'impact';
  readonly position: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly intensity: number;
}

export interface SkillCooldownEntry {
  readonly id: PlayerSkillId;
  readonly label: string;
  readonly key: 'Q' | 'E' | 'R';
  readonly remaining: number;
  readonly duration: number;
  readonly ratio: number;
  readonly ready: boolean;
}
