import type { FrameStats } from './PerformanceGovernor';

const SAMPLE_COUNT = 180;

export class FrameMonitor {
  private readonly frameTimes = new Float32Array(SAMPLE_COUNT);
  private frameCount = 0;
  private elapsed = 0;
  private sampleCursor = 0;
  private sampleSize = 0;
  private stats: FrameStats = {
    fps: 0,
    averageFrameMs: 0,
    p95FrameMs: 0,
    jitterMs: 0,
  };

  update(delta: number): FrameStats {
    const frameMs = Math.min(100, Math.max(0, delta * 1000));
    this.frameTimes[this.sampleCursor] = frameMs;
    this.sampleCursor = (this.sampleCursor + 1) % SAMPLE_COUNT;
    this.sampleSize = Math.min(SAMPLE_COUNT, this.sampleSize + 1);
    this.frameCount += 1;
    this.elapsed += delta;

    if (this.elapsed >= 0.5) {
      this.stats = this.calculateStats();
      this.frameCount = 0;
      this.elapsed = 0;
    }
    return this.stats;
  }

  private calculateStats(): FrameStats {
    if (this.sampleSize === 0) return this.stats;
    const ordered = Array.from(this.frameTimes.subarray(0, this.sampleSize)).sort((a, b) => a - b);
    const averageFrameMs = ordered.reduce((sum, value) => sum + value, 0) / ordered.length;
    const p95Index = Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95));
    const p95FrameMs = ordered[p95Index] ?? averageFrameMs;
    const variance = ordered.reduce((sum, value) => {
      const difference = value - averageFrameMs;
      return sum + difference * difference;
    }, 0) / ordered.length;
    return {
      fps: Math.round(this.frameCount / Math.max(0.001, this.elapsed)),
      averageFrameMs,
      p95FrameMs,
      jitterMs: Math.sqrt(variance),
    };
  }
}
