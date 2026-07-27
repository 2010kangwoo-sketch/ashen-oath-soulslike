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
  | 'heal'
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

interface HairJoint {
  pivot: THREE.Group;
  restX: number;
  restZ: number;
  angleX: number;
  angleZ: number;
  velocityX: number;
  velocityZ: number;
  inertia: number;
}

interface HairStrand {
  joints: HairJoint[];
  phase: number;
  side: number;
  drag: number;
}

/**
 * Production player presentation rig.
 *
 * The character remains procedural so the repository has no temporary third-party
 * character asset. The proportions, layered armour, face, hair chains and motion
 * language are authored as a release-facing silhouette, not a collision debug doll.
 */
export class AshenKnightVisual {
  private static readonly RIG_BASE_HEIGHT = 0.22;
  readonly root = new THREE.Group();
  private readonly rig = new THREE.Group();
  private readonly pelvisPivot = new THREE.Group();
  private readonly torsoPivot = new THREE.Group();
  private readonly chestPivot = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftForearm = new THREE.Group();
  private readonly rightForearm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftShin = new THREE.Group();
  private readonly rightShin = new THREE.Group();
  private readonly cloakPanels: THREE.Mesh[] = [];
  private readonly hairStrands: HairStrand[] = [];
  private readonly sword: THREE.Group;
  private readonly swordTrail: THREE.Mesh;
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly faceMaterial: THREE.MeshStandardMaterial;
  private time = 0;
  private stride = 0;
  private previousSpeedRatio = 0;
  private speedAcceleration = 0;
  private blinkTimer = 2.4;
  private gazeTimer = 0;
  private gazeTarget = 0;

  constructor() {
    this.root.name = 'ashen-oath-female-vowkeeper-production-rig';
    this.root.add(this.rig);

    const steel = new THREE.MeshStandardMaterial({ color: 0x373c40, roughness: 0.44, metalness: 0.78 });
    const brightSteel = new THREE.MeshStandardMaterial({ color: 0x70777b, roughness: 0.3, metalness: 0.9 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.56, metalness: 0.68 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x291b17, roughness: 0.92, metalness: 0.02 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x211519, roughness: 0.98, side: THREE.DoubleSide });
    const innerCloth = new THREE.MeshStandardMaterial({ color: 0x4a2024, roughness: 0.94, side: THREE.DoubleSide });
    const hair = new THREE.MeshStandardMaterial({ color: 0x211a1b, roughness: 0.82, metalness: 0.03 });
    const hairHighlight = new THREE.MeshStandardMaterial({ color: 0x3b292b, roughness: 0.72, metalness: 0.04 });
    this.faceMaterial = new THREE.MeshStandardMaterial({ color: 0xb98572, roughness: 0.87, metalness: 0 });
    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8c0b7,
      emissive: 0x29362f,
      emissiveIntensity: 0.38,
      roughness: 0.25,
    });
    const ember = new THREE.MeshStandardMaterial({
      color: 0xb69a6d,
      emissive: 0x4b2c12,
      emissiveIntensity: 1.05,
      roughness: 0.38,
      metalness: 0.5,
    });

    this.pelvisPivot.position.y = -0.02;
    this.rig.add(this.pelvisPivot);
    this.torsoPivot.position.y = 0.18;
    this.pelvisPivot.add(this.torsoPivot);
    this.chestPivot.position.y = 0.2;
    this.torsoPivot.add(this.chestPivot);

    // Narrow waist and layered hip armour keep the silhouette readable without
    // weakening the combat-ready stance.
    const waist = this.mesh(new THREE.CylinderGeometry(0.27, 0.34, 0.34, 12), darkSteel);
    waist.scale.z = 0.8;
    waist.position.y = -0.2;
    this.torsoPivot.add(waist);

    const breastplate = this.mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.7, 12), steel);
    breastplate.scale.z = 0.7;
    breastplate.position.y = 0.12;
    this.chestPivot.add(breastplate);

    const ribPlates = this.mesh(new THREE.CylinderGeometry(0.35, 0.39, 0.38, 12, 1, true), brightSteel);
    ribPlates.scale.z = 0.71;
    ribPlates.position.y = 0.05;
    this.chestPivot.add(ribPlates);

    const sternum = this.mesh(new THREE.BoxGeometry(0.115, 0.54, 0.07), brightSteel);
    sternum.position.set(0, 0.13, -0.33);
    this.chestPivot.add(sternum);

    const collar = this.mesh(new THREE.TorusGeometry(0.27, 0.055, 7, 20), brightSteel);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 0.47, 0.015);
    this.chestPivot.add(collar);

    for (const side of [-1, 1]) {
      const pauldron = this.mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.66), steel);
      pauldron.scale.set(1.28, 0.7, 1.08);
      pauldron.position.set(side * 0.43, 0.39, 0.01);
      pauldron.rotation.z = side * 0.08;
      this.chestPivot.add(pauldron);

      const hipPlate = this.mesh(new THREE.BoxGeometry(0.22, 0.48, 0.08), side < 0 ? darkSteel : steel);
      hipPlate.position.set(side * 0.28, -0.38, 0.02);
      hipPlate.rotation.z = side * 0.08;
      this.pelvisPivot.add(hipPlate);
    }

    this.buildHead(hair, hairHighlight, darkSteel, brightSteel);

    this.leftArm.position.set(-0.43, 0.36, 0);
    this.rightArm.position.set(0.43, 0.36, 0);
    this.chestPivot.add(this.leftArm, this.rightArm);
    this.buildArm(this.leftArm, this.leftForearm, steel, leather, -1);
    this.buildArm(this.rightArm, this.rightForearm, steel, leather, 1);

    this.leftLeg.position.set(-0.18, -0.24, 0);
    this.rightLeg.position.set(0.18, -0.24, 0);
    this.pelvisPivot.add(this.leftLeg, this.rightLeg);
    this.buildLeg(this.leftLeg, this.leftShin, steel, darkSteel, -1);
    this.buildLeg(this.rightLeg, this.rightShin, steel, darkSteel, 1);

    const belt = this.mesh(new THREE.TorusGeometry(0.34, 0.05, 6, 20), leather);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = -0.08;
    this.pelvisPivot.add(belt);

    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      const plate = this.mesh(new THREE.BoxGeometry(0.18, 0.46, 0.065), index % 2 === 0 ? steel : darkSteel);
      plate.position.set(Math.sin(angle) * 0.27, -0.37, Math.cos(angle) * 0.25);
      plate.rotation.y = angle;
      plate.rotation.x = Math.cos(angle) * 0.07;
      this.pelvisPivot.add(plate);
    }

    const skirt = this.mesh(new THREE.CylinderGeometry(0.29, 0.49, 0.72, 12, 1, true), innerCloth);
    skirt.position.y = -0.48;
    skirt.scale.z = 0.86;
    this.pelvisPivot.add(skirt);

    const groundShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.67, 28),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.27, depthWrite: false }),
    );
    groundShadow.rotation.x = -Math.PI / 2;
    groundShadow.position.y = -1.02;
    this.rig.add(groundShadow);

    for (let index = 0; index < 7; index += 1) {
      const panel = this.mesh(new THREE.PlaneGeometry(index === 3 ? 0.22 : 0.18, 1.14, 1, 5), cloth);
      panel.position.set((index - 3) * 0.145, 0.06, 0.31 + Math.abs(index - 3) * 0.012);
      panel.rotation.x = 0.1;
      this.rig.add(panel);
      this.cloakPanels.push(panel);
    }

    this.sword = this.buildSword(steel, brightSteel, leather, ember);
    this.sword.position.set(0.56, 0.08, 0.11);
    this.sword.rotation.set(0.08, 0, -0.18);
    this.rig.add(this.sword);

    const trailMaterial = new THREE.MeshBasicMaterial({
      color: 0xd8c092,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.swordTrail = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 1.82), trailMaterial);
    this.swordTrail.position.set(0, -0.43, 0.07);
    this.swordTrail.rotation.y = Math.PI / 2;
    this.sword.add(this.swordTrail);
  }

  update({ delta, state, speedRatio, turnRate, verticalSpeed, actionProgress, chargeRatio }: KnightVisualUpdate): void {
    this.time += delta;
    this.speedAcceleration += ((speedRatio - this.previousSpeedRatio) / Math.max(delta, 1 / 120) - this.speedAcceleration)
      * (1 - Math.exp(-8 * delta));
    this.previousSpeedRatio = speedRatio;

    const moving = state === 'walk' || state === 'run';
    if (moving) this.stride += delta * THREE.MathUtils.lerp(5.8, 10.2, speedRatio);

    const strideSin = Math.sin(this.stride);
    const strideCos = Math.cos(this.stride);
    const strideAmount = moving ? THREE.MathUtils.lerp(0.15, 0.55, speedRatio) : 0;
    const settle = 1 - Math.exp(-15 * delta);

    let leftLegX = strideSin * strideAmount;
    let rightLegX = -strideSin * strideAmount;
    let leftKneeX = Math.max(0, -strideSin) * strideAmount * 0.6;
    let rightKneeX = Math.max(0, strideSin) * strideAmount * 0.6;
    let leftArmX = -strideSin * strideAmount * 0.45;
    let rightArmX = strideSin * strideAmount * 0.3;
    let leftElbowX = -0.08;
    let rightElbowX = -0.12;
    let leftArmZ = 0;
    let rightArmZ = 0;
    let pelvisY = moving ? -strideSin * 0.045 * speedRatio : 0;
    let pelvisZ = moving ? strideSin * 0.035 * speedRatio : 0;
    let torsoX = state === 'run' ? 0.085 : 0.012;
    let torsoY = 0;
    let torsoZ = -turnRate * 0.045;
    let chestY = moving ? -strideSin * 0.045 * speedRatio : 0;
    let chestZ = moving ? -strideSin * 0.026 * speedRatio : 0;
    let headX = 0;
    let headY = 0;
    let headZ = 0;
    let swordX = 0.08;
    let swordY = 0;
    let swordZ = -0.18 - speedRatio * 0.055 + strideSin * 0.014;
    let trailOpacity = 0;

    if (state === 'dodge') {
      const roll = actionProgress * Math.PI * 2;
      torsoX = 0.56 + Math.sin(actionProgress * Math.PI) * 0.4;
      torsoZ = Math.sin(roll) * 0.075;
      chestZ = -Math.sin(roll) * 0.06;
      headX = -0.2;
      leftLegX = 0.58;
      rightLegX = 0.35;
      leftKneeX = 0.42;
      rightKneeX = 0.3;
      leftArmX = -0.4;
      rightArmX = -0.56;
      swordZ = -0.55;
    } else if (state === 'light1') {
      const swing = easeAttack(actionProgress, 0.2, 0.58);
      torsoY = THREE.MathUtils.lerp(-0.7, 0.8, swing);
      pelvisY = THREE.MathUtils.lerp(-0.16, 0.18, swing);
      chestY = THREE.MathUtils.lerp(-0.22, 0.28, swing);
      torsoX = 0.13;
      torsoZ = THREE.MathUtils.lerp(0.2, -0.24, swing);
      rightArmX = THREE.MathUtils.lerp(-1.8, 0.64, swing);
      rightArmZ = THREE.MathUtils.lerp(-0.52, 0.74, swing);
      rightElbowX = THREE.MathUtils.lerp(-0.45, 0.18, swing);
      leftArmX = THREE.MathUtils.lerp(-0.4, -0.1, swing);
      headY = THREE.MathUtils.lerp(0.12, -0.08, swing);
      swordZ = THREE.MathUtils.lerp(-1.12, 0.6, swing);
      trailOpacity = attackTrail(actionProgress, 0.2, 0.55);
    } else if (state === 'light2') {
      const swing = easeAttack(actionProgress, 0.22, 0.62);
      torsoY = THREE.MathUtils.lerp(0.8, -0.9, swing);
      pelvisY = THREE.MathUtils.lerp(0.17, -0.2, swing);
      chestY = THREE.MathUtils.lerp(0.25, -0.31, swing);
      torsoX = 0.17;
      torsoZ = THREE.MathUtils.lerp(-0.28, 0.28, swing);
      rightArmX = THREE.MathUtils.lerp(-1.32, 0.45, swing);
      rightArmZ = THREE.MathUtils.lerp(0.86, -0.8, swing);
      rightElbowX = THREE.MathUtils.lerp(-0.35, 0.16, swing);
      headY = THREE.MathUtils.lerp(-0.12, 0.1, swing);
      swordZ = THREE.MathUtils.lerp(0.7, -0.98, swing);
      trailOpacity = attackTrail(actionProgress, 0.22, 0.58);
    } else if (state === 'light3') {
      const thrust = easeAttack(actionProgress, 0.24, 0.56);
      torsoX = THREE.MathUtils.lerp(-0.1, 0.4, thrust);
      pelvisY = THREE.MathUtils.lerp(-0.09, 0.12, thrust);
      torsoY = THREE.MathUtils.lerp(-0.3, 0.18, thrust);
      torsoZ = THREE.MathUtils.lerp(0.1, -0.16, thrust);
      rightArmX = THREE.MathUtils.lerp(-1.58, -0.16, thrust);
      rightArmZ = THREE.MathUtils.lerp(0.26, -0.07, thrust);
      rightElbowX = THREE.MathUtils.lerp(-0.72, -0.06, thrust);
      leftArmX = THREE.MathUtils.lerp(-0.68, -0.2, thrust);
      leftElbowX = -0.52;
      swordX = THREE.MathUtils.lerp(-0.68, -1.5, thrust);
      swordZ = THREE.MathUtils.lerp(-0.18, -0.02, thrust);
      headX = -0.06;
      trailOpacity = attackTrail(actionProgress, 0.3, 0.56) * 0.85;
    } else if (state === 'heavyCharge') {
      const pulse = Math.sin(this.time * 9) * 0.025 * chargeRatio;
      torsoX = THREE.MathUtils.lerp(0.02, -0.3, chargeRatio) + pulse;
      torsoY = THREE.MathUtils.lerp(0, -0.17, chargeRatio);
      chestY = -0.08 * chargeRatio;
      pelvisZ = -0.07 * chargeRatio;
      leftArmX = THREE.MathUtils.lerp(-0.16, -1.2, chargeRatio);
      rightArmX = THREE.MathUtils.lerp(-0.18, -2.36, chargeRatio);
      rightArmZ = THREE.MathUtils.lerp(0, -0.4, chargeRatio);
      rightElbowX = -0.58 * chargeRatio;
      swordX = THREE.MathUtils.lerp(0.08, -0.48, chargeRatio);
      swordZ = THREE.MathUtils.lerp(-0.18, -0.5, chargeRatio);
      leftLegX = 0.16 * chargeRatio;
      rightLegX = -0.09 * chargeRatio;
      headY = 0.06;
    } else if (state === 'heavy') {
      const windup = THREE.MathUtils.smoothstep(actionProgress, 0, 0.42);
      const smash = THREE.MathUtils.smoothstep(actionProgress, 0.43, 0.73);
      torsoX = THREE.MathUtils.lerp(-0.2, 0.46, smash);
      torsoZ = -0.11 * windup;
      pelvisZ = 0.08 * smash;
      chestY = THREE.MathUtils.lerp(-0.12, 0.18, smash);
      rightArmX = THREE.MathUtils.lerp(-2.58, 0.82, smash);
      leftArmX = THREE.MathUtils.lerp(-1.26, 0.32, smash);
      rightElbowX = THREE.MathUtils.lerp(-0.62, 0.18, smash);
      swordX = THREE.MathUtils.lerp(-0.43, 0.43, smash);
      swordZ = THREE.MathUtils.lerp(-0.24, 0.1, smash);
      headX = THREE.MathUtils.lerp(-0.1, 0.08, smash);
      trailOpacity = attackTrail(actionProgress, 0.45, 0.72) * 1.25;
    } else if (state === 'heal') {
      const raise = THREE.MathUtils.smoothstep(actionProgress, 0.04, 0.38);
      const drink = THREE.MathUtils.smoothstep(actionProgress, 0.36, 0.68);
      torsoX = -0.08 + drink * 0.12;
      torsoY = -0.18 * raise;
      chestY = 0.12 * raise;
      headX = -0.08 - drink * 0.16;
      headY = 0.06;
      rightArmX = -1.16 * raise + 0.42 * drink;
      rightArmZ = -0.34;
      rightElbowX = -1.08 * raise;
      leftArmX = -0.22;
      leftElbowX = -0.3;
      swordX = 0.4;
      swordZ = -0.5;
    } else if (state === 'guard') {
      torsoX = 0.075;
      torsoY = -0.11;
      pelvisY = 0.05;
      leftArmX = -0.92;
      rightArmX = -0.7;
      leftArmZ = -0.48;
      rightArmZ = 0.27;
      leftElbowX = -0.42;
      rightElbowX = -0.3;
      headY = 0.08;
      swordZ = -0.6;
    } else if (state === 'parry') {
      const snap = THREE.MathUtils.smoothstep(actionProgress, 0.08, 0.38);
      torsoY = THREE.MathUtils.lerp(-0.4, 0.36, snap);
      chestY = THREE.MathUtils.lerp(-0.14, 0.14, snap);
      torsoX = 0.11;
      leftArmX = THREE.MathUtils.lerp(-1.16, -0.32, snap);
      rightArmX = THREE.MathUtils.lerp(-1.5, 0.08, snap);
      rightArmZ = THREE.MathUtils.lerp(-0.56, 0.62, snap);
      rightElbowX = THREE.MathUtils.lerp(-0.48, 0.12, snap);
      swordZ = THREE.MathUtils.lerp(-1.02, 0.46, snap);
      headY = THREE.MathUtils.lerp(0.1, -0.08, snap);
      trailOpacity = attackTrail(actionProgress, 0.08, 0.34) * 0.55;
    } else if (state === 'execute') {
      const close = THREE.MathUtils.smoothstep(actionProgress, 0, 0.32);
      const drive = THREE.MathUtils.smoothstep(actionProgress, 0.32, 0.58);
      const withdraw = THREE.MathUtils.smoothstep(actionProgress, 0.7, 1);
      torsoX = 0.17 + drive * 0.38 - withdraw * 0.2;
      torsoY = -0.1 + drive * 0.17;
      chestY = drive * 0.09;
      rightArmX = THREE.MathUtils.lerp(-1.46, -0.18, drive) + withdraw * 0.43;
      rightElbowX = THREE.MathUtils.lerp(-0.62, -0.06, drive);
      leftArmX = THREE.MathUtils.lerp(-0.72, -0.26, close);
      swordX = THREE.MathUtils.lerp(-0.68, -1.46, drive) + withdraw * 0.6;
      swordZ = -0.12;
      leftLegX = 0.22;
      rightLegX = -0.11;
      headX = -0.09;
      trailOpacity = attackTrail(actionProgress, 0.42, 0.6) * 0.45;
    } else if (state === 'stagger') {
      torsoX = -0.32;
      torsoZ = Math.sin(actionProgress * Math.PI) * 0.22;
      chestZ = -torsoZ * 0.35;
      headX = -0.18;
      leftArmX = 0.45;
      rightArmX = 0.66;
      swordZ = -0.76;
    } else if (state === 'dead') {
      torsoX = 1.18;
      torsoZ = 0.21;
      headX = -0.28;
      leftLegX = 0.28;
      rightLegX = -0.28;
      swordZ = -1.12;
    } else if (state === 'airborne') {
      torsoX = verticalSpeed < 0 ? 0.04 : -0.03;
      leftLegX = 0.16;
      rightLegX = -0.12;
      leftKneeX = 0.18;
      rightKneeX = 0.08;
      leftArmX = -0.12;
      rightArmX = -0.18;
    }

    this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, leftLegX, settle);
    this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, rightLegX, settle);
    this.leftShin.rotation.x = THREE.MathUtils.lerp(this.leftShin.rotation.x, leftKneeX, settle);
    this.rightShin.rotation.x = THREE.MathUtils.lerp(this.rightShin.rotation.x, rightKneeX, settle);
    this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, leftArmX, settle);
    this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, rightArmX, settle);
    this.leftForearm.rotation.x = THREE.MathUtils.lerp(this.leftForearm.rotation.x, leftElbowX, settle);
    this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, rightElbowX, settle);
    this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, leftArmZ, settle);
    this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, rightArmZ, settle);

    const idleBreath = state === 'idle' ? Math.sin(this.time * 1.55) * 0.014 : 0;
    const footBob = moving ? Math.abs(strideCos) * 0.023 * speedRatio : 0;
    this.rig.position.y = AshenKnightVisual.RIG_BASE_HEIGHT + idleBreath + footBob
      + (state === 'airborne' ? THREE.MathUtils.clamp(verticalSpeed * 0.006, -0.08, 0.05) : 0);
    this.rig.rotation.x = THREE.MathUtils.lerp(this.rig.rotation.x, state === 'dead' ? -0.18 : 0, settle);
    this.pelvisPivot.rotation.y = THREE.MathUtils.lerp(this.pelvisPivot.rotation.y, pelvisY, settle);
    this.pelvisPivot.rotation.z = THREE.MathUtils.lerp(this.pelvisPivot.rotation.z, pelvisZ, settle);
    this.torsoPivot.rotation.x = THREE.MathUtils.lerp(this.torsoPivot.rotation.x, torsoX, settle);
    this.torsoPivot.rotation.y = THREE.MathUtils.lerp(this.torsoPivot.rotation.y, torsoY, settle);
    this.torsoPivot.rotation.z = THREE.MathUtils.lerp(this.torsoPivot.rotation.z, torsoZ, settle);
    this.chestPivot.rotation.y = THREE.MathUtils.lerp(this.chestPivot.rotation.y, chestY, settle);
    this.chestPivot.rotation.z = THREE.MathUtils.lerp(this.chestPivot.rotation.z, chestZ, settle);

    this.updateFace(delta, state, turnRate, speedRatio, headX, headY, headZ, settle);
    this.sword.rotation.x = THREE.MathUtils.lerp(this.sword.rotation.x, swordX, settle);
    this.sword.rotation.y = THREE.MathUtils.lerp(this.sword.rotation.y, swordY, settle);
    this.sword.rotation.z = THREE.MathUtils.lerp(this.sword.rotation.z, swordZ, settle);

    const trailMaterial = this.swordTrail.material as THREE.MeshBasicMaterial;
    trailMaterial.opacity += (trailOpacity - trailMaterial.opacity) * (1 - Math.exp(-24 * delta));
    this.swordTrail.scale.x = 0.8 + trailOpacity * 0.35;

    for (let index = 0; index < this.cloakPanels.length; index += 1) {
      const panel = this.cloakPanels[index];
      if (!panel) continue;
      const wave = Math.sin(this.time * (2.4 + index * 0.1) + index * 0.72) * 0.032;
      panel.rotation.x = 0.1 + speedRatio * 0.22 + wave
        + THREE.MathUtils.clamp(this.speedAcceleration * 0.012, -0.12, 0.18)
        + (state === 'dodge' ? 0.4 : 0)
        + (state === 'heavy' || state === 'execute' ? 0.16 : 0)
        + (state === 'heal' ? 0.05 : 0)
        + (state === 'heavyCharge' ? chargeRatio * 0.08 : 0);
      panel.rotation.z = -turnRate * 0.017 + (index - 3) * 0.01;
    }

    this.updateHair(delta, state, speedRatio, turnRate, verticalSpeed, actionProgress, chargeRatio);
  }

  private buildHead(
    hair: THREE.Material,
    hairHighlight: THREE.Material,
    darkSteel: THREE.Material,
    brightSteel: THREE.Material,
  ): void {
    this.headPivot.position.y = 0.72;
    this.chestPivot.add(this.headPivot);

    const neck = this.mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.24, 10), this.faceMaterial);
    neck.position.y = -0.15;
    this.headPivot.add(neck);

    const face = this.mesh(new THREE.SphereGeometry(0.255, 18, 14), this.faceMaterial);
    face.scale.set(0.82, 1.08, 0.76);
    face.position.z = -0.015;
    this.headPivot.add(face);

    const jaw = this.mesh(new THREE.SphereGeometry(0.19, 14, 10), this.faceMaterial);
    jaw.scale.set(0.82, 0.7, 0.72);
    jaw.position.set(0, -0.16, -0.025);
    this.headPivot.add(jaw);

    const nose = this.mesh(new THREE.ConeGeometry(0.035, 0.12, 6), this.faceMaterial);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, -0.02, -0.205);
    this.headPivot.add(nose);

    for (const side of [-1, 1]) {
      const eye = this.mesh(new THREE.SphereGeometry(0.027, 10, 8), this.eyeMaterial);
      eye.scale.set(1.2, 0.55, 0.5);
      eye.position.set(side * 0.085, 0.055, -0.19);
      eye.name = side < 0 ? 'left-eye' : 'right-eye';
      this.headPivot.add(eye);

      const brow = this.mesh(new THREE.BoxGeometry(0.11, 0.018, 0.022), darkSteel);
      brow.position.set(side * 0.085, 0.105, -0.205);
      brow.rotation.z = side * -0.08;
      this.headPivot.add(brow);

      const cheekGuard = this.mesh(new THREE.BoxGeometry(0.09, 0.22, 0.06), darkSteel);
      cheekGuard.position.set(side * 0.205, -0.035, -0.08);
      cheekGuard.rotation.z = side * -0.06;
      this.headPivot.add(cheekGuard);
    }

    const halfMask = this.mesh(new THREE.BoxGeometry(0.32, 0.105, 0.075), darkSteel);
    halfMask.position.set(0, -0.115, -0.19);
    this.headPivot.add(halfMask);
    const maskEdge = this.mesh(new THREE.BoxGeometry(0.34, 0.025, 0.085), brightSteel);
    maskEdge.position.set(0, -0.06, -0.196);
    this.headPivot.add(maskEdge);

    const hairCap = this.mesh(new THREE.SphereGeometry(0.27, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.72), hair);
    hairCap.scale.set(0.9, 1.02, 0.9);
    hairCap.position.set(0, 0.07, 0.035);
    this.headPivot.add(hairCap);

    // Front fringe uses short chains so it reacts lightly without covering the eyes.
    this.createHairStrand(new THREE.Vector3(-0.13, 0.2, -0.18), 3, 0.13, 0.065, hairHighlight, -1, 0.2, 0.45);
    this.createHairStrand(new THREE.Vector3(0.11, 0.21, -0.19), 3, 0.125, 0.06, hairHighlight, 1, 1.1, 0.42);
    this.createHairStrand(new THREE.Vector3(-0.04, 0.23, -0.205), 2, 0.1, 0.055, hair, -0.2, 2.2, 0.36);

    // Side locks frame the face and react more strongly to turning.
    this.createHairStrand(new THREE.Vector3(-0.235, 0.12, -0.02), 5, 0.17, 0.075, hair, -1, 0.6, 0.72);
    this.createHairStrand(new THREE.Vector3(0.235, 0.12, -0.02), 5, 0.17, 0.075, hair, 1, 1.8, 0.72);

    // Layered rear hair and tied tail use different inertia so they do not move as one sheet.
    this.createHairStrand(new THREE.Vector3(-0.15, 0.16, 0.17), 5, 0.19, 0.09, hairHighlight, -0.65, 0.1, 0.86);
    this.createHairStrand(new THREE.Vector3(0, 0.19, 0.22), 6, 0.2, 0.095, hair, 0, 1.0, 0.96);
    this.createHairStrand(new THREE.Vector3(0.15, 0.16, 0.17), 5, 0.19, 0.09, hairHighlight, 0.65, 2.1, 0.86);

    const tie = this.mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 16), brightSteel);
    tie.rotation.x = Math.PI / 2;
    tie.position.set(0, 0.02, 0.25);
    this.headPivot.add(tie);
    this.createHairStrand(new THREE.Vector3(0, 0.02, 0.28), 7, 0.22, 0.1, hairHighlight, 0, 2.7, 1.2);
  }

  private createHairStrand(
    origin: THREE.Vector3,
    segmentCount: number,
    segmentLength: number,
    width: number,
    material: THREE.Material,
    side: number,
    phase: number,
    drag: number,
  ): void {
    const strand: HairStrand = { joints: [], phase, side, drag };
    let parent = this.headPivot;
    for (let index = 0; index < segmentCount; index += 1) {
      const pivot = new THREE.Group();
      pivot.position.copy(index === 0 ? origin : new THREE.Vector3(0, -segmentLength * 0.88, 0.012));
      parent.add(pivot);

      const taper = 1 - index / Math.max(1, segmentCount) * 0.58;
      const segment = this.mesh(new THREE.CapsuleGeometry(width * taper, segmentLength, 4, 7), material);
      segment.position.y = -segmentLength * 0.48;
      segment.scale.z = 0.62;
      pivot.add(segment);

      strand.joints.push({
        pivot,
        restX: 0.05 + index * 0.018,
        restZ: side * 0.018 * index,
        angleX: 0,
        angleZ: 0,
        velocityX: 0,
        velocityZ: 0,
        inertia: THREE.MathUtils.lerp(0.55, 1.25, index / Math.max(1, segmentCount - 1)),
      });
      parent = pivot;
    }
    this.hairStrands.push(strand);
  }

  private updateHair(
    delta: number,
    state: KnightVisualState,
    speedRatio: number,
    turnRate: number,
    verticalSpeed: number,
    actionProgress: number,
    chargeRatio: number,
  ): void {
    const cappedDelta = Math.min(delta, 1 / 30);
    const dodgeImpulse = state === 'dodge' ? Math.sin(actionProgress * Math.PI) * 0.72 : 0;
    const strikeImpulse = state.startsWith('light') || state === 'heavy' || state === 'execute'
      ? Math.sin(actionProgress * Math.PI) * 0.24
      : 0;
    const staggerImpulse = state === 'stagger' ? Math.sin(actionProgress * Math.PI) * -0.34 : 0;
    const airborneLift = THREE.MathUtils.clamp(-verticalSpeed * 0.026, -0.25, 0.34);
    const accelerationPull = THREE.MathUtils.clamp(-this.speedAcceleration * 0.02, -0.34, 0.38);

    for (const strand of this.hairStrands) {
      for (let index = 0; index < strand.joints.length; index += 1) {
        const joint = strand.joints[index];
        if (!joint) continue;
        const chainRatio = (index + 1) / strand.joints.length;
        const wind = Math.sin(this.time * (2.2 + strand.drag) + strand.phase + index * 0.47) * 0.025 * chainRatio;
        const targetX = joint.restX
          + speedRatio * strand.drag * 0.18 * chainRatio
          + dodgeImpulse * chainRatio
          + strikeImpulse * strand.drag * chainRatio
          + staggerImpulse * chainRatio
          + airborneLift * chainRatio
          + accelerationPull * chainRatio
          + wind
          + (state === 'heavyCharge' ? chargeRatio * 0.08 * chainRatio : 0);
        const targetZ = joint.restZ
          - turnRate * 0.035 * joint.inertia * chainRatio
          + strand.side * speedRatio * 0.018
          + Math.sin(this.time * 1.8 + strand.phase) * 0.012 * chainRatio;

        const stiffness = THREE.MathUtils.lerp(34, 16, chainRatio) / joint.inertia;
        const damping = THREE.MathUtils.lerp(9.5, 6.2, chainRatio);
        joint.velocityX += (targetX - joint.angleX) * stiffness * cappedDelta;
        joint.velocityZ += (targetZ - joint.angleZ) * stiffness * cappedDelta;
        joint.velocityX *= Math.exp(-damping * cappedDelta);
        joint.velocityZ *= Math.exp(-damping * cappedDelta);
        joint.angleX += joint.velocityX * cappedDelta;
        joint.angleZ += joint.velocityZ * cappedDelta;
        joint.angleX = THREE.MathUtils.clamp(joint.angleX, -0.45, 1.28);
        joint.angleZ = THREE.MathUtils.clamp(joint.angleZ, -0.68, 0.68);
        joint.pivot.rotation.x = joint.angleX;
        joint.pivot.rotation.z = joint.angleZ;
      }
    }
  }

  private updateFace(
    delta: number,
    state: KnightVisualState,
    turnRate: number,
    speedRatio: number,
    baseX: number,
    baseY: number,
    baseZ: number,
    settle: number,
  ): void {
    this.blinkTimer -= delta;
    if (this.blinkTimer <= 0) this.blinkTimer = 2.2 + Math.random() * 2.8;
    const blink = this.blinkTimer < 0.13 ? Math.sin((this.blinkTimer / 0.13) * Math.PI) : 0;
    this.eyeMaterial.emissiveIntensity = THREE.MathUtils.lerp(0.38, 0.03, Math.abs(blink));

    this.gazeTimer -= delta;
    if (this.gazeTimer <= 0) {
      this.gazeTimer = 1.7 + Math.random() * 2.4;
      this.gazeTarget = (Math.random() - 0.5) * 0.22;
    }
    const combatFocus = state !== 'idle' && state !== 'walk' && state !== 'run' ? 0 : this.gazeTarget;
    const idleTilt = state === 'idle' ? Math.sin(this.time * 0.55) * 0.025 : 0;
    const runSet = state === 'run' ? -0.04 * speedRatio : 0;
    this.headPivot.rotation.x = THREE.MathUtils.lerp(this.headPivot.rotation.x, baseX + runSet, settle);
    this.headPivot.rotation.y = THREE.MathUtils.lerp(
      this.headPivot.rotation.y,
      baseY + turnRate * 0.022 + combatFocus,
      settle,
    );
    this.headPivot.rotation.z = THREE.MathUtils.lerp(this.headPivot.rotation.z, baseZ + idleTilt, settle);
  }

  private buildArm(
    parent: THREE.Group,
    forearmPivot: THREE.Group,
    metal: THREE.Material,
    leather: THREE.Material,
    side: number,
  ): void {
    const upper = this.mesh(new THREE.CylinderGeometry(0.1, 0.125, 0.45, 9), leather);
    upper.position.y = -0.2;
    parent.add(upper);
    forearmPivot.position.set(0, -0.43, -0.01);
    parent.add(forearmPivot);
    const vambrace = this.mesh(new THREE.CylinderGeometry(0.085, 0.112, 0.42, 9), metal);
    vambrace.position.y = -0.19;
    forearmPivot.add(vambrace);
    const hand = this.mesh(new THREE.SphereGeometry(0.105, 10, 8), leather);
    hand.scale.set(0.85, 1.05, 0.9);
    hand.position.y = -0.43;
    forearmPivot.add(hand);
    parent.rotation.z = side * -0.025;
  }

  private buildLeg(
    parent: THREE.Group,
    shinPivot: THREE.Group,
    metal: THREE.Material,
    darkMetal: THREE.Material,
    side: number,
  ): void {
    const thigh = this.mesh(new THREE.CylinderGeometry(0.115, 0.15, 0.5, 9), metal);
    thigh.position.y = -0.23;
    parent.add(thigh);
    shinPivot.position.set(0, -0.49, -0.015);
    parent.add(shinPivot);
    const greave = this.mesh(new THREE.BoxGeometry(0.22, 0.46, 0.25), darkMetal);
    greave.position.y = -0.22;
    shinPivot.add(greave);
    const knee = this.mesh(new THREE.DodecahedronGeometry(0.14, 0), metal);
    knee.scale.set(1.02, 0.72, 0.7);
    knee.position.set(0, 0.02, -0.14);
    shinPivot.add(knee);
    const boot = this.mesh(new THREE.BoxGeometry(0.24, 0.16, 0.38), darkMetal);
    boot.position.set(0, -0.5, -0.07);
    shinPivot.add(boot);
    parent.rotation.z = side * 0.01;
  }

  private buildSword(
    metal: THREE.Material,
    edge: THREE.Material,
    leather: THREE.Material,
    ember: THREE.Material,
  ): THREE.Group {
    const sword = new THREE.Group();
    const blade = this.mesh(new THREE.BoxGeometry(0.088, 1.38, 0.033), metal);
    blade.position.y = -0.45;
    sword.add(blade);
    const fuller = this.mesh(new THREE.BoxGeometry(0.016, 1.14, 0.042), edge);
    fuller.position.set(0, -0.42, -0.005);
    sword.add(fuller);
    const guard = this.mesh(new THREE.BoxGeometry(0.54, 0.07, 0.09), ember);
    guard.position.y = 0.27;
    sword.add(guard);
    const grip = this.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), leather);
    grip.position.y = 0.48;
    sword.add(grip);
    const pommel = this.mesh(new THREE.OctahedronGeometry(0.1, 0), ember);
    pommel.position.y = 0.7;
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
