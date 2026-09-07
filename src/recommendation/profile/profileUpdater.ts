import type { ExplicitPreferences } from "../domain/profile";
import { assertExplicitPreferences } from "../domain/validation";
import { normalizeTopic } from "./topicNormalization";

export const MAX_EXPLICIT_PREFERENCES_PER_POLARITY = 100;

/** Validated full replacement, never natural-language parsing or model state. */
export function validatePreferenceUpdate(
  value: unknown,
  now: number,
): ExplicitPreferences {
  assertExplicitPreferences(value);
  const seenIds = new Set<string>();
  for (const records of [value.positiveTopics, value.negativeTopics]) {
    if (records.length > MAX_EXPLICIT_PREFERENCES_PER_POLARITY)
      throw new TypeError("Too many explicit preferences");
    const keys = new Set<string>();
    for (const preference of records) {
      const { key } = normalizeTopic(preference.label);
      if (keys.has(key) || seenIds.has(preference.id))
        throw new TypeError("Duplicate preference identity");
      if (
        preference.createdAt > preference.updatedAt ||
        preference.updatedAt > now
      )
        throw new TypeError("Invalid preference timestamps");
      keys.add(key);
      seenIds.add(preference.id);
    }
  }
  return JSON.parse(JSON.stringify(value)) as ExplicitPreferences;
}
