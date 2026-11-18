export const STARFORCE_ITEMS_KEY = "maplestarforce:items:v1";

// 영구 저장본을 우선 사용하고, 이전 버전의 탭별 목록도 읽어온다.
// 공유 화면에서는 두 저장소 모두 공유 전용 메모리이므로 개인 목록을 읽지 않는다.
export function readStarforceItems(storage, legacySession) {
  for (const source of [storage, legacySession]) {
    try {
      const value = JSON.parse(source?.getItem(STARFORCE_ITEMS_KEY) ?? "null");
      if (Array.isArray(value) || Array.isArray(value?.slots)) return value;
    } catch {
      // 저장소 접근이나 JSON 해석에 실패해도 이전 목록 복원을 시도한다.
    }
  }
  return null;
}
