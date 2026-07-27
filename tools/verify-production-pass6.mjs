import { readFile } from 'node:fs/promises';

const requiredFiles = [
  'src/enemy/GatewardenVarkan.ts',
  'src/combat/CombatDirector.ts',
  'src/combat/CombatTypes.ts',
  'src/world/CathedralApproach.ts',
  'src/ui/GameHud.ts',
  'src/audio/AudioDirector.ts',
  'src/player/PlayerController.ts',
  'docs/PRODUCTION_PASS_6.md',
  'docs/TEN_PASS_ROADMAP.md',
  'index.html',
];

const contents = new Map();
for (const file of requiredFiles) {
  contents.set(file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
}

function requireTokens(file, tokens) {
  const source = contents.get(file);
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`Pass 6 requirement missing in ${file}: ${token}`);
  }
}

requireTokens('src/enemy/GatewardenVarkan.ts', [
  'class GatewardenVarkan',
  "'shieldRush'",
  "'shieldSlam'",
  "'bladeChain'",
  "'delayedOverhead'",
  "'frenzyChain'",
  "'leapSlam'",
  "'oathfireSweep'",
  "'crossCut'",
  'maxShieldIntegrity',
  'beginPhaseBreak',
  'breakShield',
  'RigidBodyDesc.dynamic()',
  'guardable: false',
  'parryable: false',
]);

requireTokens('src/combat/CombatDirector.ts', [
  'new GatewardenVarkan',
  'bossTriggerZ',
  'getBossSnapshot',
  'isBossEncounterActive',
  'isBossDefeated',
  'consumeBossPresentationEvent',
  'new THREE.Vector3(0, 3.2, -105.5)',
  'const activeEnemies: readonly CombatEnemy[]',
]);

requireTokens('src/world/CathedralApproach.ts', [
  'createBossArena',
  'setBossEncounterState',
  'bossFogCollider',
  'bossExitCollider',
  'varkan-arena-floor',
  'boss-threshold',
]);

requireTokens('src/ui/GameHud.ts', [
  'setBoss(',
  'boss-health-fill',
  'boss-shield-fill',
  'boss-phase-label',
  'boss-victory',
]);

requireTokens('index.html', [
  'id="boss-panel"',
  'id="boss-intro"',
  'id="boss-phase-banner"',
  'id="boss-victory"',
]);

requireTokens('src/audio/AudioDirector.ts', [
  'bossIntro()',
  'bossPhase()',
  'shieldBreak()',
  'bossDefeat()',
]);

requireTokens('src/player/PlayerController.ts', [
  'guardable = true',
  'parryable = true',
]);

const bossSource = contents.get('src/enemy/GatewardenVarkan.ts');
const attackEventCount = (bossSource.match(/time: /g) ?? []).length;
if (attackEventCount < 15) throw new Error(`Expected at least 15 authored boss hit events, found ${attackEventCount}`);

const pulseFlags = contents.get('src/combat/CombatTypes.ts');
if (!pulseFlags.includes('readonly radial?: boolean')) throw new Error('Radial boss attack flag is missing.');

const worldSource = contents.get('src/world/CathedralApproach.ts');
if ((worldSource.match(/varkan-arena-/g) ?? []).length < 8) throw new Error('Boss arena composition is too sparse.');

console.log('Production Pass 6 verification passed.');
