# mapleSite

메이플스토리 기대값 계산 사이트와 관련 도구를 한곳에 보존하는 모노레포입니다.

## 구성

- `maplestarforce/`: Cloudflare Pages에 배포되는 웹사이트, Pages Functions, 테스트, 연구·수집 파이프라인
- `maple-core/`: 사이트가 사용하는 공용 기대값·스탯 환산 계산 엔진
- `chrome extension/maple-auction-diagnostic/`: 웹 경매장 자료 수집·진단용 Chrome 확장. 사이트 테스트가 사용하는 기존 상대 경로를 보존
- `research/ui-reference/`: UI 검토에 사용한 선별 캡처
- `backup-manifests/`: GitHub Release로 분리한 대용량 자료의 체크섬과 원래 경로

프리뷰 빌드 재현에 필요한 현재 장비 시세 릴리스 `22762152e065ef31aa1f`는 저장소에 포함하며, 과거 릴리스와 수집 원본은 일반 Git 이력에서 제외합니다.

## 설치와 검증

Node.js 22.12.0 이상을 사용합니다.

```bash
cd maple-core
npm ci
npm test

cd ../maplestarforce
npm ci
npm test
npm run build:production
```

`maplestarforce`는 `../maple-core`를 로컬 패키지로 참조하므로 두 디렉터리의 상대 위치를 유지해야 합니다.

## 공개 저장소에서 제외한 자료

다음 자료는 보안·개인정보 또는 저장소 크기 문제 때문에 일반 Git 이력에 넣지 않습니다.

- NEXON·Cloudflare·GitHub API 키와 로컬 인증정보
- `.env` 비밀 설정, Wrangler 로컬 상태, 브라우저 프로필
- 캐릭터명·OCID·리플레이 원본이 포함된 연무장 연구 원본
- `node_modules`, 빌드 산출물, 캐시처럼 다시 만들 수 있는 파일
- 대용량 경매장 원본·생성 데이터는 필요할 경우 체크섬이 붙은 GitHub Release 자산으로 분리

비밀값은 Cloudflare Secret 또는 배포 환경의 Secret으로 다시 설정해야 합니다. 저장소의 파일만으로 운영 비밀값을 복원할 수는 없습니다.

자세한 복구 순서는 [docs/RESTORE.md](docs/RESTORE.md)를 참고하세요.
