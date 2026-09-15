const POTENTIAL_TABLE_FILE_PATTERN =
  /^(?:regular(?:-(?:gold|silver|occult))?|additional(?:-bronze)?)-(?:rare|epic|unique|legendary)-(?:[1-9]|1\d|20)-(?:0|[1-9]\d{0,2})\.json$/;

/** 파일 정리 대상을 이 스크립트가 생성한 조합 JSON으로만 제한한다. */
export function isPotentialTableComboFile(file) {
  return POTENTIAL_TABLE_FILE_PATTERN.test(file);
}
