# 메이플 옥션 데이터 스키마 0.6

v0.6의 데이터는 세 층으로 나뉩니다.

1. 확장이 페이지 단위로 저장하는 `maple-auction.capture.v2` 원본
2. 원본의 매물 하나를 한 줄로 변환한 `maple-auction.normalized.v2` JSONL
3. 판매완료 행만 고른 학습 CSV

수집 진행 상태는 원본 데이터와 별도로 IndexedDB와 `manifests/` 상태 내보내기에 보관합니다.

## 페이지 JSONL과 `maple-auction.capture.v2`

`raw/maple-auction_page_YYYYMMDD-HHmmss_<장비명>_p<페이지>_<ID8>.jsonl`은 JSONL 컨테이너입니다. 파일의 한 줄은 아래 구조를 가진 한 페이지짜리 `capture.v2` JSON 문서입니다. 즉 JSON Schema는 파일 전체가 아니라 각 줄의 JSON 객체에 적용됩니다.

```json
{
  "schema_version": "maple-auction.capture.v2",
  "capture": {
    "batch_id": "page-capture-id",
    "captured_at": "2026-09-01T19:48:21+09:00",
    "extension_version": "0.8.6",
    "source_site": "https://auction.maplestory.nexon.com",
    "source_path": "/price",
    "viewer_world": null,
    "auction_group": null,
    "collection_mode": "catalog_sweep",
    "catalog": {},
    "query_task": {},
    "attempt": {},
    "daily_quota": {},
    "preset": {},
    "search_context": {
      "page_kind": "sold",
      "keyword": "마이스터링",
      "sort": "trade_date_desc",
      "page": 1,
      "limit": 60,
      "only_current_world": null,
      "price_search_key_present": true,
      "filter_search_applied": true,
      "filters": {},
      "raw_filters": {}
    },
    "result_summary": {
      "total_results": null,
      "total_pages": null,
      "current_page": 1,
      "has_next_page": null,
      "page_item_count": 60,
      "requested_page_limit": 60,
      "displayed_page_limit": 60,
      "site_search_usage": null,
      "page_signature": null,
      "boundary_keys": []
    },
    "collection_summary": {},
    "quality_warnings": []
  },
  "items": [],
  "integrity": {
    "algorithm": "SHA-256",
    "payload_sha256": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

정식 JSON Schema는 [`schemas/capture-v2.schema.json`](schemas/capture-v2.schema.json)입니다. 스키마가 허용하는 `collection_mode`는 다음과 같습니다.

| 값 | 의미 |
|---|---|
| `catalog_sweep` | 고정 카탈로그의 일반 순회 페이지 |
| `catalog_resume` | 실패·중단 뒤 재시도한 페이지 |
| `catalog_restart` | 재개 경계가 달라 현재 검색의 1페이지부터 새 sweep으로 다시 모은 페이지 |
| `current_page` | 구버전 수동 현재 페이지 캡처 호환값 |
| `preset_sequence` | 구버전 사용자 프리셋 캡처 호환값 |

자동 수집의 정상 경로는 `catalog_sweep`, `catalog_resume`, `catalog_restart`입니다. `preset`, `preset_index`, `preset_count`라는 이름은 이전 `capture.v2`를 계속 읽기 위해 유지합니다. 수집기는 `preset`에 사용자 프리셋 대신 공개 가능한 고정 작업 요약을 넣을 수 있고, 인덱스·개수는 `null`로 둡니다.

### `capture` 메타데이터

- `batch_id`: 페이지 안의 관측값을 묶는 캡처 식별자입니다. 파일 이름의 `ID8`은 일일 한도·복구 상태와 연결되는 `attempt_id`의 앞 8자입니다.
- `captured_at`: 시간대가 포함된 캡처 시각입니다.
- `catalog`: 카탈로그 버전과 대상 장비의 식별 근거입니다.
- `query_task`: 물리 검색 쿼리 ID, 단일 또는 그룹 카탈로그 ID 목록, 검색어·allowlist, 논리 레인, 우선순위와 공개 가능한 필터 요약입니다.
- `attempt`: 한도 예약과 해당 페이지 작업을 연결하는 시도 ID, sweep ID, 익명 한도 세션 ID, 사용 목적(`normal | recovery | normal_overflow`), 레인, 페이지, 재시도 횟수와 필요 시 재개 재시작 사유입니다. 전체 단계 이력은 수집기 상태에 있습니다.
- `daily_quota`: 해당 페이지를 수집할 때의 KST 날짜 및 일반·예비 한도 스냅샷입니다.
- `search_context`: 실제 주소와 화면에서 다시 읽은 판매 상태, 검색어, 정렬, 페이지 크기, 월드 범위, 상세 필터입니다.
- `quality_warnings`: 화면에서 확인할 수 없어 `null`로 둔 값이나 파싱 불확실성입니다.

`search_context.page_kind === "sold"`, 쿼리가 요구한 정확/부분검색 방식, `trade_date_desc`, 예상 페이지·크기·필터가 모두 맞아야 자동 카탈로그 결과로 확정합니다. `filters`는 정규화된 검색 조건이고 `raw_filters`는 허용 목록에 포함된 비민감 URL 값입니다.

### `result_summary`

| 필드 | 의미 |
|---|---|
| `total_results` | 화면에서 확인한 전체 결과 수. 알 수 없으면 `null` |
| `total_pages` | 화면에서 확인한 전체 페이지 수. 알 수 없으면 `null` |
| `current_page` | 실제 표시 중인 페이지 |
| `has_next_page` | 다음 페이지 존재 여부. 확인 불가 시 `null` |
| `page_item_count` | 실제로 찾은 매물 행 수 |
| `requested_page_limit` | 필터 검색 결과 화면에서 선택한 크기. 자동 수집은 60 고정 |
| `displayed_page_limit` | 사이트 UI가 표시한 크기. 자동 수집은 60을 확인해야 저장 |
| `site_search_usage` | 사이트가 화면에 보여 준 사용량·한도. 확인 불가 시 `null` |
| `page_signature` | 저장한 현재 페이지를 식별하는 비민감 서명 |
| `boundary_keys` | 과거 원본 호환과 페이지 진단을 위해 남기는 비민감 매물 키 |

세부 조건의 `필터 검색`으로 새 결과를 만든 뒤 결과 화면에서 `60개씩 보기`를 직접 선택합니다. 최종 결과 URL과 화면 표시가 모두 60인지 다시 확인하며, 실제 매물이 60개보다 적은 것은 정상입니다. `page_sweep.enabled=true`인 검색은 같은 검색 키·필터·정렬을 유지한 채 화면의 정확한 숫자 페이지 버튼을 눌러 후속 페이지를 순회하고 최대 500건에서 멈춥니다. 단일 페이지 정책만 첫 페이지로 완료합니다.

### `items[]`

각 항목에는 `observation_id`, `row_index`, `result_rank`, `matched_preset_ids`, `selection_channels`, `listing`, `item`, `raw_evidence`, `quality_warnings`가 들어갈 수 있습니다.

- `matched_preset_ids`: 필드명은 호환성을 위해 유지하며, `<catalog_id>:BASE_ANY`와 로컬 분류에서 실제 일치한 스타포스·잠재 프로필 식별자를 기록합니다.
- `selection_channels`: `baseline`, `starforce`, `main`, `allstat`, `hp`처럼 이 관측값이 속한 수집·분류 채널 목록입니다. 분류별 고잠재 검색은 `POT_ACCESSORY_STR_27_29`처럼 실제로 통과한 비중첩 구간 ID도 함께 기록합니다.
- `listing.listing_id`: 경매장 DOM이나 링크가 직접 제공한 네이티브 ID만 거래 ID로 신뢰합니다. 없으면 `null`입니다.
- `listing.listing_id_source`: 새 캡처는 `native` 또는 `unavailable`을 사용합니다. `derived`는 구버전 호환값이며 네이티브 ID로 취급하면 안 됩니다.
- `listing.listing_fingerprint`: 이름·가격·날짜·옵션 근거로 만든 비교용 SHA-256 지문입니다. 배치 간 유일성을 보장하지 않습니다.
- `listing.status`: `active | sold | expired | unknown`; v0.6 자동 수집은 `sold`만 정상 대상으로 삼습니다.
- `listing.price_meso`: 정밀도 손실을 피하기 위한 10진 숫자 문자열입니다.
- `item.catalog_id`: 151종 고정 카탈로그의 안정 식별자입니다. 접두어 부분검색으로 수집한 행도 정확한 표시명을 `allowed_names`에서 확인한 뒤 개별 장비 ID를 기록합니다. 잠재 전역 검색에서 발견한 카탈로그 밖 장비는 `null`이며, `item.name`과 `catalog_key`로 구분합니다.
- `item.base_level`, `required_level`, `required_level_reduction`: 장비 고유 레벨, 화면 요구 레벨, 감소량을 서로 분리합니다.
- `item.starforce`: `value`, `applicable`, `source`, `confidence`를 저장합니다. 화면 툴팁에서 확인한 값은 `source: "dom"`, `/tool-tip` API 응답의 구조화된 값은 `source: "api_response"`이며, 둘 다 `confidence: "confirmed"`입니다. 따라서 API의 `0`도 거짓값으로 버리지 않고 확인된 0성으로 보존합니다. 별 근거가 없지만 검증된 정확 범위 필터(`0~0성`, `23~23성`, `24~24성`)가 남은 경우 `source: "query_filter"`, `confidence: "inferred"`로 구분합니다. `25성 이상`은 정확값을 추론하지 않습니다. 강화 불가 장비는 `applicable: false`, 판독 실패는 `applicable: true|null`과 `value: null`입니다.
- `capture.search_context.price_search_key_present`: 세부 조건 제출 후 검색 키가 생성됐는지만 기록합니다. 키 문자열은 저장하지 않습니다.
- `capture.search_context.filter_search_applied`: 검색 키와 화면의 `필터 검색 결과` 표시가 함께 확인된 경우에만 `true`입니다.
- `item.stats.normalized`: 원본에서는 `false`이며 색상 토큰을 포함한 `lines`가 근거입니다.
- `profile_classification`: 수집된 검색 결과에서 로컬로 판정한 주스탯·올스탯·HP·제논 혼합·쿨감·크뎀·드롭/메소·미트라 프로필과 그 근거입니다.
- `raw_evidence`: 가격 원문, 표시명, 아이콘 식별 근거, 스탯·잠재 CSS/RGB처럼 재처리에 필요한 비민감 근거입니다. 페이지 전체 HTML을 뜻하지 않습니다.

선택적인 최상위 `integrity`는 `algorithm: "SHA-256"`과 64자리 소문자 `payload_sha256`로 무결성 필드를 붙이기 전의 페이지 문서를 검증합니다. 파일 전체 줄바꿈까지 포함한 해시는 IndexedDB의 대기 레코드가 별도로 사용합니다.

## 고정 카탈로그와 검색 쿼리

카탈로그 버전은 `tools/catalog.mjs`의 `CATALOG_VERSION`으로 관리합니다. 현재 고정 카탈로그는 장비 151종이며, 접두어 묶음·조건 병합과 전역 검색 35개를 적용한 실제 물리 검색은 185개입니다. 각 `CATALOG_ITEMS[]`에는 다음 메타데이터가 있습니다.

```text
id, name, priority, group, group_label, subgroup,
slot, slot_label, level, job_family, main_stats,
starforce_eligible, potential_eligible, potential_profiles,
hp_profile_eligible, all_stat_profile_eligible, xenon_profile_eligible,
accessory_profile_eligible, hat_profile_eligible, glove_profile_eligible,
mitra_attack_code, query_policy,
search_group_id, search_keyword, search_exact_match
```

`expandCatalogQueries()`가 만든 물리 검색 레코드는 다음 정책 필드를 가집니다.

```text
query_id, catalog_version, catalog_id, catalog_ids,
exact_name, search_keyword, search_group_id, allowed_names,
priority, group, slot, slots, level, levels,
sold_only, sort, exact_match, search_scope, progress_scope, display_name, page_limit_preference,
item_category_filter, equipment_subcategory_filter, result_category_path_filter,
starforce_min, starforce_max, price_min_meso, price_max_meso, potential_filter, page_sweep,
logical_lanes, selection_channels, post_classify_profiles
```

분류별 고잠재 쿼리의 `potential_filter`에는 서버에 입력하는 `minimum`과 로컬 저장 상한인 `maximum`이 함께 들어갑니다. `maximum=null`은 상한이 없는 마지막 구간입니다.

- `sold_only=true`, `sort=TRADE_DATE_DESC`, `page_limit_preference=[60]`는 자동 수집의 고정 불변식입니다. 마이스터링·마이스터 이어링·마이스터 숄더를 포함한 단일 장비 검색은 `exact_match=true`이고, 에테르넬·아케인셰이드·앱솔랩스 직업군 및 카루타 부위 접두어 검색은 `exact_match=false`입니다.
- 그룹 검색은 `catalog_id=null`이며 `catalog_ids`와 `allowed_names`를 함께 가집니다. 결과 표시명이 allowlist에 정확히 일치해야만 저장하며, 그 이름으로 실제 장비의 카탈로그 ID·부위·레벨·잠재 프로필을 후분류합니다.
- `search_scope=catalog_global`, `progress_scope=global`인 전역 검색은 35개입니다. 장비명을 비운 채 23성·24성·25성 이상을 조회하는 고성 검색 3개, 드롭·메획 장신구 검색 2개, 장신구·방어구의 주스탯/올스탯 구간 검색 30개로 구성됩니다. 고성 검색은 스타포스가 가능한 카탈로그 139종의 정확한 이름을 allowlist로 사용하며 카탈로그 밖 결과는 제외합니다. 잠재 전역 검색은 카탈로그 여부와 관계없이 결과를 저장합니다. 전역 검색은 전체 185개 물리 검색 진행도에는 포함되지만 개별 장비의 완료 조건으로 중복 집계하지 않습니다.
- 고잠재 검색은 경매장 필터에 구간 최소값을 입력한 뒤 구조화 툴팁의 선택 스탯+올스탯 합계와 `category_path`의 정규화된 장비 분류를 다시 검사합니다. 장신구는 27~29%/30~32%/33% 이상, 방어구는 27~29%/30~32%/33~35%/36% 이상으로 서로 겹치지 않게 저장하고, 올스탯은 두 분류 모두 21% 이상을 별도 수집합니다.
- 드롭·메획 전역 검색 2개에서 수집한 잠재 줄은 반지·펜던트·얼굴장식·눈장식·귀고리에 한해 메획 40%, 드롭 40%, 메획 20%+드롭 20%, 메획 20%, 드롭 20%의 5개 목표로 로컬 후분류합니다. 어깨장식은 방어구이므로 대상에서 제외합니다.
- 표준 기본 검색 54개는 스타포스 0성 이상·잠재 필터 없음에 `price_min_meso=50000000`을 적용하고, 0성 및 17성 이상 검색으로 표본을 보강합니다. 세 검색 모두 `page_sweep`으로 결과 끝 또는 500건까지 수집합니다. 가격 하한 때문에 5,000만 미만 거래는 기본 표본에서 의도적으로 제외되므로 모델·통계에서 절단 표본임을 고려해야 합니다. 정확 0성·17성 이상·서버 잠재·전역 검색에는 하한이 없습니다. 창세의 뱃지는 최근 첫 페이지 baseline 하나만 사용하며, 데아 시두스 이어링·고귀한 이피아의 반지·카오스 혼테일의 목걸이·매커네이터 펜던트는 스타포스 1성 이상 단일 물리 검색을 사용합니다.
- `page_sweep={enabled:true,max_pages:9,result_cap:500}`인 검색은 최초 필터 검색이 발급한 검색 키를 유지한 채 페이지네이션의 목표 숫자 버튼을 직접 눌러 후속 페이지를 순회합니다. 실제 결과 끝이나 500건 상한에서 완료되며, 같은 페이지가 다시 수신되면 저장하지 않고 복구 대상으로 남깁니다. 중단 복구는 저장 직전 페이지의 숫자를 눌러 `continuation_anchor` 서명을 확인한 뒤 목표 페이지 숫자를 누릅니다. 서명이 없거나 달라지면 이전 sweep에 합치지 않고 1페이지부터 새 sweep으로 수집합니다. `page_sweep=null`은 첫 페이지만 저장합니다.
- 서버에서 검증되지 않은 잠재 프로필은 별도 URL을 만들지 않습니다. 같은 장비의 기본 물리 검색에 `logical_lanes`와 `post_classify_profiles`로 병합해 로컬에서 분류합니다.
- 같은 `query_id`를 공유하는 기본·로컬 전용 형제 레인은 해당 물리 검색이 완료되면 함께 완료됩니다. 따라서 프로필마다 동일 검색을 반복하지 않습니다. 첫 페이지가 0건인 결과만 빈 결과 backoff 뒤 다시 조사합니다.
- 같은 캡처 결과가 여러 논리 프로필에 해당하면 식별자와 선택 채널을 배열로 함께 보존합니다.

서버 잠재 필터의 `evidence_status`는 다음 네 값입니다.

| 값 | 의미 |
|---|---|
| `observed` | 현 사이트가 생성한 정상 필터 검색 URL에서 코드를 확인함 |
| `observed_ambiguous` | 현 사이트에서 관측했지만 다른 옵션을 포함하는 등 의미가 엄격하지 않음 |
| `legacy_unverified` | 구버전 매핑은 있으나 현 사이트에서 재검증 필요 |
| `local_only` | 검증된 URL 코드가 없어 툴팁에서만 분류 |

로컬 잠재 경계는 기본 레벨 0~200에서 주스탯·HP 21/30%, 올스탯 15/21%이고, 201 이상에서 각각 23/33%, 17/24%입니다. 제논은 STR·DEX·LUK·올스탯을 따로 보존하고, HP는 올스탯과 합산하지 않습니다.

## 수집기 상태 스키마

수집 상태는 매물 원본과 다른 내부 스키마 `maple-auction.collector-state.v1`입니다.

`lane_usage.normal`과 `lane_usage.reserve`는 `baseline`, `starforce`, `main`, `allstat`, `hp`, `hat`, `glove`, `accessory`, `mitra`, `audit` 키를 가집니다. 현재 일반 레인 우선 목표는 baseline 33회, starforce 28회, main 28회, allstat 2회, accessory 2회, mitra 5회이고 나머지는 0회로 총 98회입니다. 이 숫자는 한도 세션의 우선 목표이며 하드 상한이 아닙니다. 스케줄러는 먼저 목표가 남은 레인의 작업을 선택하고, 그런 작업이 없으면 완료되지 않았고 빈 결과 backoff 중도 아닌 다른 레인의 작업에 남은 일반 한도를 재배분합니다. 따라서 개별 `lane_usage.normal` 값은 계획보다 커질 수 있지만 일반 풀 전체는 98회를 넘지 않습니다. 실패 복구는 별도 `retries` 큐로 실패한 페이지를 최대 한 번 재시도합니다.

`quota_session`은 계정 이름을 저장하지 않는 익명 한도 세션입니다. 같은 KST 날짜에 사이트 검색 횟수가 안정적으로 낮아지거나 사용자가 **새 계정 동기화**를 누르면 새 세션을 만들고 `quota`와 레인 사용량만 현재 사이트 표시값으로 재기준화합니다. `query_stats`, 빈 결과 backoff, `retries`, 누적 합계는 유지합니다. 각 attempt의 `quota_session_id`로 이전 세션 예약이 새 세션 한도를 줄이지 않게 합니다. `quota.reserve_recovery_reserved`는 실제 복구 예약, `quota.reserve_borrowed_for_normal`은 복구 사용이 전혀 없을 때 예비 풀을 99·100번째 일반 검색에 사용한 횟수입니다. 새 계정에서 이미 사용한 99·100번째 검색처럼 목적을 알 수 없는 값은 예비 총사용량에는 반영하지만 복구로 표시하지 않습니다.

`query_stats` 또는 `retries`의 `next_eligible_reason`은 `failure`(수집 오류) 또는 `empty_result`(0건 결과)입니다. 두 상태는 같은 `next_eligible_date`를 사용하지만 **실패한 작업 모두 포함**은 `failure`만 해당 실행에서 선택 제한을 우회합니다. `empty_result`의 1·3·7·14일 backoff와 `next_eligible_at`의 시간 제한은 우회하지 않습니다. 구버전 상태에 사유가 없으면 연속 빈 결과, retry 표식과 실패 횟수로 사유를 추론합니다.

| 저장 위치 | 키 | 역할 |
|---|---|---|
| IndexedDB `maple-auction-jsonl` v2 / `settings` | 설정별 키 | 사용자가 허용한 `market-data` 폴더 핸들 등 |
| IndexedDB / `collector_state` | `primary` | KST 일일 한도, 레인 사용량, 시도, 60개 표시 검증, 페이지 복구 큐와 sweep 진행 상태 |
| IndexedDB / `page_captures` | `page_capture_id` | 파일로 커밋되기 전의 페이지 JSONL과 대상 파일 정보 |
| `chrome.storage.local` | `mapleAuctionCollectorCheckpointV1` | UI와 비상 확인을 위한 작은 체크포인트 미러 |

`collector_state.lease`에는 획득별 `lease_id`, 관리자 `owner`, `extension_version`, `manager_window_id`, `expires_at`을 기록합니다. 잠금은 실행 중 주기적으로 갱신하며, 상태·수신 페이지·커밋 페이지·잠금 해제 저장은 IndexedDB에 남은 `lease_id`가 현재 획득 토큰과 정확히 일치할 때만 수행합니다. 같은 버전의 유효한 다른 관리자 잠금은 건드리지 않으며, 확장 업데이트 전 버전의 잠금은 새 관리자에서 중단 체크포인트로 복구할 수 있습니다.

검색 시도 상태는 아래 순서로만 전진합니다.

```text
reserved -> requested -> received -> committed
```

- `reserved`: 요청 한도를 확보했지만 아직 사이트 요청 전입니다.
- `requested`: 요청이 시작되어 한도에 사용된 것으로 보수적으로 계산합니다.
- `received`: 전체 페이지 봉투와 상태를 IndexedDB에 함께 저장해 새 검색 없이 복구할 수 있습니다.
- `committed`: 페이지와 다음 체크포인트를 IndexedDB에 한 트랜잭션으로 확정했습니다. 대상 폴더 기록 여부는 `page_captures.file_status`가 별도로 나타냅니다.

`reserved` 단계만 요청 전 취소로 반환할 수 있습니다. 중단 복구 시 `received`는 재검색 없이 커밋하고, `requested`는 새 예비 예약으로 같은 페이지를 다시 요청합니다. 남아 있던 `reserved`는 사용하지 않은 한도를 반환한 뒤 스케줄러가 다시 예약하므로 검색 사용량은 늘지 않습니다.

`page_captures` 쓰기는 멱등적입니다. 대상 파일이 이미 같은 페이로드면 성공으로 확정하고, 같은 이름에 다른 페이로드가 있으면 덮어쓰지 않고 `_recovered_...` 이름으로 보존합니다.

**진행 상태 내보내기**는 `manifests/maple-auction_collector-state_<timestamp>_<ID8>.json`에 진단 스냅샷을 만듭니다. 이것은 페이지 원본이나 학습 입력을 대신하지 않습니다.

## `maple-auction.normalized.v2`

`normalized/`의 JSONL 한 줄은 매물 관측값 하나입니다. 페이지 공통 정보는 JSONL 특성상 각 줄의 `capture`에 반복됩니다. 정식 스키마는 [`schemas/normalized-v2.schema.json`](schemas/normalized-v2.schema.json)입니다.

주요 변환은 다음과 같습니다.

- `normalizer_version: "0.7.2"`
- `matched_preset_ids`와 `selection_channels`의 중복 제거·정렬
- `stats.normalized: true`
- 단위가 붙은 스탯 키: `str_flat`, `all_stat_pct`, `invincibility_seconds` 등
- 원천별 스탯: `base`, `starforce`, `scroll`, `flame`, `other`, `total`
- `stats.validation`에서 원천 합과 총합 검증
- 잠재 줄의 `line_index`, `tier`, `is_prime`, 복합 `params`
- `capture.collection_transport: "tooltip_api"`와 잠재의 `grade_source: "api_tooltip"`이 모두 확인된 API 캡처는 구조화된 `code`·`value`·`unit`·`params`를 그대로 보존
- 구형 DOM 캡처와 `raw.v1`은 과거에 저장된 구조화 값을 사용하지 않고 각 줄의 `raw`를 `normalizer 0.7.0`으로 재파싱
- 특수 잠재 `COOLDOWN_REDUCTION`, `STAT_PER_CHARACTER_LEVEL`, `AUTO_STEAL`, `HP_RECOVERY_ON_ATTACK`, `SKILL_AVAILABLE` 및 의미를 담는 `params` 보존
- 에디셔널 잠재 없음은 `grade: "none"`, 미수집은 `grade: null`
- 보정 내역은 `repair_changes`, 불확실성은 `quality_warnings`

```json
{
  "stats": {
    "normalized": true,
    "base": { "str_flat": 50, "attack_flat": 6 },
    "starforce": { "str_flat": 91, "attack_flat": 45 },
    "scroll": { "str_flat": 80, "attack_flat": 1 },
    "flame": { "str_flat": 72, "attack_flat": 5, "all_stat_pct": 5 },
    "other": {},
    "total": { "str_flat": 293, "attack_flat": 57, "all_stat_pct": 5 },
    "validation": { "all_component_sums_match": true, "lines": [] }
  }
}
```

## 학습 CSV와 중복 처리

`tools/build-training.mjs`는 `listing.status === "sold"`인 정규화 행만 출력합니다.

1. 네이티브 `listing_id`가 같은 행은 병합합니다.
2. 네이티브 ID가 없는 행은 `catalog_id/item_name + listing_fingerprint + sold_at + price_meso + world`가 같고 서로 다른 수집 시도에서 관측됐을 때만 fallback 중복으로 묶습니다.
3. fallback 그룹은 한 시도 안의 동일 행 개수 중 최댓값을 보존합니다. 따라서 한 결과 페이지에 실제로 여러 개 존재한 같은 가격·옵션 매물을 한 행으로 축소하지 않습니다.
4. 네이티브 ID나 안전한 fallback 키·query ID·attempt ID가 부족한 행은 별도 관측값으로 보존합니다.
5. 병합할 때 최초 보존 행의 값은 유지하고 `matched_preset_ids_json`, `selection_channels_json` 배열을 합칩니다.
6. `listing_fingerprint` 하나만 전역 중복 제거 키로 사용하지 않습니다.

`combat_power_change`, `price_raw`, 표시명, 아이콘 URL, 모든 원문 문자열, CSS/RGB, 디버그·복구·품질 필드는 CSV로 내보내지 않습니다. 판매자명·제작자명·쿠키·인증정보·세션·브라우저 저장소·전체 HTML은 어떤 데이터 계층에서도 수집 대상이 아닙니다.

## v1과 v2 호환성

| 항목 | `raw.v1` | `capture.v2` / `normalized.v2` |
|---|---|---|
| 파일 단위 | 매물당 JSONL 한 줄 | 원본은 페이지 봉투 한 줄, 정규화는 매물당 한 줄 |
| 공통 정보 | 모든 줄에 반복 | 원본 페이지 최상단, 정규화 시 각 줄에 반복 |
| 파생 ID | `listing_id`로 쓰인 경우 있음 | 별도 `listing_fingerprint`; 네이티브 ID가 아니면 `listing_id=null` |
| 스타포스 | 숫자 또는 모호한 null | 값·출처·신뢰도 |
| 레벨 | `level` 하나 | 기본·요구·감소 분리 |
| 스탯 | 색상 토큰과 불명확한 키 | 원천·단위별 정규화와 합 검증 |
| 잠재 | 단일 값 중심 | 줄 등급·프라임·복합 `params` |
| 에디 없음 | null로 섞일 수 있음 | 명시적인 `none` |
| 보정 | 원본을 수정할 위험 | 별도 normalized와 변경 이력 |
