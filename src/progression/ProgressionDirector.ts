import * as THREE from 'three';
import RAPIER, { type Collider, type RigidBody } from '@dimforge/rapier3d-compat';
import type { AudioDirector } from '../audio/AudioDirector';
import type { CombatDirector } from '../combat/CombatDirector';
import { GAME_CONFIG } from '../config/GameConfig';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PlayerController } from '../player/PlayerController';

export type EndingChoice = 'inherit' | 'sever';

export interface EndingSnapshot {
  readonly active: boolean;
  readonly choice: EndingChoice | null;
  readonly title: string;
  readonly subtitle: string;
  readonly quote: string;
  readonly creditsProgress: number;
}

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
  readonly ending: EndingSnapshot;
}

export interface ProgressionSaveState {
  readonly ash: number;
  readonly recoveryAsh: number;
  readonly recoveryPosition: readonly [number, number, number] | null;
  readonly activeShrineId: string;
  readonly activatedShrineIds: readonly string[];
  readonly openedShortcutIds: readonly string[];
  readonly endingsSeen: readonly EndingChoice[];
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

interface EndingAltar {
  readonly choice: EndingChoice;
  readonly name: string;
  readonly position: THREE.Vector3;
  readonly root: THREE.Group;
  readonly core: THREE.Mesh;
  readonly light: THREE.PointLight;
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
  private readonly endingAltars: EndingAltar[] = [];
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
  private endingChoice: EndingChoice | null = null;
  private endingTimer = 0;
  private readonly endingsSeen = new Set<EndingChoice>();
  private saveRequested = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly audio: AudioDirector,
  ) {
    this.createShrines();
    this.createShortcuts();
    this.createEndingAltars();
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
      this.saveRequested = true;
    }

    this.updateShrines(delta);
    this.updateShortcuts(delta);
    this.updateRecovery(delta, player);
    this.updateArea(this.playerPosition, combat);
    this.updateEnding(delta, combat);

    if (this.endingChoice) {
      this.interaction = null;
      return;
    }

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
    if (player.isDead() || this.endingChoice) return false;
    player.getWorldPosition(this.playerPosition);
    let closestDistance = Number.POSITIVE_INFINITY;
    let closestShrine: Shrine | null = null;
    let closestShortcut: Shortcut | null = null;
    let closestEnding: EndingAltar | null = null;

    for (const shrine of this.shrines) {
      const distance = shrine.position.distanceTo(this.playerPosition);
      if (distance < closestDistance && distance <= GAME_CONFIG.world.interactionRadius) {
        closestDistance = distance;
        closestShrine = shrine;
        closestShortcut = null;
        closestEnding = null;
      }
    }
    for (const shortcut of this.shortcuts) {
      if (shortcut.open) continue;
      const distance = shortcut.position.distanceTo(this.playerPosition);
      if (distance < closestDistance && distance <= GAME_CONFIG.world.interactionRadius) {
        closestDistance = distance;
        closestShrine = null;
        closestShortcut = shortcut;
        closestEnding = null;
      }
    }

    if (combat.areAllBossesDefeated()) {
      for (const altar of this.endingAltars) {
        const distance = altar.position.distanceTo(this.playerPosition);
        if (distance < closestDistance && distance <= GAME_CONFIG.world.interactionRadius + 0.4) {
          closestDistance = distance;
          closestShrine = null;
          closestShortcut = null;
          closestEnding = altar;
        }
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
    if (closestEnding) {
      this.beginEnding(closestEnding.choice);
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
      this.saveRequested = true;
      return true;
    }
    return false;
  }



  consumeSaveRequest(): boolean {
    const requested = this.saveRequested;
    this.saveRequested = false;
    return requested;
  }

  startNewGame(player: PlayerController, combat: CombatDirector): void {
    this.ash = 0;
    this.recoveryAsh = 0;
    this.recoveryPosition = null;
    this.recoveryRoot.visible = false;
    this.deathHandled = false;
    this.respawnTimer = 0;
    this.endingChoice = null;
    this.endingTimer = 0;
    this.endingsSeen.clear();
    this.saveRequested = false;
    this.activeShrine = this.shrines[0]!;
    this.shrines.forEach((shrine, index) => { shrine.activated = index === 0; });
    for (const shortcut of this.shortcuts) this.applyShortcutState(shortcut, false);
    combat.reset();
    player.reset();
    this.showNotice('새로운 서약이 시작되었습니다', 2.2);
  }

  restartAtCheckpoint(player: PlayerController, combat: CombatDirector): void {
    this.deathHandled = false;
    this.respawnTimer = 0;
    this.endingChoice = null;
    this.endingTimer = 0;
    player.respawnAt(this.activeShrine.respawn);
    player.refillFlasks();
    combat.resetAtRest();
    this.showNotice(`${this.activeShrine.name}에서 다시 시작합니다`, 2.1);
  }

  getSaveState(): ProgressionSaveState {
    const recoveryPosition = this.recoveryPosition
      ? [this.recoveryPosition.x, this.recoveryPosition.y, this.recoveryPosition.z] as const
      : null;
    return {
      ash: Math.max(0, Math.floor(this.ash)),
      recoveryAsh: Math.max(0, Math.floor(this.recoveryAsh)),
      recoveryPosition,
      activeShrineId: this.activeShrine.id,
      activatedShrineIds: this.shrines.filter((shrine) => shrine.activated).map((shrine) => shrine.id),
      openedShortcutIds: this.shortcuts.filter((shortcut) => shortcut.open).map((shortcut) => shortcut.id),
      endingsSeen: [...this.endingsSeen],
    };
  }

  restoreSaveState(state: ProgressionSaveState, player: PlayerController): void {
    this.ash = Math.max(0, Math.floor(state.ash));
    this.recoveryAsh = Math.max(0, Math.floor(state.recoveryAsh));
    this.recoveryPosition = state.recoveryPosition
      ? new THREE.Vector3(state.recoveryPosition[0], state.recoveryPosition[1], state.recoveryPosition[2])
      : null;
    this.recoveryRoot.visible = Boolean(this.recoveryPosition && this.recoveryAsh > 0);
    if (this.recoveryPosition) this.recoveryRoot.position.copy(this.recoveryPosition).add(new THREE.Vector3(0, 0.5, 0));
    const activated = new Set(state.activatedShrineIds);
    this.shrines.forEach((shrine, index) => {
      shrine.activated = index === 0 || activated.has(shrine.id);
    });
    this.activeShrine = this.shrines.find((shrine) => shrine.id === state.activeShrineId) ?? this.shrines[0]!;
    this.activeShrine.activated = true;
    const opened = new Set(state.openedShortcutIds);
    for (const shortcut of this.shortcuts) this.applyShortcutState(shortcut, opened.has(shortcut.id));
    this.endingsSeen.clear();
    for (const ending of state.endingsSeen) {
      if (ending === 'inherit' || ending === 'sever') this.endingsSeen.add(ending);
    }
    this.endingChoice = null;
    this.endingTimer = 0;
    this.deathHandled = false;
    this.respawnTimer = 0;
    this.saveRequested = false;
    this.interaction = null;
    player.respawnAt(this.activeShrine.respawn);
    player.refillFlasks();
    this.showNotice(`${this.activeShrine.name}의 기록을 불러왔습니다`, 2.35);
  }

  isEndingLocked(): boolean {
    return this.endingChoice !== null;
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
      ending: this.getEndingSnapshot(),
    };
  }

  private createShrines(): void {
    const definitions = [
      { id: 'gate', name: '무너진 성문', position: new THREE.Vector3(-3.5, 0.28, 23.5), respawn: new THREE.Vector3(0, 1.12, 22) },
      { id: 'cloister', name: '종루 회랑', position: new THREE.Vector3(23.2, 3.42, -36.5), respawn: new THREE.Vector3(20.8, 3.56, -34.5) },
      { id: 'altar', name: '잿빛 제단', position: new THREE.Vector3(0, 1.36, -58.8), respawn: new THREE.Vector3(0, 1.62, -56.2) },
      { id: 'widow-nave', name: '끊어진 종의 회랑', position: new THREE.Vector3(-3.2, 1.18, -125.2), respawn: new THREE.Vector3(0, 2.12, -124.2) },
      { id: 'last-bridge', name: '마지막 서약의 다리', position: new THREE.Vector3(3.2, 1.18, -179.0), respawn: new THREE.Vector3(0, 2.12, -178.0) },
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

  private createEndingAltars(): void {
    const definitions = [
      { choice: 'inherit' as const, name: '서약을 계승한다', position: new THREE.Vector3(-3.4, 2.18, -222.0), color: 0xc29562 },
      { choice: 'sever' as const, name: '서약을 끊는다', position: new THREE.Vector3(3.4, 2.18, -222.0), color: 0xa85b58 },
    ];
    for (const definition of definitions) {
      const root = new THREE.Group();
      root.name = `ending-altar-${definition.choice}`;
      root.position.copy(definition.position);
      root.visible = false;
      const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.72, metalness: 0.42 });
      const coreMaterial = new THREE.MeshStandardMaterial({
        color: definition.color,
        emissive: definition.color,
        emissiveIntensity: 1.2,
        roughness: 0.24,
        metalness: 0.36,
        transparent: true,
        opacity: 0.88,
      });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.92, 0.34, 10), baseMaterial);
      base.position.y = 0.17;
      root.add(base);
      const core = new THREE.Mesh(
        definition.choice === 'inherit'
          ? new THREE.OctahedronGeometry(0.42, 1)
          : new THREE.TetrahedronGeometry(0.48, 1),
        coreMaterial,
      );
      core.position.y = 0.86;
      core.castShadow = true;
      root.add(core);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.035, 6, 32), coreMaterial.clone());
      ring.position.y = 0.45;
      ring.rotation.x = Math.PI / 2;
      root.add(ring);
      const light = new THREE.PointLight(definition.color, 0, 8, 1.7);
      light.position.y = 1.0;
      root.add(light);
      this.scene.add(root);
      this.endingAltars.push({ ...definition, root, core, light });
    }
  }

  private updateEnding(delta: number, combat: CombatDirector): void {
    const available = combat.areAllBossesDefeated();
    for (const altar of this.endingAltars) {
      altar.root.visible = available && !this.endingChoice;
      if (!altar.root.visible) continue;
      const phase = altar.choice === 'inherit' ? 0 : Math.PI;
      altar.root.rotation.y += delta * (altar.choice === 'inherit' ? 0.28 : -0.32);
      altar.core.position.y = 0.86 + Math.sin(this.time * 2.2 + phase) * 0.12;
      altar.core.rotation.x += delta * 0.42;
      altar.core.rotation.z += delta * (altar.choice === 'inherit' ? 0.31 : -0.36);
      const material = altar.core.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = 1.25 + Math.sin(this.time * 3.1 + phase) * 0.32;
      altar.light.intensity = 12 + Math.sin(this.time * 3.6 + phase) * 2.5;
    }
    if (this.endingChoice) this.endingTimer += delta;
  }

  private beginEnding(choice: EndingChoice): void {
    this.endingChoice = choice;
    this.endingsSeen.add(choice);
    this.saveRequested = true;
    this.endingTimer = 0;
    this.interaction = null;
    this.notice = null;
    this.noticeTimer = 0;
    this.audio.ending(choice === 'inherit');
    for (const altar of this.endingAltars) altar.root.visible = false;
  }

  private getEndingSnapshot(): EndingSnapshot {
    if (!this.endingChoice) {
      return {
        active: false,
        choice: null,
        title: '',
        subtitle: '',
        quote: '',
        creditsProgress: 0,
      };
    }
    const inherit = this.endingChoice === 'inherit';
    return {
      active: true,
      choice: this.endingChoice,
      title: inherit ? '재 위에 다시 세운 서약' : '마침내 꺼진 마지막 종',
      subtitle: inherit
        ? '그녀는 왕관을 쓰지 않았다. 다만 다음 사람이 길을 잃지 않도록 불을 남겼다.'
        : '그녀는 왕좌와 종과 이름을 함께 끊었다. 새벽은 어떤 명령도 없이 찾아왔다.',
      quote: inherit ? '끝나지 않는 것은 저주가 아니라, 누군가가 이어 갈 수 있다는 약속이다.' : '부서진 서약의 빈자리에서, 비로소 자신의 목소리가 들렸다.',
      creditsProgress: THREE.MathUtils.clamp((this.endingTimer - 3.2) / 15, 0, 1),
    };
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
    this.saveRequested = true;
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
    this.saveRequested = true;
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
      this.saveRequested = true;
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

  private applyShortcutState(shortcut: Shortcut, open: boolean): void {
    shortcut.open = open;
    shortcut.progress = open ? 1 : 0;
    const y = open ? shortcut.openY : shortcut.closedY;
    shortcut.gate.position.y = y;
    shortcut.body.setNextKinematicTranslation({ x: shortcut.gate.position.x, y, z: shortcut.gate.position.z });
    shortcut.body.setTranslation({ x: shortcut.gate.position.x, y, z: shortcut.gate.position.z }, true);
    shortcut.lever.rotation.z = open ? -1.05 : 0;
    shortcut.collider.setEnabled(!open);
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
    if (combat.areAllBossesDefeated()) {
      for (const altar of this.endingAltars) {
        const distance = altar.position.distanceTo(this.playerPosition);
        if (distance <= GAME_CONFIG.world.interactionRadius + 0.4 && distance < bestDistance) {
          bestDistance = distance;
          this.interaction = `E  ${altar.name}`;
        }
      }
    }
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

  private updateArea(position: THREE.Vector3, combat: CombatDirector): void {
    if (position.z < -190) {
      this.areaName = '재의 왕좌';
      this.objective = combat.isOathkeeperDefeated()
        ? '두 갈래의 마지막 서약 중 하나를 선택하라'
        : combat.isOathkeeperEncounterActive()
          ? '재의 서약자를 쓰러뜨려라'
          : '왕좌 앞에서 마지막 서약과 마주하라';
    } else if (position.z < -169) {
      this.areaName = '마지막 서약의 다리';
      this.objective = combat.isWidowDefeated()
        ? '서약석을 밝히고 재의 왕좌로 향하라'
        : '종루의 주인을 쓰러뜨려 길을 열어라';
    } else if (position.z < -134) {
      this.areaName = '공허한 종의 심장';
      this.objective = combat.isWidowDefeated()
        ? '침묵한 종루 뒤의 열린 길로 향하라'
        : combat.isWidowEncounterActive()
          ? '종을 삼킨 과부를 쓰러뜨려라'
          : '매달린 종을 끊고 과부에게 도전하라';
    } else if (position.z < -118) {
      this.areaName = '끊어진 종의 회랑';
      this.objective = combat.isWidowDefeated()
        ? '공허한 종루를 지나 북쪽 문으로 향하라'
        : '서약석을 밝히고 두 번째 안개문을 넘어라';
    } else if (position.z < -88) {
      this.areaName = '서약의 문 앞뜰';
      this.objective = combat.isBossDefeated()
        ? '문지기 뒤의 열린 길에서 서약석을 찾아라'
        : combat.isBossEncounterActive()
          ? '문지기 바르칸을 쓰러뜨려라'
          : '안개문 너머의 수호자에게 도전하라';
    } else if (position.z < -54) {
      this.areaName = '잿빛 제단';
      this.objective = combat.isBossDefeated()
        ? '서약의 문 너머로 향하라'
        : '제단 뒤편 안개문을 넘어라';
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
