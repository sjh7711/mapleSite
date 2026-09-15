// 이 파일은 scripts/refresh-ability-job-data.mjs가 생성합니다.
// 계산기 화면에서 실제로 사용하는 직업명과 추천 세 줄만 따로 두어
// 원시 사용률 표 전체가 초기 번들에 포함되지 않게 한다.
const HUNT = Object.freeze(["item-drop", "meso-drop", "normal-damage"]);
const BOSSES = Object.freeze({
  "나이트로드": ["boss-damage", "abnormal-damage", "attack"],
  "나이트워커": ["boss-damage", "abnormal-damage", "attack"],
  "다크나이트": ["boss-damage", "abnormal-damage", "cooldown-skip"],
  "데몬슬레이어": ["boss-damage", "abnormal-damage", "buff-duration"],
  "데몬어벤져": ["cooldown-skip", "abnormal-damage", "boss-damage"],
  "듀얼블레이더": ["boss-damage", "abnormal-damage", "attack"],
  "라라": ["passive-level", "abnormal-damage", "boss-damage"],
  "레테": ["cooldown-skip", "abnormal-damage", "boss-damage"],
  "렌": ["boss-damage", "abnormal-damage", "attack"],
  "루미너스": ["cooldown-skip", "boss-damage", "abnormal-damage"],
  "메르세데스": ["boss-damage", "abnormal-damage", "critical"],
  "메카닉": ["boss-damage", "abnormal-damage", "buff-duration"],
  "미하일": ["boss-damage", "abnormal-damage", "cooldown-skip"],
  "바이퍼": ["boss-damage", "abnormal-damage", "attack"],
  "배틀메이지": ["boss-damage", "abnormal-damage", "magic"],
  "보우마스터": ["boss-damage", "abnormal-damage", "critical"],
  "블래스터": ["boss-damage", "abnormal-damage", "attack"],
  "비숍": ["boss-damage", "abnormal-damage", "magic"],
  "섀도어": ["boss-damage", "abnormal-damage", "attack"],
  "소울마스터": ["boss-damage", "abnormal-damage", "attack"],
  "스트라이커": ["boss-damage", "abnormal-damage", "attack"],
  "신궁": ["boss-damage", "abnormal-damage", "critical"],
  "아델": ["boss-damage", "abnormal-damage", "cooldown-skip"],
  "아란": ["boss-damage", "abnormal-damage", "attack"],
  "아크": ["cooldown-skip", "abnormal-damage", "boss-damage"],
  "아크메이지(불,독)": ["boss-damage", "abnormal-damage", "buff-duration"],
  "아크메이지(썬,콜)": ["boss-damage", "abnormal-damage", "magic"],
  "에반": ["boss-damage", "abnormal-damage", "cooldown-skip"],
  "엔젤릭버스터": ["boss-damage", "abnormal-damage", "buff-duration"],
  "와일드헌터": ["boss-damage", "abnormal-damage", "critical"],
  "윈드브레이커": ["boss-damage", "abnormal-damage", "critical"],
  "은월": ["boss-damage", "abnormal-damage", "attack"],
  "일리움": ["boss-damage", "abnormal-damage", "magic"],
  "제논": ["boss-damage", "abnormal-damage", "buff-duration"],
  "제로": ["boss-damage", "abnormal-damage", "attack"],
  "카데나": ["cooldown-skip", "abnormal-damage", "boss-damage"],
  "카이저": ["cooldown-skip", "buff-duration", "boss-damage"],
  "카인": ["boss-damage", "critical", "abnormal-damage"],
  "칼리": ["cooldown-skip", "abnormal-damage", "boss-damage"],
  "캐논마스터": ["boss-damage", "abnormal-damage", "attack"],
  "캡틴": ["cooldown-skip", "abnormal-damage", "boss-damage"],
  "키네시스": ["boss-damage", "abnormal-damage", "buff-duration"],
  "팔라딘": ["boss-damage", "abnormal-damage", "attack"],
  "패스파인더": ["cooldown-skip", "critical", "boss-damage"],
  "팬텀": ["boss-damage", "abnormal-damage", "cooldown-skip"],
  "플레임위자드": ["passive-level", "abnormal-damage", "boss-damage"],
  "호영": ["passive-level", "abnormal-damage", "boss-damage"],
  "히어로": ["boss-damage", "abnormal-damage", "attack"],
});

export const ABILITY_JOB_PRESETS = Object.freeze(
  Object.entries(BOSSES).map(([name, boss]) => Object.freeze({
    id: name,
    name,
    presets: Object.freeze({
      boss: Object.freeze(boss),
      hunt: name === "섀도어"
        ? Object.freeze(["item-drop", "normal-damage", "meso-drop"])
        : HUNT,
    }),
  })),
);
