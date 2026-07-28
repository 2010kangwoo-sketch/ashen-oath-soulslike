import type { QualityPreset } from '../settings/GameSettings';

export interface FrameStats {
  readonly fps: number;
  readonly averageFrameMs: number;
  readonly p95FrameMs: number;
  readonly jitterMs: number;
}

export interface PerformanceState {
  readonly resolutionScale: number;
  readonly effectTier: 0 | 1 | 2;
  readonly changed: boolean;
}

export class PerformanceGovernor {
  private quality: QualityPreset = 'balanced';
  private resolutionScale = 1;
  private effectTier: 0 | 1 | 2 = 0;
  private stressSeconds = 0;
  private severeStressSeconds = 0;
  private recoverySeconds = 0;
  private changeCooldown = 0;

  setQuality(quality: QualityPreset): PerformanceState {
    this.quality = quality;
    this.resolutionScale = 1;
    this.effectTier = quality === 'performance' ? 1 : 0;
    this.stressSeconds = 0;
    this.severeStressSeconds = 0;
    this.recoverySeconds = 0;
    this.changeCooldown = 0;
    return this.snapshot(true);
  }

  update(stats: FrameStats, delta: number, active: boolean): PerformanceState {
    if (!active || stats.fps <= 0) return this.snapshot(false);

    this.changeCooldown = Math.max(0, this.changeCooldown - delta);
    const stressed = stats.fps < 43 || stats.p95FrameMs > 24 || stats.jitterMs > 8.5;
    const severelyStressed = stats.fps < 31 || stats.p95FrameMs > 34;
    const stable = stats.fps >= 56 && stats.p95FrameMs < 20.5 && stats.jitterMs < 4.5;

    this.stressSeconds = stressed ? this.stressSeconds + delta : Math.max(0, this.stressSeconds - delta * 0.55);
    this.severeStressSeconds = severelyStressed
      ? this.severeStressSeconds + delta
      : Math.max(0, this.severeStressSeconds - delta * 0.8);
    this.recoverySeconds = stable ? this.recoverySeconds + delta : Math.max(0, this.recoverySeconds - delta * 0.65);

    if (this.changeCooldown > 0) return this.snapshot(false);

    if (this.severeStressSeconds >= 2.6) {
      this.severeStressSeconds = 0;
      this.stressSeconds = 0;
      this.recoverySeconds = 0;
      this.changeCooldown = 4;
      const previousScale = this.resolutionScale;
      const previousTier = this.effectTier;
      this.resolutionScale = Math.max(this.minimumScale(), this.resolutionScale - 0.14);
      this.effectTier = Math.min(2, this.effectTier + 1) as 0 | 1 | 2;
      return this.snapshot(previousScale !== this.resolutionScale || previousTier !== this.effectTier);
    }

    if (this.stressSeconds >= 5.2) {
      this.stressSeconds = 0;
      this.recoverySeconds = 0;
      this.changeCooldown = 5;
      const previousScale = this.resolutionScale;
      const previousTier = this.effectTier;
      this.resolutionScale = Math.max(this.minimumScale(), this.resolutionScale - 0.09);
      if (this.resolutionScale <= 0.82) this.effectTier = Math.min(2, this.effectTier + 1) as 0 | 1 | 2;
      return this.snapshot(previousScale !== this.resolutionScale || previousTier !== this.effectTier);
    }

    if (this.recoverySeconds >= 15) {
      this.recoverySeconds = 0;
      this.stressSeconds = 0;
      this.changeCooldown = 7;
      const previousScale = this.resolutionScale;
      const previousTier = this.effectTier;
      if (this.resolutionScale < 0.999) {
        this.resolutionScale = Math.min(1, this.resolutionScale + 0.06);
      } else if (this.effectTier > this.minimumEffectTier()) {
        this.effectTier = (this.effectTier - 1) as 0 | 1 | 2;
      }
      return this.snapshot(previousScale !== this.resolutionScale || previousTier !== this.effectTier);
    }

    return this.snapshot(false);
  }

  getState(): PerformanceState {
    return this.snapshot(false);
  }

  private minimumScale(): number {
    if (this.quality === 'performance') return 0.62;
    if (this.quality === 'cinematic') return 0.72;
    return 0.68;
  }

  private minimumEffectTier(): 0 | 1 {
    return this.quality === 'performance' ? 1 : 0;
  }

  private snapshot(changed: boolean): PerformanceState {
    return {
      resolutionScale: this.resolutionScale,
      effectTier: this.effectTier,
      changed,
    };
  }
}
