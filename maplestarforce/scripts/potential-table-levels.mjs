/**
 * 넥슨 확률표가 달라지는 장비 레벨 구간의 시작점.
 *
 * 120 미만은 10단위 경계 자체와 경계 다음 레벨이 다른 표를 쓴다.
 * 예: 10, 11~19, 20, 21~29. 120~200과 201~250은 각각 같은
 * 표를 쓴다.
 */
export const POTENTIAL_LEVEL_BANDS = Object.freeze([
  0,
  10, 11,
  20, 21,
  30, 31,
  40, 41,
  50, 51,
  60, 61,
  70, 71,
  80, 81,
  90, 91,
  100, 101,
  110, 111,
  120,
  201,
]);

export const MAX_POTENTIAL_ITEM_LEVEL = 250;

/**
 * 구간의 대표 레벨. 넥슨 표와 MESU는 구간의 마지막 레벨을
 * 조회한다. 저장 키는 구간 시작점을 유지해 `bandFor`와 바로 호환한다.
 */
export function requestLevelForBand(band) {
  const index = POTENTIAL_LEVEL_BANDS.indexOf(band);
  if (index === -1) {
    throw new RangeError("알 수 없는 장비 레벨 구간입니다.");
  }

  const nextBand = POTENTIAL_LEVEL_BANDS[index + 1];
  return nextBand === undefined ? MAX_POTENTIAL_ITEM_LEVEL : nextBand - 1;
}

/**
 * 공식 페이지는 해당 부위의 장비가 실제로 존재하지 않는 정확한
 * 레벨에 빈 표를 돌려준다. 같은 구간 안에서 실제 장비가 있는
 * 레벨을 찾을 수 있도록 높은 레벨부터 모두 시도한다.
 */
export function candidateLevelsForBand(band) {
  const lastLevel = requestLevelForBand(band);
  const descending = Array.from(
    { length: lastLevel - band + 1 },
    (_, index) => lastLevel - index,
  );
  if (descending.length <= 10) return descending;

  const commonEquipmentLevels = [160, 150, 140, 130];
  return [
    ...new Set([
      lastLevel,
      band,
      ...commonEquipmentLevels.filter((level) => level >= band && level <= lastLevel),
      ...descending,
    ]),
  ];
}
