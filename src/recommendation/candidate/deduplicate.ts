import type { RecommendationCandidate } from "../domain/candidate";
import type { ResearchLibrarySnapshot } from "../profile/contracts";
import {
  candidateIdentity,
  identitiesCompatible,
  paperIdentity,
  provenanceKey,
  samePaper,
  type PaperIdentity,
} from "./identity";

/** The index includes every eligible paper in the current library snapshot. */
function buildLibraryNoveltyIndex(snapshot: ResearchLibrarySnapshot) {
  const dois = new Set<string>();
  const bibliographic = new Map<string, PaperIdentity[]>();
  for (const paper of snapshot.papers) {
    const identity = paperIdentity(paper);
    if (identity.doi) dois.add(identity.doi);
    for (const key of identity.bibliographicKeys) {
      const records = bibliographic.get(key) ?? [];
      records.push(identity);
      bibliographic.set(key, records);
    }
  }
  return {
    has(candidate: RecommendationCandidate): boolean {
      const identity = paperIdentity(candidate);
      if (identity.doi && dois.has(identity.doi)) return true;
      return identity.bibliographicKeys.some((key) =>
        bibliographic.get(key)?.some((record) => samePaper(identity, record)),
      );
    },
  };
}

function mergeMetadata(
  first: RecommendationCandidate,
  later: RecommendationCandidate,
): RecommendationCandidate {
  const provenance = [...first.provenance, ...later.provenance].filter(
    (entry, index, entries) =>
      entries.findIndex(
        (other) => provenanceKey(other) === provenanceKey(entry),
      ) === index,
  );
  const merged: RecommendationCandidate = {
    ...first,
    abstract:
      (later.abstract?.length ?? 0) > (first.abstract?.length ?? 0)
        ? later.abstract
        : first.abstract,
    authors: first.authors.length ? [...first.authors] : [...later.authors],
    publicationDate: first.publicationDate ?? later.publicationDate,
    doi: first.doi ?? later.doi,
    arxivId: first.arxivId ?? later.arxivId,
    openAlexId: first.openAlexId ?? later.openAlexId,
    sourceUrl: first.sourceUrl ?? later.sourceUrl,
    openAccessUrl: first.openAccessUrl ?? later.openAccessUrl,
    provenance: provenance.map((entry) => ({ ...entry })),
    sources: [...new Set(provenance.map((entry) => entry.route))],
    seedPaperIds: [
      ...new Set(
        provenance.flatMap((entry) =>
          entry.route === "seed_recommendation" ? [entry.seedPaperId] : [],
        ),
      ),
    ],
    scores: {},
  };
  merged.candidateId = candidateIdentity(merged, merged.provenance[0]);
  return merged;
}

interface CandidateGroup {
  candidate: RecommendationCandidate;
  identities: PaperIdentity[];
  positions: number[];
}

function deduplicateCandidates(candidates: readonly RecommendationCandidate[]) {
  const groups: Array<CandidateGroup | undefined> = [];
  for (const [position, candidate] of candidates.entries()) {
    const identity = paperIdentity(candidate);
    let target: CandidateGroup | undefined;
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      if (
        !group ||
        !identitiesCompatible(paperIdentity(group.candidate), identity) ||
        !group.identities.some((previous) => samePaper(previous, identity)) ||
        (target &&
          !identitiesCompatible(
            paperIdentity(target.candidate),
            paperIdentity(group.candidate),
          ))
      )
        continue;
      if (!target) {
        target = group;
        group.candidate = mergeMetadata(group.candidate, candidate);
        group.identities.push(identity);
        group.positions.push(position);
      } else {
        target.candidate = mergeMetadata(target.candidate, group.candidate);
        target.identities.push(...group.identities);
        target.positions.push(...group.positions);
        groups[index] = undefined;
      }
    }
    if (!target)
      groups.push({
        candidate: mergeMetadata(candidate, candidate),
        identities: [identity],
        positions: [position],
      });
  }
  // A late identifier bridge can join earlier groups. Reapply metadata and
  // provenance in original discovery order, not group-union order.
  const result = groups.flatMap((group) => {
    if (!group) return [];
    const ordered = group.positions
      .sort((a, b) => a - b)
      .map((position) => candidates[position]);
    return [ordered.reduce(mergeMetadata)];
  });
  return {
    candidates: result,
    duplicateCandidatesMerged: candidates.length - result.length,
  };
}

export function buildNovelCandidatePool(
  candidates: readonly RecommendationCandidate[],
  snapshot: ResearchLibrarySnapshot,
  maxCandidatePool: number,
): {
  candidates: RecommendationCandidate[];
  existingLibraryExcluded: number;
  duplicateCandidatesMerged: number;
  poolTruncated: boolean;
} {
  if (!Number.isSafeInteger(maxCandidatePool) || maxCandidatePool < 1)
    throw new TypeError("maxCandidatePool must be a positive safe integer");
  const library = buildLibraryNoveltyIndex(snapshot);
  const novel = candidates.filter((candidate) => !library.has(candidate));
  const deduplicated = deduplicateCandidates(novel);
  return {
    candidates: deduplicated.candidates.slice(0, maxCandidatePool),
    existingLibraryExcluded: candidates.length - novel.length,
    duplicateCandidatesMerged: deduplicated.duplicateCandidatesMerged,
    poolTruncated: deduplicated.candidates.length > maxCandidatePool,
  };
}
