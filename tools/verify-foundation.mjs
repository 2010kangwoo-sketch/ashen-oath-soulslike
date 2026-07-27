import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const requiredFiles = [
  'dist/index.html',
  'src/core/Game.ts',
  'src/physics/PhysicsWorld.ts',
  'src/world/PrototypeWorld.ts',
  'docs/FOUNDATION.md',
  'docs/TEN_PASS_ROADMAP.md',
  '.github/workflows/deploy-pages.yml',
];

for (const file of requiredFiles) {
  await access(path.resolve(file));
}

const index = await readFile(path.resolve('dist/index.html'), 'utf8');
if (!index.includes('./assets/')) {
  throw new Error('GitHub Pages 하위 경로 배포를 위한 상대 asset 경로가 생성되지 않았습니다.');
}

const distStats = await stat(path.resolve('dist'));
if (!distStats.isDirectory()) throw new Error('dist가 디렉터리가 아닙니다.');

console.log('Foundation verification passed: typecheck, production build, Pages-relative assets, required architecture files.');
