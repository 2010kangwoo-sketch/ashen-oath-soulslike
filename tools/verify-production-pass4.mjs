import { readFile } from 'node:fs/promises';

const requiredFiles = [
  'src/player/AshenKnightVisual.ts',
  'docs/PRODUCTION_PASS_4.md',
  'docs/TEN_PASS_ROADMAP.md',
];

for (const file of requiredFiles) await readFile(new URL(`../${file}`, import.meta.url), 'utf8');

const visual = await readFile(new URL('../src/player/AshenKnightVisual.ts', import.meta.url), 'utf8');
const requiredTokens = [
  'female-vowkeeper-production-rig',
  'HairJoint',
  'HairStrand',
  'createHairStrand',
  'updateHair',
  'updateFace',
  'leftForearm',
  'rightForearm',
  'leftShin',
  'rightShin',
  'speedAcceleration',
  'blinkTimer',
];

for (const token of requiredTokens) {
  if (!visual.includes(token)) throw new Error(`Pass 4 visual requirement missing: ${token}`);
}

const strandCount = (visual.match(/createHairStrand\(/g) ?? []).length - 1;
if (strandCount < 9) throw new Error(`Expected at least 9 authored hair strands, found ${strandCount}`);
if (!visual.includes("state === 'dodge'") || !visual.includes("state === 'heavyCharge'")) {
  throw new Error('Hair dynamics are not connected to combat states.');
}

console.log('Production Pass 4 verification passed.');
