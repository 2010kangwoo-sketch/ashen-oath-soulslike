export type MoveAxes = Readonly<{ horizontal: number; vertical: number }>;
export type LookAxes = Readonly<{ horizontal: number; vertical: number }>;
export type CombatAction =
  | 'lightAttack'
  | 'heavyAttack'
  | 'dodge'
  | 'lockOn'
  | 'parry'
  | 'interact'
  | 'heal'
  | 'skillQ'
  | 'skillE'
  | 'skillR';

const BLOCKED_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'Tab', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyC', 'Digit1',
]);

export class InputController {
  private readonly held = new Set<string>();
  private readonly pressedActions = new Set<CombatAction>();
  private readonly previousGamepadButtons = new Map<number, boolean>();
  private moveAxes: MoveAxes = { horizontal: 0, vertical: 0 };
  private lookAxes: LookAxes = { horizontal: 0, vertical: 0 };
  private running = false;
  private guarding = false;
  private mouseGuarding = false;
  private mouseHeavyHeld = false;
  private gamepadHeavyHeld = false;
  private enabled = false;
  private preferredGamepadIndex: number | null = null;
  private activeGamepadName = '';
  private lastInputDevice: 'keyboard/mouse' | 'gamepad' = 'keyboard/mouse';

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
  }

  update(): void {
    if (!this.enabled) {
      this.moveAxes = { horizontal: 0, vertical: 0 };
      this.lookAxes = { horizontal: 0, vertical: 0 };
      this.running = false;
      this.guarding = false;
      return;
    }
    const keyboardX = Number(this.held.has('KeyD') || this.held.has('ArrowRight'))
      - Number(this.held.has('KeyA') || this.held.has('ArrowLeft'));
    const keyboardY = Number(this.held.has('KeyW') || this.held.has('ArrowUp'))
      - Number(this.held.has('KeyS') || this.held.has('ArrowDown'));

    let gamepadX = 0;
    let gamepadY = 0;
    let lookX = 0;
    let lookY = 0;
    let gamepadRun = false;
    let gamepadGuard = false;
    const gamepad = this.getConnectedGamepad();
    if (gamepad) {
      gamepadX = applyDeadzone(gamepad.axes[0] ?? 0, 0.16);
      gamepadY = -applyDeadzone(gamepad.axes[1] ?? 0, 0.16);
      lookX = applyDeadzone(gamepad.axes[2] ?? 0, 0.14);
      lookY = applyDeadzone(gamepad.axes[3] ?? 0, 0.14);
      gamepadRun = Boolean(gamepad.buttons[10]?.pressed);
      this.captureGamepadPress(gamepad, 2, 'lightAttack');
      this.captureGamepadPress(gamepad, 3, 'heavyAttack');
      this.captureGamepadPress(gamepad, 1, 'dodge');
      this.captureGamepadPress(gamepad, 11, 'lockOn');
      this.captureGamepadPress(gamepad, 6, 'parry');
      this.captureGamepadPress(gamepad, 0, 'interact');
      this.captureGamepadPress(gamepad, 12, 'heal');
      this.captureGamepadPress(gamepad, 5, 'skillQ');
      this.captureGamepadPress(gamepad, 7, 'skillE');
      this.captureGamepadPress(gamepad, 15, 'skillR');
      this.gamepadHeavyHeld = Boolean(gamepad.buttons[3]?.pressed);
      gamepadGuard = Boolean(gamepad.buttons[4]?.pressed);
      const gamepadActive = Math.abs(gamepadX) + Math.abs(gamepadY) + Math.abs(lookX) + Math.abs(lookY) > 0.08
        || gamepad.buttons.some((button) => button.pressed);
      if (gamepadActive) this.lastInputDevice = 'gamepad';
    } else {
      this.previousGamepadButtons.clear();
      this.gamepadHeavyHeld = false;
      if (document.pointerLockElement !== this.canvas) this.mouseGuarding = false;
    }

    const horizontal = Math.abs(keyboardX) > Math.abs(gamepadX) ? keyboardX : gamepadX;
    const vertical = Math.abs(keyboardY) > Math.abs(gamepadY) ? keyboardY : gamepadY;
    const length = Math.hypot(horizontal, vertical);
    const scale = length > 1 ? 1 / length : 1;
    this.moveAxes = { horizontal: horizontal * scale, vertical: vertical * scale };
    this.lookAxes = { horizontal: lookX, vertical: lookY };
    this.running = this.held.has('ShiftLeft') || this.held.has('ShiftRight') || gamepadRun;
    this.guarding = this.mouseGuarding || gamepadGuard;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clearState();
  }

  getMoveAxes(): MoveAxes { return this.moveAxes; }
  getLookAxes(): LookAxes { return this.lookAxes; }
  isRunning(): boolean { return this.running; }
  isGuarding(): boolean { return this.guarding; }
  isHeavyHeld(): boolean { return this.mouseHeavyHeld || this.gamepadHeavyHeld; }

  getDeviceLabel(): string {
    if (this.lastInputDevice === 'gamepad' && this.activeGamepadName) return `게임패드 · ${shortGamepadName(this.activeGamepadName)}`;
    return '키보드·마우스';
  }

  consumeAction(action: CombatAction): boolean {
    if (!this.pressedActions.has(action)) return false;
    this.pressedActions.delete(action);
    return true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    this.held.clear();
    this.pressedActions.clear();
    this.previousGamepadButtons.clear();
  }

  private captureGamepadPress(gamepad: Gamepad, buttonIndex: number, action: CombatAction): void {
    const pressed = Boolean(gamepad.buttons[buttonIndex]?.pressed);
    const wasPressed = this.previousGamepadButtons.get(buttonIndex) ?? false;
    if (pressed && !wasPressed) this.pressedActions.add(action);
    this.previousGamepadButtons.set(buttonIndex, pressed);
  }

  private getConnectedGamepad(): Gamepad | null {
    const gamepads = navigator.getGamepads?.() ?? [];
    if (this.preferredGamepadIndex !== null) {
      const preferred = gamepads[this.preferredGamepadIndex];
      if (preferred?.connected) {
        this.activeGamepadName = preferred.id;
        return preferred;
      }
    }
    const fallback = Array.from(gamepads).find((gamepad): gamepad is Gamepad => Boolean(gamepad?.connected));
    if (!fallback) {
      this.preferredGamepadIndex = null;
      this.activeGamepadName = '';
      return null;
    }
    if (this.preferredGamepadIndex !== fallback.index) this.previousGamepadButtons.clear();
    this.preferredGamepadIndex = fallback.index;
    this.activeGamepadName = fallback.id;
    return fallback;
  }

  private readonly onGamepadConnected = (event: GamepadEvent): void => {
    if (this.preferredGamepadIndex === null) {
      this.preferredGamepadIndex = event.gamepad.index;
      this.activeGamepadName = event.gamepad.id;
      this.previousGamepadButtons.clear();
    } else if (this.preferredGamepadIndex === event.gamepad.index) {
      this.activeGamepadName = event.gamepad.id;
    }
  };

  private readonly onGamepadDisconnected = (event: GamepadEvent): void => {
    if (this.preferredGamepadIndex !== event.gamepad.index) return;
    this.preferredGamepadIndex = null;
    this.activeGamepadName = '';
    this.previousGamepadButtons.clear();
    this.gamepadHeavyHeld = false;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
    this.lastInputDevice = 'keyboard/mouse';
    const firstPress = !this.held.has(event.code);
    this.held.add(event.code);
    if (!firstPress) return;
    if (event.code === 'Space') this.pressedActions.add('dodge');
    if (event.code === 'Tab') this.pressedActions.add('lockOn');
    if (event.code === 'KeyC') this.pressedActions.add('parry');
    if (event.code === 'KeyF') this.pressedActions.add('interact');
    if (event.code === 'Digit1') this.pressedActions.add('heal');
    if (event.code === 'KeyQ') this.pressedActions.add('skillQ');
    if (event.code === 'KeyE') this.pressedActions.add('skillE');
    if (event.code === 'KeyR') this.pressedActions.add('skillR');
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    this.held.delete(event.code);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.enabled) return;
    if (document.pointerLockElement !== this.canvas) return;
    this.lastInputDevice = 'keyboard/mouse';
    if (event.button === 0) {
      const heavyModifier = this.held.has('ShiftLeft') || this.held.has('ShiftRight');
      if (heavyModifier) this.mouseHeavyHeld = true;
      this.pressedActions.add(heavyModifier ? 'heavyAttack' : 'lightAttack');
    }
    if (event.button === 1) this.pressedActions.add('lockOn');
    if (event.button === 2) this.mouseGuarding = true;
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (!this.enabled) return;
    if (event.button === 0) this.mouseHeavyHeld = false;
    if (event.button === 2) this.mouseGuarding = false;
  };

  private readonly onBlur = (): void => {
    this.clearState();
  };

  private clearState(): void {
    this.held.clear();
    this.pressedActions.clear();
    this.moveAxes = { horizontal: 0, vertical: 0 };
    this.lookAxes = { horizontal: 0, vertical: 0 };
    this.running = false;
    this.guarding = false;
    this.mouseGuarding = false;
    this.mouseHeavyHeld = false;
    this.gamepadHeavyHeld = false;
    this.previousGamepadButtons.clear();
  }
}

function applyDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone));
}
function shortGamepadName(name: string): string {
  const normalized = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length > 28 ? `${normalized.slice(0, 25)}…` : normalized;
}
