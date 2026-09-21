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
];

const PAGE_FAVICONS = new Map([
  ["../index.html", "./tool-icons/starforce-star.svg"],
  ["../potential/index.html", "../tool-icons/black-cube.png"],
  ["../additional/index.html", "../tool-icons/white-additional-cube.png"],
  ["../add-option/index.html", "../tool-icons/black-rebirth-flame.png"],
  ["../scroll/index.html", "../tool-icons/spell-trace.png"],
  ["../ability/index.html", "../tool-icons/large-boss-medal.png"],
  ["../pet/index.html", "../tool-icons/wisp-wonderberry.png"],
  ["../item-market/index.html", "../tool-icons/starforce-star.svg"],
  ["../sitemap-submit/index.html", "../tool-icons/starforce-star.svg"],
]);

test("모든 페이지가 기능을 구분하는 파비콘을 선언한다", async () => {
  for (const [page, favicon] of PAGE_FAVICONS) {
    const html = await read(page);
    assert.match(
      html,
      new RegExp(`<link rel="icon"[^>]+href="${favicon.replaceAll(".", "\\.")}"`),
      `${page} favicon`,
    );
  }
});

test("사이트맵은 공개 계산기와 안내 페이지를 중복 없이 포함한다", async () => {
  const sitemap = await read("../public/sitemap.xml");
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(
    (match) => match[1],
  );

  assert.deepEqual(locations, PUBLIC_URLS);
  assert.equal(new Set(locations).size, locations.length);
  assert.doesNotMatch(sitemap, /item-market/u);
  assert.doesNotMatch(sitemap, /sitemap-submit/u);
});

test("robots와 운영 기능 플래그가 사이트맵 공개 범위를 지킨다", async () => {
  const [robots, productionEnv, headers, redirects] = await Promise.all([
    read("../public/robots.txt"),
    read("../.env.production"),
    read("../public/_headers"),
    read("../public/_redirects"),
  ]);

  assert.match(robots, /User-agent:\s*\*/u);
  assert.match(robots, /Allow:\s*\//u);
  assert.match(
    robots,
    /Sitemap:\s*https:\/\/starforce\.pages\.dev\/sitemap\.xml/u,
  );
  assert.match(productionEnv, /VITE_ITEM_MARKET_ENABLED=false/u);
  assert.match(
    headers,
    /\/sitemap\.xml\s+Content-Type:\s*application\/xml/u,
  );
  assert.match(
    redirects,
    /\/sitemap\.xml\/\s+\/sitemap\.xml\s+200/u,
  );
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
