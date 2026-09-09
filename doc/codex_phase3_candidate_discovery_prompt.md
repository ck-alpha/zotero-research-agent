# Codex Prompt — Phase 3: Personalized Candidate Discovery

## 项目

**Personalized Research Intelligence Agent**

仓库：

```text
https://github.com/ck-alpha/zotero-research-agent
```

当前已确认 Phase 2 checkpoint：

```text
commit: 279ccc62d959a52a518dff7a812c3a1856d1966b
message: feat(recommendation): add research profile memory
tag/checkpoint: phase-2
```

历史 Phase 1 checkpoint：

```text
10ed87677bc2afdfe17ede174f80f23834fdc500
```

上游固定基线：

```text
5be02f51a9bdf9b143439c95eed07bd62a34cb68
```

---

# 0. 开发前必须阅读

在修改代码前，先阅读：

```text
docs/research_agent_architecture_baseline.md
docs/development-log.md
```

然后检查 Phase 2 的真实实现：

```text
src/recommendation/domain/
src/recommendation/profile/
src/agent/tools/recommendation/researchProfileGet.ts
src/agent/tools/index.ts
```

以及本阶段必须复用的已有学术检索基础设施：

```text
src/agent/services/literatureSearchService.ts
src/agent/tools/read/searchLiteratureOnline.ts
src/agent/actions/discoverRelated.ts
src/agent/services/zoteroGateway.ts
```

LibraryIndex 相关代码：

```text
src/services/libraryIndexService.ts
src/services/libraryIndex/contracts.ts
src/services/libraryIndex/projection.ts
```

不要只根据本 Prompt 机械实现。优先复用仓库里已经存在的稳定抽象，但必须遵守架构边界。

---

# 1. 本阶段目标

Phase 3 只实现：

> **ResearchProfile → Multi-route Candidate Discovery → Novel Candidate Pool**

最终链路：

```text
Persistent ResearchProfile
          │
          ├───────────────┐
          │               │
          ▼               ▼
 Profile Query Recall   Seed Paper Recall
          │               │
          └───────┬───────┘
                  ▼
        External Paper Results
                  ▼
       Candidate Normalization
                  ▼
        Existing-Library Filter
                  ▼
          Cross-route Dedup
                  ▼
      RecommendationCandidate[]
                  ▼
   research_candidate_discover
```

本阶段回答的是：

> “哪些论文值得进入候选池？”

而不是：

> “哪些论文最终应该排在最前面？”

最终个性化排序留给 Phase 4。

---

# 2. 本阶段允许实现

可以实现：

- Candidate Discovery contracts；
- Candidate provenance；
- Profile Query Recall；
- 当前 turn 的可选 `focus` recall；
- Seed Paper Recall；
- Literature Discovery Adapter；
- 外部论文标准化；
- Candidate identity；
- 库内已有论文排除；
- Cross-route merge；
- 精确/保守 dedup；
- 有界并发；
- partial failure；
- CandidateDiscoveryService；
- `research_candidate_discover`；
- 相关单元测试与 integration-style tests；
- 为复用现有 literature service 所需的最小兼容性改动；
- 为 DOI Seed Recall 所需的 Phase 2 小型 contract 补充。

---

# 3. 本阶段禁止实现

不要实现：

- 最终 personalized ranking；
- semantic profile/candidate score；
- lexical score；
- graph score；
- recency score；
- feedback score；
- baseScore / finalScore；
- MMR；
- RecommendationImpression 生产持久化；
- FeedbackStore 生产持久化；
- feedback learning；
- 推荐 RAG evidence enrichment；
- 对整个 Candidate Pool 批量读取 PDF；
- 推荐 UI；
- Weekly Digest；
- Scheduler；
- research-intelligence Skill；
- 自动导入 Zotero；
- CandidateSet SQLite / CandidateSetStore；
- Vector DB；
- Multi-Agent；
- LangGraph / LangChain 重构；
- GraphRAG；
- RL。

如果发现这些后续需求，只写入 `docs/development-log.md` 的 Deferred Work。

---

# 4. Phase 2 宿主 Smoke Test

Phase 2 日志明确指出真实 Zotero 宿主 smoke test 尚未执行。

如果当前开发环境能启动 Zotero，请在进入或完成 Phase 3 时尝试验证：

```text
personal library:
  first build
  cached load
  refresh

plugin restart:
  persisted profile reload

group library:
  scope correctness
```

如果环境无法执行：

- 不阻塞 Phase 3；
- 明确记录为 `not executed`；
- 不得把 Node SQLite seam 当作真实 Zotero.DB 宿主验收。

---

# 5. 必须复用现有 LiteratureSearchService

仓库已经有：

```text
LiteratureSearchService
```

其中已经实现：

```text
OpenAlex keyword search
OpenAlex recommendations / related_works
OpenAlex references
OpenAlex citations
arXiv search
Europe PMC search
metadata resolution
```

Phase 3 不允许重新写另一套重复的：

```text
OpenAlexClient
ArxivClient
```

推荐架构：

```text
CandidateDiscoveryService
        ↓
LiteratureDiscoverySource      # 推荐域纯接口
        ↓
Agent-side Adapter
        ↓
Existing LiteratureSearchService
```

---

# 6. Agent 依赖边界

现有 `LiteratureSearchService.execute()` 依赖 `AgentToolContext`。

不要让：

```text
src/recommendation/candidate/
```

直接 import Agent Runtime / AgentToolContext。

建议新增 Agent/integration 层适配器，例如：

```text
src/agent/services/recommendationLiteratureSource.ts
```

它可以：

```text
implement LiteratureDiscoverySource
wrap LiteratureSearchService
持有当前 AgentToolContext
把现有结果转换为推荐域 ExternalPaper
```

CandidateDiscoveryService 只依赖纯接口。

如果需要给 `LiteratureSearchService` 导出少量类型，允许做最小、向后兼容的改动；不要大规模重构。

---

# 7. 禁止内部调用 Agent Tool Registry

不要做：

```text
CandidateService
  ↓
literature_search Agent Tool
  ↓
Tool Registry
```

Tool Registry 是模型 orchestration 边界，不是内部 service bus。

正确方向：

```text
research_candidate_discover
  ↓
CandidateDiscoveryService
  ↓
LiteratureDiscoverySource
  ↓
LiteratureSearchService
```

---

# 8. Recommendation-facing Literature Contract

新增推荐域纯接口，概念上类似：

```ts
interface LiteratureDiscoverySource {
  search(input: TopicSearchRequest): Promise<LiteratureDiscoveryBatch>;
  related(input: SeedRelatedRequest): Promise<LiteratureDiscoveryBatch>;
}
```

推荐域看到的外部论文结构应尽量稳定，例如：

```ts
interface ExternalPaper {
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;

  doi?: string;
  arxivId?: string;
  openAlexId?: string;

  sourceUrl?: string;
  openAccessUrl?: string;

  provider: CandidateDiscoveryProvider;
}
```

Phase 3 生产 Recall 只要求 OpenAlex 即可：

```text
Profile Query Recall → OpenAlex search
Seed Recall          → OpenAlex related_works
```

不要为了“技术栈更多”强行同时接 arXiv / EuropePMC。

---

# 9. Phase 2 Contract 小型补充：DOI

现有 `LibraryIndexItem` 已有 DOI，但 `ResearchPaperSignal` 没有。

Phase 3 增加：

```ts
doi?: string;
```

并在 `IndexedResearchLibrarySource` 映射。

要求：

- 空 DOI → `undefined`；
- DOI 非必需；
- ProfileBuilder 不把 DOI 当兴趣 signal；
- DOI 字段不得改变相同论文库的 topic scoring；
- 更新 fixtures/tests。

用途仅限：

```text
Seed Recall
Existing Library Exclusion
```

---

# 10. Candidate Provenance 必须结构化

当前 Candidate 已有：

```text
sources
seedPaperIds
```

Phase 3 需要增加结构化 provenance。

推荐形式：

```ts
type CandidateDiscoveryProvider =
  | "openalex"
  | "arxiv"
  | "europepmc";

type CandidateProvenance =
  | {
      route: "profile_query";
      provider: CandidateDiscoveryProvider;
      providerRank: number;
      query: string;
      topicId?: string;
      focus?: boolean;
    }
  | {
      route: "seed_recommendation";
      provider: CandidateDiscoveryProvider;
      providerRank: number;
      seedPaperId: string;
    };
```

然后：

```ts
RecommendationCandidate.provenance: CandidateProvenance[];
```

示例：

```text
Candidate X
├─ profile_query
│  ├─ topic = Agentic Recommendation
│  └─ providerRank = 3
└─ seed_recommendation
   ├─ seed = library:1:item:42
   └─ providerRank = 2
```

这将用于后续：

- explanation；
- recall evaluation；
- ablation；
- debug；
- 面试时解释 multi-route retrieval。

---

# 11. Candidate Contract 一致性

若继续保留：

```text
sources
seedPaperIds
```

则 Candidate 构建/validation 必须保证：

```text
sources = unique(provenance.route)
```

以及：

```text
seedPaperIds = unique(seed provenance seedPaperId)
```

不要允许内部矛盾。

除非确认当前没有生产 consumer 且删除冗余字段明显更干净，否则优先保留现有 contract，减少不必要 churn。

---

# 12. Phase 3 CandidateScores 必须为空

本阶段是 Recall，不是 Ranking。

禁止在 candidate discovery 中填：

```text
semantic
lexical
graph
recency
feedback
baseScore
finalScore
```

期望：

```ts
scores: {}
```

Provider 的原始结果顺序放在：

```text
providerRank
```

而不是伪装成个性化 score。

---

# 13. Profile Query Recall

实现 deterministic query planner。

建议位置：

```text
src/recommendation/candidate/queryRecall.ts
```

或：

```text
candidateQueryPlan.ts
```

Phase 3 不使用 LLM 做 query expansion。

原因：

- Main Agent 已经理解当前用户请求；
- ResearchProfile 已有归一化 topic；
- 再加一个 Utility LLM query planner 只会增加不稳定性和复杂度。

---

# 14. Topic Recall Priority

必须使用完整 persistent profile，而不是 `research_profile_get` 截断后的 Tool output。

建议 priority：

```text
priority(topic) = topic.weight * topic.confidence
```

规则：

- 只选 weight/confidence 有效的正向 topic；
- 不查询 explicit negative topic；
- 排序 deterministic；
- 同 priority 用稳定 topic id/label tie-break。

推荐初始上限：

```text
MAX_TOTAL_QUERIES = 5
```

若没有 focus：

```text
最多 5 个 profile topic query
```

若有 focus：

```text
1 focus query
+ 最多 4 个 profile topic query
```

所有限制集中配置。

---

# 15. 当前 Turn Focus

长期画像与当前临时需求必须分开。

`research_candidate_discover` 可以接受：

```ts
{
  focus?: string;
}
```

例如：

```text
长期画像：agent + recommender systems
当前 focus：agent memory
```

focus：

- 只参与当前 candidate recall；
- 不写入 ResearchProfile；
- 不作为长期偏好；
- 不进入 profile version。

建议：

```text
maxFocusChars = 300
```

focus 存在时作为第一条 query。

---

# 16. Query 去重

Query 执行前必须 deterministic normalize：

```text
trim
Unicode normalize
collapse whitespace
case-insensitive compare
```

例如：

```text
Agentic Recommendation
agentic   recommendation
```

不得产生两次外部请求。

保留原始 display query 用于 provenance。

---

# 17. Query Recall Budget

推荐初始配置：

```text
maxQueries      = 5
resultsPerQuery = 12
```

因此 profile query recall 的 raw request budget 有明确上界。

如根据现有项目风格调整，必须在 development log 记录最终值和原因。

---

# 18. Freshness

Phase 3 不做最终 recency ranking。

如果能以非常小、向后兼容的方式给现有 OpenAlex search 增加 publication-date / year filter，可以实现为 Recall 增强。

但：

- 不允许为了这个功能大改 LiteratureSearchService；
- 不允许把 freshness 直接变成 final rank；
- 如果本阶段不做，写入 Deferred Work。

---

# 19. Seed Paper Recall

实现：

```text
ResearchProfile.representativePapers
        ↓
当前 ResearchLibrarySnapshot
        ↓
读取 DOI
        ↓
OpenAlex recommendations / related_works
        ↓
seed_recommendation candidates
```

建议位置：

```text
src/recommendation/candidate/seedRecall.ts
```

---

# 20. Seed Selection

直接使用现有 `representativePapers` 顺序。

推荐初始：

```text
MAX_SEEDS = 4
```

通过：

```text
RepresentativePaper.itemId
```

映射到同 library 的 `ResearchPaperSignal`。

---

# 21. Seed 没有 DOI 时

不要把 title keyword search 冒充成 graph seed recall。

如果 Seed 没有 DOI：

```text
skip seed_recommendation
```

并计入：

```text
seedsSkippedWithoutDoi
```

或等价诊断。

未来可以做：

```text
OpenAlex ID persistence
arXiv seed
Title → identifier resolution
```

但 Phase 3 不需要一次性补全。

---

# 22. Seed 外部调用必须保持语义真实

使用现有：

```text
mode = recommendations
source = openalex
```

并传 DOI。

如果现有 LiteratureSearchService 在 DOI lookup 失败时，因为 title/query 存在会 fallback keyword search，则 Seed Adapter 不要传 title/query fallback。

Seed route 失败可以失败，但不能变成假 Seed Recall。

推荐：

```text
resultsPerSeed = 8
maxSeeds       = 4
```

---

# 23. 有界并发

不要无界：

```ts
Promise.all(allQueriesAndSeeds)
```

推荐：

```text
maxConcurrentRequests = 3
```

要求：

- AbortSignal 继续传递；
- 单个 route 失败不抹掉其他成功结果；
- 无无限重试；
- 无递归 hidden retry。

---

# 24. Partial Failure

例如：

```text
5 query routes：4 成功，1 timeout
4 seed routes：3 成功，1 seed DOI not found
```

期望：

```text
返回成功 routes 的 candidates
+
结构化 diagnostics / warnings
```

只有以下情况才整体失败：

- library/profile scope 非法；
- 核心状态损坏；
- 全部依赖不可用且无法产生任何 meaningful pool；
- request cancelled。

---

# 25. Candidate Identity 必须集中

建议：

```text
src/recommendation/candidate/identity.ts
```

身份优先级：

```text
1. DOI
2. arXiv ID
3. OpenAlex ID
4. conservative bibliographic fallback
```

概念形式：

```text
doi:10.xxxx/...
arxiv:2601.12345
openalex:W123456789
bibliographic:<stable-key>
```

不要散落 identifier normalization。

---

# 26. DOI Normalize

至少处理：

```text
https://doi.org/...
http://doi.org/...
doi:...
whitespace
comparison case
```

相同 DOI 的不同 URL 表达必须视为同一论文。

---

# 27. OpenAlex / arXiv ID

若现有 LiteratureSearchService 只返回 `sourceUrl`：

- Adapter 可以从 OpenAlex URL 解析 `W...`；
- 可以从 arXiv URL 解析 arXiv ID；

或者给现有 result 增加一个最小可选字段。

不要为了已经存在于 result 的 ID 再发一次网络请求。

---

# 28. Bibliographic Fallback

没有强 ID 时使用保守规则，例如：

```text
normalized title + year
```

或：

```text
normalized title + first author
```

不要做 fuzzy semantic merge。

极短/泛化标题不要仅凭 title 合并。

规则必须独立 unit test。

---

# 29. Existing Library Novelty Filter

候选池应默认只保留用户库中尚不存在的论文。

必须对整个当前：

```text
ResearchLibrarySnapshot
```

建立 novelty index。

优先：

```text
canonical DOI exact match
```

无 DOI 时使用 conservative bibliographic fallback。

禁止用 LLM 判定两篇论文是不是同一篇。

禁止读取 PDF 做 dedup。

---

# 30. 不能只排除 Representative Papers

Novelty Filter 必须覆盖整个 eligible library。

否则系统会推荐：

```text
用户已经保存
但没被选为 representative paper
```

的论文。

---

# 31. Cross-route Merge / Dedup

建议：

```text
src/recommendation/candidate/merge.ts
src/recommendation/candidate/deduplicate.ts
```

或一个凝聚的小模块。

同一论文如果来自：

```text
profile_query
+
seed_recommendation
```

最终只输出一个 `RecommendationCandidate`。

---

# 32. Metadata Merge Policy

重复论文合并必须 deterministic。

优先：

- stronger identifier；
- non-empty field；
- 更完整的 abstract；
- 合法 year；
- non-empty authors；
- 稳定 provider/discovery order 作为 tie-break。

禁止 LLM merge metadata。

禁止补造不存在的 metadata。

---

# 33. Provenance Merge

Candidate 多路命中时必须保留全部来源。

示例：

```text
Candidate X
├─ query: "agentic recommender systems"
│  topicId: topic:...
│  providerRank: 3
└─ seed: library:1:item:42
   providerRank: 2
```

重复 provenance entry deterministic 去重。

---

# 34. Candidate Pool 顺序不是最终 Ranking

数组需要稳定顺序，但不能冒充 personalized ranking。

建议 neutral discovery order：

```text
focus query
→ profile topic queries（query plan 顺序）
→ seed routes（representative paper 顺序）
→ candidateId 稳定 tie-break
```

同一 candidate merge 后保留最早 discovery position。

Development log 明确记录：

> Candidate Pool order is discovery order, not final personalized ranking.

---

# 35. Candidate Pool 上限

推荐初始：

```text
maxCandidatePool = 80
```

不要一次性让 Agent 处理几百/几千候选。

如果 raw candidate 超过上限：

- 按稳定 discovery admission order 保留；
- diagnostics 记录 truncation；
- 禁止偷偷用 final ranking score 决定谁留下。

---

# 36. Candidate Discovery Diagnostics

新增结构化结果，例如：

```ts
interface CandidateDiscoveryResult {
  profileId: string;
  profileVersion: number;
  generatedAt: number;

  focus?: string;
  candidates: RecommendationCandidate[];

  diagnostics: {
    queriesPlanned: number;
    queriesSucceeded: number;

    seedsPlanned: number;
    seedsSucceeded: number;
    seedsSkippedWithoutDoi: number;

    rawCandidateCount: number;
    existingLibraryExcluded: number;
    duplicateCandidatesMerged: number;
    finalCandidateCount: number;
    poolTruncated: boolean;
  };

  warnings: string[];
}
```

字段名可按现有风格调整，但必须具备同等可观测性。

---

# 37. CandidateDiscoveryService

建议：

```text
src/recommendation/candidate/candidateService.ts
```

职责：

```text
validate profile/library scope
↓
build query plan
↓
build seed plan
↓
execute bounded recall
↓
normalize papers
↓
exclude existing library
↓
merge / dedup
↓
return CandidateDiscoveryResult
```

它不得依赖：

```text
AgentRuntime
Tool Registry
DOM
ZoteroPane
chat.ts
conversationMemory
```

---

# 38. Scope Validation

必须验证：

```text
profile.profileId
```

与当前：

```text
libraryID
```

一致，同时：

```text
ResearchLibrarySnapshot.libraryID
```

必须一致。

跨库 mismatch 明确失败，不 silent fallback。

---

# 39. Empty / Weak Profile

必须支持：

### profile 有 topics

正常 query recall。

### 无 topics，但有带 DOI 的 representative papers

Seed Recall 仍可工作。

### 无 topics、无 usable seeds，但有 focus

Focus query recall 工作。

### topics / seeds / focus 全无

返回：

```text
empty candidate pool
+
clear warning
```

禁止凭空生成兴趣。

---

# 40. Phase 3 不新增 Query Expansion LLM

不要新增：

```text
Utility LLM → query expansion
```

本项目已经有足够 Agent/LLM 技术：

```text
Agent intent
Tool calling
Long-term ResearchProfile
Utility LLM topic extraction
```

Recall 保持 deterministic 更利于：

- 调试；
- 评测；
- ablation；
- 面试解释。

---

# 41. 新 Tool：research_candidate_discover

建议位置：

```text
src/agent/tools/recommendation/researchCandidateDiscover.ts
```

这是 Phase 3 唯一必须新增的 Agent Tool。

---

# 42. Tool Input

推荐：

```ts
{
  focus?: string;
  limit?: number;
}
```

禁止模型输入：

```text
libraryID
profileId
raw topics
raw seed IDs
provider URL
```

scope 来自 Agent context。

建议：

```text
1 <= limit <= 50
```

---

# 43. Tool 必须直接读取完整 Profile

不要内部调用：

```text
research_profile_get Tool
```

应该直接：

```text
ProfileService.get(libraryID)
```

若 profile 不存在：

```text
按 Phase 2 规则构建
```

若已存在：

```text
直接 load
```

不需要自动 refresh。

---

# 44. 避免重复 Agent Profile Helper

Phase 2 的 `researchProfileGet.ts` 已含：

- library scope resolve；
- UtilityTopicExtractor provider config。

如果 Phase 3 会复制相同代码，可做一个很小的共享 helper，例如：

```text
src/agent/tools/recommendation/shared.ts
```

只放：

```text
resolve current research library ID
create UtilityTopicExtractor from Agent request
```

不要把业务逻辑搬进去。

---

# 45. Agent Literature Adapter

Tool/integration 层创建：

```text
AgentLiteratureDiscoverySource
```

它可以使用：

```text
current AgentToolContext
LiteratureSearchService
```

CandidateService 保持纯净。

---

# 46. Tool Output

至少返回：

```text
profileId
profileVersion
focus
candidateCount
candidates
diagnostics
warnings
```

每个 candidate 输出：

```text
candidateId
title
authors
publicationDate
doi
arxivId
openAlexId
sources
seedPaperIds
provenance
```

abstract 只能给 bounded snippet。

不要返回：

- raw provider payload；
- 大量完整 abstracts；
- raw HTTP request；
- 整个 Zotero library snapshot。

---

# 47. Tool Output Cap

推荐：

```text
toolDefaultLimit = 30
toolMaxLimit     = 50
```

内部 candidate pool 可以最多 80。

Tool serialization 截断时返回：

```text
candidate_tool_output_truncated
```

不能暗示 omitted candidates “排名更低”。

---

# 48. Tool Exposure

`research_candidate_discover`：

```text
mutability: read
requiresConfirmation: false
exposure: model
localAgentOnly: true
```

Phase 3 只支持：

```text
in-plugin Agent Runtime
```

不要自动接入：

```text
ordinary chat
Codex App Server
Claude Code
WebChat
MCP/public catalog
```

---

# 49. generic literature_search 必须继续工作

新 Candidate Discovery 是个性化 workflow。

它不替代：

```text
literature_search
```

如果修改共享 literature 类型/逻辑，必须跑原有 regression tests。

---

# 50. Phase 3 不做 CandidateSet Persistence

不要创建：

```text
CandidateSetStore
candidate_sets SQLite
candidateSetId
TTL cache infrastructure
```

目前没有真实需求证明需要。

Phase 4 可以直接调用 CandidateDiscoveryService 获取候选后排名。

如果未来发现多步 Agent latency 确实需要 Candidate Handle，再基于测量新增。

---

# 51. 不批量读 Candidate PDF

Phase 3 不调用：

```text
paper_read
RAG
MinerU
PDF parsing
```

正确长期链路：

```text
Candidate Pool
→ Ranking
→ Top-K
→ Evidence Enrichment
```

而不是：

```text
80 candidates
→ read 80 PDFs
→ LLM 选 5 篇
```

---

# 52. Candidate Runtime Validation

新增 provenance 后必须扩展 runtime guard。

至少验证：

```text
provider enum
route enum
providerRank positive safe integer
query nonempty when profile_query
topicId valid when present
seedPaperId required for seed route
provenance nonempty
```

route-specific contract：

### profile_query

必须：

```text
query
provider
providerRank
```

可选：

```text
topicId
focus
```

不得包含：

```text
seedPaperId
```

### seed_recommendation

必须：

```text
seedPaperId
provider
providerRank
```

不得伪装为 query route。

---

# 53. External Data 必须验证

External literature result 是 runtime untrusted data。

Candidate 离开 CandidateDiscoveryService 前必须通过现有 candidate domain guard。

不要只依赖 TypeScript compile-time 类型。

---

# 54. Query Planner Tests

至少测试：

- priority deterministic；
- `weight * confidence` 顺序；
- zero-weight topic skip；
- negative topic 不查询；
- focus first；
- max query count；
- normalized duplicate collapse；
- stable ordering；
- 无 LLM 调用。

---

# 55. Seed Planner Tests

至少：

- representative paper order；
- max seed count；
- seed 映射到当前 library；
- DOI seed accepted；
- missing DOI skipped；
- missing/foreign paper ID 有诊断；
- keyword fallback 不被标成 seed recall。

---

# 56. Candidate Identity Tests

至少：

```text
bare DOI vs DOI URL
DOI case variant
OpenAlex URL / W ID
arXiv URL / ID（如果实现）
bibliographic fallback
```

并测试 unrelated papers 不会错误 merge。

---

# 57. Existing Library Filter Tests

至少：

```text
candidate DOI 已在 library → excluded
DOI URL formatting different → excluded
无 DOI，但 conservative bibliographic identity match → excluded
标题相似但非 exact conservative identity → retained
```

不要加入 fuzzy matching 测试。

---

# 58. Merge / Provenance Tests

### 同 candidate 来自两个 topic query

期望：

```text
1 candidate
2 profile_query provenance
```

### 同 candidate 来自 query + seed

期望：

```text
1 candidate
sources includes both routes
seedPaperIds includes seed
provenance includes both routes
```

同时验证：

```text
scores remains empty
```

---

# 59. CandidateDiscoveryService Tests

使用 fake LiteratureDiscoverySource，不访问网络。

覆盖：

1. query only；
2. seed only；
3. both routes；
4. focus + profile；
5. duplicate merge；
6. existing-library filter；
7. query partial failure；
8. seed partial failure；
9. all routes empty；
10. cancellation；
11. scope mismatch；
12. candidate pool cap；
13. fixed input deterministic output；
14. diagnostics counts。

---

# 60. Literature Adapter Tests

使用 fake/stub LiteratureSearchService executor。

不访问 OpenAlex。

验证：

```text
profile query → mode search
provider → openalex
seed → mode recommendations
seed uses DOI
seed 不传 title/query fallback
result → ExternalPaper
OpenAlex ID parse/enrichment
warning mapping
signal/context propagation
```

---

# 61. Agent Tool Tests

测试 `research_candidate_discover`：

- Tool name；
- read mutability；
- no confirmation；
- localAgentOnly；
- 不接受 libraryID；
- scope 从 request/context 得到；
- focus validation；
- limit validation；
- 直接使用 ProfileService；
- 使用完整 Profile，不是 Tool 截断摘要；
- output cap；
- truncation warning；
- diagnostics；
- 不走 Zotero write；
- 不触发 Action Contract / Change Journal。

---

# 62. Regression Tests

如果共享 literature search 有改动，至少考虑回归：

```text
test/searchLiteratureOnlineTool.test.ts
test/actionCompatibility.test.ts
test/agentHitlReviewWorkflow.test.ts
```

generic `literature_search` 不得被 Phase 3 破坏。

---

# 63. No-network End-to-End Slice

至少新增一条 integration-style 测试：

```text
LibraryIndex fixture
      ↓
IndexedResearchLibrarySource
      ↓
ProfileService / stored profile
      ↓
fake LiteratureDiscoverySource
      ↓
CandidateDiscoveryService
      ↓
research_candidate_discover
```

验证：

```text
correct library scope
correct profile version
multi-route recall
existing-library exclusion
dedup
provenance
tool serialization
```

---

# 64. 可选 Live OpenAlex Smoke Test

自动化测试全部通过后，如果环境允许，可以做少量 OpenAlex smoke test。

它不是 unit test 的必需条件。

记录：

```text
executed / not executed
query count
seed count
raw result count
final candidate count
failures
```

---

# 65. 建议目录

```text
src/recommendation/candidate/
├── contracts.ts
├── config.ts
├── identity.ts
├── queryRecall.ts
├── seedRecall.ts
├── normalize.ts
├── deduplicate.ts
├── candidateService.ts
└── ...仅在真正需要时增加小 helper
```

Agent integration：

```text
src/agent/services/recommendationLiteratureSource.ts
src/agent/tools/recommendation/researchCandidateDiscover.ts
src/agent/tools/recommendation/shared.ts  # 仅避免重复时
```

不要为了目录美观拆成大量单函数文件。

---

# 66. 不应大改的文件

除非确实必要，避免改：

```text
src/modules/contextPanel/chat.ts
src/modules/contextPanel/setupHandlers.ts
src/agent/runtime.ts
src/modules/contextPanel/pdfContext.ts
```

合理的小改动可能包括：

```text
src/agent/tools/index.ts
src/agent/tools/recommendation/researchProfileGet.ts
src/agent/services/literatureSearchService.ts
src/recommendation/profile/contracts.ts
src/recommendation/profile/librarySource.ts
src/recommendation/domain/candidate.ts
src/recommendation/domain/validation.ts
```

---

# 67. 统一配置上限

推荐初始配置：

```text
maxQueries               = 5
maxSeeds                 = 4
resultsPerQuery          = 12
resultsPerSeed           = 8
maxConcurrentRequests    = 3
maxCandidatePool         = 80
maxFocusChars            = 300
toolDefaultLimit         = 30
toolMaxLimit             = 50
toolAbstractSnippetChars = 400
```

这些是工程边界，不是研究结论。

最终数值如有调整，要写入 development log。

---

# 68. Warning Codes

建议使用 compact warning code，例如：

```text
candidate_profile_has_no_topics
candidate_no_usable_seeds
candidate_seed_missing_doi
candidate_query_route_failed
candidate_seed_route_failed
candidate_pool_truncated
candidate_tool_output_truncated
```

详细 provider error 可进 debug/log，不要把 raw request/credential 暴露到 Tool output。

---

# 69. 更新 Architecture Baseline

更新：

```text
docs/research_agent_architecture_baseline.md
```

只补 Phase 3 已确定的事实：

- Candidate Discovery 两路召回；
- Phase 3 生产 provider 为 OpenAlex；
- structured provenance；
- whole-library novelty filter；
- dedup 在 Ranking 之前；
- CandidateScores Phase 3 为空；
- Candidate Pool 不持久化；
- `research_candidate_discover` local Agent only。

不要全文重排/格式化。

---

# 70. Development Log 必须持续维护

继续维护：

```text
docs/development-log.md
```

新增：

```text
recommendation-phase3-candidate-discovery
```

至少记录：

```text
Goal
Git Baseline
Files Changed
What Changed
Architecture Decisions
Candidate Discovery Boundary
Recall Routes
Identity / Dedup Policy
Novelty Filter
Agent Tool
Tests
Architecture Red-Line Review
Known Issues
Deferred Work
Next Recommended Step
```

不得删除 Phase 1/2 历史。

---

# 71. Current Architecture Status 要更新

Phase 3 完成后应明确：

```text
Profile Memory: implemented
Profile Query Recall: implemented
Seed Recall: implemented
Candidate Merge/Dedup: implemented
Library Novelty Filter: implemented
research_candidate_discover: implemented

Ranking: not implemented
MMR: not implemented
Feedback Learning: not implemented
Recommendation Evidence: not implemented
```

并更新 backend support matrix。

---

# 72. Open Decisions 更新

本阶段必须明确记录：

## External Candidate Identity

最终优先级：

```text
DOI / arXiv / OpenAlex / bibliographic fallback
```

## Existing-library Identity

写明 novelty filter exact rules。

## Candidate Provenance

写明结构和 merge semantics。

## Recall Limits

写明最终 query/seed/concurrency/pool budget。

## Partial Failure

写明是否 partial success。

## Candidate Persistence

明确：

```text
Phase 3 by design 不持久化 CandidateSet
```

---

# 73. 不得提前进入 Phase 4

不要出现：

```text
finalScore = ...
```

不要按：

```text
profile similarity
citation count
recency
MMR
```

做隐藏 final ranking。

Phase 3 回答：

> What should be considered?

Phase 4 才回答：

> What should rank highest for this user?

---

# 74. 下一阶段只做交接，不实现

Phase 4 预期链路：

```text
RecommendationCandidate[]
        ↓
Feature Computation
        ↓
Personalized Ranker
        ↓
Score Breakdown
        ↓
MMR
        ↓
Top-K
        ↓
research_recommend
```

只写入 Next Recommended Step，不实现。

---

# 75. Validation Commands

至少运行：

```sh
npm run typecheck
npm run test:unit
npm run build
```

并运行 focused Phase 3 tests。

同时按当前项目惯例运行：

```sh
eslint changed/new TS files
prettier --check changed/new files docs/development-log.md
npm run check:cycles
git diff --check
```

记录真实执行结果。

不得声称未执行的测试已经通过。

---

# 76. Final Architecture Review Checklist

Phase 3 结束前逐条回答：

```text
[ ] Phase 2 Profile Memory 仍可独立工作
[ ] Candidate Domain 不依赖 Agent Runtime
[ ] 复用了 LiteratureSearchService，没有重复造 OpenAlex client
[ ] Profile Query Recall 已实现
[ ] Seed Recall 已实现
[ ] Seed route 没有偷偷降级成 keyword fallback
[ ] Candidate provenance 结构化且有 runtime validation
[ ] Whole-library novelty filter 已实现
[ ] Candidate identity 已集中管理
[ ] Dedup deterministic
[ ] Partial external failure 能返回 partial candidates
[ ] External requests 有界并发
[ ] AbortSignal 被传播
[ ] CandidateScores 保持空
[ ] 没有 final ranking
[ ] 没有 MMR
[ ] 没有 CandidateSet persistence
[ ] 没有对 Candidate Pool 批量 RAG/PDF read
[ ] research_candidate_discover 仅 local Agent 暴露
[ ] generic literature_search regression 通过
[ ] docs/development-log.md 已更新
```

任何一项为 no，最终报告必须解释。

---

# 77. Git Phase Checkpoint

所有实现、测试、日志和架构审查完成后，按现有阶段交付约定提交。

推荐 commit：

```text
feat(recommendation): add personalized candidate discovery
```

推荐 annotated tag：

```text
phase-3
```

只 push：

```text
origin
```

不要 push upstream。

不要 force push。

不要无差别：

```text
git add .
```

先检查 diff，只提交 Phase 3 相关代码、测试、Prompt/文档和 development log。

---

# 78. Codex 最终交付报告格式

完成后向我返回：

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

逐个说明用途。

## C. Final Candidate Architecture

展示实际链路：

```text
ResearchProfile
├─ Profile Query Recall
└─ Seed Recall
        ↓
Literature Adapter
        ↓
Normalize
        ↓
Library Filter
        ↓
Dedup / Merge
        ↓
Candidate Pool
```

## D. Recall Route Details

列出实际：

```text
query limits
seed limits
provider
concurrency
pool limit
```

## E. Candidate Identity

说明 DOI / arXiv / OpenAlex / fallback 规则。

## F. Candidate Provenance

给一个实际结构示例。

## G. Novelty Filter

说明如何排除 Zotero 已有论文。

## H. Agent Tool

说明：

```text
research_candidate_discover
```

input / output / exposure。

## I. Tests

列出真实命令和结果。

## J. Architecture Red-Line Review

重点确认 Recall 没有吸收 Ranking。

## K. Known Issues

只列真实剩余问题，例如：

```text
Zotero host smoke status
OpenAlex-only recall
seed without DOI skipped
no fuzzy dedup
no freshness filter
no ranking
```

## L. Deferred Phase 4

只总结 ranking 工作，不实现。

## M. Development Log

确认：

```text
docs/development-log.md
```

已更新并进入阶段提交。

---

# 79. Phase 3 Success Criteria

只有下面链路实际成立，Phase 3 才算完成：

```text
Persistent ResearchProfile
          +
Current Library Snapshot
          +
Optional Current Focus
          ↓
Query Recall Plan
          +
Seed Recall Plan
          ↓
Existing LiteratureSearchService
          ↓
Normalized External Papers
          ↓
Novelty Filter
          ↓
Cross-route Dedup + Provenance Merge
          ↓
RecommendationCandidate[]
          ↓
research_candidate_discover
          ↓
Plugin Agent receives a bounded,
traceable, personalized candidate pool
```

同时这些必须仍然未实现：

```text
final personalized rank
semantic score
graph score
recency score
feedback score
MMR
RecommendationImpression persistence
Feedback learning
RAG recommendation explanation
```

本阶段的目标不是增加更多模型或更多 Agent 框架。

目标是建立一个**高质量、可解释、可评测的多路 Candidate Recall 层**，为 Phase 4 的个性化排序提供干净输入。
