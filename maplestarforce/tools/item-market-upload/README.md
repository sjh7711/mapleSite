# 장비시세 원본 자동 전송

## 현재 구성

확장 프로그램 → Cloudflare Tunnel → VM `127.0.0.1:8793` → `item_price_raw/incoming/<해시 앞 2글자>/<SHA-256>.jsonl`

고정 주소 `https://maple-market-upload.apfhd159862.workers.dev/route`는 인증된 확장 프로그램에 현재 터널 주소만 제공합니다. Worker에는 원본을 받는 API가 없고 원본을 중계하거나 보관하지 않습니다. KV에는 터널 주소 하나만 저장합니다.

- systemd: `maple-market-upload.service` (부팅 시 자동 시작, 종료 시 재시작)
- VM 비공개 설정: `/home/ubuntu/.config/maple-market-upload/config.json` (600)
- 확장 프로그램 비공개 설정: `vm-upload-config.json` (Git 제외)
- Worker 인증값: Wrangler secrets `UPLOAD_TOKEN`, `REGISTER_TOKEN`
- 새 도메인 구매나 유료 플랜 전환은 필요 없습니다. Quick Tunnel에는 가동 시간 보장이 없으므로 확장 프로그램의 영구 전송 대기열에서 실패를 재시도합니다.

## PC 확장 프로그램 갱신

1. 수집을 일시정지합니다.
2. 배포 ZIP의 파일을 **기존 확장 프로그램 폴더에 덮어씁니다**. 같은 폴더를 유지하고 기존 확장 프로그램을 제거하지 않아야 브라우저의 체크포인트와 저장 권한이 유지됩니다.
3. `chrome://extensions`에서 확장 프로그램의 새로고침 버튼을 누르고, 수집 관리 화면도 다시 엽니다. 추가된 전송 호스트 권한을 Chrome이 요청하면 허용합니다.
4. 기존 PC 저장 폴더를 사용해 수집합니다. 페이지 수집 후 PC 백업과 별개로 VM 전송 대기열이 저장되고, 네트워크 실패 시 자동 재시도됩니다. `VM 저장 완료` 표시는 서버가 파일을 디스크에 저장하고 해시까지 확인했다는 뜻입니다.

관리 화면을 닫아도 Chrome이 실행 중이면 재시도합니다. Chrome을 완전히 종료한 동안에는 전송을 멈추고, 다음 실행 시 대기열을 복구합니다. 정상 저장 응답을 받은 원본만 대기열에서 지웁니다. 이미 PC에 저장되어 내용이 제거된 과거 원본은 자동 재수집하지 않습니다.

## 시세 데이터 반영

수신 서비스는 원본을 VM에 저장합니다. 별도의 `maple-market-sync.service`가 미반영 파일 **500개 이상**일 때 검증·중복 정리·모델 검증을 수행하고 시세 자료만 자동 배포합니다. 작업 중인 사이트 코드는 자동 배포하지 않습니다. [자동 갱신 서비스 안내](../item-market-sync/README.md)를 참고하세요.

```sh
maple-market status
maple-market refresh --wait
```

운영은 `VITE_ITEM_MARKET_ENABLED=false`를 유지합니다.

## 점검 / 복구

```sh
systemctl status maple-market-upload.service
journalctl -u maple-market-upload.service -n 30 --no-pager
sudo systemctl restart maple-market-upload.service
```

터널 주소는 재시작 후 자동 등록됩니다. 주소 전파 도중의 실패는 다음 재시도에서 회복됩니다. 동일 파일 재전송은 SHA-256 파일명으로 중복 저장하지 않습니다. 다른 내용은 별도의 파일로 보존합니다.

개별 업로드는 최대 32 MiB이며 capture.v2 구조, 전체 파일 SHA-256, 문서별 payload SHA-256을 확인합니다. 수집 요청 횟수·계정·경매장 호출 방식은 바꾸지 않습니다.

Worker 수정 시 `npx wrangler types --config tools/item-market-upload/wrangler.jsonc`로 타입을 재생성하고 타입 검사 후 배포합니다. 비밀값을 명령줄 인자나 Git에 넣지 않습니다.
