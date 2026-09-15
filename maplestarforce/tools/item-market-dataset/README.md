# 장비 시세 데이터 파이프라인

## 신규 경매장 RAW 적용 (0.7.7 이상)

크롬 확장 프로그램 0.7.7 이상이 만든 `maple-auction.capture.v2` 파일은 프로젝트 루트의
`item_price_raw/`에 넣습니다. 카탈로그 버전은 단순히 항목이 추가되어 달라져도
과거 `0.7.7+` 원본을 버리지 않습니다. 버전 접두사를 제외한 query ID가 현재
allowlist에 있고 가격·스타포스·잠재 등 실제 검색 계약까지 같을 때 호환 자료로
누적합니다. JSONL 파일 하나에는 한 페이지의
`capture.v2` 봉투를 정확히 한 줄만 넣으며, 여러 페이지 봉투를 한 파일로 합치지 않습니다.
과거 0.6.x 파일과 `maple-auction.raw.v1`은 새 시세 자료에 사용하지 않으며 자동으로
제외됩니다.

```bash
cd /home/ubuntu/maplestarforce
nvm use
npm run market:status
npm run market:check
npm run market:refresh
```

Node.js 20 이상이 필요하며 이 저장소의 `.nvmrc`는 현재 검증 버전인 22.12.0을 지정합니다.

- `market:status`: 신규 형식 파일 수와 현재 적용 버전을 확인합니다.
- `market:check`: 원본을 변경하지 않고 스키마, SHA-256, 검색 조건, 네이티브 거래 ID와
  매물 구조를 전부 검사합니다.
- `market:refresh`: 검사를 통과한 전체 신규 원본을 병합하고 네이티브 거래 ID로 중복
  제거한 뒤 비교매물 데이터를 갱신합니다.

검사 단계에서는 확장 프로그램·카탈로그 버전뿐 아니라 잠재 원문과 구조화 코드, 잠재 등급,
스탯의 `key/code/unit` 조합, 출처별 수치 합계도 대조합니다. 알 수 없는 잠재 줄은 원문과
함께 비교매물에는 보존하되 자동 학습 후보에서는 제외합니다.

페이지 순회 검색은 같은 `query_id + sweep_id`의 1페이지부터 자연 종료 또는 500건 제한까지
연속으로 있어야 적용됩니다. 아직 다음 페이지가 없는 중단 파일은 오류로 버리지 않고
`pending_chains`로 보류하며, 다음 raw가 들어오면 자동으로 이어 붙입니다. 단일 페이지 정책인
검색은 카탈로그 정의와 대조합니다. 순회 중 실시간으로 판매 완료 건수가 1건 변하는
경우는 허용하되, 개별 매물은 네이티브 거래 ID로 검증·중복 제거합니다.

같은 데이터 버전의 공개 manifest·catalog·장비 shard 또는 비공개 학습 산출물이 누락되거나
내용이 달라져도 `market:refresh`가 원본에서 결정적으로 다시 만들어 복구합니다.

기존 공개판에 쓰인 raw를 폴더에서 없애면 기본 적용은 중단됩니다.
`--replace`는 스키마·정규화 계약이 바뀌는 명시적인 대형 마이그레이션에서만 사용하며,
평소 카탈로그·확장 프로그램 수정에서는 사용하지 않습니다. 현재 폴더에 남아 있는
호환 raw는 `--replace`를 쓰더라도 카탈로그 버전만을 이유로 제외하지 않습니다.

비공개 학습 자료와 처리 원장은 `market-data/auction/` 아래에 버전별로 저장합니다.
브라우저에서 사용할 자료는 `public/item-market/releases/<dataset-version>/`에 새 버전으로
만들고, 모든 파일 생성이 끝난 뒤 `public/item-market/manifest.json`만 마지막에 교체합니다.
오류가 하나라도 있거나 적용 가능한 신규 파일이 없으면 기존 공개 자료는 바뀌지 않습니다.

- `auction-sold.jsonl/.csv`: 검증을 통과한 전체 실거래 비교매물
- `auction-model-ready.jsonl/.csv`: UNKNOWN 잠재, 스타포스 미확정, 스탯 미수집·합계 불일치를 제외한 학습 후보
- `state.json`: 적용 source SHA-256, 완료/보류 페이지 묶음, 품질 집계
- 공개 item shard: 식별자를 제거한 옵션별 실거래와 검색 표본 조건

기본 시세 검색의 5,000만 메소 하한을 비롯한 가격·스타포스·잠재 검색 조건은 각 매물의
`sampling_frames`에 남습니다. 가격 하한이 있는 표본은 그 가격보다 낮은 시세를 추정하는
데 사용하면 안 됩니다. 신규 자료는 비교매물에는 즉시 반영하지만, 자동 가격 모델은 시간
분할 검증을 별도로 통과하기 전까지 자동 교체하지 않습니다.

아래 사진/OCR 파이프라인은 과거 수동 자료를 위한 별도 도구이며 신규 경매장 RAW에는
사용하지 않습니다.

## 사진/OCR 자료 (별도 레거시 도구)

메이플스토리 장비 툴팁 사진을 이 VM에서만 처리해 검수 가능한 데이터로 만들고,
승인된 자료만 Cloudflare 정적 사이트에서 사용할 JSON으로 내보내는 도구입니다.

원본 사진, 파일 경로, OCR 원문은 공개 산출물에 포함하지 않습니다. OCR 결과를 바로
학습하지 않으며 `review.csv`에서 사람이 확인하고 `approved`로 바꾼 행만 사용합니다.

## 1. 사진 준비

가격을 파일명 앞부분에 적고 첫 `_` 뒤에 알아보기 쉬운 장비명을 붙입니다.

```text
photos/
  75억_데브펜01.jpg
  75.5억_데브펜02.png
  75억5000만_데브펜03.webp
  1000만_노작01.jpg
  7500000000메소_직접표기.jpg
```

`75.jpg`처럼 단위가 없으면 기본적으로 75억으로 해석합니다. 혼동을 피하려면 `억`,
`만`, `메소`를 붙이는 편이 좋습니다.

가격의 의미는 파일명이 아니라 명령의 `--price-kind`로 구분합니다.

- `listing`: 현재 등록된 판매 희망가
- `sold`: 실제 거래 완료가

두 종류는 같은 가격 모델에 섞지 않습니다.

## 2. 로컬 OCR 준비

Python 이미지 의존성은 현재 VM에 설치되어 있습니다. 다른 VM에서 옮겨 사용할 때는
다음 명령으로 준비합니다.

```bash
python3 -m pip install -r requirements.txt
```

현재 코드는 Tesseract가 있으면 한국어·영어 OCR을 사용하고, 없으면 사진과 가격만
정리한 뒤 `pending_manual`로 남깁니다. Ubuntu에서 필요한 최소 패키지는 다음입니다.

```bash
sudo apt-get install tesseract-ocr tesseract-ocr-kor tesseract-ocr-eng
```

OCR은 보조 수단입니다. 별 개수, 잠재 옵션, 색상별 작·추옵 분해는 오인식될 수 있으므로
반드시 사진을 보며 검수해야 합니다.

## 3. 사진 불러오기

```bash
cd /home/ubuntu/maplestarforce/tools/item-market-dataset

python3 item_market_pipeline.py ingest ./photos \
  --out ./market-data \
  --price-kind listing \
  --observed-at 2026-09-01 \
  --auction-group 1
```

생성 파일:

- `records.raw.jsonl`: 자동 인식 원본. 재실행해도 기존 행을 덮어쓰지 않습니다.
- `review.csv`: 사람이 수정하는 검수 파일입니다.
- `errors.csv`: 잘못된 가격명, 손상 이미지, 동일 사진 가격 충돌 목록입니다.

노작값은 별도로 이중 관리하지 않고 사이트의 `src/calc.js`에 있는 스타포스
`EQUIPMENT_PRESETS.price`를 기본값으로 읽습니다. 예를 들어 데이브레이크 펜던트는
`daybreak-pendant` 프리셋과 연결되어 현재 스타포스 기본값 0.15억을 사용합니다.
툴팁의 정식 장비명과 스타포스 프리셋 ID 연결은 `starforce_preset_aliases.json`에서
관리합니다.

특정 수집분만 다른 노작값을 써야 할 때에만 `reference_prices.csv`에 날짜와 함께 적고
`--reference-prices ./reference_prices.csv`를 명시합니다. 이 선택적 값은 스타포스
기본값보다 우선하지만, 사진 관측일보다 미래인 값은 적용되지 않습니다.

Tesseract 없이 폴더만 먼저 정리하려면 다음처럼 실행할 수 있습니다.

```bash
python3 item_market_pipeline.py ingest ./photos \
  --out ./market-data \
  --price-kind listing \
  --observed-at 2026-09-01 \
  --ocr none
```

## 4. 검수

`review.csv`에서 자동 인식값을 사진과 비교해 수정합니다. 최소한 다음 항목은 사람이
확정해야 합니다.

- `item_name`, `starforce_preset_id`, `starforce`
- 작 횟수와 작으로 붙은 공·마 및 주스탯
- 추옵과 윗잠·에디 3줄
- 교환 상태와 가위 횟수
- `listing`인지 `sold`인지, 관측일과 옥션 그룹

수치가 없는 항목도 빈칸으로 두지 않고 `0`을 입력합니다. 잠재나 에디가 전혀 없다면
등급을 `없음`으로 적고 해당 3줄만 비웁니다. 그 외 등급은 옵션 3줄을 모두 적어야 승인
검증을 통과합니다.

OCR에서 장비명을 직접 수정했거나 스타포스 프리셋을 수동으로 골랐다면 검증 전에
노작 기본값을 다시 채울 수 있습니다.

```bash
python3 item_market_pipeline.py sync-prices ./market-data/review.csv
```

확인이 끝난 행만 `review_status`를 `approved`로 바꿉니다. 애매하거나 잘못된 사진은
`rejected`로 둡니다.

```bash
python3 item_market_pipeline.py validate ./market-data/review.csv
```

동일 파일의 재인코딩이나 거의 같은 스크린샷은 `duplicate_group_id`로 묶습니다. 삭제하지
않는 이유는 같은 장비가 다른 날짜와 가격으로 다시 등록될 수 있기 때문입니다. 학습 시에는
같은 그룹이 학습·검증 양쪽에 나뉘지 않습니다.

## 5. Cloudflare용 비교매물 내보내기

```bash
python3 item_market_pipeline.py export ./market-data/review.csv \
  --out ./market-data/public
```

결과는 다음처럼 버전 파일과 활성 manifest로 나뉩니다.

```text
comparables.v1.20260901.json
market-artifacts.json
```

공개 파일에는 승인된 구조화 옵션, 가격 종류, 관측일만 들어갑니다. 원본 사진, 로컬 경로,
OCR 원문, 검수자 메모는 제거됩니다. 초기 사이트에서는 이 비교매물 JSON의 유사도 가중
중앙값만 사용해도 됩니다.

## 6. 경량 가격 모델 학습

승인 자료가 충분히 쌓인 뒤 실행합니다. 기본 최소 표본은 가격 종류별 독립 이미지 그룹
20개입니다. 같은 장비를 여러 날짜에 반복 등록한 자료는 여러 행으로 보존하지만 한 그룹의
총 학습 가중치는 1개 표본과 같게 제한합니다.

```bash
python3 item_market_pipeline.py train ./market-data/review.csv \
  --out ./market-data/public/price-model.sold.v1.json \
  --price-kind sold
```

모델은 가격의 로그값을 대상으로 하는 작은 Ridge 회귀이며 JSON으로 저장됩니다. 이미지나
OCR 텍스트, 파일명은 특징값으로 사용하지 않습니다. 잠재·에디 3줄은 줄 순서와 무관한
정규화 옵션 묶음으로 특징에 포함합니다. 검증은 관측일 경계를 기준으로 학습 기간이 검증
기간보다 엄격히 앞서게 나누며, 경계 양쪽에 걸친 재등록 그룹은 검증에서 제외합니다.

표본이 적을 때 모델 숫자는 신뢰하면 안 됩니다. 처음에는 같은 아이템의 유사 실거래 가중
중앙값을 우선하고, 다음 조건이 충족될 때 회귀 모델을 보조값으로 사용하는 편이 안전합니다.

- 동일 장비 표본이 여러 성급·잠재 구간에 분포함
- 등록가와 실거래가가 구분됨
- 최신 기간을 따로 검증했을 때 오차가 허용 범위임

모델의 항목별 값은 실제로 분리된 현금 가치가 아니라 `추정 기여도`입니다.

## 테스트

```bash
python3 -m unittest discover -s tests -v
```
