# Codex Prompt — Phase 0 + Phase 1
## Personalized Research Intelligence Agent

你现在负责在当前 `llm-for-zotero` 仓库中开始实现 “Personalized Research Intelligence Agent”。

在执行任何代码修改前，先阅读项目中的架构基线文档：

```text
docs/research-agent-architecture-baseline.md
```

如果该文件实际放置位置不同，请先定位它。

该架构文档是本项目后续开发的长期约束。除非任务明确要求修改架构基线，否则不要违反其中的职责边界。

---

# 一、本轮目标

本轮只完成：

```text
Phase 0 — Baseline & Development Safety
+
Phase 1 — Recommendation Domain Foundation
```

不要提前实现 Phase 2 或后续功能。

本轮目标不是做出完整推荐 Agent，而是建立一个干净、可测试、可扩展的 Recommendation Domain 基础。

---

# 二、首先执行 Phase 0：Baseline 核验

在修改代码前：

1. 确认当前仓库 commit / branch / working tree；
2. 对照架构文档确认当前预期 baseline；
3. 查看 package scripts；
4. 运行适合当前环境的 baseline 检查，例如：
   - `npm run typecheck`
   - `npm run test:unit`
   - `npm run build`
5. 如果某项测试因环境限制无法执行，要明确区分：
   - upstream failure；
   - environment limitation；
   - 本轮新增代码 failure。

不要为了让测试变绿去修改无关 upstream 代码。

---

# 三、必须创建开发交接文档

如果不存在：

```text
docs/development-log.md
```

请创建。

如果已经存在，请继续维护，不要覆盖已有重要记录。

该文件是整个项目后续 ChatGPT / Codex / 人工开发者的连续交接记录。

必须至少包含：

```markdown
# Development Log

## Current Baseline
- Upstream commit:
- Current branch:
- Current phase:
- Last verified date:

## Current Architecture Status
- 已完成模块：
- 未完成模块：
- 当前支持链路：
- 当前未支持链路：

## Change History

### YYYY-MM-DD / Change ID
#### Goal
#### Files Changed
#### What Changed
#### Architecture Decisions
#### Tests
#### Known Issues
#### Deferred Work
#### Next Recommended Step

## Open Decisions

## Technical Debt

## Handoff Notes
```

本轮完成前必须更新该文档。

要求：

- 记录实际修改文件；
- 记录实际执行测试及结果；
- 记录没有做的功能；
- 记录下一阶段推荐工作；
- 不要虚构没有运行过的测试；
- 不要删除过去的重要开发记录。

---

# 四、Phase 1：Recommendation Domain Foundation

请在不侵入现有 UI 和 Agent Runtime 的前提下，新增独立 Recommendation Domain。

建议目录：

```text
src/recommendation/
└── domain/
```

你可以根据当前仓库风格做小幅调整，但必须保持领域层独立。

---

# 五、本轮需要定义的核心 Domain Types

请基于项目现有 TypeScript 风格，设计并实现以下类型。

## 1. ResearchProfile

目标结构：

```ts
interface ResearchProfile {
  profileId: string;
  version: number;

  topics: TopicInterest[];

  representativePapers: RepresentativePaper[];

  explicitPreferences: ExplicitPreferences;

  embedding?: ProfileEmbeddingRef;

  signalSummary: ProfileSignalSummary;

  generatedAt: number;
  updatedAt: number;
}
```

可以根据现有项目类型约定使用 `type` / `interface`，但不要改变字段语义。

---

## 2. TopicInterest

应包含：

```text
id
label
weight
confidence
sources
lastEvidenceAt
evidenceRefs
```

其中：

- `weight`：兴趣强度；
- `confidence`：系统对该兴趣判断的确定程度；

两者必须分开。

---

## 3. InterestSource

第一版只需要：

```text
library
explicit
feedback
```

---

## 4. ExplicitPreferences

应支持：

```text
positiveTopics
negativeTopics
```

每个 preference 至少具有：

```text
id
label
strength
createdAt
updatedAt
```

---

## 5. RepresentativePaper

至少包括：

```text
itemId
title
weight
reason
addedAt
```

`reason` 第一版支持：

```text
recent
high_topic_relevance
explicit_positive
saved_from_recommendation
```

---

## 6. ProfileEmbeddingRef

Embedding 不直接放入 Profile 主对象。

至少：

```text
model
dimension
storageKey
updatedAt
```

---

## 7. ProfileSignalSummary

至少：

```text
libraryPaperCount
positiveFeedbackCount
negativeFeedbackCount
explicitPreferenceCount
```

---

## 8. RecommendationCandidate

至少：

```text
candidateId
title
abstract?
authors
publicationDate?
doi?
arxivId?
openAlexId?
sources
seedPaperIds?
scores
evidence?
```

---

## 9. CandidateSource

第一版必须支持：

```text
profile_query
seed_recommendation
```

可以预留未来扩展，但不要实现召回逻辑。

---

## 10. CandidateScores

至少：

```text
semantic?
lexical?
graph?
recency?
feedback?
baseScore?
finalScore?
```

需要保留 score breakdown。

---

## 11. RecommendationFeedback

使用 append-only event 思路。

至少：

```text
eventId
paperId
recommendationId
action
timestamp
```

action：

```text
positive
negative
save
skip
```

---

## 12. RecommendationImpression

至少：

```text
recommendationId
timestamp
profileVersion
candidates
```

如果需要 `RecommendedPaper` 等辅助类型，请设计最小且清晰的类型合同。

---

# 六、Store Boundary

本轮需要设计 Store Interface，但不要求一次完成复杂生产级数据库实现。

至少定义：

```text
ProfileStore
FeedbackStore
ImpressionStore
```

要求：

1. interface 清晰；
2. 不依赖 UI；
3. 不依赖 Agent Runtime；
4. 方法命名符合现有项目风格；
5. 为后续 SQLite / Zotero.DB 持久化留出边界；
6. 避免在 interface 中泄漏不必要的 Zotero UI 对象。

如果为了测试需要最小 in-memory implementation，可以实现，但不要因此提前实现完整 ProfileBuilder 或推荐算法。

---

# 七、Validation

请判断当前仓库是否已有适合的 schema validation / runtime validation 方式。

优先复用现有项目惯例。

不要为了本模块单独引入大型新依赖。

至少保证：

- version 非法值可以被检测；
- weight / confidence / strength 的范围能够被验证或约束；
- 空 ID 等明显非法状态不能静默进入持久化边界。

如现有架构更倾向只做 TypeScript compile-time contract，则可以先采用轻量 runtime guard，但必须在 development log 中解释。

---

# 八、Tests

本轮必须为新增 Domain / Store Boundary 增加相应 unit tests。

重点验证：

## Domain

- ResearchProfile 可正常构造；
- TopicInterest 区分 weight 和 confidence；
- preference 正负约束结构；
- Candidate score breakdown；
- Feedback action；
- Impression profile version；
- serialization / clone / validation（按实际实现）。

## Store

至少覆盖：

```text
create/save
load
update profile version
append feedback
list/read feedback
save impression
read impression
```

如果只实现 interface + in-memory test double，请明确记录，不要伪装成生产持久化已完成。

---

# 九、本轮禁止实现

请严格控制 scope。

本轮不要实现：

- ProfileBuilder；
- Topic Extraction；
- Utility LLM；
- Search Query Expansion；
- Profile Scoring；
- Time Decay；
- Profile Embedding Calculation；
- Candidate Recall；
- OpenAlex 调用；
- arXiv 调用；
- Candidate Merge；
- Candidate Dedup；
- Ranking；
- MMR；
- Feedback Learning；
- Agent Tool；
- Skill；
- Action；
- UI；
- Scheduler；
- Local LLM；
- Vector DB；
- Multi-Agent；
- GraphRAG。

如果在实现 Domain Contract 时发现后续需要这些能力，只记录在 `Deferred Work` 或 `Open Decisions`，不要实现。

---

# 十、五条架构红线

必须遵守：

1. Recommendation Domain 不得依赖 Zotero UI。
2. Ranking Algorithm 不得调用 Agent Runtime。
3. Persistent ResearchProfile 不得写入 conversationMemory。
4. LLM 输出不得直接成为长期状态，必须经过结构化验证和 deterministic update。
5. Zotero 写操作不得绕过现有 Tool Registry / Action Contract / Change Journal。

本轮实际上不应发生 Zotero 写操作。

---

# 十一、不要顺手重构

尤其不要因为文件很大或代码风格不理想而重构：

```text
chat.ts
setupHandlers.ts
runtime.ts
ZoteroGateway
pdfContext.ts
```

除非新增 Domain 编译所必需，否则不要碰。

本轮目标是建立新领域边界，不是清理 upstream 技术债。

---

# 十二、完成后必须执行检查

根据当前仓库可运行环境，至少尝试：

```text
npm run typecheck
npm run test:unit
npm run build
```

如果完整 unit test 太大，可以先运行新增模块相关测试，再尽可能运行完整 unit test。

必须把：

- 命令；
- 是否执行；
- 结果；
- 失败原因；

写进 `docs/development-log.md`。

---

# 十三、最终交付内容

完成后，请向我输出：

## A. Baseline 结果

```text
commit
branch
working tree
typecheck
unit tests
build
```

## B. 新增 / 修改文件列表

逐个说明用途。

## C. Domain 设计摘要

说明实际实现的主要 type / interface。

## D. Store 设计摘要

说明：

- 哪些是 interface；
- 哪些有 concrete implementation；
- 哪些只是 test double。

## E. Test 结果

不要只说“测试通过”，列实际命令和结果。

## F. Architecture Review

逐条检查五条架构红线是否违反。

## G. Deferred Work

明确说明本轮没有实现的 Phase 2+ 功能。

## H. Development Log

确认：

```text
docs/development-log.md
```

已经创建或更新。

---

# 十四、实现原则

本轮最重要的目标不是“代码越多越好”。

而是：

> 让 Recommendation Domain 从第一天开始就具备正确边界，使后续 ResearchProfile、Candidate Discovery、Ranking、Feedback、Agent Tool 和 Evaluation 都可以建立在稳定合同上。

如有多种合理实现方式，请优先：

1. 最小修改；
2. 可测试；
3. 与现有代码风格一致；
4. 不侵入 UI；
5. 不侵入 Agent Runtime；
6. 为后续阶段保留扩展空间；
7. 不提前实现后续能力。

如果发现架构基线与当前源码存在实际冲突，请不要擅自大改。

应：

1. 记录冲突；
2. 采用最小兼容方案；
3. 在 `development-log.md` 的 `Open Decisions` 中说明；
4. 在最终回复中明确提出。
