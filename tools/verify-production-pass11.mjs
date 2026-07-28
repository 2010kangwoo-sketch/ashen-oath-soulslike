import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'src/core/Game.ts',
  'src/core/FrameMonitor.ts',
  'src/core/PerformanceGovernor.ts',
  'src/core/ScreenTransition.ts',
  'src/camera/ThirdPersonCamera.ts',
  'src/player/PlayerController.ts',
  'src/world/AtmosphereSystem.ts',
  'src/world/CathedralApproach.ts',
  'src/render/RenderPipeline.ts',
  'src/ui/GameHud.ts',
  'docs/PRODUCTION_PASS_11.md',
  'docs/FINAL_QA_MATRIX.md',
  'docs/RELEASE_VALIDATION.md',
];
for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`Missing Pass 11 quality-assurance file: ${file}`);
}

const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const styles = read('src/styles.css');
const game = read('src/core/Game.ts');
const frameMonitor = read('src/core/FrameMonitor.ts');
const governor = read('src/core/PerformanceGovernor.ts');
const transition = read('src/core/ScreenTransition.ts');
const camera = read('src/camera/ThirdPersonCamera.ts');
const player = read('src/player/PlayerController.ts');
const atmosphere = read('src/world/AtmosphereSystem.ts');
const world = read('src/world/CathedralApproach.ts');
const pipeline = read('src/render/RenderPipeline.ts');
const hud = read('src/ui/GameHud.ts');
const config = read('src/config/GameConfig.ts');
const save = read('src/persistence/GameSave.ts');
const combat = read('src/combat/CombatDirector.ts');
const menu = read('src/ui/GameMenu.ts');
const qa = read('docs/FINAL_QA_MATRIX.md');
const pkg = JSON.parse(read('package.json'));

if (pkg.version !== '1.0.0-rc.2') throw new Error(`Unexpected Pass 11 version: ${pkg.version}`);
if (pkg.scripts?.verify !== 'npm run typecheck && npm run build && node tools/verify-production-pass11.mjs') {
  throw new Error('Package verification is not wired to Pass 11.');
}
if (!config.includes('pass: 11')) throw new Error('GameConfig is not marked as Pass 11.');
if (!index.includes('RELEASE CANDIDATE · 1.0.0-RC.2')) throw new Error('RC.2 title label is missing.');

const requiredIds = [
  'screen-transition', 'frame-time-status', 'render-scale-status', 'effect-tier-status',
  'camera-space-status', 'draw-call-status', 'triangle-status',
  'title-screen', 'pause-screen', 'settings-screen', 'ending-panel',
];
for (const id of requiredIds) {
  if (!index.includes(`id="${id}"`)) throw new Error(`Missing Pass 11 UI element: ${id}`);
}
const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, indexValue) => ids.indexOf(id) !== indexValue);
if (duplicates.length) throw new Error(`Duplicate HTML IDs: ${[...new Set(duplicates)].join(', ')}`);

for (const token of ['closing', 'holding', 'opening', 'coverAndRun(', 'pendingComplete', '0.24', '0.42']) {
  if (!transition.includes(token)) throw new Error(`Screen transition contract is incomplete: ${token}`);
}
for (const token of ['runScreenTransition(', 'prepareGameplay()', 'finishGameplayTransition()', 'snapCameraToPlayer()']) {
  if (!game.includes(token)) throw new Error(`Game transition integration is incomplete: ${token}`);
}
if (!styles.includes('.screen-transition') || !styles.includes('.screen-transition-grain')) {
  throw new Error('Screen-transition presentation CSS is missing.');
}

for (const token of [
  'COLLISION_SAMPLE_OFFSETS', '[-0.24, 0]', '[0.24, 0]', '[0, 0.2]', '[0, -0.16]',
  'secondsSinceLook', 'currentShoulderOffset', 'collisionRatio', 'snapBehind(',
]) {
  if (!camera.includes(token)) throw new Error(`Third-person camera quality guard is incomplete: ${token}`);
}
const cameraUpdate = camera.slice(camera.indexOf('  update('), camera.indexOf('  copyPlanarForward'));
if (cameraUpdate.includes('.clone()')) throw new Error('Third-person camera allocates cloned vectors in its update loop.');
if ((cameraUpdate.match(/intersectObjects\(/g) ?? []).length !== 1) {
  throw new Error('Camera collision should reuse one raycaster call inside the sample loop.');
}

for (const token of ['targetVelocity', 'velocityDelta', 'maxVelocityChange', 'steeringDot']) {
  if (!player.includes(token)) throw new Error(`Vector-based locomotion smoothing is incomplete: ${token}`);
}
if (player.includes('moveTowards(this.horizontalVelocity.x') || player.includes('moveTowards(this.horizontalVelocity.z')) {
  throw new Error('Legacy axis-by-axis movement snapping remains.');
}
if (!config.includes('reversalAcceleration: 24')) throw new Error('Reversal acceleration was not softened.');

for (const token of ['averageFrameMs', 'p95FrameMs', 'jitterMs', 'new Float32Array(SAMPLE_COUNT)', 'p95Index']) {
  if (!frameMonitor.includes(token)) throw new Error(`Frame-time telemetry is incomplete: ${token}`);
}
for (const token of [
  'severeStressSeconds', 'stats.p95FrameMs > 34', 'stats.jitterMs > 8.5',
  'minimumScale()', 'effectTier', 'recoverySeconds >= 15',
]) {
  if (!governor.includes(token)) throw new Error(`Performance governor is incomplete: ${token}`);
}
for (const token of ['setPerformanceTier(', 'performanceTier === 2', 'bloomPass.enabled']) {
  if (!pipeline.includes(token)) throw new Error(`Post-processing degradation is incomplete: ${token}`);
}
for (const token of ['setPerformance(', 'p95FrameMs', 'drawCalls', 'triangles']) {
  if (!hud.includes(token)) throw new Error(`Performance diagnostics are incomplete: ${token}`);
}

for (const token of [
  'WEATHER_PROFILES', 'SkyShader', 'cloudLayer', 'resolveWeatherTargets',
  'weatherGroup.position.x', 'copyMoonColor(', 'getMoonIntensity()', 'getExposure()',
  'setQuality(quality: QualityPreset, performanceTier', 'torchBudgetTimer',
]) {
  if (!atmosphere.includes(token)) throw new Error(`Area atmosphere system is incomplete: ${token}`);
}
if ((atmosphere.match(/\{ z:/g) ?? []).length < 5) throw new Error('Fewer than five environment profiles are defined.');
for (const token of ['createTerrainCohesion()', 'InstancedMesh', 'copyWind(', 'setPresentationQuality(']) {
  if (!world.includes(token)) throw new Error(`Terrain cohesion or weather integration is incomplete: ${token}`);
}
for (const token of [
  'updateLighting(delta', 'texelSize', 'renderer.shadowMap.needsUpdate',
  'heroFill', 'toneMappingExposure', 'world.copyMoonColor',
]) {
  if (!game.includes(token)) throw new Error(`Dynamic lighting integration is incomplete: ${token}`);
}

// Preserve critical Pass 10 release protections.
for (const token of ['onVisibilityChange', 'onPageHide', 'onContextLost', 'onContextRestored', "has('debug')"]) {
  if (!game.includes(token)) throw new Error(`Browser lifecycle protection regressed: ${token}`);
}
for (const token of ['normalizeProgressionForCombat', 'sanitizeCombat', 'VALID_SHRINES']) {
  if (!save.includes(token)) throw new Error(`Save corruption guard regressed: ${token}`);
}
for (const token of ['navigator.getGamepads', 'newGameArmed']) {
  if (!menu.includes(token)) throw new Error(`Release menu protection regressed: ${token}`);
}
for (const token of ['this.varkanDefeated', 'this.widowDefeated', 'this.oathkeeperDefeated']) {
  if (!combat.includes(token)) throw new Error(`Three-boss progression regressed: ${token}`);
}

for (let item = 1; item <= 17; item += 1) {
  if (!qa.includes(`| ${item} |`)) throw new Error(`Final QA matrix is missing user criterion ${item}.`);
}
for (const token of ['전투 공정성', '입력과 접근성', 'AI와 경계', '성능과 메모리', '저장·배포']) {
  if (!qa.includes(token)) throw new Error(`Additional final QA category is missing: ${token}`);
}

console.log(`Production Pass 11 quality-assurance verification passed (${ids.length} unique HTML IDs).`);
