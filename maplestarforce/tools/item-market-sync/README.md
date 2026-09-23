# 시세 자동 갱신 서비스

## 운영

- 서비스: `maple-market-sync.service` (ubuntu 계정, 부팅 시 시작, 비정상 종료 시 15초 후 재시작)
- 60초마다 `item_price_raw/incoming`의 해시 파일명을 확인합니다.
- 기존 데이터에 반영하지 않은 고유 파일이 **500개 이상**이면 증분 갱신합니다. 파일 수는 매물 수가 아닙니다.
- 이미 검증한 원본은 기존 정규화 결과를 재사용하고, 새로 완성된 수집 묶음만 추가 검증·정규화합니다. 동일 거래는 합칩니다.
- 수집이 끝나지 않은 페이지 묶음은 보류합니다. 같은 미완료 묶음을 반복 처리하지 않으며 새 파일이 도착하면 다시 확인합니다.
- 수집 도중 전체 검색 결과 수·전체 페이지 수가 달라져도 허용합니다. 각 페이지의 건수·다음 페이지 표기·검색 조건·원본 무결성은 검증하고, 페이지 경계에서 반복된 거래는 네이티브 거래 ID로 합칩니다.
- 같은 시도에서 검색 횟수가 달라지거나 저장 페이지가 누락되는 등 실제 수집 근거가 모순되는 묶음은 원본을 보존한 채 전체를 격리하고 정상 묶음은 계속 반영합니다. 격리한 파일은 500개 기준에서 제외합니다. 이후 갱신 때 다시 검증하며, 사유와 경로는 `status`의 `validation_log`에 기록합니다.
- 새 자료가 있는 장비의 모델을 재검증합니다. 거래 기록이 같은 품목은 해시가 일치하는 검증 결과를 재사용합니다.
- **정규화된 시세 자료와 모델 정책만** `starforce-market-data.pages.dev`에 배포합니다. 작업 중인 앱 코드를 자동으로 빌드·배포하지 않습니다.
- 프리뷰는 `.env.preview`의 `VITE_ITEM_MARKET_MANIFEST_URL`로 이 자료를 읽습니다. 사이트 새로고침 시 최신 자료를 불러옵니다.
- 운영 사이트의 장비 시세 기능은 계속 비활성 상태입니다.

## 수동 명령

```sh
maple-market status
maple-market refresh
maple-market refresh --wait
```

`refresh`는 500개 미만이어도 전체 갱신 절차를 요청합니다. `--wait`는 완료/실패 결과까지 기다립니다. 명령은 실행 중인 서비스에 요청 파일을 전달하므로 자동 갱신과 동시에 실행되지 않습니다.

```sh
systemctl status maple-market-sync.service
journalctl -u maple-market-sync.service -n 40 --no-pager
sudo systemctl restart maple-market-sync.service
sudo systemctl stop maple-market-sync.service
sudo systemctl start maple-market-sync.service
```

- 설정: `/home/ubuntu/.config/maple-market-sync/config.json`
- 상태·요청·실행 로그: `/home/ubuntu/.local/state/maple-market-sync/`
- 장비별 모델 보고서: 위 폴더의 `reports/`
- 검증 캐시: `tools/item-market-dataset/market-data/model-cache/`

## 장애 처리

원본 파일은 지우지 않습니다. 검증 또는 배포에 실패하면 게시된 데이터는 그대로 유지합니다. 미완료 배포 상태를 디스크에 기록하고, 재시작 뒤에도 파일 수와 무관하게 이어서 처리합니다. 실패 재시도는 2분부터 최대 15분까지 간격을 늘립니다. 프로세스 중복 실행은 systemd와 `flock`으로 방지합니다.

`status`의 `inventory.dataset_version`은 VM에 생성한 자료, `published_dataset_version`은 실제 배포까지 완료한 자료입니다. 둘이 다르면 갱신 중이거나 배포를 재시도하고 있을 수 있습니다. `phase`, `last_error`, `model_report`를 함께 확인하세요.

## 모델 검증

- 최근 거래 반감기 후보: 3일·7일·14일. 기본은 7일입니다.
- 시장 기간 구분: 7일. 노작·스타포스·잠재 가격의 시점 차이를 추정하며 추옵·주문서·거래 횟수 효과는 기간 공통으로 학습합니다.
- 시간순 앞 80%에서 내부 검증으로 후보를 고르고, 마지막 20%는 별도 감사에 사용합니다. 동일 거래 시각은 양쪽에 나누지 않습니다.
- 별도 감사에서 중앙 로그 오차 또는 상위 80% 오차가 크게 나빠지면 30일 기준을 유지합니다. 후보의 원래 오차도 보고서에 남깁니다.
- 최종 추정기 표본에서도 양수·유한값·구성요소 합계를 검증합니다.
- 작은 자료에서는 무리하게 최적화하지 않고 기본값을 사용합니다. 검증 오차는 향후 모든 거래의 정확도를 보장하지 않습니다.

시세 데이터 공개 파일은 기존 개인정보 제거·해시 검증 파이프라인을 사용합니다. 원본 및 상세 내부 보고서는 데이터 서버에 포함하지 않습니다. 과거 7개 릴리스의 공개 자료를 함께 보존해 열려 있던 브라우저의 구버전 요청도 지원합니다.

## 개발 시

앱 변경은 기존처럼 별도로 프리뷰에 배포합니다. 자동 서비스의 모델 코드를 수정할 때는 테스트를 마친 뒤 `maple-market refresh --wait`를 실행하세요. `npm run market:refresh`는 저수준 자료 생성 명령이므로 단독 실행만으로는 데이터 서버가 갱신되지 않습니다.
