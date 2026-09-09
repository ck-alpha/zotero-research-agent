# Personalized Research Intelligence Agent
## 架构边界、核心数据模型与开发基线

> 文档用途：
> 1. 作为本项目二次开发的长期架构基线；
> 2. 供 Codex 在每次修改前进行架构审查；
> 3. 防止功能开发逐步侵入原有巨型 UI、Agent Runtime 或既有 RAG 底座；
> 4. 作为后续 ChatGPT / Codex / 人工开发者的统一交接文档。
>
> 当前源码事实基线：llm-for-zotero，固定 commit `5be02f51a9bdf9b143439c95eed07bd62a34cb68`。
>
> 本文不是实现细节文档，而是架构约束。除非明确讨论并更新本文，否则后续开发默认不得违反本文定义的职责边界。

---

# 1. 项目目标

本项目面向科研人员的长期文献管理与科研情报获取场景，目标是在现有 Zotero + Agent + RAG 基础设施之上构建：

**Personalized Research Intelligence Agent（个性化科研情报 Agent）**

核心闭环：

```text
Zotero Library
    ↓
Long-term Research Profile
    ↓
Candidate Discovery
    ↓
Personalized Ranking
    ↓
Evidence-grounded Recommendation
    ↓
User Feedback
    ↓
Profile Update
```

系统解决的不是单次论文问答，而是：

> 长期理解用户科研兴趣 → 主动发现新论文 → 个性化排序 → 给出可追溯推荐理由 → 利用反馈持续更新研究画像。

---

# 2. 已有能力与本项目新增能力

## 2.1 现有项目重点复用

现有 llm-for-zotero 已提供：

- Zotero 插件生命周期与 UI；
- Agent Runtime；
- Tool Registry；
- Action Registry；
- Skills；
- ZoteroGateway；
- 单论文 / 文献库 RAG；
- PDF / MinerU 解析；
- OpenAlex / arXiv / Europe PMC 学术检索；
- Web Search；
- Provider / Model Adapter；
- conversation memory；
- transcript / trace；
- evidence / coverage ledger；
- Action Contract；
- confirmation；
- change journal；
- undo / revert；
- MCP；
- Codex / Claude / WebChat 等不同运行路径。

这些能力不是本轮二次开发的主要创新对象。

## 2.2 本项目重点新增

新增能力聚焦于：

1. Long-term Research Profile；
2. Research Preference Memory；
3. Candidate Discovery；
4. Multi-route Recall；
5. Personalized Ranking；
6. Diversity；
7. Recommendation Impression；
8. Recommendation Feedback；
9. Evidence-grounded Recommendation；
10. Offline Recommendation Evaluation；
11. Agent Workflow Evaluation。

---

# 3. 总体架构

```text
┌────────────────────────────────────────────┐
│               User / Zotero UI             │
└─────────────────────┬──────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────┐
│            Agent Orchestration             │
│                                            │
│ Intent / Skill / Planning / Tool Calling   │
│ Tool Result Reasoning / Final Synthesis    │
└─────────────────────┬──────────────────────┘
                      │
                 Stable Tool API
                      │
                      ▼
┌────────────────────────────────────────────┐
│         Recommendation Domain API          │
│                                            │
│ Profile / Candidate / Recommend / Feedback│
└──────────────┬──────────────┬──────────────┘
               │              │
       ┌───────▼──────┐ ┌────▼──────────────┐
       │ Algorithm     │ │ Research Data     │
       │ Layer         │ │ & Evidence        │
       │               │ │                   │
       │ Recall        │ │ ZoteroGateway     │
       │ Rank          │ │ OpenAlex / arXiv  │
       │ MMR           │ │ RAG / PDF         │
       │ Time Decay    │ │ Metadata          │
       └───────┬───────┘ └────┬──────────────┘
               │              │
               └──────┬───────┘
                      ▼
┌────────────────────────────────────────────┐
│             Persistent Memory              │
│                                            │
│ Profile Snapshot / Feedback / Impression  │
│ Candidate History / Embedding Reference   │
└────────────────────────────────────────────┘
```

旁路 Model Layer：

```text
Model Layer
├── Main Agent LLM
├── Utility LLM
└── Embedding Model
```

Model Layer 不拥有 Recommendation Domain 的业务状态。

---

# 4. 核心设计原则

## 4.1 LLM 决策，Tool 执行，算法排序，Memory 个性化，Evidence 负责可信

这是本项目最核心的设计原则。

### LLM 负责

- 理解用户自然语言；
- 判断是否进入科研推荐任务；
- 选择 Tool；
- 生成 / 扩展搜索查询；
- 解析显式偏好；
- 对 Tool Result 做多步推理；
- 必要时继续读取论文证据；
- 将结构化推荐理由转写为自然语言。

### 确定性代码负责

- Profile 状态更新；
- Signal 聚合；
- Candidate Merge；
- Deduplication；
- Ranking；
- Time Decay；
- MMR；
- Feedback 持久化；
- Impression 持久化；
- Profile Version；
- Offline Evaluation。

LLM 输出不得直接成为长期业务状态。

---

# 5. 六层职责边界

# 5.1 Model Layer

## Main Agent LLM

职责：

- Intent Understanding；
- Planning；
- Tool Calling；
- Tool Result Reasoning；
- Evidence Synthesis；
- Final Answer。

不得：

- 直接写 ResearchProfile；
- 直接修改 topic weight；
- 直接决定最终推荐 score；
- 绕过 Tool / Domain 修改业务状态。

## Utility LLM

用于低风险语言任务：

- Topic Extraction；
- Topic Normalization；
- Preference Parsing；
- Query Expansion。

调用失败必须允许 fallback，不得导致整个系统无法运行。

Utility LLM 的结构化输出必须经过：

```text
LLM Output
   ↓
Schema Validation
   ↓
Deterministic Business Logic
   ↓
Persistent State
```

## Embedding Model

仅负责向量表示：

- Paper Embedding；
- Topic Embedding；
- Profile Embedding。

Embedding Provider 必须与业务逻辑解耦。

---

# 5.2 Agent Orchestration Layer

Agent 负责：

- 决定调用哪个能力；
- 决定调用顺序；
- 处理 Tool Result；
- 必要时追问或继续读取证据；
- 最终回答合成。

Agent 不负责：

- Candidate 评分公式；
- MMR；
- Dedup；
- Profile Update；
- Feedback Update；
- Time Decay。

Agent 看见的应该是语义 Tool，例如：

```text
research_profile_get
research_candidate_discover
research_recommend
recommendation_feedback
```

而不是底层 primitive：

```text
calculate_cosine
run_mmr
update_topic_weight
query_openalex_directly
```

---

# 5.3 Tool Integration Layer

Tool 是 Agent 和 Recommendation Domain 之间的稳定 API。

Tool 的职责：

- 参数校验；
- schema 校验；
- 权限 / scope 校验；
- 调用 Domain Service；
- 返回稳定、结构化结果。

Tool 内不得堆积实际算法。

推荐调用方向：

```text
Agent
  ↓
Tool
  ↓
Recommendation Service
  ↓
Algorithm / Store / Adapter
```

---

# 5.4 Recommendation Domain Layer

这是本项目的核心新增领域层。

建议目录：

```text
src/recommendation/
├── domain/
│   ├── profile.ts
│   ├── candidate.ts
│   ├── recommendation.ts
│   ├── feedback.ts
│   └── evidence.ts
│
├── profile/
│   ├── profileBuilder.ts
│   ├── profileScoring.ts
│   ├── profileUpdater.ts
│   ├── profileService.ts
│   └── profileStore.ts
│
├── candidate/
│   ├── candidateService.ts
│   ├── queryRecall.ts
│   ├── seedRecall.ts
│   ├── merge.ts
│   └── deduplicate.ts
│
├── ranking/
│   ├── scoring.ts
│   ├── ranker.ts
│   └── diversity.ts
│
├── feedback/
│   ├── feedbackService.ts
│   └── feedbackStore.ts
│
└── evaluation/
```

核心要求：

> Recommendation Domain 必须尽可能脱离 Zotero UI 和 Main Agent 独立测试。

---

# 5.5 Research Data & Evidence Layer

通过 Adapter 复用原项目能力：

```text
Recommendation Domain
       │
       ├── LibraryAdapter
       │       ↓
       │   ZoteroGateway
       │
       ├── LiteratureAdapter
       │       ↓
       │ LiteratureSearchService
       │
       └── EvidenceAdapter
               ↓
         Existing RAG / paper_read
```

Domain 不应直接依赖：

- ZoteroPane；
- DOM；
- chat.ts；
- setupHandlers.ts；
- Reader UI。

---

# 5.6 Persistent Memory Layer

长期科研画像必须独立于现有 conversation memory。

Memory 分层：

```text
Agent Memory
├── Working Memory
│   └── current run / transcript
│
├── Conversation Memory
│   └── short-term conversational continuity
│
└── Preference Memory
    └── ResearchProfile
```

严禁把 ResearchProfile 塞入现有 conversationMemory。

---

# 6. RAG 在推荐流程中的边界

RAG 用于推荐结果的证据补全与解释，而不是第一阶段的全量 Candidate Recall。

推荐顺序：

```text
External / Metadata Candidates
          ↓
        Recall
          ↓
        Ranking
          ↓
       Top 20
          ↓
         MMR
          ↓
        Top K
          ↓
  Evidence Enrichment
          ↓
 Agent Recommendation
```

禁止第一版采用：

```text
几百篇论文全文
   ↓
全部 RAG
   ↓
全部塞给 LLM
   ↓
让 LLM 选 Top K
```

---

# 7. ResearchProfile 设计目标

ResearchProfile 必须：

1. 可由 Zotero Library 构建；
2. 可由显式偏好增量更新；
3. 可由推荐反馈增量更新；
4. 可用于 Candidate Ranking；
5. 能说明兴趣来源；
6. 支持时间衰减；
7. 可持久化；
8. 可版本化；
9. 可重新构建；
10. 不依赖 Main LLM 自由生成。

设计采用：

```text
Raw Signals
+
Feedback Events
+
Explicit Preferences
        ↓
   ProfileBuilder
        ↓
ResearchProfile Snapshot
```

Profile 是派生状态，不是唯一 Source of Truth。

---

# 8. ResearchProfile 第一版数据模型

Phase 2 已确定：每个 Zotero library 一个画像，统一通过 `profileIdForLibrary(libraryID)`
生成 `library:<positive-safe-integer>`；不支持跨库合并、collection persona 或 conversation 画像。
本地论文身份由适配器统一生成 `library:<libraryID>:item:<itemID>`，跨设备 key 迁移另行设计。

生产持久化使用独立 `llm_for_zotero_research_profiles` SQLite 表，保存
`profile_id / version / schema_version / profile_json / updated_at`。
`schema_version = 1` 与快照修订号分离；读写均校验，未知 schema 明确失败。
创建 version 1 和更新 N → N+1 在 Zotero.DB 事务内通过条件写入及受影响行数校验完成 CAS；冲突明确返回，不隐式重试。

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

---

# 9. TopicInterest

```ts
interface TopicInterest {
  id: string;

  label: string;

  weight: number;

  confidence: number;

  sources: InterestSource[];

  lastEvidenceAt: number;

  evidenceRefs: string[];
}
```

其中：

## weight

表示：

> 用户对主题的兴趣强度。

## confidence

表示：

> 系统对该兴趣判断的确定程度。

两者不得混用。

例如：

```json
{
  "label": "Agentic Recommender Systems",
  "weight": 0.88,
  "confidence": 0.91,
  "sources": ["library", "feedback"],
  "lastEvidenceAt": 1788600000000,
  "evidenceRefs": [
    "paper:ABC123",
    "paper:DEF456"
  ]
}
```

---

# 10. InterestSource

第一版：

```ts
type InterestSource =
  | "library"
  | "explicit"
  | "feedback";
```

第一版暂不加入：

- read duration；
- scroll depth；
- annotation density；
- viewport tracking；
- clickstream。

---

# 11. ExplicitPreferences

用户明确表达的偏好必须优先于隐式推断。

```ts
interface ExplicitPreferences {
  positiveTopics: PreferenceConstraint[];
  negativeTopics: PreferenceConstraint[];
}
```

推荐：

```ts
interface PreferenceConstraint {
  id: string;
  label: string;
  strength: number;
  createdAt: number;
  updatedAt: number;
}
```

例如：

```json
{
  "positiveTopics": [
    {
      "id": "pref-1",
      "label": "Agentic Recommendation",
      "strength": 1.0,
      "createdAt": 1788600000000,
      "updatedAt": 1788600000000
    }
  ],
  "negativeTopics": [
    {
      "id": "pref-2",
      "label": "Pure Prompt Engineering",
      "strength": 0.9,
      "createdAt": 1788600000000,
      "updatedAt": 1788600000000
    }
  ]
}
```

显式 negative preference 应作为强约束 / 强惩罚信号，而不是简单混入一个 profile embedding。

---

# 12. RepresentativePaper

```ts
interface RepresentativePaper {
  itemId: string;

  title: string;

  weight: number;

  reason:
    | "recent"
    | "high_topic_relevance"
    | "explicit_positive"
    | "saved_from_recommendation";

  addedAt: number;
}
```

Representative Papers 用于：

- 表示当前研究兴趣；
- 构建 profile embedding；
- 作为 Seed Recall 的起点；
- 支撑推荐解释。

---

# 13. ProfileEmbeddingRef

Embedding 不直接放进 Profile 主 JSON。

```ts
interface ProfileEmbeddingRef {
  model: string;
  dimension: number;
  storageKey: string;
  updatedAt: number;
}
```

原因：

- Vector 体积较大；
- 与具体 embedding model 绑定；
- 模型切换不应引发整个 Profile schema 变化；
- 后续可以单独失效与重建。

---

# 14. ProfileSignalSummary

```ts
interface ProfileSignalSummary {
  libraryPaperCount: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  explicitPreferenceCount: number;
}
```

用途：

- 可观测性；
- UI 展示；
- Debug；
- Evaluation；
- Profile confidence 辅助判断。

---

# 15. Recommendation Feedback

Feedback 使用 append-only event。

```ts
interface RecommendationFeedback {
  eventId: string;

  paperId: string;

  recommendationId: string;

  action:
    | "positive"
    | "negative"
    | "save"
    | "skip";

  timestamp: number;
}
```

第一版不允许只修改 topic weight 而不记录事件。

---

# 16. Recommendation Impression

每次实际展示给用户的推荐需要记录曝光。

```ts
interface RecommendationImpression {
  recommendationId: string;

  profileId: string;

  timestamp: number;

  profileVersion: number;

  candidates: RecommendedPaper[];
}
```

至少记录：

- 推荐 ID；
- profile ID（Phase 2 补充，避免不同 library 的相同版本混淆）；
- profile version；
- paper；
- rank；
- final score；
- score breakdown；
- matched topics；
- candidate source。

这是后续反馈学习和离线评测的基础。

---

# 17. Candidate Contract

```ts
interface RecommendationCandidate {
  candidateId: string;

  title: string;
  abstract?: string;

  authors: string[];
  publicationDate?: string;

  doi?: string;
  arxivId?: string;
  openAlexId?: string;

  provenance: CandidateProvenance[];
  sourceUrl?: string;
  openAccessUrl?: string;

  sources: CandidateSource[];

  seedPaperIds?: string[];

  scores: CandidateScores;

  evidence?: CandidateEvidence;
}
```

第一版 CandidateSource 至少支持：

```ts
type CandidateSource =
  | "profile_query"
  | "seed_recommendation";
```

可以预留：

```text
citation
reference
```

但第一版不要求启用。

---

# 18. CandidateScores

```ts
interface CandidateScores {
  semantic?: number;
  lexical?: number;
  graph?: number;
  recency?: number;
  feedback?: number;

  baseScore?: number;
  finalScore?: number;
}
```

必须保留 score breakdown。

禁止只保存一个不可解释的 `score`。

---

# 19. Profile 初始化

Phase 2 实际输入复用 LibraryIndex，经 `IndexedResearchLibrarySource` 转为独立论文信号。
仅纳入当前库的 regular、未删除、有效非空标题记录；不遍历 PDF 全文或 UI 对象。
无模型时以人工标签和 collection 完整路径生成主题；automatic tags 暂不参与回退评分。
可选 Utility LLM 仅分批补充有输入论文 ID 支持的主题，严格校验后进入相同的确定性评分路径。
模型不可用、空响应、非法 JSON / ID / confidence、超时或传输失败均返回警告并回退。
Phase 2 不计算 embedding。

生命周期：缺失即构建，存在即加载，`refresh:true` 显式重建；无后台定时或增量画像刷新。
显式偏好替换通过验证后执行完整重建和单次 CAS，以同步主题分数及代表论文；因此该操作与其他完整重建一样，
`generatedAt`、`updatedAt` 均取本次重建时间，version 加一。不存在仅修改偏好却保留旧推断分数的更新路径。
详细公式、调用上限及反馈状态处理见 `docs/development-log.md` 的 Phase 2 记录。

第一版使用 Zotero Library 元数据和摘要构建。

输入优先：

- title；
- abstract；
- tags；
- collection；
- year；
- dateAdded。

第一版不要求遍历所有 PDF 全文。

Profile 初始化流程：

```text
Zotero Library
    ↓
Select Eligible Papers
    ↓
Metadata + Abstract
    ↓
Topic Extraction
    ↓
Topic Normalization
    ↓
Time Weighting
    ↓
Topic Aggregation
    ↓
Representative Papers
    ↓
Optional Profile Embedding
```

---

# 20. 时间衰减

长期兴趣需要避免“历史平均化”。

建议使用 half-life：

```text
timeWeight = 2 ^ (-deltaDays / halfLifeDays)
```

第一版可以把：

```text
halfLifeDays = 180
```

作为配置默认值，而不是硬编码散落到各处。

最终 topic score 可采用类似：

```text
LibraryScore(topic)
=
Σ TopicRelation(topic, paper)
× TimeDecay(paper)
× SignalWeight(paper)
```

然后再加入显式偏好和反馈。

所有权重必须集中在 Profile Scoring 配置中管理，便于后续 ablation。

---

# 21. 第一版明确不做

除非后续单独立项，第一版不做：

- Multi-Agent；
- GraphRAG；
- Knowledge Graph；
- LangGraph 替换现有 Runtime；
- LangChain 重构；
- RL；
- Agent self-reflection；
- Planner Agent + Executor Agent；
- Browser Agent；
- Autonomous Research；
- Citation Graph Embedding；
- Venue Preference Model；
- Author Preference Model；
- 复杂序列推荐模型；
- 点击率预测；
- 大规模 Vector DB；
- 自动静默导入论文；
- Scheduler 作为核心 MVP；
- 全库全文级 RAG 推荐。

---

# 22. Agent Tool 规划

最终预计只新增四个核心语义 Tool：

```text
research_profile_get
research_candidate_discover
research_recommend
recommendation_feedback
```

后续可增加一个 Action：

```text
research_digest
```

和一个 Skill：

```text
research-intelligence
```

但 Phase 1 不实现它们。

---

# 23. 推荐排序第一版规划

候选排序暂定：

```text
Score
=
α * Semantic
+
β * Lexical
+
γ * Graph
+
δ * Recency
+
η * Feedback
```

然后：

```text
Top N
  ↓
MMR
  ↓
Top K
```

具体权重属于后续阶段，不在 Phase 1 实现。

---

# 24. 开发阶段

## Phase 0 — Baseline & Development Safety

目标：

- 固定 upstream commit；
- 确认工作区状态；
- 跑 build；
- 跑 typecheck；
- 跑 unit tests；
- 记录已知 upstream 问题；
- 不改业务逻辑。

验收：

- baseline 状态明确；
- 后续失败可区分 upstream 问题与新增代码问题。

---

## Phase 1 — Recommendation Domain Foundation

目标：

建立 Domain Contract 和 Store Boundary。

新增：

```text
src/recommendation/domain/
```

定义：

- ResearchProfile；
- TopicInterest；
- ExplicitPreferences；
- RepresentativePaper；
- ProfileEmbeddingRef；
- ProfileSignalSummary；
- RecommendationCandidate；
- CandidateScores；
- RecommendationFeedback；
- RecommendationImpression。

定义 Store Interfaces：

- ProfileStore；
- FeedbackStore；
- ImpressionStore。

Phase 1：

- 不实现 Candidate Recall；
- 不实现 Ranking；
- 不实现 MMR；
- 不接 Agent；
- 不接 UI；
- 不调用 LLM；
- 不做 ProfileBuilder；
- 不做大规模重构。

---

## Phase 2 — Research Profile Memory

实现：

- ProfileBuilder；
- ProfileScoring；
- ProfileUpdater；
- ProfileService；
- ProfileStore 实现；
- topic extraction / normalization；
- time decay；
- profile version；
- profile evidence；
- `research_profile_get`。

Phase 2 工具只对插件内 Agent Runtime 暴露，`localAgentOnly: true`，用户视角为 read，
无 Zotero 内容修改、Action 写入或 Change Journal 操作。输入仅 `refresh?: boolean`，
library scope 来自当前请求/上下文且必须有效；普通聊天、Codex App Server、Claude Code、WebChat 和 MCP 暂不支持。

---

## Phase 3 — Candidate Discovery

Phase 3 已实现两路召回：完整持久 ResearchProfile 的确定性 topic query（可加当前 turn focus）与
当前 LibrarySnapshot 中 representative paper DOI 的 seed recommendations。生产 provider 仅 OpenAlex；
Agent adapter 复用现有 LiteratureSearchService，推荐域只依赖纯 LiteratureDiscoverySource。
Seed 无 DOI 时跳过，不降级为 keyword search。最多 5 queries / 4 seeds，分别 12 / 8 条，
共享并发上限 3、池上限 80；支持 partial failure 和 AbortSignal。

Candidate provenance 为必需的结构化 route/provider/providerRank/query/topicId/focus 或 seedPaperId；
sources/seedPaperIds 从 provenance 派生并由 runtime guard 校验。先对整个 eligible library 做
exact DOI / 保守书目 novelty 排除，再做跨路 deterministic dedup/merge，最后才交给未来 Ranking。
外部身份优先级 DOI → arXiv → OpenAlex → 保守书目；metadata 不足时保留独立 occurrence ID。
Phase 3 CandidateScores 均为空，数组为 discovery order，不是 final personalized ranking。
Candidate Pool 按设计不持久化，无 CandidateSetStore，也不对池批量读取 PDF/RAG。

`research_candidate_discover({focus?,limit?})` 仅 local Agent 暴露，read、无需确认；scope 来自当前上下文，
直接调用 ProfileService 加载完整画像。focus 不改变长期 profile/version；Tool 默认展示 30 条、最多 50 条，
abstract snippet 最多 400 字符；截断明确报告。其他聊天/外部后端未接入。

实现：

- Profile Query Recall；
- Seed Paper Recall；
- Candidate Merge；
- Candidate Dedup；
- Literature adapter；
- `research_candidate_discover`。

---

## Phase 4 — Personalized Ranking

实现：

- semantic / lexical / graph / recency / feedback scoring；
- Ranker；
- MMR；
- score breakdown；
- `research_recommend`。

---

## Phase 5 — Feedback Loop

实现：

- feedback event；
- feedback store；
- profile updater；
- profile version transition；
- recommendation impression；
- `recommendation_feedback`。

---

## Phase 6 — Evidence-grounded Agent Workflow

实现：

- research-intelligence Skill；
- evidence enrichment；
- recommendation reason features；
- Agent synthesis；
- 必要时增加 research_digest Action；
- 少量 UI / review card。

---

## Phase 7 — Evaluation

Recommendation Evaluation：

- Temporal Holdout；
- Recall@K；
- NDCG@K；
- MRR；
- Diversity；
- Ablation。

Agent Evaluation：

- Tool Selection Accuracy；
- Tool Argument Validity；
- Workflow Success Rate；
- Average Tool Calls；
- Latency；
- Failure Recovery。

---

## Phase 8 — Optional

只在核心闭环完成后考虑：

- Local Agent Model；
- API vs Ollama benchmark；
- Scheduler；
- Weekly Digest；
- Privacy Mode；
- Local Embedding；
- UI polish。

---

# 25. 五条代码红线

后续每次 Codex 开发都必须检查：

1. **Recommendation Domain 不得依赖 Zotero UI。**
2. **Ranking Algorithm 不得调用 Agent Runtime。**
3. **Persistent ResearchProfile 不得写入 conversationMemory。**
4. **LLM 输出不得直接成为长期状态，必须经过 schema validation 和 deterministic update。**
5. **Zotero 写操作不得绕过现有 Tool Registry / Action Contract / Change Journal。**

Phase 2 附加约束：**没有配置 Utility LLM 时也必须能构建有效的确定性画像。**

---

# 26. Additional Engineering Rules

## Rule A：避免巨型 UI 文件

除非确实无法避免，否则不应修改：

- `chat.ts`
- `setupHandlers.ts`

Recommendation Domain 逻辑禁止写入其中。

## Rule B：避免顺手重构

每个 PR 只完成当前阶段目标。

不因为“看到旧代码不好”而顺手重构无关模块。

## Rule C：保持现有后端边界

普通聊天、插件 Agent、Codex、Claude、WebChat 不是同一执行链。

任何新增能力必须明确：

- 当前支持哪条链路；
- 哪条链路暂不支持；
- 不允许假设修改 AgentRuntime 后所有后端自动生效。

## Rule D：优先可测试

推荐算法层应能在：

- 不启动 Zotero UI；
- 不运行 Main Agent；
- 不调用真实外部 API；

的情况下进行 unit test。

---

# 27. Development Log 要求

Codex 必须创建并持续维护：

```text
docs/development-log.md
```

该文档是项目开发的连续交接记录，不是一次性报告。

每次实际修改代码后必须追加或更新以下内容：

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
本次修改目的。

#### Files Changed
- path/to/file
- path/to/file

#### What Changed
核心实现说明。

#### Architecture Decisions
为什么这样设计。
是否涉及 architecture baseline 的新决策。

#### Tests
运行了哪些命令：
- npm run ...
结果：
- pass / fail

#### Known Issues
当前已知问题。

#### Deferred Work
明确没有在本阶段做什么。

#### Next Recommended Step
下一步建议。

## Open Decisions
- 决策项
- 当前方案
- 备选方案
- 尚未确定原因

## Technical Debt
- 技术债
- 是否来自 upstream
- 是否由本项目新增
- 优先级

## Handoff Notes
供下一个开发者 / ChatGPT / Codex 快速恢复上下文的信息。
```

要求：

- 不得删除过去重要决策记录；
- 如果架构决策发生改变，应记录旧方案、修改原因、新方案；
- 不得只写“完成了某功能”，必须记录关键文件、测试和已知问题；
- 每个 Phase 完成后更新 `Current Architecture Status`；
- 开发文档必须和代码一起提交。

---

# 28. Phase Completion Checklist

每个阶段结束前必须检查：

```text
[ ] 当前阶段目标已完成
[ ] 未越权实现后续阶段
[ ] Architecture Baseline 未被违反
[ ] Development Log 已更新
[ ] Typecheck 已运行
[ ] Relevant Unit Tests 已运行
[ ] Build 状态已确认
[ ] Known Issues 已记录
[ ] Deferred Work 已记录
[ ] 下一阶段建议已记录
```

---

# 29. 项目主线

所有后续功能都必须服务于：

```text
Perception
  ↓
Long-term Memory
  ↓
Candidate Retrieval
  ↓
Personalized Decision
  ↓
Evidence
  ↓
Feedback
  ↓
Memory Update
```

如果某项技术不能明显增强这条闭环，不应仅为了“Agent 技术栈更丰富”而加入。

---

# 30. 最终架构目标

项目最终应表现为：

> 一个具备长期科研兴趣 Memory、Tool-using Agent Orchestration、多路候选发现、个性化排序、Evidence-grounded Explanation 和 Feedback Learning 的科研情报 Agent。

而不是：

> 一个堆叠大量 Agent 框架、Tool 和模型但缺乏清晰业务闭环的 Zotero Chatbot。
