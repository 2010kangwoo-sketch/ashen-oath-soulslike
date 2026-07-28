# Ashen Oath

**Ashen Oath**는 별도 설치형 게임 엔진 없이 Three.js와 Rapier 3D로 제작하는 짧은 완결형 3D 소울라이크 게임입니다. 연습용 기술 데모가 아니라 시작 화면, 연결된 지역, 일반 적, 세 보스, 엔딩과 크레딧을 갖춘 실제 공개 작품을 목표로 합니다.

## 현재 상태

- Pass 0: 빌드·배포 기반 완료
- Production Pass 1: 출시 범위와 아트 방향 재설정, 이동·카메라·첫 지역 시각 기준 구축
- Production Pass 2: 체력·스태미나, 회피, 방어·패링, 록온과 기본 전투
- Production Pass 3: 장검 3연계, 차지 강공격, 자세 붕괴·처형, 물리 기반 적 이동과 전투 음향
- Production Pass 4: 여성 서약지기 리그, 얼굴 몸짓, 9개 머리카락 묶음의 관절형 2차 움직임
- Production Pass 5: 세 구역 연결, 서약석 3개, 지름길 3개, 사망·재화 회수·회복병, 일반 적 4종과 정예 2종
- Production Pass 6: 첫 보스 문지기 바르칸, 전용 경기장·안개문·2페이즈·방패 파괴·보스 UI
- Production Pass 7: 두 번째 보스 종을 삼킨 과부, 수직 경기장·천장 이동·파괴 가능한 종·직선 및 도넛형 레이드 기믹
- Production Pass 8: 최종 보스 재의 서약자, 3페이즈 검술·잔상·왕관 기믹, 재의 왕좌와 두 결말·크레디트
- Production Pass 9: 시작 화면·일시정지·자동 저장·이어하기, 그래픽·음량·카메라·조작 안내 설정
- Release Candidate Pass 10: 엔딩 저장·복귀, 브라우저 수명주기 보호, 접근성, 카메라 할당 최적화와 출시 회귀 검사
- Quality Assurance Pass 11: 화면 전환, 다중 카메라 충돌, 벡터 기반 방향 전환, 지역별 날씨·달빛·그림자와 단계형 성능 제어
- Quality Assurance Pass 12: Q·E·R 기술, 독립 쿨타임, 보스 카운터 다운, 과부 소환전과 3D 기술 이펙트
- Final Quality Pass 13: 이동 안전 지점 복구, 물리 누적 폭주 방지, 세 보스 경기장 경계, 게임패드 재연결과 실행 스크립트
- 현재 상태: 연결된 전 지역, 보스 3명, 두 결말과 저장·설정을 포함한 `1.0.0-rc.4` 최종 품질 후보

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
- `docs/PRODUCTION_PASS_10.md`
- `docs/PRODUCTION_PASS_11.md`
- `docs/PRODUCTION_PASS_12.md`
- `docs/PRODUCTION_PASS_13.md`
- `docs/FINAL_QA_MATRIX.md`
- `docs/RELEASE_VALIDATION.md`
- `docs/TEN_PASS_ROADMAP.md`

## 실행

GitHub Pages에서는 브라우저로 바로 실행합니다. 로컬 실행에는 Node.js 20.19 이상 또는 22.12 이상이 필요합니다.

가장 간단한 방법은 저장소 폴더에서 다음 스크립트를 실행하는 것입니다.

```powershell
.\run-game.ps1
```

직접 실행하려면 다음 명령을 사용합니다.

```powershell
npm install
npm run start
```

검증:

```powershell
npm run verify
```

## 현재 조작

- 화면 클릭: 마우스 시점 고정
- `WASD` 또는 왼쪽 스틱: 이동
- `Shift`: 질주
- `Space`: 회피
- 마우스 왼쪽: 약공격 3연계
- `Shift + 마우스 왼쪽` 누르기·놓기: 차지 강공격
- 마우스 오른쪽 유지: 방어
- `Q`: 재의 보법
- `E`: 서약 반격·보스 카운터
- `R`: 잿불 원무
- `Tab` 또는 마우스 가운데 버튼: 록온
- `C`: 패링
- `F`: 처형·서약석 휴식·지름길 작동·최종 결말 선택
- `1`: 회복병 사용
- 마우스 이동 또는 오른쪽 스틱: 시점 회전
- `Esc`: 일시정지·설정 메뉴
- `H`: 조작 안내 숨김
- 메뉴: 방향키·왼쪽 스틱 이동, A 선택, B 뒤로가기, 좌우로 설정 조절
- `?debug` 주소에서만 `F3`: 개발 진단 표시
- `?debug` 주소에서만 `F8`: 개발용 전체 전투 초기화

설정에는 그래픽 품질, 음량, 카메라 충격, 마우스 감도 외에 움직임 감소, 공격 전조 강조와 UI 크기 조절이 포함됩니다.

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 타입 검사, 프로덕션 빌드와 차수별 검증을 실행한 뒤 GitHub Pages에 배포합니다. Pass 13에서는 비정상 이동 자동 복구, 물리 프레임 안전장치, 세 보스 경기장 경계와 입력 장치 재연결을 추가했습니다. 실제 완주와 브라우저별 체감 검증은 공개 전 수동 검증표에 따라 수행합니다.
