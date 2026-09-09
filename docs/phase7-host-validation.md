# Phase 7 宿主与 Provider 验证

本文件是手工验收流程，不代表已在宿主执行。2026-09-09：离线回归已执行；真实 Zotero、重启、group library、OpenAlex 和 embedding smoke 均 **NOT EXECUTED**。当前开发环境没有已连接的 Zotero GUI/DB 宿主。Node SQLite seam 的成功不替代这些检查。

## 离线复现

从仓库根目录运行，使用 Node 24：

```sh
npx tsx node_modules/mocha/bin/mocha.js --require ./test/register.cjs 'test/evaluation/**/*.test.ts'
npm run typecheck
npm run test:unit
npm run build
npm run check:cycles
git diff --check
```

`test/evaluation/fixtures.ts` 的 `benchmarkCases()` 返回可 JSON 往返的 A/B/C 输入；调用 `runRecommendationEvaluation(case)` 得到指标、原始排序与解释、警告及 `trace`。固定时间为 2026-09-09 UTC；无 provider、宿主、模型或持久状态。`evaluateRecommendationResults(case, observations)` 可检查已捕获的完整领域结果，拒绝错误候选身份、rank、score、topic ID 和被替换的标题/摘要。不要把经过字段截断/分数舍入的 Tool 摘要当作完整领域结果。

- A：Agentic Recommendation 强匹配 A 排在弱匹配 B 前。
- B：负偏好 Prompting 的 Y compatibility/baseScore 为 0；Top-1 仍为 A。Top-2 专项检查 Y 的分数。
- C：缺失候选摘要仍返回 C；`evidence_unavailable`、空 reason refs、confidence=0。

这些合成样本验证工程回归，没有真实用户相关性标注，不证明推荐效果。

## 指标约定

| 指标                  | 定义与空值                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Precision@K           | Top-K 中二元相关项数量 / K；不足 K 也使用 K                                                   |
| Recall@K              | Top-K 命中 / preferredCandidateIds 数量；显式空标注为 0                                       |
| MRR                   | Top-K 内首个相关项的倒数名次；无命中为 0                                                      |
| NDCG@K                | binary gain / log2(rank+1)，除以前 min(K, relevantCount) 项的理想 DCG；理想 DCG=0 时为 0      |
| Diversity             | Top-K title+abstract token 集的平均成对 1−Jaccard；不足两项为 0；不是 MMR score               |
| Novelty               | Top-K 中不在 knownCandidateIds 的精确 ID 占比；空输出为 0                                     |
| Rejected@K            | Top-K 中 rejectedCandidateIds 数量；用于额外负偏好诊断                                        |
| Evidence availability | 存在结构与身份有效证据的推荐占比，未必足以解释候选                                            |
| Evidence coverage     | 有效理由支持的 ranked matchedTopicIds 数量 / 全部匹配 ID 数量；无匹配为 0                     |
| Reason grounding      | 与当前确定性 formatter 完全一致且有非空支持 refs 的理由 / 全部推荐                            |
| Unsupported count     | 证据或理由结构错误、跨候选/重复引用、无效主题、被篡改摘要片段、或不能由所供证据复现的理由数量 |

未提供 preferredCandidateIds 时四项相关性指标为 `null` 并警告；未提供 knownCandidateIds 时 novelty 为 `null` 并警告。preferred/rejected 必须来自候选池且不交叉、无重复。空列表表达明确标注；`null` 不能冒充 0。

合法的“证据不足”理由不计 unsupported，也不计 grounded。直接候选证据必须为摘要来源且片段出现在候选摘要中。库内证据仅代表兴趣背景。该检验针对 Phase 6 固定模板，不是任意自然语言的语义蕴含验证；不验证出版物真实性或最终 Agent 转述，也不提供库内易变正文的历史重放。

## 内部延迟与故障诊断

`createResearchRecommendTool` 的开发装配选项：

```ts
const diagnostics: StageDiagnostic[] = [];
const tool = createResearchRecommendTool(
  profileService,
  librarySource,
  sourceFactory,
  {
    onDiagnostic: (record) => diagnostics.push(record),
    // 可选 diagnosticClock；默认 performance.now()，不可用时 Date.now()
    // 其余生产依赖按现有装配传入
  },
);
```

仅在临时开发装配中使用，验收者主动保存必要记录；默认不启用收集。无需修改 Agent 工具输入 schema，也不进入模型输出、UI 或 SQLite。没有永久 trace/export endpoint。

记录仅为 stage、durationMs、timeout、fallback、可选 failureCode。Discovery 包含召回/过滤/去重，ranking 包含 embedding/MMR，evidence 覆盖全部 Top-K，total 从工具执行开始覆盖画像/快照、三个阶段、输出组装与曝光持久化。失败仍产生已开始阶段和 total 记录；未开始阶段不伪造零耗时。total 聚合子阶段降级，抛错时使用 total_failed；子阶段保留 discovery_failed 等定位码。取消用 recommendation_cancelled；不捕获原始错误文本、画像、候选或用户身份。

Embedding 已有 deadline 与 evidence 单次读取/总预算超时有明确标记，保留旧 fallback 警告。Discovery provider 对外只给通用失败的情况无法判断底层 timeout；timeout=false 表示未观察到明确超时，不能据此断言底层没有超时。partial failure 与“无 embedding 配置而回退”可区分。观察回调异常不影响推荐结果。诊断耗时不进入确定性评测指标，也未进行性能优化或阈值验收。

## Zotero 操作步骤

使用可丢弃的测试资料库和构建产物 `.scaffold/build/llm-for-zotero.xpi`，记录 Zotero/插件版本、操作系统、commit、library ID、provider 配置名称（不记录密钥）。从插件内 Agent 模式执行；其他后端不支持这些工具。通过现有工具调用记录确认实际工具名与参数。

1. 准备至少两篇具有人工标签/collection 路径及 DOI 的条目；一篇含与研究兴趣一致的摘要。选择个人库。
2. 调用 `research_profile_get({})`（需求中的 profile_get）。首次 status=built、profileId=`library:<当前 ID>`；再次为 loaded 且版本不变。显式 `{"refresh":true}` 时重建，确认来源与主题可追溯。
3. 调用 `research_candidate_discover({"limit":5})`（candidate_discover）。确认 provenance、无已有库 DOI 候选、scope 正确；临时 focus 不改持久画像。需 OpenAlex 网络，见下节。
4. 调用 `research_recommend({"topK":3})`。保存 recommendationId/candidateId；返回顺序与 rank 一致，score breakdown 存在，逐条检查 reason refs、摘要片段及 matchedTopics。无摘要时应保留推荐并明确证据不足；不要把库内种子结论当作候选发现。
5. 若启用临时 onDiagnostic，记录四阶段耗时；断开 provider/embedding 或模拟异常后检查 fallback/失败定位。无曝光写入成功时工具必须失败，不应展示为已持久推荐。
6. 按现有确认流程调用 `recommendation_feedback({"recommendationId":"<真实值>","candidateId":"<真实值>","action":"positive"})`。再试同一动作应 already_recorded；negative/save/skip 各自在测试推荐上验收。save 仅记偏好，不导入条目。确认 profile version/反馈计数按实际状态变化，条目数和内容不变。

## 重启与 SQLite

1. 在上节调用后记录完整 profileId/version、推荐与事件标识；正常退出并重启 Zotero。
2. 再次 profile_get 应 loaded，主题、显式偏好、反馈计数保持；未显式 refresh 时不重建。
3. 对旧推荐重复相同 feedback 应 already_recorded，而非新事件。用另一个有效动作验证旧曝光仍可解析。
4. 通过开发者只读 DB 检查 `llm_for_zotero_research_profiles`、`llm_for_zotero_recommendation_impressions`、`llm_for_zotero_recommendation_feedback`：行 profile_id、schema_version 与 JSON 元数据一致，无重复事件。不要手工改生产库。
5. 数据库读取/保存失败必须报错；不能以临时内存成功代替持久化。冲突/reconcile 路径需在可丢弃测试库中额外模拟并记录。

## Group Library 隔离

1. 建立两个有不同标签的测试库（个人库和 group library），记录实际 ID；分别构建画像。
2. 切换库后检查 profileId、代表论文、候选过滤和库内 evidence reference 均属于当前 scope。
3. 用 A 库 recommendationId 在 B 库提交 feedback，应明确 scope 失败且两个画像都不变化。
4. A 库反馈后再读取 B 库，确认其版本和统计未变化；重启后再次核对。只读 group library 也应验证插件内部记忆持久化与条目访问权限的实际宿主行为。

## 可选真实 Provider Smoke

| 对象                | 操作与通过标准                                                                                                        | 当前状态     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------ |
| OpenAlex            | 执行 discovery，记录请求成功/部分失败、候选数量和 provenance；检查实际 DOI/标题，禁用网络时错误可诊断                 | NOT EXECUTED |
| Embedding           | 使用已有专用配置运行推荐，semanticRequested/Succeeded=true 且有 semantic score；禁用后 lexical fallback，画像不被改写 | NOT EXECUTED |
| Zotero DB lifecycle | 首建→曝光→反馈→退出→重启→读取/幂等重试，scope、版本与事件保持                                                         | NOT EXECUTED |

不将服务可用性、真实密钥或本地 Zotero 安装作为自动单测前提。不把上述待验收步骤记录为通过。

## 验收记录模板

每次人工执行填写：日期 / 验收者 / commit / Zotero 与 OS 版本 / library IDs / 操作与实际输出 / 耗时与 failureCode / pass、fail 或 blocked / 脱敏记录路径 / 剩余问题。记录需由验收者主动保管，无自动上传或用户追踪。

## Phase 8 衔接（2026-09-09）

内置 Skill、路由和脚本模型 Runtime 合同已补齐；没有可连接的 Zotero GUI/DB 宿主，
本机 PATH 中未发现 Zotero 可执行文件，也未发现 Zotero 进程。上述真实宿主、重启、
group library、OpenAlex、embedding 状态继续为 **NOT EXECUTED**。
请从 [自然语言演示](research-intelligence-demo.md) 进入同一验收路径，按
[工作流矩阵](research-intelligence-workflow-eval.md) 记录实际工具选择；离线结果不替代
真实模型选择、最终回答证据质量或宿主持久性验证。
