import type { GameSaveSummary } from '../persistence/GameSave';
import type { GameSettings, QualityPreset } from '../settings/GameSettings';

export interface GameMenuHandlers {
  readonly onNewGame: () => void;
  readonly onContinue: () => void;
  readonly onResume: () => void;
  readonly onRestartCheckpoint: () => void;
  readonly onRecoverTraversal: () => void;
  readonly onReturnToTitle: () => void;
  readonly onSettingsChanged: (settings: GameSettings) => void;
}

type SettingsReturnTarget = 'title' | 'pause';

export class GameMenu {
  private readonly titleScreen = this.requireElement('title-screen');
  private readonly pauseScreen = this.requireElement('pause-screen');
  private readonly settingsScreen = this.requireElement('settings-screen');
  private readonly continueButton = this.requireButton('continue-button');
  private readonly newGameButton = this.requireButton('new-game-button');
  private readonly saveSummary = this.requireElement('save-summary');
  private readonly qualitySelect = this.requireSelect('quality-setting');
  private readonly volumeRange = this.requireInput('volume-setting');
  private readonly shakeRange = this.requireInput('shake-setting');
  private readonly sensitivityRange = this.requireInput('sensitivity-setting');
  private readonly helpCheckbox = this.requireInput('help-setting');
  private readonly reducedMotionCheckbox = this.requireInput('reduced-motion-setting');
  private readonly telegraphContrastCheckbox = this.requireInput('telegraph-contrast-setting');
  private readonly uiScaleRange = this.requireInput('ui-scale-setting');
  private readonly volumeValue = this.requireElement('volume-value');
  private readonly shakeValue = this.requireElement('shake-value');
  private readonly sensitivityValue = this.requireElement('sensitivity-value');
  private readonly uiScaleValue = this.requireElement('ui-scale-value');
  private readonly autosaveIndicator = this.requireElement('autosave-indicator');
  private settingsReturnTarget: SettingsReturnTarget = 'title';
  private currentSettings: GameSettings;
  private autosaveTimer = 0;
  private newGameConfirmTimer = 0;
  private newGameArmed = false;
  private menuAxisY = 0;
  private menuAxisX = 0;
  private gamepadConfirmHeld = false;
  private gamepadBackHeld = false;

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

  update(): void {
    const visibleScreen = this.getVisibleScreen();
    if (!visibleScreen) {
      this.resetGamepadNavigation();
      return;
    }
    const gamepad = Array.from(navigator.getGamepads?.() ?? []).find((candidate): candidate is Gamepad => Boolean(candidate?.connected));
    if (!gamepad) {
      this.menuAxisY = 0;
      this.menuAxisX = 0;
      this.gamepadConfirmHeld = false;
      this.gamepadBackHeld = false;
      return;
    }

    const vertical = gamepad.buttons[12]?.pressed ? -1
      : gamepad.buttons[13]?.pressed ? 1
        : Math.abs(gamepad.axes[1] ?? 0) > 0.62 ? Math.sign(gamepad.axes[1] ?? 0) : 0;
    const horizontal = gamepad.buttons[14]?.pressed ? -1
      : gamepad.buttons[15]?.pressed ? 1
        : Math.abs(gamepad.axes[0] ?? 0) > 0.62 ? Math.sign(gamepad.axes[0] ?? 0) : 0;
    if (vertical !== 0 && this.menuAxisY === 0) this.moveFocus(visibleScreen, vertical);
    if (horizontal !== 0 && this.menuAxisX === 0) this.adjustFocusedControl(horizontal);
    this.menuAxisY = vertical;
    this.menuAxisX = horizontal;

    const confirm = Boolean(gamepad.buttons[0]?.pressed);
    if (confirm && !this.gamepadConfirmHeld) {
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && !active.disabled) active.click();
      else if (active instanceof HTMLInputElement && active.type === 'checkbox') active.click();
    }
    this.gamepadConfirmHeld = confirm;

    const back = Boolean(gamepad.buttons[1]?.pressed);
    if (back && !this.gamepadBackHeld) {
      if (this.isSettingsVisible()) this.closeSettings();
      else if (this.isPauseVisible()) this.handlers.onResume();
    }
    this.gamepadBackHeld = back;
  }

  showTitle(summary: GameSaveSummary | null): void {
    this.resetNewGameConfirmation();
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
    window.requestAnimationFrame(() => {
      (summary ? this.continueButton : this.newGameButton).focus();
    });
  }

  showPause(): void {
    this.titleScreen.classList.add('is-hidden');
    this.settingsScreen.classList.add('is-hidden');
    this.pauseScreen.classList.remove('is-hidden');
    window.requestAnimationFrame(() => this.requireButton('resume-button').focus());
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
    if (this.settingsReturnTarget === 'title') {
      this.titleScreen.classList.remove('is-hidden');
      window.requestAnimationFrame(() => this.requireButton('title-settings-button').focus());
    } else {
      this.pauseScreen.classList.remove('is-hidden');
      window.requestAnimationFrame(() => this.requireButton('pause-settings-button').focus());
    }
  }

  private bindEvents(): void {
    this.newGameButton.addEventListener('click', this.onNewGameClick);
    this.continueButton.addEventListener('click', this.handlers.onContinue);
    this.requireButton('title-settings-button').addEventListener('click', () => this.openSettings('title'));
    this.requireButton('resume-button').addEventListener('click', this.handlers.onResume);
    this.requireButton('restart-button').addEventListener('click', this.handlers.onRestartCheckpoint);
    this.requireButton('recover-traversal-button').addEventListener('click', this.handlers.onRecoverTraversal);
    this.requireButton('pause-settings-button').addEventListener('click', () => this.openSettings('pause'));
    this.requireButton('return-title-button').addEventListener('click', this.handlers.onReturnToTitle);
    this.requireButton('settings-back-button').addEventListener('click', () => this.closeSettings());
    this.qualitySelect.addEventListener('change', this.emitSettings);
    this.volumeRange.addEventListener('input', this.emitSettings);
    this.shakeRange.addEventListener('input', this.emitSettings);
    this.sensitivityRange.addEventListener('input', this.emitSettings);
    this.helpCheckbox.addEventListener('change', this.emitSettings);
    this.reducedMotionCheckbox.addEventListener('change', this.emitSettings);
    this.telegraphContrastCheckbox.addEventListener('change', this.emitSettings);
    this.uiScaleRange.addEventListener('input', this.emitSettings);
  }

  private readonly onNewGameClick = (): void => {
    if (this.continueButton.disabled || this.newGameArmed) {
      this.resetNewGameConfirmation();
      this.handlers.onNewGame();
      return;
    }
    this.newGameArmed = true;
    this.newGameButton.textContent = '기존 기록을 지우고 시작';
    this.newGameButton.classList.add('confirm-danger');
    this.newGameConfirmTimer = window.setTimeout(() => this.resetNewGameConfirmation(), 4200);
  };

  private resetNewGameConfirmation(): void {
    if (this.newGameConfirmTimer) window.clearTimeout(this.newGameConfirmTimer);
    this.newGameConfirmTimer = 0;
    this.newGameArmed = false;
    this.newGameButton.textContent = '새 서약';
    this.newGameButton.classList.remove('confirm-danger');
  }

  private openSettings(target: SettingsReturnTarget): void {
    this.settingsReturnTarget = target;
    this.titleScreen.classList.add('is-hidden');
    this.pauseScreen.classList.add('is-hidden');
    this.settingsScreen.classList.remove('is-hidden');
    window.requestAnimationFrame(() => this.qualitySelect.focus());
  }

  private getVisibleScreen(): HTMLElement | null {
    if (this.isSettingsVisible()) return this.settingsScreen;
    if (this.isPauseVisible()) return this.pauseScreen;
    if (this.isTitleVisible()) return this.titleScreen;
    return null;
  }

  private resetGamepadNavigation(): void {
    this.menuAxisY = 0;
    this.menuAxisX = 0;
    this.gamepadConfirmHeld = false;
    this.gamepadBackHeld = false;
  }

  private moveFocus(screen: HTMLElement, direction: number): void {
    const controls = [...screen.querySelectorAll<HTMLElement>('button:not(:disabled), select, input')]
      .filter((element) => element.offsetParent !== null);
    if (!controls.length) return;
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next = current < 0
      ? 0
      : (current + direction + controls.length) % controls.length;
    controls[next]?.focus();
  }

  private adjustFocusedControl(direction: number): void {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.type === 'range') {
      const step = Number(active.step || 1);
      const minimum = Number(active.min || 0);
      const maximum = Number(active.max || 100);
      active.value = String(Math.min(maximum, Math.max(minimum, Number(active.value) + step * direction)));
      active.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (active instanceof HTMLSelectElement) {
      active.selectedIndex = Math.min(active.options.length - 1, Math.max(0, active.selectedIndex + direction));
      active.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (active instanceof HTMLInputElement && active.type === 'checkbox') {
      active.checked = direction > 0;
      active.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  private readonly emitSettings = (): void => {
    const quality = this.qualitySelect.value as QualityPreset;
    this.currentSettings = {
      quality: quality === 'performance' || quality === 'cinematic' ? quality : 'balanced',
      masterVolume: Number(this.volumeRange.value),
      cameraShake: Number(this.shakeRange.value),
      mouseSensitivity: Number(this.sensitivityRange.value),
      showControlHelp: this.helpCheckbox.checked,
      reducedMotion: this.reducedMotionCheckbox.checked,
      highContrastTelegraphs: this.telegraphContrastCheckbox.checked,
      uiScale: Number(this.uiScaleRange.value),
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
    this.reducedMotionCheckbox.checked = settings.reducedMotion;
    this.telegraphContrastCheckbox.checked = settings.highContrastTelegraphs;
    this.uiScaleRange.value = String(settings.uiScale);
    this.updateSettingLabels();
  }

  private updateSettingLabels(): void {
    this.volumeValue.textContent = `${Math.round(Number(this.volumeRange.value) * 100)}%`;
    this.shakeValue.textContent = `${Math.round(Number(this.shakeRange.value) * 100)}%`;
    this.sensitivityValue.textContent = `${Number(this.sensitivityRange.value).toFixed(2)}×`;
    this.uiScaleValue.textContent = `${Math.round(Number(this.uiScaleRange.value) * 100)}%`;
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
