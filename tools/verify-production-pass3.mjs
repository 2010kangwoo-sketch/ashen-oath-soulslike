import { readFile, stat } from 'node:fs/promises';

const requiredFiles = [
  'src/audio/AudioDirector.ts',
  'src/combat/CombatTypes.ts',
  'src/combat/CombatDirector.ts',
  'src/combat/CombatEffects.ts',
  'src/enemy/CombatEnemy.ts',
  'src/enemy/AshenSentinel.ts',
  'src/enemy/AshenHound.ts',
  'src/player/PlayerController.ts',
  'src/player/AshenKnightVisual.ts',
  'src/world/CathedralApproach.ts',
  'docs/PRODUCTION_PASS_3.md',
];

for (const file of requiredFiles) {
  const info = await stat(file);
  if (!info.isFile() || info.size < 220) throw new Error(`Production Pass 3 file is incomplete: ${file}`);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (!String(packageJson.version).includes('production-pass3')) {
  throw new Error('package.json is not marked as Production Pass 3.');
}

const config = await readFile('src/config/GameConfig.ts', 'utf8');
const input = await readFile('src/input/InputController.ts', 'utf8');
const player = await readFile('src/player/PlayerController.ts', 'utf8');
const visual = await readFile('src/player/AshenKnightVisual.ts', 'utf8');
const sentinel = await readFile('src/enemy/AshenSentinel.ts', 'utf8');
const hound = await readFile('src/enemy/AshenHound.ts', 'utf8');
const combat = await readFile('src/combat/CombatDirector.ts', 'utf8');
const audio = await readFile('src/audio/AudioDirector.ts', 'utf8');
const world = await readFile('src/world/CathedralApproach.ts', 'utf8');
const hud = await readFile('src/ui/GameHud.ts', 'utf8');
const game = await readFile('src/core/Game.ts', 'utf8');
const html = await readFile('index.html', 'utf8');

const assertions = [
  [config.includes('light3:'), 'The third light attack is missing.'],
  [config.includes('heavyChargeMax'), 'Charged heavy attack tuning is missing.'],
  [config.includes('executionImpactTime'), 'Execution timing is missing.'],
  [input.includes("'execute'"), 'Execution input is missing.'],
  [input.includes('isHeavyHeld'), 'Held heavy attack input is missing.'],
  [player.includes("this.startAttack('light3'"), 'The light combo finisher is not connected.'],
  [player.includes("this.action === 'heavyCharge'"), 'Heavy charge state is missing.'],
  [player.includes('consumeExecutionImpact'), 'Execution impact event is missing.'],
  [visual.includes("state === 'light3'"), 'Light finisher animation is missing.'],
  [visual.includes("state === 'execute'"), 'Execution animation is missing.'],
  [sentinel.includes('createCharacterController'), 'Sentinel terrain collision controller is missing.'],
  [hound.includes("'bite' | 'pounce'"), 'Hound attack identity is missing.'],
  [combat.includes('new AshenHound'), 'Hound enemies are not connected to combat.'],
  [combat.includes('handleExecution'), 'Execution routing is missing.'],
  [audio.includes('postureBreak'), 'Posture-break audio is missing.'],
  [audio.includes('footstep'), 'Footstep audio is missing.'],
  [world.includes('RigidBodyDesc.dynamic'), 'Dynamic debris is missing.'],
  [world.includes('applyPlayerInfluence'), 'Player-to-debris physical influence is missing.'],
  [hud.includes('setCharge'), 'Charge HUD is missing.'],
  [html.includes('lock-target-poise-fill'), 'Enemy posture HUD is missing.'],
  [html.includes('execution-prompt'), 'Execution prompt is missing.'],
  [game.includes('new AudioDirector'), 'Audio director is not connected to the game.'],
];

for (const [condition, message] of assertions) {
  if (!condition) throw new Error(message);
}

console.log('Production Pass 3 combat, physics and presentation verification passed.');
