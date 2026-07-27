import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';

interface Torch {
  light: THREE.PointLight;
  flame: THREE.Mesh;
  phase: number;
  baseIntensity: number;
}

export class AtmosphereSystem {
  readonly group = new THREE.Group();
  private readonly ashGeometry: THREE.BufferGeometry;
  private readonly ashPositions: Float32Array;
  private readonly ashSpeeds: Float32Array;
  private readonly torches: Torch[] = [];
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const ash = this.createAsh();
    this.ashGeometry = ash.geometry;
    this.ashPositions = ash.positions;
    this.ashSpeeds = ash.speeds;
    this.group.add(ash.points);
    this.createFogSheets();
  }

  addTorch(position: THREE.Vector3, intensity = 34): void {
    const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xd29b58, transparent: true, opacity: 0.84 });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 7), flameMaterial);
    flame.position.copy(position);
    flame.position.y += 0.18;
    this.group.add(flame);

    const light = new THREE.PointLight(0xd38d4a, intensity, 15, 1.7);
    light.position.copy(position);
    light.castShadow = false;
    this.group.add(light);
    this.torches.push({ light, flame, phase: position.x * 0.71 + position.z * 0.37, baseIntensity: intensity });
  }

  update(delta: number): void {
    this.elapsed += delta;
    for (let index = 0; index < this.ashSpeeds.length; index += 1) {
      const offset = index * 3;
      const y = this.ashPositions[offset + 1];
      if (y === undefined) continue;
      let nextY = y + this.ashSpeeds[index]! * delta;
      if (nextY > 16) nextY = -1 + (index % 11) * 0.11;
      this.ashPositions[offset + 1] = nextY;
      this.ashPositions[offset] = (this.ashPositions[offset] ?? 0) + Math.sin(this.elapsed * 0.37 + index) * delta * 0.025;
    }
    const positionAttribute = this.ashGeometry.getAttribute('position');
    positionAttribute.needsUpdate = true;

    for (const torch of this.torches) {
      const flicker = Math.sin(this.elapsed * 8.7 + torch.phase) * 0.09
        + Math.sin(this.elapsed * 17.3 + torch.phase * 2.1) * 0.04;
      torch.light.intensity = torch.baseIntensity * (1 + flicker);
      torch.flame.scale.y = 0.92 + flicker * 1.6;
      torch.flame.rotation.z = Math.sin(this.elapsed * 5.1 + torch.phase) * 0.08;
    }
  }

  private createAsh(): {
    geometry: THREE.BufferGeometry;
    positions: Float32Array;
    speeds: Float32Array;
    points: THREE.Points;
  } {
    const count = GAME_CONFIG.world.ashCount;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    let state = GAME_CONFIG.world.seed >>> 0;
    const random = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967295;
    };

    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (random() - 0.5) * 92;
      positions[index * 3 + 1] = random() * 17;
      positions[index * 3 + 2] = (random() - 0.5) * 112;
      speeds[index] = 0.16 + random() * 0.34;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xb9b0a2,
      size: 0.055,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      sizeAttenuation: true,
    });
    return { geometry, positions, speeds, points: new THREE.Points(geometry, material) };
  }

  private createFogSheets(): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0x6c7478,
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let index = 0; index < 8; index += 1) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(34 + index * 2, 5.5), material.clone());
      sheet.position.set((index % 3 - 1) * 12, 1.6 + (index % 2) * 1.4, -30 + index * 9);
      sheet.rotation.set(-Math.PI / 2.8, (index % 2 ? 0.12 : -0.1), 0);
      this.group.add(sheet);
    }
  }
}
