export class ScreenTransition {
  private phase: 'idle' | 'closing' | 'holding' | 'opening' = 'idle';
  private opacity = 0;
  private holdRemaining = 0;
  private pendingAction: (() => void) | null = null;
  private pendingComplete: (() => void) | null = null;

  constructor(private readonly element: HTMLElement) {
    this.applyOpacity();
  }

  coverAndRun(action: () => void, holdSeconds = 0.08, complete?: () => void): void {
    if (this.phase !== 'idle') return;
    this.pendingAction = action;
    this.pendingComplete = complete ?? null;
    this.holdRemaining = Math.max(0, holdSeconds);
    this.phase = 'closing';
    this.element.classList.remove('is-hidden');
    this.element.setAttribute('aria-hidden', 'false');
  }

  revealFromBlack(): void {
    this.pendingAction = null;
    this.pendingComplete = null;
    this.opacity = 1;
    this.holdRemaining = 0.04;
    this.phase = 'holding';
    this.element.classList.remove('is-hidden');
    this.element.setAttribute('aria-hidden', 'false');
    this.applyOpacity();
  }

  update(delta: number): void {
    if (this.phase === 'idle') return;
    if (this.phase === 'closing') {
      this.opacity = Math.min(1, this.opacity + delta / 0.24);
      if (this.opacity >= 0.999) {
        const action = this.pendingAction;
        this.pendingAction = null;
        action?.();
        this.phase = 'holding';
      }
    } else if (this.phase === 'holding') {
      this.holdRemaining -= delta;
      if (this.holdRemaining <= 0) this.phase = 'opening';
    } else if (this.phase === 'opening') {
      this.opacity = Math.max(0, this.opacity - delta / 0.42);
      if (this.opacity <= 0.001) {
        this.opacity = 0;
        this.phase = 'idle';
        this.element.classList.add('is-hidden');
        this.element.setAttribute('aria-hidden', 'true');
        const complete = this.pendingComplete;
        this.pendingComplete = null;
        complete?.();
      }
    }
    this.applyOpacity();
  }

  isBlocking(): boolean {
    return this.phase === 'closing' || this.phase === 'holding';
  }

  isActive(): boolean {
    return this.phase !== 'idle';
  }

  private applyOpacity(): void {
    this.element.style.opacity = this.opacity.toFixed(3);
  }
}
