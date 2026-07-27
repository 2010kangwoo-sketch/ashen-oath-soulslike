export class LoadingReporter {
  private readonly root: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly label: HTMLElement;

  constructor() {
    this.root = this.requireElement('loading-screen');
    this.progress = this.requireElement('loading-progress');
    this.label = this.requireElement('loading-label');
  }

  update(percent: number, label: string): void {
    const clamped = Math.max(0, Math.min(100, percent));
    this.progress.style.width = `${clamped}%`;
    this.label.textContent = label;
  }

  complete(): void {
    this.update(100, '기반 검증 완료');
    window.setTimeout(() => this.root.classList.add('is-complete'), 250);
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`필수 UI 요소를 찾지 못했습니다: #${id}`);
    return element;
  }
}
