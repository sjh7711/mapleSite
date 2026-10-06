# Maple Starforce 경매장 시세 데이터 연동 가이드

다른 웹사이트에서 Maple Starforce의 장비별 판매 완료 거래 데이터를 읽고 갱신하는 방법입니다. 개발자는 하나의 고정 주소에서 장비 목록을 찾고, 필요한 장비의 JSON 파일을 내려받아 자신의 서비스에 저장할 수 있습니다.

문서 확인일은 **2026년 9월 30일**입니다. 이 문서는 거래 데이터 조회를 다루며, Maple Starforce의 적정가 추정 계산기는 별도로 연동해야 합니다.

## 시작 주소

**[시세 데이터 manifest.json](https://starforce-market-data.pages.dev/manifest.json)**

현재는 인증키 없이 `GET` 요청으로 읽을 수 있습니다. 다른 도메인의 브라우저에서도 읽을 수 있도록 CORS가 허용되어 있습니다. 파일 읽기와 장비 목록 검색을 조합하는 구조이며, 장비명을 쿼리로 전달하는 검색 API는 제공하지 않습니다.

```text
manifest.json          현재 버전과 장비 목록의 위치
  └─ catalog.json      장비명과 장비별 파일의 위치
       └─ items/*.json 해당 장비의 거래 목록
```

자동 연동에서는 **manifest 주소만 고정**하세요. 버전별 `catalog.json`과 장비 파일 주소는 응답에서 찾아야 합니다.

## 장비별 시세 확인하기

### 현재 버전의 장비 목록 열기

manifest에서 `catalog.file`을 확인합니다. 아래는 확인일 당시의 일부 필드입니다.

```json
{
  "schema_version": "maplestarforce.item-market.manifest.v1",
  "dataset_version": "1463d27e9e475640d240",
  "catalog": {
    "file": "releases/1463d27e9e475640d240/catalog.json"
  }
}
```

`catalog.file`은 **manifest.json의 URL을 기준으로 한 상대 경로**입니다. 실제 응답에는 파일 검증에 사용하는 `catalog.sha256`도 들어 있습니다.

```js
const catalogUrl = new URL(manifest.catalog.file, manifestUrl);
```

[예시 버전의 전체 장비 목록 열기](https://starforce-market-data.pages.dev/releases/1463d27e9e475640d240/catalog.json)

### 장비명으로 파일 찾기

장비 목록의 `items`에서 `name`이 일치하는 항목을 찾습니다. 브라우저로 살펴볼 때는 `Ctrl+F`로 장비명을 검색하면 됩니다.

```json
{
  "name": "가디언 엔젤 링",
  "file": "items/ccc67aedb40ca62d.json",
  "records": 1866
}
```

이 예시는 일부 필드만 보여 줍니다. `file`은 **catalog.json의 URL을 기준으로 한 상대 경로**입니다. manifest 주소나 도메인 루트를 기준으로 붙이면 잘못된 경로가 됩니다.

```js
const entry = catalog.items.find(item => item.name === "가디언 엔젤 링");
const itemUrl = new URL(entry.file, catalogUrl);
```

### 거래 목록 읽기

장비 파일의 `records` 배열에 가격과 옵션이 거래별로 들어 있습니다. 확인일 당시의 예시 링크입니다.

| 장비 | 예시 버전의 거래 수 | 장비 파일 |
| --- | ---: | --- |
| 가디언 엔젤 링 | 1,866 | [JSON 열기](https://starforce-market-data.pages.dev/releases/1463d27e9e475640d240/items/ccc67aedb40ca62d.json) |
| 루즈 컨트롤 머신 마크 | 2,234 | [JSON 열기](https://starforce-market-data.pages.dev/releases/1463d27e9e475640d240/items/8874d05ebd72c63d.json) |
| 거대한 공포 | 2,872 | [JSON 열기](https://starforce-market-data.pages.dev/releases/1463d27e9e475640d240/items/40a472e8fc9f1ca5.json) |

이 링크들은 특정 시점의 예시입니다. 오래된 버전은 계속 보존된다고 보장하지 않으므로 연동 코드에 고정하지 마세요.

## 파일과 필드 설명

### 버전과 최신성

| manifest 필드 | 의미 |
| --- | --- |
| `schema_version` | 파일 형식 버전 |
| `dataset_version` | 현재 거래 데이터 묶음의 버전 |
| `catalog.file` | 장비 목록의 상대 경로 |
| `catalog.sha256` | 장비 목록 파일의 내용 검증용 SHA-256 |
| `data.item_count` | 수집된 장비 종류 수 |
| `data.unique_sales` | 중복 제거된 전체 거래 수 |
| `data.sold_at_from` · `data.sold_at_through` | 포함된 거래의 시간 범위 |
| `data.captured_at_through` | 마지막 수집 시각 |
| `generated_at` | 현재 구현에서는 마지막 수집 시각을 사용하며, 서버 배포 시각을 뜻하지 않음 |

확인일 당시 공개본은 **192개 장비, 113,938건**입니다. 마지막 수집 시각은 **2026년 9월 22일 오전 3시 12분 20초 한국 시간**입니다. 숫자를 서비스에 고정하지 말고 manifest에서 읽어 표시하세요.

데이터는 수집·검증 후 묶음으로 반영됩니다. 사이트에 표시할 갱신 기준은 `captured_at_through`를 사용하고, 거래 시점은 각 행의 `sold_at`을 사용하세요.

### 장비 파일

| 필드 | 의미 |
| --- | --- |
| `schema_version` | `maplestarforce.item-market.item.v1` |
| `dataset_version` | manifest 및 catalog와 같은 버전이어야 함 |
| `item_name` | 장비명 |
| `summary` | 해당 장비의 건수·가격 분포·수집 범위 |
| `records` | 거래별 상세 자료 배열 |

catalog의 `entry.records`는 **숫자 건수**, 장비 파일의 `records`는 **배열**입니다.

### 거래 한 건

아래 필드는 `records`의 각 원소에 있습니다.

| 필드 | 의미 |
| --- | --- |
| `price_meso` | 판매 완료 가격. 메소 단위의 정수 문자열 |
| `sold_at` | 거래 시각. 시간대 정보가 포함된 날짜 문자열 |
| `sold_at_precision` | 거래 시각의 정밀도 정보 |
| `item.name` · `item.category` | 장비명과 부위 |
| `item.base_level` · `item.required_level` | 기본 레벨과 요구 레벨 |
| `item.starforce.value` | 스타포스 수치. `null`은 미확정이므로 0성으로 바꾸지 않음 |
| `item.starforce.applicable` · `confidence` | 스타포스 적용 여부와 확인 수준 |
| `item.upgrade.applied` · `remaining` · `recoverable` | 적용된 작 수·남은 강화 횟수·복구 가능한 횟수 |
| `item.upgrade.scroll_type` | 확인된 주문서 종류. `null`은 종류가 제공되지 않은 상태이므로 특정 작 방식으로 단정하지 않음 |
| `item.trade.state` | 거래 상태 코드 |
| `item.trade.scissors_remaining` · `scissors_total` | 남은 가위 횟수와 총횟수 |
| `item.stats` | 기본·스타포스·주문서·추옵 등 출처별 수치 |
| `item.potential` | 윗잠 등급과 옵션 목록 |
| `item.additional_potential` | 에디셔널 등급과 옵션 목록 |
| `sampling_frames` | 가격 하한·스타포스·잠재 등 이 거래가 수집된 검색 조건 |
| `evidence.observation_count` | 같은 거래를 관측한 횟수. 거래 건수로 다시 곱하지 않음 |
| `quality` | 미확인 옵션이나 수치 오류 등 품질 정보 |

가격을 DB에 저장할 때는 정수 문자열 또는 충분한 범위의 정수·정밀 숫자 타입을 사용하세요. JavaScript에서 큰 정수를 정확히 계산하려면 `BigInt`를 사용할 수 있습니다. **1억 메소 = 100,000,000 메소**입니다.

예를 들어 `"price_meso": "6666666666"`은 6,666,666,666 메소이며, 억 단위 소수 둘째 자리까지 표시하면 **66.67억**입니다. 첨부 예제의 `formatEok()`는 반올림한 표시값을 반환합니다.

### 잠재능력 옵션

`item.potential`과 `item.additional_potential`은 같은 형태입니다.

```json
{
  "grade": "legendary",
  "lines": [
    { "line_index": 1, "code": "ALL_STAT", "value": 9, "unit": "pct", "tier": "legendary", "is_prime": true, "params": {} },
    { "line_index": 2, "code": "STR", "value": 12, "unit": "pct", "tier": "legendary", "is_prime": true, "params": {} },
    { "line_index": 3, "code": "STR", "value": 9, "unit": "pct", "tier": "unique", "is_prime": false, "params": {} }
  ]
}
```

- `grade`: `none`, `rare`, `epic`, `unique`, `legendary` 등급 코드입니다. `null`은 미확인 값으로 취급합니다.
- `line_index`: 실제 옵션의 첫째·둘째·셋째 줄로, 1부터 시작합니다.
- `code`와 `unit`: 함께 읽어야 합니다. `STR + pct + 12`는 STR 12%, `STR + flat + 12`는 STR 12입니다.
- `unit`: `pct`는 %, `flat`은 고정 수치, `seconds`는 초, `level`은 레벨 단위입니다. `null`을 임의의 단위로 해석하지 마세요.
- `tier`, `is_prime`, `params`: 줄의 등급과 상위 등급 여부, 옵션 해석에 필요한 추가 정보입니다. 저장 시 보존하세요.
- `UNKNOWN` 또는 해석하지 못한 `code`는 구분해 보관하고, 임의로 다른 옵션에 합산하지 마세요.

올스탯과 주스탯을 같은 비율로 더할지, 공·마나 크리티컬 확률을 주스탯%급으로 환산할지는 별도 계산 로직의 영역입니다.

### 옵션 수치의 출처

`item.stats`는 `base`, `starforce`, `scroll`, `flame`, `other`, `total`로 구분됩니다. 예를 들어 `stats.scroll.attack_flat`은 주문서로 오른 공격력, `stats.flame.int_flat`은 추옵으로 오른 INT입니다.

전체 수치가 필요하면 `total`을 사용하세요. 이미 전체 합계를 나타내므로 다른 출처의 수치를 다시 더하면 중복됩니다. 빈 객체·누락된 키·`null`의 의미는 품질 정보와 함께 판단하고, 모두 정상적인 0으로 처리하지 마세요.

최종 수치만으로 사용한 주문서나 리턴스크롤 사용 여부가 확정되는 것은 아닙니다. 주문서 시세나 제작 비용을 추정하려면 별도의 판별이 필요합니다.

## 실행 가능한 연동 예제

[item-market-client.mjs](examples/item-market-client.mjs)를 함께 전달합니다. **Node.js 22 이상**에서 외부 패키지 설치 없이 실행합니다.

```bash
node examples/item-market-client.mjs "가디언 엔젤 링"
node examples/item-market-client.mjs "루즈 컨트롤 머신 마크"
```

전달용 묶음의 루트에서 실행하는 명령입니다. 저장소 루트에서 실행할 때는 경로 앞에 `docs/`를 붙이세요.

예제는 현재 버전을 자동으로 따라가며, HTTP 오류·SHA-256·파일 형식·버전·장비명·거래 건수를 확인합니다. CLI로 실행하면 요약과 거래 3건만 출력하고, 함수로 불러오면 전체 `records`를 제공합니다. 자동 동기화 스케줄이나 DB 저장은 상대 서비스에서 연결해야 합니다.

```js
import { loadMarketCatalog, loadEquipment, formatEok } from "./examples/item-market-client.mjs";

// 같은 동기화 작업에서는 같은 snapshot을 사용합니다.
const snapshot = await loadMarketCatalog();
const { data, manifest } = await loadEquipment("가디언 엔젤 링", { snapshot });

// 예시: 스타포스 17성인 거래만 선택합니다.
const sales = data.records.filter(row =>
  row.item.starforce.value === 17 &&
  row.item.starforce.confidence === "confirmed"
);

console.log(manifest.dataset_version);
console.log(sales.slice(0, 3).map(row => ({
  priceMeso: row.price_meso,
  priceEok: formatEok(row.price_meso),
  soldAt: row.sold_at,
  potential: row.item.potential,
  additional: row.item.additional_potential,
})));
```

이 필터는 17성 거래를 고르는 예시입니다. 해당 거래들에도 잠재·추옵·작 등 차이가 있으므로, 17성 조건만으로 적정가를 산출하지 마세요.

## 서비스에서 갱신하는 방법

다음은 연동 서비스에 권장하는 운영 방식입니다. 제공 서버의 확정된 갱신 주기나 호출 한도를 뜻하지 않습니다.

1. **1시간 간격으로 manifest를 확인**하고 `dataset_version`을 비교합니다. 같은 버전이면 거래 파일 다운로드를 생략합니다.
2. 새 버전이면 catalog를 받고, 필요한 장비 파일들을 임시 공간에 내려받습니다. 처음에는 동시 다운로드를 2~4개 정도로 제한하는 방식을 권합니다.
3. SHA-256, 파일 형식, 세 파일의 `dataset_version`, 장비명과 거래 건수를 검증합니다.
4. 필요한 자료가 모두 검증되면 활성 버전을 한 번에 전환합니다. 실패하면 이전에 정상 저장한 버전을 계속 사용합니다.
5. 장비 데이터는 **장비별 전체 교체**합니다. 이전 버전 뒤에 `records`를 그대로 붙이면 같은 거래가 반복됩니다.

공개 자료에는 원본 거래 ID가 없습니다. 공급 측에서 거래 ID로 중복을 제거한 결과이므로, 소비 측은 새 파일을 통째로 교체하는 방식을 권합니다. 옵션·가격·시각이 비슷하다는 이유로 서로 다른 거래를 임의로 합치지 마세요.

`manifest.json`은 현재 응답에서 `Cache-Control: no-store`, 버전별 파일은 장기 캐시 대상으로 제공됩니다. 장비 파일은 상대 서버에 캐시하고 방문자 요청마다 전체 데이터를 내려받지 않는 구조가 적합합니다.

구버전 파일에서 404가 발생하면 manifest를 다시 받아 **장비 목록부터 다시 시작**하세요. 여러 버전의 catalog와 장비 파일을 섞지 마세요. 네트워크 실패나 429·5xx는 짧은 간격으로 반복 요청하지 말고 시간을 두고 재시도하세요.

## 데이터 해석 기준

### 거래 내역과 적정가

`summary.observed_comparable_sample_price_meso`의 `min`, `q1`, `median`, `q3`, `max`는 **수집한 해당 장비 거래들의 가격 분포**입니다. 옵션과 검색 조건이 섞여 있으므로 특정 아이템의 적정가로 바로 사용하면 안 됩니다.

비교할 거래를 고를 때는 스타포스, 잠재·에디셔널, 추옵·작, 가위 횟수, 거래 시점을 함께 반영하세요. 판매 완료 자료이므로 현재 판매 중인 매물 목록이나 최저 등록가로 표현하지 마세요.

### 검색 조건과 품질

- `sampling_frames`에는 수집 당시의 검색 조건이 들어 있습니다. 예를 들어 가격 하한이 5,000만 메소인 표본만으로 그 아래 가격대까지 대표한다고 볼 수 없습니다.
- 검색 화면에서 설정한 잠재 조건의 의미가 확정되지 않은 기록도 있습니다. 옵션 조건은 `item.potential.lines`와 `item.additional_potential.lines`를 기준으로 다시 확인하세요.
- 자동 계산용 자료를 고를 때는 최소한 `quality.unknown_potential_lines === 0`, `starforce_unknown === false`, `stats_missing === false`, `stat_component_mismatch === false`를 확인하세요. 이 조건이 가격 추정의 정확성까지 보장하지는 않습니다.
- `observed_*` 품질 필드는 과거 관측 중 문제 발생 이력입니다. 현재 정리된 행의 품질을 나타내는 일반 필드와 구분해 보존하세요.
- 공개 거래 자료에는 월드별 구분 필드가 없습니다. 이 파일만으로 월드별 시세를 분리할 수 있다고 가정하지 마세요.

### 적정가 추정기 연동

manifest의 `model.estimator_policy`에는 계산에 사용하는 정책 값이 들어갈 수 있습니다. 이것만으로 적정가를 계산할 수 있는 것은 아니며, 옵션 환산과 비교매물 선택 등을 수행하는 계산 로직이 필요합니다.

우리 사이트와 동일한 추정가를 제공하려면 계산 로직을 별도로 공유하거나 계산 API를 마련해야 합니다. 정책 값까지 사용하는 서비스는 `dataset_version`이 같아도 manifest의 정책 내용이 바뀌었는지 함께 확인하세요.

## 자주 발생하는 연동 문제

| 증상 | 확인할 내용 |
| --- | --- |
| 장비 파일이 404로 응답함 | `entry.file`을 catalog URL 기준으로 조합했는지, 오래된 버전인지 확인 |
| 원하는 장비가 없음 | catalog의 실제 장비명과 수집 여부 확인. 검색 실패를 가격 0으로 처리하지 않음 |
| 가격이 억 단위와 다르게 보임 | `price_meso`는 메소 단위 문자열. 억 단위 표시는 100,000,000으로 환산 |
| 갱신할수록 거래 수가 비정상적으로 늘어남 | 이전 records에 추가하지 않고 새 파일로 교체했는지 확인 |
| 합계 스탯이 과하게 높음 | `stats.total`에 출처별 스탯을 다시 더했는지 확인 |
| JSON은 열리지만 분석이 실패함 | `UNKNOWN`, `null`, 품질 정보, 예상한 schema 버전 확인 |
| 파일 검증 실패 | 잘못된 버전 혼합 여부 확인. 파일 원문을 SHA-256으로 검증하며 JSON 재직렬화 후의 해시와 비교하지 않음 |

## 문의와 참고 자료

데이터 항목이나 연동 오류는 [apfhd159862@naver.com](mailto:apfhd159862@naver.com)으로 장비명, `dataset_version`, 요청한 파일 주소와 오류 내용을 보내 주세요.

- [현재 데이터 시작 주소](https://starforce-market-data.pages.dev/manifest.json)
- [Cloudflare Pages의 다른 도메인 접근 설정](https://developers.cloudflare.com/pages/configuration/headers/#cross-origin-resource-sharing-cors)
