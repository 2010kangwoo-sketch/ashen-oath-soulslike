import RAPIER, { type World } from '@dimforge/rapier3d-compat';
import { GAME_CONFIG } from '../config/GameConfig';

export type FixedStepCallback = (fixedDelta: number) => void;

export class PhysicsWorld {
  readonly world: World;
  private accumulator = 0;

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
    this.accumulator += Math.min(delta, GAME_CONFIG.physics.fixedStep * GAME_CONFIG.physics.maxSubSteps);
    let steps = 0;
    while (this.accumulator >= GAME_CONFIG.physics.fixedStep && steps < GAME_CONFIG.physics.maxSubSteps) {
      beforeStep?.(GAME_CONFIG.physics.fixedStep);
      this.world.step();
      this.accumulator -= GAME_CONFIG.physics.fixedStep;
      steps += 1;
    }
    if (steps === GAME_CONFIG.physics.maxSubSteps) this.accumulator = 0;
    return steps;
  }
}
