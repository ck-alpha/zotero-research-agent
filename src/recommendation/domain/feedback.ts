export type FeedbackAction = "positive" | "negative" | "save" | "skip";

/** Append-only event; save records a signal, it does not import a paper. */
export interface RecommendationFeedback {
  eventId: string;
  /** References a displayed candidateId in the associated impression. */
  paperId: string;
  recommendationId: string;
  action: FeedbackAction;
  timestamp: number;
}
