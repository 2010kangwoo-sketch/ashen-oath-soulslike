import RAPIER, { type World } from '@dimforge/rapier3d-compat';
import { GAME_CONFIG } from '../config/GameConfig';

export type FixedStepCallback = (fixedDelta: number) => void;

export interface PhysicsStepStats {
  readonly lastStepCount: number;
  readonly saturatedFrameCount: number;
  readonly clampedFrameCount: number;
  readonly discardedSeconds: number;
}

export class PhysicsWorld {
  readonly world: World;
  private accumulator = 0;
  private lastStepCount = 0;
  private saturatedFrameCount = 0;
  private clampedFrameCount = 0;
  private discardedSeconds = 0;

  private constructor(world: World) {
    this.world = world;
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: GAME_CONFIG.physics.gravity, z: 0 });
    world.timestep = GAME_CONFIG.physics.fixedStep;
    return new PhysicsWorld(world);
  }

  step(delta: number, beforeStep?: FixedStepCallback): number {
    const maximumAcceptedDelta = GAME_CONFIG.physics.fixedStep * GAME_CONFIG.physics.maxSubSteps;
    const acceptedDelta = Math.min(delta, maximumAcceptedDelta);
    if (delta > acceptedDelta) {
      this.clampedFrameCount += 1;
      this.discardedSeconds += delta - acceptedDelta;
    }
    this.accumulator += acceptedDelta;
    let steps = 0;
    while (this.accumulator >= GAME_CONFIG.physics.fixedStep && steps < GAME_CONFIG.physics.maxSubSteps) {
      beforeStep?.(GAME_CONFIG.physics.fixedStep);
      this.world.step();
      this.accumulator -= GAME_CONFIG.physics.fixedStep;
      steps += 1;
    }
    if (steps === GAME_CONFIG.physics.maxSubSteps && this.accumulator >= GAME_CONFIG.physics.fixedStep) {
      this.saturatedFrameCount += 1;
      this.discardedSeconds += this.accumulator - GAME_CONFIG.physics.fixedStep * 0.5;
      this.accumulator = GAME_CONFIG.physics.fixedStep * 0.5;
    }
    this.lastStepCount = steps;
    return steps;
  }

  resetAccumulator(): void {
    this.accumulator = 0;
    this.lastStepCount = 0;
  }

  getStepStats(): PhysicsStepStats {
    return {
      lastStepCount: this.lastStepCount,
      saturatedFrameCount: this.saturatedFrameCount,
      clampedFrameCount: this.clampedFrameCount,
      discardedSeconds: Math.max(0, this.discardedSeconds),
    };
  }
}
