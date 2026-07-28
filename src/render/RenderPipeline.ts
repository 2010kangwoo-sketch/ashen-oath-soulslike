import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { BossSnapshot } from '../combat/CombatTypes';

const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grainStrength: { value: 0.022 },
    vignetteStrength: { value: 0.52 },
    encounterIntensity: { value: 0 },
    mechanicDanger: { value: 0 },
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
      float vignette = smoothstep(1.35, 0.28, dot(centered, centered));
      color *= mix(1.0 - vignetteStrength - mechanicDanger * 0.08, 1.0, vignette);
      float grain = hash(vUv * vec2(1413.0, 911.0) + time * 0.07) - 0.5;
      color += grain * (grainStrength + mechanicDanger * 0.008) * (0.35 + 0.65 * (1.0 - luma));
      float letterbox = smoothstep(0.0, 0.035, min(vUv.y, 1.0 - vUv.y));
      float letterboxMix = clamp(letterbox + (1.0 - encounterIntensity), 0.0, 1.0);
      color *= mix(0.88, 1.0, letterboxMix);
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

  setBossState(snapshot: BossSnapshot): void {
    this.encounterTarget = snapshot.active ? 1 : 0;
    this.dangerTarget = snapshot.active && snapshot.mechanicDanger ? 1 : 0;
  }

  render(delta: number): void {
    this.encounterIntensity += (this.encounterTarget - this.encounterIntensity) * (1 - Math.exp(-3.6 * delta));
    this.dangerIntensity += (this.dangerTarget - this.dangerIntensity) * (1 - Math.exp(-8 * delta));
    this.cinematicPass.uniforms['time']!.value += delta;
    this.cinematicPass.uniforms['encounterIntensity']!.value = this.encounterIntensity;
    this.cinematicPass.uniforms['mechanicDanger']!.value = this.dangerIntensity;
    this.bloomPass.strength = 0.18 + this.encounterIntensity * 0.14 + this.dangerIntensity * 0.16;
    this.bloomPass.radius = 0.42 + this.dangerIntensity * 0.08;
    this.composer.render(delta);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
