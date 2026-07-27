export type MoveAxes = Readonly<{ horizontal: number; vertical: number }>;
export type LookAxes = Readonly<{ horizontal: number; vertical: number }>;
export type CombatAction = 'lightAttack' | 'heavyAttack' | 'dodge' | 'lockOn' | 'parry';

const BLOCKED_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyQ', 'KeyF',
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

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  update(): void {
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
    const gamepad = navigator.getGamepads?.()[0];
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
      gamepadGuard = Boolean(gamepad.buttons[4]?.pressed);
    } else {
      this.previousGamepadButtons.clear();
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

  getMoveAxes(): MoveAxes {
    return this.moveAxes;
  }

  getLookAxes(): LookAxes {
    return this.lookAxes;
  }

  isRunning(): boolean {
    return this.running;
  }

  isGuarding(): boolean {
    return this.guarding;
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

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
    const firstPress = !this.held.has(event.code);
    this.held.add(event.code);
    if (!firstPress) return;
    if (event.code === 'Space') this.pressedActions.add('dodge');
    if (event.code === 'KeyQ') this.pressedActions.add('lockOn');
    if (event.code === 'KeyF') this.pressedActions.add('parry');
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    if (event.button === 0) {
      const heavyModifier = this.held.has('ShiftLeft') || this.held.has('ShiftRight');
      this.pressedActions.add(heavyModifier ? 'heavyAttack' : 'lightAttack');
    }
    if (event.button === 2) this.mouseGuarding = true;
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 2) this.mouseGuarding = false;
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.pressedActions.clear();
    this.moveAxes = { horizontal: 0, vertical: 0 };
    this.lookAxes = { horizontal: 0, vertical: 0 };
    this.running = false;
    this.guarding = false;
    this.mouseGuarding = false;
  };
}

function applyDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone));
}
