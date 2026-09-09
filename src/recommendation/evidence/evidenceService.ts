import { EVIDENCE_CONFIG } from "./contracts";
import {
  type EvidenceContentSource,
  type EvidenceInput,
  type EvidenceResult,
} from "./contracts";
import { retrieveEvidence } from "./evidenceRetriever";
import { formatEvidence } from "./evidenceFormatter";
import { checkCancelled } from "../ranking/semantic";

/** No model dependency: deterministic formatting is also the model-free fallback. */
export class RecommendationEvidenceService {
  private readonly deadline = Date.now() + EVIDENCE_CONFIG.totalSourceBudgetMs;
  constructor(private readonly source?: EvidenceContentSource) {}
  async explain(input: EvidenceInput): Promise<EvidenceResult> {
    if (!Number.isSafeInteger(input.now) || input.now < 0)
      throw new TypeError("Invalid evidence time");
    try {
      const result = await retrieveEvidence(input, this.source, this.deadline);
      return formatEvidence(input, result.evidence, result.warnings);
    } catch {
      checkCancelled(input.signal);
      return formatEvidence(input, [], ["evidence_partial_failure"]);
    }
  }
}
