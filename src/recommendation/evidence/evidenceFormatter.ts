import {
  EVIDENCE_CONFIG as config,
  type EvidenceInput,
  type EvidenceResult,
  type RecommendationEvidence,
} from "./contracts";
import { candidateAbstractReference, matchedLabels } from "./evidenceRetriever";
import { textMatch } from "../ranking/textSimilarity";
import { rankEvidence } from "./evidenceRanker";

export function formatEvidence(
  input: EvidenceInput,
  supplied: readonly RecommendationEvidence[],
  warnings: readonly string[] = [],
): EvidenceResult {
  const ranked = rankEvidence(
    supplied.filter((e) => e.candidateId === input.candidate.candidateId),
  );
  // Candidate abstract is the only direct external-paper evidence currently available.
  // Library notes/content establish user context, never claims about the new paper.
  const direct = ranked.find(
    (e) =>
      e.reference === candidateAbstractReference(input.candidate.candidateId),
  );
  const evidence = [
    ...(direct ? [direct] : []),
    ...ranked.filter((e) => e !== direct),
  ].slice(0, config.maxPerRecommendation);
  const labels = direct
    ? matchedLabels(input)
        .filter((t) => textMatch(direct.snippet, t) === 1)
        .slice(0, 4)
    : [];
  const supported = labels.length > 0;
  const reason = Object.freeze({
    summary: (supported
      ? `The supplied candidate abstract contains profile topic(s): ${labels.join("; ")}. Library evidence, when present, describes the interest context only.`
      : "Insufficient evidence to explain this paper's relevance to the matched profile topics."
    ).slice(0, config.maxSummaryChars),
    matchedTopics: Object.freeze(labels),
    evidenceRefs: Object.freeze(supported ? [direct!.evidenceId] : []),
    confidence: supported ? direct!.confidence : 0,
  });
  // Bound serialized evidence + reason (including escaping), not just snippet lengths.
  while (
    evidence.length &&
    JSON.stringify({ evidence, reason }).length > config.maxExplanationChars
  )
    evidence.pop();
  if (
    reason.evidenceRefs.some(
      (ref) => !evidence.some((e) => e.evidenceId === ref),
    )
  )
    return formatEvidence(
      input,
      [],
      [...warnings, "evidence_output_truncated"],
    );
  return Object.freeze({
    evidence: Object.freeze(evidence),
    reason,
    warnings: Object.freeze([
      ...new Set([
        ...warnings,
        ...(!supported ? ["evidence_unavailable"] : []),
      ]),
    ]),
  });
}
