import type { ResearchProfile } from "../domain/profile";
import type { ResearchLibrarySnapshot } from "../profile/contracts";
import { profileIdForLibrary } from "../profile/identity";
import {
  resolveCandidateLimits,
  type CandidateDiscoveryLimits,
} from "./config";
import { normalizeDoi } from "./identity";

export interface PlannedSeed {
  doi: string;
  seedPaperId: string;
}

export function buildSeedPlan(
  profile: ResearchProfile,
  snapshot: ResearchLibrarySnapshot,
  overrides: Partial<CandidateDiscoveryLimits> = {},
): {
  seeds: PlannedSeed[];
  seedsSkippedWithoutDoi: number;
  seedsSkippedMissingPaper: number;
  warnings: string[];
} {
  if (profile.profileId !== profileIdForLibrary(snapshot.libraryID))
    throw new Error("Candidate seed profile/library scope mismatch");
  const limits = resolveCandidateLimits(overrides);
  const papers = new Map(snapshot.papers.map((paper) => [paper.itemId, paper]));
  const prefix = `${profile.profileId}:item:`;
  const seeds: PlannedSeed[] = [];
  const seen = new Set<string>();
  let seedsSkippedWithoutDoi = 0;
  let seedsSkippedMissingPaper = 0;
  for (const representative of profile.representativePapers) {
    if (seeds.length >= limits.maxSeeds) break;
    if (seen.has(representative.itemId)) continue;
    seen.add(representative.itemId);
    const paper = papers.get(representative.itemId);
    if (!representative.itemId.startsWith(prefix) || !paper) {
      seedsSkippedMissingPaper++;
      continue;
    }
    const doi = normalizeDoi(paper.doi);
    if (!doi) {
      seedsSkippedWithoutDoi++;
      continue;
    }
    seeds.push({ doi, seedPaperId: paper.itemId });
  }
  return {
    seeds,
    seedsSkippedWithoutDoi,
    seedsSkippedMissingPaper,
    warnings: [
      ...(!seeds.length ? ["candidate_no_usable_seeds"] : []),
      ...(seedsSkippedWithoutDoi ? ["candidate_seed_missing_doi"] : []),
      ...(seedsSkippedMissingPaper ? ["candidate_seed_missing_paper"] : []),
    ],
  };
}
