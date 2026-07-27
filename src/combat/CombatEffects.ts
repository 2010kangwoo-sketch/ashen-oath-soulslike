import * as THREE from 'three';

interface Spark {
  readonly mesh: THREE.Mesh;
  readonly velocity: THREE.Vector3;
  life: number;
  readonly maxLife: number;
}

interface ShockRing {
  readonly mesh: THREE.Mesh;
  life: number;
  readonly maxLife: number;
}

export class CombatEffects {
  private readonly group = new THREE.Group();
  private readonly sparks: Spark[] = [];
  private readonly rings: ShockRing[] = [];
  private readonly sparkGeometry = new THREE.BoxGeometry(0.025, 0.025, 0.22);
  private readonly sparkMaterial = new THREE.MeshBasicMaterial({
    color: 0xe6c58b,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly ringGeometry = new THREE.RingGeometry(0.18, 0.23, 24);
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xe1b975,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  constructor(scene: THREE.Scene) {
    this.group.name = 'combat-effects';
    scene.add(this.group);
  }

  spawnHit(position: THREE.Vector3, heavy: boolean): void {
    const count = heavy ? 20 : 11;
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(this.sparkGeometry, this.sparkMaterial.clone());
      mesh.position.copy(position);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * (heavy ? 7 : 4.5),
        1.2 + Math.random() * (heavy ? 5 : 3),
        (Math.random() - 0.5) * (heavy ? 7 : 4.5),
      );
      const maxLife = 0.24 + Math.random() * 0.2;
      this.group.add(mesh);
      this.sparks.push({ mesh, velocity, life: maxLife, maxLife });
    }

    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial.clone());
    ring.position.copy(position);
    ring.lookAt(position.clone().add(new THREE.Vector3(0, 0.25, 1)));
    ring.scale.setScalar(heavy ? 1.4 : 0.85);
    this.group.add(ring);
    this.rings.push({ mesh: ring, life: 0.22, maxLife: 0.22 });
  }

  spawnGuard(position: THREE.Vector3): void {
    const ring = this.makeRing(position, 0xb9c2c5, 0.95, 0.2);
    ring.rotation.set(0, 0, Math.PI / 2);
  }

  spawnParry(position: THREE.Vector3): void {
    this.spawnHit(position, true);
    const ring = this.makeRing(position, 0xf5e4b5, 1.8, 0.34);
    ring.rotation.set(Math.PI / 2, 0, 0);
  }

  spawnPostureBreak(position: THREE.Vector3): void {
    for (let index = 0; index < 3; index += 1) {
      const ring = this.makeRing(position, 0xd36b3c, 1.1 + index * 0.5, 0.42 + index * 0.05);
      ring.rotation.set(index * 0.7, index * 0.9, index * 0.4);
    }
  }

  spawnExecution(position: THREE.Vector3): void {
    this.spawnHit(position, true);
    for (let index = 0; index < 4; index += 1) {
      const ring = this.makeRing(position, index % 2 === 0 ? 0xe4c18b : 0x9d2f20, 1.5 + index * 0.55, 0.5);
      ring.rotation.set(index * 0.52, index * 0.74, index * 0.31);
    }
  }

  spawnEvade(position: THREE.Vector3): void {
    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial.clone());
    (ring.material as THREE.MeshBasicMaterial).color.setHex(0x8ea7b3);
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.42;
    ring.position.copy(position);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(0.7);
    this.group.add(ring);
    this.rings.push({ mesh: ring, life: 0.32, maxLife: 0.32 });
  }

  private makeRing(
    position: THREE.Vector3,
    color: number,
    scale: number,
    life: number,
  ): THREE.Mesh {
    const material = this.ringMaterial.clone();
    material.color.setHex(color);
    material.opacity = 0.86;
    const ring = new THREE.Mesh(this.ringGeometry, material);
    ring.position.copy(position);
    ring.scale.setScalar(scale);
    this.group.add(ring);
    this.rings.push({ mesh: ring, life, maxLife: life });
    return ring;
  }

  update(delta: number): void {
    for (let index = this.sparks.length - 1; index >= 0; index -= 1) {
      const spark = this.sparks[index];
      if (!spark) continue;
      spark.life -= delta;
      spark.velocity.y -= 14 * delta;
      spark.mesh.position.addScaledVector(spark.velocity, delta);
      spark.mesh.scale.z = Math.max(0.15, spark.velocity.length() * 0.13);
      (spark.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, spark.life / spark.maxLife);
      if (spark.life <= 0) {
        this.group.remove(spark.mesh);
        spark.mesh.geometry = this.sparkGeometry;
        (spark.mesh.material as THREE.Material).dispose();
        this.sparks.splice(index, 1);
      }
    }

    for (let index = this.rings.length - 1; index >= 0; index -= 1) {
      const ring = this.rings[index];
      if (!ring) continue;
      ring.life -= delta;
      const normalized = 1 - Math.max(0, ring.life / ring.maxLife);
      ring.mesh.scale.multiplyScalar(1 + delta * (7 + normalized * 4));
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - normalized) * 0.72;
      if (ring.life <= 0) {
        this.group.remove(ring.mesh);
        (ring.mesh.material as THREE.Material).dispose();
        this.rings.splice(index, 1);
      }
    }
  }
}
