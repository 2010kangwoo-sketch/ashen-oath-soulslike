import * as THREE from 'three';

export type KnightVisualState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'airborne'
  | 'dodge'
  | 'light1'
  | 'light2'
  | 'light3'
  | 'heavyCharge'
  | 'heavy'
  | 'execute'
  | 'guard'
  | 'parry'
  | 'stagger'
  | 'dead';

export interface KnightVisualUpdate {
  delta: number;
  state: KnightVisualState;
  speedRatio: number;
  turnRate: number;
  verticalSpeed: number;
  actionProgress: number;
  chargeRatio: number;
}

export class AshenKnightVisual {
  private static readonly RIG_BASE_HEIGHT = 0.22;
  readonly root = new THREE.Group();
  private readonly rig = new THREE.Group();
  private readonly torsoPivot = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly cloakPanels: THREE.Mesh[] = [];
  private readonly sword: THREE.Group;
  private readonly swordTrail: THREE.Mesh;
  private time = 0;
  private stride = 0;

  constructor() {
    this.root.name = 'ashen-knight-production-rig';
    this.root.add(this.rig);

    const iron = new THREE.MeshStandardMaterial({ color: 0x34383a, roughness: 0.48, metalness: 0.72 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x686a67, roughness: 0.34, metalness: 0.86 });
    const blackIron = new THREE.MeshStandardMaterial({ color: 0x15191b, roughness: 0.58, metalness: 0.62 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x241916, roughness: 0.92, metalness: 0.02 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x241816, roughness: 0.97, side: THREE.DoubleSide });
    const ember = new THREE.MeshStandardMaterial({
      color: 0xb49a70,
      emissive: 0x4a2d12,
      emissiveIntensity: 1.1,
      roughness: 0.4,
      metalness: 0.48,
    });

    this.torsoPivot.position.y = 0.16;
    this.rig.add(this.torsoPivot);

    const waist = this.mesh(new THREE.CylinderGeometry(0.34, 0.43, 0.34, 10), blackIron);
    waist.position.y = -0.18;
    this.torsoPivot.add(waist);

    const breastplate = this.mesh(new THREE.CylinderGeometry(0.38, 0.48, 0.76, 10), iron);
    breastplate.scale.z = 0.72;
    breastplate.position.y = 0.18;
    this.torsoPivot.add(breastplate);

    const sternum = this.mesh(new THREE.BoxGeometry(0.16, 0.58, 0.08), edge);
    sternum.position.set(0, 0.2, -0.38);
    this.torsoPivot.add(sternum);

    for (const x of [-0.48, 0.48]) {
      const pauldron = this.mesh(new THREE.SphereGeometry(0.24, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.68), iron);
      pauldron.scale.set(1.35, 0.78, 1.15);
      pauldron.position.set(x, 0.43, -0.01);
      this.torsoPivot.add(pauldron);
    }

    this.headPivot.position.y = 0.72;
    this.torsoPivot.add(this.headPivot);
    const helmet = this.mesh(new THREE.DodecahedronGeometry(0.3, 0), blackIron);
    helmet.scale.set(0.92, 1.12, 0.94);
    this.headPivot.add(helmet);
    const brow = this.mesh(new THREE.BoxGeometry(0.52, 0.12, 0.12), iron);
    brow.position.set(0, 0.03, -0.27);
    this.headPivot.add(brow);
    const visor = this.mesh(new THREE.BoxGeometry(0.42, 0.055, 0.055), ember);
    visor.position.set(0, -0.02, -0.338);
    this.headPivot.add(visor);
    const crest = this.mesh(new THREE.BoxGeometry(0.055, 0.42, 0.36), edge);
    crest.position.set(0, 0.28, 0.02);
    this.headPivot.add(crest);

    this.leftArm.position.set(-0.48, 0.35, 0);
    this.rightArm.position.set(0.48, 0.35, 0);
    this.torsoPivot.add(this.leftArm, this.rightArm);
    this.buildArm(this.leftArm, iron, leather);
    this.buildArm(this.rightArm, iron, leather);

    this.leftLeg.position.set(-0.21, -0.24, 0);
    this.rightLeg.position.set(0.21, -0.24, 0);
    this.rig.add(this.leftLeg, this.rightLeg);
    this.buildLeg(this.leftLeg, iron, blackIron);
    this.buildLeg(this.rightLeg, iron, blackIron);

    const belt = this.mesh(new THREE.TorusGeometry(0.39, 0.055, 6, 18), leather);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = -0.02;
    this.rig.add(belt);

    const gorget = this.mesh(new THREE.TorusGeometry(0.31, 0.065, 7, 18), edge);
    gorget.rotation.x = Math.PI / 2;
    gorget.position.set(0, 0.54, -0.01);
    this.torsoPivot.add(gorget);
    for (const side of [-1, 1]) {
      const mantle = this.mesh(new THREE.BoxGeometry(0.42, 0.12, 0.54), blackIron);
      mantle.position.set(side * 0.36, 0.49, 0.06);
      mantle.rotation.z = side * 0.09;
      this.torsoPivot.add(mantle);
      const knee = this.mesh(new THREE.DodecahedronGeometry(0.16, 0), edge);
      knee.scale.set(1.05, 0.8, 0.72);
      knee.position.set(side * 0.21, -0.71, -0.18);
      this.rig.add(knee);
    }
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      const plate = this.mesh(new THREE.BoxGeometry(0.2, 0.48, 0.08), index % 2 === 0 ? iron : blackIron);
      plate.position.set(Math.sin(angle) * 0.31, -0.33, Math.cos(angle) * 0.28);
      plate.rotation.y = angle;
      plate.rotation.x = Math.cos(angle) * 0.08;
      this.rig.add(plate);
    }
    const groundShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    groundShadow.rotation.x = -Math.PI / 2;
    groundShadow.position.y = -1.02;
    this.rig.add(groundShadow);

    for (let index = 0; index < 5; index += 1) {
      const panel = this.mesh(new THREE.PlaneGeometry(0.24, 1.18, 1, 4), cloth);
      panel.position.set((index - 2) * 0.18, 0.08, 0.34 + Math.abs(index - 2) * 0.015);
      panel.rotation.x = 0.11;
      this.rig.add(panel);
      this.cloakPanels.push(panel);
    }

    this.sword = this.buildSword(iron, edge, leather, ember);
    this.sword.position.set(0.62, 0.1, 0.12);
    this.sword.rotation.set(0.08, 0, -0.18);
    this.rig.add(this.sword);

    const trailMaterial = new THREE.MeshBasicMaterial({
      color: 0xd7bd8d,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.swordTrail = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.85), trailMaterial);
    this.swordTrail.position.set(0, -0.43, 0.07);
    this.swordTrail.rotation.y = Math.PI / 2;
    this.sword.add(this.swordTrail);
  }

  update({ delta, state, speedRatio, turnRate, verticalSpeed, actionProgress, chargeRatio }: KnightVisualUpdate): void {
    this.time += delta;
    const moving = state === 'walk' || state === 'run';
    if (moving) this.stride += delta * THREE.MathUtils.lerp(6.2, 10.8, speedRatio);

    const strideSin = Math.sin(this.stride);
    const strideCos = Math.cos(this.stride);
    const strideAmount = moving ? THREE.MathUtils.lerp(0.18, 0.58, speedRatio) : 0;
    const settle = 1 - Math.exp(-15 * delta);

    let leftLegX = strideSin * strideAmount;
    let rightLegX = -strideSin * strideAmount;
    let leftArmX = -strideSin * strideAmount * 0.55;
    let rightArmX = strideSin * strideAmount * 0.35;
    let leftArmZ = 0;
    let rightArmZ = 0;
    let torsoX = state === 'run' ? 0.09 : 0.015;
    let torsoY = 0;
    let torsoZ = -turnRate * 0.05;
    let swordX = 0.08;
    let swordY = 0;
    let swordZ = -0.18 - speedRatio * 0.06 + strideSin * 0.015;
    let trailOpacity = 0;

    if (state === 'dodge') {
      const roll = actionProgress * Math.PI * 2;
      torsoX = 0.58 + Math.sin(actionProgress * Math.PI) * 0.42;
      torsoZ = Math.sin(roll) * 0.08;
      leftLegX = 0.62;
      rightLegX = 0.38;
      leftArmX = -0.45;
      rightArmX = -0.6;
      swordZ = -0.55;
    } else if (state === 'light1') {
      const swing = easeAttack(actionProgress, 0.2, 0.58);
      torsoY = THREE.MathUtils.lerp(-0.72, 0.82, swing);
      torsoX = 0.14;
      torsoZ = THREE.MathUtils.lerp(0.22, -0.25, swing);
      rightArmX = THREE.MathUtils.lerp(-1.85, 0.68, swing);
      rightArmZ = THREE.MathUtils.lerp(-0.55, 0.78, swing);
      swordZ = THREE.MathUtils.lerp(-1.15, 0.62, swing);
      trailOpacity = attackTrail(actionProgress, 0.2, 0.55);
    } else if (state === 'light2') {
      const swing = easeAttack(actionProgress, 0.22, 0.62);
      torsoY = THREE.MathUtils.lerp(0.82, -0.92, swing);
      torsoX = 0.18;
      torsoZ = THREE.MathUtils.lerp(-0.3, 0.3, swing);
      rightArmX = THREE.MathUtils.lerp(-1.35, 0.48, swing);
      rightArmZ = THREE.MathUtils.lerp(0.9, -0.82, swing);
      swordZ = THREE.MathUtils.lerp(0.72, -1.0, swing);
      trailOpacity = attackTrail(actionProgress, 0.22, 0.58);
    } else if (state === 'light3') {
      const thrust = easeAttack(actionProgress, 0.24, 0.56);
      torsoX = THREE.MathUtils.lerp(-0.12, 0.42, thrust);
      torsoY = THREE.MathUtils.lerp(-0.32, 0.2, thrust);
      torsoZ = THREE.MathUtils.lerp(0.12, -0.18, thrust);
      rightArmX = THREE.MathUtils.lerp(-1.62, -0.18, thrust);
      rightArmZ = THREE.MathUtils.lerp(0.28, -0.08, thrust);
      leftArmX = THREE.MathUtils.lerp(-0.72, -0.22, thrust);
      swordX = THREE.MathUtils.lerp(-0.72, -1.54, thrust);
      swordZ = THREE.MathUtils.lerp(-0.18, -0.02, thrust);
      trailOpacity = attackTrail(actionProgress, 0.3, 0.56) * 0.85;
    } else if (state === 'heavyCharge') {
      const pulse = Math.sin(this.time * 9) * 0.03 * chargeRatio;
      torsoX = THREE.MathUtils.lerp(0.02, -0.32, chargeRatio) + pulse;
      torsoY = THREE.MathUtils.lerp(0, -0.18, chargeRatio);
      leftArmX = THREE.MathUtils.lerp(-0.18, -1.24, chargeRatio);
      rightArmX = THREE.MathUtils.lerp(-0.18, -2.42, chargeRatio);
      rightArmZ = THREE.MathUtils.lerp(0, -0.42, chargeRatio);
      swordX = THREE.MathUtils.lerp(0.08, -0.5, chargeRatio);
      swordZ = THREE.MathUtils.lerp(-0.18, -0.52, chargeRatio);
      leftLegX = 0.18 * chargeRatio;
      rightLegX = -0.1 * chargeRatio;
    } else if (state === 'heavy') {
      const windup = THREE.MathUtils.smoothstep(actionProgress, 0, 0.42);
      const smash = THREE.MathUtils.smoothstep(actionProgress, 0.43, 0.73);
      torsoX = THREE.MathUtils.lerp(-0.22, 0.48, smash);
      torsoZ = -0.12 * windup;
      rightArmX = THREE.MathUtils.lerp(-2.65, 0.86, smash);
      leftArmX = THREE.MathUtils.lerp(-1.3, 0.35, smash);
      swordX = THREE.MathUtils.lerp(-0.45, 0.45, smash);
      swordZ = THREE.MathUtils.lerp(-0.25, 0.1, smash);
      trailOpacity = attackTrail(actionProgress, 0.45, 0.72) * 1.25;
    } else if (state === 'guard') {
      torsoX = 0.08;
      torsoY = -0.12;
      leftArmX = -0.95;
      rightArmX = -0.72;
      leftArmZ = -0.52;
      rightArmZ = 0.28;
      swordZ = -0.62;
    } else if (state === 'parry') {
      const snap = THREE.MathUtils.smoothstep(actionProgress, 0.08, 0.38);
      torsoY = THREE.MathUtils.lerp(-0.42, 0.38, snap);
      torsoX = 0.12;
      leftArmX = THREE.MathUtils.lerp(-1.2, -0.35, snap);
      rightArmX = THREE.MathUtils.lerp(-1.55, 0.1, snap);
      rightArmZ = THREE.MathUtils.lerp(-0.6, 0.65, snap);
      swordZ = THREE.MathUtils.lerp(-1.05, 0.48, snap);
      trailOpacity = attackTrail(actionProgress, 0.08, 0.34) * 0.55;
    } else if (state === 'execute') {
      const close = THREE.MathUtils.smoothstep(actionProgress, 0, 0.32);
      const drive = THREE.MathUtils.smoothstep(actionProgress, 0.32, 0.58);
      const withdraw = THREE.MathUtils.smoothstep(actionProgress, 0.7, 1);
      torsoX = 0.18 + drive * 0.4 - withdraw * 0.22;
      torsoY = -0.1 + drive * 0.18;
      rightArmX = THREE.MathUtils.lerp(-1.5, -0.2, drive) + withdraw * 0.45;
      leftArmX = THREE.MathUtils.lerp(-0.75, -0.28, close);
      swordX = THREE.MathUtils.lerp(-0.7, -1.5, drive) + withdraw * 0.62;
      swordZ = -0.12;
      leftLegX = 0.24;
      rightLegX = -0.12;
      trailOpacity = attackTrail(actionProgress, 0.42, 0.6) * 0.45;
    } else if (state === 'stagger') {
      torsoX = -0.34;
      torsoZ = Math.sin(actionProgress * Math.PI) * 0.24;
      leftArmX = 0.48;
      rightArmX = 0.7;
      swordZ = -0.78;
    } else if (state === 'dead') {
      torsoX = 1.22;
      torsoZ = 0.22;
      leftLegX = 0.3;
      rightLegX = -0.3;
      swordZ = -1.15;
    }

    this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, leftLegX, settle);
    this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, rightLegX, settle);
    this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, leftArmX, settle);
    this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, rightArmX, settle);
    this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, leftArmZ, settle);
    this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, rightArmZ, settle);

    const idleBreath = state === 'idle' ? Math.sin(this.time * 1.7) * 0.012 : 0;
    const footBob = moving ? Math.abs(strideCos) * 0.026 * speedRatio : 0;
    this.rig.position.y = AshenKnightVisual.RIG_BASE_HEIGHT + idleBreath + footBob
      + (state === 'airborne' ? THREE.MathUtils.clamp(verticalSpeed * 0.006, -0.08, 0.05) : 0);
    this.rig.rotation.x = THREE.MathUtils.lerp(this.rig.rotation.x, state === 'dead' ? -0.2 : 0, settle);
    this.torsoPivot.rotation.x = THREE.MathUtils.lerp(this.torsoPivot.rotation.x, torsoX, settle);
    this.torsoPivot.rotation.y = THREE.MathUtils.lerp(this.torsoPivot.rotation.y, torsoY, settle);
    this.torsoPivot.rotation.z = THREE.MathUtils.lerp(this.torsoPivot.rotation.z, torsoZ, settle);
    this.headPivot.rotation.y = THREE.MathUtils.lerp(this.headPivot.rotation.y, turnRate * 0.025, settle);
    this.sword.rotation.x = THREE.MathUtils.lerp(this.sword.rotation.x, swordX, settle);
    this.sword.rotation.y = THREE.MathUtils.lerp(this.sword.rotation.y, swordY, settle);
    this.sword.rotation.z = THREE.MathUtils.lerp(this.sword.rotation.z, swordZ, settle);

    const trailMaterial = this.swordTrail.material as THREE.MeshBasicMaterial;
    trailMaterial.opacity += (trailOpacity - trailMaterial.opacity) * (1 - Math.exp(-24 * delta));
    this.swordTrail.scale.x = 0.8 + trailOpacity * 0.35;

    for (let index = 0; index < this.cloakPanels.length; index += 1) {
      const panel = this.cloakPanels[index];
      if (!panel) continue;
      const wave = Math.sin(this.time * (2.6 + index * 0.12) + index * 0.7) * 0.035;
      panel.rotation.x = 0.11 + speedRatio * 0.24 + wave
        + (state === 'dodge' ? 0.38 : 0)
        + (state === 'heavy' || state === 'execute' ? 0.16 : 0)
        + (state === 'heavyCharge' ? chargeRatio * 0.08 : 0);
      panel.rotation.z = -turnRate * 0.018 + (index - 2) * 0.012;
    }
  }

  private buildArm(parent: THREE.Group, metal: THREE.Material, leather: THREE.Material): void {
    const upper = this.mesh(new THREE.CylinderGeometry(0.12, 0.145, 0.5, 8), leather);
    upper.position.y = -0.22;
    parent.add(upper);
    const vambrace = this.mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.46, 8), metal);
    vambrace.position.set(0, -0.62, -0.02);
    parent.add(vambrace);
    const hand = this.mesh(new THREE.BoxGeometry(0.2, 0.18, 0.2), leather);
    hand.position.y = -0.9;
    parent.add(hand);
  }

  private buildLeg(parent: THREE.Group, metal: THREE.Material, darkMetal: THREE.Material): void {
    const thigh = this.mesh(new THREE.CylinderGeometry(0.135, 0.17, 0.52, 8), metal);
    thigh.position.y = -0.25;
    parent.add(thigh);
    const greave = this.mesh(new THREE.BoxGeometry(0.26, 0.5, 0.29), darkMetal);
    greave.position.set(0, -0.68, -0.025);
    parent.add(greave);
    const boot = this.mesh(new THREE.BoxGeometry(0.28, 0.18, 0.42), darkMetal);
    boot.position.set(0, -0.99, -0.08);
    parent.add(boot);
  }

  private buildSword(
    metal: THREE.Material,
    edge: THREE.Material,
    leather: THREE.Material,
    ember: THREE.Material,
  ): THREE.Group {
    const sword = new THREE.Group();
    const blade = this.mesh(new THREE.BoxGeometry(0.095, 1.42, 0.035), metal);
    blade.position.y = -0.46;
    sword.add(blade);
    const fuller = this.mesh(new THREE.BoxGeometry(0.018, 1.18, 0.045), edge);
    fuller.position.set(0, -0.43, -0.005);
    sword.add(fuller);
    const guard = this.mesh(new THREE.BoxGeometry(0.58, 0.075, 0.095), ember);
    guard.position.y = 0.28;
    sword.add(guard);
    const grip = this.mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.38, 8), leather);
    grip.position.y = 0.5;
    sword.add(grip);
    const pommel = this.mesh(new THREE.OctahedronGeometry(0.11, 0), ember);
    pommel.position.y = 0.74;
    sword.add(pommel);
    return sword;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function easeAttack(progress: number, start: number, end: number): number {
  return THREE.MathUtils.smoothstep(progress, start, end);
}

function attackTrail(progress: number, start: number, end: number): number {
  if (progress <= start || progress >= end) return 0;
  const normalized = (progress - start) / (end - start);
  return Math.sin(normalized * Math.PI);
}
