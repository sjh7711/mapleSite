/**
 * 운영 빌드에서는 아직 검증 중인 기능을 노출하지 않는다. Vite가 빌드 모드별
 * 환경값을 정적으로 치환하므로, 비활성화된 기능은 진입점에서도 실행되지 않는다.
 */
export const ITEM_MARKET_ENABLED =
  import.meta.env?.VITE_ITEM_MARKET_ENABLED !== "false";
