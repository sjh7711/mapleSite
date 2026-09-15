const SITE_PROPERTY = "https://starforce.pages.dev/";
const SITEMAP_PATH = "sitemap.xml";
const SITEMAP_URL = new URL(SITEMAP_PATH, SITE_PROPERTY).href;
const SEARCH_CONSOLE_URL = new URL(
  "https://search.google.com/search-console/sitemaps",
);
SEARCH_CONSOLE_URL.searchParams.set("resource_id", SITE_PROPERTY);

const form = document.querySelector("#sitemap-submit-form");
const status = document.querySelector("#sitemap-status");
const statusCopy = document.querySelector("#sitemap-status-copy");
const message = document.querySelector("#sitemap-action-message");
const openButton = document.querySelector("#sitemap-open");
const copyButton = document.querySelector("#sitemap-copy");

function setMessage(text, state = "success") {
  message.textContent = text;
  message.dataset.state = state;
}

function setStatus(text, state) {
  statusCopy.textContent = text;
  status.dataset.state = state;
}

async function copySubmissionValue() {
  try {
    await navigator.clipboard.writeText(SITEMAP_PATH);
    setMessage("sitemap.xml을 복사했습니다. Search Console 입력칸에 붙여넣으세요.");
  } catch {
    document.querySelector("#sitemap-path")?.select();
    setMessage("자동 복사가 차단되었습니다. 선택된 입력값을 직접 복사해 주세요.", "error");
  }
}

async function checkSitemap() {
  try {
    const response = await fetch(SITEMAP_URL, {
      headers: { Accept: "application/xml, text/xml" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const documentXml = new DOMParser().parseFromString(
      await response.text(),
      "application/xml",
    );
    if (documentXml.querySelector("parsererror")) {
      throw new Error("invalid xml");
    }

    const locations = [...documentXml.querySelectorAll("url > loc")]
      .map((node) => node.textContent?.trim())
      .filter(Boolean);
    if (!locations.length) throw new Error("empty sitemap");

    const allProductionUrls = locations.every((location) => {
      try {
        return new URL(location).origin === new URL(SITE_PROPERTY).origin;
      } catch {
        return false;
      }
    });
    if (!allProductionUrls) throw new Error("foreign origin");

    setStatus(`정상 · 공개 페이지 ${locations.length}개`, "success");
  } catch {
    setStatus("확인 실패 · 사이트맵을 열어 직접 확인해 주세요.", "error");
  }
}

openButton.addEventListener("click", () => {
  window.open(SITEMAP_URL, "_blank", "noopener,noreferrer");
});

copyButton.addEventListener("click", () => {
  void copySubmissionValue();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void copySubmissionValue();
  window.open(SEARCH_CONSOLE_URL, "_blank", "noopener,noreferrer");
  setMessage("Google 창에서 sitemap.xml을 붙여넣고 제출 버튼을 누르세요.");
});

void checkSitemap();
