import { existsSync, readFileSync } from 'node:fs';

const required = [
  'src/ui/GameMenu.ts',
  'src/persistence/GameSave.ts',
  'src/settings/GameSettings.ts',
  'docs/PRODUCTION_PASS_9.md',
];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`Missing Pass 9 file: ${file}`);
}

const index = readFileSync('index.html', 'utf8');
const game = readFileSync('src/core/Game.ts', 'utf8');
const save = readFileSync('src/persistence/GameSave.ts', 'utf8');
const progression = readFileSync('src/progression/ProgressionDirector.ts', 'utf8');
const settings = readFileSync('src/settings/GameSettings.ts', 'utf8');
const input = readFileSync('src/input/InputController.ts', 'utf8');
const camera = readFileSync('src/camera/ThirdPersonCamera.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

for (const id of [
  'title-screen', 'continue-button', 'new-game-button', 'pause-screen',
  'resume-button', 'restart-button', 'settings-screen', 'quality-setting',
  'volume-setting', 'shake-setting', 'sensitivity-setting', 'autosave-indicator',
]) {
  if (!index.includes(`id="${id}"`)) throw new Error(`Missing Pass 9 menu element: ${id}`);
}
for (const token of ['startNewGame()', 'continueGame()', 'pauseGame()', 'saveNow(', 'updateAutosave(', 'updatePerformanceGovernor(']) {
  if (!game.includes(token)) throw new Error(`Missing game shell behavior: ${token}`);
}
for (const token of ['SAVE_VERSION', 'sanitizeProgression', 'sanitizeCombat', 'normalizeProgressionForCombat', 'vectorTuple']) {
  if (!save.includes(token)) throw new Error(`Missing save validation: ${token}`);
}
for (const token of ['getSaveState()', 'restoreSaveState(', 'consumeSaveRequest()', 'applyShortcutState(']) {
  if (!progression.includes(token)) throw new Error(`Missing progression persistence behavior: ${token}`);
}
for (const preset of ["'performance'", "'balanced'", "'cinematic'"]) {
  if (!settings.includes(preset)) throw new Error(`Missing quality preset: ${preset}`);
}
if (!input.includes('setEnabled(enabled: boolean)')) throw new Error('Input must be disabled while menus are open');
if (!camera.includes('setControlSettings(') || !camera.includes('setEnabled(enabled: boolean)')) {
  throw new Error('Camera settings and menu lock are required');
}
if (pkg.version !== '0.9.0-production-pass9') throw new Error(`Unexpected version: ${pkg.version}`);
console.log('Production Pass 9 verification passed.');
