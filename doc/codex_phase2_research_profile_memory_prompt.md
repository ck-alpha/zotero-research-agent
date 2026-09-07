# Codex Prompt — Phase 2: Research Profile Memory

## Project

**Personalized Research Intelligence Agent**

Repository:

```text
https://github.com/ck-alpha/zotero-research-agent
```

Current verified Phase 1 checkpoint:

```text
commit: 10ed87677bc2afdfe17ede174f80f23834fdc500
message: feat(recommendation): complete phase 0 and phase 1 foundation
```

Upstream baseline remains:

```text
5be02f51a9bdf9b143439c95eed07bd62a34cb68
```

---

# 0. Read Before Coding

Before modifying any code, read and treat the following as the current project context:

```text
docs/research_agent_architecture_baseline.md
docs/development-log.md
```

Also inspect the current implementation rather than relying only on this prompt:

```text
src/recommendation/domain/
test/recommendationDomain.test.ts
test/recommendationStores.test.ts
test/helpers/recommendationFixtures.ts
test/helpers/recommendationStores.ts
```

Relevant existing upstream infrastructure that should be inspected and reused where appropriate:

```text
src/services/libraryIndexService.ts
src/services/libraryIndex/contracts.ts
src/services/libraryIndex/projection.ts

src/utils/utilityLLM.ts
src/modules/contextPanel/retrievalQueryPlan.ts

src/agent/store/conversationMemory.ts
src/agent/store/batchJobStore.ts
src/agent/store/traceStore.ts

src/agent/tools/index.ts
src/agent/tools/registry.ts
src/agent/types.ts
src/agent/services/zoteroGateway.ts
```

Do not assume the exact implementation described in this prompt is the only valid implementation.  
If the repository already has a cleaner reusable pattern, prefer it, but preserve the architecture boundaries and Phase 2 semantics below.

---

# 1. Phase 2 Goal

This phase implements the first real personalized-memory capability:

```text
Zotero Library
      ↓
Research Paper Signals
      ↓
Topic Extraction / Normalization
      ↓
Deterministic Profile Scoring
      ↓
ResearchProfile
      ↓
Persistent ProfileStore
      ↓
research_profile_get
```

The outcome of this phase should be:

> The plugin Agent can obtain a durable, library-scoped ResearchProfile derived from the user's Zotero library, and the profile can be rebuilt deterministically with an optional bounded Utility LLM enhancement.

This phase is about **Research Profile Memory**.

It is **not** yet about paper recommendation.

---

# 2. Hard Scope Boundary

Phase 2 MAY implement:

- production ResearchProfile persistence;
- library-scoped profile identity;
- library metadata adapter;
- profile input signals;
- topic extraction;
- topic normalization;
- deterministic time decay;
- deterministic topic scoring;
- topic evidence;
- representative papers;
- ProfileBuilder;
- ProfileUpdater;
- ProfileService;
- optional Utility LLM topic extraction;
- deterministic fallback when Utility LLM is unavailable;
- `research_profile_get`;
- tests;
- architecture/documentation corrections required by these changes.

Phase 2 MUST NOT implement:

- Candidate Discovery;
- OpenAlex recommendation recall;
- arXiv recommendation recall;
- Candidate Merge;
- Candidate Dedup;
- Personalized Ranking;
- Semantic candidate scoring;
- MMR;
- recommendation feedback learning;
- production FeedbackStore;
- production ImpressionStore;
- recommendation UI;
- weekly digest;
- Scheduler;
- Research Digest Action;
- research-intelligence Skill;
- RAG evidence enrichment for recommendation;
- local vector database;
- Profile Embedding computation;
- Multi-Agent;
- LangGraph/LangChain replacement;
- GraphRAG;
- automatic Zotero import.

If later-stage needs are discovered, record them in `docs/development-log.md` instead of implementing them.

---

# 3. Architecture Rules Remain Mandatory

The five existing red lines remain in force:

1. **Recommendation Domain must not depend on Zotero UI.**
2. **Ranking Algorithm must not call Agent Runtime.**
3. **Persistent ResearchProfile must not use conversationMemory.**
4. **LLM output must never directly become long-term state; it must pass structured validation and deterministic update logic.**
5. **Any future Zotero mutation must go through the existing Tool Registry / Action Contract / Change Journal path.**

Additional Phase 2 rule:

6. **Profile building must still work without a configured Utility LLM.**

The system must have a deterministic fallback profile rather than failing because the model is unavailable.

---

# 4. Resolve Open Decision: Profile Scope

For the MVP, define:

> **One ResearchProfile per Zotero library.**

Do not support in Phase 2:

- one profile per conversation;
- one profile per collection;
- multiple personas inside the same library;
- cross-library merged profiles.

Use a deterministic profile ID derived from the Zotero library ID.

Recommended form:

```text
library:<libraryID>
```

Example:

```text
library:1
library:6
```

Centralize this identity logic in one helper rather than constructing strings throughout the code.

Example conceptual API:

```ts
profileIdForLibrary(libraryID: number): string
```

The exact helper name may follow repository conventions.

Validation requirements:

- `libraryID` must be a positive integer;
- invalid IDs must fail explicitly;
- no silent fallback to another library.

---

# 5. Resolve Open Decision: Zotero Paper Identity

Phase 1 deliberately kept:

```text
RepresentativePaper.itemId
RecommendationFeedback.paperId
RecommendationCandidate.candidateId
```

as opaque strings.

For Phase 2:

- do not redesign the whole identity model;
- do not add cross-device Zotero-key migration work;
- keep ResearchProfile library-scoped;
- map an eligible Zotero item to a stable-in-this-local-library string representation in one adapter/helper;
- do not scatter `String(item.id)` conversions across ProfileBuilder.

A simple local mapping is acceptable for the MVP.

Record in the development log that cross-device identity portability remains deferred if the implementation still relies on local Zotero numeric item IDs.

---

# 6. Small Domain Contract Correction

Phase 1 identified that `RecommendationImpression` contains:

```text
profileVersion
```

but not:

```text
profileId
```

This becomes ambiguous once more than one Zotero library exists.

Before the impression contract is used by later phases, correct it now.

Update:

```ts
interface RecommendationImpression {
  recommendationId: string;
  profileId: string;
  timestamp: number;
  profileVersion: number;
  candidates: RecommendedPaper[];
}
```

Then update:

- runtime validation;
- fixtures;
- existing unit tests;
- architecture baseline section describing RecommendationImpression;
- development log.

Do not otherwise expand RecommendationImpression in this phase.

This is a contract correction, not implementation of the recommendation-feedback pipeline.

---

# 7. Production ProfileStore

Phase 1 defined the asynchronous `ProfileStore` contract.

Phase 2 must provide the first **production persistence adapter**.

Prefer repository-native persistence using:

```text
Zotero.DB / SQLite
```

and follow patterns already present in:

```text
src/agent/store/conversationMemory.ts
src/agent/store/batchJobStore.ts
src/agent/store/traceStore.ts
```

Suggested location:

```text
src/recommendation/profile/profileStore.ts
```

or another clearly equivalent location.

## Required semantics

The production adapter must preserve the existing Phase 1 contract:

### load

```ts
load(profileId)
```

returns:

- validated detached snapshot;
- `null` if absent.

### save create

```ts
save(profile, null)
```

must only create:

```text
version = 1
```

and must reject if the profile already exists.

### save update

```ts
save(profile, expectedVersion)
```

must require:

```text
stored.version === expectedVersion
new.version === expectedVersion + 1
```

No silent last-write-wins behavior.

### Persistence isolation

- validate before persistence;
- validate after deserialization;
- callers must not mutate stored state by retaining references.

## Suggested SQLite representation

A compact snapshot table is sufficient for Phase 2.

Conceptually:

```text
profile_id
version
schema_version
profile_json
updated_at
```

A separate database/schema version is recommended.

Do not misuse:

```text
ResearchProfile.version
```

as the database schema version.

The exact SQL can follow repository style.

## CAS

The compare-and-swap semantics must remain atomic.

Use a transaction or an equivalent conditional-update strategy.

Do not implement:

```text
load → leave transaction → save
```

as if that were atomic.

## Phase 2 storage scope

Implement only production:

```text
ProfileStore
```

Do not implement production:

```text
FeedbackStore
ImpressionStore
```

yet.

Those belong to the feedback/recommendation phases.

---

# 8. Library Metadata Source Boundary

Do not make ProfileBuilder directly walk Zotero UI objects.

Introduce a small recommendation-facing source abstraction.

Conceptually:

```ts
interface ResearchLibrarySource {
  getLibrarySnapshot(libraryID: number): Promise<ResearchLibrarySnapshot>;
}
```

The exact names are flexible.

The recommendation-facing paper signal should contain only fields needed by the profile system.

Example conceptual contract:

```ts
interface ResearchPaperSignal {
  itemId: string;
  title: string;
  abstract?: string;
  authors: string[];
  manualTags: string[];
  automaticTags: string[];
  collectionPaths: string[];
  year?: string;
  addedAt: number;
  modifiedAt: number;
}
```

Do not leak:

```text
Zotero.Item
DOM
ZoteroPane
Reader UI objects
```

into ProfileBuilder.

---

# 9. Reuse LibraryIndexService Instead of Re-reading the Entire Library

The current repository already has:

```text
LibraryIndexService
```

and its projection contains much of the metadata required for profile building:

- regular-item identity;
- title;
- abstractNote;
- creators;
- tags;
- automaticTags;
- collection IDs;
- date/year;
- dateAdded;
- addedAt;
- modifiedAt;
- deleted status.

Use the existing library index as the default source where practical.

Do not write a second full-library projection system unless an actual missing requirement forces it.

Eligible papers for profile construction should normally be:

```text
kind === "regular"
deleted === false
non-empty title
```

Standalone notes and standalone attachments should not become research papers.

Collection IDs may be converted to collection paths/names using the existing snapshot mappings.

---

# 10. Raw Signal Design

Introduce a small internal/raw profile-signal model separate from `ResearchProfile`.

The profile builder should conceptually operate on:

```text
ResearchPaperSignal[]
ExplicitPreferences
optional previous ResearchProfile
optional validated TopicExtractor output
```

Do not make the final ResearchProfile itself the raw event store.

Keep:

```text
raw inputs
```

and:

```text
profile snapshot
```

conceptually separate.

---

# 11. Deterministic Profile Must Work Without LLM

This is mandatory.

If no model is configured, or the Utility LLM:

- times out;
- returns malformed JSON;
- returns empty output;
- returns unsupported paper IDs;
- throws transport errors;

ProfileBuilder must still produce a valid profile from deterministic library signals.

A reasonable fallback can use high-quality explicit library structure such as:

- manual Zotero tags;
- collection names/paths;
- optionally conservative metadata-derived signals.

Do not build a complicated NLP pipeline.

The fallback should favor precision and explainability over pretending to infer perfect research topics.

---

# 12. Utility LLM Topic Extractor

Phase 2 may use a Utility LLM as an **enhancement**, not as the source of truth.

Reuse:

```text
src/utils/utilityLLM.ts
```

instead of creating a separate raw model client.

## Boundary

Create an abstraction conceptually similar to:

```ts
interface TopicExtractor {
  extract(...): Promise<TopicExtractionResult>;
}
```

ProfileBuilder should depend on this abstraction, not directly on `callUtilityLLM`.

A production adapter may wrap `callUtilityLLM`.

Tests must be able to inject a fake extractor.

## No one-call-per-paper design

Do not call the LLM separately for every Zotero item.

Use bounded batches and centralized limits.

Choose conservative defaults and record them in code/config + development log.

The exact values can be selected after inspecting current utility-token conventions, but there must be explicit limits for:

- maximum papers considered by LLM;
- batch size;
- maximum topics returned;
- timeout;
- JSON token budget.

## Structured output

LLM output should contain structured topic evidence.

Conceptually:

```ts
type ExtractedTopic = {
  label: string;
  confidence: number;
  supportingPaperIds: string[];
};
```

If useful, a relation/support weight can be added, but avoid unnecessary schema complexity.

## Evidence constraint

An LLM topic is only accepted if:

- its label is valid;
- confidence is valid;
- every supporting paper ID refers to an input paper;
- output passes runtime validation.

The LLM must not invent persistent item IDs.

## Failure

Failure should:

```text
log / return warning
↓
fall back to deterministic signals
↓
still produce profile
```

It should not abort the whole profile build.

---

# 13. Topic Normalization

Topic identity and display label should be separated conceptually.

Use a deterministic normalization key for merging obvious duplicates.

At minimum handle:

- trim;
- whitespace normalization;
- case normalization;
- Unicode normalization.

Do not implement semantic embedding clustering or ontology construction in Phase 2.

Do not merge semantically different topics merely because an LLM thinks they are similar.

If the Utility LLM returns canonicalized labels, deterministic code still owns the final dedup/merge.

---

# 14. Profile Scoring

Implement scoring in:

```text
profileScoring.ts
```

or a clearly equivalent isolated module.

Do not scatter weights and formulas across:

- ProfileBuilder;
- Tool code;
- Store code;
- UI.

## Time decay

Use the architecture baseline half-life formulation:

```text
timeWeight = 2 ^ (-deltaDays / halfLifeDays)
```

Default:

```text
halfLifeDays = 180
```

Keep it configurable in a central scoring config.

Tests should use an injected/fixed `now`.

Never make core scoring tests depend on the real current time.

## Topic score

The exact first-version formula may remain simple, but it must be deterministic.

It should combine:

- supporting paper evidence;
- signal quality/source;
- recency/time decay;
- explicit preference where appropriate.

Do not add a machine-learning ranker here.

## Weight and confidence

Preserve the Phase 1 distinction:

```text
weight
```

means:

> estimated interest strength

while:

```text
confidence
```

means:

> confidence in that estimate.

Do not calculate them as accidental aliases of the same number unless there is an explicitly justified MVP formula recorded in the development log.

Both must remain within:

```text
[0, 1]
```

---

# 15. Explicit Preferences

Explicit preferences remain stronger than inferred library interests.

ProfileBuilder must not delete them during a rebuild.

A full library rebuild should conceptually do:

```text
existing explicit preferences
        +
new library-derived interests
        ↓
new profile snapshot
```

not:

```text
new library-derived profile
↓
overwrite everything
```

Implement deterministic updater logic for validated explicit preference changes.

Suggested location:

```text
src/recommendation/profile/profileUpdater.ts
```

Do not create a model-facing preference-edit Tool in Phase 2 unless absolutely required to support `research_profile_get`.

Natural-language preference parsing can remain deferred.

---

# 16. Representative Papers

Implement deterministic representative-paper selection.

Representative papers should support later Seed Recall, but Phase 2 does not perform that recall yet.

Selection should consider simple factors such as:

- recency;
- support for high-weight topics;
- explicit positive signal if present.

Keep the number bounded by a central config.

Do not select hundreds of representative papers.

Each result must preserve one existing Phase 1 reason:

```text
recent
high_topic_relevance
explicit_positive
saved_from_recommendation
```

In Phase 2, `saved_from_recommendation` may remain unused because recommendation feedback has not been implemented yet.

---

# 17. Topic Evidence

Every generated `TopicInterest` must be explainable.

Use:

```text
evidenceRefs
```

to reference supporting library signals/papers.

Do not copy PDF text or large abstracts into ResearchProfile.

A compact opaque reference pattern is enough, for example conceptually:

```text
paper:<itemId>
tag:<normalized-tag>
collection:<normalized-path>
```

Centralize evidence-ref creation if used.

The exact strings are implementation choices, but they must be deterministic and testable.

---

# 18. ProfileSignalSummary

Populate:

```text
libraryPaperCount
positiveFeedbackCount
negativeFeedbackCount
explicitPreferenceCount
```

Phase 2 semantics:

- `libraryPaperCount`: eligible library papers considered by the profile layer;
- `explicitPreferenceCount`: count of persisted positive + negative explicit preference records;
- feedback counts may remain zero until the production feedback pipeline exists.

Do not fabricate feedback counts.

If an existing profile somehow already contains feedback-derived state, preserve it only if the chosen rebuild semantics are explicit and tested; otherwise document the limitation.

---

# 19. Profile Version Semantics

Keep Phase 1 snapshot revision rules.

### First build

```text
version = 1
```

### Full rebuild

```text
version = previous.version + 1
```

### Explicit preference update

also creates:

```text
version = previous.version + 1
```

Use CAS through ProfileStore.

Do not silently overwrite concurrent revisions.

## Timestamp semantics

Recommended:

- `generatedAt`: time of the latest full library-derived profile rebuild;
- `updatedAt`: time of the latest snapshot mutation.

For a full rebuild:

```text
generatedAt = now
updatedAt = now
```

For a preference-only update:

```text
generatedAt = previous.generatedAt
updatedAt = now
```

If you choose different semantics, document and test them.

---

# 20. ProfileService

Introduce a service layer that owns profile lifecycle.

Suggested conceptual API:

```ts
class ProfileService {
  get(...): Promise<...>
  rebuild(...): Promise<...>
  updateExplicitPreferences(...): Promise<...>
}
```

Exact method names are flexible.

Responsibilities:

- resolve library-scoped profile ID;
- load profile;
- collect library signals;
- invoke optional TopicExtractor;
- build deterministic ResearchProfile;
- preserve explicit preferences;
- save using CAS;
- return warnings/status;
- avoid leaking persistence details to the Agent Tool.

Do not put this orchestration inside `research_profile_get`.

---

# 21. Refresh Semantics

Do not implement a scheduler or event-driven incremental rebuild in Phase 2.

For the MVP:

- if profile is absent, build it;
- if profile exists, load it;
- allow an explicit refresh/rebuild request.

No complex stale-profile detector is required yet.

If desired, a small time-based freshness hint may be returned, but do not create a background auto-refresh system.

Record stale/incremental-refresh strategy as deferred work.

---

# 22. `research_profile_get` Agent Tool

This is the only new model-visible recommendation Tool required in Phase 2.

Suggested location:

```text
src/agent/tools/recommendation/researchProfileGet.ts
```

or another clean recommendation-tool folder.

Register it through the existing built-in Tool Registry pattern.

## Mutability

It is a read capability from the user's perspective.

The tool may persist/rebuild internal profile memory, but it must not mutate the user's Zotero library.

It must not trigger Action Contract / Change Journal as a Zotero write.

## Initial backend scope

Phase 2 should support only:

```text
in-plugin Agent Runtime
```

Do not assume it automatically works in:

- ordinary chat;
- Codex App Server;
- Claude Code;
- WebChat;
- MCP.

Use existing tool exposure controls if appropriate, e.g. a local-agent-only semantic Tool.

Record the support matrix in `docs/development-log.md`.

## Input

Keep it small.

Conceptually:

```ts
{
  refresh?: boolean;
}
```

Do not let the model arbitrarily choose another library ID.

Resolve the library from the current Agent request/context.

If no valid library is available, return a clear Tool failure.

## Behavior

### no saved profile

```text
build profile
→ persist version 1
→ return profile summary
```

### saved profile + refresh false

```text
load
→ return current snapshot
```

### saved profile + refresh true

```text
rebuild
→ CAS save version + 1
→ return updated snapshot
```

## Output

Return a compact, model-usable result.

At minimum:

```text
profileId
version
status: loaded | built | rebuilt
topics
representativePapers
explicitPreferences
signalSummary
generatedAt
updatedAt
warnings
```

Do not dump raw LLM prompts/responses or the entire Zotero library into Tool output.

For topics, preserve:

```text
label
weight
confidence
sources
evidenceRefs
```

A reasonable result cap is allowed if documented.

---

# 23. Utility LLM Configuration From Agent Context

When `research_profile_get` needs the optional Utility LLM:

- reuse the current Agent request's model/provider configuration where available;
- use existing provider-safe utility infrastructure;
- do not invent a second preferences/settings system in Phase 2.

The Utility LLM is optional.

If model configuration is unavailable:

```text
deterministic profile build must still succeed
```

---

# 24. Tests: Pure Profile Logic

Add focused unit tests for the profile layer.

At minimum verify:

### profile scope

- valid library ID → deterministic profileId;
- invalid library IDs fail.

### paper filtering

- regular active items included;
- deleted items excluded;
- notes excluded;
- standalone attachments excluded;
- missing/invalid titles handled consistently.

### time decay

With fixed `now`:

- current signal gets full recency weight;
- half-life-old signal gets approximately half weight;
- older signals monotonically decay.

### topic normalization

- case/whitespace obvious duplicates merge;
- invalid labels rejected;
- unrelated labels remain separate.

### weight vs confidence

- both stay within [0, 1];
- they are independently calculated/represented.

### explicit preference

- rebuild preserves explicit preferences;
- positive/negative preferences remain separated;
- validated preference update increments profile version through service/store logic.

### evidence

- topic evidence only references valid input signals;
- duplicate refs handled deterministically.

### representative papers

- bounded;
- deterministic;
- valid reason;
- contains only eligible input papers.

---

# 25. Tests: TopicExtractor / Utility LLM

Do not require a real network model in unit tests.

Use the existing test seam or inject a fake TopicExtractor.

Test:

1. valid structured LLM result;
2. malformed JSON;
3. unknown supporting paper ID;
4. confidence outside [0,1];
5. timeout/failure result;
6. empty result;
7. fallback profile still produced.

If LLM parsing is in a dedicated adapter, test it separately from ProfileBuilder.

---

# 26. Tests: Production ProfileStore

Add tests for the production store semantics with the repository's preferred DB test seam/mocking approach.

At minimum:

- initialize table;
- create version 1;
- load round-trip;
- reject create collision;
- update N → N+1;
- reject wrong expectedVersion;
- reject non-incrementing version;
- invalid serialized profile does not silently load;
- invalid input does not mutate current row;
- snapshot isolation;
- schema-version field is distinct from profile version.

If a real Zotero.DB test is impractical in the unit environment, build the smallest DB adapter seam necessary and document what remains for workflow testing.

Do not replace the Phase 1 in-memory test store with the production adapter.

They serve different purposes.

---

# 27. Tests: ProfileService

Use fake dependencies.

Test:

### initial get

```text
no profile
→ build version 1
→ save
```

### cached get

```text
profile exists + refresh false
→ no extractor/build work
→ return loaded
```

### rebuild

```text
profile exists + refresh true
→ preserve explicit preferences
→ version + 1
→ new generatedAt
```

### CAS conflict

Service must not silently overwrite.

Choose a clear behavior:

- fail explicitly; or
- retry a tightly bounded number of times.

Document the choice.

Do not create an unbounded retry loop.

### extractor failure

```text
LLM fails
→ fallback builder succeeds
→ warning returned
```

---

# 28. Tests: Agent Tool

Test `research_profile_get` with a fake ProfileService.

Verify:

- correct Tool name;
- read mutability;
- local Agent exposure if chosen;
- derives library scope from request/context;
- no arbitrary library ID input;
- refresh forwarded correctly;
- missing library returns clear failure;
- output stays compact and structured;
- no Zotero write confirmation path is invoked.

Do not require live models.

---

# 29. No Profile Embedding Yet

Although `ResearchProfile` already supports:

```text
embedding?: ProfileEmbeddingRef
```

Phase 2 should normally leave this unset.

Do not implement:

- profile vector creation;
- paper embedding generation;
- vector cache migration;
- vector DB.

Embedding becomes useful when Candidate Discovery / Personalized Ranking needs it.

Record that as deferred work.

---

# 30. Files That Should Normally Remain Untouched

Avoid modifying these unless genuinely required:

```text
src/modules/contextPanel/chat.ts
src/modules/contextPanel/setupHandlers.ts
src/agent/runtime.ts
src/modules/contextPanel/pdfContext.ts
```

Do not refactor large upstream modules.

`src/agent/tools/index.ts` may require a small registration change for the new Tool.

`src/agent/index.ts` may require a small initialization/dependency-wiring change if production ProfileStore initialization is best placed there.

Keep such changes minimal.

---

# 31. Architecture Baseline Maintenance

If Phase 2 makes an architecture decision that differs from the current baseline, update:

```text
docs/research_agent_architecture_baseline.md
```

Do not rewrite the entire document.

Only update relevant sections.

At minimum, this phase should update the RecommendationImpression contract to include:

```text
profileId
```

because that decision is now explicitly resolved.

Any other architecture change must be explained in the development log.

---

# 32. Development Log Is Mandatory

Continue maintaining:

```text
docs/development-log.md
```

Do not replace previous history.

Update:

## Current Baseline

Include:

- current repository;
- current HEAD after Phase 2;
- upstream baseline;
- current phase;
- date.

## Current Architecture Status

Clearly list:

- production ProfileStore status;
- profile scope;
- LibrarySource status;
- TopicExtractor status;
- deterministic fallback status;
- ProfileBuilder status;
- ProfileService status;
- `research_profile_get` status;
- backend support matrix.

## Change History

Add a new entry such as:

```text
YYYY-MM-DD / recommendation-phase2-profile-memory
```

with:

- Goal;
- Files Changed;
- What Changed;
- Architecture Decisions;
- Tests;
- Known Issues;
- Deferred Work;
- Next Recommended Step.

## Open Decisions

Resolve or update the Phase 1 items:

- profile scope;
- item identity;
- schema evolution;
- cross-store consistency;
- stale profile refresh;
- Utility LLM limits.

Do not delete old decisions; mark them resolved and record the chosen resolution.

## Technical Debt

Include any new limitations, especially:

- local numeric Zotero item identity if retained;
- no incremental profile invalidation;
- no cross-device profile sync;
- no embedding;
- no feedback production pipeline.

## Handoff Notes

Make it possible for another ChatGPT/Codex session to continue without rereading the entire repository.

---

# 33. Git / Phase Checkpoint

This repository uses phase checkpoints.

After all tests pass and the development log is complete, create or leave the work ready for a single clear Phase 2 commit.

Recommended commit message:

```text
feat(recommendation): add research profile memory
```

Do not mix unrelated cleanup into the Phase 2 commit.

If the user workflow uses a tag/checkpoint such as:

```text
phase-2
```

follow the repository's current convention, but do not rewrite history.

---

# 34. Validation Commands

After implementation, run the appropriate repository checks.

At minimum attempt:

```sh
npm run typecheck
npm run test:unit
npm run build
```

Also run focused tests for the new recommendation/profile code.

Run ESLint / Prettier checks on modified/new files according to current project practice.

Record:

- command;
- executed/not executed;
- pass/fail;
- counts where available;
- environment limitation if any.

Do not report tests as passed unless they were actually run.

---

# 35. Final Architecture Review

Before declaring Phase 2 complete, explicitly answer:

```text
[ ] Is Recommendation Domain still independent of Zotero UI?
[ ] Is ResearchProfile still separate from conversationMemory?
[ ] Can ProfileBuilder run without Main Agent?
[ ] Can ProfileBuilder still succeed without Utility LLM?
[ ] Is LLM output schema-validated before use?
[ ] Is profile scoring deterministic?
[ ] Are scoring constants centralized?
[ ] Is ProfileStore production-persistent?
[ ] Does ProfileStore preserve atomic version semantics?
[ ] Is profile scope exactly one Zotero library?
[ ] Does research_profile_get derive scope from Agent context?
[ ] Did we avoid Candidate Discovery and Ranking?
[ ] Did we avoid Profile Embedding?
[ ] Was development-log.md updated?
[ ] Were relevant tests actually run?
```

If any answer is "no", explain why before finishing.

---

# 36. Required Final Report to User

When implementation is complete, return a structured report.

## A. Git Baseline

```text
repository
starting commit
ending commit / working HEAD
branch
working tree
```

## B. Files Changed

List every modified/new file and purpose.

## C. Resolved Architecture Decisions

Explicitly state:

- profile scope;
- paper identity strategy;
- ProfileStore schema;
- CAS strategy;
- topic extraction strategy;
- deterministic fallback strategy;
- time-decay/scoring strategy;
- representative-paper strategy;
- refresh strategy;
- RecommendationImpression `profileId` correction.

## D. Research Profile Pipeline

Show the actual implemented pipeline:

```text
LibraryIndex
→ ...
→ ResearchProfile
→ ProfileStore
```

## E. LLM Boundary

State exactly:

- where Utility LLM is used;
- what structured schema it returns;
- how it is validated;
- what happens on failure;
- what remains deterministic.

## F. Agent Tool

Describe:

```text
research_profile_get
```

including:

- input;
- output;
- backend exposure;
- refresh semantics.

## G. Tests

List actual commands and results.

## H. Architecture Red-Line Review

Review all five original red lines plus the Phase 2 deterministic-fallback rule.

## I. Known Issues

List real limitations.

## J. Deferred Phase 3 Work

Do not implement it, only summarize the next logical work:

```text
ResearchProfile
→ Profile Query Recall
→ Seed Paper Recall
→ Candidate Merge
→ Dedup
```

## K. Development Log

Confirm that:

```text
docs/development-log.md
```

was updated.

---

# 37. Success Criteria

Phase 2 is successful only if the following end-to-end technical slice works:

```text
Zotero LibraryIndex
      ↓
ResearchLibrarySource
      ↓
ResearchPaperSignals
      ↓
Deterministic Signals
      +
Optional Validated Utility LLM Topics
      ↓
ProfileScoring / TimeDecay
      ↓
ResearchProfile
      ↓
Production ProfileStore
      ↓
research_profile_get
      ↓
Agent receives a compact persistent research-interest profile
```

while:

```text
Candidate Discovery
Ranking
MMR
Feedback Learning
Recommendation Evidence
Recommendation UI
```

remain unimplemented.

The goal is not to maximize code volume.

The goal is to establish a trustworthy **long-term personalized memory layer** that the rest of the research-recommendation Agent can safely build upon.
