export type QualityPreset = 'performance' | 'balanced' | 'cinematic';

export interface GameSettings {
  readonly quality: QualityPreset;
  readonly masterVolume: number;
  readonly cameraShake: number;
  readonly mouseSensitivity: number;
  readonly showControlHelp: boolean;
  readonly reducedMotion: boolean;
  readonly highContrastTelegraphs: boolean;
  readonly uiScale: number;
}

const SETTINGS_KEY = 'ashen-oath.settings.v1';

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  quality: 'balanced',
  masterVolume: 0.8,
  cameraShake: 0.78,
  mouseSensitivity: 1,
  showControlHelp: true,
  reducedMotion: false,
  highContrastTelegraphs: false,
  uiScale: 1,
};

export class GameSettingsStore {
  load(): GameSettings {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return DEFAULT_GAME_SETTINGS;
      return sanitizeSettings(JSON.parse(raw) as Partial<GameSettings>);
    } catch {
      return DEFAULT_GAME_SETTINGS;
    }
  }

  save(settings: GameSettings): void {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
    } catch {
      // Settings remain active for the current session when storage is unavailable.
    }
  }
}

export function sanitizeSettings(settings: Partial<GameSettings>): GameSettings {
  const quality = settings.quality === 'performance' || settings.quality === 'cinematic'
    ? settings.quality
    : 'balanced';
  return {
    quality,
    masterVolume: clamp(settings.masterVolume, 0, 1, DEFAULT_GAME_SETTINGS.masterVolume),
    cameraShake: clamp(settings.cameraShake, 0, 1, DEFAULT_GAME_SETTINGS.cameraShake),
    mouseSensitivity: clamp(settings.mouseSensitivity, 0.5, 1.6, DEFAULT_GAME_SETTINGS.mouseSensitivity),
    showControlHelp: booleanOr(settings.showControlHelp, DEFAULT_GAME_SETTINGS.showControlHelp),
    reducedMotion: booleanOr(settings.reducedMotion, DEFAULT_GAME_SETTINGS.reducedMotion),
    highContrastTelegraphs: booleanOr(settings.highContrastTelegraphs, DEFAULT_GAME_SETTINGS.highContrastTelegraphs),
    uiScale: clamp(settings.uiScale, 0.9, 1.25, DEFAULT_GAME_SETTINGS.uiScale),
  };
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, safe));
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
