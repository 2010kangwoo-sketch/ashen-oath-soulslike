export type SwingWeight = 'light' | 'medium' | 'heavy';

export class AudioDirector {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientTimer = 7;
  private unlocked = false;

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = 0.52;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.context);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    this.unlocked = true;
  }

  update(delta: number): void {
    if (!this.unlocked || !this.context) return;
    this.ambientTimer -= delta;
    if (this.ambientTimer <= 0) {
      this.playDistantBell();
      this.ambientTimer = 15 + Math.random() * 12;
    }
  }

  footstep(intensity: number): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playNoiseBurst(now, 0.045, 220, 900, 0.03 + intensity * 0.025);
    this.playOscillator(now, 'sine', 78 + intensity * 18, 42, 0.055, 0.045 + intensity * 0.02);
  }

  dodge(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playNoiseBurst(now, 0.16, 420, 2600, 0.065);
    this.playOscillator(now, 'triangle', 190, 85, 0.12, 0.025);
  }

  swing(weight: SwingWeight): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const duration = weight === 'heavy' ? 0.27 : weight === 'medium' ? 0.19 : 0.14;
    const gain = weight === 'heavy' ? 0.11 : weight === 'medium' ? 0.075 : 0.055;
    this.playNoiseBurst(now, duration, 700, weight === 'heavy' ? 3100 : 4400, gain);
    this.playOscillator(now, 'sawtooth', weight === 'heavy' ? 125 : 175, 58, duration * 0.72, gain * 0.28);
  }

  impact(weight: SwingWeight): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const heavy = weight === 'heavy';
    this.playNoiseBurst(now, heavy ? 0.18 : 0.1, 90, heavy ? 2100 : 2900, heavy ? 0.13 : 0.075);
    this.playOscillator(now, 'square', heavy ? 92 : 128, heavy ? 34 : 52, heavy ? 0.16 : 0.09, heavy ? 0.08 : 0.045);
  }

  guard(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playNoiseBurst(now, 0.12, 1200, 6200, 0.075);
    this.playOscillator(now, 'triangle', 520, 210, 0.16, 0.045);
  }

  parry(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playNoiseBurst(now, 0.2, 1600, 9000, 0.12);
    this.playOscillator(now, 'sine', 980, 430, 0.23, 0.085);
    this.playOscillator(now + 0.018, 'triangle', 1460, 620, 0.17, 0.04);
  }

  postureBreak(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playOscillator(now, 'sawtooth', 150, 48, 0.42, 0.095);
    this.playNoiseBurst(now, 0.28, 80, 1500, 0.1);
  }

  execution(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playNoiseBurst(now, 0.34, 70, 2500, 0.15);
    this.playOscillator(now, 'square', 118, 26, 0.38, 0.12);
  }

  heal(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playOscillator(now, 'sine', 420, 680, 0.46, 0.05);
    this.playOscillator(now + 0.08, 'triangle', 610, 930, 0.4, 0.026);
    this.playNoiseBurst(now, 0.32, 760, 4200, 0.026);
  }

  checkpoint(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playOscillator(now, 'sine', 146, 142, 1.6, 0.055);
    this.playOscillator(now + 0.06, 'sine', 292, 284, 1.25, 0.032);
    this.playOscillator(now + 0.14, 'triangle', 438, 426, 0.9, 0.018);
  }

  collectAsh(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playOscillator(now, 'sine', 280, 720, 0.34, 0.038);
    this.playOscillator(now + 0.05, 'triangle', 480, 960, 0.28, 0.022);
  }

  shortcut(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playNoiseBurst(now, 0.68, 42, 920, 0.09);
    this.playOscillator(now, 'sawtooth', 74, 34, 0.72, 0.045);
  }

  death(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playOscillator(now, 'sawtooth', 126, 31, 1.35, 0.06);
    this.playNoiseBurst(now, 0.72, 35, 1100, 0.055);
  }

  bossIntro(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playOscillator(now, 'sine', 72, 54, 2.6, 0.085);
    this.playOscillator(now + 0.12, 'triangle', 144, 108, 2.1, 0.038);
    this.playOscillator(now + 0.26, 'sine', 216, 162, 1.8, 0.022);
    this.playNoiseBurst(now, 0.9, 28, 780, 0.065);
  }

  bossPhase(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playNoiseBurst(now, 0.62, 45, 2800, 0.15);
    this.playOscillator(now, 'sawtooth', 98, 32, 0.72, 0.13);
    this.playOscillator(now + 0.08, 'square', 196, 58, 0.56, 0.055);
  }

  shieldBreak(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playNoiseBurst(now, 0.42, 320, 9200, 0.17);
    this.playOscillator(now, 'triangle', 680, 110, 0.46, 0.11);
    this.playOscillator(now + 0.02, 'square', 310, 74, 0.38, 0.065);
  }

  bossDefeat(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playNoiseBurst(now, 0.95, 30, 1600, 0.12);
    this.playOscillator(now, 'sawtooth', 112, 24, 1.6, 0.095);
    this.playOscillator(now + 0.3, 'sine', 220, 146, 2.4, 0.055);
    this.playOscillator(now + 0.48, 'triangle', 330, 220, 1.9, 0.026);
  }

  enemyTell(weight: SwingWeight): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const start = weight === 'heavy' ? 210 : weight === 'medium' ? 270 : 330;
    this.playOscillator(now, 'triangle', start, start * 0.72, weight === 'heavy' ? 0.26 : 0.16, 0.025);
  }

  private readyContext(): AudioContext | null {
    if (!this.unlocked || !this.context || !this.master || this.context.state !== 'running') return null;
    return this.context;
  }

  private playNoiseBurst(
    start: number,
    duration: number,
    lowFrequency: number,
    highFrequency: number,
    gainAmount: number,
  ): void {
    const ctx = this.context;
    const master = this.master;
    const buffer = this.noiseBuffer;
    if (!ctx || !master || !buffer) return;
    const source = ctx.createBufferSource();
    const highpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(lowFrequency, start);
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(highFrequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainAmount), start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(highpass).connect(lowpass).connect(gain).connect(master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private playOscillator(
    start: number,
    type: OscillatorType,
    startFrequency: number,
    endFrequency: number,
    duration: number,
    gainAmount: number,
  ): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainAmount), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private playDistantBell(): void {
    const ctx = this.readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playOscillator(now, 'sine', 118, 110, 2.8, 0.035);
    this.playOscillator(now, 'sine', 236, 220, 2.1, 0.018);
    this.playOscillator(now + 0.04, 'sine', 354, 330, 1.7, 0.01);
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * 1.2);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.35 + white * 0.65;
      data[index] = previous;
    }
    return buffer;
  }
}
