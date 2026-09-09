# Codex Prompt — Phase 6: Evidence-Grounded Recommendation

## Objective

Implement the next stage after Phase 5.

Phase 5 established:

```
ResearchProfile
→ Candidate Discovery
→ Ranking
→ Recommendation Impression
→ Feedback
→ Profile Update
```

Phase 6 adds:

```
Ranked Candidate
→ Evidence Retrieval
→ Grounded Explanation
→ research_recommend output
```

The goal is not generic RAG. The goal is:

> Every recommended paper should have a traceable, evidence-backed reason for recommendation.

---

# 1. Before Coding

Read:

```
docs/research_agent_architecture_baseline.md
docs/development-log.md
```

Inspect:

```
src/recommendation/
src/agent/tools/recommendation/
src/agent/services/
src/agent/store/
test/recommendation*.test.ts
```

Start from the current remote `main`.

Do not rewrite previous phase tags.

---

# 2. Scope

## Implement

- RecommendationEvidence domain contracts.
- Evidence retrieval service.
- Evidence ranking.
- Evidence formatting.
- Integration into `research_recommend`.
- Deterministic evidence tests.
- Documentation updates.

## Do not implement

- New vector database.
- Full PDF indexing system.
- Automatic Zotero import.
- UI recommendation cards.
- Scheduler.
- Multi-agent.
- Learning-to-rank.
- Unsupported LLM reasoning.
- Chat RAG refactor.

---

# 3. Architecture Boundary

Keep separation:

```
Profile
=
user interest memory

Candidate
=
possible paper

Ranking
=
selection

Evidence
=
why selected paper is relevant
```

Evidence explains ranking.

Evidence does not replace ranking.

---

# 4. New Module

Create:

```
src/recommendation/evidence/
```

Suggested:

```
contracts.ts
evidenceService.ts
evidenceRetriever.ts
evidenceRanker.ts
evidenceFormatter.ts
```

Keep Agent Tool integration outside this module.

---

# 5. Evidence Contract

Introduce a minimal immutable contract:

```ts
interface RecommendationEvidence {
  evidenceId: string;
  candidateId: string;
  sourceType:
    | "library_metadata"
    | "library_note"
    | "abstract"
    | "paper_content";

  reference: string;
  snippet: string;

  confidence: number;
  createdAt: number;
}
```

Requirements:

- confidence `[0,1]`;
- bounded snippets;
- traceable references;
- no arbitrary generated evidence.

---

# 6. Evidence Sources

Priority:

```
1. Zotero metadata
2. tags / collections
3. notes
4. stored abstracts
5. existing extracted content
```

Reuse existing project services.

Do not create a new PDF pipeline.

Evidence retrieval is read-only.

---

# 7. Retrieval Flow

Only after ranking:

```
Candidate
 ↓
Matched Profile Topics
 ↓
Evidence Retrieval
 ↓
Evidence Ranking
 ↓
Recommendation Explanation
```

Do not retrieve evidence for the entire candidate pool.

---

# 8. Evidence Ranking

Use deterministic scoring.

Example:

```
score =
0.4 topicMatch
+
0.3 sourceQuality
+
0.2 freshness
+
0.1 completeness
```

Requirements:

- centralized constants;
- stable ordering;
- deterministic output.

Do not ask the LLM to rank evidence.

---

# 9. Evidence Limits

Add explicit limits:

```
max evidence per recommendation
max snippet length
max total explanation size
```

Avoid:

- oversized Tool responses;
- prompt explosion;
- full document leakage.

---

# 10. Grounded Explanation

Any explanation must only use:

```
Candidate
+
ResearchProfile
+
Retrieved Evidence
```

Forbidden:

```
title-only reasoning
invented relevance
invented citations
```

---

# 11. Explanation Contract

Conceptually:

```ts
interface RecommendationReason {
  summary: string;
  matchedTopics: string[];
  evidenceRefs: string[];
  confidence: number;
}
```

Rules:

- evidenceRefs must exist;
- topics must come from profile/candidate;
- no hidden chain-of-thought.

---

# 12. LLM Boundary

If using LLM:

Allowed:

```
summarize provided evidence
```

Forbidden:

```
choose recommendation
invent evidence
invent citations
infer unsupported user interests
```

Input must be structured evidence only.

Do not send:

- whole library;
- unrelated papers;
- private conversation history.

---

# 13. research_recommend Integration

Update:

```
Profile
 ↓
Candidate
 ↓
Ranking
 ↓
Top-K
 ↓
Evidence
 ↓
Output
```

Evidence failure:

Allowed:

```
recommendation succeeds
warning: evidence_unavailable
```

Not allowed:

```
fake explanation
```

---

# 14. Impression Compatibility

Review Phase 5 RecommendationImpression.

Prefer storing only what is required for:

- reproducibility;
- feedback integrity.

Avoid making impressions unnecessarily large.

---

# 15. Tests

Add tests for:

## Domain

- valid evidence
- invalid confidence
- invalid source
- oversized snippet

## Retrieval

- metadata evidence
- note evidence
- abstract evidence
- missing evidence
- partial failure

## Ranking

- deterministic ordering
- stable scores
- confidence bounds

## Explanation

- only supplied evidence used
- LLM fallback
- missing evidence warning

## Tool

- recommendation output contains evidence
- candidate/evidence mapping valid
- bounded output

---

# 16. Integration Fixture

Create deterministic example:

```
Profile:
 Agentic Recommendation

Candidate A:
 strong topic match

Evidence:
 tag + abstract

Candidate B:
 weak match
```

Verify:

```
A ranks higher
A has stronger evidence
Explanation references valid evidence
No unsupported claim
```

No live API/model required.

---

# 17. Documentation

Update:

```
docs/research_agent_architecture_baseline.md
docs/development-log.md
```

Record:

- evidence architecture;
- retrieval boundary;
- ranking/evidence separation;
- LLM restrictions;
- tests;
- deferred work.

---

# 18. Validation

Run:

```bash
npm run typecheck
npm run test:unit
npm run build
npm run check:cycles
git diff --check
```

Existing:

```
Profile
Candidate Discovery
Ranking
Feedback Learning
```

tests must remain passing.

---

# 19. Git Delivery

Commit:

```
feat(recommendation): add grounded recommendation evidence
```

Tag:

```
phase-6
```

Push:

```
origin/main
origin phase-6
```

Do not force push.

---

# 20. Final Report

Provide:

## Git

- starting commit
- ending commit
- tag
- push status

## Architecture

Explain:

```
Candidate
 ↓
Ranking
 ↓
Evidence
 ↓
Explanation
```

## Evidence Contract

Fields and validation.

## Retrieval

Sources and limits.

## LLM Boundary

Allowed and forbidden behavior.

## Tests

Actual results.

## Red-Line Review

Confirm:

- no Zotero auto-import;
- no UI;
- no scheduler;
- no vector database;
- no unsupported generation.

## Deferred Work

Only list future phases.

---

# Completion Criteria

Phase 6 is complete when:

```
User receives recommendation

AND

system can answer:

"Why this paper?"

using:

- ResearchProfile,
- ranked candidate,
- traceable evidence,
- deterministic boundaries.
```
