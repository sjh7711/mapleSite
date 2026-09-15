const MOBILE_RESULT_BAR_ID = "mobile-result-bar";

function text(node) {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function compactLabel(label) {
  if (/추정 적정가/.test(label)) return "추정 적정가";
  if (/평균 명성치/.test(label)) return "평균 명성치";
  if (/평균 서큘레이터/.test(label)) return "평균 서큘레이터";
  if (/평균.*비용|비용.*평균/.test(label)) return "평균 비용";
  if (/예상 총지출/.test(label)) return "예상 총지출";
  return label || "계산 결과";
}

function resultSummary(result) {
  const explicit = result.querySelector("[data-mobile-result-summary]");
  if (explicit) {
    return {
      label: compactLabel(explicit.dataset.mobileResultLabel || text(explicit)),
      value: explicit.dataset.mobileResultValue || text(explicit.querySelector("strong")),
    };
  }

  const hero = result.querySelector(".result-hero");
  if (hero) {
    return {
      label: compactLabel(text(hero.querySelector(".result-hero__label"))),
      value: text(hero.querySelector("strong")),
    };
  }

  const metrics = [...result.querySelectorAll(".metric")];
  const averageCost = metrics.find((metric) =>
    /평균.*비용|비용.*평균/.test(text(metric.querySelector("span"))),
  );
  if (averageCost) {
    return {
      label: "평균 비용",
      value: text(averageCost.querySelector("strong")),
    };
  }

  if (result.querySelector(".add-option-result-table")) {
    return { label: "환불별 평균 비용", value: "" };
  }

  return {
    label: text(result.querySelector("h2")) || "계산 결과",
    value: "",
  };
}

function createBar() {
  const bar = document.createElement("button");
  bar.id = MOBILE_RESULT_BAR_ID;
  bar.type = "button";
  bar.className = "mobile-result-bar";
  bar.hidden = true;
  bar.setAttribute("aria-label", "계산 결과로 이동");

  const summary = document.createElement("span");
  summary.className = "mobile-result-bar__summary";
  const label = document.createElement("span");
  label.className = "mobile-result-bar__label";
  const value = document.createElement("strong");
  value.className = "mobile-result-bar__value";
  summary.append(label, value);

  const action = document.createElement("span");
  action.className = "mobile-result-bar__action";
  action.textContent = "결과 보기";
  bar.append(summary, action);
  return bar;
}

/**
 * 모바일 계산기에서 현재 결과를 화면 아래에 요약하고, 누르면 결과 카드로 이동한다.
 * 각 계산기는 결과 영역을 통째로 다시 그리므로 #tool을 감시해 최신 값을 읽는다.
 */
export function installMobileResultBar(tool = document.querySelector("#tool")) {
  if (!tool || document.getElementById(MOBILE_RESULT_BAR_ID)) return;

  const bar = createBar();
  document.body.append(bar);
  let currentResult = null;
  let scheduled = false;

  const refresh = () => {
    scheduled = false;
    currentResult = tool.querySelector(".calculator-result");
    if (!currentResult) {
      bar.hidden = true;
      document.body.classList.remove("has-mobile-result-bar");
      return;
    }

    const summary = resultSummary(currentResult);
    bar.querySelector(".mobile-result-bar__label").textContent = summary.label;
    const value = bar.querySelector(".mobile-result-bar__value");
    value.textContent = summary.value;
    value.hidden = !summary.value;
    bar.title = [summary.label, summary.value, "결과 보기"].filter(Boolean).join(" · ");
    bar.hidden = false;
    document.body.classList.add("has-mobile-result-bar");
  };

  const scheduleRefresh = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  };

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(tool, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  bar.addEventListener("click", () => {
    const result = tool.querySelector(".calculator-result") || currentResult;
    result?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  refresh();
}
