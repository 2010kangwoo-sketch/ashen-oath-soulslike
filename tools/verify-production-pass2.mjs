import { readFile, stat } from 'node:fs/promises';

const requiredFiles = [
  'src/combat/CombatTypes.ts',
  'src/combat/CombatDirector.ts',
  'src/combat/CombatEffects.ts',
  'src/enemy/AshenSentinel.ts',
  'src/player/PlayerController.ts',
  'src/player/AshenKnightVisual.ts',
  'src/input/InputController.ts',
  'src/ui/GameHud.ts',
  'docs/PASS_2_COMBAT_FOUNDATION.md',
];

for (const file of requiredFiles) {
  const info = await stat(file);
  if (!info.isFile() || info.size < 180) throw new Error(`Production Pass 2 file is incomplete: ${file}`);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (!String(packageJson.version).includes('production-pass2')) {
  throw new Error('package.json is not marked as Production Pass 2.');
}

const config = await readFile('src/config/GameConfig.ts', 'utf8');
const input = await readFile('src/input/InputController.ts', 'utf8');
const player = await readFile('src/player/PlayerController.ts', 'utf8');
const enemy = await readFile('src/enemy/AshenSentinel.ts', 'utf8');
const combat = await readFile('src/combat/CombatDirector.ts', 'utf8');
const camera = await readFile('src/camera/ThirdPersonCamera.ts', 'utf8');
const hud = await readFile('src/ui/GameHud.ts', 'utf8');
const game = await readFile('src/core/Game.ts', 'utf8');
const html = await readFile('index.html', 'utf8');

const assertions = [
  [config.includes('dodgeInvulnerableStart'), 'Dodge invulnerability data is missing.'],
  [config.includes('parryWindowStart'), 'Parry window data is missing.'],
  [config.includes('guardStaminaMultiplier'), 'Guard stamina tuning is missing.'],
  [input.includes("'lightAttack' | 'heavyAttack' | 'dodge' | 'lockOn' | 'parry'"), 'Combat input actions are incomplete.'],
  [input.includes('isGuarding'), 'Held guard input is missing.'],
  [player.includes("type PlayerAction = 'none' | 'dodge'"), 'Player action state machine is missing.'],
  [player.includes("return 'parried'"), 'Player parry resolution is missing.'],
  [player.includes('queuedLightAttack'), 'Attack input buffering is missing.'],
  [enemy.includes("'overhead' | 'sweep' | 'lunge'"), 'Sentinel attack variety is missing.'],
  [enemy.includes('receiveParry'), 'Enemy parry reaction is missing.'],
  [combat.includes('consumeHitStop'), 'Hit-stop control is missing.'],
  [combat.includes("result === 'guarded'"), 'Guard result routing is missing.'],
  [camera.includes('lockTargetWeight'), 'Lock-on camera framing is missing.'],
  [hud.includes('setVitals'), 'Live health and stamina HUD is missing.'],
  [hud.includes('project(camera)'), 'World-projected lock reticle is missing.'],
  [game.includes('new CombatDirector'), 'Combat director is not connected to the game.'],
  [html.includes('lock-target-health-fill'), 'Target health UI is missing.'],
];

for (const [condition, message] of assertions) {
  if (!condition) throw new Error(message);
}

console.log('Production Pass 2 combat structure verification passed.');
