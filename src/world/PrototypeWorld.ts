import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld';

export class PrototypeWorld {
  readonly group = new THREE.Group();
  private readonly probeMesh: THREE.Mesh;
  private readonly probeBody: RAPIER.RigidBody;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.group.name = 'foundation-courtyard';
    scene.add(this.group);

    this.createGround(physics);
    this.createCourtyardGeometry();
    this.createMarkers();

    const probeGeometry = new THREE.IcosahedronGeometry(0.62, 2);
    const probeMaterial = new THREE.MeshStandardMaterial({
      color: 0xd6b77d,
      emissive: 0x2f2415,
      roughness: 0.48,
      metalness: 0.22,
    });
    this.probeMesh = new THREE.Mesh(probeGeometry, probeMaterial);
    this.probeMesh.castShadow = true;
    this.probeMesh.receiveShadow = true;
    this.group.add(this.probeMesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 12, 0)
      .setLinearDamping(0.12)
      .setAngularDamping(0.1)
      .setCcdEnabled(true);
    this.probeBody = physics.world.createRigidBody(bodyDesc);
    const collider = RAPIER.ColliderDesc.ball(0.62)
      .setRestitution(0.52)
      .setFriction(0.75);
    physics.world.createCollider(collider, this.probeBody);
  }

  update(): void {
    const position = this.probeBody.translation();
    const rotation = this.probeBody.rotation();
    this.probeMesh.position.set(position.x, position.y, position.z);
    this.probeMesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    if (position.y < -20) this.resetProbe();
  }

  resetProbe(): void {
    this.probeBody.setTranslation({ x: 0, y: 12, z: 0 }, true);
    this.probeBody.setLinvel({ x: 1.2, y: 0, z: -0.7 }, true);
    this.probeBody.setAngvel({ x: 0.5, y: 1.1, z: 0.4 }, true);
  }

  private createGround(physics: PhysicsWorld): void {
    const material = new THREE.MeshStandardMaterial({ color: 0x292a28, roughness: 0.92, metalness: 0.02 });
    const ground = new THREE.Mesh(new THREE.BoxGeometry(34, 1, 34), material);
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.group.add(ground);

    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(17, 0.5, 17).setFriction(0.9), body);
  }

  private createCourtyardGeometry(): void {
    const stone = new THREE.MeshStandardMaterial({ color: 0x41403b, roughness: 0.88, metalness: 0.04 });
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x222423, roughness: 0.95 });

    for (const x of [-10, -5, 5, 10]) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.92, 7, 8), stone);
      column.position.set(x, 3.5, -7.5);
      column.castShadow = true;
      column.receiveShadow = true;
      this.group.add(column);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 2.2), darkStone);
      cap.position.set(x, 7.15, -7.5);
      cap.castShadow = true;
      cap.receiveShadow = true;
      this.group.add(cap);
    }

    const rearWall = new THREE.Mesh(new THREE.BoxGeometry(27, 8.5, 1.2), darkStone);
    rearWall.position.set(0, 4.25, -12.5);
    rearWall.receiveShadow = true;
    rearWall.castShadow = true;
    this.group.add(rearWall);

    const dais = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 5.5), stone);
    dais.position.set(0, 0.6, -7.8);
    dais.castShadow = true;
    dais.receiveShadow = true;
    this.group.add(dais);

    for (let index = 0; index < 4; index += 1) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(7.2 + index * 1.2, 0.35, 1.25), stone);
      step.position.set(0, 0.18 + index * 0.3, -3.1 - index * 0.95);
      step.castShadow = true;
      step.receiveShadow = true;
      this.group.add(step);
    }

    const monolith = new THREE.Mesh(new THREE.BoxGeometry(2.2, 6.2, 1.4), darkStone);
    monolith.position.set(0, 4.3, -8.4);
    monolith.rotation.z = -0.035;
    monolith.castShadow = true;
    monolith.receiveShadow = true;
    this.group.add(monolith);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.13, 10, 48),
      new THREE.MeshStandardMaterial({ color: 0xbda171, emissive: 0x342714, metalness: 0.5, roughness: 0.38 }),
    );
    ring.position.set(0, 5.1, -7.62);
    ring.castShadow = true;
    this.group.add(ring);

    for (let index = 0; index < 90; index += 1) {
      const angle = (index / 90) * Math.PI * 2;
      const radius = 7.5 + (index % 11) * 0.62;
      const shard = new THREE.Mesh(
        new THREE.ConeGeometry(0.08 + (index % 3) * 0.03, 0.45 + (index % 5) * 0.14, 5),
        stone,
      );
      shard.position.set(Math.cos(angle) * radius, 0.18, Math.sin(angle) * radius);
      shard.rotation.z = (index % 7) * 0.08 - 0.2;
      shard.castShadow = true;
      this.group.add(shard);
    }
  }

  private createMarkers(): void {
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xbca77f, transparent: true, opacity: 0.22 });
    for (const [x, z] of [[-8, 5], [8, 5], [-11, -2], [11, -2]] as const) {
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.34, 4.8, 7, 1, true), markerMaterial);
      marker.position.set(x, 2.4, z);
      this.group.add(marker);
    }
  }
}
