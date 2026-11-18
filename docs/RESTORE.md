# 복구 안내

## 1. 소스 복구

저장소를 복제한 뒤 Node.js 22.23.4 이상의 22.x에서 다음 순서로 설치합니다.

```bash
cd maple-core
npm ci
npm test

cd ../maplestarforce
npm ci
npm test
```

## 2. 환경 설정

저장소에는 공개 가능한 기능 플래그의 `.env.preview.example`과 `.env.production.example`이 있습니다. NEXON API 키 등 런타임 비밀값은 Cloudflare Pages의 Secret으로 별도 등록해야 합니다.

## 3. 빌드

```bash
cd maplestarforce
npm run build:preview
npm run build:production
```

운영 빌드는 장비 시세 대용량 자료를 제외합니다. 프리뷰에는 저장소에 포함된 활성 시세 릴리스 `1463d27e9e475640d240`를 사용할 수 있습니다. 기존 재현용 `22762152e065ef31aa1f`도 보존합니다. 과거 릴리스를 조회하거나 시세 자료를 다시 생성하려면 별도 백업 원본을 원래 경로에 복원해야 합니다.

장비 시세·스펙업 추천 웹 기능은 제거했습니다. VM의 시세 수신·갱신 서비스는 `/home/ubuntu/mapleSite/maplestarforce`에서 유지합니다. `item_price_raw`, `tools/item-market-dataset/market-data`, `public/item-market`의 데이터와 서비스 비공개 설정은 복구 시 별도로 확인합니다. 시세 데이터는 계산기 앱 빌드에 포함하지 않습니다.

## 4. 대용량 자료

`backup-manifests/`에 기록된 SHA-256을 확인한 뒤 각 압축 파일을 명시된 원래 경로에 풉니다. 캐릭터 식별정보가 든 연무장 원본은 공개 저장소나 공개 Release에 올리지 않습니다.

## 5. Cloudflare Pages

프로젝트명은 `starforce`, 빌드 디렉터리는 `maplestarforce/dist`입니다.

운영 배포는 GitHub의 `Starforce CI`에서 실행합니다. `main`의 테스트와 빌드가 통과하면 같은 실행에서 만든 결과물과 같은 커밋의 Pages Functions를 사용합니다. 다시 배포하려면 GitHub Actions에서 `main`을 선택해 `Starforce CI`를 실행합니다.

GitHub `production` 환경에는 `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`이 필요합니다. 브라우저에서 사용하는 대장장이 API 주소는 저장소 변수 `VITE_INBOX_API_BASE`에 설정합니다. 저장소 변수 `STARFORCE_PRODUCTION_ENABLED`를 `true`로 설정하면 운영 배포를 실행합니다.
