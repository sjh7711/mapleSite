export const MAX_SAVED_CHARACTER_NAMES = 4;
export const SAVED_CHARACTER_NAMES_VERSION = 1;

const CHARACTER_NAME_PATTERN = /^[\p{L}\p{N}]+$/u;

export function normalizeCharacterName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim().normalize("NFC");
  const length = [...name].length;
  return length >= 2 && length <= 12 && CHARACTER_NAME_PATTERN.test(name)
    ? name
    : "";
}

function characterNameKey(value) {
  return normalizeCharacterName(value).toLowerCase();
}

export function normalizeSavedCharacterNames(value) {
  const source = Array.isArray(value)
    ? value
    : value?.version === SAVED_CHARACTER_NAMES_VERSION &&
        Array.isArray(value.names)
      ? value.names
      : [];
  const names = [];
  const keys = new Set();

  for (const candidate of source) {
    const name = normalizeCharacterName(candidate);
    const key = characterNameKey(name);
    if (!name || keys.has(key)) continue;
    names.push(name);
    keys.add(key);
    if (names.length === MAX_SAVED_CHARACTER_NAMES) break;
  }
  return names;
}

export function hasSavedCharacterName(names, candidate) {
  const key = characterNameKey(candidate);
  return Boolean(key) && normalizeSavedCharacterNames(names).some(
    (name) => characterNameKey(name) === key,
  );
}

export function addSavedCharacterName(names, candidate) {
  const current = normalizeSavedCharacterNames(names);
  const name = normalizeCharacterName(candidate);
  if (
    !name ||
    current.length >= MAX_SAVED_CHARACTER_NAMES ||
    hasSavedCharacterName(current, name)
  ) return current;
  return [...current, name];
}

export function removeSavedCharacterName(names, candidate) {
  const key = characterNameKey(candidate);
  if (!key) return normalizeSavedCharacterNames(names);
  return normalizeSavedCharacterNames(names).filter(
    (name) => characterNameKey(name) !== key,
  );
}
