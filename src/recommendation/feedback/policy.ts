import type { FeedbackAction } from "../domain/feedback";
import { assertNonEmptyId } from "../domain/validation";

export const FEEDBACK_STRENGTH = Object.freeze({
  positive: 0.7,
  save: 1,
  negative: -1,
  skip: -0.2,
});
export const FEEDBACK_HALF_LIFE_DAYS = 180;
export function feedbackEventId(
  recommendationId: string,
  candidateId: string,
  action: FeedbackAction,
): string {
  assertNonEmptyId(recommendationId);
  assertNonEmptyId(candidateId);
  if (!Object.hasOwn(FEEDBACK_STRENGTH, action))
    throw new TypeError("Invalid feedback action");
  // Length framing is collision-free even when opaque IDs contain separators.
  return `feedback:${recommendationId.length}:${recommendationId}${candidateId.length}:${candidateId}:${action}`;
}
export const saturateFeedback = (mass: number) => -Math.expm1(-mass / 2);
