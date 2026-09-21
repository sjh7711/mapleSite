import assert from "node:assert/strict";
import test from "node:test";
import { assessAdCode, assessAdsTxt, documentSignals } from "../scripts/check-adsense.mjs";

const publisherId = "pub-1234567890123456";
const validText = `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`;

test("ads.txt 주소가 정상 상태의 홈페이지 HTML을 돌려줘도 승인 정보로 인정하지 않는다", () => {
  for (const contentType of ["text/html", "text/plain"]) {
    assert.equal(assessAdsTxt({ status: 200, contentType, body: "<!doctype html><html><body>home</body></html>" }, publisherId).status, "fail");
  }
});

test("다른 계정이나 RESELLER 행을 자신의 직접 판매자 정보로 인정하지 않는다", () => {
  for (const body of [validText.replace(publisherId, "pub-9999999999999999"), validText.replace("DIRECT", "RESELLER")]) {
    assert.equal(assessAdsTxt({ status: 200, contentType: "text/plain", body }, publisherId).status, "fail");
  }
  assert.equal(assessAdsTxt({ status: 200, contentType: "text/plain; charset=utf-8", body: `# comment\r\n${validText}` }, publisherId).status, "pass");
});

test("계정 미발급과 ads.txt 미생성은 서버 오류와 구분해 미완료로 표시한다", () => {
  assert.equal(assessAdsTxt({ status: 404, contentType: "text/html", body: "missing" }, publisherId).status, "pending");
  assert.equal(assessAdsTxt({ status: 200, contentType: "text/plain", body: validText }).status, "pending");
  assert.equal(assessAdsTxt({ status: 503, contentType: "text/plain", body: "unavailable" }, publisherId).status, "fail");
});

test("확인 메타 태그와 실제 광고 스크립트를 구분한다", () => {
  const meta = documentSignals(`<h1>계산기</h1><meta content='ca-${publisherId}' name='google-adsense-account'><meta name=robots content=noindex><link href='https://starforce.pages.dev/' rel=canonical>`);
  assert.deepEqual(meta.clients, [`ca-${publisherId}`]);
  assert.equal(meta.hasAdScript, false);
  assert.equal(meta.noindex, true);
  assert.equal(meta.canonical, "https://starforce.pages.dev/");
  const script = documentSignals(`<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${publisherId}"></script>`);
  assert.equal(script.hasAdScript, true);
  assert.deepEqual(script.clients, [`ca-${publisherId}`]);
  assert.equal(documentSignals(`<p>ca-${publisherId}</p>`).clients.length, 0);
});

test("광고 코드 설치 검사는 누락·중복·다른 계정·잘못된 로딩 위치를 거부한다", () => {
  const code = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${publisherId}" crossorigin="anonymous"></script>`;
  const options = { expected: true, publisherId };
  assert.equal(assessAdCode(`<head>${code}</head>`, options).status, "pass");
  for (const html of [
    "<head></head>", `<head>${code}${code}</head>`, `<head></head><body>${code}</body>`,
    `<head>${code.replace(publisherId, "pub-9999999999999999")}</head>`,
    `<head>${code.replace(" async", "")}</head>`,
    `<head>${code.replace('crossorigin="anonymous"', "")}</head>`,
    `<head>${code.replace("https:", "http:")}</head>`,
  ]) assert.equal(assessAdCode(html, options).status, "fail", html);
});

test("광고 제외 페이지에서는 계정 확인 메타만 허용하고 실행 코드는 거부한다", () => {
  const options = { expected: false, publisherId };
  assert.equal(assessAdCode(`<meta name="google-adsense-account" content="ca-${publisherId}">`, options).status, "pass");
  assert.equal(assessAdCode(`<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${publisherId}"></script>`, options).status, "fail");
});
