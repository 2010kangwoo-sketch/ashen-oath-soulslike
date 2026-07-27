export const GAME_CONFIG = {
  title: 'Ashen Oath',
  pass: 0,
  renderer: {
    maxPixelRatio: 1.75,
    shadowMapSize: 2048,
  },
  camera: {
    fov: 52,
    near: 0.1,
    far: 260,
    startPosition: [18, 12, 24] as const,
    target: [0, 3.2, 0] as const,
  },
  physics: {
    gravity: -16,
    fixedStep: 1 / 60,
  },
} as const;
