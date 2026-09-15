export const ADD_OPTION_SOURCE_ORDER = ["black", "abyss", "strong"];

export const ADD_OPTION_SOURCE_LABELS = Object.freeze({
  black: "검환불",
  abyss: "심환불",
  strong: "강환불",
});

export function getAddOptionSourceLabel(key) {
  return ADD_OPTION_SOURCE_LABELS[key] ?? key;
}

export function orderAddOptionSources(sources) {
  const orderByKey = new Map(
    ADD_OPTION_SOURCE_ORDER.map((key, index) => [key, index]),
  );
  return [...sources].sort(
    (left, right) =>
      (orderByKey.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
      (orderByKey.get(right.key) ?? Number.MAX_SAFE_INTEGER),
  );
}
