import * as THREE from 'three';
import RAPIER, { type Collider, type RigidBody } from '@dimforge/rapier3d-compat';
import type { AudioDirector } from '../audio/AudioDirector';
import type { CombatDirector } from '../combat/CombatDirector';
import { GAME_CONFIG } from '../config/GameConfig';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PlayerController } from '../player/PlayerController';

export interface ProgressionSnapshot {
  readonly ash: number;
  readonly flaskCharges: number;
  readonly flaskCapacity: number;
  readonly interaction: string | null;
  readonly notice: string | null;
  readonly areaName: string;
  readonly objective: string;
  readonly deathProgress: number;
  readonly recoveringAsh: number;
}

interface Shrine {
  readonly id: string;
  readonly name: string;
  readonly position: THREE.Vector3;
  readonly respawn: THREE.Vector3;
  readonly root: THREE.Group;
  readonly flame: THREE.Mesh;
  readonly light: THREE.PointLight;
  readonly rings: THREE.Mesh[];
  activated: boolean;
  phase: number;
}

interface Shortcut {
  readonly id: string;
  readonly name: string;
  readonly position: THREE.Vector3;
  readonly root: THREE.Group;
  readonly gate: THREE.Group;
  readonly lever: THREE.Group;
  readonly body: RigidBody;
  readonly collider: Collider;
  readonly closedY: number;
  readonly openY: number;
  open: boolean;
  progress: number;
}

export class ProgressionDirector {
  private readonly shrines: Shrine[] = [];
  private readonly shortcuts: Shortcut[] = [];
  private readonly playerPosition = new THREE.Vector3();
  private readonly recoveryRoot = new THREE.Group();
  private readonly recoveryCore: THREE.Mesh;
  private readonly recoveryMotes: THREE.Points;
  private activeShrine!: Shrine;
  private ash = 0;
  private recoveryAsh = 0;
  private recoveryPosition: THREE.Vector3 | null = null;
  private deathHandled = false;
  private respawnTimer = 0;
  private interaction: string | null = null;
  private notice: string | null = null;
  private noticeTimer = 0;
  private areaName = '대성당 진입로';
  private objective = '봉인된 대성당의 뒤편으로 향하라';
  private time = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly audio: AudioDirector,
  ) {
    this.createShrines();
    this.createShortcuts();
    const recoveryMaterial = new THREE.MeshStandardMaterial({
      color: 0xd1b77b,
      emissive: 0x8d5a22,
      emissiveIntensity: 2.4,
      roughness: 0.26,
      metalness: 0.12,
      transparent: true,
      opacity: 0.92,
    });
    this.recoveryCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), recoveryMaterial);
    this.recoveryCore.castShadow = true;
    this.recoveryRoot.add(this.recoveryCore);
    const moteGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(24 * 3);
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      const radius = 0.2 + (index % 5) * 0.075;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = (index % 7) * 0.12 - 0.15;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    moteGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.recoveryMotes = new THREE.Points(
      moteGeometry,
      new THREE.PointsMaterial({ color: 0xe2c891, size: 0.055, transparent: true, opacity: 0.78, depthWrite: false }),
    );
    this.recoveryRoot.add(this.recoveryMotes);
    this.recoveryRoot.visible = false;
    this.scene.add(this.recoveryRoot);
  }

  update(delta: number, player: PlayerController, combat: CombatDirector): void {
    this.time += delta;
    this.noticeTimer = Math.max(0, this.noticeTimer - delta);
    if (this.noticeTimer <= 0) this.notice = null;

    player.getWorldPosition(this.playerPosition);
    const reward = combat.consumeAshReward();
    if (reward > 0) {
      this.ash += reward;
      this.showNotice(`재의 흔적 +${reward}`, 1.65);
      this.audio.collectAsh();
    }

    this.updateShrines(delta);
    this.updateShortcuts(delta);
    this.updateRecovery(delta, player);
    this.updateArea(this.playerPosition);

    if (player.isDead()) {
      if (!this.deathHandled) this.beginDeath(player);
      this.respawnTimer += delta;
      this.interaction = null;
      if (this.respawnTimer >= GAME_CONFIG.player.respawnDelay) this.respawn(player, combat);
    } else {
      this.deathHandled = false;
      this.respawnTimer = 0;
      this.updateInteractionPrompt(combat);
    }
  }

  tryInteract(player: PlayerController, combat: CombatDirector): boolean {
    if (player.isDead()) return false;
    player.getWorldPosition(this.playerPosition);
    let closestDistance = Number.POSITIVE_INFINITY;
    let closestShrine: Shrine | null = null;
    let closestShortcut: Shortcut | null = null;

    for (const shrine of this.shrines) {
      const distance = shrine.position.distanceTo(this.playerPosition);
      if (distance < closestDistance && distance <= GAME_CONFIG.world.interactionRadius) {
        closestDistance = distance;
        closestShrine = shrine;
        closestShortcut = null;
      }
    }
    for (const shortcut of this.shortcuts) {
      if (shortcut.open) continue;
      const distance = shortcut.position.distanceTo(this.playerPosition);
      if (distance < closestDistance && distance <= GAME_CONFIG.world.interactionRadius) {
        closestDistance = distance;
        closestShrine = null;
        closestShortcut = shortcut;
      }
    }

    if (closestShrine) {
      if (combat.hasThreatNear(this.playerPosition, GAME_CONFIG.world.threatRadius)) {
        this.showNotice('적의 위협 속에서는 서약을 새길 수 없습니다', 2.1);
        return true;
      }
      this.activateShrine(closestShrine, player, combat);
      return true;
    }
    if (closestShortcut) {
      if (combat.hasThreatNear(this.playerPosition, GAME_CONFIG.world.threatRadius)) {
        this.showNotice('적의 위협 속에서는 장치를 움직일 수 없습니다', 2.1);
        return true;
      }
      closestShortcut.open = true;
      this.audio.shortcut();
      this.showNotice(`${closestShortcut.name} 지름길이 열렸습니다`, 2.4);
      return true;
    }
    return false;
  }

  getSnapshot(player: PlayerController): ProgressionSnapshot {
    return {
      ash: this.ash,
      flaskCharges: player.getFlaskCharges(),
      flaskCapacity: GAME_CONFIG.player.flaskCapacity,
      interaction: this.interaction,
      notice: this.notice,
      areaName: this.areaName,
      objective: this.objective,
      deathProgress: this.deathHandled
        ? THREE.MathUtils.clamp(this.respawnTimer / GAME_CONFIG.player.respawnDelay, 0, 1)
        : 0,
      recoveringAsh: this.recoveryAsh,
    };
  }

  private createShrines(): void {
    const definitions = [
      { id: 'gate', name: '무너진 성문', position: new THREE.Vector3(-3.5, 0.28, 23.5), respawn: new THREE.Vector3(0, 1.12, 22) },
      { id: 'cloister', name: '종루 회랑', position: new THREE.Vector3(23.2, 3.42, -36.5), respawn: new THREE.Vector3(20.8, 3.56, -34.5) },
      { id: 'altar', name: '잿빛 제단', position: new THREE.Vector3(0, 1.36, -58.8), respawn: new THREE.Vector3(0, 1.62, -56.2) },
    ] as const;
    definitions.forEach((definition, index) => {
      const root = new THREE.Group();
      root.position.copy(definition.position);
      root.name = `oath-shrine-${definition.id}`;
      const stone = new THREE.MeshStandardMaterial({ color: 0x25292b, roughness: 0.86, metalness: 0.22 });
      const metal = new THREE.MeshStandardMaterial({ color: 0x6f6655, roughness: 0.38, metalness: 0.82 });
      const ember = new THREE.MeshStandardMaterial({
        color: 0xc8a76f,
        emissive: 0x8a4318,
        emissiveIntensity: index === 0 ? 1.9 : 0.42,
        roughness: 0.32,
      });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.98, 0.34, 10), stone);
      base.position.y = 0.17;
      base.receiveShadow = true;
      root.add(base);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 0.17), metal);
      blade.position.y = 1.02;
      blade.rotation.z = 0.12;
      blade.castShadow = true;
      root.add(blade);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.08, 0.12), metal);
      guard.position.set(-0.06, 0.49, 0);
      guard.rotation.z = 0.12;
      root.add(guard);
      const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.27, 1), ember);
      flame.position.set(0.08, 0.63, -0.08);
      flame.scale.set(0.72, 1.45, 0.72);
      root.add(flame);
      const rings: THREE.Mesh[] = [];
      for (let ringIndex = 0; ringIndex < 2; ringIndex += 1) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58 + ringIndex * 0.19, 0.025, 6, 30), metal.clone());
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.26 + ringIndex * 0.08;
        root.add(ring);
        rings.push(ring);
      }
      const light = new THREE.PointLight(0xc58c4c, index === 0 ? 22 : 2.5, 10, 1.8);
      light.position.y = 1.05;
      root.add(light);
      this.scene.add(root);
      const shrine: Shrine = {
        ...definition,
        root,
        flame,
        light,
        rings,
        activated: index === 0,
        phase: index * 1.9,
      };
      this.shrines.push(shrine);
      if (index === 0) this.activeShrine = shrine;
    });
  }

  private createShortcuts(): void {
    const definitions = [
      { id: 'west-portcullis', name: '서쪽 회랑', position: new THREE.Vector3(-14.6, 1.6, -17), size: new THREE.Vector3(0.7, 3.4, 6.2), openLift: 4.1 },
      { id: 'bell-chain', name: '종루 승강문', position: new THREE.Vector3(16.3, 3.2, -34.5), size: new THREE.Vector3(0.75, 4.2, 6.6), openLift: 5.0 },
      { id: 'altar-seal', name: '제단 귀환문', position: new THREE.Vector3(-8.8, 1.8, -57.5), size: new THREE.Vector3(6.4, 3.6, 0.72), openLift: 4.4 },
    ] as const;
    for (const definition of definitions) {
      const root = new THREE.Group();
      root.name = `shortcut-${definition.id}`;
      const gate = new THREE.Group();
      const iron = new THREE.MeshStandardMaterial({ color: 0x171b1d, roughness: 0.48, metalness: 0.84 });
      const bronze = new THREE.MeshStandardMaterial({ color: 0x716044, roughness: 0.45, metalness: 0.72 });
      for (let index = -3; index <= 3; index += 1) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, definition.size.y, 0.12), iron);
        if (definition.size.x < definition.size.z) bar.position.set(0, 0, index * 0.78);
        else bar.position.set(index * 0.78, 0, 0);
        bar.castShadow = true;
        gate.add(bar);
      }
      const cross = new THREE.Mesh(new THREE.BoxGeometry(definition.size.x, 0.16, definition.size.z), iron);
      gate.add(cross);
      root.add(gate);
      const lever = new THREE.Group();
      lever.position.copy(definition.position).add(new THREE.Vector3(definition.size.x < definition.size.z ? 1.2 : 0, -0.4, definition.size.x >= definition.size.z ? 1.2 : 0));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.25, 8), iron);
      post.position.y = 0.62;
      lever.add(post);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), bronze);
      handle.position.set(0, 1.05, -0.22);
      handle.rotation.x = 0.55;
      lever.add(handle);
      root.add(lever);
      gate.position.copy(definition.position);
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
          definition.position.x,
          definition.position.y,
          definition.position.z,
        ),
      );
      const collider = this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(definition.size.x / 2, definition.size.y / 2, definition.size.z / 2).setFriction(0.9),
        body,
      );
      this.scene.add(root);
      this.shortcuts.push({
        id: definition.id,
        name: definition.name,
        position: lever.position.clone().add(new THREE.Vector3(0, 0.9, 0)),
        root,
        gate,
        lever,
        body,
        collider,
        closedY: definition.position.y,
        openY: definition.position.y + definition.openLift,
        open: false,
        progress: 0,
      });
    }
  }

  private activateShrine(shrine: Shrine, player: PlayerController, combat: CombatDirector): void {
    this.activeShrine = shrine;
    shrine.activated = true;
    player.restAtCheckpoint();
    combat.resetAtRest();
    this.audio.checkpoint();
    this.showNotice(`${shrine.name}에 서약을 새겼습니다`, 2.55);
  }

  private beginDeath(player: PlayerController): void {
    this.deathHandled = true;
    this.respawnTimer = 0;
    player.getWorldPosition(this.playerPosition);
    this.recoveryAsh = 0;
    this.recoveryPosition = null;
    this.recoveryRoot.visible = false;
    if (this.ash > 0) {
      this.recoveryAsh = this.ash;
      this.recoveryPosition = this.playerPosition.y < -4 ? this.activeShrine.position.clone() : this.playerPosition.clone();
      this.recoveryRoot.position.copy(this.recoveryPosition).add(new THREE.Vector3(0, 0.5, 0));
      this.recoveryRoot.visible = true;
      this.ash = 0;
    }
    this.audio.death();
    this.showNotice('서약이 꺾였습니다', GAME_CONFIG.player.respawnDelay);
  }

  private respawn(player: PlayerController, combat: CombatDirector): void {
    player.respawnAt(this.activeShrine.respawn);
    player.refillFlasks();
    combat.resetAtRest();
    this.deathHandled = false;
    this.respawnTimer = 0;
    this.showNotice(`${this.activeShrine.name}에서 다시 일어섭니다`, 2.2);
  }

  private updateRecovery(delta: number, player: PlayerController): void {
    if (!this.recoveryPosition || this.recoveryAsh <= 0) {
      this.recoveryRoot.visible = false;
      return;
    }
    this.recoveryRoot.visible = true;
    this.recoveryRoot.position.y = this.recoveryPosition.y + 0.52 + Math.sin(this.time * 2.7) * 0.11;
    this.recoveryRoot.rotation.y += delta * 0.8;
    this.recoveryCore.rotation.x += delta * 0.7;
    this.recoveryMotes.rotation.y -= delta * 1.15;
    player.getWorldPosition(this.playerPosition);
    if (!player.isDead() && this.playerPosition.distanceTo(this.recoveryPosition) <= GAME_CONFIG.world.recoveryRadius) {
      const recovered = this.recoveryAsh;
      this.ash += recovered;
      this.recoveryAsh = 0;
      this.recoveryPosition = null;
      this.recoveryRoot.visible = false;
      this.audio.collectAsh();
      this.showNotice(`잃어버린 재 ${recovered}을 회수했습니다`, 2.25);
    }
  }

  private updateShrines(delta: number): void {
    for (const shrine of this.shrines) {
      const active = shrine === this.activeShrine || shrine.activated;
      const targetIntensity = active ? 20 : 2.2;
      shrine.light.intensity += (targetIntensity - shrine.light.intensity) * (1 - Math.exp(-5 * delta));
      const material = shrine.flame.material as THREE.MeshStandardMaterial;
      const targetEmissive = active ? 2.2 : 0.48;
      material.emissiveIntensity += (targetEmissive - material.emissiveIntensity) * (1 - Math.exp(-6 * delta));
      shrine.flame.scale.y = 1.35 + Math.sin(this.time * 4.6 + shrine.phase) * 0.16;
      shrine.flame.rotation.y += delta * (active ? 1.25 : 0.35);
      shrine.rings.forEach((ring, index) => {
        ring.rotation.z += delta * (index === 0 ? 0.35 : -0.22);
      });
    }
  }

  private updateShortcuts(delta: number): void {
    for (const shortcut of this.shortcuts) {
      const target = shortcut.open ? 1 : 0;
      shortcut.progress += (target - shortcut.progress) * (1 - Math.exp(-2.5 * delta));
      const y = THREE.MathUtils.lerp(shortcut.closedY, shortcut.openY, easeInOut(shortcut.progress));
      shortcut.gate.position.y = y;
      shortcut.body.setNextKinematicTranslation({
        x: shortcut.gate.position.x,
        y,
        z: shortcut.gate.position.z,
      });
      shortcut.lever.rotation.z = THREE.MathUtils.lerp(0, -1.05, shortcut.progress);
      if (shortcut.progress > 0.96) shortcut.collider.setEnabled(false);
    }
  }

  private updateInteractionPrompt(combat: CombatDirector): void {
    this.interaction = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const shrine of this.shrines) {
      const distance = shrine.position.distanceTo(this.playerPosition);
      if (distance <= GAME_CONFIG.world.interactionRadius && distance < bestDistance) {
        bestDistance = distance;
        this.interaction = combat.hasThreatNear(this.playerPosition, GAME_CONFIG.world.threatRadius)
          ? '적을 물리쳐 서약석을 밝히기'
          : `E  ${shrine.name}에서 휴식`;
      }
    }
    for (const shortcut of this.shortcuts) {
      if (shortcut.open) continue;
      const distance = shortcut.position.distanceTo(this.playerPosition);
      if (distance <= GAME_CONFIG.world.interactionRadius && distance < bestDistance) {
        bestDistance = distance;
        this.interaction = combat.hasThreatNear(this.playerPosition, GAME_CONFIG.world.threatRadius)
          ? '적을 물리쳐 장치를 작동시키기'
          : `E  ${shortcut.name} 지름길 열기`;
      }
    }
  }

  private updateArea(position: THREE.Vector3): void {
    if (position.z < -54) {
      this.areaName = '잿빛 제단';
      this.objective = '대성당의 마지막 봉인을 마주하라';
    } else if (position.x > 14 && position.z < -18) {
      this.areaName = '종루 회랑';
      this.objective = '회랑의 승강문을 열어 제단으로 향하라';
    } else {
      this.areaName = '대성당 진입로';
      this.objective = '종루 회랑으로 이어지는 길을 찾아라';
    }
  }

  private showNotice(message: string, duration: number): void {
    this.notice = message;
    this.noticeTimer = duration;
  }
}

function easeInOut(value: number): number {
  return value * value * (3 - 2 * value);
}
