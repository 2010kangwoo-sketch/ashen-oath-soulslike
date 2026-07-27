import * as THREE from 'three';

export class SurfaceFactory {
  static stone(baseColor: number, seed: number, repeat = 6): THREE.MeshStandardMaterial {
    const color = new THREE.Color(baseColor);
    const diffuse = this.noiseTexture(color, seed, repeat, false);
    const bump = this.noiseTexture(new THREE.Color(0x808080), seed + 991, repeat, true);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: diffuse,
      bumpMap: bump,
      bumpScale: 0.12,
      roughnessMap: bump,
      roughness: 0.86,
      metalness: 0.025,
    });
  }

  static metal(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }

  private static noiseTexture(base: THREE.Color, seed: number, repeat: number, monochrome: boolean): THREE.DataTexture {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    let state = seed >>> 0;
    const random = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967295;
    };

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = (y * size + x) * 4;
        const coarse = Math.sin(x * 0.41 + seed) * Math.cos(y * 0.37 - seed) * 0.5 + 0.5;
        const variation = 0.72 + coarse * 0.2 + random() * 0.12;
        const crack = ((x * 17 + y * 31 + seed) % 53) < 2 ? 0.58 : 1;
        const factor = variation * crack;
        data[index] = Math.round(THREE.MathUtils.clamp(base.r * 255 * factor, 0, 255));
        data[index + 1] = Math.round(THREE.MathUtils.clamp((monochrome ? base.r : base.g) * 255 * factor, 0, 255));
        data[index + 2] = Math.round(THREE.MathUtils.clamp((monochrome ? base.r : base.b) * 255 * factor, 0, 255));
        data[index + 3] = 255;
      }
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    if (!monochrome) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
}
