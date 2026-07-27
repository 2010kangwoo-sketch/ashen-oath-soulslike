export type MoveAxes = Readonly<{ horizontal: number; vertical: number }>;

const BLOCKED_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight']);

export class InputController {
  private readonly held = new Set<string>();

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  getMoveAxes(): MoveAxes {
    const horizontal = Number(this.held.has('KeyD')) - Number(this.held.has('KeyA'));
    const vertical = Number(this.held.has('KeyW')) - Number(this.held.has('KeyS'));
    return { horizontal, vertical };
  }

  isRunning(): boolean {
    return this.held.has('ShiftLeft') || this.held.has('ShiftRight');
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
  };
}
