import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { BossSnapshot } from '../combat/CombatTypes';
import type { EndingChoice } from '../progression/ProgressionDirector';
import type { QualityPreset } from '../settings/GameSettings';

const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grainStrength: { value: 0.022 },
    vignetteStrength: { value: 0.52 },
    encounterIntensity: { value: 0 },
    mechanicDanger: { value: 0 },
    endingIntensity: { value: 0 },
    endingSever: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float grainStrength;
    uniform float vignetteStrength;
    uniform float encounterIntensity;
    uniform float mechanicDanger;
    uniform float endingIntensity;
    uniform float endingSever;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 centered = vUv * 2.0 - 1.0;
      vec2 aberration = centered * (0.00035 * encounterIntensity + 0.0011 * mechanicDanger);
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec3 color = vec3(
        texture2D(tDiffuse, vUv + aberration).r,
        base.g,
        texture2D(tDiffuse, vUv - aberration).b
      );
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float saturation = 0.82 + encounterIntensity * 0.06 - mechanicDanger * 0.05;
      color = mix(vec3(luma), color, saturation);
      color = (color - 0.5) * (1.055 + encounterIntensity * 0.025) + 0.5;
      color += vec3(0.018, -0.004, -0.006) * mechanicDanger;
      vec3 endingWarm = vec3(0.075, 0.038, -0.012);
      vec3 endingCold = vec3(-0.035, -0.012, 0.038);
      color += mix(endingWarm, endingCold, endingSever) * endingIntensity;
      color = mix(color, vec3(dot(color, vec3(0.28, 0.62, 0.1))), endingIntensity * (0.18 + endingSever * 0.22));
      float vignette = smoothstep(1.35, 0.28, dot(centered, centered));
      color *= mix(1.0 - vignetteStrength - mechanicDanger * 0.08, 1.0, vignette);
      float grain = hash(vUv * vec2(1413.0, 911.0) + time * 0.07) - 0.5;
      color += grain * (grainStrength + mechanicDanger * 0.008) * (0.35 + 0.65 * (1.0 - luma));
      float letterbox = smoothstep(0.0, 0.035, min(vUv.y, 1.0 - vUv.y));
      float letterboxMix = clamp(letterbox + (1.0 - encounterIntensity), 0.0, 1.0);
      color *= mix(0.88, 1.0, letterboxMix);
      color *= 1.0 - endingIntensity * 0.14;
      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

export class RenderPipeline {
  private readonly composer: EffectComposer;
  private readonly cinematicPass: ShaderPass;
  private readonly bloomPass: UnrealBloomPass;
  private encounterTarget = 0;
  private dangerTarget = 0;
  private encounterIntensity = 0;
  private dangerIntensity = 0;
  private endingTarget = 0;
  private endingIntensity = 0;
  private endingSever = 0;
  private quality: QualityPreset = 'balanced';

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.45, 0.86);
    this.composer.addPass(this.bloomPass);
    this.cinematicPass = new ShaderPass(CinematicShader);
    this.composer.addPass(this.cinematicPass);
    this.composer.addPass(new OutputPass());
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }


  setQuality(preset: QualityPreset): void {
    this.quality = preset;
    const grain = preset === 'performance' ? 0.012 : preset === 'cinematic' ? 0.026 : 0.019;
    const vignette = preset === 'performance' ? 0.44 : preset === 'cinematic' ? 0.56 : 0.5;
    this.cinematicPass.uniforms['grainStrength']!.value = grain;
    this.cinematicPass.uniforms['vignetteStrength']!.value = vignette;
    this.bloomPass.threshold = preset === 'performance' ? 0.91 : preset === 'cinematic' ? 0.82 : 0.87;
  }

  setBossState(snapshot: BossSnapshot): void {
    this.encounterTarget = snapshot.active ? 1 : 0;
    this.dangerTarget = snapshot.active && snapshot.mechanicDanger ? 1 : 0;
  }

  setEndingState(active: boolean, choice: EndingChoice | null): void {
    this.endingTarget = active ? 1 : 0;
    this.endingSever = choice === 'sever' ? 1 : 0;
  }

  render(delta: number): void {
    this.encounterIntensity += (this.encounterTarget - this.encounterIntensity) * (1 - Math.exp(-3.6 * delta));
    this.dangerIntensity += (this.dangerTarget - this.dangerIntensity) * (1 - Math.exp(-8 * delta));
    this.endingIntensity += (this.endingTarget - this.endingIntensity) * (1 - Math.exp(-1.35 * delta));
    this.cinematicPass.uniforms['time']!.value += delta;
    this.cinematicPass.uniforms['encounterIntensity']!.value = this.encounterIntensity;
    this.cinematicPass.uniforms['mechanicDanger']!.value = this.dangerIntensity;
    this.cinematicPass.uniforms['endingIntensity']!.value = this.endingIntensity;
    this.cinematicPass.uniforms['endingSever']!.value = this.endingSever;
    const qualityBloom = this.quality === 'performance' ? 0.58 : this.quality === 'cinematic' ? 1.12 : 0.86;
    this.bloomPass.strength = (0.18 + this.encounterIntensity * 0.14 + this.dangerIntensity * 0.16 + this.endingIntensity * 0.08) * qualityBloom;
    this.bloomPass.radius = (0.42 + this.dangerIntensity * 0.08) * (this.quality === 'performance' ? 0.82 : 1);
    this.composer.render(delta);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
