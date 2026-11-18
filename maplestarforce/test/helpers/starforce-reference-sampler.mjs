// Independent chronological reference used to validate the aggregated variance sampler.
export function geometric(p, random) {
  return p >= 1
    ? 1
    : Math.max(1, Math.ceil(Math.log1p(-random()) / Math.log1p(-p)));
}
export function sampleStarforce(plan, random) {
  const stages = new Map(
    [...plan.strategyStages, ...plan.stages].map((s) => [s.star, s]),
  );
  let star = plan.startStar,
    cost = 0;
  for (let turns = 0; star < plan.targetStar; turns++) {
    if (turns > 1000000)
      throw new Error("스타포스 표본의 강화 횟수 한도를 초과했습니다.");
    const s = stages.get(star);
    if (!s) throw new Error("스타포스 복구 전략이 없습니다.");
    const move = s.success + s.destroy;
    cost += geometric(move, random) * s.cost;
    if (random() < s.success / move) {
      star++;
      continue;
    }
    const recovery = (s.expectedCost * s.success - s.cost) / s.destroy;
    if (s.policy === "12성 복구") {
      cost += plan.replacementPrice;
      star = 12;
    } else if (s.policy === "22성 확정 복구") {
      let replay = 0;
      for (let j = 22; j < star; j++) replay += stages.get(j).expectedCost;
      cost += Math.max(0, recovery - replay);
      star = 22;
    } else cost += Math.max(0, recovery);
  }
  return cost;
}
