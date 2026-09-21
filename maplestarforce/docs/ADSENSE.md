# AdSense 연결 준비

## 현재 배포 규칙

변경은 먼저 `preview` 브랜치에 배포한다. 운영 주소는 `https://starforce.pages.dev/`, 검토 주소는 `https://preview.starforce.pages.dev/`이다. Preview의 색인 제외 설정은 유지한다.

2026-09-16 사용자의 운영 배포 요청에 따라 Preview에서 검토한 광고 코드와 개인정보처리방침을 **운영에 반영했다**. 운영 고유 배포는 `https://5bfc39c2.starforce.pages.dev/`, Preview는 `https://6c319ef2.starforce.pages.dev/`이다. 계산기 6개 페이지의 `<head>`에 게시자 `ca-pub-9238104084479585`의 비동기 AdSense 스크립트를 1개씩 설치했다. 소개·개인정보처리방침·출처·시세·제출 도우미·404에는 광고 코드를 넣지 않았다. 운영의 시세 비활성 설정과 검색 색인 허용, Preview의 색인 제외 설정은 유지한다.

각 계산기의 본문과 좌측 메뉴에 `google-side-rail-overlap="false"`를 지정했다. Google 공식 사이드 레일이 이 영역을 덮지 않도록 하는 설정이며, 항상 좌우에 광고 2개가 노출된다는 뜻은 아니다. 계산기 입력을 바꿔도 `<head>`의 스크립트는 다시 삽입하지 않는다. [사이드 레일 보호 속성](https://support.google.com/adsense/answer/16531757?hl=en)

사용자가 삭제한 계산기 하단 사용 안내와 출처 페이지의 아이콘·게임 이미지, 직업별 어빌리티 자료, 권리 문의 섹션은 다시 추가하지 않는다.

## 계정 생성 후 연결

1. 운영자가 본인의 Google 계정으로 AdSense에 가입한다. 등록할 사이트는 운영 주소를 사용한다. 실제 수취인과 국가 정보를 입력하고 약관을 확인한다.
2. AdSense의 **계정 → 설정 → 계정 정보**에서 `pub-`로 시작하는 게시자 ID를 확인한다. 공개 게시자 ID만 전달하며 비밀번호나 인증 코드는 전달하지 않는다.
3. 계정이 제공하는 사이트 확인용 **메타 태그**와 **ads.txt 행**을 준비한다. 메타 태그에는 `ca-pub-…`, ads.txt에는 `pub-…` 형식이 사용된다. 계정의 실제 값을 복사해 사용한다.
4. 메타 태그와 ads.txt를 Preview에서 먼저 확인한다. 연결 메타 태그는 광고를 표시하지 않는다. 실제 광고 스크립트 도입은 동의 설정과 배치 검토 후 별도로 진행한다.
5. 사용자가 운영 반영을 요청한 뒤 운영 URL에서 읽히는지 확인하고 AdSense에서 사이트 확인·검토 요청을 진행한다. Preview에만 파일이 있다고 운영 사이트가 연결된 것으로 판단하지 않는다.

사용자가 전달한 실제 게시자 ID는 `pub-9238104084479585`이다. 홈페이지 `<head>`에 아래 확인 메타 태그를 추가하고, 루트 ads.txt를 Preview에서 먼저 제공한다.

```html
<meta name="google-adsense-account" content="ca-pub-9238104084479585" />
```

```text
google.com, pub-9238104084479585, DIRECT, f08c47fec0942fa0
```

확인 메타 태그는 홈페이지에만 둔다. 광고를 표시하거나 Google 광고 스크립트를 불러오지 않는다. 2026-09-16 사용자의 운영 반영 요청에 따라 검토한 변경을 `main`에 배포했다. 운영 홈페이지와 ads.txt의 실제 응답을 확인했으며, 고유 배포 주소는 `https://7c2f2cc9.starforce.pages.dev/`이다. 이후 사용자가 AdSense 관리 화면에서 절차를 진행했고, 2026-09-16 API 재조회에서 사이트가 `GETTING_READY`(심사 중)로 전환된 것을 확인했다.

## VM에서 AdSense 계정에 접근하는 방법

Search Console에 사용한 Google Cloud 서비스 계정(`…iam.gserviceaccount.com`)과 해당 키 JSON은 AdSense 인증에 사용할 수 없다. AdSense Management API는 서비스 계정을 지원하지 않으며 사용자 OAuth 인증을 요구한다. 같은 Cloud 프로젝트는 재사용할 수 있다. [AdSense 인증 공식 안내](https://developers.google.com/adsense/management/direct_requests)

1. 기존 Google Cloud 프로젝트에서 **AdSense Management API**를 사용 설정한다.
2. **Google Auth Platform**에서 앱 이름·지원 이메일 등 동의 화면 정보를 설정한다. 앱이 테스트 상태라면 실제 AdSense 계정을 테스트 사용자로 추가한다.
3. **클라이언트 → 클라이언트 만들기**에서 데스크톱 앱용 OAuth 클라이언트를 만들고 JSON을 내려받는다. VM의 `/home/ubuntu/.config/google/adsense-oauth-client.json`에 저장한다. 기존 서비스 계정 JSON은 그대로 보관한다.
4. OAuth 연결 프로그램이 제시하는 Google 로그인 페이지에서 AdSense 계정으로 로그인하고 요청한 접근에 동의한다. 클라이언트 JSON만 저장한 것으로 사용자 인증이 완료되지는 않는다.

초기 상태·수익 조회에는 `https://www.googleapis.com/auth/adsense.readonly` 범위를 사용한다. 사용자 인증 토큰은 공개 사이트·소스 저장소 밖에서 소유자만 읽을 수 있게 보관한다. 데스크톱 OAuth를 원격 VM에서 실행할 때는 브라우저의 로컬 콜백이 VM에 도달하도록 SSH 포트 전달 등을 구성해야 한다. 폐기된 인증 코드 복사 방식은 사용하지 않는다. [설치형 앱 OAuth 안내](https://developers.google.com/identity/protocols/oauth2/native-app)

2026-09-16 데스크톱 OAuth 클라이언트 JSON을 확인하고 VM 관리 도구 `/home/ubuntu/.local/share/maple-admin/adsense.py`를 준비했다. 사용자 Google 로그인·동의와 API 연결을 완료했으며, 별도 프로세스에서 저장한 토큰으로 다시 조회하는 검증도 통과했다. 계정은 `READY`, `starforce.pages.dev` 사이트는 최초 `REQUIRES_REVIEW`에서 최신 조회 시 `GETTING_READY`로 전환됐다. 사이트 승인 완료를 뜻하지 않는다. 인증 후 `python3 /home/ubuntu/.local/share/maple-admin/adsense.py status`로 상태를 조회한다. 토큰과 조회 결과는 `/home/ubuntu/.config/google/`에 0600 권한으로 보관한다. API로 계정·사이트 상태와 보고서를 조회할 수 있으나, 사이트 리소스에는 조회 메서드만 제공된다. 사이트 추가·확인·심사 요청은 AdSense 관리 화면에서 진행한다. [사이트 API 범위](https://developers.google.com/adsense/management/reference/rest/v2/accounts.sites)

## 반복 점검 명령

Node.js 22.12.0 이상에서 실행한다.

```bash
npm run adsense:check -- --publisher-id pub-9238104084479585 --expect-ad-code
npm run adsense:check -- --url https://starforce.pages.dev/ --environment production --publisher-id pub-9238104084479585 --expect-ad-code
```

`--publisher-id` 옵션으로 계정 일치 여부를 확인한다. `--json /tmp/adsense-report.json` 옵션으로 결과를 저장할 수 있다. 2026-09-16 운영 배포 점검은 33개 통과, 오류 0개, 개인정보 초안 확인 1개 대기였다. 이후 개인정보 본문을 정리한 Preview는 33개 통과, 오류 0개, 본문 확인 1개 INFO다. 문구의 초안 표시가 없어졌다고 전체 정책 검토나 동의 연동이 완료된 것으로 해석하지 않는다.

광고 코드가 연결된 운영·Preview에는 `--expect-ad-code`를 지정한다. 계산기 6개에 지정 계정의 스크립트가 `<head>`에 1개씩 있는지, HTTPS·async·crossorigin 설정이 맞는지 확인한다. 안내 페이지의 광고 제외 검사도 유지한다. 이 옵션 없이 Preview를 검사하면 기존과 같이 실행 코드가 없어야 통과한다. 광고 코드 운영 배포 후 정적 HTTP 검사는 42개 통과, 오류 0개, 개인정보 본문 확인 1개 INFO다.

- `PASS`: 검사한 기술 항목이 맞음.
- `FAIL`: 응답·형식·계정 정보 등의 수정이 필요함. 종료 코드 1.
- `PENDING`: 계정 미발급, 확인 정보 미설치, 개인정보 초안 등 확인할 항목이 남음.
- `INFO`: 자동으로 판단할 수 없는 항목.

이 도구는 HTML·텍스트만 읽고 광고 JavaScript를 실행하지 않는다. Google의 실제 접근, AdSense 계정 상태·승인, 콘텐츠 품질, 동의 관리, 자료 이용 권한을 판단하지 않는다. ads.txt는 권장 항목으로 표시한다. 기술 항목이 통과해도 신청 준비 전체가 끝난 것은 아니다.

## 비활성 장비 시세 주소

`VITE_ITEM_MARKET_ENABLED=false`인 빌드에서는 HTML과 시세 자료를 제외하고 `/item-market` 및 `/item-market/`를 홈으로 302 이동시킨다. 기능을 다시 켤 수 있으므로 임시 이동을 사용한다. Preview에서는 기존 시세 기능과 자료를 유지한다. 이 규칙은 빌드 결과의 `_redirects`에만 추가해 환경 간 설정이 섞이지 않게 한다.

## 운영자가 확인할 사항

- 문의처는 운영자의 개인 이메일이다. 임의의 보관 기간이나 자동 삭제 약속을 추가하지 않았다. 공개된 연락처와 실제 문의 처리 설명을 유지한다.
- 개인정보처리방침은 운영 `https://starforce.pages.dev/privacy/`에서 광고 스크립트 로딩과 정보 처리, 승인·동의 조건에 따른 광고 및 동의 철회 링크 제공을 안내한다. 광고 파트너·동의 설정과 실제 표시 동작은 계정 설정 및 사이트 승인 상태와 함께 확인한다.
- 공개 출처 페이지의 구성과 별개로, API·이미지·외부 자료의 광고 서비스 이용 조건은 확인해야 한다.

## 공식 안내

- [AdSense 계정 만들기](https://support.google.com/adsense/answer/7402253?hl=ko)
- [게시자 ID 찾기](https://support.google.com/adsense/answer/105516?hl=ko)
- [사이트 연결 방법](https://support.google.com/adsense/answer/7584263?hl=en)
- [ads.txt 안내](https://support.google.com/adsense/answer/12171612?hl=ko)
- [Google 광고 관련 개인정보 고지](https://support.google.com/adsense/answer/1348695?hl=ko)
- [Cloudflare Pages 리다이렉트](https://developers.cloudflare.com/pages/configuration/redirects/)

## 동의 메시지 점검 (2026-09-16)

AdSense API는 동의 메시지의 게시 상태·개인정보 URL·버튼 구성을 조회하거나 수정할 수 없다. 2026-09-16 사용자가 계정 화면에서 메시지가 **게시됨이며 starforce.pages.dev에 연결됨**을 확인했다. 이는 사용자의 화면 확인이며 API 조회 결과는 아니다. 개인정보 URL은 `https://starforce.pages.dev/privacy/`, 버튼은 3버튼 구성을 기준으로 실제 메시지 표시 시 추가 확인한다.

유럽 규정 메시지는 한국어를 지원하지 않으므로 기본 언어는 English (US) 등 영어로 유지한다. 사이트 본문은 한국어를 유지하며, 방문자의 기기 언어가 설정된 추가 언어와 일치하지 않으면 기본 언어로 메시지가 표시된다. 버튼은 Consent / Do not consent / Manage options 구성으로 확인한다. 사용자가 한국어 선택지가 없다고 알려왔으며 공식 지원 목록과 일치한다. [지원 언어](https://support.google.com/adsense/answer/10924669?hl=en-GB), [언어·버튼 설정](https://support.google.com/adsense/answer/10960768?hl=en-GB)

현재 운영과 Preview 모두 실제 광고 태그가 연결되어 있다. 개인정보 페이지에는 광고·CMP 태그를 넣지 않는다. 동의 철회는 승인된 사이트에서 Google이 제공하는 기본 링크를 사용한다. 계정에 메시지가 게시되어 있고 해당 사이트에 연결되어야 실제 메시지·철회 동작을 확인할 수 있다. API에서 자동 광고 `autoAdsEnabled=true`는 확인했지만 좌우 위치와 메시지 게시 상태는 제공되지 않는다.

운영·Preview 브라우저에서 광고 스크립트 HTTP 200과 실행을 확인했다. 운영 반영 후에도 공식 테스트 파라미터 `?fc=alwaysshow&fctype=gdpr`에서는 동의 창이 나타나지 않았고 Google 동의 API도 생성되지 않았다. 사용자 확인에 따른 메시지 게시·도메인 연결 상태와 실제 런타임 검사 결과를 구분한다. 운영 사이트는 2026-09-16 05:24 KST API 조회 시 GETTING_READY(심사 중)다. 미표시 원인을 심사 상태 하나로 단정하지 않으며, 사이트 승인·메시지 설정 반영 후 실제 동의·거부·철회 흐름을 다시 확인해야 한다. [Google 동의 메시지 점검 기준](https://support.google.com/adsense/answer/14660912?hl=en-GB)

광고 배치는 사용자 요청에 따라 PC 좌우의 공식 사이드 레일을 우선 검토한다. 위치는 AdSense의 광고 → 사이트 수정 → 오버레이 형식 → 고급 설정에서 '왼쪽 및 오른쪽'으로 지정한다. 본문 자동 삽입·앵커·전면 광고는 초기 제안에서 제외한다. 수동 광고 2개를 좌우에 동시에 고정하는 구현은 하지 않는다. 모바일 하단 수동 광고는 별도 광고 단위 ID가 필요하며 아직 설치하지 않았다. [좌우 위치 설정](https://support.google.com/adsense/answer/16242705?hl=en), [수동 고정 광고 규칙](https://support.google.com/adsense/answer/10734935?hl=en)
