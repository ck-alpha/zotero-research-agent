# Codex Prompt --- Phase 7: Recommendation Evaluation, Quality Measurement & Host Validation

## Project

Repository:

``` text
https://github.com/ck-alpha/zotero-research-agent
```

Start from the latest remote `main` after Phase 6 completion.

Before coding, read:

``` text
docs/research_agent_architecture_baseline.md
docs/development-log.md
```

Inspect:

``` text
src/recommendation/
src/agent/tools/recommendation/
test/recommendation*.test.ts
```

------------------------------------------------------------------------

# 1. Phase 7 Goal

Phase 6 completed:

    ResearchProfile
            ↓
    Candidate Discovery
            ↓
    Personalized Ranking
            ↓
    Recommendation Evidence
            ↓
    Grounded Recommendation Reason

Current system can answer:

> Why was this paper recommended?

However, the system has not yet answered:

> Are these recommendations actually useful, stable, and acceptable in a
> real Zotero workflow?

Phase 7 focuses on evaluation infrastructure and real execution
validation.

The goal is not to improve ranking algorithms yet.

The goal is to establish measurement capability.

------------------------------------------------------------------------

# 2. Scope Boundary

## Implement

-   Recommendation evaluation contracts.
-   Offline deterministic evaluation fixtures.
-   Ranking/evidence quality metrics.
-   Recommendation trace inspection.
-   Host validation workflow documentation.
-   Latency and failure diagnostics.
-   Regression evaluation suite.
-   Development documentation.

## Do NOT implement

-   New ranking algorithms.
-   Learning-to-rank.
-   Automatic model training.
-   User-facing UI.
-   Scheduler/Digest.
-   Cross-device sync.
-   Vector database.
-   Multi-agent workflow.
-   Automatic Zotero import.
-   Production analytics service.

------------------------------------------------------------------------

# 3. Current Architecture Must Remain

Preserve:

    ResearchProfile
            =
    user interest memory

    Candidate Discovery
            =
    candidate generation

    Ranking
            =
    selection

    Evidence
            =
    explanation

    Feedback
            =
    future learning signal

Evaluation must observe these layers.

It must not merge responsibilities.

------------------------------------------------------------------------

# 4. Evaluation Module

Create:

``` text
src/recommendation/evaluation/
```

Suggested:

``` text
contracts.ts
metrics.ts
evaluationRunner.ts
traceFormatter.ts
```

------------------------------------------------------------------------

# 5. Evaluation Contract

Introduce deterministic contracts.

Conceptually:

``` ts
interface RecommendationEvaluationCase {
  id: string;

  profile: ResearchProfile;
  candidates: RecommendationCandidate[];

  expectedSignals?: {
    preferredCandidateIds?: string[];
    rejectedCandidateIds?: string[];
  };
}
```

Result:

``` ts
interface RecommendationEvaluationResult {
  caseId: string;

  rankingMetrics: RankingMetrics;
  evidenceMetrics: EvidenceMetrics;

  latency?: number;

  warnings: string[];
}
```

Requirements:

-   serializable;
-   deterministic;
-   no runtime state;
-   no Zotero dependency.

------------------------------------------------------------------------

# 6. Ranking Metrics

Implement lightweight offline metrics.

Required:

``` text
Precision@K
Recall@K
MRR
NDCG
Diversity score
Novelty rate
```

Do not claim scientific validity.

These are engineering regression indicators.

------------------------------------------------------------------------

# 7. Evidence Metrics

Evaluate:

``` text
evidence availability
evidence coverage
reason grounding rate
unsupported explanation count
```

Rules:

A recommendation explanation is valid only when:

    every evidenceRef exists
    AND
    every matchedTopic exists
    AND
    reason is generated from supplied evidence

------------------------------------------------------------------------

# 8. Deterministic Benchmark Fixtures

Create:

``` text
test/evaluation/
```

Fixtures:

## Case A

Strong profile match:

    Profile:
    Agentic Recommendation

    Candidate A:
    strong topic overlap

    Candidate B:
    weak overlap

Expected:

    A ranks above B

------------------------------------------------------------------------

## Case B

Negative preference:

    Profile:
    positive topic X
    negative topic Y

    Candidate:
    contains Y

Expected:

    compatibility penalty applied

------------------------------------------------------------------------

## Case C

Evidence failure:

    Candidate exists

    Evidence unavailable

Expected:

    recommendation survives
    warning generated
    no hallucinated reason

------------------------------------------------------------------------

# 9. Trace Inspection

Add deterministic trace output.

Example:

``` text
Recommendation Trace

Candidate:
paper-id

Profile Topics:
topic-a
topic-b

Ranking:
lexical: 0.7
semantic: 0.8

Evidence:
abstract snippet

Reason:
supported by evidenceRefs
```

Requirements:

-   debugging only;
-   not exposed as user UI;
-   no hidden reasoning;
-   no chain-of-thought.

------------------------------------------------------------------------

# 10. Latency Measurement

Add internal diagnostics:

Measure:

``` text
candidate discovery time
ranking time
evidence retrieval time
total recommendation time
```

Do not optimize yet.

Only record:

-   duration;
-   timeout;
-   fallback;
-   failure code.

------------------------------------------------------------------------

# 11. Host Validation

Create:

``` text
docs/phase7-host-validation.md
```

Document manual checks:

## Zotero

Verify:

    profile_get
    candidate_discover
    research_recommend
    feedback flow

## Restart

Verify:

    SQLite persistence
    profile reload
    feedback persistence

## Group Library

Verify:

    library scope isolation
    profile separation

------------------------------------------------------------------------

# 12. Real Provider Smoke Boundary

Document optional manual validation:

OpenAlex:

    candidate discovery

Embedding:

    semantic ranking

Zotero:

    real DB lifecycle

These are validation tasks.

Do not make tests depend on external services.

------------------------------------------------------------------------

# 13. Tests

Add:

## Evaluation

-   metric correctness;
-   deterministic ordering;
-   empty input handling;
-   invalid result handling.

## Regression

Ensure existing:

``` text
Profile
Candidate Discovery
Ranking
Feedback
Evidence
```

tests remain unchanged.

Run:

``` bash
npm run typecheck
npm run test:unit
npm run build
npm run check:cycles
git diff --check
```

------------------------------------------------------------------------

# 14. Documentation Update

Update:

``` text
docs/research_agent_architecture_baseline.md
docs/development-log.md
```

Record:

-   evaluation architecture;
-   metrics;
-   validation results;
-   known limitations.

------------------------------------------------------------------------

# 15. Red-Line Review

Confirm:

-   no ranking algorithm change;
-   no LLM ranking;
-   no automatic feedback optimization;
-   no user tracking;
-   no external analytics;
-   no UI;
-   no scheduler;
-   no vector database;
-   no Zotero write operations.

------------------------------------------------------------------------

# 16. Git Delivery

Commit:

``` text
feat(recommendation): add evaluation and validation framework
```

Tag:

``` text
phase-7
```

Push:

``` bash
git push origin main
git push origin phase-7
```

Do not force push.

------------------------------------------------------------------------

# 17. Final Report

Provide:

## Git

-   start commit
-   end commit
-   tag

## Evaluation

-   metrics implemented
-   benchmark cases
-   results

## Validation

-   host validation status
-   external provider smoke status

## Tests

Actual commands and outputs.

## Known Limitations

Only list remaining issues.

------------------------------------------------------------------------

# Completion Criteria

Phase 7 succeeds when:

The system can measure:

    What was recommended?

    Why was it recommended?

    Was the explanation grounded?

    Did the system behave consistently?

The objective is not better recommendations yet.

The objective is making recommendation quality observable.
