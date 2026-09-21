import { ABILITY_GRADES, getAbilityOption, chooseAbilityEconomicAction } from "maple-core/ability";
import { element, searchableSelect } from "./calculator-ui.js";
import { chip, numberInput, field } from "./ui.js";

// Only milestone state is entered. The priced practical policy, including its
// fixed result ranking and inventory cap, comes from the calculation worker.
export function abilityPracticalGuide(guide, heading, renderValueGuide) {
  const root = element("div", "ability-stepper");
  const current = element("div", "ability-stepper-current");
  const nav = element("div", "ability-stepper-nav");
  const body = element("div", "ability-stepper-body");
  const message = element("p", "ability-stepper-hint");
  const prev = chip("<", false, () => { if (index) { index--; paint(); } });
  const next = chip(">", false, advance);
  prev.removeAttribute("aria-pressed"); next.removeAttribute("aria-pressed");
  prev.setAttribute("aria-label", "이전 단계"); next.setAttribute("aria-label", "다음 단계");
  prev.dataset.stepperPrev = ""; next.dataset.stepperNext = "";
  const title = element("strong", "");
  nav.append(prev, title, next);
  root.append(current);
  if (heading) {
    heading.classList.add("ability-stepper-heading");
    root.append(heading);
  }
  if (guide.mixed) root.append(element("small", "ability-stepper-hint",
    `블서큘 ${guide.blackCount}개 + 카서큘 ${guide.chaosCount}개 · 합계 ${guide.count}개`));
  root.append(nav, body, message);
  const method = guide.method === "advanced" ? "고급 재설정" : "명성치 재설정";
  const item = guide.itemMethod === "abyss" ? "심서큘" : "블서큘";
  const bits = (mask) => [0, 1, 2].filter((i) => mask & (1 << i));
  const goalIndex = (target) => guide.targets.findIndex((g) => g.type === target.type);
  const unit = (i) => guide.units[i];
  const label = (i, value) => `${guide.names[i]} ${value}${unit(i)} (${ABILITY_GRADES[guide.targets[i].grade].label})`;
  const histories = [{ kind: "lower", locked: 0, slots: Array.from({ length: 3 }, () => ({ goal: -1, value: null })) }];
  let index = 0, nextState = null;
  const frame = () => histories[index];
  function invalidate() { histories.splice(index + 1); paint(); }
  function move(state) { histories.splice(index + 1); histories.push(state); index++; paint(); }
  function advance() {
    if (index < histories.length - 1) { index++; paint(); }
    else if (nextState) move(nextState);
  }
  function slotFor(goal, state = frame()) { return state.slots.find((s) => s.goal === goal); }
  function pairFor(state = frame()) { return guide.pairs.find((p) => p.pairMask === state.pairMask); }
  function completed(pair, state = frame()) {
    return pair.targets.reduce((mask, t, i) => {
      const slot = state.slots.findIndex((s) => s.goal === goalIndex(t) && s.value !== null && s.value >= t.minimum);
      return slot >= 0 && (i === 0 ? slot === 0 : slot > 0) ? mask | (1 << i) : mask;
    }, 0);
  }
  function globalMask(pair, mask) { return bits(mask).reduce((m, i) => m | (1 << goalIndex(pair.targets[i])), 0); }
  function toFinish(state, pair) {
    const mask = completed(pair, state), keep = pair.keepMasks[mask];
    if (guide.reference && state.slots[0].goal !== goalIndex(pair.targets[0])) {
      state.slots[0] = { goal: goalIndex(pair.targets[0]), value: null };
    }
    return { ...state, kind: mask === 7 ? "done" : "honor", initialMask: mask, kept: keep,
      locked: globalMask(pair, keep) };
  }
  function afterPair(state, pair) {
    if (guide.reference) return { ...state, kind: "reference", remaining: pair.count };
    const both = pair.targets.slice(1).every((t) => slotFor(goalIndex(t), state)?.value >= t.minimum);
    if (!pair.count || completed(pair, state) === 7 || (pair.practical.mode === "lower" && both)) return toFinish(state, pair);
    const first = state.slots[0];
    const firstGoal = goalIndex(pair.targets[0]);
    const firstAvailable = first.goal === firstGoal && first.value !== null;
    state.slots[0] = { goal: firstGoal, value: firstAvailable ? first.value : null };
    return { ...state, firstAvailable, kind: pair.practical.mode === "all" && !firstAvailable ? "first" : pair.mixed ? "chaos" : "roll" };
  }
  function lowerResult(state, rule) {
    const found = state.slots.slice(1).reduce((m, s) => s.goal >= 0 && s.value !== null ? m | (1 << s.goal) : m, 0);
    const decision = rule.decisions.find((d) => d.found === found && Object.entries(d.values).every(([i, value]) => slotFor(Number(i), state)?.value === value));
    if (!decision || decision.keep === rule.mask) return null;
    const result = structuredClone(state);
    result.locked = decision.keep;
    if (bits(decision.keep).length !== 2) return result;
    result.pairMask = decision.keep;
    const pair = pairFor(result), firstGoal = goalIndex(pair.targets[0]);
    if (!guide.reference && result.slots[0].goal !== firstGoal) result.slots[0] = { goal: firstGoal, value: null };
    return afterPair(result, pair);
  }
  function paintCurrent() {
    const f = frame(), pair = pairFor();
    current.replaceChildren(element("strong", "ability-stepper-current__title", "현재 어빌리티"));
    f.slots.forEach((slot, line) => {
      const row = element("div", "ability-stepper-row");
      row.dataset.line = String(line);
      const eligible = guide.targets.map((t, i) => ({ value: String(i), label: `${guide.names[i]} (${ABILITY_GRADES[t.grade].label})`,
        disabled: f.slots.some((s, n) => n !== line && s.goal === i) || (line === 0 ? t.grade !== "legendary" : !guide.pairs.some((p) => p.pairMask & (1 << i))) }));
      if (line === 0 && f.kind === "reference") {
        const firstType = slot.type ?? guide.targets[slot.goal]?.type ?? "";
        const entry = pair.firstOptions.find((o) => o.type === firstType);
        const type = searchableSelect([{ value: "", label: "첫 줄 옵션 선택" }, ...pair.firstOptions.map((o) => ({ value: o.type, label: o.label }))], firstType, (v) => {
          slot.type = v; slot.goal = guide.targets.findIndex((t) => t.type === v);
          const options = pair.firstOptions.find((o) => o.type === v)?.values ?? [];
          slot.value = options.length === 1 ? options[0][0] : null; invalidate();
        }, { key: "practical-current-type-0", ariaLabel: "현재 첫 줄 옵션" });
        const value = searchableSelect([{ value: "", label: "수치 선택" }, ...(entry?.values ?? []).map(([v]) => ({ value: String(v), label: `${v}${getAbilityOption(firstType)?.unit ?? ""}` }))],
          slot.value === null ? "" : String(slot.value), (v) => { slot.value = v === "" ? null : Number(v); invalidate(); },
          { key: "practical-current-value-0", ariaLabel: "현재 첫 줄 수치", disabled: !entry });
        row.append(element("small", "", "1줄"), type, value, element("small", "ability-stepper-lock", ""));
        current.append(row); return;
      }
      const type = searchableSelect([{ value: "-1", label: "목표 미확보" }, ...eligible], String(slot.goal), (v) => {
        slot.goal = Number(v); slot.value = slot.goal >= 0 && guide.values[slot.goal].length === 1 ? guide.values[slot.goal][0] : null;
        if (f.locked && !bits(f.locked).every((i) => f.slots.some((s, n) => n > 0 && s.goal === i && s.value !== null))) f.locked = 0;
        invalidate();
      }, { key: `practical-current-type-${line}`, ariaLabel: `${line + 1}번째 줄 현재 옵션`, disabled: f.kind !== "lower" });
      const values = slot.goal < 0 ? [] : guide.values[slot.goal];
      const value = searchableSelect([{ value: "", label: "미확보" }, ...[...values].sort((a, b) => b - a).map((v) => ({ value: String(v), label: `${v}${unit(slot.goal)}` }))],
        slot.value === null ? "" : String(slot.value), (v) => {
          slot.value = v === "" ? null : Number(v);
          if (f.kind === "lower" && slot.value === null) f.locked &= ~(1 << slot.goal);
          if (f.kind === "honor") Object.assign(f, toFinish(f, pair));
          invalidate();
        }, { key: `practical-current-value-${line}`, ariaLabel: `${line + 1}번째 줄 현재 수치`, disabled: slot.goal < 0 || (line === 0 && ["roll", "chaos"].includes(f.kind) && !f.firstAvailable) || f.kind === "done" });
      const locked = !["roll", "chaos", "reference"].includes(f.kind) && slot.goal >= 0 && (f.locked & (1 << slot.goal));
      row.append(element("small", "", `${line + 1}줄`), type, value, element("small", "ability-stepper-lock", locked ? "잠금" : ""));
      current.append(row);
    });
  }
  function lowerStep() {
    const f = frame();
    title.textContent = f.locked ? "남은 아랫줄 확보" : "첫 아랫줄 확보";
    const lockedGoal = bits(f.locked)[0];
    const rule = f.locked ? guide.one.find((s) => s.targetIndex === lockedGoal && s.value === slotFor(lockedGoal)?.value) : guide.start;
    if (!rule) { f.locked = 0; lowerStep(); return; }
    body.append(element("p", "", f.locked
      ? `잠근 옵션을 유지하고 ${method}으로 남은 아랫줄을 맞추세요.`
      : "두 번째·세 번째 줄에 다음 조건의 옵션이 나오면 해당 줄을 잠그세요."));
    const list = element("ul", "ability-stepper-conditions"), choices = [];
    for (const i of [0, 1, 2]) {
      const accepted = rule.decisions.filter((d) => (d.found & ~rule.mask) === (1 << i) && (d.keep & (1 << i)));
      const values = [...new Set(accepted.map((d) => d.values[i]))].sort((a, b) => a - b);
      if (!values.length) continue;
      choices.push({ goal: i, values });
      const text = values.length > 2 && values.every((v, n) => !n || v === values[n - 1] + 1) ? `${values[0]}~${values.at(-1)}` : values.join("·");
      list.append(element("li", "", `${label(i, text)} → 잠금`));
    }
    body.append(list);
    nextState = lowerResult(f, rule);
    if (nextState) {
      message.textContent = `${bits(nextState.locked).map((i) => guide.names[i]).join(" + ")} 잠금 후 > 버튼을 누르세요.`;
      return;
    }
    // Completing a stage fills its first displayed condition. A manually
    // selected eligible option takes precedence. Keep the previous snapshot
    // untouched so back/forward navigation never acquires another option.
    const selected = (goal) => f.slots.slice(1).some((s) => s.goal === goal);
    choices.sort((a, b) => Number(selected(b.goal)) - Number(selected(a.goal)));
    for (const { goal, values } of choices) {
      const state = structuredClone(f);
      let line = state.slots.findIndex((s, n) => n > 0 && s.goal === goal);
      if (line < 0) line = state.slots.findIndex((s, n) => n > 0 && !(f.locked & (1 << s.goal)));
      if (line < 0) continue;
      const previous = state.slots[line];
      const value = previous.goal === goal && values.includes(previous.value) ? previous.value : values[0];
      state.slots = state.slots.map((s, n) => {
        if (n === line) return { goal, value };
        if (n === 0 ? s.goal === goal : !(f.locked & (1 << s.goal))) return { goal: -1, value: null };
        return s;
      });
      nextState = lowerResult(state, rule);
      if (nextState) {
        message.textContent = `>를 누르면 ${label(goal, value)} 확보로 입력됩니다. 실제 옵션과 다르면 위에서 수정하세요.`;
        return;
      }
    }
    message.textContent = "표시된 잠금 조건이 될 때까지 재설정하세요. 수치는 옵션을 확보했을 때만 바꾸면 됩니다.";
  }
  function firstStep(pair) {
    const f = frame(), i = goalIndex(pair.targets[0]);
    title.textContent = `첫 줄 ${guide.names[i]} 확보`;
    body.append(element("p", "", `아랫줄 두 옵션을 잠그고 ${method}하세요. ${guide.names[i]}은 낮은 수치도 가능합니다.`));
    if (guide.method === "advanced") body.append(element("small", "", "다른 종류가 나오면 기존 결과를 유지하세요."));
    const state = structuredClone(f);
    if (state.slots[0].value === null) state.slots[0].value = Math.min(...guide.values[i]);
    nextState = completed(pair, state) === 7 ? toFinish(state, pair) : { ...state, kind: pair.mixed ? "chaos" : "roll", firstAvailable: true };
    message.textContent = `>를 누르면 ${label(i, state.slots[0].value)} 확보로 입력됩니다. 실제 수치는 위에서 수정할 수 있습니다.`;
  }
  function chaosStep(pair) {
    const f = frame(), focus = pair.practical.focusMask;
    const model = f.firstAvailable ? pair.full : Object.values(pair.models)[0];
    const remaining = f.exhausted ? 0 : f.chaosRemaining ?? pair.chaosCount;
    const bands = model.chaos.actionBands;
    const band = bands.findLast((b) => b.remaining <= remaining);
    const stopMasks = [...new Set(model.states.filter((s, i) => band.actions[i] === "black").map((s) => s.mask))];
    const mask = completed(pair);
    title.textContent = "카서큘로 수치 맞추기";
    body.append(element("p", "", `최대 ${pair.chaosCount}개까지 사용하세요. 수치가 낮아져도 새 결과가 적용됩니다.`));
    // Only policies whose stop condition changes with stock need another input.
    if (bands.filter((b) => b.remaining > 0).length > 1) body.append(field("남은 카서큘", numberInput(remaining, (v) => {
      f.chaosRemaining = Math.min(pair.chaosCount, Math.max(0, Math.floor(Number(v) || 0)));
      f.exhausted = f.chaosRemaining === 0; invalidate();
    }, { min: 0, max: pair.chaosCount, inputMode: "numeric" })));
    const list = element("ul", "ability-stepper-conditions");
    const minimal = stopMasks.filter((m) => !stopMasks.some((other) => other !== m && (m & other) === other));
    if (remaining) for (const m of minimal) {
      const names = bits(m).map((i) => `${pair.names[i]} ${pair.targets[i].minimum}${getAbilityOption(pair.targets[i].type).unit ?? ""}`);
      list.append(element("li", "", `${names.join(" + ") || "현재 수치"} → 카서큘 중단 후 다음 단계`));
    }
    body.append(list);
    const exhausted = chip(`카서큘 ${pair.chaosCount}개를 모두 사용했어요`, Boolean(f.exhausted), () => { f.exhausted = !f.exhausted; invalidate(); });
    exhausted.dataset.stepperExhausted = ""; body.append(exhausted);
    if (!remaining || stopMasks.includes(mask)) {
      const state = { ...structuredClone(f), exhausted: false };
      nextState = (mask & focus) === focus || !pair.blackCount ? toFinish(state, pair) : { ...state, kind: "roll" };
    }
    message.textContent = "중단 조건이 되거나 모두 사용했다면 위 수치를 수정하고 > 버튼을 누르세요.";
  }
  function rollStep(pair) {
    const f = frame();
    const count = pair.mixed ? pair.blackCount : pair.count;
    title.textContent = `${item}로 수치 맞추기`;
    const focus = pair.practical.focusMask;
    body.append(element("p", "", `최대 ${count}개까지 사용하세요. ${focus === 7 ? "세 목표" : "아랫줄 두 목표"} 완성 시 다음 단계로 넘어갑니다.`));
    const table = element("table", "ability-practical-priority");
    table.append(element("caption", "", "위에 있는 조합 우선 · 같은 조합은 기존 결과 유지"));
    const tbody = element("tbody");
    const possible = new Set(pair.full.states.map((s) => s.mask & focus));
    pair.practical.maskOrder.filter((m) => possible.has(m)).forEach((mask, i) => {
      const row = element("tr"); row.dataset.mask = String(mask);
      const names = bits(mask).map((n) => `${pair.names[n]} ${pair.targets[n].minimum}${getAbilityOption(pair.targets[n].type).unit ?? ""}`);
      row.append(element("td", "", String(i + 1)), element("td", "", names.join(" + ") || "목표 수치에 도달한 옵션 없음"));
      tbody.append(row);
    });
    table.append(tbody); body.append(table);
    const exhausted = chip(`${count}개를 모두 사용했어요`, Boolean(f.exhausted), () => { f.exhausted = !f.exhausted; invalidate(); });
    exhausted.dataset.stepperExhausted = ""; body.append(exhausted);
    if ((completed(pair) & focus) === focus || f.exhausted) nextState = toFinish(structuredClone(f), pair);
    message.textContent = "사용을 마쳤을 때 위 3줄을 현재 수치로 바꾸고 > 버튼을 누르세요.";
  }
  function honorStep(pair) {
    const f = frame(), mask = completed(pair), rule = pair.continuations[f.initialMask].lockRules.find((r) => r.lockedMask === f.kept);
    title.textContent = `${method}으로 남은 목표 맞추기`;
    if (mask === 7) { nextState = { ...structuredClone(f), kind: "done", locked: 7 }; message.textContent = "세 목표가 완성되었습니다. > 버튼으로 확인하세요."; return; }
    const outcomes = rule?.outcomes ?? [];
    const accepted = outcomes.filter((r) => r.keepMask !== f.kept);
    // Show the minimum triggering sets; supersets follow the same single task.
    const minimums = accepted.filter((r) => !accepted.some((other) => other !== r && other.completedMask !== r.completedMask && (other.completedMask & r.completedMask) === other.completedMask));
    body.append(element("p", "", `표시된 잠금을 유지하고 ${method}하세요. 다음 조건의 옵션이 나오면 잠그세요.`));
    const list = element("ul", "ability-stepper-conditions");
    for (const r of minimums) {
      const appeared = bits(r.completedMask & ~f.kept).map((i) => label(goalIndex(pair.targets[i]), pair.targets[i].minimum)).join(" + ");
      const action = (r.keepMask & ~f.kept) === (r.completedMask & ~f.kept) ? "잠금"
        : bits(r.keepMask & ~f.kept).map((i) => pair.names[i]).join(" + ") + "만 잠금";
      list.append(element("li", "", `${appeared} → ${action}`));
    }
    body.append(list);
    const matched = outcomes.find((r) => r.completedMask === (mask | f.kept));
    if (matched && matched.keepMask !== f.kept) nextState = { ...structuredClone(f), kept: matched.keepMask, locked: globalMask(pair, matched.keepMask) };
    message.textContent = "다음 목표가 나오면 위 수치를 바꾸고 > 버튼을 누르세요.";
  }
  function referenceStep(pair) {
    const f = frame(), firstType = f.slots[0].type ?? guide.targets[f.slots[0].goal]?.type ?? "";
    const entry = pair.firstOptions.find((o) => o.type === firstType);
    const values = [f.slots[0].value, ...pair.targets.slice(1).map((t) => slotFor(goalIndex(t))?.value)];
    const choice = entry && chooseAbilityEconomicAction(pair, firstType, values, f.remaining);
    title.textContent = "현재 옵션 확인";
    if (!choice) { body.append(element("p", "", "위 현재 어빌리티에서 첫 줄 옵션과 수치를 선택하세요.")); return; }
    if (choice.action === "direct") {
      title.textContent = choice.mask === 7 ? "목표 완성" : "명성치로 마무리";
      body.append(element("p", "", choice.mask === 7 ? "세 줄의 목표 수치가 완성되었습니다." : "완성한 옵션을 유지하고 명성치로 남은 목표를 맞추세요."));
      nextState = toFinish(structuredClone(f), pair);
      return;
    }
    if (choice.action === "acquire") {
      const target = pair.targets[0], goal = goalIndex(target), state = structuredClone(f);
      title.textContent = `첫 줄 ${pair.names[0]} 확보`;
      body.append(element("p", "", `아랫줄 두 옵션을 잠그고 ${method}하세요. ${pair.names[0]}은 낮은 수치도 가능합니다.`));
      state.slots[0] = { goal, type: target.type, value: Math.min(...guide.values[goal]) };
      nextState = state;
      message.textContent = ">를 누르면 첫 줄 확보로 입력됩니다. 실제 수치는 위에서 수정할 수 있습니다.";
      return;
    }
    title.textContent = `${item}로 수치 맞추기`;
    if (!guide.unlimited) body.append(element("p", "", `남은 ${f.remaining}개 안에서 사용하세요. 아래에서 기존 결과와 새 결과를 비교할 수 있습니다.`));
    const same = firstType === pair.targets[0].type, model = choice.model;
    body.append(renderValueGuide({ ...model, itemMethod: guide.itemMethod, compact: true, initialValues: [...values],
      states: same ? model.states : model.states.map((s) => ({ ...s, values: [entry.values[s.values[0]][0], ...s.values.slice(1)] })),
      targets: [{ ...pair.targets[0], type: firstType }, ...pair.targets.slice(1)],
      labels: [`첫 번째 줄 ${entry.label}`, ...pair.labels.slice(1)], shortLabels: [same ? pair.names[0] : "첫 줄", ...pair.names.slice(1)],
      keepMasks: pair.keepMasks, maximumUses: f.remaining, unlimited: guide.unlimited,
      onContinue: (selected, left) => {
        const state = structuredClone(f); state.remaining = left;
        state.slots[0].value = selected[0];
        pair.targets.slice(1).forEach((t, i) => { slotFor(goalIndex(t), state).value = selected[i + 1]; });
        move(state);
      },
    }));
    const exhausted = chip("남은 심서큘을 모두 사용했어요", false, () => move({ ...structuredClone(f), remaining: 0 }));
    exhausted.removeAttribute("aria-pressed"); exhausted.dataset.stepperExhausted = "";
    if (!guide.unlimited) body.append(exhausted);
    message.textContent = "사용을 마쳤다면 위 3줄을 실제 수치로 수정하세요.";
  }
  function paint() {
    nextState = null; body.replaceChildren(); message.textContent = "";
    const f = frame(), pair = pairFor();
    paintCurrent();
    if (f.kind === "lower") lowerStep();
    else if (f.kind === "first") firstStep(pair);
    else if (f.kind === "roll") rollStep(pair);
    else if (f.kind === "chaos") chaosStep(pair);
    else if (f.kind === "honor") honorStep(pair);
    else if (f.kind === "reference") referenceStep(pair);
    else { title.textContent = "목표 완성"; body.append(element("p", "", "세 줄의 목표를 모두 완성했습니다.")); }
    prev.disabled = index === 0;
    next.disabled = index === histories.length - 1 && !nextState;
    next.setAttribute("aria-label", index < histories.length - 1 ? "다음 단계" : "현재 단계 완료 후 다음 단계");
    root.dataset.step = f.kind;
    root.dataset.stepIndex = String(index);
  }
  paint();
  return root;
}
