import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  "item-market": resolve(__dirname, "item-market/index.html"),
  "sitemap-submit": resolve(__dirname, "sitemap-submit/index.html"),
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  const itemMarketEnabled = env.VITE_ITEM_MARKET_ENABLED !== "false";
  return {
    base: "./",
    plugins: [pruneItemMarketDeploymentData({ enabled: itemMarketEnabled })],
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
