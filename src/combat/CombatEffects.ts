import * as THREE from 'three';
import type { BossSummonKind, PlayerSkillEvent } from './CombatTypes';

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
  private static readonly MAX_SPARKS = 150;
  private static readonly MAX_RINGS = 40;
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
    this.trimEffects();
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

  spawnSkill(event: PlayerSkillEvent): void {
    if (event.phase === 'cast') {
      const color = event.skillId === 'ashStep' ? 0x74c7dd : event.skillId === 'oathCounter' ? 0x8beaff : 0xe96d36;
      const ring = this.makeRing(event.position, color, event.skillId === 'cinderArc' ? 1.25 : 0.72, 0.34);
      ring.rotation.x = -Math.PI / 2;
      return;
    }

    if (event.skillId === 'ashStep') {
      this.spawnDirectionalBurst(event.position, event.forward, 0x8ed8eb, 18, 8.5 * event.intensity);
      const ring = this.makeRing(event.position, 0xa5eaff, 1.35, 0.28);
      ring.rotation.y = Math.atan2(event.forward.x, event.forward.z);
      ring.rotation.z = Math.PI / 2;
    } else if (event.skillId === 'oathCounter') {
      this.spawnDirectionalBurst(event.position, event.forward, 0xb5f4ff, 24, 7.2 * event.intensity);
      for (let index = 0; index < 3; index += 1) {
        const ring = this.makeRing(event.position, index === 1 ? 0xffffff : 0x73d9f2, 1.1 + index * 0.42, 0.34 + index * 0.04);
        ring.rotation.set(index * 0.52, index * 0.78, Math.PI / 2 + index * 0.34);
      }
    } else {
      this.spawnRadialBurst(event.position, 0xff8a45, Math.round(20 + event.intensity * 10), 4.6 + event.intensity * 2.8);
      for (let index = 0; index < 2; index += 1) {
        const ring = this.makeRing(event.position, index === 0 ? 0xff9a52 : 0xd84c27, 1.1 + event.intensity * 0.62 + index * 0.55, 0.44);
        ring.rotation.x = -Math.PI / 2;
      }
    }
  }

  spawnCounter(position: THREE.Vector3): void {
    this.spawnRadialBurst(position, 0xa8efff, 34, 9.5);
    for (let index = 0; index < 5; index += 1) {
      const ring = this.makeRing(position, index % 2 === 0 ? 0xd9fbff : 0x58c7e8, 1.35 + index * 0.55, 0.52);
      ring.rotation.set(index * 0.46, index * 0.73, index * 0.29);
    }
  }

  spawnSummon(position: THREE.Vector3, kind: BossSummonKind): void {
    const color = kind === 'broodling' ? 0xb94b38 : kind === 'mirrorEcho' ? 0xb4cadf : 0xd3914f;
    this.spawnRadialBurst(position, color, 22, 5.5);
    const ring = this.makeRing(position, color, 1.7, 0.58);
    ring.rotation.x = -Math.PI / 2;
  }

  private spawnDirectionalBurst(
    position: THREE.Vector3,
    forward: THREE.Vector3,
    color: number,
    count: number,
    speed: number,
  ): void {
    const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
    for (let index = 0; index < count; index += 1) {
      const material = this.sparkMaterial.clone();
      material.color.setHex(color);
      const mesh = new THREE.Mesh(this.sparkGeometry, material);
      mesh.position.copy(position);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      const velocity = forward.clone().multiplyScalar(speed * (0.45 + Math.random() * 0.65))
        .addScaledVector(right, (Math.random() - 0.5) * speed * 0.8);
      velocity.y += 0.6 + Math.random() * 3.4;
      const maxLife = 0.2 + Math.random() * 0.24;
      this.group.add(mesh);
      this.sparks.push({ mesh, velocity, life: maxLife, maxLife });
    }
    this.trimEffects();
  }

  private spawnRadialBurst(position: THREE.Vector3, color: number, count: number, speed: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.2;
      const material = this.sparkMaterial.clone();
      material.color.setHex(color);
      const mesh = new THREE.Mesh(this.sparkGeometry, material);
      mesh.position.copy(position);
      mesh.rotation.set(Math.random() * Math.PI, angle, Math.random() * Math.PI);
      const velocity = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
        .multiplyScalar(speed * (0.55 + Math.random() * 0.5));
      velocity.y = 0.8 + Math.random() * 3.2;
      const maxLife = 0.25 + Math.random() * 0.28;
      this.group.add(mesh);
      this.sparks.push({ mesh, velocity, life: maxLife, maxLife });
    }
    this.trimEffects();
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
    this.trimEffects();
    return ring;
  }

  private trimEffects(): void {
    while (this.sparks.length > CombatEffects.MAX_SPARKS) {
      const spark = this.sparks.shift();
      if (!spark) break;
      this.group.remove(spark.mesh);
      (spark.mesh.material as THREE.Material).dispose();
    }
    while (this.rings.length > CombatEffects.MAX_RINGS) {
      const ring = this.rings.shift();
      if (!ring) break;
      this.group.remove(ring.mesh);
      (ring.mesh.material as THREE.Material).dispose();
    }
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
