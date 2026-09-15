export const WHEEL_DEFAULT_REVISION = 1;

/**
 * 예전 저장값은 한 번 버리고 스크롤 변경을 OFF로 시작한다.
 * 이 개정 이후 사용자가 직접 다시 켠 값은 그대로 유지한다.
 */
export function migrateWheelPreference(state = {}) {
  if (state.wheelDefaultRevision !== WHEEL_DEFAULT_REVISION) {
    return {
      wheelEnabled: false,
      wheelDefaultRevision: WHEEL_DEFAULT_REVISION,
    };
  }
  return {
    wheelEnabled: state.wheelEnabled === true,
    wheelDefaultRevision: WHEEL_DEFAULT_REVISION,
  };
}
