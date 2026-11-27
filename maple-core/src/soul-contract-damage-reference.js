// Nexon Battle Practice replays registered from 2026-10-01 to 2026-11-18.
// Per-duration median of inside/outside damage-rate ratios. Windows are
// reconstructed from skill use times and official skill damage totals.
// Soul Contract amplification is removed before measuring the ratios.
// Charges, repeated casts and sustained sources are allocated by their
// replay timing and skill rules. See the October 22 balance patch for
// the classes whose references use only the November replay season.
// https://openapi.nexon.com/ko/game/maplestory/?id=55
// https://maplestory.nexon.com/news/update/815
export const SOUL_CONTRACT_DAMAGE_PROFILES = {
  "나이트로드": {"sampleCount": 13, "rates": [4.0352, 3.59444, 3.18162, 2.82675, 2.61429, 2.36647, 2.27369, 2.09615]},
  "다크나이트": {"sampleCount": 7, "rates": [2.44747, 2.22349, 2.07302, 1.96467, 1.87205, 1.78649, 1.76307, 1.65736]},
  "데몬슬레이어": {"sampleCount": 7, "rates": [2.6186, 2.52441, 2.374, 2.33277, 2.31347, 2.23146, 2.20976, 2.14472]},
  "듀얼블레이더": {"sampleCount": 16, "rates": [3.27151, 2.98554, 2.57725, 2.40537, 2.36227, 2.16709, 2.05124, 2.02669]},
  "라라": {"sampleCount": 11, "rates": [2.74901, 2.59494, 2.40427, 2.24472, 2.19011, 2.06309, 1.98531, 1.85655]},
  "메르세데스": {"sampleCount": 8, "rates": [3.30169, 3.09364, 2.84215, 2.66211, 2.63742, 2.51108, 2.43593, 2.46382]},
  "미하일": {"sampleCount": 10, "rates": [3.25777, 3.06507, 2.89096, 2.74459, 2.65094, 2.48416, 2.28228, 2.10364]},
  "섀도어": {"sampleCount": 10, "rates": [3.11079, 2.80992, 2.44387, 2.33024, 2.20222, 2.02716, 1.86803, 1.69283]},
  "소울마스터": {"sampleCount": 13, "rates": [3.87393, 3.76781, 3.43589, 3.2941, 3.15803, 2.8777, 2.58411, 2.32634]},
  "아델": {"sampleCount": 14, "rates": [3.14441, 2.99278, 3.00455, 2.7336, 2.72131, 2.37431, 2.31423, 2.17184]},
  "아란": {"sampleCount": 12, "rates": [4.49774, 4.50976, 3.84796, 3.648, 3.41144, 3.05669, 2.76303, 2.44232]},
  "아크메이지(불,독)": {"sampleCount": 9, "rates": [3.05372, 2.74459, 2.29398, 2.37683, 2.27411, 2.25527, 2.01232, 1.78117]},
  "아크메이지(썬,콜)": {"sampleCount": 8, "rates": [4.66326, 4.09285, 3.52566, 3.1719, 3.00149, 2.77528, 2.51639, 2.91251]},
  "에반": {"sampleCount": 11, "rates": [2.32691, 2.30636, 2.01394, 1.82255, 1.74196, 1.63222, 1.65751, 1.58495]},
  "엔젤릭버스터": {"sampleCount": 11, "rates": [1.79732, 2.00463, 1.89923, 1.74073, 1.84106, 1.77177, 1.71569, 1.73885], "requiresReuse": true},
  "은월": {"sampleCount": 7, "rates": [5.39757, 4.85073, 4.13015, 3.63301, 3.45188, 3.14209, 2.84278, 2.59888]},
  "일리움": {"sampleCount": 5, "rates": [3.20532, 3.30819, 3.21495, 2.95119, 2.84021, 2.57881, 2.38525, 2.37787]},
  "제논": {"sampleCount": 12, "rates": [3.71628, 3.44476, 3.1838, 2.91144, 2.74106, 2.4931, 2.26982, 2.05366]},
  "카데나": {"sampleCount": 17, "rates": [3.74931, 3.54935, 3.13974, 2.92091, 2.78899, 2.54799, 2.3415, 2.12789]},
  "카이저": {"sampleCount": 10, "rates": [2.63974, 2.44305, 2.31151, 2.08169, 2.014, 1.86964, 1.82396, 1.77723], "requiresReuse": true},
  "카인": {"sampleCount": 17, "rates": [2.57337, 2.47696, 2.52726, 2.5137, 2.3373, 2.09506, 1.9352, 1.83216], "requiresReuse": true},
  "팔라딘": {"sampleCount": 14, "rates": [3.1367, 2.89908, 2.6374, 2.41276, 2.31605, 2.11005, 1.98725, 1.90092]},
  "플레임위자드": {"sampleCount": 13, "rates": [3.46988, 3.2582, 3.11852, 2.91079, 2.79606, 2.51763, 2.3289, 2.26235]},
  "히어로": {"sampleCount": 11, "rates": [4.39522, 3.81822, 3.24828, 2.87577, 2.78753, 2.48084, 2.47016, 2.27257]},
};
