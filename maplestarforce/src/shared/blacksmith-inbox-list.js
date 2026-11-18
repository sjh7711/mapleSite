// Waiting and working share the same queue position. Completion moves an
// application below that queue; older applications sit lower in the history.
const initialConsonants = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
function matchesNickname(nickname, query) {
  const name = [...nickname.normalize("NFC").toLowerCase()], letters = [...query];
  return name.some((_, start) => letters.every((letter, index) => {
    const character = name[start + index];
    if (letter === character) return true;
    const syllable = (character?.codePointAt(0) ?? 0) - 0xac00;
    return syllable >= 0 && syllable < 11172 && letter === initialConsonants[Math.floor(syllable / 588)];
  }));
}
/**
 * @template {{ id: string, nickname: string, status: string, createdAt: number }} T
 * @param {T[]} requests
 * @param {string | null} status
 * @param {string} search
 * @returns {T[]}
 */
export function inboxRequestsForView(requests, status = null, search = "") {
  const query = search.normalize("NFC").trim().toLowerCase();
  return requests.filter(item => (status === null || item.status === status || item.status === "blocked")
    && (!query || matchesNickname(item.nickname, query))).sort((left, right) => {
    const rank = item => item.status === "blocked" ? 2 : item.status === "done" ? 1 : 0;
    const group = rank(left) - rank(right);
    if (group) return group;
    const byDate = rank(left) ? right.createdAt - left.createdAt : left.createdAt - right.createdAt;
    return byDate || left.id.localeCompare(right.id);
  });
}
