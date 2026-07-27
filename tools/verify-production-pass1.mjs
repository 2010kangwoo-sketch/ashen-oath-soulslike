import { readFile, stat } from 'node:fs/promises';

const requiredFiles = [
  'src/world/CathedralApproach.ts',
  'src/world/AtmosphereSystem.ts',
  'src/world/SurfaceFactory.ts',
  'src/player/AshenKnightVisual.ts',
  'src/player/PlayerController.ts',
  'src/camera/ThirdPersonCamera.ts',
  'src/render/RenderPipeline.ts',
  'src/ui/GameHud.ts',
  'docs/PRODUCTION_CHARTER.md',
  'docs/ART_DIRECTION.md',
  'docs/COMBAT_BOSS_BIBLE.md',
  'docs/PASS_1_PRODUCTION_REBUILD.md',
];

for (const file of requiredFiles) {
  const info = await stat(file);
  if (!info.isFile() || info.size < 120) throw new Error(`Required production file is incomplete: ${file}`);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (!String(packageJson.version).includes('production-pass1')) {
  throw new Error('package.json is not marked as Production Pass 1.');
}

const game = await readFile('src/core/Game.ts', 'utf8');
const world = await readFile('src/world/CathedralApproach.ts', 'utf8');
const camera = await readFile('src/camera/ThirdPersonCamera.ts', 'utf8');
const player = await readFile('src/player/PlayerController.ts', 'utf8');
const pipeline = await readFile('src/render/RenderPipeline.ts', 'utf8');
const roadmap = await readFile('docs/TEN_PASS_ROADMAP.md', 'utf8');

const assertions = [
  [game.includes('CathedralApproach'), 'Game does not load the production area.'],
  [game.includes('RenderPipeline'), 'Game does not use the production render pipeline.'],
  [world.includes('createCathedralFacade'), 'Cathedral facade composition is missing.'],
  [world.includes('createBrokenColonnades'), 'Environmental silhouette work is missing.'],
  [camera.includes('requestPointerLock'), 'Pointer-lock camera input is missing.'],
  [camera.includes('sprintFov'), 'Sprint camera response is missing.'],
  [player.includes('reversalAcceleration'), 'Direction reversal tuning is missing.'],
  [player.includes('AshenKnightVisual'), 'The styled player rig is not connected.'],
  [pipeline.includes('vignetteStrength'), 'Cinematic grading pass is missing.'],
  [roadmap.includes('보스 3명'), 'The release roadmap does not contain three bosses.'],
  [roadmap.includes('45~70분'), 'The release playtime target is missing.'],
];

for (const [condition, message] of assertions) {
  if (!condition) throw new Error(message);
}

console.log('Production Pass 1 structure verification passed.');
