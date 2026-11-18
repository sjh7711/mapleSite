import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const PUBLIC_URLS = [
  "https://starforce.pages.dev/",
  "https://starforce.pages.dev/potential/",
  "https://starforce.pages.dev/ability/",
  "https://starforce.pages.dev/add-option/",
  "https://starforce.pages.dev/scroll/",
  "https://starforce.pages.dev/pet/",
  "https://starforce.pages.dev/about/",
  "https://starforce.pages.dev/privacy/",
  "https://starforce.pages.dev/sources/",
  "https://starforce.pages.dev/soul/",
  "https://starforce.pages.dev/guide/",
  "https://starforce.pages.dev/guide/starforce/",
  "https://starforce.pages.dev/guide/potential/",
  "https://starforce.pages.dev/guide/ability/",
  "https://starforce.pages.dev/guide/add-option/",
  "https://starforce.pages.dev/guide/scroll/",
  "https://starforce.pages.dev/guide/pet/",
  "https://starforce.pages.dev/guide/soul/",
];

const FAVICON_PAGES = [
  "../index.html", "../potential/index.html", "../additional/index.html", "../add-option/index.html",
  "../scroll/index.html", "../ability/index.html", "../pet/index.html", "../soul/index.html",
  "../sitemap-submit/index.html", "../about/index.html", "../privacy/index.html", "../sources/index.html",
  "../guide/index.html", ...["starforce", "potential", "add-option", "scroll", "ability", "pet", "soul"].map((tool) => `../guide/${tool}/index.html`),
  ...["login", "starforce-prices", "soul-ether-prices", "blacksmith-inboxes"].map((page) => `../admin/${page}/index.html`),
  "../public/404.html",
];

test("사이트 전체가 스타포스 별 파비콘과 PNG·ICO 대체 이미지를 선언한다", async () => {
  for (const page of FAVICON_PAGES) {
    const html = await read(page);
    for (const href of ["/favicon.ico", "/favicon-96x96.png", "/tool-icons/starforce-star.svg"]) {
      assert.ok([...html.matchAll(/<link rel="icon"[^>]+>/gu)].some(([tag]) => tag.includes(`href="${href}"`)), `${page}: ${href}`);
    }
  }
});

test("XML과 텍스트 사이트맵은 같은 공개 URL을 중복 없이 포함한다", async () => {
  const [sitemap, textSitemap] = await Promise.all([
    read("../public/sitemap.xml"),
    read("../public/sitemap.txt"),
  ]);
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(
    (match) => match[1],
  );
  const textLocations = textSitemap.trimEnd().split(/\r?\n/u);

  assert.deepEqual(locations, PUBLIC_URLS);
  assert.deepEqual(textLocations, PUBLIC_URLS);
  assert.equal(textSitemap, PUBLIC_URLS.join("\n") + "\n");
  assert.equal(new Set(locations).size, locations.length);
  assert.equal(new Set(textLocations).size, textLocations.length);
  assert.doesNotMatch(sitemap, /item-market/u);
  assert.doesNotMatch(sitemap, /sitemap-submit/u);
  assert.doesNotMatch(sitemap, /<lastmod>/u);
  assert.doesNotMatch(sitemap, /<changefreq>/u);
});

test("robots와 헤더가 사이트맵 공개 범위를 지킨다", async () => {
  const [robots, headers, redirects, vite] = await Promise.all([
    read("../public/robots.txt"),
    read("../public/_headers"),
    read("../public/_redirects"),
    read("../vite.config.js"),
  ]);

  assert.match(robots, /User-agent:\s*\*/u);
  assert.match(robots, /Allow:\s*\//u);
  assert.match(
    robots,
    /Sitemap:\s*https:\/\/starforce\.pages\.dev\/sitemap\.xml/u,
  );
  assert.match(
    robots,
    /Sitemap:\s*https:\/\/starforce\.pages\.dev\/sitemap\.txt/u,
  );
  assert.match(
    headers,
    /\/sitemap\.xml\s+Content-Type:\s*application\/xml/u,
  );
  assert.match(
    headers,
    /\/sitemap\.txt\s+Content-Type:\s*text\/plain; charset=utf-8/u,
  );
  assert.doesNotMatch(headers, /\/sitemap\.xml\//u);
  assert.doesNotMatch(headers, /\/sitemap-pages\.xml/u);
  assert.match(
    redirects,
    /^\/sitemap\.xml\/\s+\/sitemap\.xml\s+301$/mu,
  );
  assert.doesNotMatch(
    redirects,
    /^\/sitemap\.xml\/\s+\/sitemap\.xml\s+200$/mu,
  );
  assert.match(
    redirects,
    /^\/sitemap-pages\.xml\s+\/sitemap\.xml\s+301$/mu,
  );
  assert.doesNotMatch(vite, /sitemap-pages\.xml/u);
  assert.match(
    redirects,
    /\/additional\/\s+\/potential\/\?system=additional\s+301/u,
  );
});

test("제출 도우미는 직접 제출을 가장하지 않고 Search Console로 연결한다", async () => {
  const [vite, html, source] = await Promise.all([
    read("../vite.config.js"),
    read("../sitemap-submit/index.html"),
    read("../src/pages/sitemap-submit.js"),
  ]);

  assert.match(
    vite,
    /"sitemap-submit": resolve\(__dirname, "sitemap-submit\/index\.html"\)/u,
  );
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/u);
  assert.match(html, /id="sitemap-submit-form"/u);
  assert.match(html, /Search Console에서 제출/u);
  assert.match(source, /https:\/\/search\.google\.com\/search-console\/sitemaps/u);
  assert.match(source, /navigator\.clipboard\.writeText\(SITEMAP_PATH\)/u);
  assert.match(source, /fetch\(SITEMAP_URL/u);
  assert.doesNotMatch(source, /google\.com\/ping/u);
  assert.doesNotMatch(source, /googleapis\.com\/webmasters/u);
});
