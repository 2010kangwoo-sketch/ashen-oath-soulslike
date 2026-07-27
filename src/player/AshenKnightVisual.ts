import * as THREE from 'three';

export type LocomotionVisualState = 'idle' | 'walk' | 'run' | 'airborne';

export interface KnightVisualUpdate {
  delta: number;
  state: LocomotionVisualState;
  speedRatio: number;
  turnRate: number;
  verticalSpeed: number;
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
  private time = 0;
  private stride = 0;

  constructor() {
    this.root.name = 'ashen-knight-final-style-rig';
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
  }

  update({ delta, state, speedRatio, turnRate, verticalSpeed }: KnightVisualUpdate): void {
    this.time += delta;
    const moving = state === 'walk' || state === 'run';
    if (moving) this.stride += delta * THREE.MathUtils.lerp(6.2, 10.8, speedRatio);

    const strideSin = Math.sin(this.stride);
    const strideCos = Math.cos(this.stride);
    const strideAmount = moving ? THREE.MathUtils.lerp(0.18, 0.58, speedRatio) : 0;
    const settle = 1 - Math.exp(-12 * delta);

    this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, strideSin * strideAmount, settle);
    this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, -strideSin * strideAmount, settle);
    this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, -strideSin * strideAmount * 0.55, settle);
    this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, strideSin * strideAmount * 0.35, settle);

    const idleBreath = state === 'idle' ? Math.sin(this.time * 1.7) * 0.012 : 0;
    const footBob = moving ? Math.abs(strideCos) * 0.026 * speedRatio : 0;
    this.rig.position.y = AshenKnightVisual.RIG_BASE_HEIGHT + idleBreath + footBob
      + (state === 'airborne' ? THREE.MathUtils.clamp(verticalSpeed * 0.006, -0.08, 0.05) : 0);
    this.torsoPivot.rotation.z = THREE.MathUtils.lerp(this.torsoPivot.rotation.z, -turnRate * 0.05, settle);
    this.torsoPivot.rotation.x = THREE.MathUtils.lerp(this.torsoPivot.rotation.x, state === 'run' ? 0.09 : 0.015, settle);
    this.headPivot.rotation.y = THREE.MathUtils.lerp(this.headPivot.rotation.y, turnRate * 0.025, settle);
    this.sword.rotation.z = -0.18 - speedRatio * 0.06 + strideSin * 0.015;

    for (let index = 0; index < this.cloakPanels.length; index += 1) {
      const panel = this.cloakPanels[index];
      if (!panel) continue;
      const wave = Math.sin(this.time * (2.6 + index * 0.12) + index * 0.7) * 0.035;
      panel.rotation.x = 0.11 + speedRatio * 0.24 + wave;
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
