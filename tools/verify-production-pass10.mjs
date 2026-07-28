import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'src/core/Game.ts',
  'src/ui/GameMenu.ts',
  'src/ui/GameHud.ts',
  'src/settings/GameSettings.ts',
  'src/render/RenderPipeline.ts',
  'src/persistence/GameSave.ts',
  'src/progression/ProgressionDirector.ts',
  'src/enemy/GatewardenVarkan.ts',
  'src/enemy/BellDevouringWidow.ts',
  'src/enemy/AshenOathkeeper.ts',
  'docs/PRODUCTION_PASS_10.md',
  'docs/RELEASE_VALIDATION.md',
];
for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`Missing release-candidate file: ${file}`);
}

const index = readFileSync('index.html', 'utf8');
const styles = readFileSync('src/styles.css', 'utf8');
const game = readFileSync('src/core/Game.ts', 'utf8');
const main = readFileSync('src/main.ts', 'utf8');
const menu = readFileSync('src/ui/GameMenu.ts', 'utf8');
const hud = readFileSync('src/ui/GameHud.ts', 'utf8');
const settings = readFileSync('src/settings/GameSettings.ts', 'utf8');
const pipeline = readFileSync('src/render/RenderPipeline.ts', 'utf8');
const camera = readFileSync('src/camera/ThirdPersonCamera.ts', 'utf8');
const progression = readFileSync('src/progression/ProgressionDirector.ts', 'utf8');
const save = readFileSync('src/persistence/GameSave.ts', 'utf8');
const config = readFileSync('src/config/GameConfig.ts', 'utf8');
const combat = readFileSync('src/combat/CombatDirector.ts', 'utf8');
const bossEnemy = readFileSync('src/enemy/BossEnemy.ts', 'utf8');
const varkan = readFileSync('src/enemy/GatewardenVarkan.ts', 'utf8');
const widow = readFileSync('src/enemy/BellDevouringWidow.ts', 'utf8');
const oathkeeper = readFileSync('src/enemy/AshenOathkeeper.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

if (pkg.version !== '1.0.0-rc.1') throw new Error(`Unexpected release version: ${pkg.version}`);
if (pkg.scripts?.verify !== 'npm run typecheck && npm run build && node tools/verify-production-pass10.mjs') {
  throw new Error('Release verification command is not wired to Pass 10.');
}
if (!config.includes('pass: 10')) throw new Error('GameConfig is not marked as Pass 10.');
if (index.includes('PRODUCTION BUILD · PASS 9')) throw new Error('Pass 9 development label remains in the release UI.');
if (!index.includes('RELEASE CANDIDATE · 1.0.0-RC.1')) throw new Error('Release-candidate label is missing.');

const requiredIds = [
  'ending-actions', 'ending-title-button', 'ending-new-game-button',
  'reduced-motion-setting', 'telegraph-contrast-setting', 'ui-scale-setting', 'ui-scale-value',
  'title-screen', 'pause-screen', 'settings-screen', 'autosave-indicator',
];
for (const id of requiredIds) {
  if (!index.includes(`id="${id}"`)) throw new Error(`Missing release UI element: ${id}`);
}
const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, indexValue) => ids.indexOf(id) !== indexValue);
if (duplicates.length) throw new Error(`Duplicate HTML IDs: ${[...new Set(duplicates)].join(', ')}`);

for (const token of ['showStartupFailure', 'WebGL 2', '다시 시도', 'window.location.reload()']) {
  if (!main.includes(token)) throw new Error(`Startup recovery UI is incomplete: ${token}`);
}

for (const token of [
  'onVisibilityChange', 'onPageHide', 'onContextLost', 'onContextRestored',
  'onEndingReturnToTitle', 'onEndingNewGame', "has('debug')",
]) {
  if (!game.includes(token)) throw new Error(`Missing browser lifecycle behavior: ${token}`);
}
if (/if \(!this\.gameActive \|\| this\.progression\?\.isEndingLocked\(\)\) return;/.test(game)) {
  throw new Error('Ending-locked saves are still blocked.');
}
if (!progression.includes('this.endingsSeen.add(choice);\n    this.saveRequested = true;')) {
  throw new Error('Ending choice does not immediately request a save.');
}
if (!hud.includes("this.endingActions.classList.toggle('is-hidden', progress < (reducedMotion ? 0.18 : 0.88))")) {
  throw new Error('Credits do not expose post-ending actions.');
}

for (const token of ['reducedMotion', 'highContrastTelegraphs', 'uiScale']) {
  if (!settings.includes(token) || !menu.includes(token)) throw new Error(`Accessibility setting is not fully wired: ${token}`);
}
if (!menu.includes('newGameArmed') || !menu.includes('기존 기록을 지우고 시작')) {
  throw new Error('Existing saves can still be erased without a two-step new-game confirmation.');
}
for (const token of ['navigator.getGamepads', 'moveFocus(', 'adjustFocusedControl(']) {
  if (!menu.includes(token)) throw new Error(`Gamepad menu navigation is incomplete: ${token}`);
}
if (!pipeline.includes('setAccessibility(') || !pipeline.includes('contrastBoost') || !pipeline.includes('motionScale')) {
  throw new Error('Accessibility post-processing is incomplete.');
}
if (!game.includes('this.combat?.setHighContrastTelegraphs(settings.highContrastTelegraphs)')) {
  throw new Error('High-contrast accessibility is not propagated to 3D boss telegraphs.');
}
if (!bossEnemy.includes('setHighContrastTelegraphs(enabled: boolean): void')) {
  throw new Error('Boss telegraph accessibility contract is missing.');
}
if (!combat.includes('for (const boss of this.bosses) boss.setHighContrastTelegraphs(enabled)')) {
  throw new Error('Boss telegraph accessibility propagation is missing.');
}
for (const [name, source] of [['Varkan', varkan], ['Widow', widow], ['Oathkeeper', oathkeeper]]) {
  if (!source.includes('setHighContrastTelegraphs(enabled: boolean): void') || !source.includes('highContrastTelegraphs')) {
    throw new Error(`${name} 3D telegraph contrast implementation is incomplete.`);
  }
}
if (!oathkeeper.includes('0x54d8ff')) throw new Error('Final-boss safe zone lacks a distinct high-contrast color.');
for (const token of ['.reduced-motion', '.high-contrast-telegraphs', '.ending-actions']) {
  if (!styles.includes(token)) throw new Error(`Missing release CSS behavior: ${token}`);
}

for (const token of ['private readonly toLock', 'private readonly castOrigin', 'private readonly collisionVector']) {
  if (!camera.includes(token)) throw new Error(`Camera allocation reduction missing: ${token}`);
}
const updateBody = camera.slice(camera.indexOf('  update('), camera.indexOf('  copyPlanarForward'));
if (updateBody.includes('.clone()')) throw new Error('Third-person camera still allocates cloned vectors every frame.');
if (!camera.includes('requestPointerLock?.bind')) throw new Error('Pointer-lock fallback is missing.');

for (const token of ['normalizeProgressionForCombat', 'sanitizeCombat', 'vectorTuple', 'VALID_SHRINES']) {
  if (!save.includes(token)) throw new Error(`Save corruption guard regressed: ${token}`);
}
for (const token of ['bossTriggerZ: -90.2', 'widowTriggerZ: -136.0', 'oathkeeperTriggerZ: -190.0']) {
  if (!config.includes(token)) throw new Error(`Boss route trigger changed unexpectedly: ${token}`);
}
for (const token of ['this.varkanDefeated', 'this.widowDefeated', 'this.oathkeeperDefeated', 'areAllBossesDefeated()']) {
  if (!combat.includes(token)) throw new Error(`Three-boss progression regressed: ${token}`);
}
for (const bossFile of ['GatewardenVarkan.ts', 'BellDevouringWidow.ts', 'AshenOathkeeper.ts']) {
  const source = readFileSync(`src/enemy/${bossFile}`, 'utf8');
  if (!source.includes('getBossSnapshot()') || !source.includes('consumePresentationEvent()')) {
    throw new Error(`Boss presentation contract regressed: ${bossFile}`);
  }
}

console.log(`Production Pass 10 release-candidate verification passed (${ids.length} unique HTML IDs).`);
