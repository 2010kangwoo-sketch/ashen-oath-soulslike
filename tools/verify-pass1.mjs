import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const requiredFiles = [
  'dist/index.html',
  'src/core/Game.ts',
  'src/input/InputController.ts',
  'src/player/PlayerController.ts',
  'src/camera/ThirdPersonCamera.ts',
  'src/physics/PhysicsWorld.ts',
  'src/world/PrototypeWorld.ts',
  'docs/PASS_1_MOVEMENT.md',
  '.github/workflows/deploy-pages.yml',
];

for (const file of requiredFiles) await access(path.resolve(file));

const index = await readFile(path.resolve('dist/index.html'), 'utf8');
if (!index.includes('./assets/')) {
  throw new Error('GitHub Pages 하위 경로 배포를 위한 상대 asset 경로가 생성되지 않았습니다.');
}

const player = await readFile(path.resolve('src/player/PlayerController.ts'), 'utf8');
const camera = await readFile(path.resolve('src/camera/ThirdPersonCamera.ts'), 'utf8');
const world = await readFile(path.resolve('src/world/PrototypeWorld.ts'), 'utf8');
const game = await readFile(path.resolve('src/core/Game.ts'), 'utf8');

const requiredSignals = [
  [player, 'createCharacterController', 'Rapier 캐릭터 컨트롤러'],
  [player, 'enableAutostep', '계단 자동 오르기'],
  [player, 'enableSnapToGround', '바닥 스냅'],
  [player, 'setMaxSlopeClimbAngle', '경사 제한'],
  [camera, 'intersectObjects', '카메라 장애물 검사'],
  [world, 'stair-upper-platform', '계단 검증 코스'],
  [world, 'blocked-steep-slope', '급경사 검증 코스'],
  [game, 'player.fixedUpdate', '고정 시간 이동 갱신'],
];

for (const [source, token, label] of requiredSignals) {
  if (!source.includes(token)) throw new Error(`${label} 구현 표식을 찾지 못했습니다: ${token}`);
}

const distStats = await stat(path.resolve('dist'));
if (!distStats.isDirectory()) throw new Error('dist가 디렉터리가 아닙니다.');

console.log('Pass 1 verification passed: movement controller, stairs, slopes, camera collision, typecheck, build, Pages assets.');
