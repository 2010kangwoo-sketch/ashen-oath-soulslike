# Ashen Oath

설치형 게임 엔진 없이 제작하는 브라우저 기반 3D 소울라이크 데모입니다. 이 저장소는 10차 제작에 들어가기 전 기반 빌드이며, 현재는 렌더링·물리·빌드·배포 경로를 검증합니다.

## 현재 상태

- Pass 0: 기반 구축 완료
- 절차적 성역 장면
- Three.js 렌더링과 그림자
- Rapier 3D 물리 시험체
- GitHub Pages 자동 배포 워크플로
- 엄격 TypeScript 검사와 프로덕션 빌드 검증

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

## 조작

- 마우스 드래그: 시점 회전
- 마우스 휠: 확대·축소
- R: 물리 시험체 재배치
- H: 안내 숨기기

## 문서

- `docs/FOUNDATION.md`: 기술 및 설계 기준
- `docs/TEN_PASS_ROADMAP.md`: 1차부터 10차까지의 범위

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 타입 검사와 빌드를 실행하고, 성공한 `dist`를 GitHub Pages에 배포합니다. `setup-github.ps1`가 저장소 생성과 Pages 설정을 함께 시도합니다. 권한상 자동 설정이 거절될 경우에만 저장소 Settings → Pages에서 Source를 GitHub Actions로 선택하면 됩니다.
