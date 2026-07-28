export type QualityPreset = 'performance' | 'balanced' | 'cinematic';

export interface GameSettings {
  readonly quality: QualityPreset;
  readonly masterVolume: number;
  readonly cameraShake: number;
  readonly mouseSensitivity: number;
  readonly showControlHelp: boolean;
}

const SETTINGS_KEY = 'ashen-oath.settings.v1';

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  quality: 'balanced',
  masterVolume: 0.8,
  cameraShake: 0.78,
  mouseSensitivity: 1,
  showControlHelp: true,
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
    masterVolume: clamp(settings.masterVolume ?? DEFAULT_GAME_SETTINGS.masterVolume, 0, 1),
    cameraShake: clamp(settings.cameraShake ?? DEFAULT_GAME_SETTINGS.cameraShake, 0, 1),
    mouseSensitivity: clamp(settings.mouseSensitivity ?? DEFAULT_GAME_SETTINGS.mouseSensitivity, 0.5, 1.6),
    showControlHelp: settings.showControlHelp ?? DEFAULT_GAME_SETTINGS.showControlHelp,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
