# 장비 시세 데이터와 서비스

장비 시세 웹페이지 및 스펙업 추천 기능은 제거했습니다.
시세 원본 수신·자동 갱신 서비스와 실행에 필요한 파싱·검증 코드는 유지합니다.

| 경로 | 자료 |
| --- | --- |
| `tools/item-market-dataset/market-data/` | 파싱·정규화 결과, 검토용 CSV, 기존 릴리스 및 모델 캐시 |
| `public/item-market/` | 별도 데이터 서비스에서 사용하는 JSON 및 버전별 릴리스 |
| `item_price_raw/` | 원본 JSONL |
| `tools/item-market-dataset/photos/` | 입력 이미지 |

`public/item-market/`는 계산기 앱 빌드의 공개 파일 복사에서 제외하므로 프리뷰 및 운영 앱에 배포되지 않습니다.
데이터 서비스는 기존처럼 독립적으로 동작하며 앱을 자동으로 배포하지 않습니다.

정리 과정에서 기존 11,186개 파일을 SHA-256으로 확인했고, 모두 원래 데이터 경로에 보존했습니다.
확인 내역은 `data/item-market/preservation-manifest.json`에 기록했습니다.
