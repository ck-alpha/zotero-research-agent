# Codex Prompt — Phase 4: Personalized Ranking + MMR

## Project

**Personalized Research Intelligence Agent**

Repository:

```text
https://github.com/ck-alpha/zotero-research-agent
```

Verified Phase 3 checkpoint:

```text
commit: 474e2b73c419ddfdd10a786a3726b942585ed034
message: feat(recommendation): add personalized candidate discovery
tag/checkpoint: phase-3
```

Historical checkpoints:

```text
phase-2: 279ccc62d959a52a518dff7a812c3a1856d1966b
phase-1: 10ed87677bc2afdfe17ede174f80f23834fdc500
upstream baseline: 5be02f51a9bdf9b143439c95eed07bd62a34cb68
```

---

# 0. Read Before Coding

Before changing code, read:

```text
docs/research_agent_architecture_baseline.md
docs/development-log.md
```

Then inspect the actual Phase 2/3 implementation:

```text
src/recommendation/domain/
src/recommendation/profile/
src/recommendation/candidate/

src/agent/tools/recommendation/researchProfileGet.ts
src/agent/tools/recommendation/researchCandidateDiscover.ts
src/agent/tools/recommendation/shared.ts
src/agent/services/recommendationLiteratureSource.ts
src/agent/tools/index.ts
```

Inspect existing embedding infrastructure before implementing semantic features:

```text
src/utils/llmClient.ts
src/modules/contextPanel/pdfContext.ts
src/modules/contextPanel/retrievalTokenizer.ts
src/modules/contextPanel/multiContextPlanner.ts
src/modules/contextPanel/constants.ts
```

Relevant existing capabilities include:

```text
checkEmbeddingAvailability
getResolvedEmbeddingConfig
callEmbeddings
existing cosine-similarity code
existing retrieval MMR policy
```

Do not create a second embedding preferences system or a duplicate embedding client.

---

# 1. Phase 4 Goal

Phase 4 converts the Phase 3 discovery-order candidate pool into a personalized ranked slate:

```text
ResearchProfile
       +
RecommendationCandidate[]
       +
Optional Current Focus
       ↓
Feature Computation
       ├── Lexical Relevance
       ├── Optional Semantic Relevance
       ├── Seed/Graph Signal
       ├── Recency
       └── Explicit Preference Compatibility
       ↓
Deterministic Base Ranking
       ↓
MMR Diversification
       ↓
RecommendedPaper[]
       ↓
research_recommend
```

Phase 3 answered:

> What papers should be considered?

Phase 4 should answer:

> Which discovered papers should this user see first?

Keep these responsibilities separate.

---

# 2. Hard Scope Boundary

Phase 4 MAY implement:

- ranking contracts and config;
- deterministic lexical feature computation;
- optional embedding-based semantic feature computation;
- provenance/seed graph feature;
- recency feature;
- explicit negative-preference compatibility;
- matched-topic identification;
- weighted base score;
- missing-feature weight renormalization;
- deterministic tie breaking;
- MMR diversification;
- lexical fallback similarity for MMR;
- RecommendedPaper construction;
- RankingService;
- Agent-side embedding adapter;
- research_recommend;
- ranking diagnostics/warnings;
- small backwards-compatible score-contract extensions;
- small Tool guidance adjustments.

Phase 4 MUST NOT implement:

- recommendation feedback learning;
- production FeedbackStore;
- production ImpressionStore;
- persistent RecommendationImpression writes;
- profile updates from feedback;
- RAG/PDF recommendation evidence;
- LLM reranking;
- neural/cross-encoder reranking;
- automatic Zotero import;
- Scheduler;
- weekly digest;
- recommendation UI;
- research-intelligence Skill;
- RL / learning-to-rank;
- vector database;
- persistent candidate embeddings;
- persistent ProfileEmbeddingRef/vector store;
- CandidateSet persistence;
- Multi-Agent;
- GraphRAG.

Record later-stage needs in `docs/development-log.md` instead of implementing them.

---

# 3. Architecture Rules

Keep the existing red lines:

1. Recommendation Domain must not depend on Zotero UI.
2. Ranking code must not depend on Agent Runtime.
3. ResearchProfile remains separate from conversationMemory.
4. Model output must not directly become long-term state.
5. Phase 4 performs no Zotero content writes.

Additional Phase 4 rules:

6. Ranking must work without embeddings.
7. LLM must not rank candidates.
8. MMR must remain a separate stage after base relevance.
9. Provider order is recall provenance, not personalized ranking.
10. Fixed profile/candidates/focus/now/semantic features must produce deterministic output.

---

# 4. Host Smoke Test Gate

The Phase 3 log still reports real Zotero host smoke and live OpenAlex smoke as not executed.

If the environment can run Zotero, attempt a minimal smoke of:

```text
research_profile_get
research_candidate_discover
```

If unavailable:

- do not block Phase 4;
- record `not executed`;
- do not claim Node SQLite/fake-provider tests equal Zotero host verification.

---

# 5. Ranking Package

Create an independent ranking package, conceptually:

```text
src/recommendation/ranking/
├── contracts.ts
├── config.ts
├── textSimilarity.ts
├── features.ts
├── semantic.ts
├── scoring.ts
├── diversity.ts
└── rankingService.ts
```

Exact structure can follow repository style.

Ranking code must not import:

```text
AgentToolContext
AgentRuntime
ZoteroPane
DOM
chat.ts
conversationMemory
callEmbeddings directly
```

Embedding/model integration stays outside the domain.

---

# 6. CandidateScores Extension

Current `CandidateScores` includes:

```text
semantic
lexical
graph
recency
feedback
baseScore
finalScore
```

Add, if repository inspection confirms no incompatible production consumer:

```ts
preference?: number;
diversity?: number;
```

Semantics:

```text
preference ∈ [0,1]
```

= compatibility with explicit negative preferences.

```text
diversity ∈ [0,1]
```

= max similarity to previously selected items at the moment MMR selects this paper.

Do not misuse `feedback` for explicit preferences.

`feedback` remains undefined in Phase 4.

Update:

```text
types
runtime validation
fixtures
domain tests
architecture baseline
```

---

# 7. Score Semantics

Phase 4 score meaning:

```text
semantic    = optional profile/focus semantic relevance
lexical     = deterministic profile/focus text relevance
graph       = seed-recommendation provenance signal
recency     = publication freshness
preference  = explicit-negative compatibility
baseScore   = personalized relevance before diversification
diversity   = max similarity to already selected items
finalScore  = MMR selection utility
feedback    = undefined in Phase 4
```

---

# 8. Centralized Config

Create one ranking config.

Recommended defaults:

```text
semanticWeight = 0.45
lexicalWeight  = 0.30
graphWeight    = 0.15
recencyWeight  = 0.10

mmrLambda = 0.80

recencyHalfLifeYears = 3

maxSemanticTopics = 12
maxSemanticPositivePrefs = 10
maxSemanticRepresentativePapers = 6
maxSemanticCandidateChars = 1200
semanticBatchSize = 32

maxMatchedTopics = 8

toolDefaultTopK = 10
toolMaxTopK = 20
toolAbstractSnippetChars = 500
```

Treat these as engineering defaults, not scientific claims.

All values must be centralized, validated, test-overridable and documented.

---

# 9. Missing Feature Renormalization

Optional features must not become accidental penalties.

Available features:

```text
semantic: only when valid embeddings exist
lexical: always
graph: always
recency: only when publication year/date is valid
```

Compute:

```text
rawRelevance =
Σ(weight_i * feature_i)
/
Σ(weight_i for available features)
```

Then:

```text
baseScore =
clamp(rawRelevance * preference, 0, 1)
```

If semantic is unavailable:

```text
semantic = undefined
```

Do not silently set semantic to zero.

If recency is unknown:

```text
recency = undefined
```

and renormalize.

---

# 10. No LLM Ranking

Forbidden:

```text
candidate metadata
→ LLM
→ ordered list
```

The Agent may call the Tool and explain deterministic results.

It does not decide rank order.

---

# 11. Ranking Contracts

Conceptual input:

```ts
interface RankingInput {
  profile: ResearchProfile;
  candidates: RecommendationCandidate[];
  focus?: string;
  now: number;
  semanticProvider?: RankingEmbeddingProvider;
  signal?: AbortSignal;
  topK?: number;
}
```

Conceptual result:

```ts
interface RankingResult {
  profileId: string;
  profileVersion: number;
  generatedAt: number;
  focus?: string;

  recommendations: RecommendedPaper[];

  diagnostics: {
    inputCandidateCount: number;
    semanticRequested: boolean;
    semanticSucceeded: boolean;
    semanticCandidateCount: number;
    semanticFallback: boolean;
    topKRequested: number;
    topKReturned: number;
  };

  warnings: string[];
}
```

Do not persist RankingResult in this phase.

---

# 12. Text Normalization

Implement small recommendation-owned normalization:

```text
Unicode normalization
case folding
whitespace collapse
letter/number token extraction
```

For multi-word topics:

1. normalized phrase containment;
2. token coverage fallback.

Do not add a heavyweight NLP dependency.

Do not import UI modules solely to get a tokenizer if that weakens the domain boundary.

---

# 13. Lexical Feature

Candidate text:

```text
title + bounded abstract
```

Profile signal:

```text
topics + optional focus
```

For each positive/nonzero topic:

```text
topicStrength = weight * confidence
```

Topic match:

```text
1.0 when normalized full topic phrase is contained
otherwise tokenOverlap / topicTokenCount
```

Use a small interpretable aggregation.

If focus exists, recommended:

```text
lexical =
0.60 * focusLexical
+
0.40 * profileLexical
```

otherwise:

```text
lexical = profileLexical
```

All lexical scores in `[0,1]`.

---

# 14. matchedTopicIds

Populate `RecommendedPaper.matchedTopicIds` deterministically.

A topic may count as matched when:

- candidate text passes lexical threshold; or
- Phase 3 provenance explicitly carries that topicId.

Order by:

```text
topic.weight * topic.confidence descending
stable topicId tie-break
```

Cap at:

```text
maxMatchedTopics
```

Do not invent topic IDs.

---

# 15. Explicit Negative Preferences

For each negative explicit preference:

```text
strength * textMatch(candidate, negativePreference.label)
```

Then:

```text
negativeConflict =
max(all negative preference conflicts)

preference =
clamp(1 - negativeConflict, 0, 1)
```

Apply through:

```text
baseScore = rawRelevance * preference
```

Do not delete candidates solely because of weak partial matches.

Positive explicit preferences are already reflected in profile topics/profile representation; avoid aggressive double counting.

---

# 16. Graph / Seed Feature

Only `seed_recommendation` provenance contributes.

Recommended:

```text
graph =
max(
  1 / log2(providerRank + 1)
)
```

over seed provenance.

Examples:

```text
rank 1 → 1.00
rank 2 → ~0.63
rank 3 → 0.50
```

Clamp to `[0,1]`.

`profile_query` providerRank must not become graph relevance.

---

# 17. Recency Feature

Parse trustworthy leading publication year from `publicationDate`.

Recommended:

```text
ageYears =
max(0, currentYear - publicationYear)

recency =
2 ^ (-ageYears / recencyHalfLifeYears)
```

Missing/invalid year:

```text
recency = undefined
```

Do not use provider fetch time or candidate discovery time as publication freshness.

---

# 18. Optional Semantic Feature

Define a pure dependency such as:

```ts
interface RankingEmbeddingProvider {
  embed(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<{
    model: string;
    vectors: number[][];
  }>;
}
```

Ranking domain must not directly import `llmClient`.

---

# 19. Agent-side Embedding Adapter

Create integration outside recommendation domain, e.g.:

```text
src/agent/services/recommendationEmbeddingProvider.ts
```

Reuse existing:

```text
checkEmbeddingAvailability
getResolvedEmbeddingConfig
callEmbeddings
```

Use the user's configured embedding provider, not Main Agent LLM.

No new model/provider settings.

---

# 20. Embedding Failure Fallback

These must not fail recommendation:

```text
no embedding config
unsupported embedding provider
API error
wrong vector count
dimension mismatch
NaN/Infinity
empty vectors
timeout
```

Expected:

```text
warning
semantic = undefined
continue deterministic ranking
```

Cancellation is the only reason to cancel the request.

Do not fall back to Main LLM embeddings.

---

# 21. Semantic Profile Text

Build deterministic bounded profile text using:

```text
optional focus first
top topics by weight*confidence
positive explicit preferences
small number of representative paper titles
```

Recommended limits:

```text
12 topics
10 positive preferences
6 representative titles
```

Do not include:

```text
negative preferences as positive semantic text
full library
PDF text
conversation history
raw evidenceRefs
```

Negative preferences remain explicit preference penalties.

---

# 22. Candidate Semantic Text

Use:

```text
title + bounded abstract
```

Recommended bound:

```text
1200 chars
```

Do not embed provenance JSON or score values.

---

# 23. Embedding Batch Validation

Validate:

```text
vector count == text count
nonzero common dimension
all values finite
```

If invalid:

```text
discard semantic feature for the whole ranking request
```

Do not partially align uncertain vectors to candidates.

---

# 24. Cosine Similarity

Profile-to-candidate semantic score:

```text
cos(profileVector, candidateVector)
```

Use:

```text
semantic = clamp(cosine, 0, 1)
```

Do not map zero cosine to fake 0.5 relevance.

---

# 25. No Vector Persistence

Do not implement:

```text
ProfileEmbeddingRef persistence
candidate vector cache table
vector DB
new ranking embedding store
```

Embeddings are request-scoped in Phase 4.

Latency/caching optimization can be added after measurement.

---

# 26. Base Score

Recommended initial policy:

```text
semantic 0.45
lexical  0.30
graph    0.15
recency  0.10
```

After missing-feature renormalization:

```text
rawRelevance = weighted mean
baseScore = clamp(rawRelevance * preference, 0, 1)
```

Store:

```text
scores.semantic?
scores.lexical
scores.graph
scores.recency?
scores.preference
scores.baseScore
```

Keep:

```text
scores.feedback = undefined
```

until Phase 5.

---

# 27. Deterministic Base Ordering

Before MMR, use explicit stable ordering.

Recommended tie-break:

```text
1. baseScore desc
2. lexical desc
3. semantic desc when present
4. candidateId asc
```

No randomness.

No network completion order.

No LLM tie break.

---

# 28. MMR Module

Implement separately, e.g.:

```text
src/recommendation/ranking/diversity.ts
```

Canonical policy:

```text
MMR(i)
=
lambda * baseScore(i)
-
(1 - lambda) * maxSimilarity(i, selected)
```

Default:

```text
lambda = 0.80
```

---

# 29. Pairwise Similarity

Preferred when candidate embeddings exist:

```text
cosine(candidateVectorA, candidateVectorB)
```

Fallback:

```text
deterministic lexical Jaccard/token similarity
```

on candidate title + abstract.

MMR must work without embedding configuration.

Similarity range:

```text
[0,1]
```

---

# 30. MMR Score Bookkeeping

For each selected recommendation:

```text
scores.diversity =
max similarity to already selected papers
```

First selected:

```text
diversity = 0
```

Set:

```text
scores.finalScore =
lambda * baseScore
-
(1 - lambda) * diversity
```

`finalScore` is MMR selection utility, not probability.

It may be negative.

Keep `baseScore` as the interpretable pre-diversification relevance.

---

# 31. RecommendedPaper Construction

Return `RecommendedPaper[]` with:

```text
rank = 1..K
matchedTopicIds

scores:
  semantic?
  lexical
  graph
  recency?
  preference
  baseScore
  diversity
  finalScore
```

Preserve all candidate metadata/provenance.

---

# 32. topK

Recommended:

```text
default 10
max 20
```

If fewer candidates exist, return all.

Do not create filler papers.

---

# 33. RankingService

Create a pure service:

```ts
class RankingService {
  async rank(input: RankingInput): Promise<RankingResult>
}
```

Responsibilities:

```text
validate
→ deterministic features
→ optional embeddings
→ base scores
→ base sort
→ MMR
→ RecommendedPaper[]
→ diagnostics/warnings
```

Do not perform external candidate discovery inside RankingService.

---

# 34. research_recommend Orchestration

`research_recommend` should complete a personalized recommendation in one Tool call.

Agent integration may orchestrate:

```text
ProfileService.get
→ ResearchLibrarySource.getLibrarySnapshot
→ CandidateDiscoveryService.discover
→ RankingService.rank
```

Do not place this whole orchestration inside RankingService.

A small Agent-side coordinator is acceptable if it keeps Tool code small.

---

# 35. Do Not Internally Call the Candidate Tool

Forbidden:

```text
research_recommend
→ Agent Tool Registry
→ research_candidate_discover
→ parse truncated Tool output
```

Correct:

```text
research_recommend
→ CandidateDiscoveryService directly
```

Ranking needs the full internal candidate pool.

---

# 36. Agent Guidance

Because Phase 3 intentionally does not persist CandidateSet, `research_recommend` will run discovery internally.

Update guidance so actual personalized recommendation requests prefer:

```text
research_recommend
```

rather than forcing:

```text
research_candidate_discover
then research_recommend
```

which would repeat provider calls.

Keep `research_candidate_discover` for candidate inspection/debugging.

---

# 37. research_recommend Tool

Suggested file:

```text
src/agent/tools/recommendation/researchRecommend.ts
```

Input:

```ts
{
  focus?: string;
  topK?: number;
}
```

Do not accept:

```text
libraryID
profileId
candidate list
weights
MMR lambda
provider URL
embedding model
```

from the LLM.

Reuse Phase 3 focus normalization.

---

# 38. research_recommend Behavior

Expected:

```text
resolve current library
→ get cached profile
→ current library snapshot
→ discover full candidate pool
→ rank
→ MMR
→ serialize Top-K
```

Do not auto-refresh profile.

Existing:

```text
research_profile_get({refresh:true})
```

remains the explicit refresh path.

---

# 39. Tool Output

At minimum return:

```text
profileId
profileVersion
generatedAt
focus
recommendationCount
recommendations
discoveryDiagnostics
rankingDiagnostics
warnings
```

Each recommendation should include:

```text
rank
candidateId
title
authors
publicationDate
doi/arxivId/openAlexId
sourceUrl/openAccessUrl

matchedTopics:
  id
  label

scores:
  semantic?
  lexical
  graph
  recency?
  preference
  baseScore
  diversity
  finalScore

sources
seedPaperIds
provenance
```

Do not return full profile or raw vectors.

---

# 40. Numeric Output

Keep full precision internally.

Tool serialization may round scores, e.g. 4 decimals.

Do not round before sorting/MMR.

---

# 41. Tool Output Bound

Use bounded abstract snippets.

Recommended:

```text
500 chars
```

Do not emit full large abstracts for 20 papers.

---

# 42. Tool Exposure

Initial scope:

```text
plugin Agent Runtime only
```

Recommended:

```text
mutability: read
requiresConfirmation: false
exposure: model
localAgentOnly: true
```

Do not automatically expose to MCP/Codex/WebChat.

Update backend support matrix.

---

# 43. Tool Guidance

Add concise guidance so personalized requests such as:

```text
根据我的文献库推荐新论文
最近有什么论文值得我读
按我的研究兴趣推荐几篇
find papers I should read next
```

prefer:

```text
research_recommend
```

Generic non-personalized scholarly search should still use:

```text
literature_search
```

Avoid hijacking all paper questions.

---

# 44. Embedding Availability

Only request semantic features when existing embedding configuration is available.

If unavailable:

```text
continue deterministic rank
```

No fatal error.

---

# 45. Embedding Batching

Use bounded batches.

Recommended:

```text
batch size = 32
```

One ranking request may include:

```text
1 profile text + up to 80 candidate texts
```

Do not make one embedding request per paper.

---

# 46. Cancellation

Honor AbortSignal.

At minimum:

- before embedding;
- between embedding batches;
- after embedding;
- before MMR.

If existing `callEmbeddings` cannot cancel network requests:

- a small backwards-compatible optional signal parameter is allowed if clean and regression tested;
- otherwise use an abortable wrapper and document underlying-request limitation.

Do not broadly refactor `llmClient`.

---

# 47. Warning Codes

Prefer compact codes:

```text
ranking_semantic_unavailable
ranking_semantic_failed_fallback
ranking_semantic_invalid_vectors
ranking_candidate_pool_empty
ranking_tool_output_truncated
```

Do not expose raw provider errors/credentials.

---

# 48. No Impression Persistence Yet

Although Phase 1 defined:

```text
RecommendationImpression
ImpressionStore
```

do not productionize them in Phase 4.

Phase 5 should introduce:

```text
Recommendation Impression
+
Feedback Events
+
Integrity Rules
+
Profile Update
```

as one coherent closed-loop phase.

Do not return a fake durable recommendationId with no store behind it.

---

# 49. No Feedback Yet

Keep:

```text
scores.feedback = undefined
```

Do not infer feedback from:

```text
save status
representative paper
provenance
positive profile topic
```

---

# 50. No RAG Evidence Yet

Tool may expose deterministic explanation features:

```text
matched topics
score breakdown
provenance
```

But do not call:

```text
paper_read
RAG
MinerU
PDF retrieval
```

for recommended papers in Phase 4.

---

# 51. Unit Tests — Text Features

Test:

```text
Unicode/case/whitespace normalization
phrase match
token coverage
unrelated topic
focus weighting
topic weight/confidence influence
matchedTopicIds ordering
negative preference compatibility
```

---

# 52. Unit Tests — Graph

Test:

```text
seed rank1 > rank2 > rank3
query-only graph = 0
multiple seeds use strongest value
profile-query providerRank does not affect graph
```

---

# 53. Unit Tests — Recency

With fixed now:

```text
current year > older paper
half-life approximately correct
future-ish year handled safely
missing/invalid date => undefined
```

---

# 54. Unit Tests — Base Scoring

Test:

```text
all bounded components
semantic available
semantic unavailable renormalizes
missing recency renormalizes
preference reduces baseScore
preference=0 => baseScore=0
stable tie break
feedback undefined
```

---

# 55. Unit Tests — Semantic Math

Test:

```text
identical cosine = 1
orthogonal = 0
negative cosine clamps to 0 relevance
dimension mismatch rejected
NaN/Infinity rejected
zero vector behavior deterministic
vector count mismatch rejects semantic batch
```

No real embedding API.

---

# 56. Unit Tests — MMR

Test:

```text
highest baseScore selected first
near duplicate can be displaced by diverse relevant paper
higher lambda favors relevance
lexical fallback works without embeddings
same inputs => same order/scores
selected items receive diversity/finalScore
```

---

# 57. RankingService Tests

Use fake embedding provider.

At minimum:

1. deterministic-only ranking;
2. semantic success;
3. semantic unavailable;
4. semantic error;
5. invalid vectors;
6. cancellation;
7. negative preference penalty;
8. focus changes ranking;
9. graph signal changes ranking;
10. recency changes otherwise similar papers;
11. MMR changes slate;
12. fewer candidates than topK;
13. empty pool;
14. matchedTopicIds;
15. score breakdown;
16. no mutation of inputs.

---

# 58. Agent Embedding Adapter Tests

No live API.

Verify:

```text
availability check
batching
order preservation
invalid vector rejection
cancellation behavior
Main Agent model not used as embedding model
no new settings system
```

---

# 59. research_recommend Tool Tests

Use fakes.

Verify:

```text
correct Tool name
read mutability
no confirmation
localAgentOnly
library scope from context
focus/topK validation
full internal candidate pool
no internal call to candidate Tool
rank/matchedTopics/score/provenance output
no ImpressionStore
no FeedbackStore
no Zotero write
no RAG/PDF call
```

---

# 60. No-network Integration Test

Add an integration-style test:

```text
LibraryIndex fixture
→ ProfileService / SqliteProfileStore
→ CandidateDiscoveryService with fake literature source
→ RankingService
→ fake semantic provider or deterministic fallback
→ research_recommend
```

Verify:

```text
profile revision
novel candidates
feature scores
negative preference
MMR diversity
Top-K
matched topics
Tool output
```

---

# 61. Regression Tests

Keep passing:

```text
research_profile_get
research_candidate_discover
generic literature_search
tool surface tests
```

If CandidateScores changes, update fixtures/guards carefully.

Do not weaken existing validation.

---

# 62. Ranking Diagnostics

At minimum:

```text
inputCandidateCount
semanticRequested
semanticSucceeded
semanticCandidateCount
semanticFallback
topKRequested
topKReturned
```

Optional:

```text
mmrApplied
```

Do not store vectors in diagnostics.

---

# 63. Numerical Stability

Use float tolerances in tests.

Tie-breaking must not depend on unordered floating operations.

Inject exact fake vectors for semantic tests.

---

# 64. Architecture Baseline Update

Update:

```text
docs/research_agent_architecture_baseline.md
```

only where Phase 4 facts become concrete.

At minimum add:

- ranking feature set;
- optional embedding provider;
- semantic fallback;
- baseScore formula;
- explicit negative preference multiplier;
- MMR after base rank;
- score semantics;
- research_recommend;
- no production feedback/impression yet;
- no persistent vector storage.

Do not reformat the whole document.

---

# 65. Development Log Is Mandatory

Continue:

```text
docs/development-log.md
```

Add:

```text
recommendation-phase4-personalized-ranking
```

with:

```text
Goal
Git Baseline
Files Changed
What Changed
Architecture Decisions

Feature Computation
Semantic Embedding Boundary
Base Scoring Formula
Preference Policy
MMR Policy
Agent Tool

Tests
Architecture Red-Line Review
Known Issues
Deferred Work
Next Recommended Step
```

Update Current Architecture Status and backend matrix.

---

# 66. Current Architecture Status After Phase 4

The log should clearly say:

```text
Profile Memory: implemented
Candidate Query Recall: implemented
Seed Recall: implemented
Candidate Merge/Dedup: implemented
Novelty Filter: implemented

Lexical Ranking: implemented
Optional Semantic Ranking: implemented
Graph/Seed Feature: implemented
Recency Feature: implemented
Explicit Preference Compatibility: implemented
Base Ranker: implemented
MMR: implemented
research_recommend: implemented

Feedback Learning: NOT implemented
Production ImpressionStore: NOT implemented
Production FeedbackStore: NOT implemented
Recommendation Evidence/RAG: NOT implemented
```

---

# 67. Open Decisions to Resolve

Document final Phase 4 decisions for:

```text
score ranges/semantics
missing-feature renormalization
embedding provider reuse
embedding persistence = intentionally absent
MMR lambda
MMR fallback similarity
recommendation persistence = intentionally absent until Phase 5
```

---

# 68. Do Not Start Phase 5 Early

Next phase should own:

```text
Recommended slate
→ RecommendationImpression persistence
→ positive/negative/save/skip
→ FeedbackStore
→ ProfileUpdater
→ new profile version
```

Do not implement it now.

---

# 69. Validation Commands

At minimum run:

```sh
npm run typecheck
npm run test:unit
npm run build
npm run check:cycles
git diff --check
```

Also:

```text
focused ranking/recommendation tests
ESLint changed TS files
Prettier changed files + docs/development-log.md
```

Do not claim tests not actually executed.

---

# 70. Final Architecture Review

Before completion:

```text
[ ] CandidateDiscoveryService still does not rank.
[ ] RankingService does not discover externally.
[ ] Ranking domain is Agent/UI independent.
[ ] No LLM ranking exists.
[ ] Ranking succeeds without embeddings.
[ ] Existing embedding infrastructure is reused.
[ ] No duplicate embedding settings/client exists.
[ ] Semantic vectors are validated.
[ ] Missing semantic/recency renormalizes weights.
[ ] Explicit negative preferences affect ranking.
[ ] feedback remains unused.
[ ] BaseScore is deterministic.
[ ] MMR is separate.
[ ] MMR has lexical fallback.
[ ] RecommendedPaper has matchedTopicIds.
[ ] research_recommend uses full internal candidate pool.
[ ] research_recommend does not call candidate Tool internally.
[ ] No CandidateSet persistence.
[ ] No vector persistence.
[ ] No production ImpressionStore.
[ ] No production FeedbackStore.
[ ] No RAG/PDF enrichment.
[ ] Phase 2/3 + generic literature regression passes.
[ ] development-log.md updated.
```

---

# 71. Git Checkpoint

Recommended commit:

```text
feat(recommendation): add personalized ranking and mmr
```

Recommended annotated tag:

```text
phase-4
```

Push only to personal `origin`.

Do not force push.

Do not use blind `git add .`.

Do not include unrelated analysis, credentials, dependencies or build products.

---

# 72. Required Final Report

Return:

## A. Git Baseline

```text
starting commit
ending commit
phase tag
branch
working tree
remote push status
```

## B. Files Changed

Every changed/new file and purpose.

## C. Ranking Architecture

```text
Candidate Pool
→ Feature Computation
→ Base Score
→ Base Sort
→ MMR
→ RecommendedPaper[]
```

## D. Exact Feature Formula

State final formulas for:

```text
lexical
semantic
graph
recency
preference
baseScore
missing-feature renormalization
```

## E. Semantic Boundary

State:

```text
provider source
batch size
profile representation
candidate representation
failure fallback
vector validation
persistence = none
```

## F. MMR

State:

```text
lambda
pairwise similarity source
lexical fallback
finalScore semantics
```

## G. research_recommend

Describe:

```text
input
output
backend exposure
internal orchestration
```

## H. Tests

List actual commands/results.

## I. Red-Line Review

Confirm no feedback/RAG/persistence leakage.

## J. Known Issues

Only actual remaining issues.

## K. Deferred Phase 5

Summarize feedback loop only.

## L. Development Log

Confirm `docs/development-log.md` updated and committed.

---

# 73. Success Criteria

Phase 4 is complete only when:

```text
Persistent ResearchProfile
          ↓
Multi-route Candidate Discovery
          ↓
RecommendationCandidate[]
          ↓
Lexical + Graph + Recency
          +
Optional Semantic Embedding
          +
Explicit Preference Compatibility
          ↓
Personalized Base Score
          ↓
MMR
          ↓
RecommendedPaper[]
          ↓
research_recommend
          ↓
Plugin Agent gets a personalized,
diversified, inspectable score breakdown
```

while these remain absent:

```text
feedback learning
production impression persistence
production feedback persistence
PDF/RAG evidence enrichment
LLM ranking
vector database
automatic import
```

The goal is to build a **deterministic, testable personalized ranker**.

Embedding is an optional feature, never a runtime dependency.
