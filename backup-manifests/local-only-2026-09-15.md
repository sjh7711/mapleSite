# 공개 GitHub 백업 제외 명세 — 2026-09-15

이 문서는 `mapleSite` 공개 저장소를 만들 때 의도적으로 제외한 로컬 자료를 기록합니다. 제외된 자료가 삭제됐다는 뜻은 아니며, 원본 작업공간에는 그대로 남아 있습니다.

| 원래 경로 | 약식 크기 | 공개 제외 사유 |
| --- | ---: | --- |
| `/home/ubuntu/maplestarforce/item_price_raw/` | 603MB | 대용량 경매장 수집 원본 |
| `/home/ubuntu/maplestarforce/tools/item-market-dataset/maple-auction_raw_*.jsonl` | 약 280KB | 수집 파이프라인 검증에 사용한 경매장 원본 표본 |
| `/home/ubuntu/maplestarforce/tools/item-market-dataset/market-data/` | 2.8GB | 대용량 캐시·과거 생성 결과. 사람이 검수한 `review.csv`만 Git에 포함 |
| `/home/ubuntu/maplestarforce/public/item-market/`의 과거 릴리스 | 약 388MB | 현재 릴리스에서 재생성 가능. 활성 릴리스만 Git에 포함 |
| `/home/ubuntu/maplestarforce/tools/battle-practice-dataset/raw/` | 157MB | 캐릭터명·OCID·리플레이·원본 피해량 포함 |
| `/home/ubuntu/maplestarforce/tools/battle-practice-dataset/generated/` | 66MB | 위 식별 자료에서 생성된 연구 스냅샷 |
| `/home/ubuntu/maple-ux-audit/profile-*/` | 약 49MB | Chromium 쿠키·기록 등 로컬 브라우저 프로필 |

`node_modules`, `dist`, `.wrangler`, `.artifacts`, 임시 캡처는 재생성 가능한 산출물이므로 표에서 생략했습니다. NEXON·Cloudflare·GitHub 키 같은 비밀값도 공개 저장소에 포함하지 않습니다.

식별정보가 포함된 연무장 자료를 원격 백업하려면 접근 권한이 제한된 별도 비공개 저장소나 암호화 객체 저장소를 사용해야 합니다.
