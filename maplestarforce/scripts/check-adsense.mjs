import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const PUBLIC_PATHS = [
  "/", "/potential/", "/ability/", "/add-option/", "/scroll/", "/pet/",
  "/about/", "/privacy/", "/sources/", "/soul/",
];
const AD_PATHS = new Set(["/", "/potential/", "/ability/", "/add-option/", "/scroll/", "/pet/", "/soul/"]);

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu)]
      .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]),
  );
}

export function documentSignals(html) {
  const meta = [...html.matchAll(/<meta\b[^>]*>/giu)].map(([tag]) => attributes(tag));
  const links = [...html.matchAll(/<link\b[^>]*>/giu)].map(([tag]) => attributes(tag));
  const scripts = [...html.matchAll(/<script\b[^>]*>/giu)].map(([tag]) => ({
    ...attributes(tag), async: /\sasync(?:\s|=|>)/iu.test(tag),
  }));
  const metaClients = meta.filter((tag) => tag.name?.toLowerCase() === "google-adsense-account")
    .map((tag) => tag.content);
  const adScripts = scripts.filter((tag) => {
    try {
      const url = new URL(tag.src);
      return url.hostname === "pagead2.googlesyndication.com" &&
        url.pathname === "/pagead/js/adsbygoogle.js";
    } catch { return false; }
  });
  return {
    hasHeading: /<h1\b[^>]*>[^<\s]/iu.test(html),
    canonical: links.find((tag) => tag.rel?.toLowerCase() === "canonical")?.href,
    noindex: meta.some((tag) => /^(?:robots|googlebot)$/iu.test(tag.name ?? "") &&
      /(?:noindex|none)/iu.test(tag.content ?? "")),
    clients: [...new Set([...metaClients, ...adScripts.map((tag) =>
      new URL(tag.src).searchParams.get("client"))].filter(Boolean))],
    hasAdScript: adScripts.length > 0,
    adScripts,
    draftPrivacy: /검토용 초안/u.test(html),
  };
}

export function assessAdCode(html, { expected, publisherId }) {
  const { adScripts } = documentSignals(html);
  if (!expected) return {
    status: adScripts.length === 0 ? "pass" : "fail",
    detail: adScripts.length === 0 ? "광고 실행 코드 없음" : "광고 제외 페이지 또는 미설치 검사 대상에 실행 코드가 있습니다.",
  };
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/iu)?.[1] ?? "";
  const valid = adScripts.length === 1 && documentSignals(head).adScripts.length === 1 &&
    adScripts[0].async && adScripts[0].crossorigin === "anonymous" &&
    new URL(adScripts[0].src).protocol === "https:" &&
    new URL(adScripts[0].src).searchParams.get("client") === `ca-${publisherId}`;
  return { status: valid ? "pass" : "fail", detail: valid
    ? "head에 지정 계정의 비동기 광고 코드 1개"
    : "광고 코드의 개수·head 위치·계정·HTTPS·async·crossorigin을 확인하세요." };
}

export function assessAdsTxt({ status, contentType, body }, publisherId) {
  if (status === 404) return { status: "pending", detail: "ads.txt가 아직 없습니다(권장 항목)." };
  if (status !== 200 || !/^text\/plain(?:;|$)/iu.test(contentType)) {
    return { status: "fail", detail: "ads.txt의 HTTP 상태 또는 text/plain 형식이 잘못되었습니다." };
  }
  if (/<(?:!doctype|html|head|body)\b/iu.test(body)) {
    return { status: "fail", detail: "ads.txt 주소에서 HTML이 반환됩니다." };
  }
  const sellers = body.split(/\r?\n/u).map((line) => line.split("#")[0].trim())
    .filter(Boolean).map((line) => line.split(",").map((part) => part.trim()));
  const google = sellers.filter(([domain, id, relationship, authority]) =>
    domain.toLowerCase() === "google.com" && /^pub-\d{16}$/u.test(id ?? "") &&
    relationship?.toUpperCase() === "DIRECT" && authority === "f08c47fec0942fa0");
  if (!publisherId) return { status: "pending", detail: "실제 게시자 ID를 받아 계정 일치 여부를 확인해야 합니다." };
  return google.some(([, id]) => id === publisherId)
    ? { status: "pass", detail: "Google DIRECT 행이 지정한 게시자 ID와 일치합니다." }
    : { status: "fail", detail: "지정한 게시자 ID의 Google DIRECT 행을 찾지 못했습니다." };
}

async function getDocument(base, path) {
  // HTML·텍스트만 읽는다. 광고 JavaScript와 광고 요청은 실행하지 않는다.
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20000) });
  return {
    path, status: response.status, finalUrl: response.url, redirected: response.redirected,
    contentType: response.headers.get("content-type") ?? "",
    robots: response.headers.get("x-robots-tag") ?? "",
    body: await response.text(),
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: "string", default: "https://preview.starforce.pages.dev/" },
    environment: { type: "string", default: "preview" },
    "publisher-id": { type: "string" },
    "expect-ad-code": { type: "boolean", default: false },
    json: { type: "string" },
    help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("npm run adsense:check -- --url URL --environment preview|production [--publisher-id pub-ID] [--expect-ad-code] [--json FILE]");
    console.log("HTTP와 정적 HTML 점검 도구입니다. 승인·계정 상태·법적 준수 여부를 판정하지 않습니다.");
    return;
  }
  const base = new URL(values.url);
  if (!/^https?:$/u.test(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("로그인 정보나 하위 경로가 없는 사이트의 루트 HTTP(S) URL을 입력하세요.");
  }
  if (!["preview", "production"].includes(values.environment)) throw new Error("environment는 preview 또는 production이어야 합니다.");
  const publisherId = values["publisher-id"];
  if (publisherId && (!/^pub-\d{16}$/u.test(publisherId) || publisherId === "pub-0000000000000000")) {
    throw new Error("실제 pub-게시자 ID(숫자 16자리)를 입력하세요. 예시 ID는 사용할 수 없습니다.");
  }
  if (values["expect-ad-code"] && !publisherId) throw new Error("광고 코드 설치 검사에는 --publisher-id가 필요합니다.");
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const documents = new Map();
  const paths = [...PUBLIC_PATHS, "/robots.txt", "/sitemap.xml", "/ads.txt", "/item-market/", "/adsense-check-missing-page/"];
  // 동시에 네 개까지만 요청한다.
  for (let start = 0; start < paths.length; start += 4) {
    await Promise.all(paths.slice(start, start + 4).map(async (path) => {
      try { documents.set(path, await getDocument(base, path)); }
      catch (error) { add(path, "fail", `응답 확인 실패: ${error.message}`); }
    }));
  }
  for (const path of PUBLIC_PATHS) {
    const document = documents.get(path);
    if (!document) continue;
    const signals = documentSignals(document.body);
    const ok = document.status === 200 && /^text\/html(?:;|$)/iu.test(document.contentType) && signals.hasHeading;
    add(`${path} 페이지`, ok ? "pass" : "fail", `HTTP ${document.status}, ${document.contentType}`);
    if (!ok) continue;
    const noindex = signals.noindex || /(?:noindex|none)/iu.test(document.robots);
    add(`${path} 색인 설정`, noindex === (values.environment === "preview") ? "pass" : "fail",
      noindex ? "색인 제외" : "색인 제외 태그 없음");
    add(`${path} 대표 URL`, signals.canonical === `https://starforce.pages.dev${path}` ? "pass" : "fail",
      signals.canonical ?? "canonical 없음");
    if (path === "/privacy/") add("개인정보처리방침 확정", signals.draftPrivacy ? "pending" : "info",
      signals.draftPrivacy ? "검토용 초안입니다. 광고 도입 시 실제 설정에 맞춘 고지 확정이 필요합니다." : "본문의 정확성과 운영 기준은 사람이 확인해야 합니다.");
    if (values["expect-ad-code"] || values.environment === "preview" || !AD_PATHS.has(path)) {
      const assessment = assessAdCode(document.body, {
        expected: values["expect-ad-code"] && AD_PATHS.has(path), publisherId,
      });
      add(`${path} 광고 코드`, assessment.status, assessment.detail);
    }
    if (publisherId && signals.clients.some((client) => client !== `ca-${publisherId}`)) {
      add(`${path} 광고 계정`, "fail", "지정한 게시자 ID와 다른 광고 계정 정보가 있습니다.");
    }
  }
  const robots = documents.get("/robots.txt");
  if (robots) add("robots.txt", robots.status === 200 && /^text\/plain(?:;|$)/iu.test(robots.contentType) &&
    /Sitemap:\s*https:\/\/starforce\.pages\.dev\/sitemap\.xml/iu.test(robots.body) ? "pass" : "fail", "HTTP·파일 형식·사이트맵 선언 확인. 개별 크롤러 접근은 별도 확인이 필요합니다.");
  const sitemap = documents.get("/sitemap.xml");
  if (sitemap) {
    const locations = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
    const expected = PUBLIC_PATHS.map((path) => `https://starforce.pages.dev${path}`);
    add("sitemap.xml", sitemap.status === 200 && /^(?:application|text)\/xml(?:;|$)/iu.test(sitemap.contentType) &&
      /<urlset\b[^>]*xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0\.9"/u.test(sitemap.body) &&
      locations.length === expected.length && new Set(locations).size === locations.length &&
      expected.every((url) => locations.includes(url)) ? "pass" : "fail", `${locations.length}개 URL, 공개 페이지 목록과 비교`);
  }
  const missing = documents.get("/adsense-check-missing-page/");
  if (missing) add("없는 주소", missing.status === 404 ? "pass" : "fail", `HTTP ${missing.status}`);
  const market = documents.get("/item-market/");
  if (market) {
    const expectedPath = values.environment === "preview" ? "/item-market/" : "/";
    const valid = market.status === 200 && new URL(market.finalUrl).pathname === expectedPath &&
      (values.environment === "preview" || market.redirected);
    add("장비 시세 공개 범위", valid ? "pass" : "fail", values.environment === "preview"
      ? "Preview에서 시세 페이지 제공 여부 확인"
      : "비활성 시세 주소가 JavaScript 없이 홈으로 이동하는지 확인");
  }
  const adsTxt = documents.get("/ads.txt");
  const adsAssessment = adsTxt ? assessAdsTxt(adsTxt, publisherId) : null;
  if (adsAssessment) add("ads.txt", adsAssessment.status, adsAssessment.detail);
  const home = documents.get("/");
  const homeClients = home ? documentSignals(home.body).clients : [];
  const connected = publisherId && (homeClients.includes(`ca-${publisherId}`) || adsAssessment?.status === "pass");
  add("AdSense 사이트 연결 정보", connected ? "pass" : "pending", connected
    ? "지정 계정의 확인 정보가 있습니다. Google 계정의 인증·승인 결과는 별도 확인이 필요합니다."
    : publisherId ? "해당 게시자 ID의 메타 태그·광고 코드·ads.txt 확인 정보를 찾지 못했습니다."
      : "AdSense 계정 생성 후 실제 게시자 ID가 필요합니다.");
  const summary = Object.fromEntries(["pass", "fail", "pending", "info"].map((status) => [status, checks.filter((check) => check.status === status).length]));
  const report = { checkedAt: new Date().toISOString(), url: base.href, environment: values.environment,
    expectAdCode: values["expect-ad-code"],
    publisherId: publisherId ?? null, summary, checks,
    limits: "정적 HTTP 점검입니다. Google의 실제 접근·계정 승인·콘텐츠 품질·동의 설정·자료 이용 권한을 판정하지 않습니다." };
  for (const check of checks) console.log(`[${check.status.toUpperCase()}] ${check.name}: ${check.detail}`);
  console.log(JSON.stringify(summary));
  console.log(report.limits);
  if (values.json) {
    const output = resolve(values.json);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (summary.fail > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
