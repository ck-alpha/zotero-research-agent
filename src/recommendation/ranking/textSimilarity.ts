export const clamp = (value: number): number => Math.max(0, Math.min(1, value));
export const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
export const normalizeText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ß/gu, "ss")
    .replace(/ς/gu, "σ")
    .trim()
    .replace(/\s+/gu, " ");
export const tokens = (value: string): Set<string> =>
  new Set(normalizeText(value).match(/[\p{L}\p{N}]+/gu) || []);
export function textMatch(candidate: string, label: string): number {
  const phrase = normalizeText(label);
  const topicTokens = tokens(phrase);
  if (!topicTokens.size) return 0;
  if (normalizeText(candidate).includes(phrase)) return 1;
  const candidateTokens = tokens(candidate);
  let overlap = 0;
  for (const token of topicTokens) if (candidateTokens.has(token)) overlap++;
  return overlap / topicTokens.size;
}
export function jaccard(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): number {
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  const union = a.size + b.size - overlap;
  return union ? overlap / union : 0;
}
export function candidateText(
  candidate: { title: string; abstract?: string },
  maxChars: number,
): string {
  return `${candidate.title}\n${candidate.abstract || ""}`.slice(0, maxChars);
}
