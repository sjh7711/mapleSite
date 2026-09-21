import { appendFile, readdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { renderStaticToolNav } from "./src/shared/tool-nav.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 모든 계산기와 안내 페이지에 같은 테마 전환을 제공한다.
function sharedTheme() {
  return {
    name: "shared-theme",
    transformIndexHtml: {
      order: "pre",
      async handler(html) {
        if (!html.includes('class="page"')) return html;
        const [bootstrap, toggle] = await Promise.all([
          readFile(resolve(__dirname, "src/shared/theme.js"), "utf8"),
          readFile(resolve(__dirname, "partials/theme-toggle.html"), "utf8"),
        ]);
        return html
          .replace(/(<meta charset="utf-8"\s*\/>)/u, `$1\n<script>${bootstrap}</script>`)
          .replace("</header>", `${toggle}\n</header>`);
      },
    },
  };
}

// Google이 JavaScript 렌더링 전에도 계산기 링크를 발견하도록 한다.
function staticToolNav({ itemMarketEnabled }) {
  return {
    name: "static-tool-nav",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        if (!html.includes('id="toolnav"')) return html;
        const page = Object.entries(pages).find(([, filename]) => filename === context.filename)?.[0];
        if (!page) throw new Error(`계산기 메뉴의 페이지를 확인하지 못했습니다: ${context.filename}`);
        const current = page === "main" ? "starforce" : page === "additional" ? "potential" : page;
        return html.replace(
          /(<nav\b[^>]*\bid="toolnav"[^>]*>)[\s\S]*?(<\/nav>)/u,
          (_, open, close) => `${open}\n${renderStaticToolNav(current, { itemMarketEnabled })}\n${close}`,
        );
      },
    },
  };
}

// 다른 URL에서 동일한 XML을 비교한다. 원본만 관리해 두 파일의 차이를 막는다.
function sitemapComparisonFile() {
  return {
    name: "sitemap-comparison-file",
    apply: "build",
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "sitemap-pages.xml",
        source: await readFile(resolve(__dirname, "public/sitemap.xml")),
      });
    },
  };
}

// 빌드된 HTML에 안내 링크를 넣어 JavaScript 없이도 읽을 수 있게 한다.
function sharedSiteFooter() {
  return {
    name: "shared-site-footer",
    transformIndexHtml: {
      order: "pre",
      async handler(html, context) {
        if (!html.includes("<!-- site-footer -->")) return html;
        const footer = await readFile(
          resolve(__dirname, "partials/site-footer.html"), "utf8",
        );
        const copyButton = context.filename === resolve(__dirname, "index.html")
          ? ' <button id="contact-copy" class="page__copy" type="button" aria-label="문의 이메일 주소 복사">복사</button>'
          : "";
        return html.replace("<!-- site-footer -->", footer.replace("<!-- contact-copy -->", copyButton));
      },
    },
  };
}

function pruneItemMarketDeploymentData({ enabled }) {
  return {
    name: "prune-item-market-deployment-data",
    apply: "build",
    async closeBundle() {
      const marketRoot = resolve(__dirname, "dist/item-market");
      const releasesRoot = resolve(marketRoot, "releases");
      if (!enabled) {
        // 운영에서는 장비 시세 진입점 자체가 꺼져 있다. 기능이 읽을 수 없는
        // 100MB대 매물 자료를 정적 배포물에 남겨 두지 않는다.
        await rm(releasesRoot, { recursive: true, force: true });
        await rm(resolve(marketRoot, "manifest.json"), { force: true });
        await rm(resolve(marketRoot, "index.html"), { force: true });
        // 비활성 주소는 JavaScript 실행 없이도 홈으로 이동한다.
        await appendFile(
          resolve(__dirname, "dist/_redirects"),
          "\n# 비활성 장비 시세 페이지\n/item-market / 302\n/item-market/ / 302\n",
        );
        console.log("item-market: 비활성 빌드에서 시세 데이터 제외");
        return;
      }
      const manifest = JSON.parse(
        await readFile(resolve(marketRoot, "manifest.json"), "utf8"),
      );
      const activeRelease = String(manifest?.dataset_version ?? "");
      if (!/^[a-f0-9]{20}$/u.test(activeRelease)) {
        throw new Error("장비 시세 활성 데이터 버전을 확인하지 못했습니다.");
      }
      const releases = await readdir(releasesRoot, { withFileTypes: true });
      const historical = releases.filter(
        (entry) => entry.isDirectory() && entry.name !== activeRelease,
      );
      for (const entry of historical) {
        await rm(resolve(releasesRoot, entry.name), {
          recursive: true,
          force: true,
        });
      }
      console.log(
        `item-market: 활성 릴리스 ${activeRelease}만 배포 ` +
          `(과거 ${historical.length}개 제외)`,
      );
    },
  };
}

/* 기대값 계산은 공용 패키지 maple-core 에 있다. Discord 봇도 같은 패키지를
   쓰므로 두 곳의 계산 결과가 어긋나지 않는다. 빌드하면 결과물에 번들되어
   배포본은 어느 폴더에도 기대지 않는다. */

/* 계산기를 늘릴 때는 여기에 HTML을 한 줄 더한다. 도구마다 별도 페이지로
   빌드되어 번들이 갈라지고, 스타포스만 보러 온 사람이 다른 계산기 코드를
   내려받지 않는다. 검색에 잡히는 주소가 늘어나는 이점도 있다.
   예) potential: resolve(__dirname, "potential/index.html") */
const pages = {
  main: resolve(__dirname, "index.html"),
  potential: resolve(__dirname, "potential/index.html"),
  additional: resolve(__dirname, "additional/index.html"),
  ability: resolve(__dirname, "ability/index.html"),
  "add-option": resolve(__dirname, "add-option/index.html"),
  scroll: resolve(__dirname, "scroll/index.html"),
  pet: resolve(__dirname, "pet/index.html"),
  soul: resolve(__dirname, "soul/index.html"),
  "item-market": resolve(__dirname, "item-market/index.html"),
  "sitemap-submit": resolve(__dirname, "sitemap-submit/index.html"),
  about: resolve(__dirname, "about/index.html"),
  privacy: resolve(__dirname, "privacy/index.html"),
  sources: resolve(__dirname, "sources/index.html"),
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  const itemMarketEnabled = env.VITE_ITEM_MARKET_ENABLED !== "false";
  return {
    base: "./",
    plugins: [
      sharedTheme(),
      staticToolNav({ itemMarketEnabled }),
      sharedSiteFooter(),
      sitemapComparisonFile(),
      pruneItemMarketDeploymentData({ enabled: itemMarketEnabled }),
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: { input: pages },
    },
    server: {
      host: "0.0.0.0",
      port: 5174,
    },
  };
});
