export const MAX_TOPIC_LABEL_CHARS = 160;

/** Preserve punctuation and accents: C, C++, and C# are different topics. */
export function normalizeTopic(label: unknown): { key: string; label: string } {
  if (typeof label !== "string") throw new TypeError("Invalid topic label");
  const display = label.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (
    !display ||
    display.length > MAX_TOPIC_LABEL_CHARS ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(display) ||
    !/[\p{L}\p{N}]/u.test(display)
  ) {
    throw new TypeError("Invalid topic label");
  }
  return { key: display.toLowerCase().normalize("NFC"), label: display };
}

/** Code-point ordering is stable across OS locales. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function evidenceRef(
  kind: "paper" | "tag" | "collection" | "preference" | "llm",
  id: string,
): string {
  return `${kind}:${encodeURIComponent(id)}`;
}

export function topicId(key: string): string {
  return `topic:${encodeURIComponent(key)}`;
}

/** Retain a paper, source and preference witnesses before filling with more papers. */
export function selectEvidenceRefs(
  refs: ReadonlySet<string>,
  limit: number,
): string[] {
  const sorted = [...refs].sort(compareText);
  const papers = sorted.filter((ref) => ref.startsWith("paper:"));
  return [
    ...papers.slice(0, 1),
    ...sorted.filter((ref) => !ref.startsWith("paper:")),
    ...papers.slice(1),
  ].slice(0, limit);
}
