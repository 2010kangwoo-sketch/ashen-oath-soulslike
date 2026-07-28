import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const checks = [
  ['package pass version', read('package.json').includes('0.7.0-production-pass7')],
  ['game config pass', read('src/config/GameConfig.ts').includes('pass: 7')],
  ['widow trigger', read('src/config/GameConfig.ts').includes('widowTriggerZ')],
  ['boss abstraction', read('src/enemy/BossEnemy.ts').includes('interface BossEnemy')],
  ['widow boss', read('src/enemy/BellDevouringWidow.ts').includes('종을 삼킨 과부')],
  ['eight attack profiles', (read('src/enemy/BellDevouringWidow.ts').match(/windup:/g) ?? []).length >= 8],
  ['breakable bells', read('src/enemy/BellDevouringWidow.ts').includes('tryHitBell')],
  ['line attack shape', read('src/combat/CombatTypes.ts').includes("'line'")],
  ['donut attack shape', read('src/combat/CombatTypes.ts').includes("'donut'")],
  ['multi boss director', read('src/combat/CombatDirector.ts').includes('BellDevouringWidow')],
  ['widow arena', read('src/world/CathedralApproach.ts').includes('createWidowArena')],
  ['widow shrine', read('src/progression/ProgressionDirector.ts').includes('widow-nave')],
  ['vertical boss camera', read('src/camera/ThirdPersonCamera.ts').includes('verticalLockSpan')],
  ['raid mechanic hud', read('src/ui/GameHud.ts').includes('raidMechanic')],
  ['cinematic bloom', read('src/render/RenderPipeline.ts').includes('UnrealBloomPass')],
  ['pass document', read('docs/PRODUCTION_PASS_7.md').includes('종을 삼킨 과부')],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL: ${name}`);
  process.exit(1);
}
for (const [name] of checks) console.log(`PASS: ${name}`);
