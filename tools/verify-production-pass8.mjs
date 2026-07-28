import { readFileSync, existsSync } from 'node:fs';

const required = [
  'src/enemy/AshenOathkeeper.ts',
  'docs/PRODUCTION_PASS_8.md',
  'src/progression/ProgressionDirector.ts',
  'src/render/RenderPipeline.ts',
];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`Missing Pass 8 file: ${file}`);
}

const boss = readFileSync('src/enemy/AshenOathkeeper.ts', 'utf8');
const combatTypes = readFileSync('src/combat/CombatTypes.ts', 'utf8');
const progression = readFileSync('src/progression/ProgressionDirector.ts', 'utf8');
const world = readFileSync('src/world/CathedralApproach.ts', 'utf8');
const hud = readFileSync('src/ui/GameHud.ts', 'utf8');
const index = readFileSync('index.html', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const attacks = [
  'measuredCut', 'pursuitThrust', 'mirrorCounter', 'guardSever',
  'echoCross', 'shadowStep', 'ashSpiral', 'mirrorPunish',
  'crownRain', 'severedWorld', 'finalSequence', 'lastOath',
];
for (const attack of attacks) {
  if (!boss.includes(`'${attack}'`)) throw new Error(`Missing final boss attack: ${attack}`);
}
if (!boss.includes('phase: 1 | 2 | 3')) throw new Error('Final boss must expose three phases');
if (!combatTypes.includes("'phase3'")) throw new Error('Boss presentation must support phase3');
if (!progression.includes("'inherit' | 'sever'")) throw new Error('Both ending choices are required');
for (const id of ['ending-panel', 'ending-title', 'ending-credit-roll']) {
  if (!index.includes(`id="${id}"`)) throw new Error(`Missing ending UI element: ${id}`);
}
for (const token of ['createOathkeeperArena', 'oathkeeper-throne-dais', 'endingCore']) {
  if (!world.includes(token)) throw new Error(`Missing final arena token: ${token}`);
}
if (!hud.includes("event === 'phase3'")) throw new Error('HUD must present the third phase');
if (pkg.version !== '0.8.0-production-pass8') throw new Error(`Unexpected version: ${pkg.version}`);
console.log('Production Pass 8 verification passed.');
