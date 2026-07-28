import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';

const requiredFiles = [
  'src/core/TraversalSafety.ts',
  'src/physics/PhysicsWorld.ts',
  'src/core/Game.ts',
  'src/player/PlayerController.ts',
  'src/progression/ProgressionDirector.ts',
  'src/input/InputController.ts',
  'src/ui/GameMenu.ts',
  'src/ui/GameHud.ts',
  'src/enemy/GatewardenVarkan.ts',
  'src/enemy/BellDevouringWidow.ts',
  'src/enemy/AshenOathkeeper.ts',
  'docs/PRODUCTION_PASS_13.md',
  'docs/FINAL_QA_MATRIX.md',
  'run-game.ps1',
  'verify-and-preview.ps1',
];
for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`Missing Pass 13 file: ${file}`);
}

const read = (path) => readFileSync(path, 'utf8');
const pkg = JSON.parse(read('package.json'));
const index = read('index.html');
const config = read('src/config/GameConfig.ts');
const traversal = read('src/core/TraversalSafety.ts');
const physics = read('src/physics/PhysicsWorld.ts');
const game = read('src/core/Game.ts');
const player = read('src/player/PlayerController.ts');
const progression = read('src/progression/ProgressionDirector.ts');
const input = read('src/input/InputController.ts');
const menu = read('src/ui/GameMenu.ts');
const hud = read('src/ui/GameHud.ts');
const combat = read('src/combat/CombatDirector.ts');
const varkan = read('src/enemy/GatewardenVarkan.ts');
const widow = read('src/enemy/BellDevouringWidow.ts');
const oathkeeper = read('src/enemy/AshenOathkeeper.ts');
const runScript = read('run-game.ps1');
const previewScript = read('verify-and-preview.ps1');

if (pkg.version !== '1.0.0-rc.4') throw new Error(`Unexpected Pass 13 version: ${pkg.version}`);
if (pkg.scripts?.start !== 'vite --host 127.0.0.1 --open') throw new Error('Pass 13 local start command is not active.');
if (pkg.scripts?.verify !== 'npm run typecheck && npm run build && node tools/verify-production-pass13.mjs') {
  throw new Error('Pass 13 verify script is not active.');
}
if (!config.includes('pass: 13')) throw new Error('GameConfig is not marked as Pass 13.');
if (!index.includes('RELEASE CANDIDATE · 1.0.0-RC.4')) throw new Error('RC.4 release label is missing.');

for (const token of ['minimumX', 'maximumX', 'minimumY', 'maximumY', 'minimumZ', 'maximumZ', 'minimumSafeY', 'maximumSampleSpeed']) {
  if (!config.includes(token)) throw new Error(`Traversal envelope is incomplete: ${token}`);
}
for (const token of [
  'MAX_SAFE_SAMPLES',
  'SAFE_SAMPLE_INTERVAL',
  'impossible-displacement',
  'outside-playable-envelope',
  'hasRecoverySample()',
  'getRecoveryPosition(',
  'isInsidePlayableEnvelope(',
]) {
  if (!traversal.includes(token)) throw new Error(`Traversal safety is incomplete: ${token}`);
}
for (const token of ['maximumAcceptedDelta', 'maxSubSteps', 'saturatedFrameCount', 'clampedFrameCount', 'discardedSeconds', 'resetAccumulator()', 'getStepStats()']) {
  if (!physics.includes(token)) throw new Error(`Physics frame safety is incomplete: ${token}`);
}
for (const token of ['new TraversalSafety()', 'recoverTraversal(', 'traversalSafety.update(', 'physics.resetAccumulator()', 'setRuntimeDiagnostics(']) {
  if (!game.includes(token)) throw new Error(`Game runtime safety integration is incomplete: ${token}`);
}
for (const token of ['recoverTraversalAt(', 'safetyGraceRemaining', 'this.invulnerable = true']) {
  if (!player.includes(token)) throw new Error(`Player recovery state is incomplete: ${token}`);
}
for (const token of ['getActiveRespawn(', 'recoverTraversalFailure(', 'clearTransientCombat()']) {
  const source = token === 'clearTransientCombat()' ? combat : progression;
  if (!source.includes(token)) throw new Error(`Progression/combat recovery is incomplete: ${token}`);
}
for (const token of ['gamepadconnected', 'gamepaddisconnected', 'getConnectedGamepad()', 'preferredGamepadIndex', 'getDeviceLabel()']) {
  if (!input.includes(token)) throw new Error(`Gamepad lifecycle support is incomplete: ${token}`);
}
if (!menu.includes('onRecoverTraversal') || !menu.includes("requireButton('recover-traversal-button')")) {
  throw new Error('Manual traversal recovery is not connected to the pause menu.');
}
for (const id of ['recover-traversal-button', 'physics-step-status', 'traversal-safety-status', 'input-device-status']) {
  if (!index.includes(`id="${id}"`)) throw new Error(`Missing Pass 13 UI element: ${id}`);
}
for (const token of ['PhysicsStepStats', 'TraversalSafetySnapshot', 'setRuntimeDiagnostics(', 'inputDevice']) {
  if (!hud.includes(token)) throw new Error(`Runtime diagnostic HUD is incomplete: ${token}`);
}
for (const [name, source] of [['Varkan', varkan], ['Widow', widow], ['Oathkeeper', oathkeeper]]) {
  for (const token of ['recoverArenaPosition()', 'isFinitePosition(']) {
    if (!source.includes(token)) throw new Error(`${name} arena recovery is incomplete: ${token}`);
  }
  if (!source.includes('THREE.MathUtils.clamp')) throw new Error(`${name} is missing arena clamping.`);
}
for (const token of ['Node.js 20.19', 'npm install', 'npm run start']) {
  if (!runScript.includes(token)) throw new Error(`Local execution script is incomplete: ${token}`);
}
for (const token of ['npm run verify', 'npm run preview']) {
  if (!previewScript.includes(token)) throw new Error(`Production preview script is incomplete: ${token}`);
}

const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, indexValue) => ids.indexOf(id) !== indexValue);
if (duplicates.length) throw new Error(`Duplicate HTML IDs: ${[...new Set(duplicates)].join(', ')}`);

const safetyValues = Object.fromEntries(
  [...config.matchAll(/(minimumX|maximumX|minimumY|maximumY|minimumZ|maximumZ):\s*(-?\d+(?:\.\d+)?)/g)]
    .map((match) => [match[1], Number(match[2])]),
);
if (!(safetyValues.minimumX < safetyValues.maximumX
  && safetyValues.minimumY < safetyValues.maximumY
  && safetyValues.minimumZ < safetyValues.maximumZ)) {
  throw new Error('Playable traversal envelope has invalid bounds.');
}
const expectedSpawns = [
  [0, 1.12, 22],
  [20.8, 3.56, -34.5],
  [0, 1.62, -56.2],
  [0, 2.12, -124.2],
  [0, 2.12, -178.0],
];
for (const [x, y, z] of expectedSpawns) {
  if (x < safetyValues.minimumX || x > safetyValues.maximumX
    || y < safetyValues.minimumY || y > safetyValues.maximumY
    || z < safetyValues.minimumZ || z > safetyValues.maximumZ) {
    throw new Error(`A progression spawn lies outside the traversal envelope: ${x}, ${y}, ${z}`);
  }
}
const fixedStepMatch = config.match(/fixedStep:\s*1\s*\/\s*(\d+)/);
const maxSubStepsMatch = config.match(/maxSubSteps:\s*(\d+)/);
const fixedRate = Number(fixedStepMatch?.[1]);
const maxSubSteps = Number(maxSubStepsMatch?.[1]);
if (!Number.isFinite(fixedRate) || fixedRate < 50 || fixedRate > 240) throw new Error('Physics fixed rate is invalid.');
if (!Number.isInteger(maxSubSteps) || maxSubSteps < 2 || maxSubSteps > 8) throw new Error('Physics maxSubSteps is unsafe.');
const maximumAcceptedFrame = maxSubSteps / fixedRate;
if (maximumAcceptedFrame > 0.14) throw new Error('Physics permits too much catch-up work in one render frame.');

verifyRelativeImports('src');
verifyRelativeImports('.', new Set(['.ts']));

console.log(`Production Pass 13 final safety verification passed (${ids.length} unique HTML IDs).`);

function verifyRelativeImports(root, extensions = new Set(['.ts'])) {
  const files = walk(root).filter((path) => extensions.has(extname(path)));
  for (const file of files) {
    const source = read(file);
    const imports = [...source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of imports) {
      const base = resolve(dirname(file), specifier);
      const candidates = [base, `${base}.ts`, join(base, 'index.ts')].map(normalize);
      if (!candidates.some((candidate) => existsSync(candidate))) {
        throw new Error(`Broken relative import in ${file}: ${specifier}`);
      }
    }
  }
}

function walk(root) {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      output.push(...walk(path));
    } else {
      output.push(path);
    }
  }
  return output;
}
