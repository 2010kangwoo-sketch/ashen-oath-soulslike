import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grainStrength: { value: 0.022 },
    vignetteStrength: { value: 0.52 },
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
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, 0.82);
      color = (color - 0.5) * 1.055 + 0.5;
      vec2 centered = vUv * 2.0 - 1.0;
      float vignette = smoothstep(1.35, 0.28, dot(centered, centered));
      color *= mix(1.0 - vignetteStrength, 1.0, vignette);
      float grain = hash(vUv * vec2(1413.0, 911.0) + time * 0.07) - 0.5;
      color += grain * grainStrength * (0.35 + 0.65 * (1.0 - luma));
      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

export class RenderPipeline {
  private readonly composer: EffectComposer;
  private readonly cinematicPass: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.cinematicPass = new ShaderPass(CinematicShader);
    this.composer.addPass(this.cinematicPass);
    this.composer.addPass(new OutputPass());
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(delta: number): void {
    this.cinematicPass.uniforms['time']!.value += delta;
    this.composer.render(delta);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
