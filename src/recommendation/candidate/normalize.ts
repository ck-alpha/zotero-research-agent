import type {
  CandidateDiscoveryProvider,
  CandidateProvenance,
  RecommendationCandidate,
} from "../domain/candidate";
import { assertCandidateProvenance } from "../domain/validation";
import {
  candidateIdentity,
  normalizeArxivId,
  normalizeBibliographicText,
  normalizeDoi,
  normalizeOpenAlexId,
  normalizePublicationYear,
} from "./identity";

const providers: readonly CandidateDiscoveryProvider[] = [
  "openalex",
  "arxiv",
  "europepmc",
];

function webUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** Invalid external rows are skipped; optional incomplete metadata is retained. */
export function normalizeExternalPaper(
  paper: unknown,
  provenance: CandidateProvenance,
): RecommendationCandidate | null {
  assertCandidateProvenance(provenance);
  if (!paper || typeof paper !== "object" || Array.isArray(paper)) return null;
  const input = paper as Record<string, unknown>;
  const title = normalizeBibliographicText(input.title);
  if (
    !title ||
    !providers.includes(input.provider as CandidateDiscoveryProvider) ||
    input.provider !== provenance.provider
  )
    return null;
  const authors = Array.isArray(input.authors)
    ? [
        ...new Set(
          input.authors
            .map(normalizeBibliographicText)
            .filter((author): author is string => !!author),
        ),
      ]
    : [];
  const metadata = {
    title,
    authors,
    abstract: normalizeBibliographicText(input.abstract),
    publicationDate:
      typeof input.year === "number"
        ? normalizePublicationYear(input.year)
        : undefined,
    doi: normalizeDoi(input.doi),
    arxivId: normalizeArxivId(input.arxivId),
    openAlexId: normalizeOpenAlexId(input.openAlexId),
    sourceUrl: webUrl(input.sourceUrl),
    openAccessUrl: webUrl(input.openAccessUrl),
  };
  return {
    candidateId: candidateIdentity(metadata, provenance),
    ...metadata,
    sources: [provenance.route],
    seedPaperIds:
      provenance.route === "seed_recommendation"
        ? [provenance.seedPaperId]
        : [],
    provenance: [{ ...provenance }],
    scores: {},
  };
}
