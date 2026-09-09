# Development Log

## Current Baseline

- Upstream commit: `5be02f51a9bdf9b143439c95eed07bd62a34cb68`（与架构基线一致）。
- Current branch: `main`；阶段提交按下方 Git 交接约定管理。
- Personal repository: `https://github.com/ck-alpha/zotero-research-agent`（私有；GitHub 仓库名称变更不修改插件名称或 addon ID）。
- Phase checkpoint: `phase-6`；历史 phase-1 至 phase-5 保留。阶段实现提交通过 `git rev-parse phase-6^{commit}` 查询，交付目标仅个人 origin/main 与 phase-6。
- Phase 4 implementation commit：`743e0b813fa4aad8bb730f4fa35ab215c3388211`，由带注释标签 `phase-4` 标识；阶段起点为 `474e2b73c419ddfdd10a786a3726b942585ed034`（Phase 3）。Phase 5 起点为其后远端交付日志提交 5fa52194；不移动既有阶段标签。
- Current phase: Phase 6 — Evidence-grounded Recommendation（真实宿主/live smoke 未执行）。
- Last verified date: 2026-09-09 (UTC)。
- Phase 4 修改前 working tree：用户已有未跟踪 `doc/analysis/`、`doc/codex_phase4_personalized_ranking_mmr_prompt.md`、`doc/仓库技术与产品分析报告_2026-09-07.md`；没有已跟踪文件修改。
- 实际架构基线位于 [docs/research_agent_architecture_baseline.md](research_agent_architecture_baseline.md)，本阶段要求位于 [doc/codex_phase5_feedback_learning_loop_prompt.md](../doc/codex_phase5_feedback_learning_loop_prompt.md)。架构基线在 Phase 1 实现后由用户移至 `docs/`；本交接文档使用要求的 `docs/development-log.md` 路径。

## Current Architecture Status

- Production ProfileStore：已实现独立 Zotero.DB / SQLite 快照表、schema v1、读写校验、分离副本和原子 CAS；不存在数据库不可用时冒充持久化的内存回退。
- Profile scope：每个 Zotero library 一个 `library:<libraryID>` 画像；严格正安全整数校验，无跨库静默回退。
- LibrarySource：`IndexedResearchLibrarySource` 复用 LibraryIndex 元数据和 collection path，不另建全库投影，不读取 UI 或 PDF 全文。
- TopicExtractor：`UtilityTopicExtractor` 包装既有 `callUtilityLLM`，采用有界批处理；结构校验、批内论文 ID 校验以及服务端二次校验后才使用结果。
- Deterministic fallback：人工标签 + collection 完整路径；模型未配置、超时、空响应、格式/证据错误、传输失败仍可构建有效画像。
- ProfileBuilder / Scoring / Updater：纯 TypeScript 归一化、每论文去重计权、180 天半衰期、独立 weight/confidence、显式偏好约束、证据引用及代表论文；偏好替换校验后完整重建。
- ProfileService：首次构建、缓存读取、显式重建和偏好更新，统一管理版本、警告和 CAS；冲突明确失败，不隐藏重试。
- `research_profile_get`：已按 built-in pattern 注册；read、无需 Zotero 写确认；scope 来自请求/上下文，输出有界结构化摘要。
- 当前链路：LibraryIndex → ResearchLibrarySource → ResearchPaperSignals + 可选已验证主题 → ProfileBuilder / Scoring → ResearchProfile → SQLite ProfileStore → 插件 Agent Tool。
- Profile Query Recall / Seed Recall / Candidate Merge & Dedup / Whole-library Novelty Filter：已实现；生产 provider 为 OpenAlex，候选评分为空，按发现顺序输出。
- `research_candidate_discover`：已实现，仅插件 Agent，直接读取完整持久画像；focus 临时生效，候选池不持久化。
- Phase 3 链路：完整 ResearchProfile + 当前 LibrarySnapshot → 双路 Recall → LiteratureSearchService adapter → Normalize → 全库排除 → Dedup/Merge → Candidate Pool → Agent Tool。
- Lexical Ranking / Optional Semantic Ranking / Graph-Seed Feature / Recency Feature / Explicit Preference Compatibility / Base Ranker / MMR / `research_recommend`：已实现。
- Phase 4 链路：完整 Candidate Pool → Feature Computation → 可用权重归一化 Base Score → Base Sort → MMR → RecommendedPaper[] → 插件 Agent。
- Profile Memory / Candidate Query Recall / Seed Recall / Merge-Dedup / Novelty Filter：已实现并保持既有边界。
- Production ImpressionStore / Production FeedbackStore / RecommendationImpression persistence / Feedback append-only events / Feedback replay / Feedback-aware Profile update / recommendation_feedback：**implemented**。
- Recommendation Evidence：已实现有界只读检索、确定性证据排序与理由；recommendation UI / Scheduler-Digest / automatic Zotero import from feedback：**NOT implemented**。
- 曝光和反馈已持久化；无向量/CandidateSet 持久化，推荐 UI / Scheduler / Skill / Action、跨设备同步尚未实现。

| 后端                                                    | 当前支持状态                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 插件内 Agent Runtime（现有 provider-safe Utility 通路） | 支持 `research_profile_get`、`research_candidate_discover`、`research_recommend`、`recommendation_feedback`；无 embedding 可排序 |
| 普通聊天                                                | 未接入                                                                                                                           |
| Codex App Server                                        | 未接入；Tool 不在外部目录，authMode 可用性也拒绝                                                                                 |
| Claude Code                                             | 未接入；Tool 不在外部目录                                                                                                        |
| WebChat / web_sync                                      | 未接入；目录隔离及请求可用性拒绝                                                                                                 |
| MCP / public tool catalog                               | 未暴露；沿用 `localAgentOnly` 过滤                                                                                               |

## Change History

### 2026-09-09 / recommendation-phase6-evidence-grounded

#### Goal / Git Baseline

完成 Ranked Top-K → 可追溯证据 → 有依据的推荐理由，保持 Profile / Candidate / Ranking / Feedback 职责。

- 起点：`4d9b59c421f23b61a79d4d94c1577fe696117154`；`git fetch origin` 后 HEAD 与 origin/main 一致，tracked tree 干净。
- 阶段提交：`feat(recommendation): add grounded recommendation evidence`；annotated tag：`phase-6`。本条在实现提交中以标签引用自身；远端交付结果另行记录，不改写旧标签。
- 仅纳入实现、测试、原样第六阶段需求、架构基线及本日志。`doc/analysis/` 和独立中文分析报告保持原样，不纳入提交。

#### Files / What Changed

- `src/recommendation/evidence/{contracts,evidenceRetriever,evidenceRanker,evidenceFormatter,evidenceService}.ts`：只读不可变合同、运行时 guards、确定性检索/排序/解释及错误降级。
- `src/agent/services/recommendationEvidenceSource.ts`：关联 library/item scope 验证，复用 ZoteroGateway 笔记读取和 PdfService 缓存。`pdfService.ts` 仅增加现有缓存只读访问，不启动提取。
- `src/agent/tools/recommendation/researchRecommend.ts` 与 tools/index：Top-K 后调用 evidence service，逐篇返回 evidence/reason/warnings，聚合警告；Agent guidance 限制只引用已有支持。曝光仍保存 Phase 5 原始候选、版本、分数和主题快照，不保存证据正文。
- `test/recommendationEvidence.test.ts` 新增 10 项；推荐 Tool SQLite 集成测试扩展引用映射、上限、reason 与曝光兼容断言。

#### Architecture / Limits / LLM Boundary

- 排序解释严格分离：证据不重新选择候选、不修改分数，只读取排序后的候选及关联画像/库内材料。
- metadata/tag/collection 来自当前 snapshot；notes 来自 Gateway；abstract 来自已存库投影或已发现候选；paper_content 仅来自现有 PDF 缓存。库内片段只说明兴趣背景，候选摘要才是外部新论文的直接支持。不从标题、搜索 query 或库内种子正文推断新论文结论。
- 合同字段：evidenceId/candidateId/sourceType/reference/snippet/confidence/createdAt；sourceType 四值枚举、有限 `[0,1]` confidence、非空且限长字符串、非负整数时间，拒绝额外字段。reason 的主题来自画像与 candidate 匹配 ID，并检查摘要片段；evidenceRefs 必须在当前返回数组内解析。
- score = 0.4 topicMatch + 0.3 sourceQuality + 0.2 freshness + 0.1 completeness，6 位精度，reference/ID 稳定平局顺序；未知来源时间无 freshness 奖励。createdAt 是读取时间；confidence 不是校准概率。
- 每篇最多 4 条证据，snippet ≤480、summary ≤1000、JSON evidence+reason ≤6000 字符；Top-K ≤20，新增总解释上限 120000 字符。每候选关联最多 3 篇、每扩展来源最多 4 条、单条扫描 ≤12000 字符。单来源 1500ms、一次 Top-K 共享扩展读取 5000ms 预算；现有同步宿主调用不支持抢占。
- 完全无 LLM 调用，确定性模板就是无模型 fallback；无需 API key 或实时服务。不发送全库/无关论文/聊天历史；Agent 只能转述结构化支持，不能选择、重排、发明引用或兴趣。片段作为数据，不当作指令。
- 缺支持：成功返回推荐，但 reason confidence=0、空主题和引用、`evidence_unavailable`；部分失败/超时 `evidence_partial_failure`，保留其他可用证据；取消传播，不吞掉为成功。

#### Tests

使用既有 Node v24.20.0 工具链，无安装/升级依赖；全部离线确定性测试，无真实 API/model。

- `npm run typecheck`：通过。
- recommendation 专项：202 passing（2s）。
- `npm run test:unit`：4433 passing（40s）、1 pending；相对 Phase 5 新增 10 passing，无新增失败。
- `npm run build`：通过，含插件打包与内置 typecheck。
- `npm run check:cycles`：通过，0 runtime / 0 static allowlisted。
- 修改范围 ESLint：通过；新增测试额外按项目 Zotero + Node + Mocha 类型环境编译：通过。
- 修改范围源码/测试 Prettier 与 `git diff --check`：通过。

测试覆盖：四来源合同、非法值/置信度/来源/超长、来源映射、只读缓存、跨库拒绝、部分失败/超时、取消、确定性排序/分数/不可变性、原文窗口、JSON 转义后上限、缺失支持/禁止标题推断、A 强于 B 的完整排名后证据夹具、Tool 引用完整性和 Phase 5 曝光兼容。

开发中修复了测试夹具的 rank 字段/seed provenance 不一致及超时默认参数字面量类型问题；早期独立测试编译命令缺少 Zotero/Mocha 类型，改为继承项目配置并显式添加测试类型后通过。初次全量为 4432 passing / 1 pending / 1 failing（新夹具）；最终结果以上为准。

#### Known Issues / Red-Line Review

- 未执行真实 Zotero 宿主、插件重启、live-agent 或 workflow smoke；Node mock/SQLite 不替代宿主验收。
- 仍有既存 1 pending；构建环境已有 NODE_TLS_REJECT_UNAUTHORIZED=0，未设置或修改该值。
- 解释采用保守词汇匹配，不声称验证论文结论；摘要缺失/同义词/截取窗口未包含支持时明确不足。库内易变笔记和缓存不做逐字历史归档，曝光可复现候选摘要/排序/反馈关联，不能保证历史库证据原文重放。
- 无 Zotero 自动导入、UI、Scheduler、向量数据库、新 PDF 管线、多 Agent、学习排序、Chat RAG 重构或无依据生成。

#### Deferred Work / Next Recommended Step

后续 Phase 7：推荐与 Agent workflow 评测、延迟/覆盖率/消融及宿主验收。Phase 8 Optional：UI/Digest/Scheduler、证据历史与持久缓存等能力需另定范围。


### 2026-09-09 / recommendation-phase5-feedback-learning-loop

#### Goal

完成实际展示曝光 → 结构化反馈 → 持久事件 → 确定性重放 → 画像 CAS → 后续推荐变化的闭环，并保留显式刷新中的反馈。没有开展下一阶段。

#### Git Baseline

- Branch：main；starting commit：`5fa52194677fff1054b5da874e55bb99a62742a7`，远端 main 已通过 `git ls-remote` 核对一致；phase-4 实现提交 `743e0b813fa4aad8bb730f4fa35ab215c3388211` 保持不动。
- 阶段实现提交标题：`feat(recommendation): add feedback learning loop`；annotated tag：phase-5。提交内以标签引用自身提交，不写循环自引用哈希。
- 起始 tracked tree 干净，仅有未跟踪阶段需求、doc/analysis/ 与独立中文分析报告。仅阶段需求纳入交付，分析材料保持原样。
- 阶段实现提交：`ca8ee763f217ab81348040002e34c1a39b7f3d10`。已成功推送 origin/main 与 annotated phase-5，远端引用核对与该实现一致。随后追加本条交付日志提交到 main，phase-5 保持指向实现提交；不 force push、不移动旧标签、不推送 upstream。

#### Files Changed

| 文件                                                     | 用途                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| src/recommendation/feedback/stores.ts                    | 曝光/反馈生产 SQLite Store、schema 常量和按 scope 查询              |
| src/recommendation/feedback/policy.ts                    | 固定动作强度、半衰期、饱和公式、逻辑事件 ID                         |
| src/recommendation/feedback/replay.ts                    | 跨对象关系校验、确定性重放、持久标签、计数和证据                    |
| src/recommendation/feedback/profileUpdater.ts            | 纯反馈更新器、不重复叠加的基准、来源与时间/版本                     |
| src/recommendation/feedback/service.ts                   | 事件优先提交、幂等、两次 CAS 上限、reconciliation                   |
| src/recommendation/domain/profile.ts                     | 可选 feedbackBaseTopics 纯主题基准合同                              |
| src/recommendation/domain/recommendation.ts              | 曝光 topicSnapshot 标签合同                                         |
| src/recommendation/domain/validation.ts                  | 新合同校验、主题 ID/标签覆盖、基准限制                              |
| src/recommendation/profile/profileStore.ts               | 导出既有 Zotero.DB seam resolver，供生产 memory stores 使用         |
| src/recommendation/profile/profileBuilder.ts             | 纯构建输入增加 feedback aggregate，合并反馈但只生成一次版本         |
| src/recommendation/profile/profileService.ts             | 全刷新装配 replay，生产路径不再丢弃反馈                             |
| src/recommendation/profile/production.ts                 | 生产画像服务注入持久 FeedbackReplay                                 |
| src/agent/tools/recommendation/researchRecommend.ts      | Top-K 曝光先持久化，输出 recommendationId                           |
| src/agent/tools/recommendation/recommendationFeedback.ts | 约束输入、上下文 scope、强制确认、明确 effect 与状态                |
| src/agent/tools/index.ts                                 | 注册生产 feedback Tool                                              |
| src/agent/types.ts                                       | 最小 recommendation_memory mutationScope 合同                       |
| src/agent/tools/registry.ts                              | 内部记忆独立确认路径，保留锁与生命周期，不伪造 Zotero receipt       |
| test/recommendationFeedback.test.ts                      | SQLite、replay/updater、service、tool、registry 与可读完整闭环 demo |
| test/recommendationRecommendTool.test.ts                 | 曝光断言、ID、SQLite seam 和阶段边界更新                            |
| test/toolSurfaceRefactor.test.ts                         | 新工具目录预期                                                      |
| docs/research_agent_architecture_baseline.md             | 更新相关 Phase 5 架构事实                                           |
| docs/development-log.md                                  | 本轮实现、决策、验证及交接记录                                      |
| doc/codex_phase5_feedback_learning_loop_prompt.md        | 原样保存本阶段需求                                                  |

#### What Changed / Architecture Decisions

##### Impression Persistence

`llm_for_zotero_recommendation_impressions`：recommendation_id TEXT PRIMARY KEY NOT NULL、profile_id TEXT NOT NULL、profile_version INTEGER NOT NULL、timestamp INTEGER NOT NULL、schema_version INTEGER NOT NULL、impression_json TEXT NOT NULL。独立 IMPRESSION_SCHEMA_VERSION=1。

UUID 由服务端 `crypto.randomUUID()` 生成；timestamp 为 ranking.generatedAt。只存实际返回的 Top-K，内部候选池不存；保留未裁剪元数据/完整精度 scores/provenance，Tool 仍使用既有有界摘要和四位分数显示。曝光写入失败使 Tool 失败；排序失败不写曝光。

采用 impression-level topicSnapshot，避免每个候选重复存标签。domain 为兼容旧 fixture 可省略，但生产 store 必须存在；唯一标签覆盖所有 matchedTopicIds。临时 focus 不自动变成画像主题。

##### Feedback Persistence / Idempotency

`llm_for_zotero_recommendation_feedback`：event_id TEXT PRIMARY KEY NOT NULL、recommendation_id TEXT NOT NULL、paper_id TEXT NOT NULL、action TEXT NOT NULL、timestamp INTEGER NOT NULL、profile_id TEXT NOT NULL、schema_version INTEGER NOT NULL、feedback_json TEXT NOT NULL。独立 FEEDBACK_SCHEMA_VERSION=1。profile_id、recommendation_id、paper_id 各有查询索引；按 SQLite rowid 返回 append order。

逻辑事件 ID 精确规则：`feedback:${recommendationId.length}:${recommendationId}${candidateId.length}:${candidateId}:${action}`，长度为 JS string.length。长度编码对不透明 ID 中的分隔符无歧义。同 recommendation/candidate/action 为一事件；positive→negative 是两个事件。重复 insert 不覆盖；Service 仅在实际读到匹配持久事件时解释为 already_recorded，包括并发重试。

Feedback domain 没有增加 profileId；ScopedFeedbackStore 是窄扩展，profile scope 仅由 Service 校验后作为行字段持久化。两个 Store 都懒初始化、失败可重试、首次 await 前校验和脱离快照、读后校验 schema/元数据，数据库错误不伪装内存成功。

##### Integrity Rules

曝光必须存在且 profileId 等于上下文 library 的 profileId；候选必须恰好属于曝光一次；推荐/论文/事件身份、时间戳和 snapshot 均经验证。事件时间不得早于曝光。旧 profileVersion 有效，不要求历史画像快照。无可用持久主题标签时仅计数，报告 feedback_no_matched_topics。

##### Feedback Signal Policy

positive=+0.70、save=+1.00、negative=-1.00、skip=-0.20，固定工程参数；半衰期 180 天。每事件 effectiveMass=`abs(strength)*2^(-ageDays/180)`，正负分别累加；aggregate=`1-exp(-mass/2)`。positive/save 计正反馈，negative/skip 计负反馈，重试不增计数。

主题只由持久 matchedTopicIds + topicSnapshot 派生；不使用标题主题提取、聊天文本或 LLM。重放按 timestamp 升序、eventId 字典序固定浮点求和顺序；历史标签冲突由该顺序最后事件的 snapshot 决定。

##### Replay / Reconciliation

先落事件，后 replay + profile CAS。最多两次 CAS（一次原尝试、一次 reload/replay 重试）；CAS 或更新失败不会删除有效事件，返回 feedbackRecorded=true、profileUpdated=false 和 feedback_profile_reconcile_required。

`reconcileProfileFeedback(profileId, now)` 可在重启或失败后调用；同一 now、同一状态不增版本。幂等 submit 会核对重放计数与画像：若已应用全部 append-only 事件，不因点击时间改变而衰减/重建；未应用则进行 reconciliation。显式 reconciliation 可重新评估时间衰减。

##### Profile Update Policy

可选 feedbackBaseTopics 保存最新一次全构建的不含反馈主题（含 library/explicit 已确定分数），避免把已调整分数再次当基准。现有 Profile schema v1 保留，新读取器兼容旧无字段快照；无生产旧反馈数据迁移。若出现没有基准的历史人工 feedback 主题，明确要求 refresh，不猜测原分数。

令 n 为显式负偏好，b 为已扣除 n 的基准 weight，u=b/(1-n)（n=1 时 u=0），p/q 为正/负反馈 aggregate：`weight=clamp(max(u,p)*(1-max(n,q)))`，`confidence=clamp(max(baseConfidence,p,q))`。显式强负偏好优先。save 比 positive 更强，negative 比 skip 更强。

添加 feedback source，lastEvidenceAt 合并最新反馈时间。证据总数≤12，保留前≤11 条非反馈 ref，余位取最新反馈 refs（同时间按 eventId），格式 feedback:<eventId>。基准中保留完整非反馈证据，支持消失时恢复；无非反馈来源的主题移除，不留空 sources。

反馈更新只在主题/计数改变时 version+1、updatedAt=now，generatedAt/显式偏好/库计数/代表论文不变；embedding 移除。刷新重建 library + optional extractor + explicit + replay，generatedAt/updatedAt 同为 now，只增一个版本。生产 refresh 不再出现 feedback_state_discarded_on_rebuild。save 不增加 representativePapers、不导入 Zotero。

##### Agent Tool

recommendation_feedback 仅插件 Agent，write、localAgentOnly，输入只有 recommendationId/candidateId/action；libraryID 来自 Agent context，timestamp 服务端生成，eventId/topics/strength 服务层推导。输出 compact event/status/version/topic/warnings，没有完整画像/数据库细节。

运行时既有 Action Contract 只覆盖 Zotero/文件/执行，直接注册 write 会被拒绝。最终使用严格限于该 Tool 的 recommendation_memory scope：仍必须具体确认，所有 write mode 均确认，不继承其他动作批准，保留执行锁、取消/生命周期检查、明确 applied/none effect。事件 Store 是该内部状态的持久日志，不调用 Zotero mutationCoordinator，不生成 Zotero Action receipts，不满足其他 library obligation，不伪装可撤销操作。既有其他写入路径保持原检查。

指导 Agent 使用上一轮推荐输出的 ID 处理“第2篇感兴趣”“第4篇不感兴趣”“这篇我想保存”“这个跳过”；上下文明确时不要求用户复述 ID。不把无关情绪当反馈，一篇一次调用。save 仅表示强正偏好。

#### Tests

最终实际结果（Node v24.20.0；使用工作区 .toolchains 下既有工具链）：

| 命令                                                                                                                                                                             | 结果                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                                              | 通过                                                                  |
| `node --import tsx node_modules/mocha/bin/mocha.js --require ./test/register.cjs 'test/recommendation*.test.ts' test/agentToolRegistry.test.ts test/toolSurfaceRefactor.test.ts` | 256 passing（380ms）                                                  |
| `npm run test:unit`                                                                                                                                                              | 4423 passing / 1 pending（38s），较 Phase 4 增加 29 项通过            |
| `npm run build`                                                                                                                                                                  | 成功打包 XPI，并通过内置 typecheck                                    |
| `npm run check:cycles`                                                                                                                                                           | 通过，0 runtime / 0 static allowlisted                                |
| `node node_modules/typescript/bin/tsc --noEmit -p /tmp/phase5-tsconfig.json`                                                                                                     | recommendation 系列测试额外类型检查通过                               |
| `node node_modules/eslint/bin/eslint.js <全部变更 TS 文件>`                                                                                                                      | 通过                                                                  |
| `node node_modules/prettier/bin/prettier.cjs --check <全部变更 TS 文件> docs/development-log.md`                                                                                 | 通过；架构文档只格式化修改的 Phase 5 节，保留其余原格式；需求原样保存 |
| `git diff --check`                                                                                                                                                               | 通过                                                                  |

临时日志为 `/tmp/phase5-{focused,unit,build,typecheck,test-types,lint,cycles,format-check}.log`，不纳入 Git。测试涵盖 SQLite 重启与副本隔离、非法/损坏/schema、逻辑身份、四动作与衰减、冲突反馈、并发幂等、基准重放/移除、持久事件先于 CAS、两次冲突后恢复、refresh、工具约束/批准前无写入/执行锁、真实 SQLite + 假 literature 的排序变化 demo，以及输出/落库失败边界。

首次专项回归仅旧 Phase 4 禁止 ImpressionStore 断言失败，按本阶段范围更新；首次全量 4419 passing / 1 pending / 1 failing，唯一失败为工具目录尚未加入 recommendation_feedback，已更新，最终无失败。

- npm run test:unit 初次沙箱执行受 tsx IPC `listen EPERM` 限制，经授权在沙箱外重跑。
- 独立测试类型检查初次缺 Zotero ambient types；临时 /tmp/phase5-tsconfig.json 继承项目配置、显式 typings 与 Zotero/Node/Mocha 类型后通过，不修改项目 tsconfig。
- 真实 Zotero / OpenAlex / embedding smoke：**not executed**。环境没有可用 Zotero 宿主；SQLite Node seam 和假 provider 不替代宿主验证。

#### Architecture Red-Line Review

只持久实际 Top-K；写失败不返回无可追溯推荐；反馈验证曝光与成员、append-only、相同逻辑事件幂等、不同动作共存；强度集中、正负分离、纯重放、source/count/version 可审计；事件优先 CAS、失败留事件、可 reconciliation；full refresh 保留反馈，点击不调用 Utility LLM。

无自动导入、PDF/RAG evidence enrichment、推荐 UI、Scheduler/Digest、LLM ranking/解释反馈、向量库/向量持久化、训练、跨设备同步或 Multi-Agent。未改写历史标签或引入新 DB 依赖。

#### Known Issues

- 真实宿主 smoke 尚未执行，UUID/Zotero.DB/重启/实际对话确认仍需宿主验收。
- 保留上游已有 1 项 pending 单测。
- 不保存完整画像版本历史；当前只保存最新画像及纯主题基准，曝光保存学习需要的历史标签。
- 推荐记忆点击始终需要确认，是当前安全框架下的明确选择。

#### Deferred Work

下一阶段仅建议 Top-K 的证据补全与有依据推荐理由。UI、Skill、Action、Digest/Scheduler、真正 import 与反馈链接、画像历史、跨设备同步继续另行设计，不在本阶段实现。

#### Next Recommended Step

在真实 Zotero 先验收 profile_get → candidate_discover → recommend → confirmed feedback → refresh/restart，然后开展 evidence-grounded recommendation。

### 2026-09-09 / recommendation-phase4-personalized-ranking

#### Goal

完成完整 ResearchProfile + Novel Candidate Pool + 临时 focus → 确定性特征 → Personalized Base Rank → MMR → RecommendedPaper[] → research_recommend。Embedding 是可选特征；保持发现、排序、Agent orchestration 的职责分离。

#### Git Baseline

- Branch：`main`；starting commit：`474e2b73c419ddfdd10a786a3726b942585ed034`（`phase-3`）；upstream 固定基线不变。
- 本阶段本地检查点使用 `feat(recommendation): add personalized ranking and mmr` 与带注释标签 `phase-4`；ending commit 由 `phase-4^{commit}` 查询，提交内不记录自身哈希。
- 初次交付完成开发、验证和本地阶段提交。2026-09-09 用户明确要求“请进行远程仓库的提交和推送”，本次追加本条交付日志提交，并将 `main` 与已有带注释标签 `phase-4` 推送到个人 `origin`；不改写实现提交、不移动标签、不强推、不推送 upstream。
- 推送前核验：远端 `main` 为 Phase 3 commit `474e2b73c419ddfdd10a786a3726b942585ed034`，不存在远端 `phase-4`，可正常快进。推送后再次核对远端 main 与本地 HEAD、远端 phase-4 与实现 commit。
- 本次没有代码变更，沿用本阶段已完成的 4394 passing / 1 pending、248 项专项回归、typecheck/build 等结果；仅对更新后的日志执行格式与 diff 检查。
- 起始已存在未跟踪 `doc/analysis/`、阶段需求和独立中文分析报告。阶段需求原样纳入阶段交付；独立分析目录/报告不修改、不纳入提交。依赖、构建产物和凭据不纳入提交。

#### Files Changed

| 文件                                                          | 用途                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/recommendation/ranking/contracts.ts`                     | 纯 RankingInput/Result、embedding provider、诊断合同                      |
| `src/recommendation/ranking/config.ts`                        | 全部评分权重、MMR、文本/批次/超时/输出限制及校验                          |
| `src/recommendation/ranking/textSimilarity.ts`                | Unicode 归一化、词组/词覆盖、Jaccard 与有界候选文本                       |
| `src/recommendation/ranking/features.ts`                      | 词法、来源 graph、recency、负偏好及匹配主题                               |
| `src/recommendation/ranking/semantic.ts`                      | 有界画像文本、顺序分批、向量校验、稳定 cosine、截止/取消/整体回退         |
| `src/recommendation/ranking/scoring.ts`                       | 可用权重重新归一化、偏好乘数、稳定 base tie-break                         |
| `src/recommendation/ranking/diversity.ts`                     | 独立 MMR、语义/Jaccard 相似度及选择时分数                                 |
| `src/recommendation/ranking/rankingService.ts`                | 输入校验、快照隔离、评分→base sort→MMR→诊断                               |
| `src/recommendation/domain/candidate.ts`                      | 新增 preference/diversity 并明确分数语义                                  |
| `src/recommendation/domain/validation.ts`                     | 两个新增字段严格 `[0,1]`，保持历史 finite 字段兼容                        |
| `src/agent/services/recommendationEmbeddingProvider.ts`       | 复用既有 embedding 配置/客户端的 Agent adapter                            |
| `src/agent/tools/recommendation/researchRecommend.ts`         | 本地 Tool、scope/输入校验、服务编排、指导与有界结果                       |
| `src/agent/tools/recommendation/researchCandidateDiscover.ts` | 引导个性化推荐直接使用 research_recommend                                 |
| `src/agent/tools/index.ts`                                    | 新 Tool 生产装配及 literature guidance 的个性化分流                       |
| `src/utils/llmClient.ts`                                      | 向后兼容可选 AbortSignal；拒绝重复/混合/越界 embedding response index     |
| `test/recommendationRanking.test.ts`                          | 特征/评分/语义/MMR/取消/回退/输入隔离测试                                 |
| `test/recommendationEmbeddingProvider.test.ts`                | 既有配置、payload、32 条分批、顺序、非法索引/向量、取消与旧 API 回归      |
| `test/recommendationRecommendTool.test.ts`                    | 暴露、指导、参数、架构约束、真实 Node SQLite + fake recall/embedding 集成 |
| `test/recommendationDomain.test.ts`                           | 新分数边界及负 finalScore 合同测试                                        |
| `test/helpers/recommendationFixtures.ts`                      | 完整 fixture 增加 preference/diversity                                    |
| `test/toolSurfaceRefactor.test.ts`                            | 更新插件 Agent 工具目录预期                                               |
| `docs/research_agent_architecture_baseline.md`                | 局部更新 Phase 4 公式、模型边界、工具和延期事实                           |
| `docs/development-log.md`                                     | 本阶段记录、当前架构、后端矩阵、决策和交接                                |
| `doc/codex_phase4_personalized_ranking_mmr_prompt.md`         | 用户提供的阶段需求原样归档                                                |

#### What Changed

RankingService 不发现外部论文，CandidateDiscoveryService 保持原样且不排序。新 Tool 一次完成画像加载、当前全库 snapshot、双路候选发现及完整池排序；不解析另一个 Tool 的截断输出。结果保留候选 metadata、sources、seedPaperIds、provenance，新增 rank、matchedTopicIds 和每项分数。输入对象在异步 embedding 前创建独立快照，旧候选 scores 不参与本次评分，feedback 不输出。

#### Architecture Decisions

- 领域层只接收纯数据、RankingEmbeddingProvider 和 AbortSignal，不导入 Agent、Zotero UI、llmClient 或 retrieval UI 模块。既有 PDF cosine/MMR 实现已检查，不为复用小型数学函数引入 UI 依赖。
- 固定 profile/candidates/focus/now/semantic features 得到固定结果。候选先按 ID 确定 embedding 顺序；聚合、base tie-break 与 MMR 不依赖网络完成顺序或运行环境 locale。
- 默认参数是工程起点，不是科学结论；测试可覆盖配置。Tool 不接受权重、lambda、provider URL、模型、libraryID 或候选列表。
- 缺失画像沿用 Phase 2 首建；已保存画像始终加载，不自动 refresh，不写新版本。显式 refresh 仍通过 research_profile_get。

#### Feature Computation

文本先 NFKC、小写（含 ß→ss、ς→σ）、trim/空白折叠，按 Unicode letter/number 提取 token，不引入 NLP 依赖。词法/MMR 文本是 title + 换行 + abstract，总长最多 1200 字符。

`match(text,label)`：归一化非空完整词组包含时为 1，否则为去重 topic token 的覆盖比例；无有效 token 为 0。是可解释的词组包含/覆盖启发式，不声称词形还原或跨语言语义理解。

正主题为 weight×confidence > 0 且不与负偏好 ID/归一化 label 冲突的画像主题；按 strength 降序、ID 升序。`profileLexical = Σ(strength * match)/Σ(strength)`，无正主题为 0。有 focus 时 `lexical = 0.60*focusMatch + 0.40*profileLexical`，否则 lexical=profileLexical。

matchedTopicIds 来自上述正主题，match≥0.50 或 profile_query provenance 明确携带已存在 ID；按 strength/ID 稳定排序，最多 8，不凭外部未知 ID 创造主题。

`graph = max(1/log2(providerRank+1))`，仅 seed_recommendation；无 seed 为 0，profile_query providerRank 不贡献 graph。

recency 从 trim 后开头四位年份解析（后接结束、日期分隔符或空白），接受 1000..currentYear+1；无可信 leading year 为 undefined。使用 UTC 当前年份，`age=max(0,currentYear-year)`，`recency=2^(-age/3)`；明年预发表按年龄 0，荒谬未来年份不计时效。只使用出版年份，不把发现时间当出版新鲜度。

#### Semantic Embedding Boundary

Agent adapter 复用 `checkEmbeddingAvailability / getResolvedEmbeddingConfig / callEmbeddings`，专用 embedding 设置是唯一模型来源；不创建新设置或客户端。适配器记录既有 config attemptKey，调用前后检查配置未变化，避免同一请求混用模型/端点。

画像表示依次为 focus、前 12 正主题、前 10 正强度偏好、前 6 正权重代表论文标题；稳定按权重/ID 排序，总长最多 4000 字符。与负偏好同标签的正偏好也不作为正语义信号。负偏好列表、evidenceRefs、历史对话、PDF 和完整库文本不进入表示。候选仅 title + bounded abstract，最多 1200 字符。

RankingService 按 32 条顺序分批（80 个候选加画像最多 3 批），整个语义阶段截止 30,000ms。数量必须等于 batch 文本数，维度共同且非零，坐标必须 finite；模型 identity 跨批一致。零向量是合法向量，cosine=0；先按最大绝对坐标缩放，避免大 finite 坐标平方溢出。`semantic=clamp(cosine(profile,candidate),0,1)`，零 cosine 不映射为 0.5。

既有 callEmbeddings 新增可选 signal 并传入 fetch；响应有 index 时必须是完整唯一的 0..N-1，全部无 index 的旧 provider 保持响应顺序约定。adapter 与 domain 分别校验，任何批出错丢弃所有向量。无配置、无正画像文本、API/不支持 provider、无效向量、超时均返回紧凑 warning 后继续；不泄露原始错误或凭据。用户 abort 则取消请求；即使依赖不响应 abort，deadline/race 仍及时结束且不开始后续批。

向量只活在请求中：无 vector database、ProfileEmbeddingRef/candidate vector 写入或缓存；不把向量放入结果/诊断。

#### Base Scoring Formula

```text
weights = semantic 0.45, lexical 0.30, graph 0.15, recency 0.10
rawRelevance = Σ(weight_i * feature_i) / Σ(weight_i for available features)
baseScore = clamp(rawRelevance * preference, 0, 1)
```

lexical/graph 始终可用；semantic/recency 缺失为 undefined，相应权重移出分母。配置要求 lexicalWeight+graphWeight>0，保证最小特征集可评分。全精度计算和排序；baseScore、lexical、可用 semantic 降序，再 candidateId 按固定字符串比较升序。不存在 LLM tie-break 或 LLM reranking。

#### Preference Policy

`negativeConflict = max(strength * match(candidate, negativeLabel))`，无负偏好为 0；`preference=clamp(1-negativeConflict,0,1)`。乘在已归一化 relevance 上；弱部分匹配不删除论文，preference=0 使 baseScore=0。正偏好通过画像主题及语义表示表达，不另加正偏好分数。feedback 在本阶段始终 unused/undefined。

#### MMR Policy

完整 base-sorted 池上贪心选 Top-K，`utility=0.80*baseScore-0.20*maxSimilarityToSelected`；同 utility 保留 base ordering。pairwise 优先语义 cosine clamp `[0,1]`，否则对同一 1200 字符候选文本做 token Jaccard，空集合相似度为 0。缓存每个剩余候选已遇到的最大相似度，每轮只与最近选择项比较。

首项 diversity=0；后续 diversity 为选择当时的最大相似度；finalScore 为该次 utility，可以为负，不是概率。输出沿 MMR 选择顺序 rank=1..K，不再按四舍五入分数重新排列。默认 K=10、最大 20，无 filler。

#### Agent Tool

`research_recommend({focus?:string,topK?:integer})`；focus 复用 Phase 3 校验（最多 300 字符、归一化临时生效），scope 来自当前上下文。read、requiresConfirmation=false、exposure=model、localAgentOnly=true。后端隔离沿用 Phase 2/3，详见当前支持矩阵。

输出 profileId/version、generatedAt、focus、recommendationCount、recommendations、discoveryDiagnostics、rankingDiagnostics、warnings。每篇含 rank、metadata/标识符/URL、matchedTopics{id,label}、score breakdown、sources/seedPaperIds/provenance。仅序列化时分数保留 4 位小数；abstract≤500、title≤300、authors≤20、每个作者≤120 字符，字段截断返回 ranking_tool_output_truncated。Top-K 选择本身不是异常截断。

诊断包含 inputCandidateCount、semanticRequested、semanticSucceeded、semanticCandidateCount、semanticFallback、topKRequested/Returned。空池不请求 embedding，返回 ranking_candidate_pool_empty；有池但无可用 semantic 则 fallback=true。无持久 recommendationId。

个性化文献请求直接优先 research_recommend，避免先调用 candidate Tool 重复请求；candidate Tool 用于检查/调试，generic literature_search 保持原有行为。匹配指导同时要求文献/阅读语境，避免接管电影/旅行等偏好请求。

#### Centralized Config

| 配置                                                                           | 值                        |
| ------------------------------------------------------------------------------ | ------------------------- |
| semantic/lexical/graph/recency Weight                                          | 0.45 / 0.30 / 0.15 / 0.10 |
| mmrLambda / recencyHalfLifeYears                                               | 0.80 / 3                  |
| focusLexicalWeight / matchedTopicThreshold                                     | 0.60 / 0.50               |
| maxLexicalCandidateChars / maxSemanticCandidateChars                           | 1200 / 1200               |
| maxSemanticTopics / maxSemanticPositivePrefs / maxSemanticRepresentativePapers | 12 / 10 / 6               |
| maxSemanticProfileChars / semanticBatchSize / semanticTimeoutMs                | 4000 / 32 / 30000         |
| maxMatchedTopics / toolDefaultTopK / toolMaxTopK                               | 8 / 10 / 20               |
| toolAbstractSnippetChars / toolTitleChars / toolMaxAuthors / toolAuthorChars   | 500 / 300 / 20 / 120      |

所有值来自 ranking/config.ts，有限值、范围/正整数校验；半衰期为正实数。测试可覆盖，生产 Tool 不接受模型自选参数。

#### Tests

使用已有 Node v24.20.0，PATH=`/home/linchengkai/new-project/.toolchains/node-v24.20.0-linux-x64/bin:$PATH`，不安装依赖，不调用真实模型/API。以下为本轮实际执行结果。

| 命令 / 检查                                                                                                                                                                                                                         | 结果                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                                                                                                 | 通过；build 同样内置执行                                                                                                                                    |
| `node --import tsx node_modules/mocha/bin/mocha.js --require ./test/register.cjs 'test/recommendation*.test.ts' test/toolSurfaceRefactor.test.ts test/searchLiteratureOnlineTool.test.ts test/llmClient.prepareChatRequest.test.ts` | 248 passing；包含 Phase 1/2/3、Tool surface、generic literature、旧 embedding API 回归                                                                      |
| `npm run test:unit`                                                                                                                                                                                                                 | 4394 passing、1 pending；比 Phase 3 新增 44 项，无新增 pending                                                                                              |
| `npm run build`                                                                                                                                                                                                                     | 通过；`.scaffold/build/llm-for-zotero.xpi`，不纳入源码提交                                                                                                  |
| `node node_modules/typescript/bin/tsc --noEmit -p /tmp/phase4-tsconfig.json`                                                                                                                                                        | 通过；额外覆盖新 ranking/adapter/tool 与 domain 测试及其 imports。临时配置继承主 tsconfig，显式引入 Zotero/Node/Mocha 类型，关闭 composite/incremental      |
| `npm run check:cycles`                                                                                                                                                                                                              | 通过，0 runtime / 0 static allowlisted                                                                                                                      |
| `eslint <本轮 TS 文件>`                                                                                                                                                                                                             | 通过                                                                                                                                                        |
| `prettier --check <本轮 TS 文件> docs/development-log.md`                                                                                                                                                                           | 通过                                                                                                                                                        |
| `prettier --check docs/research_agent_architecture_baseline.md doc/codex_phase4_personalized_ranking_mmr_prompt.md`                                                                                                                 | 两份文档有原有格式告警；用相同仓库 config/filepath 对 HEAD 架构原文确认同样不符合格式。遵循要求不整篇重排架构文档，用户需求原样保留；本轮新增架构段落已检查 |
| `git diff --check`                                                                                                                                                                                                                  | 通过                                                                                                                                                        |
| Zotero host / live OpenAlex / live embedding smoke                                                                                                                                                                                  | **not executed**；无宿主或真实 API 调用                                                                                                                     |

新增测试验证：确定性特征/范围/权重、显式负偏好冲突、缺失特征、语义正确/非法/跨批不一致/超时/取消、零向量与极大 finite 坐标、词法与语义 MMR、排名/分数可复现、输入不变、32+4 adapter 批次、专用模型、索引对齐、工具暴露和 scope、真实 SQLite 画像 revision 2 下 fake 双路召回/novelty/排序/Top-K/输出。测试中观察到的类型错误来自临时配置缺少 Zotero 类型，已修正配置后通过，不修改生产类型来规避检查。

#### Architecture Red-Line Review

- CandidateDiscoveryService 原样保留，不评分；RankingService 不外部发现，Agent Tool 直接编排服务且传入完整池。
- 排序域不依赖 Agent Runtime/UI/llmClient/conversationMemory，不新建 embedding preferences 或 client。
- 无 LLM 排序，缺失 semantic/recency 重新归一化；负偏好独立乘数；feedback 不使用；base tie-break 和 MMR 确定性。
- MMR 是单独模块，有 lexical fallback，推荐有 matchedTopicIds、分数与来源。
- 无 CandidateSet、向量、RankingResult 持久化；无生产 ImpressionStore/FeedbackStore，无自动 import、Zotero 内容写入、RAG/PDF enrichment、UI/Scheduler/Multi-Agent。
- 已有 ProfileStore 与首次画像构建是唯一沿用的持久状态路径；推荐不会自动刷新缓存画像或从当前 focus 修改长期偏好。

#### Known Issues

- Zotero host smoke：**not executed**。环境 PATH、常规系统位置没有 Zotero 可执行程序；research_profile_get / research_candidate_discover / research_recommend 未进行真实宿主、重启或 group UI 验证。Node SQLite/fake provider 集成不能替代 Zotero.DB 宿主验收。
- Live OpenAlex / live embedding smoke：**not executed**。本轮采用 fake literature/fetch/embedding，无真实 API 验证；生产召回仍沿用 Phase 3 OpenAlex-only 及其元数据/DOI 限制。
- 分数和 lambda 为未校准工程默认；词组包含、token 覆盖和 Jaccard 不处理同义词、词形和跨语言语义，semantic 可用时可改善但尚未测量真实质量/延迟。
- 全无 index 的 embedding provider 按其响应顺序对齐（旧客户端合同）；无法从无索引向量反推远端语义错序。fake 测试验证了显式 index 排序与非法索引拒绝。
- Profile 缓存手动刷新、无增量失效/跨设备身份；已有上游 pending 测试继续保留。架构基线与用户原始需求的已有 Prettier 格式告警保留：不整篇重写架构、不改写需求原文；代码与开发日志格式检查通过。

#### Deferred Work

Phase 5 统一实现推荐曝光持久化、positive/negative/save/skip append-only 反馈、曝光/候选/画像版本完整性、事务与幂等规则、ProfileUpdater 和新画像版本。真实宿主/live provider 质量与延迟测量后再决定向量/候选缓存；推荐 PDF/RAG、UI/Skill/Scheduler、离线 ranking evaluation 留到对应阶段。

#### Next Recommended Step

先在真实 Zotero 中验证已有画像、无 embedding、有效 embedding、取消以及 group library 下的 research_recommend；确认 scope、排序解释和结果显示。随后设计 Phase 5 Impression + Feedback + Profile Update 的完整闭环及事务边界。

### 2026-09-09 / recommendation-phase3-candidate-discovery

#### Goal

完成 ResearchProfile → Multi-route Candidate Discovery → Novel Candidate Pool。只决定哪些论文进入候选池，个性化排序留到 Phase 4。

#### Git Baseline

- Branch：`main`；starting commit：`279ccc62d959a52a518dff7a812c3a1856d1966b`（`phase-2`）；ending commit 由 `phase-3^{commit}` 标识；upstream 固定基线不变。
- 初次交付保留为本地代码、测试及日志更新。2026-09-09 用户明确要求“提交上传到远程仓库”，本次执行阶段 Git 交付：提交 `feat(recommendation): add personalized candidate discovery`、带注释标签 `phase-3`，上传个人仓库 `origin/main` 和同名标签；不修改 upstream 或历史标签。推送后核对远端分支与标签实际 commit。
- 原有分析目录、分析报告和阶段需求文档保持原样；本次提交纳入 `doc/codex_phase3_candidate_discovery_prompt.md`，独立分析目录/报告不纳入。未修改依赖、插件名称或 addon ID；构建产物 XPI 不上传为源码或 Release。
- 本次上传前未再修改代码，沿用已完成的 4350 passing / 1 pending、typecheck、build 验收；仅更新 Git 交接记录并检查格式与 staged diff。

#### Files Changed

| 文件                                                                          | 用途                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `src/recommendation/candidate/contracts.ts`                                   | 纯外部文献接口、发现输入输出与诊断                      |
| `src/recommendation/candidate/config.ts`                                      | 集中 recall / pool / Tool 输出上限                      |
| `src/recommendation/candidate/queryRecall.ts`                                 | weight×confidence 规划、负主题排除、focus 与 query 去重 |
| `src/recommendation/candidate/seedRecall.ts`                                  | 当前库 DOI 种子映射、代表论文顺序和跳过诊断             |
| `src/recommendation/candidate/identity.ts`                                    | DOI/arXiv/OpenAlex/保守书目身份、冲突检查               |
| `src/recommendation/candidate/normalize.ts`                                   | 不可信外部行标准化和来源构建                            |
| `src/recommendation/candidate/deduplicate.ts`                                 | 全库 novelty index、跨路合并、稳定池截断                |
| `src/recommendation/candidate/candidateService.ts`                            | scope 校验、有界调度、取消、部分失败与最终 guard        |
| `src/recommendation/domain/candidate.ts`                                      | 必需 provenance，可选 sourceUrl/openAccessUrl           |
| `src/recommendation/domain/validation.ts`                                     | 路由专属 provenance 校验及 sources/seedPaperIds 一致性  |
| `src/recommendation/profile/contracts.ts`、`librarySource.ts`                 | 增加/映射可选 DOI，空值为 undefined                     |
| `src/agent/services/recommendationLiteratureSource.ts`                        | 当前 context 的 OpenAlex service adapter                |
| `src/agent/services/literatureSearchService.ts`                               | 导出现有类型、OpenAlex 请求传递 AbortSignal；保留原 API |
| `src/agent/tools/recommendation/researchCandidateDiscover.ts`                 | 本地 Agent Tool、参数校验与有界摘要                     |
| `src/agent/tools/recommendation/shared.ts`、`researchProfileGet.ts`           | 小型 scope/extractor helper 复用                        |
| `src/agent/tools/index.ts`                                                    | 新 Tool 生产装配                                        |
| `test/recommendationCandidatePlanning.test.ts`                                | query/seed 规划测试                                     |
| `test/recommendationCandidateService.test.ts`                                 | 双路、失败、取消、并发、顺序、预算与诊断                |
| `test/recommendationCandidateIdentity.test.ts`                                | 身份、novelty、provenance、late bridge 与 DOI 不改画像  |
| `test/recommendationCandidateTool.test.ts`                                    | adapter、实际 fetch seam、Tool 暴露和 SQLite 集成切片   |
| `test/helpers/recommendationFixtures.ts`、`test/recommendationDomain.test.ts` | 既有 Candidate fixture 补来源                           |
| `test/toolSurfaceRefactor.test.ts`                                            | 更新本地模型可见 Tool 目录预期                          |
| `docs/research_agent_architecture_baseline.md`、`docs/development-log.md`     | Phase 3 已确定架构事实、验收与交接                      |

#### What Changed

实现完整持久画像和当前全库 snapshot 驱动的候选发现。适配层直接使用 LiteratureSearchService，不内部调用 Tool Registry，也不重新实现 OpenAlex client。外部结果先归一化，再排除全库已有论文，最后跨路合并；出站候选通过 assertRecommendationCandidate。

#### Architecture Decisions

- CandidateService 仅依赖推荐领域接口，不导入 Agent Runtime / AgentToolContext / DOM / ZoteroPane。Agent context 由 integration adapter 持有。
- ResearchPaperSignal DOI 只用于种子/库内身份；ProfileBuilder 不把 DOI 当兴趣信号，固定输入加 DOI 得到完全相同画像。
- 完整已存在画像直接加载，无自动 refresh；缺失画像复用 Phase 2 首建规则。focus 只进入当前 query plan，不保存到 profile 或版本。
- Candidate 增加必需 provenance；既有测试 fixture 同步更新。当前没有生产 Candidate/Impression 存储，因此不新增持久化迁移。
- 所有 CandidateScores 为 `{}`。Candidate Pool order is discovery order, not final personalized ranking.
- 去重中的迟到 identifier bridge 合并早先不同分组时，按原始发现位置重新合并 metadata/provenance，避免异步或分组合并顺序改变字段优先级。

#### Candidate Discovery Boundary

输入 scope 必须满足 profileId=`library:<libraryID>` 且 snapshot.libraryID 一致；snapshot 内重复/非法/异库论文身份或基础元数据损坏明确失败。计划中的缺失/异库 representative paper 计入跳过诊断。服务共享最多 3 个 worker；所有结果按计划顺序处理，而非网络完成顺序。

单 route 失败保留其余成功结果并返回紧凑 warning code 和成功/失败计数；全部已计划 route 失败则整体失败。成功但为空和无可用输入都返回空池，后者有明确警告。AbortSignal 传到 OpenAlex fetch；即使 fake dependency 不响应 signal，取消也能及时返回且不启动后续排队请求。无重试、无递归调用。

#### Recall Routes

| 边界                                              | 最终值                       |
| ------------------------------------------------- | ---------------------------- |
| maxQueries / resultsPerQuery                      | 5 / 12                       |
| maxSeeds / resultsPerSeed                         | 4 / 8                        |
| maxConcurrentRequests / maxCandidatePool          | 3 / 80                       |
| maxFocusChars                                     | 300，空白/超长/非法类型拒绝  |
| toolDefaultLimit / toolMaxLimit                   | 30 / 50                      |
| toolAbstractSnippetChars                          | 400                          |
| toolTitleChars / toolMaxAuthors / toolAuthorChars | 300 / 20 / 120，额外显示边界 |

主题按正有效 weight×confidence 降序，再按稳定 topic ID/label；显式负主题不参与 profile query。focus 第一条，最多再选 4 个主题。query 使用 NFC/trim/空白折叠/大小写归一比较，provenance 保留显示查询。

种子按 representativePapers 顺序选最多 4 个可用当前库 DOI；无 DOI 跳过，不用 title fallback。重复 representative item ID 不重复请求；不同 item ID 即使 DOI 相同仍保留各自种子 provenance，上限仍为 4。生产仅 OpenAlex search / recommendations related_works；每个 seed route 最多 DOI lookup + related batch 两次串行 HTTP，query 最多一次；逻辑最大 9 routes、13 HTTP、92 条原始返回预算。上游超量返回按单路 limit 处理并报告截断。

#### Identity / Dedup Policy

优先级 DOI → arXiv → OpenAlex → conservative bibliographic fallback。DOI 去 doi: 前缀/受信 doi.org URL、trim、小写；OpenAlex URL/W ID 归一为 W+数字；arXiv URL/ID 去版本号，同论文不同版本合并。未知 URL host 不作为强 ID。

书目 fallback 使用 NFC/大小写/空白归一的 exact title + year，或 exact title + first author；两个已知年份冲突时不合并。标题需至少 20 个字母/数字且至少 3 个词（长中日韩标题另有字符条件），短/泛化标题不凭标题合并；C/C++ 等标点仍保留，无 fuzzy/semantic matching。没有强 ID 和可靠书目键时用 deterministic `unresolved:<provenance>` occurrence ID，保留跨路歧义，不伪称同一论文。

重复来源按 route/provider/providerRank/query/topicId/focus 或 seedPaperId 去重；sources 和 seedPaperIds 从 provenance 派生并由 runtime guard 校验。强 ID 冲突阻止弱 ID/书目误合并。非空 metadata 优先、较完整 abstract 优先、其他冲突按稳定 discovery order；候选池截断不使用分数。

示例：同论文的 provenance 可同时含 `{route:"profile_query",provider:"openalex",providerRank:1,query:"Agents",topicId:"topic:agents"}` 和 `{route:"seed_recommendation",provider:"openalex",providerRank:2,seedPaperId:"library:1:item:8"}`。

#### Novelty Filter

从整个 eligible ResearchLibrarySnapshot 建 canonical DOI set 和保守书目索引，不只排除 representativePapers。优先 DOI exact match；缺少可比 DOI 时使用上述 exact 书目规则，有冲突 DOI 不仅凭标题排除。排除计数按 raw candidate occurrence，重复合并计数按剩余候选减少量，finalCandidateCount 为内部池大小。

#### Agent Tool

`research_candidate_discover({focus?:string,limit?:integer})`；禁止模型提供 libraryID/profileId/topics/seed IDs/provider URL。scope 复用 Phase 2 request/context helper；read、requiresConfirmation=false、exposure=model、localAgentOnly=true。

输出 profileId/profileVersion/generatedAt/focus、candidateCount、候选 metadata/标识符/sources/seedPaperIds/provenance、diagnostics 和 warnings。candidateCount 为实际 Tool 展示数量，diagnostics.finalCandidateCount 为内部池数量；截断返回 candidate_tool_output_truncated，无“低排名”含义。摘要/title/authors 有界，既有 profile_tool 不作为内部调用。普通聊天、Codex App Server、Claude Code、WebChat/MCP 未接入。

#### Tests

使用已有 Node v24.20.0，不安装依赖，不调用真实模型/API。PATH 为 `/home/linchengkai/new-project/.toolchains/node-v24.20.0-linux-x64/bin:$PATH`。

| 命令 / 检查                                                                                                                                                                                                                                                     | 结果                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                                                                                                                             | 通过；build 同样内置执行                                                                    |
| `node --import tsx node_modules/mocha/bin/mocha.js --require ./test/register.cjs 'test/recommendation*.test.ts' test/toolSurfaceRefactor.test.ts test/searchLiteratureOnlineTool.test.ts test/actionCompatibility.test.ts test/agentHitlReviewWorkflow.test.ts` | 190 passing；覆盖 Phase 1/2/3 与 generic literature regression                              |
| `npm run test:unit`                                                                                                                                                                                                                                             | 4350 passing、1 pending；比 Phase 2 新增 35 项，无新增失败                                  |
| `npm run build`                                                                                                                                                                                                                                                 | 通过；`.scaffold/build/llm-for-zotero.xpi`                                                  |
| `node node_modules/typescript/bin/tsc --noEmit -p /tmp/phase3-tsconfig.json`                                                                                                                                                                                    | 通过，额外覆盖 recommendation 系列测试及其 imports；既有 toolSurfaceRefactor 只做运行时回归 |
| `eslint <本轮 TS 文件>` / `prettier --check <本轮 TS 文件> docs/development-log.md`                                                                                                                                                                             | 通过                                                                                        |
| `npm run check:cycles` / `git diff --check`                                                                                                                                                                                                                     | 通过                                                                                        |
| Phase 2 Zotero host smoke（personal first build/cached load/refresh、重启 reload、group scope）                                                                                                                                                                 | not executed；环境未找到 Zotero 可执行文件，且无 DISPLAY/WAYLAND_DISPLAY                    |
| Live OpenAlex smoke                                                                                                                                                                                                                                             | not executed；query=0、seed=0，raw/final count 不适用；本轮不访问真实 provider              |

测试与构建首次在沙箱内分别因 tsx IPC `EPERM` / registry DNS `EAI_AGAIN` 失败；经环境权限审查后在沙箱外运行标准命令通过。focused 使用 `node --import tsx` 可在沙箱内运行同一 Mocha 测试集合。首次整合修复了 test SQLite seam 注入需工厂函数、fetch seam 缺少 gateway stub，以及 guard 的 unknown 类型断言；不是隐藏跳过失败用例。最终额外类型检查还修复了集中 focus 默认值推断为字面量 300 的类型问题及测试 helper 的 provenance 联合类型。曾并行运行全量测试/tsc/build 时，既有 importCycles 单测触发 2 秒超时；独立 cycles 检查通过，最后串行重跑标准全量测试。

新集成测试从 LibraryIndex fixture 经实际 IndexedResearchLibrarySource / ProfileBuilder / SqliteProfileStore / ProfileService 到 fake literature source、CandidateDiscoveryService、Tool，验证完整画像第 25 个主题被使用、两路召回、非代表论文库内排除、provenance、输出截断、signal 和 profile revision 不变。SQLite seam 是 Node 的真实 SQLite 引擎，但不能替代 Zotero.DB 宿主验收。

#### Architecture Red-Line Review

- [x] Phase 2 Profile Memory 可独立工作，DOI 不改变 topic scoring。
- [x] Candidate domain 不依赖 Agent Runtime/UI；复用 LiteratureSearchService，无重复 client。
- [x] 双路召回、无 keyword 伪 seed、完整 provenance/runtime guard、全库 novelty、集中 identity/deterministic dedup。
- [x] 部分失败可返回成功候选；并发有界；signal 传递且取消停止排队。
- [x] scores 为空；无 personalized ranking/MMR/CandidateSet 持久化。
- [x] 无 query LLM、批量 PDF/RAG、推荐 UI、Scheduler、反馈学习或项目运行时 Multi-Agent。
- [x] Profile 仍独立持久化，不写入 conversationMemory；LLM 结构校验边界不变。
- [x] Tool 仅本地 Agent，无 Zotero 内容写入或绕过 Action Contract/Change Journal。
- [x] generic literature regression、日志及架构更新完成。

#### Known Issues

- 真实 Zotero 宿主/重启/group UI、实时 OpenAlex smoke 未执行；不能据自动化 seam 声称宿主或 live API 已验收。
- OpenAlex-only 生产召回；无 DOI 种子跳过；没有 fuzzy dedup 或 freshness filter。保守书目键不保证识别所有同名/变名或元数据不足的论文。
- 额外严格检查若包含既有 `test/toolSurfaceRefactor.test.ts`，会出现其旧 request/IOUtils fixture 类型错误；已取 HEAD 原文在相同上下文独立复现。这些历史问题不属于主 tsconfig 检查范围，本轮只更新其 Tool 目录字符串，运行时回归通过。推荐系列测试额外严格检查通过。
- 上游已有 1 项 pending（DeepSeek Chrome 102 DOM selector 测试）未修改。构建已有 NODE_TLS_REJECT_UNAUTHORIZED=0 警告，本轮未设置该环境值或升级 scaffold。
- 已存在 LiteratureSearchService 会预先过滤当前活动论文并限制部分 provider abstract；providerRank 表示该 service 返回序列的位置，不声称完整原始远端排名。

#### Deferred Work

Phase 4 ranking/features/MMR；freshness recall filter、更多 provider、无 DOI seed 的可靠标识符解析、跨设备身份、反馈/曝光持久化、推荐证据 Top-K enrichment、UI/Skill/Scheduler、运行时多 Agent。Phase 3 by design 不持久化 CandidateSet，无 CandidateSetStore/TTL/SQLite candidate 表。

#### Next Recommended Step

先补真实 Zotero smoke，再从 CandidateDiscoveryService 的完整候选/provenance 接入独立 Phase 4 Feature Computation → Personalized Ranker → MMR → Top-K → research_recommend。本阶段未开始实现这些步骤。

### 2026-09-07 / recommendation-phase2-profile-memory

#### Goal

实现可以离线确定性构建、按 Zotero library 持久保存、由插件 Agent 获取的科研兴趣画像，完成 Phase 2 的长期偏好记忆技术切片。

#### Git Baseline

- Repository：`https://github.com/ck-alpha/zotero-research-agent`；branch：`main`。
- Starting commit：`10ed87677bc2afdfe17ede174f80f23834fdc500`；ending commit 由 `phase-2^{commit}` 标识；upstream baseline：`5be02f51a9bdf9b143439c95eed07bd62a34cb68`。
- 初次交付按 Phase 2 需求第 33 节保留为待提交工作区。2026-09-07 用户明确要求提交到 GitHub，本次执行阶段 Git 交付：单次提交 `feat(recommendation): add research profile memory`、带注释标签 `phase-2`，向个人仓库 `origin/main` 及同名阶段标签推送；不修改 upstream 或历史标签。推送前已确认远端 main 与 starting commit 一致且不存在 phase-2 标签；推送后核对远端分支及标签实际 commit。
- 开始时已有未跟踪文件：`doc/analysis/`、`doc/codex_phase2_research_profile_memory_prompt.md`、`doc/仓库技术与产品分析报告_2026-09-07.md`。保持原内容；需求文档属于阶段提交相关材料，分析目录和报告不要无差别加入提交。

#### Files Changed

| 文件                                                   | 用途                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `src/recommendation/domain/recommendation.ts`          | Impression 增加必需 profileId                                     |
| `src/recommendation/domain/validation.ts`              | Impression profileId 校验；复用显式偏好结构 guard                 |
| `src/recommendation/profile/contracts.ts`              | 独立论文信号、LibrarySource、TopicExtractor 合同                  |
| `src/recommendation/profile/identity.ts`               | 严格 library ID 与本地论文身份映射                                |
| `src/recommendation/profile/librarySource.ts`          | 复用 LibraryIndex，过滤和分离元数据及 collection path             |
| `src/recommendation/profile/topicNormalization.ts`     | Unicode/大小写/空白归一化、稳定排序、topic/evidence ID 与证据选择 |
| `src/recommendation/profile/topicExtractor.ts`         | 集中 LLM 上限、严格 JSON/topic/supporting ID 校验                 |
| `src/recommendation/profile/utilityTopicExtractor.ts`  | 包装 callUtilityLLM 的批量提取适配器                              |
| `src/recommendation/profile/profileScoring.ts`         | 半衰期、独立 weight/confidence、代表论文评分和集中配置            |
| `src/recommendation/profile/profileBuilder.ts`         | 纯确定性聚合、显式偏好约束、证据及画像快照                        |
| `src/recommendation/profile/profileUpdater.ts`         | 显式偏好替换前的结构、身份、时间戳校验与副本隔离                  |
| `src/recommendation/profile/profileService.ts`         | 画像生命周期、可选提取/回退、取消、CAS 保存及偏好更新             |
| `src/recommendation/profile/profileStore.ts`           | Zotero.DB / SQLite 生产持久化、schema 和 CAS                      |
| `src/recommendation/profile/production.ts`             | 最小生产依赖装配，DB 按需初始化                                   |
| `src/agent/tools/recommendation/researchProfileGet.ts` | 插件 Agent 读取 Tool、scope 和输出上限                            |
| `src/agent/tools/index.ts`                             | 新 Tool 注册；仅 5 行装配改动                                     |
| `test/helpers/recommendationFixtures.ts`               | 既有 Impression 样本增加 profileId                                |
| `test/helpers/researchProfileFixtures.ts`              | 固定时间、论文信号和 LibraryIndex 测试样本                        |
| `test/helpers/researchProfileDb.ts`                    | 使用 Node 内置 SQLite 执行真实 SQL 的异步 DB 测试 seam            |
| `test/recommendationDomain.test.ts`                    | Impression profileId 有效/无效校验                                |
| `test/recommendationStores.test.ts`                    | 验证曝光快照保存 profileId                                        |
| `test/recommendationProfile.test.ts`                   | 纯画像、过滤、评分、偏好、证据与代表论文测试                      |
| `test/recommendationProfileService.test.ts`            | 生命周期、冲突、提取失败回退、取消及状态移除测试                  |
| `test/recommendationProfileStore.test.ts`              | 真实 SQLite 初始化、CAS、隔离、损坏、回滚和磁盘重开测试           |
| `test/recommendationProfileTool.test.ts`               | Tool scope / 暴露 / 输出 / 无写确认及端到端切片                   |
| `test/recommendationTopicExtractor.test.ts`            | 严格解析、伪造 ID、批次边界、调用预算与失败测试                   |
| `test/toolSurfaceRefactor.test.ts`                     | 更新插件 Agent 模型可见工具目录预期                               |
| `docs/research_agent_architecture_baseline.md`         | 仅补充 Phase 2 已决定边界及 Impression profileId                  |
| `docs/development-log.md`                              | 本次连续开发记录与交接                                            |

此次 Git 阶段交付额外纳入 `doc/codex_phase2_research_profile_memory_prompt.md`（用户原始需求文档，内容保持原样），合计 30 个阶段文件。提交前代码未再变更，沿用下方已完成的 4315 passing / 1 pending、typecheck、build 验收结果；本次仅更新 Git 交接状态并重跑日志格式和 staged diff 检查。原始 Phase 2 需求文档第 67 行含 Markdown 有意的双空格换行，完整 staged diff --check 会将其报告为 trailing whitespace；为原样归档用户需求，保留该行，并确认排除此原始文档后的全部阶段 diff 检查通过。

#### What Changed

实际链路：

```text
LibraryIndexService.getSnapshot(libraryID)
→ IndexedResearchLibrarySource
→ ResearchPaperSignal[]
→ 人工标签 / collection 路径 + 可选已验证 Utility LLM topic evidence
→ ProfileBuilder → ProfileScoring / TimeDecay / RepresentativePaper
→ assertResearchProfile
→ SqliteProfileStore（独立 Zotero.DB 表）
→ research_profile_get → 插件 Agent 结构化画像摘要
```

原有 Phase 1 内存测试 Store 保留。未把长期画像接入 conversationMemory，也没有新建设置系统、SDK、外部模型 client 或数据库依赖。

#### Architecture Decisions

1. **作用域与身份**：每库一个 `library:<libraryID>`，库 ID 必须为正安全整数。输入优先采用 Agent request.libraryID，缺省时依次采用当前 context.item / request.item 的 libraryID 或已解析 turnPaperScope.libraryID；显式无效 ID 明确失败，不使用其他库代替。论文身份统一为 `library:<libraryID>:item:<itemID>`；依赖本机数字 ID，跨设备 portability 延后。
2. **持久化**：表名 `llm_for_zotero_research_profiles`；五列 `profile_id TEXT PRIMARY KEY NOT NULL`、`version INTEGER`、`schema_version INTEGER`、`profile_json TEXT`、`updated_at INTEGER`。schema 固定 v1，与 profile revision 独立；未来 schema 明确拒绝读写，迁移实现留到首次实际 schema 变更。每次写入在首次 await 前校验并序列化分离副本；读取再次校验并核对 JSON 与列的 ID/version/timestamp。
3. **CAS**：同一 Zotero.DB 事务内读取校验版本，创建采用 INSERT OR IGNORE、更新采用 WHERE profile_id/version/schema_version 条件写入，再用 SELECT changes() 确认恰好一行。创建仅 version 1；更新只能 N→N+1。损坏行不静默覆盖；冲突抛出 ProfileVersionConflict，Service 不自动重跑提取或隐藏重试。
4. **原始信号**：仅纳入所请求库的 regular、deleted=false、非空字符串 title。排除 notes / standalone attachments / deleted / 异库记录。缺失或非法时间归一为 0（未知而非最近），modifiedAt 保留但不当作兴趣刷新；回退按 addedAt 衰减，避免修改书目信息制造新兴趣。LibraryIndex 自带的展示标题回退保持既有语义。
5. **主题身份与证据**：NFC、trim、空白折叠、非 locale 小写；保留标点/重音，C、C++、C# 不合并。label 最长 160 字符，拒绝不可见控制/格式/代理字符或无字母数字的标签。主题 ID 从 normalized key 生成；paper/tag/collection/preference/llm refs 统一 URI 编码。先保留一条论文引用和来源/偏好引用，再补其他论文，保证默认 Tool 截断后仍有解释依据。
6. **确定性评分**：`decay = 2^(-max(0, now-addedAt)/86400000/180)`；half-life 可配置。单个主题对每篇论文只使用最高质量证据：manual tag=1，collection=0.65，LLM=0.45×经验证的模型 confidence；自动标签暂不计分。令 S=Σ(quality×decay)、Q=Σquality，则 inferred=0.75×(1-exp(-S/3))，weight=clamp(max(inferred, positiveStrength)×(1-negativeStrength))，confidence=clamp(max(1-exp(-Q/2), positiveStrength, negativeStrength))。置信度基于证据支持，强度基于近期兴趣；两者独立。正/负偏好不衰减，同主题负偏好优先，始终分开存储。
7. **代表论文**：使用当前主题的最高 weight×paper quality 作为 relevance，score=0.3×recency+0.7×relevance；按 score、addedAt、itemId 稳定排序，默认最多 12 篇。reason 优先 explicit_positive，其次在 relevance 项超过 recency 项时 high_topic_relevance，否则 recent；saved_from_recommendation 本阶段不用。
8. **边界上限**：完整画像最多 40 主题、每主题 12 条 evidenceRefs、12 代表论文；显式偏好每极性最多 100 条，禁止同极性重复 normalized label 或跨列表重复 preference ID。全部新记录由 guard 和确定性逻辑控制。
9. **刷新与版本**：首次读取缺失画像构建 version 1；缓存读取不调用 LibrarySource / Extractor；显式 refresh 重建并加一。偏好更新采用经过校验的完整替换，再从当前库完整重建并仅保存一个新版本。此处主动选择完整重建语义，所以 generatedAt 和 updatedAt 均为新重建时间，而非推荐示例的“仅偏好更新时间”；这样不会留下旧偏好造成的主题分数/代表论文，也无需从裁剪后的快照反推原始分数。无调度器、自动过期检测或增量画像失效。
10. **反馈/Embedding**：缓存读取原样保留有效旧快照；完整重建仅使用本阶段输入，反馈计数归零、feedback-derived topics 和 embedding 不继承，若旧画像含这些状态则明确返回警告。相关限制已测试。不会伪造反馈事件或计算 embedding。
11. **Impression 合同修正**：增加必需 profileId，并同步运行时 guard、fixture、领域/Store 测试和架构基线；仍不实现生产曝光/反馈流水线。

#### LLM Boundary

- 仅 `UtilityTopicExtractor` 调用已有 `callUtilityLLM`，从当前 Agent 请求传递 model/apiBase/apiKey/authMode/providerProtocol/profileOverride/signal，不读写新模型设置。
- 选择最近最多 48 篇，每批 12 篇，单批最多 8 主题，总计最多 24 主题；最多 4 个顺序请求，达到总主题上限则提前结束。title 截断至 300 字符、abstract 900 字符。每次 JSON 预算 1200 tokens、timeout 8000ms、temperature 0；沿用 utility 的 provider-safe reasoning reserve。服务再以 35000ms 总期限保护包括注入 extractor 在内的调用。
- 严格接受 `{"topics":[{"label":"…","confidence":0.8,"supportingPaperIds":["exact input item ID"]}]}`，拒绝额外字段、无支持论文、批外/未知 ID、越界 confidence、非法标签和超限响应。单响应最多 24000 字符；不尝试从任意散文/代码围栏中猜测 JSON。
- 元数据以 JSON 数据发出，system message 明确禁止执行其中指令。输入仅元数据/摘要，不发送 PDF 全文、显式偏好或整个库。原始 prompt/response/provider error 不进入 ProfileStore 或 Tool 输出。
- 非法/失败批次停止后续调用；此前成功校验的批次可保留。完全不可用或 Service 验证/总超时失败则只使用确定性输入；返回简短 warning code，仍持久保存有效画像。取消用户请求时不保存新画像。
- Utility LLM 提供标签及支持关系，不能给最终 interest weight、profile version、偏好或持久 ID。归一化、合并、时间衰减、分数、代表论文、版本和保存都由代码决定。相同 signals / validated extraction / preferences / now 得到相同快照；不同模型调用的提取结果本身不保证相同。

#### Agent Tool

- `research_profile_get({ refresh?: boolean })`；不允许模型提交 libraryID 或 profileId。
- 返回 profileId/version/status、topics（含 label/weight/confidence/sources/evidenceRefs）、representativePapers、explicitPreferences、signalSummary、generatedAt/updatedAt、warnings。
- 工具摘要最多 20 主题、每主题 6 引用、10 代表论文、每极性 20 显式偏好；label/title 字符上限为 160/300。被截断时返回 `profile_tool_output_truncated`；完整状态仍在 Store，后续决策服务应直接读取完整画像。
- `loaded / built / rebuilt` 区分缓存、初建和重建。Tool 不编排状态生命周期，只转发到 Service；没有 Action 或 Change Journal 写入职责。
- 暴露矩阵见 Current Architecture Status；现有 registry 通过 localAgentOnly 从 public/外部目录中过滤，Tool 还拒绝 codex_app_server、webchat、web_sync 请求。

#### Tests

使用已有 Node v24.20.0 工具链（与 `.github/workflows/quality.yml` / release.yml 一致），无依赖安装/升级，无真实模型/API 调用。

```sh
export PATH=/home/linchengkai/new-project/.toolchains/node-v24.20.0-linux-x64/bin:$PATH
```

| 命令 / 检查                                                                                                                             | 是否执行 | 最终结果                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                     | 是       | 通过；构建也再次执行内置 typecheck                                                                                                |
| `npx tsx node_modules/mocha/bin/mocha.js --require ./test/register.cjs 'test/recommendation*.test.ts' test/toolSurfaceRefactor.test.ts` | 是       | 137 passing（208ms）；其中 recommendation 系列 84 项、既有 semantic surface 53 项                                                 |
| `npm run test:unit`                                                                                                                     | 是       | 4315 passing、1 pending（38s）；比 Phase 1 的 4255 passing 新增 60 项，无新增失败                                                 |
| `npm run build`                                                                                                                         | 是       | 通过；产物 `.scaffold/build/llm-for-zotero.xpi`，打包及内置 typecheck 成功                                                        |
| `npx eslint <本轮全部新增/修改 TS 文件>`                                                                                                | 是       | 通过，含新 profile 目录、Tool、注册、全部相关测试和 helper                                                                        |
| `npx prettier --check <本轮 TS 文件> docs/development-log.md`                                                                           | 是       | 通过；仅对本轮代码和日志执行格式化                                                                                                |
| `npx prettier --check docs/research_agent_architecture_baseline.md`                                                                     | 是       | 未通过：HEAD 原文已有格式问题，已用相同配置对原文 programmatic prettier.format 验证；本轮只追加有关段落及字段，不顺带重排整篇基线 |
| `node node_modules/typescript/bin/tsc --noEmit -p /tmp/recommendation-phase2-tsconfig.json`                                             | 是       | 通过，额外严格检查 recommendation 测试及其 imports；主 tsconfig 不包含 test                                                       |
| `npm run check:cycles`                                                                                                                  | 是       | 通过：0 runtime cycles、0 static allowlisted cycles                                                                               |
| `git diff --check`                                                                                                                      | 是       | 通过                                                                                                                              |
| `npm run test:workflow` / live-agent / live-model                                                                                       | 否       | 当前没有运行真实 Zotero 工作流；不将 SQLite seam 当成宿主验收                                                                     |

首次全量回归结果为 4313 passing、1 pending、1 failing：唯一失败来自 semantic tool surface 仍期待旧目录，已同步新增工具预期。之后补充了忽略 abort 的 stalled extractor 取消测试并全部重跑，最终结果如上。额外测试类型检查的初版临时 tsconfig 遇到继承 composite 和从 /tmp 解析类型路径的问题，调整为 composite:false 和明确的 Zotero/Node/Mocha 类型入口后通过；未更改项目 tsconfig。

SQLite 测试真实执行 DDL、事务、条件 SQL、JSON 往返、同版本竞争、schema 独立性、损坏行拒绝、失败回滚及磁盘文件关闭/重开。端到端测试使用 LibraryIndex snapshot fixture → 实际 Source/Builder/Service/生产 Store → Registry Tool，无模型、无 Zotero 内容写操作。

复现额外测试类型检查：临时配置 extends 仓库 tsconfig，include 为绝对路径的 typings 和 test/recommendation\*.test.ts，compilerOptions.composite=false，types 为绝对路径的 node_modules/zotero-types/entries/sandbox、node_modules/@types/node、node_modules/@types/mocha。临时文件本身不是交付物。

#### Architecture Red-Line Review

- [x] Recommendation Domain 不依赖 Zotero UI；Builder、Scoring、Updater、Service 不导入 Agent Runtime。
- [x] 不实现 Ranking，算法不调用 Agent Runtime。
- [x] ResearchProfile 使用独立 SQLite 表，与 conversationMemory 分离。
- [x] LLM 输出经过结构/证据验证和确定性更新才能成为持久状态。
- [x] 无 Zotero 内容写操作；Tool 为 read，无绕过 Action Contract / Change Journal 的操作。
- [x] 无配置 Utility LLM 时仍能成功构建画像；失败回退已测试。
- [x] Scoring 公式和常量集中；固定 now 测试；生产 Store 事务 CAS；每库一个画像；Tool scope 来自上下文。
- [x] 未新增 Candidate Discovery / Ranking / MMR / Profile Embedding；开发日志已更新。
- [x] 全量单测、typecheck、build 和本轮代码/日志格式检查实际完成；架构基线已有格式问题与宿主未验证范围见 Tests / Known Issues。

#### Known Issues

- 既有架构基线 Markdown 未完全符合 Prettier；HEAD 原文也有相同问题，本轮保留局部内容修改，未做无关全文格式化。
- 原有 1 项 pending 保持：`webchat extension DOM contracts / keeps DeepSeek extraction compatible with Chrome 102 selector support`。
- 无真实 Zotero 进程/UI workflow 或 live-agent/model 验收；Node SQLite seam 验证真实 SQL、回滚和文件重开，不代表已经验证 Zotero.DB 宿主事务调度及插件重启生命周期。
- Node v24 内置 node:sqlite 输出 experimental 警告；仅为测试环境 seam，不进入生产 bundle，也没有新增 SQLite npm 依赖。
- 确定性回退精度依赖用户标签/collection 结构；只有 automatic tags 或标题的文献库可能得到空主题画像，但仍可包含近期代表论文。
- collection 完整路径作为主题可包含组织性文件夹名称；不做 NLP 清洗或语义等价合并。超长/非法标签被跳过。沿用 LibraryIndex 的展示标题回退，不另行读取 Zotero 原始字段。
- 显式偏好更新是完整重建，可能触发同样的有界模型调用；不保证保留上一次模型提取出的主题。缓存读取会一直返回已有画像，库内容变动须显式 refresh。
- 本机数字 item ID、库 ID 不保证跨设备身份一致；画像不自动同步、不保存修订历史。Embedding、生产反馈/曝光流水线均未实现。
- Tool 输出会有界裁剪；若警告提示截断，模型不得把摘要当成所有偏好的完整列表。未来召回/排序服务应读取完整快照。

#### Deferred Work

Phase 3：ResearchProfile → Profile Query Recall + Seed Paper Recall → Candidate Merge → Dedup → `research_candidate_discover`，优先复用既有 literature adapter；本轮没有实现这条链。
后续独立阶段：Ranking/MMR、反馈学习及生产 FeedbackStore/ImpressionStore、RAG 推荐证据、推荐 UI/Skill/Action、Scheduler/digest、Embedding/vector DB、增量画像失效、跨库/跨设备画像和 schema 迁移。

#### Next Recommended Step

先在真实 Zotero 中针对个人库和 group library 执行初建、缓存、refresh 与重启恢复的 smoke test，确认宿主 DB 与 Agent 请求 scope；随后按 Phase 3 需求实现候选发现。测试模型增强时复用用户现有 provider 配置，不依赖模型才能验收基础画像链路。

### 2026-09-06 / recommendation-phase0-phase1

#### Goal

确认固定源码基线，建立后续阶段可独立测试的推荐领域数据合同和存储边界，不提前实现推荐业务流程。

#### Files Changed

除 `.gitignore` 的日志跟踪例外外，全部为新增文件；无 upstream 业务源文件修改：

| 文件                                          | 用途                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`                                  | 将 `/docs/` 改为 `/docs/*` 并仅放行 `docs/development-log.md`，使日志可以随代码提交；其他设计笔记继续忽略。                                                 |
| `src/recommendation/domain/profile.ts`        | ResearchProfile、TopicInterest、InterestSource、PreferenceConstraint、ExplicitPreferences、RepresentativePaper、ProfileEmbeddingRef、ProfileSignalSummary。 |
| `src/recommendation/domain/candidate.ts`      | RecommendationCandidate、CandidateSource、CandidateScores。                                                                                                 |
| `src/recommendation/domain/evidence.ts`       | 最小 CandidateEvidence 引用合同。                                                                                                                           |
| `src/recommendation/domain/feedback.ts`       | RecommendationFeedback 和四种 FeedbackAction。                                                                                                              |
| `src/recommendation/domain/recommendation.ts` | RecommendedPaper 曝光快照与 RecommendationImpression。                                                                                                      |
| `src/recommendation/domain/stores.ts`         | 三个异步 Store 接口和 FeedbackQuery；记录版本、重复写入、读取隔离语义。                                                                                     |
| `src/recommendation/domain/validation.ts`     | 无外部依赖的运行时断言与字段路径错误。                                                                                                                      |
| `test/helpers/recommendationFixtures.ts`      | 独立、可序列化的领域测试样本。                                                                                                                              |
| `test/helpers/recommendationStores.ts`        | 三个内存 Store 测试替身，非生产持久化。                                                                                                                     |
| `test/recommendationDomain.test.ts`           | 17 项领域构造、校验、序列化测试。                                                                                                                           |
| `test/recommendationStores.test.ts`           | 7 项 Store 创建、更新、追加、查询、隔离与冲突测试。                                                                                                         |
| `docs/development-log.md`                     | 连续开发交接记录。                                                                                                                                          |

#### What Changed

- 画像分别保留兴趣强度 `weight` 和判断确定性 `confidence`；显式正负偏好保存在独立列表，`strength` 是无符号强度。
- Embedding 只保存模型、维度、存储引用与更新时间，不内嵌向量。
- Candidate 保留完整评分分项和两种召回来源。`CandidateEvidence` 仅保存不透明 `evidenceRefs`，不复制现有 RAG 类型或实现检索。
- RecommendedPaper 扩展 Candidate，增加一基 `rank`、`matchedTopicIds`，并要求 `scores.finalScore`，避免存储两个可能不一致的最终分数。Impression 保存展示时的完整候选快照与画像版本。
- Feedback `paperId` 指向同一 Impression 内的 `candidateId`；`save` 只是反馈事件语义，不执行 Zotero 导入。
- 测试内存 Store 在写入前校验，在写入和返回时使用 JSON 分离副本，防止调用方修改已有状态。

#### Architecture Decisions

1. **校验方式**：仓库使用手写 runtime validation（如 `src/modelCapabilities/registry.ts`、`src/agent/tools/shared.ts`），没有直接使用的通用 schema 库。本模块沿用轻量校验惯例，但不导入模型注册表或 Agent Tool，以保持领域边界独立；没有新增依赖。
2. **数据约束**：版本与 embedding 维度为正安全整数；时间戳为非负安全整数 Unix 毫秒；计数为非负安全整数；`weight` / `confidence` / `strength` 为有限 `[0, 1]` 数值；ID、来源枚举、必需字符串和嵌套结构均校验。错误抛出带字段路径的 `TypeError`，不自动修复或转换输入。
3. **分数**：各评分分项只要求有限数值，允许负反馈分和未归一化 lexical 分；归一化与公式留给后续排序阶段。未评分 Candidate 可以使用空 `scores`，展示快照必须有最终分数。
4. **JSON 合同**：接受普通对象及无原型记录；可选字段允许缺失或 `undefined`（JSON 往返后被省略）；拒绝未知字段、稀疏数组和非法数值，不静默持久化额外向量。新增字段时应同时更新类型、校验和测试。来源数组至少有一个合法值；未知作者、空画像和空曝光列表允许存在。
5. **ProfileStore**：`load(profileId)` / `save(profile, expectedVersion)`；保存使用原子 compare-and-swap 合同。`null` 仅创建不存在的 version 1；更新要求已有版本等于 expectedVersion，且新版本严格加一。旧版本不覆盖，Store 仅保留最新快照，不实现历史归档。后续数据库适配器必须用事务或条件更新保证同样语义。
6. **FeedbackStore**：只开放 `append` / `list`，无更新或删除方法；重复 eventId（包括完全相同的重试）拒绝。读取按追加顺序，不按时间戳重排；可按 paperId、recommendationId 过滤，两个条件同时存在时取交集。
7. **ImpressionStore**：`save` 仅创建，重复 recommendationId 拒绝；`load` 返回快照或 null。一个曝光内 candidateId 与 rank 不得重复，这只是曝光一致性校验，不实现 Candidate Dedup。rank 不依赖数组位置，不要求连续。
8. **实现状态**：生产目录只有接口与 Domain guards；concrete in-memory implementations 全在 `test/helpers`，仅为测试替身，不是数据库实现，也未接入插件。
9. **五条架构红线审查**：① Domain 只有内部 type imports，不依赖 Zotero UI；②未实现 Ranking 或调用 Agent Runtime；③未接入 conversationMemory；④无 LLM 调用或模型状态写入，写入合同要求结构校验，业务 deterministic update 留待 Phase 2；⑤无 Zotero 写操作，不涉及绕过 Tool Registry / Action Contract / Change Journal。

#### Tests

环境：已有依赖，无安装或升级；Node `v24.20.0` 来自工作区工具链。复现前设置：

```sh
export PATH=/home/linchengkai/new-project/.toolchains/node-v24.20.0-linux-x64/bin:$PATH
```

修改前 Phase 0：

| 命令                                                                      | 是否执行 | 结果与分类                                                                                                                                  |
| ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `git rev-parse HEAD` / `git branch --show-current` / `git status --short` | 是       | commit、branch 和原工作区状态如上。                                                                                                         |
| `npm run typecheck`                                                       | 是       | 初次因 PATH 缺 npm 退出 127（环境问题）；启用已有工具链后通过。                                                                             |
| `npm run test:unit`                                                       | 是       | 初次缺 npm；启用工具链后沙箱禁止 tsx 本地 IPC（`listen EPERM /tmp/tsx-0/*.pipe`）。经授权在沙箱外重跑通过：4231 passing、1 pending（37s）。 |
| `npm run build`                                                           | 是       | 沙箱内访问 registry.npmjs.org 出现 EAI_AGAIN（环境限制）；经授权在沙箱外重跑成功，含内置 typecheck。                                        |

修改后：

| 命令                                                                                                                                                                                                                      | 是否执行 | 结果                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `npm run typecheck`                                                                                                                                                                                                       | 是       | 通过。                                                                         |
| `npx tsx node_modules/mocha/bin/mocha.js --require ./test/register.cjs 'test/recommendation*.test.ts'`                                                                                                                    | 是       | 24 passing（21ms），沙箱外运行；不访问真实模型/API。                           |
| `node node_modules/eslint/bin/eslint.js src/recommendation/domain test/recommendationDomain.test.ts test/recommendationStores.test.ts test/helpers/recommendationFixtures.ts test/helpers/recommendationStores.ts`        | 是       | 通过。                                                                         |
| `node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --types node,mocha test/recommendationDomain.test.ts test/recommendationStores.test.ts` | 是       | 通过；额外覆盖主 tsconfig 未包含的测试文件及其导入的整个 Domain。              |
| `npm run test:unit`                                                                                                                                                                                                       | 是       | 4255 passing、1 pending（37s），比基线增加 24 项通过，无新增失败；沙箱外执行。 |
| `npm run build`                                                                                                                                                                                                           | 是       | 通过，插件打包成功，内置 `npm run typecheck` 通过；沙箱外执行。                |

测试覆盖：独立 weight/confidence、正负 preference、评分分项、四种反馈、曝光版本与 rank/finalScore/主题、JSON 往返、嵌套非法 ID/数值/结构、未知字段、空初始状态；Store 创建/读取/版本递增、版本冲突、同版本竞争写入、画像间隔离、反馈追加/过滤/重复拒绝、曝光保存/读取、无效写入不改变已有状态、输入输出副本隔离。

另外实际执行并通过：

```sh
node node_modules/prettier/bin/prettier.cjs --check src/recommendation/domain test/recommendationDomain.test.ts test/recommendationStores.test.ts test/helpers/recommendationFixtures.ts test/helpers/recommendationStores.ts docs/development-log.md
git diff --check
```

格式化仅针对新增文件执行 `prettier --write`；没有运行会修改全仓库的 `lint:fix`。最终 working tree 为上述 13 个新增/修改交付文件，加上原有两份未跟踪需求文档，无其他已跟踪文件变更。

#### Known Issues

- 无观察到的 upstream 测试失败或本轮新增代码失败。基线已有 1 项 pending：`webchat extension DOM contracts / keeps DeepSeek extraction compatible with Chrome 102 selector support`，未修改或启用该测试。
- sandbox 中 tsx IPC 和 scaffold registry 网络访问受到限制；测试与构建的初始失败为环境限制，不是 upstream 或新增代码错误。
- 构建环境已有 `NODE_TLS_REJECT_UNAUTHORIZED=0`，Node 输出警告；本轮未设置或修改此环境值。scaffold 提示可升级，本轮未升级。
- 测试替身只模拟存储合同，不验证 SQLite 事务、数据库迁移、重启恢复或多进程并发；并发测试只验证内存替身的一次版本更新只有一个成功。
- 未运行 Zotero UI / workflow / live-agent 测试；本阶段未接入这些执行链。

#### Deferred Work

未实现 Phase 2+：ProfileBuilder、Topic Extraction / Normalization、Utility LLM、Profile Scoring / Updater / Service、Time Decay、Embedding 计算、生产数据库存储；查询扩展、Candidate Recall / Merge / Dedup、OpenAlex / arXiv 调用；Ranking、MMR、Feedback Learning；证据补全、Agent Tool / Skill / Action、UI、Scheduler、Local LLM、Vector DB、Multi-Agent、GraphRAG 和推荐评测。

#### Next Recommended Step

进入 Phase 2 前先确定画像作用域和论文身份映射；实现独立 ProfileStore 持久化适配器，复用本轮 Store 合同测试，再分步加入元数据输入适配器和可确定性重建的 ProfileBuilder / Scoring / Updater。显式偏好与反馈保留为独立输入，结构化模型输出必须校验后再由确定性业务代码更新快照。

## Open Decisions

- **Phase 4 score semantics（已决定）**：新生成特征/baseScore 为 `[0,1]`，finalScore 为可负 MMR 效用；feedback undefined；新增 preference/diversity 有界且保留旧 finite score 合同。
- **Phase 4 missing features（已决定）**：缺 semantic/recency 移出分母；显式负偏好通过归一化 relevance 之后的 compatibility 乘数作用。
- **Phase 4 embedding（已决定）**：既有专用 provider/config/client，32 条批次、30 秒截止、整体失败回退、请求内向量，不持久化 embedding。
- **Phase 4 MMR（已决定）**：完整池、lambda=0.80、语义 cosine 优先、token Jaccard fallback、固定 base tie-break。
- **Phase 4 recommendation persistence（已决定）**：本阶段无持久 recommendationId/ImpressionStore/FeedbackStore，Phase 5 统一引入曝光-反馈-画像闭环。

- **Phase 3 External Candidate Identity（已决定）**：DOI/arXiv/OpenAlex/保守书目；歧义项使用 provenance occurrence ID。详见本轮 Identity / Dedup Policy。
- **Phase 3 Novelty / Provenance（已决定）**：全 eligible library exact DOI/书目过滤；provenance 必需，派生 sources/seedPaperIds 并校验一致性；合并保留最早发现位置。
- **Phase 3 Recall / Failure（已决定）**：5×12 query、4×8 seed、3 并发、80 池；支持 partial success、整体 cancellation；所有依赖失败明确抛错。
- **Phase 3 Candidate Persistence（已决定）**：按设计不持久化 CandidateSet；未来如需 handle/cache 应先测量真实多步延迟。

- **画像作用域**：基线 Impression 只有 profileVersion，没有 profileId。第一版保留原字段，未来多画像/多 library 支持需要明确 scoped store 或加入 profileId；当前不能把不同画像的同版本曝光混合解释。 **Phase 2 已解决**：每个 library 一个画像，统一 library:<libraryID>；Impression 增加必需 profileId。
- **身份映射**：本轮保持 `itemId`、`paperId`、`candidateId` 为不透明字符串，不假定 Zotero 数字 ID 或 key 的映射。具体 libraryID/key、外部 DOI/arXiv/OpenAlex 规范化由未来适配器统一定义。 **Phase 2 MVP 已解决**：adapter 统一本地 library:<libraryID>:item:<itemID>。领域字段仍是不透明字符串；跨设备 Zotero key 和外部文献规范化继续待定。
- **跨 Store 一致性**：本轮只验证对象结构和单 Store 写入规则；不验证反馈是否存在对应曝光/候选、matchedTopicIds 是否存在于对应画像、signalSummary 是否和原始信号吻合。后续 Service/事务需定义这些规则。 **Phase 2 更新**：仅 ProfileStore 生产化；Service 从真实输入推导 signalSummary 并 CAS 保存。反馈/曝光关联事务和跨 Store 一致性仍留待 Phase 5。
- **业务合并规则**：相同主题同时有正负偏好时的优先级、重复 topic/preference 身份合并、信号聚合、时间戳先后关系、计数推导均留给确定性业务逻辑。 **Phase 2 已解决画像部分**：NFC/case/空白合并；一论文一主题只取最高质量；正负分离且负偏好优先；重复显式 ID/同极性主题拒绝；时间戳和计数由代码校验/推导。
- **schema 演进**：profile.version 是快照修订号，不能替代未来数据库 schemaVersion。当前严格拒绝未知字段；迁移与兼容读写策略待生产持久化阶段制定。 **Phase 2 已解决当前表示**：独立 schema_version=1，未知 schema 明确拒绝；首个迁移留待实际新增 schema，禁止用 profile.version 代替 schema version。
- **事件重试与历史**：当前重复 eventId 明确报错，快照不保留历史。后续是否增加幂等重试结果、历史版本、分页、跨 Store 事务及错误类型，按实际需求确定。 **Phase 2 更新**：画像 CAS 冲突明确失败，无自动重试和版本历史；反馈/曝光重试规则不变。
- **源码与基线冲突**：未发现职责边界冲突。架构文档路径与示例不同，已采用实际路径读取而不迁移原文。原 `.gitignore` 忽略整个 `docs/`，与交接日志必须随代码提交的要求冲突；采用最小例外，仅放行 `docs/development-log.md`。

- **stale profile refresh（Phase 2 已解决 MVP）**：已有画像默认持续加载，仅首次构建或显式 refresh 重建；后台刷新、增量失效、重建进度和耗时优化继续延后。
- **Utility LLM limits（Phase 2 已解决）**：48 papers / batch 12 / 8 topics per batch / 24 total / 8s per call / 35s total / 1200 JSON tokens，详见本轮 LLM Boundary；不新增 preferences 系统。

## Technical Debt

- Upstream：现有 1 项 pending 单测，非本阶段范围。
- 本轮：TypeScript 类型与手写校验结构需同步维护；新增字段应补充有效、无效输入测试。优先级中，尚不值得引入大型 schema 依赖。
- Phase 1 历史限制：当时尚无生产持久化。**Phase 2 已解决**，现有生产 SqliteProfileStore；测试内存实现仍只用于测试。

- Phase 2 新增，优先级中：本机数值 library/item 身份，无跨设备画像同步、无增量画像失效；缓存变更依赖手动 refresh。
- Phase 2 明确延后：无 embedding、无生产反馈/曝光流水线、无画像历史；后续需在 schema / 事务 / 版本设计下增量扩展。
- Phase 2 验收限制，优先级中：尚未在真实 Zotero.DB 宿主、插件重启和 group library UI 中 smoke test；Node SQLite seam 不能替代该验证。

## Handoff Notes

### Phase 5 当前交接（2026-09-09）

- 主入口 src/recommendation/feedback/service.ts；store/schema 位于 feedback/stores.ts，纯重放/更新独立可测；生产 ProfileService 已装配 replay。
- 全量 4423 passing / 1 pending，专项 256 passing；typecheck/build/cycles/lint/format 均通过。真实 Zotero smoke not executed。
- 反馈始终先落事件后 CAS，失败调用 reconcileProfileFeedback；不要删除事件或对已调整主题权重增量叠加。反馈工具的内部记忆作用域始终确认，不借用 Zotero journal/receipts。
- 本轮源码、测试、原样需求、架构与日志纳入阶段交付；用户分析材料、依赖和 XPI 构建产物不纳入。
- 下一步先做宿主验证，再开展推荐证据补全；save 尚不导入，UI/Digest/Scheduler 尚未实现。

### Phase 4 历史交接（2026-09-09）

- 纯排序入口 `src/recommendation/ranking/rankingService.ts`，生产工具 `src/agent/tools/recommendation/researchRecommend.ts`，embedding 接口只在 Agent services 接到既有 llmClient。
- 阶段实现提交/标签为 `743e0b81` / `phase-4`；用户已授权本轮提交和远端推送。另追加交付日志提交到 main，保留 phase-4 指向已验收的实现提交；目标仅为个人 origin。阶段需求原样纳入，用户分析文件不纳入。
- 参数和公式见本轮 Feature / Semantic / Base / Preference / MMR / Centralized Config；复现日志 `/tmp/phase4-{focused,unit,build,typecheck,test-types,lint,cycles}.log`，临时文件可丢失，以此记录为准。
- 真实 Zotero/OpenAlex/embedding smoke 仍为 not executed。下一阶段先补宿主验收，再设计反馈闭环；不将当前分数当作概率或已校准科研结论。

### Phase 3 当前交接（2026-09-09）

- 主服务 `src/recommendation/candidate/candidateService.ts`；Agent adapter 与 Tool 位于各自 integration 层。独立可测；上限集中 config.ts。
- 用户已授权本阶段提交和远端上传；阶段提交/标签为 `feat(recommendation): add personalized candidate discovery` / `phase-3`，目标为个人仓库 origin。代码、测试、阶段需求、架构和日志一并交付；独立用户分析材料保持原样且不纳入提交。
- 重点复现 candidate 系列 35 项新增测试；日志在 `/tmp/phase3-{focused,unit,build,test-types,lint}.log`，临时文件丢失时以本记录为准。
- Phase 2 宿主 smoke 仍未执行，不把自动化 SQLite seam 当作 Zotero.DB 验收。

### Phase 2 当前交接（2026-09-07）

- 首读本轮记录与架构基线；按需装配入口 `src/recommendation/profile/production.ts`，Tool 注册在 `src/agent/tools/index.ts`，不需要修改 AgentRuntime 或 UI 大文件。
- 纯算法入口为 `ProfileBuilder.build`，生命周期入口为 `ProfileService.get/rebuild/updateExplicitPreferences`；生产 Store 懒初始化，数据库异常必须返回失败，不能降级成仅内存保存。
- 固定时间 fixture、真实 SQLite seam 和 profile 专项测试都以 recommendationProfile / researchProfile 命名；原 Phase 1 test/helpers/recommendationStores.ts 保持不变。
- 重建会保留显式偏好，但重置不支持的反馈派生状态、移除 embedding 并报告警告。偏好替换本身触发全量重建，两个画像时间戳同时前进。
- 仅插件 Agent 得到新工具；其他后端没有本阶段能力。下一阶段复用完整 ProfileStore 快照，不能以 Tool 摘要代替完整正负偏好。
- 本轮临时验证日志：`/tmp/recommendation-phase2-{focused,test-types,format}.log`、`/tmp/recommendation-phase2-final-{typecheck,unit,build,lint}.log`；若清理，以本文件 Tests 表为准。
- 用户已明确授权本阶段 GitHub 提交和推送；阶段提交/标签为 `feat(recommendation): add research profile memory` / `phase-2`。此次包含实现、测试、架构基线、开发日志及原样保存的 Phase 2 需求文档；工作区中的独立分析目录/报告不包含在本阶段提交中。XPI 为 `.scaffold/build/llm-for-zotero.xpi` 构建产物，不纳入源码提交或此次 GitHub Release。下方原有阶段发布约定及 Phase 1 历史交接继续保留。

### Phase 1 历史交接

- 下一次开发先读实际架构基线、阶段要求和本日志；本次两个用户需求文档保持原样。
- 用户已要求每完成一个开发阶段创建 Git 提交并上传个人 GitHub 仓库。每次阶段交付必须包含代码、测试、对应需求和更新后的交接日志。
- Domain 入口按文件导入；没有加入插件生命周期、UI 或任何 Agent 后端。
- 临时验证日志位于 `/tmp/recommendation-baseline-{typecheck,unit,build}.log`、`/tmp/recommendation-final-{unit,build}.log`；临时文件可能被清理，以此交接文档记录为准。
- 后续数据库实现必须执行校验、快照隔离、反馈追加不可覆盖、曝光不可覆盖和原子版本比较，不得仅满足 TypeScript 方法签名。

### Git 阶段交付约定（2026-09-06 起）

- 在个人仓库上开发；`origin` 指向个人 GitHub 仓库，`upstream` 保留原作者 `https://github.com/yilewang/llm-for-zotero.git`。阶段提交不得误推原作者仓库。
- 每完成一个阶段，先运行该阶段必要的 typecheck、unit tests、build，并在本日志中记录真实结果、已知问题和延期内容。
- 检查 `git status` 和 diff，只暂存该阶段文件及相关文档；不使用无差别 `git add .`，不上传 `.env`、凭据、依赖、构建产物或无关本地笔记。
- 阶段完成后创建一次提交，例如 `feat(recommendation): complete phase 2 research profile memory`；Phase 0 与 Phase 1 属于本轮合并验收，使用一个提交。
- 为验收完成的提交创建带注释标签 `phase-1`、`phase-2` 等；如果标签已存在，先核实，不覆盖或强推。
- 使用 `git push origin main` 上传提交，并用 `git push origin phase-N` 单独上传阶段标签。首次推送设置 `git push -u origin main`。
- 推送后核对远端分支与标签的 commit，向用户报告提交短哈希、阶段标签和仓库链接；网络或认证失败时明确说明未上传成功。
- 如远端出现新提交，先检查差异，不强推、不丢弃任一方历史。
- 本次同步纳入用户已经完成的 `doc/pdf-figure-runtime-release.md` → `docs/pdf-figure-runtime-release.md` 移动（内容 SHA-256 一致），并跟踪移到 `docs/` 的架构基线；`.gitignore` 仅额外放行这两个指定文件。
