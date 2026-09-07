# Development Log

## Current Baseline

- Upstream commit: `5be02f51a9bdf9b143439c95eed07bd62a34cb68`（与架构基线一致）。
- Current branch: `main`；阶段提交按下方 Git 交接约定管理。
- Personal repository: `https://github.com/ck-alpha/zotero-research-agent`（私有；GitHub 仓库名称变更不修改插件名称或 addon ID）。
- Phase checkpoint: `phase-2`，对应本轮 Research Profile Memory 阶段提交；历史检查点 `phase-1` 保留。
- Current HEAD / Phase 2 commit：由带注释标签 `phase-2` 标识，可用 `git rev-parse phase-2^{commit}` 获取完整哈希；阶段起点为 `10ed87677bc2afdfe17ede174f80f23834fdc500`。提交内不记录自身哈希，避免自引用导致哈希失效。
- Current phase: Phase 2 — Research Profile Memory（实现与自动化验收完成，宿主 smoke test 待执行）。
- Last verified date: 2026-09-07 (UTC)。
- 修改前 working tree：仅 `doc/codex_phase0_phase1_prompt.md`、`doc/research_agent_architecture_baseline.md` 为用户已有的未跟踪文件；没有已跟踪文件修改。
- 实际架构基线位于 [docs/research_agent_architecture_baseline.md](research_agent_architecture_baseline.md)，阶段要求位于 [doc/codex_phase0_phase1_prompt.md](../doc/codex_phase0_phase1_prompt.md)。架构基线在 Phase 1 实现后由用户移至 `docs/`；本交接文档使用要求的 `docs/development-log.md` 路径。

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
- 尚未实现本项目的 Candidate Discovery / Merge / Dedup、Ranking / MMR、生产 FeedbackStore / ImpressionStore、推荐 UI / Scheduler / Skill / Action、推荐 RAG、Embedding、跨设备同步。

| 后端                                                    | Phase 2 支持状态                                      |
| ------------------------------------------------------- | ----------------------------------------------------- |
| 插件内 Agent Runtime（现有 provider-safe Utility 通路） | 支持 `research_profile_get`；画像核心可无模型独立运行 |
| 普通聊天                                                | 未接入                                                |
| Codex App Server                                        | 未接入；Tool 不在外部目录，authMode 可用性也拒绝      |
| Claude Code                                             | 未接入；Tool 不在外部目录                             |
| WebChat / web_sync                                      | 未接入；目录隔离及请求可用性拒绝                      |
| MCP / public tool catalog                               | 未暴露；沿用 `localAgentOnly` 过滤                    |

## Change History

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
