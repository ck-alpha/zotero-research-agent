# Codex Prompt — Phase 5: Impression + Feedback + Profile Learning Loop

## Project

**Personalized Research Intelligence Agent**

Repository:

```text
https://github.com/ck-alpha/zotero-research-agent
```

Verified repository state:

```text
Phase 4 implementation commit:
743e0b813fa4aad8bb730f4fa35ab215c3388211

Phase 4 tag:
phase-4

Current remote main:
5fa52194677fff1054b5da874e55bb99a62742a7
message: docs: record phase 4 remote delivery
```

Historical checkpoints:

```text
phase-3: 474e2b73c419ddfdd10a786a3726b942585ed034
phase-2: 279ccc62d959a52a518dff7a812c3a1856d1966b
phase-1: 10ed87677bc2afdfe17ede174f80f23834fdc500
upstream baseline: 5be02f51a9bdf9b143439c95eed07bd62a34cb68
```

Start Phase 5 from the current remote `main`, not by moving or rewriting `phase-4`.

---

# 0. Read Before Coding

Before modifying code, read:

```text
docs/research_agent_architecture_baseline.md
docs/development-log.md
```

Then inspect:

```text
src/recommendation/domain/
src/recommendation/profile/
src/recommendation/candidate/
src/recommendation/ranking/

src/agent/tools/recommendation/researchRecommend.ts
src/agent/tools/recommendation/researchProfileGet.ts
src/agent/tools/recommendation/researchCandidateDiscover.ts
src/agent/tools/recommendation/shared.ts
src/agent/tools/index.ts

src/recommendation/profile/profileStore.ts
src/recommendation/profile/profileService.ts
src/recommendation/profile/profileBuilder.ts
src/recommendation/profile/profileUpdater.ts

test/helpers/recommendationStores.ts
test/helpers/researchProfileDb.ts
```

Also inspect existing Agent write/confirmation infrastructure only to preserve boundaries:

```text
src/agent/tools/registry.ts
src/agent/store/changeJournal.ts
src/agent/services/mutationCoordinator.ts
src/agent/tools/write/
```

Do not reuse Zotero content-write machinery for internal recommendation-memory writes unless the current framework requires it.

---

# 1. Phase 5 Goal

Phase 5 closes the personalization loop:

```text
research_recommend
      ↓
Persist RecommendationImpression
      ↓
return recommendationId
      ↓
User gives feedback
      ↓
recommendation_feedback
      ↓
Validate:
recommendationId
+ candidateId
+ profile scope/version
      ↓
Append-only Feedback Event
      ↓
Deterministic Feedback Signals
      ↓
Profile Rebuild / CAS Update
      ↓
New ResearchProfile Version
      ↓
Future recommendation changes
```

The key objective is:

> Make reactions to actually displayed recommendations durable, traceable and replayable personalization signals.

This is not merely a feedback button phase.

---

# 2. Hard Scope Boundary

Phase 5 MAY implement:

- production ImpressionStore;
- production FeedbackStore;
- recommendationId generation;
- impression persistence from `research_recommend`;
- idempotent feedback handling;
- impression/candidate/profile integrity validation;
- deterministic feedback-strength policy;
- feedback-derived topic signals;
- feedback-derived profile counts;
- feedback-aware ProfileBuilder/ProfileService;
- feedback replay/reconciliation;
- `recommendation_feedback`;
- tests;
- small domain/store contract extensions;
- architecture/log updates.

Phase 5 MUST NOT implement:

- automatic Zotero import on `save`;
- PDF/RAG evidence enrichment;
- recommendation UI;
- Scheduler/digest;
- research-intelligence Skill;
- autonomous monitoring;
- learning-to-rank;
- RL;
- LLM feedback interpretation;
- freeform preference extraction;
- vector database;
- feedback-trained embedding;
- cross-device sync;
- recommendation history UI;
- Multi-Agent;
- GraphRAG.

Record later-stage needs in `docs/development-log.md`.

---

# 3. Architecture Rules

Keep all existing red lines.

Add these Phase 5 rules:

1. Feedback events are append-only source of truth.
2. Profile feedback state must be reproducible from durable feedback + impressions.
3. Do not mutate topic weights in-place without replayable evidence.
4. `save` means strong positive feedback only; it does not import to Zotero.
5. Feedback must reference a persisted displayed recommendation.
6. The model must not invent recommendation/candidate scope.
7. A failed Profile CAS must not delete a valid recorded feedback event.
8. Identical Tool retries must not double-count feedback.

---

# 4. Host Smoke Test Remains Pending

The Phase 4 log still reports real Zotero/OpenAlex/embedding smoke as not executed.

If Zotero is available, attempt smoke tests for:

```text
research_profile_get
research_candidate_discover
research_recommend
```

If unavailable:

- do not block Phase 5;
- record `not executed`;
- do not claim Node seams are equivalent to Zotero-host validation.

---

# 5. Production Persistence

Productionize:

```text
ImpressionStore
FeedbackStore
```

using:

```text
Zotero.DB / SQLite
```

Follow the existing `SqliteProfileStore` pattern.

Do not add a new DB dependency.

---

# 6. Impression Table

Suggested table:

```text
llm_for_zotero_recommendation_impressions
```

Columns should include at least:

```text
recommendation_id TEXT PRIMARY KEY
profile_id TEXT NOT NULL
profile_version INTEGER NOT NULL
timestamp INTEGER NOT NULL
schema_version INTEGER NOT NULL
impression_json TEXT NOT NULL
```

Requirements:

- create-only;
- duplicate recommendationId rejected;
- validate before write;
- validate after read;
- detached snapshots;
- independent schema version;
- row metadata must match JSON metadata.

Do not update impressions after creation.

---

# 7. Feedback Table

Suggested table:

```text
llm_for_zotero_recommendation_feedback
```

Columns should include at least:

```text
event_id TEXT PRIMARY KEY
recommendation_id TEXT NOT NULL
paper_id TEXT NOT NULL
action TEXT NOT NULL
timestamp INTEGER NOT NULL
profile_id TEXT NOT NULL
schema_version INTEGER NOT NULL
feedback_json TEXT NOT NULL
```

`profile_id` may be denormalized into the DB row for efficient profile replay even if the domain event remains minimal.

If you add `profileId` to the domain event, first inspect all uses and document the contract change.

Prefer minimal domain churn.

---

# 8. Store Interface Evolution

Current interfaces are intentionally small.

Phase 5 may minimally add useful methods such as:

```ts
FeedbackStore.load(eventId)
FeedbackQuery.profileId?
```

or introduce a narrow production repository/service if necessary.

Do not turn the store layer into an ORM.

Cross-object integrity belongs in the service layer.

---

# 9. Atomicity Boundary

Do not pretend:

```text
append feedback
+
profile update
```

is automatically one safe transaction.

The existing ProfileStore owns its own CAS transaction.

Preferred consistency model:

```text
1. Validate persisted impression/candidate
2. Durably and idempotently persist feedback
3. Recompute feedback-derived profile state
4. CAS-save next profile revision
```

Feedback is source of truth.

If Profile CAS fails:

```text
feedback stays recorded
```

and can be replayed/reconciled later.

Do not delete feedback because profile update failed.

---

# 10. Feedback Idempotency

Do not rely only on random event IDs.

Use deterministic logical event identity.

Recommended key:

```text
recommendationId
candidateId
action
```

MVP semantics:

> Same action for same candidate in same recommendation is idempotent.

Different actions remain separate append-only events.

Examples:

```text
positive → retry positive
= one logical event

positive → negative
= two events
```

Create one centralized deterministic eventId helper.

---

# 11. Feedback Strengths

Centralize deterministic weights.

Recommended defaults:

```text
positive = +0.70
save     = +1.00
negative = -1.00
skip     = -0.20
```

These are engineering defaults, not learned parameters.

The LLM must not choose strengths.

---

# 12. `save` Semantics

`save` means:

> Strong positive preference signal.

It does NOT mean:

```text
library_import
```

Do not mutate Zotero library contents in the feedback Tool.

Actual Zotero import remains a separate write flow with existing confirmation/change-journal behavior.

---

# 13. What Feedback May Learn

Primary durable learning source:

```text
RecommendedPaper.matchedTopicIds
```

Optionally also use valid persisted:

```text
profile_query provenance.topicId
```

if it refers to a known topic.

Do not:

- run an LLM to invent feedback topics;
- extract arbitrary topics from title;
- infer hidden intent from prose.

If no valid topic exists:

```text
record feedback
update counts
but do not invent a topic
```

---

# 14. Historical Profile Revision Constraint

Impressions store:

```text
profileId
profileVersion
matchedTopicIds
```

but ProfileStore keeps only latest snapshot.

Do not require historical Profile snapshots for feedback.

Use the immutable persisted Impression as the durable evidence source.

Full profile revision history remains deferred.

---

# 15. Feedback Signal Contract

Introduce a pure internal signal model.

Conceptually:

```ts
interface FeedbackTopicSignal {
  topicId: string;
  action: FeedbackAction;
  strength: number;
  timestamp: number;
  recommendationId: string;
  candidateId: string;
}
```

It must be derived from:

```text
persisted impression
+
persisted feedback event
```

not Agent context.

---

# 16. Feedback Replay

Build a deterministic replay layer:

```text
feedback events for profile
      ↓
matching impressions
      ↓
validate candidate membership
      ↓
extract durable matched topics
      ↓
apply action strength + decay
      ↓
aggregate feedback state
```

Suggested package:

```text
src/recommendation/feedback/
```

Possible files:

```text
contracts.ts
config.ts
identity.ts
feedbackStore.ts
impressionStore.ts
feedbackReplay.ts
feedbackService.ts
```

Use cohesive structure, not excessive one-function files.

---

# 17. Feedback Aggregation

For each topic:

```text
positiveMass = Σ positive decayed strengths
negativeMass = Σ negative decayed strengths
```

Then use a bounded saturating transform.

Recommended:

```text
positiveFeedback =
1 - exp(-positiveMass / 2)

negativeFeedback =
1 - exp(-negativeMass / 2)
```

Keep values `[0,1]`.

Do not let repeated feedback make unbounded scores.

---

# 18. Feedback Time Decay

Recommended:

```text
feedbackHalfLifeDays = 180
```

Per event:

```text
decay =
2 ^ (-ageDays / feedbackHalfLifeDays)

effectiveStrength =
abs(actionStrength) * decay
```

Centralize and unit test.

---

# 19. Feedback Topic Source

`InterestSource` already supports:

```text
feedback
```

Use it.

Feedback-influenced topics should include:

```text
sources includes "feedback"
```

and deterministic evidence refs such as:

```text
feedback:<eventId>
```

Do not store user chat text in profile evidence.

---

# 20. Durable Topic Label Problem

Current `RecommendedPaper` persists only:

```text
matchedTopicIds
```

but replay may happen after current profile changed.

Feedback replay needs a durable topic label.

Inspect the cleanest contract change.

Preferred options:

### Option A
Persist:

```ts
matchedTopics: {
  id: string;
  label: string;
}[];
```

inside the recommendation snapshot.

### Option B
Persist an impression-level topic map.

Do not create duplicated `matchedTopicIds` + `matchedTopics` unless runtime guards enforce consistency.

The requirement is:

> Any feedback-learned topic must have a durable ID + label snapshot.

Update types/guards/tests carefully.

---

# 21. Existing vs Feedback-only Topic

Case A:

```text
topic already exists from library/explicit
```

→ adjust it and add `feedback` source.

Case B:

```text
topic exists only in historical impression
```

→ may create a feedback-derived topic only if durable ID+label exists in the impression.

Never invent a label.

---

# 22. ProfileBuilder Input

Extend pure build input with validated feedback aggregates.

Conceptually:

```ts
feedbackTopics?: readonly FeedbackTopicAggregate[]
```

ProfileBuilder must remain pure and storage-independent.

---

# 23. Feedback Scoring Integration

Extend existing scoring rather than replacing it.

Conceptually:

```text
library inference
+
explicit preference
+
feedback positive
+
feedback negative
```

A reasonable deterministic policy:

```text
positiveBoost =
max(explicitPositive, feedbackPositive)

negativePenalty =
max(explicitNegative, feedbackNegative)

weight =
clamp(
  max(inferredLibrary, positiveBoost)
  * (1 - negativePenalty)
)

confidence =
clamp(
  max(
    libraryConfidence,
    explicitPositive,
    explicitNegative,
    feedbackConfidence
  )
)
```

A slightly different formula is acceptable if cleaner.

Requirements:

- positive and negative remain separate;
- save > positive;
- negative > skip;
- weight/confidence remain `[0,1]`;
- centralized formula;
- deterministic tests.

---

# 24. Feedback Counts

Populate:

```text
positiveFeedbackCount
negativeFeedbackCount
```

from durable logical events.

Recommended polarity:

```text
positive / save → positive count
negative / skip → negative count
```

Idempotent retry must not increase count.

---

# 25. Representative Papers

Do not add an external recommended paper to:

```text
representativePapers
```

just because the user sent `save`.

It is not a Zotero library paper yet.

Keep representative papers library-scoped.

`saved_from_recommendation` may remain unused until a real imported item can be linked later.

---

# 26. ProfileService Feedback Integration

Phase 5 must allow ProfileService to preserve durable feedback.

Possible patterns:

```ts
interface ProfileFeedbackSource {
  loadForProfile(profileId, now): Promise<FeedbackProfileState>
}
```

or a higher-level feedback service that supplies replay state.

Choose the least-coupled design.

Requirements:

- existing no-feedback tests remain possible;
- explicit full refresh preserves feedback;
- current `feedback_state_discarded_on_rebuild` behavior must disappear once production feedback replay is configured.

---

# 27. Full Refresh Must Preserve Feedback

After Phase 5:

```text
research_profile_get({refresh:true})
```

must combine:

```text
LibrarySource
+
optional TopicExtractor
+
ExplicitPreferences
+
Durable Feedback Replay
```

Feedback counts and influence must survive refresh.

Add integration tests.

---

# 28. FeedbackService

Create a service conceptually:

```ts
class RecommendationFeedbackService {
  submit(input): Promise<FeedbackResult>
}
```

Responsibilities:

```text
validate recommendationId
load impression
validate profile scope
find candidate
derive eventId
idempotently append feedback
replay all profile feedback
update current profile via CAS
return diagnostics
```

Do not put this logic in the Tool.

---

# 29. Feedback Service Input

Conceptually:

```ts
{
  libraryID: number;
  recommendationId: string;
  candidateId: string;
  action: FeedbackAction;
  timestamp: number;
}
```

Service derives:

```text
profileId
eventId
matched topics
```

from trusted persisted state.

---

# 30. Integrity Validation

Before acceptance:

1. impression exists;
2. impression.profileId matches current library profileId;
3. candidateId exists exactly once in impression;
4. recommendationId/paperId relation is valid;
5. timestamp is valid and not before impression timestamp;
6. persisted candidate/topic snapshot passes guards.

Do not trust model-provided topic IDs or strengths.

---

# 31. Stale Profile Version Is Valid

Impression may reference version N while current profile is N+1.

Do not reject feedback solely for that.

Feedback belongs to the historical exposure.

Only profileId scope must match.

---

# 32. Idempotent Submission Result

If exact logical event already exists:

```text
same recommendation
same candidate
same action
```

return:

```text
status: already_recorded
```

Do not double-count.

Do not rebuild unnecessarily unless reconciliation is needed.

---

# 33. Conflicting Feedback

Allow:

```text
positive
then negative
```

as two events.

Never overwrite earlier event.

Replay all events to derive current influence.

---

# 34. CAS Conflict

If feedback was recorded but profile CAS conflicts:

Recommended:

```text
feedbackRecorded: true
profileUpdated: false
warning: feedback_profile_reconcile_required
```

One bounded reload/replay/retry is acceptable.

No unbounded loop.

Never delete feedback.

---

# 35. No Utility LLM on Feedback Click

Feedback is already structured.

Do not rerun Utility LLM merely because feedback arrived.

Preferred:

```text
current profile
+
full durable feedback aggregate
→ deterministic feedback updater
→ new profile version
```

This preserves current library/LLM-derived topic snapshot without extra model calls.

---

# 36. Feedback-only Update Strategy

Preferred:

```text
current ResearchProfile
+
durable feedback aggregate
      ↓
FeedbackProfileUpdater
      ↓
version + 1
```

Update:

```text
topics
sources
feedback evidence refs
signalSummary
updatedAt
```

Preserve:

```text
generatedAt
explicitPreferences
libraryPaperCount
representativePapers
non-feedback topic evidence
```

If embedding ref exists:

```text
invalidate/remove it
```

because profile semantics changed.

---

# 37. FeedbackProfileUpdater

Pure deterministic updater requirements:

- validate input profile;
- apply full replayed aggregate, not just latest event;
- preserve explicit preferences;
- preserve library/explicit sources;
- add/remove `feedback` source according to aggregate;
- update bounded feedback evidence refs;
- update counts;
- version exactly +1 when state changes;
- generatedAt unchanged;
- updatedAt = now;
- invalidate embedding if present;
- representative papers unchanged;
- no external paper inserted.

---

# 38. Topic Removal

If feedback support disappears/decays to zero:

- remove feedback source/ref;
- retain topic if library/explicit source remains;
- remove topic if no source remains.

Never leave:

```text
sources = []
```

---

# 39. Impression Persistence in `research_recommend`

After ranking succeeds and before Tool output:

```text
build immutable RecommendationImpression
→ validate
→ persist
→ return
```

Do not persist failed recommendation executions.

---

# 40. Recommendation ID

Generate server-side.

Do not accept it from LLM.

A UUID-like ID is acceptable.

Requirements:

- non-empty;
- collision-resistant;
- no secrets;
- one ID per successful recommendation execution.

Feedback idempotency is separate.

---

# 41. Impression Stores Only Displayed Slate

Persist:

```text
ranked Top-K actually returned
```

not the internal candidate pool.

Feedback must refer to what the user actually saw.

---

# 42. Impression Timestamp

Use one execution timestamp.

Recommended:

```text
impression.timestamp = ranking.generatedAt
```

or one later `now()` captured once.

Document semantics.

---

# 43. Impression Persistence Failure

If ranking succeeds but impression persistence fails:

```text
research_recommend must fail
```

Do not return recommendations that cannot later accept traceable feedback.

No in-memory fake success.

---

# 44. research_recommend Output

Add:

```text
recommendationId
```

to output.

The Agent needs it for follow-up feedback.

---

# 45. `recommendation_feedback` Tool

Add:

```text
recommendation_feedback
```

Suggested location:

```text
src/agent/tools/recommendation/recommendationFeedback.ts
```

Initial backend:

```text
plugin Agent Runtime only
localAgentOnly = true
```

---

# 46. Tool Input

Recommended:

```ts
{
  recommendationId: string;
  candidateId: string;
  action: "positive" | "negative" | "save" | "skip";
}
```

Do not accept:

```text
profileId
libraryID
eventId
topic IDs
strength
timestamp
freeform preference text
```

from the model.

---

# 47. Tool Mutability / Confirmation

Feedback changes durable internal user state.

Do not label it `read` merely to avoid write semantics.

Preferred:

```text
mutability: write
```

For confirmation:

- inspect current Tool Registry behavior;
- if explicit user feedback in the current request is sufficient for an unconfirmed constrained write under framework conventions, use `requiresConfirmation:false`;
- if framework requires confirmation for all writes, follow the framework.

Do not bypass runtime safety.

Record the final decision.

---

# 48. Change Journal Boundary

Feedback events are recommendation-memory records, not Zotero library mutations.

Do not force them into ChangeJournal solely for reuse.

If registry infrastructure requires a mutation contract, use the smallest compliant internal-state path.

Do not treat them as undoable Zotero content edits.

---

# 49. Tool Guidance

Support follow-ups like:

```text
第2篇感兴趣
第4篇不感兴趣
这篇我想保存
这个跳过

I like the second one
I'm not interested in #4
```

The Agent should reuse recommendationId/candidateId from prior Tool output when available.

Do not ask user to manually repeat IDs if current conversation context already contains them.

Do not interpret unrelated sentiment as feedback.

---

# 50. Multi-item Feedback

One Tool call per paper is sufficient.

Example:

```text
第2篇感兴趣，第4篇没兴趣
```

Agent may invoke `recommendation_feedback` twice.

Do not add batch complexity unless actual need appears.

---

# 51. Tool Output

Return compact status:

```text
eventId
recommendationId
candidateId
action
status: recorded | already_recorded
feedbackRecorded
profileUpdated
previousProfileVersion
newProfileVersion?
appliedTopicIds
warnings
```

No full profile dump.

No DB internals.

---

# 52. Warning Codes

Examples:

```text
feedback_profile_reconcile_required
feedback_no_matched_topics
feedback_profile_embedding_invalidated
feedback_already_recorded
```

Use compact machine-readable codes.

---

# 53. Production Store Validation

Both stores must:

- lazy-init safely;
- validate before first await;
- detach JSON snapshots;
- validate reads;
- reject unsupported schema;
- detect metadata mismatch/corruption;
- never silently fallback to memory;
- use real Node SQLite seam tests where practical.

---

# 54. Cross-store Integrity

Stores validate their own object shapes.

Service validates:

```text
feedback ↔ impression
candidate ↔ impression
profile scope
timestamps
```

Keep stores narrow.

---

# 55. Query Efficiency

Do not replay feedback by scanning every event in the entire DB if avoidable.

Production feedback persistence may denormalize:

```text
profile_id
```

after service validation.

Then profile replay can query by profile scope efficiently.

---

# 56. Reconciliation API

Provide a deterministic reconciliation path.

Conceptually:

```text
reconcileProfileFeedback(profileId, now)
```

It should:

```text
load current profile
load durable feedback for profile
replay
apply pure updater
CAS-save only if state changed
```

Useful after CAS conflict/restart.

Do not create unnecessary profile versions when replay produces no state change.

---

# 57. Explicit Refresh Integration

Full profile rebuild must include durable feedback replay.

Test:

```text
feedback exists
→ refresh
→ feedback counts/effects preserved
```

---

# 58. Feedback Evidence Refs

Use compact deterministic refs, e.g.:

```text
feedback:<eventId>
```

Bound them with existing evidence limits.

If many events exist, choose deterministic bounded subset, preferably strongest/recent.

Document the rule.

---

# 59. Topic Timestamps

Feedback-influenced:

```text
lastEvidenceAt
```

must include latest feedback timestamp.

Feedback-only update:

```text
generatedAt unchanged
updatedAt = now
```

Full refresh:

```text
generatedAt = now
updatedAt = now
```

---

# 60. Counts With Conflicting Events

If user does:

```text
positive
negative
```

both remain durable.

Counts become:

```text
positiveFeedbackCount += 1
negativeFeedbackCount += 1
```

Net influence comes from replay.

Retry of same logical event does not add count.

---

# 61. Current Focus Must Not Become Memory

The recommendation's temporary `focus` string must not automatically become a long-term topic.

Feedback learns only from durable matched topic snapshots.

---

# 62. Tests — ImpressionStore

At minimum:

```text
initialize
save/load
duplicate ID rejection
invalid write no mutation
corrupt JSON rejection
metadata mismatch
schema mismatch
snapshot isolation
close/reopen persistence
```

---

# 63. Tests — FeedbackStore

At minimum:

```text
append
load/list
query by recommendationId
query by paperId
query by profile scope if implemented
duplicate eventId
invalid event
append order
snapshot isolation
schema mismatch
close/reopen
```

---

# 64. Tests — Feedback Identity

Verify:

```text
same recommendation/candidate/action => same eventId
different action => different eventId
different candidate => different eventId
different recommendation => different eventId
```

---

# 65. Tests — Replay

Test:

```text
positive
save
negative
skip
time decay
multiple events same topic
multiple candidates same topic
conflicting feedback
idempotent duplicate
missing impression
candidate not in impression
no matched topics
```

---

# 66. Tests — FeedbackProfileUpdater

Verify:

```text
version +1
generatedAt preserved
updatedAt advances
feedback source added
feedback source removed correctly
non-feedback sources preserved
explicit preferences preserved
library counts preserved
feedback counts correct
negative reduces interest
save stronger than positive
skip weaker than negative
embedding invalidated
representative papers unchanged
input immutable
```

---

# 67. Tests — Full Refresh With Feedback

Test durable feedback survives:

```text
ProfileService rebuild / research_profile_get refresh
```

and no longer emits:

```text
feedback_state_discarded_on_rebuild
```

when production feedback replay is configured.

---

# 68. Tests — FeedbackService

At minimum:

1. valid feedback;
2. idempotent retry;
3. stale impression profileVersion accepted;
4. wrong profile scope rejected;
5. candidate absent rejected;
6. event persisted before profile CAS;
7. one bounded CAS retry;
8. persistent CAS failure leaves event + reconcile warning;
9. no matched topics;
10. already-reconciled event produces no extra profile revision.

---

# 69. Update research_recommend Tests

Verify:

```text
successful recommendation persists impression
returns recommendationId
persisted slate exactly equals shown Top-K
profile/rank/score/provenance preserved
persistence failure causes Tool failure
no impression for failed ranking
```

---

# 70. Tests — recommendation_feedback Tool

Verify:

```text
correct name
scope from Agent context
no model profile/library/event/strength
valid actions only
durable mutability classification
confirmation behavior per framework
localAgentOnly
candidate/recommendation validation
idempotent repeated call
profile version result
no Zotero import
no RAG
no LLM
```

---

# 71. No-network Integration Test

Build:

```text
LibraryIndex fixture
→ ProfileService / SqliteProfileStore
→ fake literature
→ CandidateDiscoveryService
→ RankingService
→ research_recommend
→ SqliteImpressionStore
→ recommendation_feedback
→ SqliteFeedbackStore
→ replay/updater
→ SqliteProfileStore
→ next profile load
```

Verify:

```text
recommendationId durable
impression durable
feedback durable
profile version increments
topic/source/count changes
retry is idempotent
future ranking sees updated profile
```

No live API/model.

---

# 72. Readable Demo Test

Use a small deterministic example:

Initial profile:

```text
Agentic Recommendation
RAG
```

Recommendations:

```text
A strongly Agentic
B strongly RAG
C unrelated
```

Feedback:

```text
A positive
B negative
```

After update:

```text
Agentic remains/increases stronger
RAG decreases
feedback counts 1 / 1
feedback source visible
```

Then rerun controlled ranking and confirm expected order change.

This should be useful for future demo/interview explanation.

---

# 73. Regression Tests

Keep all previous recommendation tests passing:

```text
research_profile_get
research_candidate_discover
research_recommend
ranking
embedding fallback
generic literature_search
ProfileStore
tool surface
```

Do not weaken runtime validation.

---

# 74. Store Schema Versions

Use independent constants:

```text
IMPRESSION_SCHEMA_VERSION = 1
FEEDBACK_SCHEMA_VERSION = 1
```

Do not reuse profile revision/schema.

---

# 75. Architecture Baseline Update

Update only relevant Phase 5 facts in:

```text
docs/research_agent_architecture_baseline.md
```

Document:

- production ImpressionStore;
- production FeedbackStore;
- recommendationId;
- feedback idempotency;
- action strengths;
- event-first/profile-CAS consistency;
- feedback replay;
- feedback-aware profile update;
- `save` does not import;
- recommendation_feedback;
- refresh preserves feedback;
- no RAG/UI/Scheduler yet.

Do not reformat the full file.

---

# 76. Development Log

Continue:

```text
docs/development-log.md
```

Add:

```text
recommendation-phase5-feedback-learning-loop
```

with:

```text
Goal
Git Baseline
Files Changed
What Changed
Architecture Decisions

Impression Persistence
Feedback Persistence
Idempotency
Integrity Rules
Feedback Signal Policy
Replay / Reconciliation
Profile Update Policy
Agent Tool

Tests
Architecture Red-Line Review
Known Issues
Deferred Work
Next Recommended Step
```

---

# 77. Current Architecture Status After Phase 5

The log should show:

```text
Profile Memory: implemented
Candidate Discovery: implemented
Ranking/MMR: implemented

Production ImpressionStore: implemented
Production FeedbackStore: implemented
RecommendationImpression persistence: implemented
Feedback append-only events: implemented
Feedback replay: implemented
Feedback-aware Profile update: implemented
recommendation_feedback: implemented

Recommendation Evidence/RAG: NOT implemented
UI: NOT implemented
Scheduler/Digest: NOT implemented
automatic Zotero import from feedback: NOT implemented
```

---

# 78. Open Decisions to Resolve

Record final decisions for:

```text
recommendationId generation
feedback eventId/idempotency
action strengths
feedback half-life
aggregation formula
matched-topic snapshot persistence
event-first consistency
CAS retry count
reconciliation behavior
feedback-only timestamp semantics
full-refresh replay semantics
```

---

# 79. Do Not Start Next Phase

Future work may add:

```text
Top-K → Evidence Enrichment/RAG → grounded recommendation reasons
```

and later:

```text
Skill / Action / UI / Digest
```

Do not implement them now.

---

# 80. Validation Commands

At minimum:

```sh
npm run typecheck
npm run test:unit
npm run build
npm run check:cycles
git diff --check
```

Also run:

```text
focused Phase 5 tests
ESLint changed TS
Prettier changed files + docs/development-log.md
```

Do not claim unexecuted tests.

---

# 81. Final Architecture Review

Before completion:

```text
[ ] research_recommend persists only displayed Top-K.
[ ] research_recommend returns recommendationId.
[ ] persistence failure prevents untraceable output.
[ ] feedback references persisted impression.
[ ] candidate belongs to impression.
[ ] feedback is append-only.
[ ] identical retry is idempotent.
[ ] different actions remain separate events.
[ ] save does not import.
[ ] feedback strengths centralized.
[ ] no LLM interprets structured feedback.
[ ] replay deterministic.
[ ] feedback profile state replayable.
[ ] counts come from durable logical events.
[ ] full refresh preserves feedback.
[ ] feedback-only update does not rerun Utility LLM.
[ ] CAS conflict never deletes feedback.
[ ] reconciliation path exists.
[ ] no RAG/evidence enrichment.
[ ] no UI/Scheduler.
[ ] no vector persistence.
[ ] regressions pass.
[ ] development-log updated.
```

---

# 82. Git Checkpoint

Recommended commit:

```text
feat(recommendation): add feedback learning loop
```

Recommended annotated tag:

```text
phase-5
```

Start from current `main`.

Do not move `phase-4`.

Push only:

```text
origin/main
origin phase-5
```

No force push.

No blind `git add .`.

Do not include unrelated analysis, credentials, build products or dependencies.

---

# 83. Required Final Report

Return:

## A. Git Baseline

```text
starting main commit
phase-5 implementation commit
tag
branch
working tree
remote push status
```

## B. Files Changed

Every changed/new file and purpose.

## C. Persistence Architecture

```text
research_recommend
→ ImpressionStore

recommendation_feedback
→ FeedbackStore
→ Feedback Replay
→ Profile CAS
```

## D. Schemas

Final table names/columns/schema versions.

## E. Idempotency

Exact event identity rule.

## F. Feedback Policy

Exact action strengths and time decay.

## G. Profile Update Formula

How feedback changes:

```text
weight
confidence
sources
evidenceRefs
signalSummary
version
timestamps
```

## H. Consistency Model

Explain:

```text
event first
profile CAS second
bounded retry
reconciliation
```

## I. research_recommend Change

Explain recommendationId/impression behavior.

## J. recommendation_feedback

Explain input/output/exposure/mutability/confirmation.

## K. Tests

Actual commands/results.

## L. Red-Line Review

Confirm no auto-import/RAG/UI leakage.

## M. Known Issues

Only actual remaining issues.

## N. Deferred Next Phase

Summarize evidence-grounded recommendation only.

## O. Development Log

Confirm committed update.

---

# 84. Success Criteria

Phase 5 is complete only when:

```text
Persistent ResearchProfile
        ↓
Candidate Discovery
        ↓
Personalized Ranking + MMR
        ↓
research_recommend
        ↓
Persistent RecommendationImpression
        ↓
recommendationId
        ↓
User Feedback
        ↓
recommendation_feedback
        ↓
Persistent Append-only Feedback
        ↓
Deterministic Feedback Replay
        ↓
Profile Version Update
        ↓
Future Recommendation Uses Updated Profile
```

while these remain separate/not implemented:

```text
automatic Zotero import
PDF/RAG recommendation evidence
UI
Scheduler/Digest
LLM ranking
learning-to-rank
vector database
```

The goal is a **durable, auditable personalization learning loop**, not just reaction collection.
