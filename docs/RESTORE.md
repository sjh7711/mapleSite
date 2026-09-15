# 복구 안내

## 1. 소스 복구

저장소를 복제한 뒤 Node.js 22.12.0 이상에서 다음 순서로 설치합니다.

```bash
cd maple-core
npm ci
npm test

cd ../maplestarforce
npm ci
npm test
```

## 2. 환경 설정

저장소에 포함된 `.env.preview`와 `.env.production`에는 공개 가능한 기능 플래그만 있습니다. NEXON API 키 등 비밀값은 저장소에 없으며 Cloudflare Pages의 Secret으로 별도 등록해야 합니다.

## 3. 빌드

```bash
cd maplestarforce
npm run build:preview
npm run build:production
```

운영 빌드는 장비 시세 대용량 자료를 제외합니다. 프리뷰에는 저장소에 포함된 활성 시세 릴리스 `22762152e065ef31aa1f`를 사용할 수 있습니다. 과거 릴리스를 조회하거나 시세 자료를 다시 생성하려면 별도 백업 원본을 원래 경로에 복원해야 합니다.

## 4. 대용량 자료

`backup-manifests/`에 기록된 SHA-256을 확인한 뒤 각 압축 파일을 명시된 원래 경로에 풉니다. 캐릭터 식별정보가 든 연무장 원본은 공개 저장소나 공개 Release에 올리지 않습니다.

## 5. Cloudflare Pages

프로젝트명은 `starforce`, 배포 디렉터리는 `maplestarforce/dist`입니다. 배포 전 반드시 해당 환경의 빌드와 전체 테스트를 실행합니다.
