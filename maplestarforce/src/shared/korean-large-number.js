const INTEGER_FORMAT = new Intl.NumberFormat("ko-KR");
const MAN_FORMAT = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 1,
});

/** 명성치처럼 단위 없는 큰 정수를 조·억·만 묶음으로 읽기 쉽게 표시한다. */
export function formatHonorAmount(value) {
  if (!Number.isFinite(value)) return "도달 불가";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute < 10_000) return `${sign}${INTEGER_FORMAT.format(Math.round(absolute))}`;

  // 만 단위 아래는 0.1만까지 반올림한 뒤 분해해 단위 경계의 올림도 보존한다.
  let rest = Math.round(absolute / 1_000) * 1_000;
  const jo = Math.floor(rest / 1_000_000_000_000);
  rest -= jo * 1_000_000_000_000;
  const eok = Math.floor(rest / 100_000_000);
  rest -= eok * 100_000_000;
  const man = rest / 10_000;

  const parts = [];
  if (jo) parts.push(`${INTEGER_FORMAT.format(jo)}조`);
  if (eok) parts.push(`${INTEGER_FORMAT.format(eok)}억`);
  if (man) parts.push(`${MAN_FORMAT.format(man)}만`);
  return `${sign}${parts.join(" ")}`;
}
