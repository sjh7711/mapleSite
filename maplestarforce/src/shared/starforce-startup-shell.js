// Geometry-only first-screen controls. The calculator replaces these after it
// restores personal/shared settings; no saved prices or requests enter HTML.
const chips = (labels) => labels.map((text) => `<button class="chip" type="button">${text}</button>`).join("");
const placeholder = ' data-startup-control inert aria-hidden="true"';
const icon = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">${paths}</svg>`;
const action = (className, attributes, svg, label) => `<button class="${`result-share-button ${className}`.trim()}" type="button" disabled ${attributes}>${svg}<span>${label}</span></button>`;

export function renderStarforceStartupShell(html, { textTransfer, inbox }) {
  let actions = "";
  if (textTransfer) {
    actions += action("", 'data-equipment-copy aria-label="현재 슬롯의 장비목록을 텍스트로 복사"', icon('<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'), "장비목록 복사");
    actions += action("equipment-text-paste", 'aria-label="장비목록 붙여넣기"', icon('<path d="M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="8" y="2" width="8" height="6" rx="2"/><path d="M8 13h8m-8 4h5"/>'), "장비목록 붙여넣기");
  }
  if (inbox) actions += action("inbox-launch", 'aria-label="대장장이 예약"', icon('<path stroke-linecap="round" stroke-linejoin="round" d="m15 12-8.4 8.4a2.1 2.1 0 0 1-3-3L12 9m-3-3 3-3 9 9-3 3z"/>'), "대장장이 예약");
  html = html.replace('<h1>스타포스 데브</h1>', `<div class="page__title-row"><div class="page__brand"><button class="toolnav-toggle" type="button" aria-label="메뉴 열기" aria-controls="toolnav" aria-expanded="false" disabled><span class="toolnav-toggle__icon" aria-hidden="true"><span></span><span></span><span></span></span></button><h1><span class="toolnav-toggle__label">스타포스 데브</span></h1></div>${actions ? `<div class="equipment-text-actions">${actions}</div>` : ""}</div>`);
  for (const [id, labels] of [
    ["event", ["없음", "30%", "파감", "샤타"]], ["mvp", ["없음", "실버", "골드", "다이아"]],
    ["pc", ["미적용", "적용"]], ["slots", ["1", "2", "3"]],
    ["multipliers", ["×1.00", "×1.05", "×1.07", "×1.09", "+ 추가"]],
  ]) {
    const empty = new RegExp(`(<div id="${id}"[^>]*)(></div>)`, "u");
    html = html.replace(empty, `$1${placeholder}>${chips(labels)}</div>`);
  }
  html = html.replace('<div id="items" class="items"></div>', '<div id="items" class="items"><p class="empty" data-startup-control inert aria-hidden="true">아이템을 추가해주세요.</p></div>');
  html = html.replace('<span id="total-scaled" class="total__scaled"></span>', `<span id="total-scaled" class="total__scaled"${placeholder}>0.00억 × 1.07 =</span>`);
  html = html.replace('<span id="total-cost">-</span>', `<span id="total-cost"${placeholder}>0.00억</span>`);
  if (inbox) html = html.replace('</main>', `</main><script>
(() => {
  if (!/^[a-f0-9]{24}$/.test(new URL(location.href).searchParams.get("inbox") || "")) return;
  const header = document.querySelector(".page__head");
  const launch = header.querySelector(".inbox-launch"); if (launch) launch.hidden = true;
  const banner = document.createElement("section");
  banner.className = "inbox-application"; banner.dataset.startupApplication = "";
  banner.innerHTML = '<strong>대장장이 정보를 확인하고 있습니다…</strong><p class="inbox-help">장비와 목표를 설정 한 후 신청 버튼을 누르세요.</p><div class="inbox-application__actions"><button class="inbox-button is-primary" type="button" disabled>신청</button></div>';
  header.after(banner);
})();
</script>`);
  return html;
}
