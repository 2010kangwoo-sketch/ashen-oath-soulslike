export class FrameMonitor {
  private frameCount = 0;
  private elapsed = 0;
  private fps = 0;

  update(delta: number): number {
    this.frameCount += 1;
    this.elapsed += delta;
    if (this.elapsed >= 0.5) {
      this.fps = Math.round(this.frameCount / this.elapsed);
      this.frameCount = 0;
      this.elapsed = 0;
    }
    return this.fps;
  }
}
