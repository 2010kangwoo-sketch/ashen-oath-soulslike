import type {
  BossCounterSnapshot,
  BossPresentationEvent,
  BossSnapshot,
  BossSummonRequest,
  EnemyDamageResult,
} from '../combat/CombatTypes';
import type { CombatEnemy } from './CombatEnemy';

export interface BossEnemy extends CombatEnemy {
  activateEncounter(): void;
  abortEncounter(): void;
  resetEncounter(): void;
  keepDefeated(): void;
  isEncounterActive(): boolean;
  isDefeated(): boolean;
  getBossSnapshot(): BossSnapshot;
  consumePresentationEvent(): BossPresentationEvent | null;
  setHighContrastTelegraphs(enabled: boolean): void;
  getCounterSnapshot(): BossCounterSnapshot;
  receiveCounter(): EnemyDamageResult;
  consumeSummonRequest(): BossSummonRequest | null;
}
