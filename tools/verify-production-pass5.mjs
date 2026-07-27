import { readFile } from 'node:fs/promises';

const requiredFiles = [
  'src/progression/ProgressionDirector.ts',
  'src/enemy/AshenSpearman.ts',
  'src/enemy/BellKeeper.ts',
  'src/combat/CombatDirector.ts',
  'src/player/PlayerController.ts',
  'src/world/CathedralApproach.ts',
  'src/player/AshenKnightVisual.ts',
  'docs/PRODUCTION_PASS_5.md',
  'docs/TEN_PASS_ROADMAP.md',
];

const contents = new Map();
for (const file of requiredFiles) {
  contents.set(file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
}

function requireTokens(file, tokens) {
  const source = contents.get(file);
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`Pass 5 requirement missing in ${file}: ${token}`);
  }
}

requireTokens('src/progression/ProgressionDirector.ts', [
  "id: 'gate'",
  "id: 'cloister'",
  "id: 'altar'",
  "id: 'west-portcullis'",
  "id: 'bell-chain'",
  "id: 'altar-seal'",
  'beginDeath',
  'recoveryAsh',
  'respawnAt',
  'resetAtRest',
  'refillFlasks',
]);

requireTokens('src/player/PlayerController.ts', [
  "PlayerAction = 'none'",
  "'heal'",
  'flaskCharges',
  'healImpactTime',
  'restAtCheckpoint',
]);

requireTokens('src/combat/CombatDirector.ts', [
  'new AshenSpearman',
  'new BellKeeper',
  'coordinateAttackSlots',
  'consumeAshReward',
  'ashReward',
  "'bell-warden'",
  "'oathbound-captain'",
]);

requireTokens('src/world/CathedralApproach.ts', [
  'createBellCloister',
  'createAshenAltar',
  'createReturnPassages',
]);

const visual = contents.get('src/player/AshenKnightVisual.ts');
const strandCount = (visual.match(/createHairStrand\(/g) ?? []).length - 1;
if (strandCount < 9) throw new Error(`Pass 4 heroine regression: expected at least 9 hair strands, found ${strandCount}`);

const input = await readFile(new URL('../src/input/InputController.ts', import.meta.url), 'utf8');
if (!input.includes("'interact' | 'heal'")) throw new Error('Context interaction and healing inputs are not defined.');
if (input.includes("consumeAction('execute')")) throw new Error('Obsolete dedicated execution input remains.');

const progression = contents.get('src/progression/ProgressionDirector.ts');
const shrineCount = (progression.match(/id: '(gate|cloister|altar)'/g) ?? []).length;
const shortcutCount = (progression.match(/id: '(west-portcullis|bell-chain|altar-seal)'/g) ?? []).length;
if (shrineCount !== 3) throw new Error(`Expected 3 authored shrines, found ${shrineCount}`);
if (shortcutCount !== 3) throw new Error(`Expected 3 authored shortcuts, found ${shortcutCount}`);

console.log('Production Pass 5 verification passed.');
