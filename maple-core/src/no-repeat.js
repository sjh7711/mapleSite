/**
 * 현재 결과와 완전히 같은 결과가 다시 나오지 않는 재설정의 다음 성공 확률.
 *
 * successProbability: 원래 분포에서 목표 결과가 나올 확률
 * failureRepeatWeight: 목표가 아닌 각 결과 i에 대한 p_i / (1 - p_i)의 합
 *
 * 현재 결과를 목표가 아닌 원래 분포로 평균하면
 *   sum_i [p_i / (1-s)] * [s / (1-p_i)]
 * 가 된다.
 */
export function adjustedNextResultProbability({
  successProbability,
  failureRepeatWeight,
}) {
  const success = Number(successProbability);
  const weight = Number(failureRepeatWeight);
  if (!Number.isFinite(success) || success <= 0) return 0;
  if (success >= 1) return 1;
  if (!Number.isFinite(weight) || weight <= 0) return success;
  const failure = 1 - success;
  return Math.max(0, Math.min(1, (success / failure) * weight));
}

export function expectedAttemptsWithDifferentResult(options) {
  const probability = adjustedNextResultProbability(options);
  return probability > 0 ? 1 / probability : Number.POSITIVE_INFINITY;
}
