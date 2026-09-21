import { getAbilityTargetValues } from "maple-core/ability";

// 사용자가 지정한 '레레레 어빌' 최종 표 (2026-09-16).
// https://www.inven.co.kr/board/maple/5974/7192640
// 일반 보스/사냥 사용률 집계의 자동 갱신과 별도로 관리한다.
// 표의 공은 마법사에게 마력으로 적용. 피는 데몬어벤져의 최대 HP %.
// 별표의 콜렉터 조건과 공/마/벞 대체 가능성은 추천의 전제이며,
// 여기서는 사용자가 요청한 표의 기본 조합을 적용하고 직접 수정은 허용한다.
const COMBINATIONS = Object.freeze({
  "나이트로드": "패보상",
  "나이트워커": "보상공",
  "다크나이트": "패보재",
  "데몬슬레이어": "보상공",
  "데몬어벤져": "재보피",
  "듀얼블레이더": "패보상",
  "라라": "패보상",
  "레테": "재보상",
  "렌": "패보상",
  "루미너스": "재보상",
  "메르세데스": "패보크",
  "메카닉": "보상공",
  "미하일": "보상공",
  "바이퍼": "패보상",
  "배틀메이지": "패보상",
  "보우마스터": "패보크",
  "블래스터": "보상공",
  "비숍": "보상공",
  "섀도어": "패보상",
  "소울마스터": "패보상",
  "스트라이커": "패보상",
  "신궁": "패보크",
  "아델": "패보재",
  "아란": "패보상",
  "아크": "패재보",
  "아크메이지(불,독)": "보상공",
  "아크메이지(썬,콜)": "보상공",
  "에반": "보재상",
  "엔젤릭버스터": "패보상",
  "와일드헌터": "패보크",
  "윈드브레이커": "패보크",
  "은월": "패보상",
  "일리움": "패보상",
  "제논": "보상공",
  "제로": "재보상",
  "카데나": "재보상",
  "카이저": "재보상",
  "카인": "패보크",
  "칼리": "재보상",
  "캐논마스터": "패보상",
  "캡틴": "재보상",
  "키네시스": "보상공",
  "팔라딘": "패보상",
  "패스파인더": "재보크",
  "팬텀": "패보재",
  "플레임위자드": "패보상",
  "호영": "패보상",
  "히어로": "패보상",
});
const OPTION_TYPES = Object.freeze({
  패: "passive-level",
  보: "boss-damage",
  상: "abnormal-damage",
  재: "cooldown-skip",
  크: "critical",
  공: "attack",
  피: "max-hp-percent",
});
const MAGIC_JOBS = new Set([
  "라라", "루미너스", "배틀메이지", "비숍", "아크메이지(불,독)",
  "아크메이지(썬,콜)", "에반", "일리움", "키네시스", "플레임위자드",
]);

/** 고급 재설정의 보스용 추천만 레전드리 세 줄의 공식 최대 수치로 만든다. */
export function getAdvancedAbilityBossTargets(jobId, method, mode) {
  if (method !== "advanced" || mode !== "boss" || !Object.hasOwn(COMBINATIONS, jobId)) return null;
  return [...COMBINATIONS[jobId]].map((code, line) => {
    const type = code === "공" && MAGIC_JOBS.has(jobId) ? "magic" : OPTION_TYPES[code];
    const values = getAbilityTargetValues(type, line, "advanced", "legendary");
    return { type, minimum: Math.max(...values), grade: "legendary", locked: false };
  });
}
