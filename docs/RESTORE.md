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

`maplestarforce/.env.preview.example`과 `maplestarforce/.env.production.example`을 각각 `.env.preview`와 `.env.production`으로 복사해 환경별 기능 플래그를 설정합니다. NEXON API 키는 Cloudflare Pages의 Secret으로 등록합니다.

## 3. 빌드

```bash
cd maplestarforce
npm run build:preview
npm run build:production
```

기존에 공개한 장비 시세 릴리스 `22762152e065ef31aa1f`는 보관용입니다. 시세 자료를 재생성하려면 운영 호스트에서 별도로 보관하는 백업 원본을 복원합니다.

장비 시세·스펙업 추천 웹 기능은 제거했습니다. VM의 시세 수신·갱신 서비스는 `/home/ubuntu/maple-platform/mapleSite/maplestarforce`에서 유지합니다. `item_price_raw`, `tools/item-market-dataset/market-data`, `public/item-market`의 데이터와 서비스 비공개 설정은 복구 시 별도로 확인합니다. 시세 데이터는 계산기 앱 빌드에 포함하지 않습니다.

## 4. 대용량 자료

`backup-manifests/`에 기록된 SHA-256을 확인한 뒤 각 압축 파일을 명시된 원래 경로에 풉니다. 캐릭터 식별정보가 든 연무장 원본은 공개 저장소나 공개 Release에 올리지 않습니다.

## 5. Cloudflare Pages

프로젝트명은 `starforce`, 배포 디렉터리는 `maplestarforce/dist`입니다. 배포 전 반드시 해당 환경의 빌드와 전체 테스트를 실행합니다.
