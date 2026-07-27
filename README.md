# Ashen Oath

**Ashen Oath**는 별도 설치형 게임 엔진 없이 Three.js와 Rapier 3D로 제작하는 짧은 완결형 3D 소울라이크 게임입니다. 연습용 기술 데모가 아니라 시작 화면, 연결된 지역, 일반 적, 세 보스, 엔딩과 크레딧을 갖춘 실제 공개 작품을 목표로 합니다.

## 현재 상태

- Pass 0: 빌드·배포 기반 완료
- Production Pass 1: 출시 범위와 아트 방향 재설정, 이동·카메라·첫 지역 시각 기준 구축
- 현재 플레이 가능: 대성당 진입로 이동, 계단·경사·카메라 충돌, 키보드·마우스와 게임패드 입력
- 다음 작업: 회피, 방어, 패링, 체력·스태미나·자세 자원

## 출시 목표

- 첫 클리어 45~70분
- 하나로 연결된 지역 3구역
- 일반 적 4종, 정예 적 2종
- 고유 규칙을 가진 보스 3명
- 체크포인트·지름길·사망·재화 회수·저장·옵션·엔딩

자세한 기준은 다음 문서를 따릅니다.

- `docs/PRODUCTION_CHARTER.md`
- `docs/ART_DIRECTION.md`
- `docs/COMBAT_BOSS_BIBLE.md`
- `docs/TEN_PASS_ROADMAP.md`

## 실행

GitHub Pages에서는 브라우저로 바로 실행합니다. 로컬 실행에는 Node.js 20.19 이상 또는 22.12 이상이 필요합니다.

```powershell
npm install
npm run dev
```

검증:

```powershell
npm run verify
```

## 현재 조작

- 화면 클릭: 마우스 시점 고정
- 마우스 이동 또는 오른쪽 스틱: 시점 회전
- `WASD` 또는 왼쪽 스틱: 이동
- `Shift` 또는 게임패드 스틱 버튼/B: 질주
- 마우스 휠: 카메라 거리
- `Esc`: 마우스 시점 해제
- `R`: 시작 위치 복귀
- `H`: 조작 안내 숨김
- `F3`: 개발 진단 표시

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 타입 검사, 프로덕션 빌드와 차수별 검증을 실행한 뒤 GitHub Pages에 배포합니다.
