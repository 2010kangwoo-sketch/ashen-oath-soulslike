# Ashen Oath

설치형 게임 엔진 없이 제작하는 브라우저 기반 3D 소울라이크 데모입니다. Three.js, TypeScript, Rapier 3D, Vite를 사용하며 10차에 걸쳐 짧지만 처음부터 끝까지 플레이 가능한 데모로 확장합니다.

## 현재 상태

- Pass 0: 렌더링·물리·빌드·배포 기반 구축
- Pass 1: 3인칭 플레이어 이동 구현
- 캡슐 충돌체와 Rapier 키네마틱 캐릭터 컨트롤러
- 카메라 기준 걷기·달리기와 부드러운 방향 전환
- 중력, 바닥 접지, 계단 자동 오르기, 완만한 경사 통과
- 급경사 차단과 벽 슬라이딩
- 장애물에 가까워지면 앞으로 당겨지는 3인칭 추적 카메라
- 이동 시험용 성역 장면
- GitHub Pages 자동 배포 워크플로

## 조작

- `W A S D`: 이동
- `Shift`: 달리기
- 마우스 왼쪽 또는 오른쪽 드래그: 시점 회전
- 마우스 휠: 카메라 거리 조절
- `R`: 시작 위치로 복귀
- `H`: 조작 안내 숨기기

## 로컬 실행

GitHub Pages 배포만 사용할 때에는 Unity나 다른 게임 엔진이 필요하지 않습니다. 로컬에서 직접 실행할 때만 Node.js 20.19 이상 또는 Node.js 22.12 이상이 필요합니다.

```powershell
npm install
npm run dev
```

프로덕션 검증:

```powershell
npm run verify
```

## 문서

- `docs/FOUNDATION.md`: 기술 및 설계 기준
- `docs/TEN_PASS_ROADMAP.md`: 1차부터 10차까지의 범위
- `docs/PASS_1_MOVEMENT.md`: 이동 수치, 검증 코스, 알려진 한계

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 타입 검사와 빌드를 실행하고, 성공한 `dist`를 GitHub Pages에 배포합니다.
