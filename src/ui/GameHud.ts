import type { PlayerMotionState } from '../player/PlayerController';

export class GameHud {
  private readonly root: HTMLElement;
  private readonly help: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly fpsStatus: HTMLElement;
  private readonly movementStatus: HTMLElement;
  private readonly speedStatus: HTMLElement;
  private readonly groundedStatus: HTMLElement;
  private readonly pointerHint: HTMLElement;
  private debugVisible = false;

  constructor() {
    this.root = this.requireElement('hud');
    this.help = this.requireElement('control-help');
    this.debug = this.requireElement('debug-panel');
    this.fpsStatus = this.requireElement('fps-status');
    this.movementStatus = this.requireElement('movement-status');
    this.speedStatus = this.requireElement('speed-status');
    this.groundedStatus = this.requireElement('grounded-status');
    this.pointerHint = this.requireElement('pointer-hint');
  }

  reveal(): void {
    this.root.classList.remove('is-hidden');
    window.setTimeout(() => this.root.classList.add('hud-settled'), 4200);
  }

  setFps(fps: number): void {
    if (fps > 0) this.fpsStatus.textContent = `${fps} FPS`;
  }

  setPlayerState(state: PlayerMotionState, speed: number, grounded: boolean): void {
    const labels: Record<PlayerMotionState, string> = {
      idle: '대기',
      walk: '걷기',
      run: '질주',
      airborne: '낙하',
    };
    this.movementStatus.textContent = labels[state];
    this.speedStatus.textContent = `${speed.toFixed(1)} m/s`;
    this.groundedStatus.textContent = grounded ? '접지' : '공중';
  }

  setPointerLocked(locked: boolean): void {
    this.pointerHint.classList.toggle('is-hidden', locked);
  }

  toggleHelp(): void {
    this.help.classList.toggle('is-hidden');
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.debug.classList.toggle('is-hidden', !this.debugVisible);
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Required UI element is missing: #${id}`);
    return element;
  }
}
