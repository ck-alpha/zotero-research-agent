import type {
  ExternalPaper,
  LiteratureDiscoveryBatch,
  LiteratureDiscoverySource,
  SeedRelatedRequest,
  TopicSearchRequest,
} from "../../recommendation/candidate/contracts";
import {
  normalizeArxivId,
  normalizeDoi,
  normalizeOpenAlexId,
} from "../../recommendation/candidate/identity";
import type { AgentToolContext } from "../types";
import type {
  LiteratureSearchService,
  SearchInput,
} from "./literatureSearchService";

/** The existing scholarly service remains the only provider implementation. */
export class AgentLiteratureDiscoverySource implements LiteratureDiscoverySource {
  constructor(
    private readonly service: Pick<LiteratureSearchService, "execute">,
    private readonly context: AgentToolContext,
  ) {}

  search(input: TopicSearchRequest): Promise<LiteratureDiscoveryBatch> {
    return this.execute(
      {
        mode: "search",
        source: "openalex",
        query: input.query,
        limit: input.limit,
      },
      input.signal,
    );
  }

  related(input: SeedRelatedRequest): Promise<LiteratureDiscoveryBatch> {
    const doi = normalizeDoi(input.doi);
    if (!doi) return Promise.reject(new Error("candidate_seed_doi_invalid"));
    // DOI only: passing a title/query would silently enable keyword fallback.
    return this.execute(
      { mode: "recommendations", source: "openalex", doi, limit: input.limit },
      input.signal,
    );
  }

  private async execute(
    input: SearchInput,
    requestSignal?: AbortSignal,
  ): Promise<LiteratureDiscoveryBatch> {
    const signal = requestSignal ?? this.context.signal;
    const checkCancelled = () => {
      if (signal?.aborted) {
        const error = new Error("Candidate discovery cancelled");
        error.name = "AbortError";
        throw error;
      }
    };
    checkCancelled();
    let result;
    try {
      result = await this.service.execute(input, { ...this.context, signal });
    } catch {
      checkCancelled();
      throw new Error("candidate_provider_unavailable");
    }
    checkCancelled();
    // The legacy search API reports some transport errors as empty results with
    // a message. Keep those distinct from a successful search with zero papers.
    if (!result || result.message)
      throw new Error("candidate_provider_unavailable");
    if (!Array.isArray(result.results))
      throw new Error("candidate_provider_invalid_result");
    const papers: ExternalPaper[] = result.results.map((paper) => {
      // Keep malformed rows in place so domain normalization can skip them
      // without losing valid siblings or changing providerRank positions.
      if (!paper || typeof paper !== "object" || !("title" in paper))
        return { title: "", authors: [], provider: "openalex" };
      return {
        title: paper.title,
        authors: Array.isArray(paper.authors) ? [...paper.authors] : [],
        year: paper.year,
        abstract: paper.abstract,
        doi: paper.doi,
        openAlexId: normalizeOpenAlexId(paper.sourceUrl),
        arxivId: normalizeArxivId(paper.sourceUrl),
        sourceUrl: paper.sourceUrl,
        openAccessUrl: paper.openAccessUrl,
        provider: "openalex",
      };
    });
    return {
      papers,
      warnings: result.warnings?.length ? ["candidate_provider_warning"] : [],
    };
  }
}
