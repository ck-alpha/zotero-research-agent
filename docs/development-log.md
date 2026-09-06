# Development Log

## Current Baseline

- Upstream commit: `5be02f51a9bdf9b143439c95eed07bd62a34cb68`（与架构基线一致）。
- Current branch: `main`；阶段提交按下方 Git 交接约定管理。
- Personal repository: `https://github.com/ck-alpha/zotero-research-agent`（私有；GitHub 仓库名称变更不修改插件名称或 addon ID）。
- Phase checkpoint: `phase-1`，对应本轮 Phase 0 + Phase 1 合并验收提交。
- Current phase: Phase 0 + Phase 1 — Baseline & Recommendation Domain Foundation。
- Last verified date: 2026-09-06 (UTC)。
- 修改前 working tree：仅 `doc/codex_phase0_phase1_prompt.md`、`doc/research_agent_architecture_baseline.md` 为用户已有的未跟踪文件；没有已跟踪文件修改。
- 实际架构基线位于 [docs/research_agent_architecture_baseline.md](research_agent_architecture_baseline.md)，阶段要求位于 [doc/codex_phase0_phase1_prompt.md](../doc/codex_phase0_phase1_prompt.md)。架构基线在 Phase 1 实现后由用户移至 `docs/`；本交接文档使用要求的 `docs/development-log.md` 路径。

## Current Architecture Status

- 已完成模块：独立 Domain Types；运行时结构校验；ProfileStore / FeedbackStore / ImpressionStore 异步接口；测试专用内存实现及领域、Store 单元测试。
- 未完成模块：生产数据库适配器、ProfileBuilder / Service / Updater、画像提取与评分、召回、排序、多样性、反馈学习、证据补全、推荐 Tool / Action / Skill、UI 和评测。
- 当前支持链路：纯 TypeScript 对象 → Domain 校验 → 测试内存 Store → 分离的 JSON 快照；不需要 Zotero、模型或外部 API。
- 当前未支持链路：插件 Agent、普通聊天、Codex、Claude、WebChat 均未接入 Recommendation Domain；本次插件构建不会自动获得推荐功能。

## Change History

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

- **画像作用域**：基线 Impression 只有 profileVersion，没有 profileId。第一版保留原字段，未来多画像/多 library 支持需要明确 scoped store 或加入 profileId；当前不能把不同画像的同版本曝光混合解释。
- **身份映射**：本轮保持 `itemId`、`paperId`、`candidateId` 为不透明字符串，不假定 Zotero 数字 ID 或 key 的映射。具体 libraryID/key、外部 DOI/arXiv/OpenAlex 规范化由未来适配器统一定义。
- **跨 Store 一致性**：本轮只验证对象结构和单 Store 写入规则；不验证反馈是否存在对应曝光/候选、matchedTopicIds 是否存在于对应画像、signalSummary 是否和原始信号吻合。后续 Service/事务需定义这些规则。
- **业务合并规则**：相同主题同时有正负偏好时的优先级、重复 topic/preference 身份合并、信号聚合、时间戳先后关系、计数推导均留给确定性业务逻辑。
- **schema 演进**：profile.version 是快照修订号，不能替代未来数据库 schemaVersion。当前严格拒绝未知字段；迁移与兼容读写策略待生产持久化阶段制定。
- **事件重试与历史**：当前重复 eventId 明确报错，快照不保留历史。后续是否增加幂等重试结果、历史版本、分页、跨 Store 事务及错误类型，按实际需求确定。
- **源码与基线冲突**：未发现职责边界冲突。架构文档路径与示例不同，已采用实际路径读取而不迁移原文。原 `.gitignore` 忽略整个 `docs/`，与交接日志必须随代码提交的要求冲突；采用最小例外，仅放行 `docs/development-log.md`。

## Technical Debt

- Upstream：现有 1 项 pending 单测，非本阶段范围。
- 本轮：TypeScript 类型与手写校验结构需同步维护；新增字段应补充有效、无效输入测试。优先级中，尚不值得引入大型 schema 依赖。
- 本轮边界限制：尚无生产持久化，属于明确延后的 Phase 2 工作；不要将测试内存实现用作插件长期画像存储。

## Handoff Notes

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
