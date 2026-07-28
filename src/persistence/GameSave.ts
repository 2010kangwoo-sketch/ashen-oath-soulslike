import type { CombatSaveState } from '../combat/CombatDirector';
import type { ProgressionSaveState } from '../progression/ProgressionDirector';

const SAVE_KEY = 'ashen-oath.save.v1';
const SAVE_VERSION = 1;

export interface GameSaveData {
  readonly version: typeof SAVE_VERSION;
  readonly savedAt: number;
  readonly playTimeSeconds: number;
  readonly progression: ProgressionSaveState;
  readonly combat: CombatSaveState;
}

export interface GameSaveSummary {
  readonly savedAt: number;
  readonly playTimeSeconds: number;
  readonly shrineName: string;
  readonly bossCount: number;
  readonly ash: number;
}

const SHRINE_NAMES: Readonly<Record<string, string>> = {
  gate: '무너진 성문',
  cloister: '종루 회랑',
  altar: '잿빛 제단',
  'widow-nave': '끊어진 종의 회랑',
  'last-bridge': '마지막 서약의 다리',
};
const VALID_SHRINES = new Set(Object.keys(SHRINE_NAMES));
const VALID_SHORTCUTS = new Set(['west-portcullis', 'bell-chain', 'altar-seal']);

export class GameSaveStore {
  hasSave(): boolean {
    return this.load() !== null;
  }

  load(): GameSaveData | null {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed['version'] !== SAVE_VERSION) return null;
      const rawProgression = sanitizeProgression(parsed['progression']);
      const combat = sanitizeCombat(parsed['combat']);
      if (!rawProgression || !combat) return null;
      const progression = normalizeProgressionForCombat(rawProgression, combat);
      return {
        version: SAVE_VERSION,
        savedAt: finiteNumber(parsed['savedAt'], Date.now(), 0),
        playTimeSeconds: finiteNumber(parsed['playTimeSeconds'], 0, 0),
        progression,
        combat,
      };
    } catch {
      return null;
    }
  }

  save(data: Omit<GameSaveData, 'version' | 'savedAt'>): GameSaveData | null {
    const completed: GameSaveData = {
      ...data,
      version: SAVE_VERSION,
      savedAt: Date.now(),
    };
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(completed));
      return completed;
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch {
      // A blocked storage backend simply means there is no persistent save to remove.
    }
  }

  getSummary(): GameSaveSummary | null {
    const save = this.load();
    if (!save) return null;
    const bosses = save.combat;
    return {
      savedAt: save.savedAt,
      playTimeSeconds: save.playTimeSeconds,
      shrineName: SHRINE_NAMES[save.progression.activeShrineId] ?? '알 수 없는 서약석',
      bossCount: Number(bosses.varkanDefeated) + Number(bosses.widowDefeated) + Number(bosses.oathkeeperDefeated),
      ash: Math.max(0, Math.floor(save.progression.ash)),
    };
  }
}

function sanitizeProgression(value: unknown): ProgressionSaveState | null {
  if (!isRecord(value)) return null;
  const activeShrineId = typeof value['activeShrineId'] === 'string' && VALID_SHRINES.has(value['activeShrineId'])
    ? value['activeShrineId']
    : 'gate';
  const activatedShrineIds = stringArray(value['activatedShrineIds']).filter((id) => VALID_SHRINES.has(id));
  if (!activatedShrineIds.includes('gate')) activatedShrineIds.unshift('gate');
  const openedShortcutIds = stringArray(value['openedShortcutIds']).filter((id) => VALID_SHORTCUTS.has(id));
  const endingsSeen = stringArray(value['endingsSeen']).filter((ending): ending is 'inherit' | 'sever' => ending === 'inherit' || ending === 'sever');
  const recoveryPosition = vectorTuple(value['recoveryPosition']);
  const recoveryAsh = finiteNumber(value['recoveryAsh'], 0, 0);
  return {
    ash: finiteNumber(value['ash'], 0, 0),
    recoveryAsh: recoveryPosition ? recoveryAsh : 0,
    recoveryPosition: recoveryAsh > 0 ? recoveryPosition : null,
    activeShrineId,
    activatedShrineIds: [...new Set(activatedShrineIds)],
    openedShortcutIds: [...new Set(openedShortcutIds)],
    endingsSeen: [...new Set(endingsSeen)],
  };
}


function normalizeProgressionForCombat(
  progression: ProgressionSaveState,
  combat: CombatSaveState,
): ProgressionSaveState {
  const allowedShrines = combat.widowDefeated
    ? new Set(['gate', 'cloister', 'altar', 'widow-nave', 'last-bridge'])
    : combat.varkanDefeated
      ? new Set(['gate', 'cloister', 'altar', 'widow-nave'])
      : new Set(['gate', 'cloister', 'altar']);
  const activatedShrineIds = progression.activatedShrineIds.filter((id) => allowedShrines.has(id));
  if (!activatedShrineIds.includes('gate')) activatedShrineIds.unshift('gate');
  const preferredOrder = ['last-bridge', 'widow-nave', 'altar', 'cloister', 'gate'];
  const activeShrineId = allowedShrines.has(progression.activeShrineId)
    ? progression.activeShrineId
    : preferredOrder.find((id) => activatedShrineIds.includes(id)) ?? 'gate';
  return { ...progression, activeShrineId, activatedShrineIds };
}

function sanitizeCombat(value: unknown): CombatSaveState | null {
  if (!isRecord(value)) return null;
  const varkanDefeated = Boolean(value['varkanDefeated']);
  const widowDefeated = varkanDefeated && Boolean(value['widowDefeated']);
  const oathkeeperDefeated = widowDefeated && Boolean(value['oathkeeperDefeated']);
  return { varkanDefeated, widowDefeated, oathkeeperDefeated };
}

function vectorTuple(value: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (![x, y, z].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  return [x as number, y as number, z as number];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function finiteNumber(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
