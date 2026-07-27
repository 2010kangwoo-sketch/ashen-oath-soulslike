export type MoveAxes = Readonly<{ horizontal: number; vertical: number }>;
export type LookAxes = Readonly<{ horizontal: number; vertical: number }>;

const BLOCKED_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space',
]);

export class InputController {
  private readonly held = new Set<string>();
  private moveAxes: MoveAxes = { horizontal: 0, vertical: 0 };
  private lookAxes: LookAxes = { horizontal: 0, vertical: 0 };
  private running = false;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
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
    const gamepad = navigator.getGamepads?.()[0];
    if (gamepad) {
      gamepadX = applyDeadzone(gamepad.axes[0] ?? 0, 0.16);
      gamepadY = -applyDeadzone(gamepad.axes[1] ?? 0, 0.16);
      lookX = applyDeadzone(gamepad.axes[2] ?? 0, 0.14);
      lookY = applyDeadzone(gamepad.axes[3] ?? 0, 0.14);
      gamepadRun = Boolean(gamepad.buttons[10]?.pressed || gamepad.buttons[1]?.pressed);
    }

    const horizontal = Math.abs(keyboardX) > Math.abs(gamepadX) ? keyboardX : gamepadX;
    const vertical = Math.abs(keyboardY) > Math.abs(gamepadY) ? keyboardY : gamepadY;
    const length = Math.hypot(horizontal, vertical);
    const scale = length > 1 ? 1 / length : 1;
    this.moveAxes = { horizontal: horizontal * scale, vertical: vertical * scale };
    this.lookAxes = { horizontal: lookX, vertical: lookY };
    this.running = this.held.has('ShiftLeft') || this.held.has('ShiftRight') || gamepadRun;
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

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.held.clear();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
    this.held.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.moveAxes = { horizontal: 0, vertical: 0 };
    this.lookAxes = { horizontal: 0, vertical: 0 };
    this.running = false;
  };
}

function applyDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone));
}
