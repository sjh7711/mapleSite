# 직업별 연무장 데이터셋

이 폴더는 배포 코드와 분리된 조사 전용 작업공간입니다. 원본 닉네임,
리플레이 결과, 오류 로그는 `raw/`에 저장되며 웹 번들에는 들어가지 않습니다.

## 1. 정상 기록 수집

API 키는 명령행이나 파일에 쓰지 않고 실행 환경의 `NEXON_API_KEY`로만
전달합니다.

```bash
npm run battle-practice:collect -- \
  --samples=5 \
  --ranking-pages=5 \
  --seed-file=tools/battle-practice-dataset/seeds.example.json \
  --output=tools/battle-practice-dataset/raw/battle-practice-v2-all-jobs.jsonl
```

수집기는 종합 랭킹에서 직업별 후보를 찾고, 각 캐릭터의 최신 리플레이 중
`end_type=1`, `0 < total_play_time <= 400000`인 정상 자동 종료 기록만
저장합니다. 360초에 맞추거나 시간당 피해량으로 보정하지 않습니다. 새
원본(v2)은 `replayId`와 함께 연무장 입장 당시 `character-info`, 페이지를
끝까지 합친 `skill-timeline`도 저장합니다. 이를 통해 관측 피해 점유율에서
표본 캐릭터의 당시 방무·V/HEXA 상태를 제거하고 실제 사용 주기를 검증할 수
있습니다. 레거시 점유율만 필요할 때만 명시적으로 `--include-context=false`를
사용합니다.

수집한 정상 기록은 한 건마다 위 `--output` JSONL에 즉시 추가됩니다. 호출이
중단되면 같은 경로에 `--resume`을 더해 이미 완료한 직업·캐릭터는 건너뛰고
이어서 수집합니다. `--resume`과 `--overwrite`는 함께 사용할 수 없습니다.

```bash
npm run battle-practice:collect -- \
  --samples=5 \
  --output=tools/battle-practice-dataset/raw/battle-practice-v2-all-jobs.jsonl \
  --existing-input=tools/battle-practice-dataset/raw/기존-v2.jsonl \
  --resume
```

existing-input은 정상 v2 원본을 새 체크포인트에 먼저 복사합니다. 동일 replay는
한 번만 쓰고, 선택한 직업별 부족분만 목표 5명까지 새로 수집합니다.

## 2. 전 직업 스킬 사전

공식 스킬 API의 0·1·1.5·2·2.5·3·4·하이퍼 패시브·하이퍼 액티브·5·6차를
직업별 여러 캐릭터에서 합집합으로 수집합니다. 개발 키 호출량을 고려해
중간 결과를 매 캐릭터마다 체크포인트하며, 같은 출력 경로로 다시 실행하면
11개 차수가 모두 저장된 캐릭터는 건너뜁니다.

```bash
npm run skills:collect -- --samples=5
npm run skills:build
npm run skills:audit
```

전체 설명과 아이콘을 가진 조사 사전과, 계산에 필요한 방무·별칭·점유율만
남긴 경량 사전을 별도로 생성합니다. 공식 API는 정적 전체 카탈로그가 아닌
캐릭터 스냅샷이므로 표본 커버리지와 자동 파싱 검토 필요 여부도 사전에
기록합니다. 연무장의 파생 타격명은 공식 스킬명과 완전히 일치하거나 공식
설명·효과 한 곳에 이름이 그대로 적힌 경우에만 자동 연결합니다. 자세 변경·
강화 공격처럼 이름만으로 부모를 확정할 수 없는 항목은
`skill-alias-overrides-v1.json`의 검토된 매핑만 사용하며 접두어 유사도 추정은
사용하지 않습니다. 감사 게이트는 직업별 연무장 피해 점유율 99% 이상을
요구합니다.

## 3. 안정성 검사와 프로필 생성

외부 효율 검증값은 MapleScouter 화면을 실제 Chromium으로 열어 수집합니다.
직업을 명시하지 않으면 실행되지 않으며, 기본값은 직업당 상위 5명, 페이지
이동 사이 12~18초, 동일 캐릭터 7일 캐시입니다. 403·429 또는 CAPTCHA가
감지되면 즉시 전체 수집을 중단합니다.

```bash
npm run battle-practice:collect-efficiency -- \
  '--classes=렌|나이트워커' \
  --samples=5
```

여러 직업은 `|` 또는 `;`로 구분합니다. `아크메이지(불,독)`처럼 직업명
자체에 쉼표가 있기 때문에 쉼표 구분은 단일 직업명에만 사용합니다.
NEXON의 `듀얼블레이더`·`캐논마스터`는 MapleScouter 랭킹의
`듀얼블레이드`·`캐논슈터`로 자동 변환합니다.

랭킹 페이지는 직업당 한 번만 열고, 결과 페이지에서 `세부 스펙 효율` 탭을
실제 마우스 이벤트로 선택합니다. 화면의 입력 수치와 최종뎀 증가율을 함께
저장한 뒤 방무·보스 데미지·공/마·공/마%·크리티컬 데미지·올스탯%의
주스탯%급 검증 기준을 생성합니다. 서버 내부 API를 탐색하거나 호출하지
않습니다. 이미 저장한 원본은 사이트를 다시 열지 않고 아래 명령으로 검증
기준만 재생성할 수 있습니다.

```bash
node scripts/build-maplescouter-references.mjs \
  --input=tools/battle-practice-dataset/raw/원본.jsonl \
  --output=tools/battle-practice-dataset/generated/검증기준.json
```

기존 기준표와 새 기준표를 학습 표본과 겹치지 않게 합칠 때는 아래 명령을
사용합니다. 입력과 제외 목록은 JSON 배열·JSONL을 모두 지원합니다. 동일
캐릭터는 최신 수집본 하나만 남기며, 제외 후 직업당 5명이 안 되면 기준표를
만들지 않고 부족 내역을 보고서에 기록합니다. 데몬어벤져는 기본 제외됩니다.

```bash
npm run battle-practice:merge-references -- \
  --input=기존기준.json,신규기준.jsonl \
  --exclude-input=학습원본.jsonl \
  '--classes=렌|레테' \
  --samples=5 \
  --output=tools/battle-practice-dataset/generated/검증기준-병합.json \
  --report=tools/battle-practice-dataset/generated/검증기준-병합.report.json
```

```bash
npm run battle-practice:build -- \
  tools/battle-practice-dataset/raw/battle-practice-YYYYMMDDZ.jsonl
```

각 기록은 총 피해를 기준으로 스킬 점유율을 정규화합니다. 직업별 분포의
medoid와 총변동거리(TV distance)를 사용해 이상치를 제외하며 기본적으로
3개 이상의 표본과 중앙 쌍별 거리 0.12 이하를 통과해야 배포 후보가 됩니다.
같은 캐릭터가 여러 수집 파일에 다시 등장하면 가장 최신 기록 한 건만
독립 표본으로 셉니다.

외부 기준표가 있으면 다음처럼 오차 검증까지 통과한 직업만 배포 모듈에
넣을 수 있습니다.

배포 게이트는 학습에 쓰지 않은 캐릭터를 직업당 5명 이상 사용하고, 한 명씩
완전히 제외한 뒤 나머지 캐릭터로 신뢰도를 다시 맞추는 LOO 검증을 수행합니다.
방어율 300·380 결과를 함께 검사하며 중앙 상대오차, 최대 상대오차, 절대
퍼센트포인트 오차, 무보정 대비 개선된 캐릭터 수를 모두 통과해야 합니다.
`--allow-robust-validation-improvement`를 명시하면 일부 이상치를 허용하되
LOO 평균 오차가 무보정 대비 25% 이상 줄어든 경우만 `cross-validated` 또는
`directional-improvement` 등급으로 채택합니다.

```bash
npm run battle-practice:validate
# 진단용: 현재 활성 프리셋과 비교할 때만 사용
npm run battle-practice:validate -- --preset-mode=active
# 서버리스 실행 한도와 무관하게 같은 계산식을 로컬에서 검증
npm run battle-practice:validate -- --local --env-file=/home/ubuntu/maple/.env
# 중단된 검증은 성공 체크포인트를 재사용해 이어서 실행
npm run battle-practice:validate -- --local --resume
npm run battle-practice:build -- \
  tools/battle-practice-dataset/raw/*.jsonl \
  --validation=tools/battle-practice-dataset/generated/validation-report.json \
  --maximum-validation-error=20 \
  --minimum-validation-samples=5 \
  --require-validation \
  --require-validation-improvement
```

기본 검증 모드는 MapleScouter의 `00000`과 같은 자동 최적화(`auto`)입니다.
배포 판정과 직업 프로필 보정에는 반드시 기본 `auto` 결과를 사용하고,
`active` 결과는 프리셋 차이의 원인을 찾는 진단 자료로만 사용합니다.
검증기는 캐릭터별 다수 endpoint 호출이 서로 겹쳐 계정 전체 호출 제한을
넘지 않도록 항상 순차 실행합니다. `--concurrency`에 2 이상을 입력해도
안전하게 1로 제한합니다.
5건마다 `<보고서>.partial.json`을 저장하고 `--resume`에서는 성공 결과와
지원하지 않는 데몬어벤져 판정만 재사용해 일시적인 503 결과를 다시 검사합니다.

검증 보고서가 여러 개면 `--validation=기본.json,추가.json`처럼 쉼표로
연결합니다. 특정 직업만 재검증할 때는
`npm run battle-practice:validate -- '--classes=팔라딘|레테'`를 사용합니다.

운영 후보 생성에는 `--require-validation`을 사용합니다. 검증 정책은 직업당
서로 다른 캐릭터 5명 이상이며, 학습 캐릭터와 겹치는 검증값은 자동 제외합니다.
300·380 방어율 LOO 결과가 위의 품질 게이트를 통과하고 프로필을 쓰지 않은
계산보다 오차가 실제로 줄어든 직업만 허용합니다.
기준표가 없거나 표본이 부족하면 배포하지 않고 보고서에
`external-validation-missing`으로 남깁니다.

새 검증을 통과한 프로필은 이미 운영 검증을 통과한 모듈에 다음 명령으로
합칩니다. 동일 직업이 있으면 새 검증본이 우선하며, 검증 전 후보 모듈을
실수로 런타임에 통째로 복사하지 않습니다.

```bash
npm run battle-practice:merge-profiles -- \
  --base=tools/battle-practice-dataset/generated/기존-검증본.js \
  --validated=tools/battle-practice-dataset/generated/신규-검증본.js \
  --validation-report=tools/battle-practice-dataset/generated/신규-검증본.report.json \
  --output=../maple-core/src/class-damage-profiles.js \
  --report=tools/battle-practice-dataset/generated/배포-보고서.json
```

검증 보고서와 배포 모듈을 연결할 때는 신뢰도까지 포함한 최종
`profileHash`보다 스킬 점유율 자체의 `skillProfileHash`를 우선 확인합니다.
따라서 검증 후 신뢰도 보정으로 최종 해시가 달라져도 다른 스킬 프로필이
섞이지 않으며, 이전 보고서는 레거시 해시 규칙으로만 호환합니다.

생성되는 배포 모듈에는 직업명, 압축된 스킬 점유율과 표본 수만 남습니다.
안정성 지표와 기록 시간 범위는 배포되지 않는 품질 보고서에만 보존합니다.
닉네임, OCID, replay_id, 원본 피해량과 API 호출 코드도 포함되지 않습니다.

### 특수 스킬 반지 구간 프로필

컨티뉴어스 링은 보스 입장 시 준비 상태가 초기화되고 재발동 대기시간이
없으므로 풀 보스 계산에서 상시 패시브로 적용합니다. 리스트레인트 링과
웨폰퍼프 링 같은 액티브 공격 반지는 `지속시간 / 120초`로 평균하지 않습니다.
정상 연무장 기록의 실제 링 발동 시각과 스킬별 피해 점유율을 결합해
9·11·13·15·20초 극딜 구간의 직업별 피해 비중을 생성합니다.

지속형 공격은 스킬 사전의 지속시간 동안 피해가 분산된 것으로 처리하고,
즉발 공격은 타임라인의 시전 시각을 사용합니다. 관측 피해에는 이미
리스트레인트 링이 들어 있으므로 표본 캐릭터의 링 레벨과 비링 상태
공격력%를 사용해 링 증폭분을 제거한 뒤 배포 계수를 만듭니다.

```bash
npm run battle-practice:build-rings -- \
  tools/battle-practice-dataset/raw/battle-practice-skill-research-v2-20260909.jsonl \
  --output=../maple-core/src/special-ring-phase-profiles.js
```

배포 파일에는 직업명·표본 수·지속시간별 피해 비중만 포함하며 원본
닉네임, 리플레이 ID, 스킬 타임라인은 조사 폴더에만 남습니다.

효과 하나를 빼면 외부 기준 오차가 줄어드는 경우에도 곧바로 계산식에서
삭제하지 않습니다. 실제 연무장 타임라인에서 해당 효과가 유지됐는지 먼저
확인해 `활성화 누락`, `API 기준 상태와 중복`, `외부 기준 프리셋 불일치`를
구분합니다. 상세 검증 결과와 v2 연무장 원본은 아래처럼 진단할 수 있습니다.

```bash
npm run skills:research-provenance -- \
  --input=상세-검증-보고서.json \
  --records=raw/battle-practice-v2.jsonl \
  --output=generated/combat-effect-provenance.json
```

런타임의 전투 효과는 `sourceKey`, `activation`, `applicationReason`을 가진
출처 원장으로 합성합니다. 완전히 같은 효과는 한 번만 적용하고, API 최종
스탯에 포함됐다고 확인된 출처는 다시 더하지 않습니다. 원본/VI 대체나 서로
다른 단계의 합산은 이름 유사도로 추측하지 않고 명시적인 계열·단계 키로만
처리합니다.

## 4. 방어 정규화 v2 프로필

schema v2의 character-info에서 연무장 입장 당시 방무를 읽고, 스킬 사전과
skill-timeline으로 스킬 전용·일시적 전역·대상 방어 효과를 적용한 뒤 관측
피해 점유율에서 donor의 방어 배율을 나눕니다. 결과는 새 캐릭터의 방무를
적용하기 전(shareBasis: pre-defense) 스킬 점유율입니다.

학습 원본과 holdout의 캐릭터 또는 replay가 하나라도 겹치면 빌드를 중단합니다.
동일 캐릭터의 중복 원본은 최신 한 건만 사용하고, 서로 다른 캐릭터가 같은
replay ID를 가리키면 데이터 오염으로 판정합니다. 자동 종료, 피해 합계,
타임라인 범위, 스킬 사전 피해 커버리지와 검토 필요 점유율도 검사합니다.

경량 프로필 생성:

    npm run battle-practice:build-raw -- 원본-v2.jsonl \
      --holdout=독립-검증기준.json \
      --minimum-samples=5 --maximum-samples=5 \
      --output=generated/defense-normalized-profiles.js \
      --report=generated/defense-normalized-profiles.report.json

생성된 경량 프로필은 코어 파일에 복사하지 않고 로컬 캐릭터 환산에 바로
주입해 holdout을 검증할 수 있습니다.

    npm run battle-practice:validate -- --local \
      --env-file=/home/ubuntu/maple/.env \
      --profiles=generated/defense-normalized-profiles.js \
      --input=독립-검증기준.json

profiles 옵션은 로컬 검증에서만 허용되며 파일 해시가 체크포인트와 최종
보고서에 기록됩니다. 타임라인은 스킬 시전 시각만 제공하므로 소환수·지연
타격의 순간 방어 효과는 정확한 타격 시각 대신 전투 시간 가중값으로
근사될 수 있습니다. 이 한계 때문에 독립 holdout 검증을 통과하기 전에는
경량 프로필을 운영 계산식으로 승격하지 않습니다.

실제 6분 연무장 규약과 MapleScouter 표시 규약을 한 정답으로 섞지 않고
재현하려면 다음 연구 명령을 사용합니다.

    npm run skills:research-protocols

이 검증은 실제 기록에서 캐릭터 한 명을 매번 완전히 제외하는 직업 내 LOO와,
donor 캐릭터와 겹치지 않는 MapleScouter 5표본 비교를 별도로 출력합니다.
소표본 이상치에 강하도록 스킬별 이름 대신 동일한 스킬 방무 조합의 방어 전
점유율을 압축하고, donor별 +방무 반응의 중앙값을 사용합니다. 생성되는
`*.model.json`은 연구 후보일 뿐 자동으로 코어 계산식에 복사되지 않습니다.
외부 비교 규약의 LOO 계층 보정도 규약 차이 진단용이며 실제 전투 계산식으로
배포하지 않습니다.

## 5. 배포 경계

Cloudflare 배포물에는 `maple-core/src/class-damage-profiles.js`의 압축된
직업별 점유율과 계산식만 포함합니다. 이 폴더의 `raw/`, `generated/`,
수집기와 검증기는 배포 대상이 아니며 `.gitignore`에서도 제외합니다.
