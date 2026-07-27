export class DiagnosticsHud {
  private readonly root: HTMLElement;
  private readonly help: HTMLElement;
  private readonly renderStatus: HTMLElement;
  private readonly physicsStatus: HTMLElement;
  private readonly fpsStatus: HTMLElement;

  constructor() {
    this.root = this.requireElement('hud');
    this.help = this.requireQuery('.help-panel');
    this.renderStatus = this.requireElement('render-status');
    this.physicsStatus = this.requireElement('physics-status');
    this.fpsStatus = this.requireElement('fps-status');
  }

  reveal(): void {
    this.root.classList.remove('is-hidden');
  }

  setRenderReady(): void {
    this.renderStatus.textContent = '정상';
  }

  setPhysicsReady(): void {
    this.physicsStatus.textContent = '정상';
  }

  setFps(fps: number): void {
    if (fps > 0) this.fpsStatus.textContent = `${fps} FPS`;
  }

  toggleHelp(): void {
    this.help.classList.toggle('is-hidden');
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`필수 UI 요소를 찾지 못했습니다: #${id}`);
    return element;
  }

  private requireQuery(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`필수 UI 요소를 찾지 못했습니다: ${selector}`);
    return element;
  }
}
