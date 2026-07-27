import RAPIER from '@dimforge/rapier3d-compat';
import { GAME_CONFIG } from '../config/GameConfig';

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private accumulator = 0;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: GAME_CONFIG.physics.gravity, z: 0 });
    world.timestep = GAME_CONFIG.physics.fixedStep;
    return new PhysicsWorld(world);
  }

  step(delta: number): void {
    this.accumulator += Math.min(delta, 0.1);
    while (this.accumulator >= GAME_CONFIG.physics.fixedStep) {
      this.world.step();
      this.accumulator -= GAME_CONFIG.physics.fixedStep;
    }
  }
}
