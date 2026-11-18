# 스타포스 공통 스페어값 관리

- 관리 화면: `/admin/starforce-prices/`
- 로그인: `/admin/login/`
- 공개 기본 가격: `GET /api/starforce-prices`
- 운영과 프리뷰의 `STARFORCE_CONFIG`는 같은 D1 데이터베이스를 사용한다.
- 직접 입력한 개인 가격과 공유 링크에 저장된 가격은 공통 기본 가격 갱신으로 덮어쓰지 않는다.

## 빌드와 배포

1. D1에 `migrations/starforce-prices/0001_initial.sql`을 적용한다. 이미 적용한 DB는 재초기화하지 않는다.
2. 32바이트 이상의 암호학적 난수로 관리자 비밀번호를 생성한다. 사용자가 고른 짧은 비밀번호를 그대로 쓰지 않는다. 서버는 이 난수 비밀번호의 SHA-256 해시를 검증한다.
3. `STARFORCE_ADMIN_PASSWORD_HASH`를 **운영과 프리뷰 각각** Pages 암호화 Secret으로 등록한다. 비밀번호 원문·해시는 저장소, 로그, 명령행 인수에 넣지 않는다. `wrangler pages secret bulk <보호된 JSON 파일> --project-name starforce --env production`과 `--env preview`를 사용한다.
4. `npm run build:production` 또는 `npm run build:preview`를 **먼저** 실행하고 Pages를 배포한다. 빌드가 관리자 HTML을 `functions/_generated/starforce-admin-page.ts`로 옮기고 정적 배포 디렉터리에서 제거한다. 생성 파일은 버전 관리하지 않는다.

로컬 검증에는 `.dev.vars`의 `STARFORCE_ADMIN_PASSWORD_HASH`와 로컬 D1을 사용한다. 바인딩 타입을 갱신할 때는 로컬 Secret 이름도 설정한 상태에서 `wrangler types functions/starforce-admin-env.d.ts --include-runtime false --strict-vars false`를 실행한다.

## 접근과 갱신

관리 화면과 저장 API는 모두 서버 세션을 확인한다. 쿠키는 Secure, HttpOnly, SameSite=Strict이며 4시간 후 만료된다. 로그인은 IP별 15분에 10회까지 허용하고, 쓰기 요청은 같은 출처인지 검사한다. 동시에 여러 창에서 저장하면 이전 버전의 저장은 거절한다.

비밀번호 Secret을 교체하면 기존 세션도 무효화된다. 운영과 프리뷰에 새 해시를 각각 등록하고 재배포한다.

계산기는 처음 열 때와 창에 다시 포커스할 때(최대 분당 한 번) 공통 기본 가격을 확인한다. 같은 출처의 관리 화면에서 저장하면 다른 계산기 탭에도 갱신을 알린다. 요청 실패 시 마지막으로 받은 기본 가격을 유지한다. 상점 고정가 두 항목은 수정할 수 없다.

## 소울 에테르 가격

- 관리 메뉴의 **소울 에테르 가격** → `/admin/soul-ether-prices/`에서 1~4단계 가격을 억 메소 단위로 저장한다. 기존 관리자 로그인과 동시 수정 방지를 사용한다.
- 저장은 운영·프리뷰 공통 기본 가격에 적용한다. 소울 계산기의 직접 입력값과 공유 링크의 가격은 보존하며, **가격 초기화**는 최신 공통 기본 가격을 사용한다. 기존 저장본은 종전 기본 가격과 다른 값을 개인 가격으로 취급한다.
- 공개 조회는 `GET /api/soul-ether-prices`, 인증된 조회·저장은 `GET/PUT /api/admin/soul-ether-prices`다.
- 배포 전 `migrations/starforce-prices/0002_soul_ether_prices.sql`을 공통 설정 D1에 한 번 적용한다. 기존 스페어값·세션 테이블은 변경하지 않는다. 빌드 시 새 관리자 HTML도 서버 전용 모듈로 옮겨 정적 자산에서 제거한다.
