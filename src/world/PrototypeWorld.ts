import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld';

export class PrototypeWorld {
  readonly group = new THREE.Group();
  readonly cameraCollisionObjects: THREE.Object3D[] = [];
  private readonly stone = new THREE.MeshStandardMaterial({ color: 0x373735, roughness: 0.9, metalness: 0.03 });
  private readonly darkStone = new THREE.MeshStandardMaterial({ color: 0x202322, roughness: 0.96, metalness: 0.02 });
  private readonly wornStone = new THREE.MeshStandardMaterial({ color: 0x4a4943, roughness: 0.84, metalness: 0.04 });
  private readonly physics: PhysicsWorld;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.physics = physics;
    this.group.name = 'pass-1-movement-sanctum';
    scene.add(this.group);

    this.createMainFloor();
    this.createBoundary();
    this.createStairCourse();
    this.createSlopeCourse();
    this.createCentralShrine();
    this.createBrokenColonnade();
    this.createWayfindingLights();
  }

  update(): void {
    // Pass 1 world geometry is static. The hook remains for later moving platforms and enemies.
  }

  private createMainFloor(): void {
    this.addStaticBox('courtyard-floor', [44, 1, 48], [0, -0.5, 0], this.stone, undefined, true);

    const inset = new THREE.Mesh(new THREE.RingGeometry(4.8, 11.5, 48, 1), this.wornStone);
    inset.rotation.x = -Math.PI / 2;
    inset.position.y = 0.012;
    inset.receiveShadow = true;
    this.group.add(inset);

    for (let index = 0; index < 72; index += 1) {
      const angle = (index / 72) * Math.PI * 2;
      const radius = 5.2 + (index % 9) * 0.72;
      const shard = new THREE.Mesh(
        new THREE.ConeGeometry(0.05 + (index % 3) * 0.025, 0.25 + (index % 5) * 0.08, 5),
        this.darkStone,
      );
      shard.position.set(Math.cos(angle) * radius, 0.13, Math.sin(angle) * radius);
      shard.rotation.z = (index % 7) * 0.07 - 0.2;
      shard.castShadow = true;
      this.group.add(shard);
    }
  }

  private createBoundary(): void {
    this.addStaticBox('north-wall', [44, 7, 1.4], [0, 3.5, -24], this.darkStone, undefined, true);
    this.addStaticBox('west-wall', [1.4, 5.2, 48], [-22, 2.6, 0], this.darkStone, undefined, true);
    this.addStaticBox('east-wall', [1.4, 5.2, 48], [22, 2.6, 0], this.darkStone, undefined, true);
    this.addStaticBox('south-west-wall', [17, 4.4, 1.4], [-13.5, 2.2, 24], this.darkStone, undefined, true);
    this.addStaticBox('south-east-wall', [17, 4.4, 1.4], [13.5, 2.2, 24], this.darkStone, undefined, true);

    const lintel = this.addStaticBox('south-gate-lintel', [10, 1.3, 1.5], [0, 5.8, 24], this.darkStone, undefined, true);
    lintel.castShadow = true;
  }

  private createStairCourse(): void {
    const stairX = -10;
    const treadDepth = 1.18;
    const rise = 0.28;
    const startZ = 7.2;

    for (let index = 0; index < 9; index += 1) {
      const height = rise * (index + 1);
      const z = startZ - index * treadDepth;
      this.addStaticBox(
        `stair-${index + 1}`,
        [5.4, height, treadDepth + 0.04],
        [stairX, height / 2, z],
        index % 2 === 0 ? this.wornStone : this.stone,
        undefined,
        true,
      );
    }

    this.addStaticBox('stair-upper-platform', [7.2, 0.7, 6.2], [stairX, 2.17, -2.2], this.stone, undefined, true);
    this.addStaticBox('stair-left-rail', [0.5, 2.4, 15], [stairX - 3.55, 1.2, 1.6], this.darkStone, undefined, true);
    this.addStaticBox('stair-right-rail', [0.5, 2.4, 15], [stairX + 3.55, 1.2, 1.6], this.darkStone, undefined, true);
  }

  private createSlopeCourse(): void {
    const angle = Math.atan2(3.2, 10.5);
    const rotation = new THREE.Euler(angle, 0, 0);
    this.addStaticBox('slope-ramp', [5.2, 0.48, 11], [10, 1.72, 2], this.wornStone, rotation, true);
    this.addStaticBox('slope-upper-platform', [7.4, 0.72, 6.4], [10, 3.58, -5.7], this.stone, undefined, true);
    this.addStaticBox('slope-left-edge', [0.38, 1.1, 11], [7.2, 2.05, 2], this.darkStone, rotation, true);
    this.addStaticBox('slope-right-edge', [0.38, 1.1, 11], [12.8, 2.05, 2], this.darkStone, rotation, true);

    const tooSteep = new THREE.Euler(THREE.MathUtils.degToRad(58), 0, 0);
    this.addStaticBox('blocked-steep-slope', [3.7, 0.5, 5], [17.6, 2.05, -11.5], this.darkStone, tooSteep, true);
  }

  private createCentralShrine(): void {
    this.addStaticBox('shrine-dais', [8.5, 0.9, 6.4], [0, 0.45, -10], this.wornStone, undefined, true);
    this.addStaticBox('shrine-step-one', [10.2, 0.26, 1.2], [0, 0.13, -6.4], this.stone, undefined, true);
    this.addStaticBox('shrine-step-two', [9.4, 0.52, 1.2], [0, 0.26, -7.5], this.stone, undefined, true);
    this.addStaticBox('shrine-monolith', [2.4, 6.6, 1.5], [0, 4.2, -11.2], this.darkStone, new THREE.Euler(0, 0, -0.03), true);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.65, 0.14, 10, 52),
      new THREE.MeshStandardMaterial({ color: 0xbca274, emissive: 0x382916, roughness: 0.35, metalness: 0.55 }),
    );
    ring.position.set(0, 5.15, -10.4);
    ring.castShadow = true;
    this.group.add(ring);
  }

  private createBrokenColonnade(): void {
    for (const x of [-17, -13, 13, 17]) {
      for (const z of [-15, -7, 9, 17]) {
        const height = 4.4 + ((Math.abs(x) + Math.abs(z)) % 4) * 0.55;
        this.addStaticCylinder(`column-${x}-${z}`, 0.72, height, [x, height / 2, z], this.stone, true);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.42, 1.8), this.darkStone);
        cap.position.set(x, height + 0.18, z);
        cap.rotation.y = (x + z) * 0.025;
        cap.castShadow = true;
        cap.receiveShadow = true;
        this.group.add(cap);
        this.cameraCollisionObjects.push(cap);
      }
    }

    this.addStaticBox('movement-chicane-a', [5.4, 2.3, 0.8], [-4.8, 1.15, 7.4], this.darkStone, new THREE.Euler(0, 0.36, 0), true);
    this.addStaticBox('movement-chicane-b', [5.4, 2.3, 0.8], [4.8, 1.15, 7.4], this.darkStone, new THREE.Euler(0, -0.36, 0), true);
  }

  private createWayfindingLights(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xc6ae82, transparent: true, opacity: 0.22 });
    for (const [x, z, height] of [
      [-10, 10, 5.4],
      [-10, -5, 6.2],
      [10, 9, 5.4],
      [10, -8, 6.2],
      [0, -5, 5.8],
    ] as const) {
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.38, height, 7, 1, true), material);
      marker.position.set(x, height / 2, z);
      this.group.add(marker);
    }
  }

  private addStaticBox(
    name: string,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    material: THREE.Material,
    rotation?: THREE.Euler,
    cameraBlocker = false,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.copy(rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const quaternion = mesh.quaternion;
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position[0], position[1], position[2])
        .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setFriction(0.9),
      body,
    );

    if (cameraBlocker) this.cameraCollisionObjects.push(mesh);
    return mesh;
  }

  private addStaticCylinder(
    name: string,
    radius: number,
    height: number,
    position: readonly [number, number, number],
    material: THREE.Material,
    cameraBlocker = false,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.1, height, 10), material);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position[0], position[1], position[2]),
    );
    this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius).setFriction(0.9), body);
    if (cameraBlocker) this.cameraCollisionObjects.push(mesh);
    return mesh;
  }
}
