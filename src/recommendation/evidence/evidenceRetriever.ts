import {
  EVIDENCE_CONFIG as config,
  assertRecommendationEvidence,
  type EvidenceContentSource,
  type EvidenceInput,
  type RecommendationEvidence,
  type EvidenceSourceType,
} from "./contracts";
import { evidenceConfidence } from "./evidenceRanker";
import { compareText, textMatch } from "../ranking/textSimilarity";
import { checkCancelled } from "../ranking/semantic";

export const candidateAbstractReference = (candidateId: string) =>
  `candidate:${encodeURIComponent(candidateId)}#abstract`;
export function matchedLabels(input: EvidenceInput): string[] {
  return input.profile.topics
    .filter((t) => input.candidate.matchedTopicIds.includes(t.id))
    .map((t) => t.label)
    .sort(compareText);
}
/** Extract an original contiguous window; never synthesize evidence from titles. */
function excerpt(text: string, topics: readonly string[]): string {
  const bounded = text.slice(0, config.maxScanChars);
  let best = bounded.slice(0, config.maxSnippetChars).trim(),
    score = -1;
  for (let i = 0; i < bounded.length; i += config.maxSnippetChars / 2) {
    const part = bounded.slice(i, i + config.maxSnippetChars).trim();
    const match = Math.max(0, ...topics.map((t) => textMatch(part, t)));
    if (match > score) {
      best = part;
      score = match;
    }
  }
  return best;
}
async function boundedRead<T>(
  read: () => Promise<T>,
  signal?: AbortSignal,
  remainingMs: number = config.sourceTimeoutMs,
): Promise<T> {
  checkCancelled(signal);
  if (remainingMs <= 0) throw new Error("Evidence source budget exhausted");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Evidence source timeout")),
          Math.min(config.sourceTimeoutMs, remainingMs),
        );
        abort = () => reject(new Error("Evidence retrieval cancelled"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}
export async function retrieveEvidence(
  input: EvidenceInput,
  source?: EvidenceContentSource,
  deadline = Date.now() + config.totalSourceBudgetMs,
): Promise<{ evidence: RecommendationEvidence[]; warnings: string[] }> {
  checkCancelled(input.signal);
  const topics = matchedLabels(input),
    evidence: RecommendationEvidence[] = [],
    warnings: string[] = [];
  const add = (
    sourceType: EvidenceSourceType,
    reference: string,
    text: string,
    sourceTime?: number,
  ) => {
    const snippet = excerpt(text, topics);
    if (!snippet) return;
    if (
      reference.startsWith("library:") &&
      !topics.some((t) => textMatch(snippet, t) > 0)
    )
      return;
    const item = Object.freeze({
      evidenceId: `${input.candidate.candidateId}:e${evidence.length + 1}`,
      candidateId: input.candidate.candidateId,
      sourceType,
      reference,
      snippet,
      confidence: evidenceConfidence(
        snippet,
        topics,
        sourceType,
        sourceTime,
        input.now,
      ),
      createdAt: input.now,
    });
    assertRecommendationEvidence(item);
    if (!evidence.some((e) => e.reference === reference)) evidence.push(item);
  };
  const refs = new Set(input.candidate.seedPaperIds ?? []);
  for (const topic of input.profile.topics.filter((t) =>
    input.candidate.matchedTopicIds.includes(t.id),
  )) {
    for (const ref of topic.evidenceRefs) {
      if (ref.startsWith("paper:")) {
        try {
          refs.add(decodeURIComponent(ref.slice(6)));
        } catch {
          /* malformed legacy reference */
        }
      }
    }
  }
  const papers = input.snapshot.papers
    .filter((p) => refs.has(p.itemId))
    .sort((a, b) => compareText(a.itemId, b.itemId))
    .slice(0, config.maxLibraryPapers);
  for (const p of papers) {
    for (const [field, values] of [
      ["tags", [...p.manualTags, ...p.automaticTags]],
      ["collections", p.collectionPaths],
    ] as const) {
      const relevant = [...values]
        .filter((v) => topics.some((t) => textMatch(v, t) === 1))
        .sort(compareText);
      if (relevant.length)
        add(
          "library_metadata",
          `${p.itemId}#${field}`,
          relevant.join("; "),
          p.modifiedAt,
        );
    }
    if (source) {
      for (const [kind, read] of [
        ["library_note", () => source.notes(p.itemId)],
        ["paper_content", () => source.content(p.itemId)],
      ] as const) {
        try {
          const records = await boundedRead(
            read,
            input.signal,
            deadline - Date.now(),
          );
          for (const r of records.slice(0, config.maxSourceRecords)) {
            if (!r.reference.startsWith(`${p.itemId}#`))
              throw new TypeError("Evidence reference scope mismatch");
            add(kind, r.reference, r.text);
          }
        } catch {
          checkCancelled(input.signal);
          warnings.push("evidence_partial_failure");
        }
      }
    }
    if (p.abstract) add("abstract", `${p.itemId}#abstract`, p.abstract);
  }
  if (input.candidate.abstract)
    add(
      "abstract",
      candidateAbstractReference(input.candidate.candidateId),
      input.candidate.abstract,
    );
  checkCancelled(input.signal);
  return { evidence, warnings: [...new Set(warnings)] };
}
