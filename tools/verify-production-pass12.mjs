import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'src/combat/CombatTypes.ts',
  'src/combat/CombatDirector.ts',
  'src/combat/CombatEffects.ts',
  'src/player/PlayerController.ts',
  'src/player/AshenKnightVisual.ts',
  'src/input/InputController.ts',
  'src/enemy/BossEnemy.ts',
  'src/enemy/GatewardenVarkan.ts',
  'src/enemy/BellDevouringWidow.ts',
  'src/enemy/AshenOathkeeper.ts',
  'src/enemy/AshenHound.ts',
  'src/ui/GameHud.ts',
  'docs/PRODUCTION_PASS_12.md',
  'docs/FINAL_QA_MATRIX.md',
];
for (const file of requiredFiles) if (!existsSync(file)) throw new Error(`Missing Pass 12 file: ${file}`);
const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const styles = read('src/styles.css');
const config = read('src/config/GameConfig.ts');
const input = read('src/input/InputController.ts');
const player = read('src/player/PlayerController.ts');
const visual = read('src/player/AshenKnightVisual.ts');
const combat = read('src/combat/CombatDirector.ts');
const effects = read('src/combat/CombatEffects.ts');
const bossInterface = read('src/enemy/BossEnemy.ts');
const varkan = read('src/enemy/GatewardenVarkan.ts');
const widow = read('src/enemy/BellDevouringWidow.ts');
const oathkeeper = read('src/enemy/AshenOathkeeper.ts');
const hound = read('src/enemy/AshenHound.ts');
const hud = read('src/ui/GameHud.ts');
const progression = read('src/progression/ProgressionDirector.ts');
const pkg = JSON.parse(read('package.json'));

if (pkg.version !== '1.0.0-rc.3') throw new Error(`Unexpected Pass 12 version: ${pkg.version}`);
if (pkg.scripts?.verify !== 'npm run typecheck && npm run build && node tools/verify-production-pass12.mjs') throw new Error('Pass 12 verify script is not active.');
if (!config.includes('pass: 12')) throw new Error('GameConfig is not marked as Pass 12.');
if (!index.includes('RELEASE CANDIDATE · 1.0.0-RC.3')) throw new Error('RC.3 title label is missing.');

for (const token of ['ashStep', 'oathCounter', 'cinderArc', 'cooldown: 6.5', 'cooldown: 10', 'cooldown: 15.5']) {
  if (!config.includes(token)) throw new Error(`Skill data is incomplete: ${token}`);
}
for (const token of ["KeyQ", "KeyE", "KeyR", "KeyF", "KeyC", "Digit1", "'skillQ'", "'skillE'", "'skillR'"]) {
  if (!input.includes(token)) throw new Error(`Input mapping is incomplete: ${token}`);
}
if (input.includes("if (event.code === 'KeyQ') this.pressedActions.add('lockOn')")) throw new Error('Q still conflicts with lock-on.');
for (const token of ['pendingSkillEvents', 'skillCooldowns', 'getSkillCooldowns()', "this.action === 'ashStep'", "this.action === 'oathCounter'", "this.action === 'cinderArc'", 'counterPower: 1']) {
  if (!player.includes(token)) throw new Error(`Player skill state machine is incomplete: ${token}`);
}
for (const token of ["state === 'ashStep'", "state === 'oathCounter'", "state === 'cinderArc'", 'trailColor = 0x7ee7ff', 'trailColor = 0xff8a45']) {
  if (!visual.includes(token)) throw new Error(`Skill animation presentation is incomplete: ${token}`);
}
for (const token of ['getCounterSnapshot()', 'receiveCounter()', 'consumeSummonRequest()']) {
  if (!bossInterface.includes(token)) throw new Error(`Boss combat contract is incomplete: ${token}`);
  for (const [name, source] of [['Varkan', varkan], ['Widow', widow], ['Oathkeeper', oathkeeper]]) {
    if (!source.includes(token)) throw new Error(`${name} is missing boss contract: ${token}`);
  }
}
for (const source of [varkan, widow, oathkeeper]) {
  if (!source.includes('counterDowned ? 1.5 : 1')) throw new Error('A boss is missing 1.5x counter-down damage.');
}
for (const token of ['summonedEnemies', 'spawnSummons(', 'deactivateSummons()', 'consumeSkillEvent()', 'counterSuccess()', 'summonedAdds']) {
  if (!combat.includes(token)) throw new Error(`Combat integration is incomplete: ${token}`);
}
if (!widow.includes("kind: 'broodling'") || !widow.includes('count: 3')) throw new Error('Widow summon pattern is missing.');
for (const token of ['activateSummonAt(', 'deactivateSummon()', "state = 'sealed'", 'ashReward = initiallySealed ? 0']) {
  if (!hound.includes(token)) throw new Error(`Summon pool safety is incomplete: ${token}`);
}
for (const token of ['spawnSkill(', 'spawnCounter(', 'spawnSummon(', 'MAX_SPARKS', 'MAX_RINGS']) {
  if (!effects.includes(token)) throw new Error(`3D effect pooling is incomplete: ${token}`);
}
for (const id of ['skill-ash-step', 'skill-oath-counter', 'skill-cinder-arc', 'boss-counter-window', 'boss-counter-fill', 'boss-add-count']) {
  if (!index.includes(`id="${id}"`)) throw new Error(`Missing Pass 12 HUD element: ${id}`);
}
for (const token of ['setSkills(', 'bossCounterWindow', 'summonedAdds', "ashStep: '재의 보법'"]) {
  if (!hud.includes(token)) throw new Error(`Skill/counter HUD integration is incomplete: ${token}`);
}
for (const token of ['.skill-bar', '.skill-slot', '.boss-counter-window', '.boss-add-count']) {
  if (!styles.includes(token)) throw new Error(`Pass 12 HUD CSS is missing: ${token}`);
}
if (progression.includes('`E  ${altar.name}`') || progression.includes('`E  ${shrine.name}')) throw new Error('Progression prompts still conflict with the E skill.');
const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
if (duplicates.length) throw new Error(`Duplicate HTML IDs: ${[...new Set(duplicates)].join(', ')}`);

console.log(`Production Pass 12 skills/counters/summons verification passed (${ids.length} unique HTML IDs).`);
