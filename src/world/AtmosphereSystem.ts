import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import type { QualityPreset } from '../settings/GameSettings';

interface Torch {
  readonly light: THREE.PointLight;
  readonly flame: THREE.Mesh;
  readonly position: THREE.Vector3;
  readonly phase: number;
  readonly baseIntensity: number;
}

interface WeatherProfile {
  readonly z: number;
  readonly zenith: number;
  readonly horizon: number;
  readonly fog: number;
  readonly fogDensity: number;
  readonly exposure: number;
  readonly moon: number;
  readonly moonIntensity: number;
  readonly windX: number;
  readonly windZ: number;
}

const WEATHER_PROFILES: readonly WeatherProfile[] = [
  { z: 30, zenith: 0x25394a, horizon: 0x7b7165, fog: 0x182027, fogDensity: 0.0108, exposure: 1.02, moon: 0xc5d8eb, moonIntensity: 4.15, windX: 0.22, windZ: -0.38 },
  { z: -58, zenith: 0x26333f, horizon: 0x635e59, fog: 0x171b20, fogDensity: 0.0138, exposure: 1.01, moon: 0xc1d0df, moonIntensity: 4.0, windX: 0.42, windZ: -0.24 },
  { z: -118, zenith: 0x302f3a, horizon: 0x6f5d5d, fog: 0x211b22, fogDensity: 0.0164, exposure: 1.035, moon: 0xd0c5dc, moonIntensity: 4.25, windX: -0.3, windZ: -0.46 },
  { z: -170, zenith: 0x242d3b, horizon: 0x5b5963, fog: 0x171a22, fogDensity: 0.0152, exposure: 1.045, moon: 0xbdd3ee, moonIntensity: 4.45, windX: -0.5, windZ: -0.18 },
  { z: -236, zenith: 0x1d2a38, horizon: 0x665951, fog: 0x141a20, fogDensity: 0.0136, exposure: 1.07, moon: 0xc7dcf4, moonIntensity: 4.65, windX: 0.18, windZ: -0.62 },
];

const SkyShader = {
  uniforms: {
    time: { value: 0 },
    zenithColor: { value: new THREE.Color(0x25394a) },
    horizonColor: { value: new THREE.Color(0x7b7165) },
    cloudStrength: { value: 0.42 },
    wind: { value: new THREE.Vector2(0.2, -0.4) },
  },
  vertexShader: /* glsl */`
    varying vec3 vLocal;
    void main() {
      vLocal = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform float time;
    uniform vec3 zenithColor;
    uniform vec3 horizonColor;
    uniform float cloudStrength;
    uniform vec2 wind;
    varying vec3 vLocal;

    float cloudLayer(vec2 p) {
      float broad = sin(p.x * 0.045 + time * wind.x * 0.025) * cos(p.y * 0.052 + time * wind.y * 0.02);
      float medium = sin((p.x + p.y) * 0.095 - time * 0.013) * 0.5;
      float fine = cos(p.x * 0.21 - p.y * 0.16 + time * 0.021) * 0.22;
      return smoothstep(0.12, 0.72, broad * 0.5 + medium * 0.3 + fine + 0.48);
    }

    void main() {
      vec3 direction = normalize(vLocal);
      float horizon = pow(clamp(direction.y * 0.5 + 0.5, 0.0, 1.0), 0.72);
      vec3 color = mix(horizonColor, zenithColor, horizon);
      vec2 cloudUv = direction.xz * 185.0 / max(0.22, direction.y + 0.68);
      float clouds = cloudLayer(cloudUv) * smoothstep(-0.12, 0.55, direction.y);
      color = mix(color, color + vec3(0.16, 0.16, 0.18), clouds * cloudStrength);
      float upperFade = smoothstep(0.1, 0.72, direction.y);
      color += vec3(0.018, 0.025, 0.04) * upperFade;
      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

export class AtmosphereSystem {
  readonly group = new THREE.Group();
  private readonly weatherGroup = new THREE.Group();
  private readonly fogGroup = new THREE.Group();
  private readonly skyMaterial = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms),
    vertexShader: SkyShader.vertexShader,
    fragmentShader: SkyShader.fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  private readonly sky = new THREE.Mesh(new THREE.SphereGeometry(255, 32, 18), this.skyMaterial);
  private readonly ashGeometry: THREE.BufferGeometry;
  private readonly ashPositions: Float32Array;
  private readonly ashSpeeds: Float32Array;
  private readonly ashPoints: THREE.Points;
  private readonly fogSheets: THREE.Mesh[] = [];
  private readonly torches: Torch[] = [];
  private readonly currentZenith = new THREE.Color(WEATHER_PROFILES[0]!.zenith);
  private readonly currentHorizon = new THREE.Color(WEATHER_PROFILES[0]!.horizon);
  private readonly currentFog = new THREE.Color(WEATHER_PROFILES[0]!.fog);
  private readonly currentMoon = new THREE.Color(WEATHER_PROFILES[0]!.moon);
  private readonly targetZenith = new THREE.Color();
  private readonly targetHorizon = new THREE.Color();
  private readonly targetFog = new THREE.Color();
  private readonly targetMoon = new THREE.Color();
  private readonly lowerZenith = new THREE.Color();
  private readonly lowerHorizon = new THREE.Color();
  private readonly lowerFog = new THREE.Color();
  private readonly lowerMoon = new THREE.Color();
  private readonly wind = new THREE.Vector3(0.22, 0, -0.38);
  private readonly targetWind = new THREE.Vector3();
  private quality: QualityPreset = 'balanced';
  private performanceTier: 0 | 1 | 2 = 0;
  private fogDensity = WEATHER_PROFILES[0]!.fogDensity;
  private exposure = WEATHER_PROFILES[0]!.exposure;
  private moonIntensity = WEATHER_PROFILES[0]!.moonIntensity;
  private targetFogDensity = this.fogDensity;
  private targetExposure = this.exposure;
  private targetMoonIntensity = this.moonIntensity;
  private elapsed = 0;
  private torchBudgetTimer = 0;
  private updateParity = 0;

  constructor(private readonly scene: THREE.Scene) {
    scene.add(this.group);
    this.group.add(this.weatherGroup);
    this.weatherGroup.add(this.sky, this.fogGroup);
    const ash = this.createAsh();
    this.ashGeometry = ash.geometry;
    this.ashPositions = ash.positions;
    this.ashSpeeds = ash.speeds;
    this.ashPoints = ash.points;
    this.weatherGroup.add(this.ashPoints);
    this.createFogSheets();
    this.setQuality('balanced', 0);
  }

  addTorch(position: THREE.Vector3, intensity = 34): void {
    const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xe1a25e, transparent: true, opacity: 0.9 });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 7), flameMaterial);
    flame.position.copy(position);
    flame.position.y += 0.18;
    this.group.add(flame);

    const light = new THREE.PointLight(0xdf9250, intensity, 15, 1.7);
    light.position.copy(position);
    light.castShadow = false;
    this.group.add(light);
    this.torches.push({
      light,
      flame,
      position: position.clone(),
      phase: position.x * 0.71 + position.z * 0.37,
      baseIntensity: intensity,
    });
  }

  setQuality(quality: QualityPreset, performanceTier: 0 | 1 | 2): void {
    this.quality = quality;
    this.performanceTier = performanceTier;
    const baseRatio = quality === 'performance' ? 0.52 : quality === 'cinematic' ? 1 : 0.78;
    const tierRatio = performanceTier === 2 ? 0.42 : performanceTier === 1 ? 0.68 : 1;
    const count = Math.max(180, Math.floor(GAME_CONFIG.world.ashCount * baseRatio * tierRatio));
    this.ashGeometry.setDrawRange(0, count);
    const fogBudget = performanceTier === 2 ? 3 : performanceTier === 1 ? 5 : quality === 'cinematic' ? 8 : 6;
    this.fogSheets.forEach((sheet, index) => { sheet.visible = index < fogBudget; });
    this.skyMaterial.uniforms['cloudStrength']!.value = performanceTier === 2 ? 0.18 : quality === 'cinematic' ? 0.52 : 0.38;
  }

  update(delta: number, focus: THREE.Vector3): void {
    this.elapsed += delta;
    this.updateParity = (this.updateParity + 1) % 2;
    this.resolveWeatherTargets(focus.z);
    const weatherAlpha = 1 - Math.exp(-0.75 * delta);
    this.currentZenith.lerp(this.targetZenith, weatherAlpha);
    this.currentHorizon.lerp(this.targetHorizon, weatherAlpha);
    this.currentFog.lerp(this.targetFog, weatherAlpha);
    this.currentMoon.lerp(this.targetMoon, weatherAlpha);
    this.wind.lerp(this.targetWind, weatherAlpha);
    this.fogDensity += (this.targetFogDensity - this.fogDensity) * weatherAlpha;
    this.exposure += (this.targetExposure - this.exposure) * weatherAlpha;
    this.moonIntensity += (this.targetMoonIntensity - this.moonIntensity) * weatherAlpha;

    this.sky.position.set(0, focus.y - 24, 0);
    this.weatherGroup.position.x += (focus.x - this.weatherGroup.position.x) * (1 - Math.exp(-1.5 * delta));
    this.weatherGroup.position.z += (focus.z - this.weatherGroup.position.z) * (1 - Math.exp(-1.5 * delta));
    this.skyMaterial.uniforms['time']!.value = this.elapsed;
    (this.skyMaterial.uniforms['zenithColor']!.value as THREE.Color).copy(this.currentZenith);
    (this.skyMaterial.uniforms['horizonColor']!.value as THREE.Color).copy(this.currentHorizon);
    (this.skyMaterial.uniforms['wind']!.value as THREE.Vector2).set(this.wind.x, this.wind.z);

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.currentFog);
      this.scene.fog.density = this.fogDensity;
    }
    this.scene.background = this.currentZenith;

    const particleStep = this.performanceTier === 2 ? 2 : 1;
    if (this.updateParity % particleStep === 0) this.updateAsh(delta * particleStep);
    this.updateFog(delta);
    this.updateTorches(delta, focus);
  }

  copyWind(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.wind);
  }

  copyMoonColor(target: THREE.Color): THREE.Color {
    return target.copy(this.currentMoon);
  }

  getMoonIntensity(): number {
    return this.moonIntensity;
  }

  getExposure(): number {
    return this.exposure;
  }

  private updateAsh(delta: number): void {
    for (let index = 0; index < this.ashSpeeds.length; index += 1) {
      const offset = index * 3;
      const y = this.ashPositions[offset + 1];
      if (y === undefined) continue;
      let nextY = y + this.ashSpeeds[index]! * delta;
      if (nextY > 16) nextY = -1 + (index % 11) * 0.11;
      this.ashPositions[offset + 1] = nextY;
      this.ashPositions[offset] = (this.ashPositions[offset] ?? 0)
        + (this.wind.x * 0.055 + Math.sin(this.elapsed * 0.37 + index) * 0.022) * delta;
      this.ashPositions[offset + 2] = (this.ashPositions[offset + 2] ?? 0) + this.wind.z * 0.035 * delta;
      const x = this.ashPositions[offset] ?? 0;
      const z = this.ashPositions[offset + 2] ?? 0;
      if (x > 48) this.ashPositions[offset] = -48;
      else if (x < -48) this.ashPositions[offset] = 48;
      if (z > 58) this.ashPositions[offset + 2] = -58;
      else if (z < -58) this.ashPositions[offset + 2] = 58;
    }
    this.ashGeometry.getAttribute('position').needsUpdate = true;
  }

  private updateFog(delta: number): void {
    for (let index = 0; index < this.fogSheets.length; index += 1) {
      const sheet = this.fogSheets[index];
      if (!sheet?.visible) continue;
      const material = sheet.material as THREE.MeshBasicMaterial;
      const phase = Number(sheet.userData.phase ?? 0);
      sheet.position.x += this.wind.x * delta * (0.2 + index * 0.015);
      sheet.position.z += this.wind.z * delta * 0.08;
      sheet.position.y = 1.3 + (index % 3) * 1.15 + Math.sin(this.elapsed * 0.17 + phase) * 0.24;
      if (sheet.position.x > 34) sheet.position.x = -34;
      if (sheet.position.x < -34) sheet.position.x = 34;
      if (sheet.position.z > 34) sheet.position.z = -34;
      if (sheet.position.z < -34) sheet.position.z = 34;
      material.color.copy(this.currentFog).lerp(this.currentHorizon, 0.22);
      material.opacity = 0.026 + this.fogDensity * 1.1;
    }
  }

  private updateTorches(delta: number, focus: THREE.Vector3): void {
    this.torchBudgetTimer -= delta;
    if (this.torchBudgetTimer <= 0) {
      this.torchBudgetTimer = 0.35;
      const maxLights = this.performanceTier === 2 ? 3 : this.performanceTier === 1 ? 5 : this.quality === 'cinematic' ? 10 : 7;
      const ordered = this.torches
        .map((torch) => ({ torch, distance: torch.position.distanceToSquared(focus) }))
        .sort((a, b) => a.distance - b.distance);
      ordered.forEach(({ torch, distance }, index) => {
        torch.light.visible = index < maxLights && distance < 52 * 52;
        torch.flame.visible = distance < 88 * 88;
      });
    }

    for (const torch of this.torches) {
      if (!torch.flame.visible && !torch.light.visible) continue;
      const flicker = Math.sin(this.elapsed * 8.7 + torch.phase) * 0.09
        + Math.sin(this.elapsed * 17.3 + torch.phase * 2.1) * 0.04;
      torch.light.intensity = torch.baseIntensity * (1 + flicker);
      torch.flame.scale.y = 0.92 + flicker * 1.6;
      torch.flame.rotation.z = Math.sin(this.elapsed * 5.1 + torch.phase) * 0.08 + this.wind.x * 0.07;
    }
  }

  private resolveWeatherTargets(z: number): void {
    let upper = WEATHER_PROFILES[0]!;
    let lower = WEATHER_PROFILES[WEATHER_PROFILES.length - 1]!;
    for (let index = 0; index < WEATHER_PROFILES.length - 1; index += 1) {
      const candidateUpper = WEATHER_PROFILES[index]!;
      const candidateLower = WEATHER_PROFILES[index + 1]!;
      if (z <= candidateUpper.z && z >= candidateLower.z) {
        upper = candidateUpper;
        lower = candidateLower;
        break;
      }
    }
    const span = Math.max(0.001, upper.z - lower.z);
    const mix = THREE.MathUtils.smoothstep((upper.z - z) / span, 0, 1);
    this.lowerZenith.set(lower.zenith);
    this.lowerHorizon.set(lower.horizon);
    this.lowerFog.set(lower.fog);
    this.lowerMoon.set(lower.moon);
    this.targetZenith.set(upper.zenith).lerp(this.lowerZenith, mix);
    this.targetHorizon.set(upper.horizon).lerp(this.lowerHorizon, mix);
    this.targetFog.set(upper.fog).lerp(this.lowerFog, mix);
    this.targetMoon.set(upper.moon).lerp(this.lowerMoon, mix);
    this.targetFogDensity = THREE.MathUtils.lerp(upper.fogDensity, lower.fogDensity, mix);
    this.targetExposure = THREE.MathUtils.lerp(upper.exposure, lower.exposure, mix);
    this.targetMoonIntensity = THREE.MathUtils.lerp(upper.moonIntensity, lower.moonIntensity, mix);
    this.targetWind.set(
      THREE.MathUtils.lerp(upper.windX, lower.windX, mix),
      0,
      THREE.MathUtils.lerp(upper.windZ, lower.windZ, mix),
    );
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
      positions[index * 3] = (random() - 0.5) * 96;
      positions[index * 3 + 1] = random() * 17;
      positions[index * 3 + 2] = (random() - 0.5) * 116;
      speeds[index] = 0.16 + random() * 0.34;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xc8c1b6,
      size: 0.052,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return { geometry, positions, speeds, points };
  }

  private createFogSheets(): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0x6c7478,
      transparent: true,
      opacity: 0.04,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let index = 0; index < 8; index += 1) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(34 + index * 2, 5.5), material.clone());
      sheet.position.set((index % 3 - 1) * 18, 1.6 + (index % 2) * 1.4, -28 + index * 8);
      sheet.rotation.set(-Math.PI / 2.8, index % 2 ? 0.12 : -0.1, 0);
      sheet.userData.phase = index * 0.83;
      this.fogGroup.add(sheet);
      this.fogSheets.push(sheet);
    }
  }
}
