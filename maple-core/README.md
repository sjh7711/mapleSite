# maple-core

기대값 계산만 담는 공용 패키지입니다.

Discord 봇(`../maple`)과 스타포스 사이트(`../maplestarforce`)가 함께 씁니다.
계산 결과가 두 곳에서 어긋나지 않도록 **원본을 하나만 둔다**는 것이 목적입니다.

## 규칙

- **의존성을 두지 않습니다.** `discord.js`처럼 특정 실행 환경에 묶인 것을 들이면
  브라우저에서 번들할 수 없습니다. 표시(임베드·HTML)는 쓰는 쪽에서 만듭니다.
- **Node와 브라우저 양쪽에서 돌아가야 합니다.** `node:` 내장 모듈,
  `process`, `document` 를 쓰지 않습니다.
- 새 계산기를 넣을 때는 `exports` 에 진입점을 추가합니다.

## 쓰는 법

각 프로젝트의 `package.json` 에 아래처럼 걸어 두고 `npm install` 합니다.

```json
{ "dependencies": { "maple-core": "file:../maple-core" } }
```

```js
import { calculateStarforceExpected } from "maple-core/starforce";
```

## 2026-09-17 개편 준비

주문서·어빌리티·소울웨폰 개편 규칙은 현재 운영 계산과 분리되어 있다.

- `maple-core/reform-2026-09-17`: 공식 출처·버전·공개 대기 필드
- `maple-core/scroll-reform`: 메소 주문서 카탈로그와 성공률 보정
- `maple-core/ability-reform`: 현재 3줄 상태, 적용 조건, 복수 재화 비용
- `maple-core/soul`: 증폭·잠재 등급 상승 기댓값

공식 확률이 아직 공개되지 않은 계산은 추정값으로 대체하지 않고 오류로
차단한다. 조사 근거와 정식 서버 이행 순서는
[`docs/2026-09-17-expectation-reform.md`](docs/2026-09-17-expectation-reform.md)에
정리되어 있다.

## 시험

```bash
npm test
```
