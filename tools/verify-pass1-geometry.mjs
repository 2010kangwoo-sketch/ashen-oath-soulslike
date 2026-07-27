import { readFile } from 'node:fs/promises';
import path from 'node:path';

const config = await readFile(path.resolve('src/config/GameConfig.ts'), 'utf8');
const world = await readFile(path.resolve('src/world/PrototypeWorld.ts'), 'utf8');

function numberAfter(source, label) {
  const match = source.match(new RegExp(`${label}:\\s*(-?\\d+(?:\\.\\d+)?)`));
  if (!match) throw new Error(`수치 항목을 찾지 못했습니다: ${label}`);
  return Number(match[1]);
}

const spawnMatch = config.match(/spawn:\s*\[\s*[-\d.]+,\s*([-\d.]+),/);
if (!spawnMatch) throw new Error('플레이어 시작 높이를 찾지 못했습니다.');
const spawnY = Number(spawnMatch[1]);
const radius = numberAfter(config, 'capsuleRadius');
const halfHeight = numberAfter(config, 'capsuleHalfHeight');
const controllerOffset = numberAfter(config, 'controllerOffset');
const capsuleBottom = spawnY - halfHeight - radius;
if (Math.abs(capsuleBottom - controllerOffset) > 0.001) {
  throw new Error(`시작 캡슐 바닥(${capsuleBottom})과 컨트롤러 간격(${controllerOffset})이 맞지 않습니다.`);
}

const riseMatch = world.match(/const rise = (\d+(?:\.\d+)?);/);
if (!riseMatch) throw new Error('계단 단차를 찾지 못했습니다.');
const stairRise = Number(riseMatch[1]);
const maxStepHeight = numberAfter(config, 'maxStepHeight');
if (maxStepHeight < stairRise || maxStepHeight - stairRise > 0.2) {
  throw new Error(`자동 오르기 높이(${maxStepHeight})가 계단 단차(${stairRise})에 비해 부적절합니다.`);
}

const platformMatch = world.match(/'stair-upper-platform', \[7\.2, (\d+(?:\.\d+)?), 6\.2\], \[stairX, (\d+(?:\.\d+)?),/);
if (!platformMatch) throw new Error('계단 상부 플랫폼 수치를 찾지 못했습니다.');
const platformHeight = Number(platformMatch[1]);
const platformCenterY = Number(platformMatch[2]);
const lastStairTop = stairRise * 9;
const platformTop = platformCenterY + platformHeight / 2;
if (Math.abs(lastStairTop - platformTop) > 0.001) {
  throw new Error(`마지막 계단 높이(${lastStairTop})와 플랫폼 높이(${platformTop})가 이어지지 않습니다.`);
}

const climbAngle = numberAfter(config, 'maxSlopeAngleDegrees');
const steepMatch = world.match(/degToRad\((\d+(?:\.\d+)?)\)/);
if (!steepMatch) throw new Error('급경사 시험 각도를 찾지 못했습니다.');
const steepAngle = Number(steepMatch[1]);
if (steepAngle <= climbAngle) {
  throw new Error(`급경사 시험면(${steepAngle}도)이 등판 제한(${climbAngle}도)보다 가파르지 않습니다.`);
}

console.log('Pass 1 geometry verification passed: spawn gap, stair step, platform continuity, blocked steep slope.');
