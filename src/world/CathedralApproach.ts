import * as THREE from 'three';
import RAPIER, { type RigidBody } from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { AtmosphereSystem } from './AtmosphereSystem';
import { SurfaceFactory } from './SurfaceFactory';

interface DynamicDebris {
  readonly mesh: THREE.Mesh;
  readonly body: RigidBody;
  cooldown: number;
}

export class CathedralApproach {
  readonly group = new THREE.Group();
  readonly cameraCollisionObjects: THREE.Object3D[] = [];
  private readonly basalt = SurfaceFactory.stone(0x25292a, 151, 8);
  private readonly wornStone = SurfaceFactory.stone(0x45443e, 379, 7);
  private readonly paleStone = SurfaceFactory.stone(0x68655b, 733, 6);
  private readonly blackIron = SurfaceFactory.metal(0x151a1c, 0.42, 0.82);
  private readonly bronze = new THREE.MeshStandardMaterial({
    color: 0x8d7250,
    emissive: 0x2b1c0e,
    emissiveIntensity: 0.55,
    roughness: 0.42,
    metalness: 0.72,
  });
  private readonly atmosphere: AtmosphereSystem;
  private readonly dynamicDebris: DynamicDebris[] = [];
  private readonly banners: THREE.Mesh[] = [];
  private elapsed = 0;

  constructor(scene: THREE.Scene, private readonly physics: PhysicsWorld) {
    this.group.name = 'cathedral-approach-production-slice';
    scene.add(this.group);
    this.atmosphere = new AtmosphereSystem(scene);

    this.createGroundComposition();
    this.createSouthGate();
    this.createProcessionalStairs();
    this.createNaveForecourt();
    this.createBrokenColonnades();
    this.createCathedralFacade();
    this.createSideRoutes();
    this.createRubbleAndWear();
    this.createDynamicDebris();
    this.createBannersAndChains();
    this.createDistantSilhouette();
    this.createLightingAccents();
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.atmosphere.update(delta);
    for (const banner of this.banners) {
      const phase = Number(banner.userData.phase ?? 0);
      banner.rotation.z = Math.sin(this.elapsed * 0.72 + phase) * 0.045;
      banner.rotation.x = Math.sin(this.elapsed * 1.1 + phase * 0.7) * 0.025;
    }
    for (const debris of this.dynamicDebris) {
      debris.cooldown = Math.max(0, debris.cooldown - delta);
      const position = debris.body.translation();
      const rotation = debris.body.rotation();
      debris.mesh.position.set(position.x, position.y, position.z);
      debris.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      if (position.y < -8) {
        debris.body.setTranslation({ x: 0, y: 2.6, z: -10 }, true);
        debris.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        debris.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  applyPlayerInfluence(position: THREE.Vector3, velocity: THREE.Vector3): void {
    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    if (planarSpeed < 2.2) return;
    for (const debris of this.dynamicDebris) {
      if (debris.cooldown > 0) continue;
      const bodyPosition = debris.body.translation();
      const dx = bodyPosition.x - position.x;
      const dz = bodyPosition.z - position.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared > 1.65 * 1.65 || distanceSquared < 0.001) continue;
      const inverseDistance = 1 / Math.sqrt(distanceSquared);
      const force = Math.min(2.8, planarSpeed * 0.34);
      debris.body.applyImpulse({ x: dx * inverseDistance * force, y: 0.32, z: dz * inverseDistance * force }, true);
      debris.body.applyTorqueImpulse({ x: dz * 0.1, y: force * 0.16, z: -dx * 0.1 }, true);
      debris.cooldown = 0.2;
    }
  }

  private createGroundComposition(): void {
    this.addStaticBox('buried-ground', [58, 1.8, 86], [0, -0.9, -6], this.basalt, undefined, true);

    const slabSizes: ReadonlyArray<readonly [number, number, number, number]> = [
      [-11, 20, 18, 13], [9, 21, 20, 14], [-12, 7, 16, 13], [9, 7, 20, 12],
      [-10, -7, 19, 13], [10, -7, 18, 13], [-9, -21, 20, 13], [10, -21, 19, 13],
    ];
    slabSizes.forEach(([x, z, width, depth], index) => {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, depth), index % 3 === 0 ? this.paleStone : this.wornStone);
      slab.position.set(x, -0.1 + (index % 2) * 0.025, z);
      slab.rotation.y = ((index % 5) - 2) * 0.007;
      slab.receiveShadow = true;
      this.group.add(slab);
    });

    const processional = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.18, 68), this.paleStone);
    processional.position.set(0, 0.02, -3);
    processional.receiveShadow = true;
    this.group.add(processional);

    for (let index = 0; index < 20; index += 1) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.025, 0.055), this.blackIron);
      seam.position.set(0, 0.125, 28 - index * 3.25);
      seam.material = (seam.material as THREE.Material).clone();
      (seam.material as THREE.MeshStandardMaterial).opacity = 0.28;
      (seam.material as THREE.MeshStandardMaterial).transparent = true;
      this.group.add(seam);
    }
  }

  private createSouthGate(): void {
    this.addStaticBox('south-left-bastion', [9, 8.5, 4.2], [-9.5, 4.25, 30], this.basalt, undefined, true);
    this.addStaticBox('south-right-bastion', [9, 8.5, 4.2], [9.5, 4.25, 30], this.basalt, undefined, true);
    this.addStaticBox('south-gate-lintel', [11, 2.2, 3.8], [0, 8.1, 30], this.basalt, undefined, true);
    this.createArchVisual(new THREE.Vector3(0, 5.9, 27.9), 5.4, 0.54, this.paleStone);

    for (const x of [-5.4, 5.4]) {
      this.addStaticBox(
        `south-buttress-${x}`,
        [1.7, 10.5, 5.4],
        [x, 5.25, 30.5],
        this.wornStone,
        new THREE.Euler(0, 0, x < 0 ? -0.055 : 0.055),
        true,
      );
    }
  }

  private createProcessionalStairs(): void {
    const startZ = 4.5;
    for (let index = 0; index < 6; index += 1) {
      const height = 0.18 * (index + 1);
      this.addStaticBox(
        `processional-step-${index + 1}`,
        [10.8 + index * 0.16, height, 1.35],
        [0, height / 2, startZ - index * 1.3],
        index % 2 === 0 ? this.paleStone : this.wornStone,
        undefined,
        true,
      );
    }
    this.addStaticBox('upper-forecourt', [25, 1.1, 22], [0, 0.55, -12.5], this.wornStone, undefined, true);

    for (const x of [-7.1, 7.1]) {
      this.addStaticBox(
        `stair-balustrade-${x}`,
        [1.0, 2.1, 11.5],
        [x, 1.05, 0.6],
        this.basalt,
        new THREE.Euler(0, 0, x < 0 ? -0.025 : 0.025),
        true,
      );
    }
  }

  private createNaveForecourt(): void {
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.8, 6.6, 64, 2), this.paleStone);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 1.115, -13.5);
    ring.receiveShadow = true;
    this.group.add(ring);

    const sigil = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.075, 8, 48), this.bronze);
    sigil.rotation.x = -Math.PI / 2;
    sigil.position.set(0, 1.15, -13.5);
    this.group.add(sigil);

    this.addStaticCylinder('oath-stone', 1.05, 3.7, [0, 2.95, -13.5], this.basalt, true);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.15, 8, 36), this.bronze);
    crown.position.set(0, 4.5, -13.5);
    crown.rotation.x = Math.PI / 2;
    crown.castShadow = true;
    this.group.add(crown);
  }

  private createBrokenColonnades(): void {
    for (const side of [-1, 1]) {
      for (let index = 0; index < 5; index += 1) {
        const x = side * (9.3 + (index % 2) * 0.35);
        const z = 15 - index * 9.5;
        const damage = (index + (side > 0 ? 2 : 0)) % 4;
        const height = 6.8 - damage * 0.72;
        this.createColumn(`colonnade-${side}-${index}`, new THREE.Vector3(x, 0, z), height, 0.72, damage > 1);
      }
    }

    this.addStaticBox('west-arcade-wall', [2.2, 5.4, 54], [-14.5, 2.7, -1], this.basalt, undefined, true);
    this.addStaticBox('east-arcade-wall', [2.2, 5.4, 54], [14.5, 2.7, -1], this.basalt, undefined, true);

    for (let index = 0; index < 4; index += 1) {
      const z = 17 - index * 13;
      this.createArchVisual(new THREE.Vector3(-13.3, 4.1, z), 3.3, 0.36, this.wornStone, Math.PI / 2);
      this.createArchVisual(new THREE.Vector3(13.3, 4.1, z), 3.3, 0.36, this.wornStone, -Math.PI / 2);
    }
  }

  private createCathedralFacade(): void {
    this.addStaticBox('cathedral-left-wing', [12.5, 15, 5.2], [-10.2, 8.5, -37], this.basalt, undefined, true);
    this.addStaticBox('cathedral-right-wing', [12.5, 15, 5.2], [10.2, 8.5, -37], this.basalt, undefined, true);
    this.addStaticBox('cathedral-crown', [11.5, 4.4, 5.2], [0, 15.2, -37], this.basalt, undefined, true);
    this.createArchVisual(new THREE.Vector3(0, 10.2, -34.25), 5.7, 0.62, this.paleStone);

    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 0.66, metalness: 0.78 });
    this.addStaticBox('cathedral-left-door', [4.2, 9.2, 0.38], [-2.12, 5.6, -34.55], doorMaterial, undefined, true);
    this.addStaticBox('cathedral-right-door', [4.2, 9.2, 0.38], [2.12, 5.6, -34.55], doorMaterial, undefined, true);

    const seal = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.12, 10, 48), this.bronze);
    seal.position.set(0, 6.1, -34.28);
    seal.castShadow = true;
    this.group.add(seal);

    for (const x of [-15.5, 15.5]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.3, 22, 10), this.basalt);
      tower.position.set(x, 11, -38.2);
      tower.castShadow = true;
      tower.receiveShadow = true;
      this.group.add(tower);
      this.cameraCollisionObjects.push(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 7, 10), this.blackIron);
      roof.position.set(x, 25.4, -38.2);
      roof.castShadow = true;
      this.group.add(roof);
    }
  }

  private createSideRoutes(): void {
    const westRampRotation = new THREE.Euler(0, 0, THREE.MathUtils.degToRad(-11.4));
    this.addStaticBox('west-ramp', [12, 0.55, 4.7], [-14.8, 1.18, -15], this.wornStone, westRampRotation, true);
    this.addStaticBox('west-overlook', [10, 0.8, 11], [-20.2, 2.6, -20], this.wornStone, undefined, true);
    this.addStaticBox('west-overlook-wall', [1.2, 3.8, 13], [-25.2, 4.1, -20], this.basalt, undefined, true);

    this.addStaticBox(
      'east-broken-bridge',
      [10.5, 0.65, 4.6],
      [18.2, 1.42, -4.5],
      this.paleStone,
      new THREE.Euler(0, -0.04, THREE.MathUtils.degToRad(8.5)),
      true,
    );
    this.addStaticBox('east-gallery', [10.5, 1.0, 14], [23.4, 2.8, -8], this.wornStone, undefined, true);
    this.addStaticBox('east-gallery-wall', [1.2, 5.5, 15], [28.6, 5.0, -8], this.basalt, undefined, true);
  }

  private createRubbleAndWear(): void {
    let state = 3471;
    const random = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };

    for (let index = 0; index < 96; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 7 + random() * 20;
      const zBias = (random() - 0.5) * 36;
      const rubble = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.12 + random() * 0.34, 0),
        index % 4 === 0 ? this.paleStone : this.basalt,
      );
      rubble.position.set(Math.cos(angle) * radius, 0.12 + random() * 0.15, zBias);
      rubble.rotation.set(random() * 2, random() * 2, random() * 2);
      rubble.scale.set(0.7 + random(), 0.35 + random() * 0.7, 0.7 + random());
      rubble.castShadow = true;
      rubble.receiveShadow = true;
      this.group.add(rubble);
    }

    for (let index = 0; index < 18; index += 1) {
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.08, 1.4 + (index % 5) * 0.4, 5), this.blackIron);
      root.position.set((index % 2 ? -1 : 1) * (7.8 + (index % 4) * 1.8), 0.45, 24 - index * 3.5);
      root.rotation.z = (index % 2 ? 1 : -1) * (0.8 + (index % 3) * 0.15);
      root.rotation.y = index * 0.53;
      this.group.add(root);
    }
  }

  private createDynamicDebris(): void {
    const placements: ReadonlyArray<readonly [number, number, number, number]> = [
      [-2.8, 1.55, 2.3, 0.36], [3.1, 1.52, 1.1, 0.31], [-5.7, 1.38, -5.8, 0.42],
      [5.8, 1.4, -8.2, 0.34], [-3.7, 1.55, -17.2, 0.46], [4.1, 1.52, -22.4, 0.38],
      [-7.6, 0.62, 10.4, 0.29], [7.9, 0.62, 13.8, 0.33], [-1.5, 1.52, -28.4, 0.4],
      [2.2, 1.52, -30.2, 0.32], [-10.6, 0.62, 6.4, 0.37], [10.8, 0.62, 4.2, 0.35],
    ];
    placements.forEach(([x, y, z, size], index) => {
      const geometry = index % 3 === 0
        ? new THREE.IcosahedronGeometry(size, 0)
        : new THREE.BoxGeometry(size * 1.5, size * 0.8, size * 1.1);
      const mesh = new THREE.Mesh(geometry, index % 4 === 0 ? this.paleStone : this.wornStone);
      mesh.position.set(x, y, z);
      mesh.rotation.set(index * 0.27, index * 0.61, index * 0.19);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, y, z)
          .setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w })
          .setLinearDamping(0.75)
          .setAngularDamping(0.9),
      );
      const collider = index % 3 === 0
        ? RAPIER.ColliderDesc.ball(size * 0.82)
        : RAPIER.ColliderDesc.cuboid(size * 0.75, size * 0.4, size * 0.55);
      this.physics.world.createCollider(collider.setDensity(1.7).setFriction(0.88).setRestitution(0.04), body);
      this.dynamicDebris.push({ mesh, body, cooldown: 0 });
    });
  }

  private createBannersAndChains(): void {
    const cloth = new THREE.MeshStandardMaterial({ color: 0x231416, roughness: 0.96, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      for (let index = 0; index < 3; index += 1) {
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 5.2, 2, 8), cloth.clone());
        banner.position.set(side * 8.7, 6.1, 11 - index * 16.5);
        banner.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        banner.rotation.z = side * (0.03 + index * 0.01);
        banner.castShadow = true;
        banner.userData.phase = index * 1.7 + side;
        this.group.add(banner);
        this.banners.push(banner);
      }
    }
    for (const x of [-3.8, 3.8]) {
      const chain = new THREE.Group();
      chain.position.set(x, 10.8, -33.6);
      for (let index = 0; index < 14; index += 1) {
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 5, 10), this.blackIron);
        link.position.y = -index * 0.29;
        link.rotation.y = index % 2 === 0 ? 0 : Math.PI / 2;
        chain.add(link);
      }
      this.group.add(chain);
    }
  }

  private createDistantSilhouette(): void {
    const silhouette = new THREE.MeshBasicMaterial({ color: 0x090b0d, fog: true });
    for (let index = 0; index < 18; index += 1) {
      const x = -62 + index * 7.4;
      const height = 18 + (index % 6) * 5;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(3.2 + (index % 3), height, 6), silhouette);
      spire.position.set(x, height / 2 - 2, -76 - (index % 4) * 9);
      this.group.add(spire);
    }
  }

  private createLightingAccents(): void {
    for (const [x, y, z] of [
      [-5.2, 2.8, 15], [5.2, 2.8, 15], [-7.5, 3.0, -5], [7.5, 3.0, -5],
      [-5.0, 3.2, -28], [5.0, 3.2, -28], [-20.2, 4.0, -20], [23.4, 4.2, -8],
    ] as const) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.72), this.blackIron);
      bracket.position.set(x, y - 0.25, z + 0.25);
      bracket.castShadow = true;
      this.group.add(bracket);
      this.atmosphere.addTorch(new THREE.Vector3(x, y, z), z < -20 ? 42 : 31);
    }
  }

  private createColumn(
    name: string,
    position: THREE.Vector3,
    height: number,
    radius: number,
    broken: boolean,
  ): void {
    this.addStaticCylinder(name, radius, height, [position.x, height / 2, position.z], this.wornStone, true);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.42, radius * 1.58, 0.42, 10), this.paleStone);
    base.position.set(position.x, 0.21, position.z);
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    const capital = new THREE.Mesh(new THREE.BoxGeometry(radius * 2.4, 0.46, radius * 2.4), this.paleStone);
    capital.position.set(position.x, height + 0.05, position.z);
    capital.rotation.y = position.z * 0.013;
    capital.castShadow = true;
    this.group.add(capital);
    if (broken) {
      capital.rotation.z = 0.2;
      const fragment = capital.clone();
      fragment.scale.set(0.62, 0.72, 0.75);
      fragment.position.add(new THREE.Vector3(radius * 1.8, -height * 0.58, radius * 1.1));
      fragment.rotation.set(0.7, 0.3, 1.2);
      this.group.add(fragment);
    }
  }

  private createArchVisual(
    position: THREE.Vector3,
    radius: number,
    thickness: number,
    material: THREE.Material,
    rotationY = 0,
  ): void {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 10, 48, Math.PI), material);
    arch.position.copy(position);
    arch.rotation.y = rotationY;
    arch.castShadow = true;
    arch.receiveShadow = true;
    this.group.add(arch);
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
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, height, 12), material);
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
