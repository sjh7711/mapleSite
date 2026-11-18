export function appendVarianceLegend(plot, comparison, mode = "curve") {
  if (!comparison) return;
  const legend = document.createElement("div"); legend.className = "variance-chart__legend";
  if (mode === "histogram") legend.classList.add("variance-chart__legend--histogram");
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", "기본과 편차 감소 비교");
  for (const [kind, label] of [["basic", "기본"], ["reduced", "편차 감소"]]) {
    const entry = document.createElement("span"); entry.className = `variance-chart__legend--${kind}`;
    entry.textContent = label; legend.append(entry);
  }
  plot.append(legend);
}
