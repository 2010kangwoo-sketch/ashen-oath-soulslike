import type { GameSaveSummary } from '../persistence/GameSave';
import type { GameSettings, QualityPreset } from '../settings/GameSettings';

export interface GameMenuHandlers {
  readonly onNewGame: () => void;
  readonly onContinue: () => void;
  readonly onResume: () => void;
  readonly onRestartCheckpoint: () => void;
  readonly onReturnToTitle: () => void;
  readonly onSettingsChanged: (settings: GameSettings) => void;
}

type SettingsReturnTarget = 'title' | 'pause';

export class GameMenu {
  private readonly titleScreen = this.requireElement('title-screen');
  private readonly pauseScreen = this.requireElement('pause-screen');
  private readonly settingsScreen = this.requireElement('settings-screen');
  private readonly continueButton = this.requireButton('continue-button');
  private readonly saveSummary = this.requireElement('save-summary');
  private readonly qualitySelect = this.requireSelect('quality-setting');
  private readonly volumeRange = this.requireInput('volume-setting');
  private readonly shakeRange = this.requireInput('shake-setting');
  private readonly sensitivityRange = this.requireInput('sensitivity-setting');
  private readonly helpCheckbox = this.requireInput('help-setting');
  private readonly volumeValue = this.requireElement('volume-value');
  private readonly shakeValue = this.requireElement('shake-value');
  private readonly sensitivityValue = this.requireElement('sensitivity-value');
  private readonly autosaveIndicator = this.requireElement('autosave-indicator');
  private settingsReturnTarget: SettingsReturnTarget = 'title';
  private currentSettings: GameSettings;
  private autosaveTimer = 0;

  constructor(
    initialSettings: GameSettings,
    private readonly handlers: GameMenuHandlers,
  ) {
    this.currentSettings = initialSettings;
    this.bindEvents();
    this.populateSettings(initialSettings);
  }


  setSettings(settings: GameSettings): void {
    this.currentSettings = settings;
    this.populateSettings(settings);
  }

  showTitle(summary: GameSaveSummary | null): void {
    this.settingsScreen.classList.add('is-hidden');
    this.pauseScreen.classList.add('is-hidden');
    this.titleScreen.classList.remove('is-hidden');
    this.continueButton.disabled = summary === null;
    this.continueButton.setAttribute('aria-disabled', String(summary === null));
    this.saveSummary.classList.toggle('is-hidden', summary === null);
    if (summary) {
      const hours = Math.floor(summary.playTimeSeconds / 3600);
      const minutes = Math.floor((summary.playTimeSeconds % 3600) / 60);
      const time = hours > 0 ? `${hours}시간 ${minutes}분` : `${Math.max(1, minutes)}분`;
      const date = new Intl.DateTimeFormat('ko-KR', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(new Date(summary.savedAt));
      this.saveSummary.textContent = `${summary.shrineName} · 보스 ${summary.bossCount}/3 · 재 ${summary.ash.toLocaleString('ko-KR')} · ${time} · ${date}`;
    }
  }

  showPause(): void {
    this.titleScreen.classList.add('is-hidden');
    this.settingsScreen.classList.add('is-hidden');
    this.pauseScreen.classList.remove('is-hidden');
  }

  hideAll(): void {
    this.titleScreen.classList.add('is-hidden');
    this.pauseScreen.classList.add('is-hidden');
    this.settingsScreen.classList.add('is-hidden');
  }

  showAutosave(): void {
    if (this.autosaveTimer) window.clearTimeout(this.autosaveTimer);
    this.autosaveIndicator.classList.remove('is-hidden');
    this.autosaveIndicator.classList.remove('autosave-complete');
    void this.autosaveIndicator.offsetWidth;
    this.autosaveIndicator.classList.add('autosave-complete');
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveIndicator.classList.add('is-hidden');
      this.autosaveTimer = 0;
    }, 1450);
  }

  isTitleVisible(): boolean {
    return !this.titleScreen.classList.contains('is-hidden');
  }

  isPauseVisible(): boolean {
    return !this.pauseScreen.classList.contains('is-hidden');
  }

  isSettingsVisible(): boolean {
    return !this.settingsScreen.classList.contains('is-hidden');
  }

  closeSettings(): void {
    this.settingsScreen.classList.add('is-hidden');
    if (this.settingsReturnTarget === 'title') this.titleScreen.classList.remove('is-hidden');
    else this.pauseScreen.classList.remove('is-hidden');
  }

  private bindEvents(): void {
    this.requireButton('new-game-button').addEventListener('click', this.handlers.onNewGame);
    this.continueButton.addEventListener('click', this.handlers.onContinue);
    this.requireButton('title-settings-button').addEventListener('click', () => this.openSettings('title'));
    this.requireButton('resume-button').addEventListener('click', this.handlers.onResume);
    this.requireButton('restart-button').addEventListener('click', this.handlers.onRestartCheckpoint);
    this.requireButton('pause-settings-button').addEventListener('click', () => this.openSettings('pause'));
    this.requireButton('return-title-button').addEventListener('click', this.handlers.onReturnToTitle);
    this.requireButton('settings-back-button').addEventListener('click', () => this.closeSettings());
    this.qualitySelect.addEventListener('change', this.emitSettings);
    this.volumeRange.addEventListener('input', this.emitSettings);
    this.shakeRange.addEventListener('input', this.emitSettings);
    this.sensitivityRange.addEventListener('input', this.emitSettings);
    this.helpCheckbox.addEventListener('change', this.emitSettings);
  }

  private openSettings(target: SettingsReturnTarget): void {
    this.settingsReturnTarget = target;
    this.titleScreen.classList.add('is-hidden');
    this.pauseScreen.classList.add('is-hidden');
    this.settingsScreen.classList.remove('is-hidden');
  }

  private readonly emitSettings = (): void => {
    const quality = this.qualitySelect.value as QualityPreset;
    this.currentSettings = {
      quality: quality === 'performance' || quality === 'cinematic' ? quality : 'balanced',
      masterVolume: Number(this.volumeRange.value),
      cameraShake: Number(this.shakeRange.value),
      mouseSensitivity: Number(this.sensitivityRange.value),
      showControlHelp: this.helpCheckbox.checked,
    };
    this.updateSettingLabels();
    this.handlers.onSettingsChanged(this.currentSettings);
  };

  private populateSettings(settings: GameSettings): void {
    this.qualitySelect.value = settings.quality;
    this.volumeRange.value = String(settings.masterVolume);
    this.shakeRange.value = String(settings.cameraShake);
    this.sensitivityRange.value = String(settings.mouseSensitivity);
    this.helpCheckbox.checked = settings.showControlHelp;
    this.updateSettingLabels();
  }

  private updateSettingLabels(): void {
    this.volumeValue.textContent = `${Math.round(Number(this.volumeRange.value) * 100)}%`;
    this.shakeValue.textContent = `${Math.round(Number(this.shakeRange.value) * 100)}%`;
    this.sensitivityValue.textContent = `${Number(this.sensitivityRange.value).toFixed(2)}×`;
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Required menu element is missing: #${id}`);
    return element;
  }

  private requireButton(id: string): HTMLButtonElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Required button is missing: #${id}`);
    return element;
  }

  private requireInput(id: string): HTMLInputElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLInputElement)) throw new Error(`Required input is missing: #${id}`);
    return element;
  }

  private requireSelect(id: string): HTMLSelectElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLSelectElement)) throw new Error(`Required select is missing: #${id}`);
    return element;
  }
}
