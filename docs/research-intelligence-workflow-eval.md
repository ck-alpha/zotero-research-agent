# Research Intelligence 工作流评测

2026-09-09，Phase 8。此处严格区分确定性合同与真实模型行为。

## 已执行：离线路由与合同

复用 `test/fixtures/researchIntelligenceWorkflowCases.ts` 的 49 个唯一案例：

| 类别                                         | 数量 | 实际结果     |
| -------------------------------------------- | ---: | ------------ |
| 自动匹配正例：推荐 20、画像 4、候选检查 3    |   27 | 27 / 27 PASS |
| 不自动匹配：普通搜索、综述、QA、库分析、笔记 |   16 | 16 / 16 PASS |
| 不作无上下文自动匹配：反馈 4、再次推荐 2     |    6 | 6 / 6 PASS   |
| 确定性路由合计                               |   49 | 49 / 49 PASS |
| 显式调用：`$`、`/`、自然语言 Skill directive |    3 | 3 / 3 PASS   |

负例合计 22 / 22 PASS。所有案例通过既有 `resolveSkillRouting` 的 regex fallback，
不实现第二套路由器。Fixture 的 `primaryTool` 是人工预期标签，**不是已测模型选择**；
不同上下文可改变通用工作流的具体工具，例如库统计可能使用 `zotero_script`。

另验证 Skill 解析/注册/全局 eligibility、classifier 注入 ID、显式多 Skill 并存、
既有英文 QA/review/library 路由、四个工具的本地目录隔离、反馈 schema/确认与
Skill 指导的关键边界。Bootstrap 测试确认首次写入与用户定制保留。
中文负例只证明新 Skill 不抢占，未声称扩展了既有 Skill 的中文正则覆盖。

复用 `test/agentRuntime.test.ts` 的 MockAdapter/adapterFactory 和 DB seam，
新增 3 个 Runtime 合同用例：

1. 脚本模型发出 `research_recommend`，真实工具在固定 provider/profile fixture
   上执行，保存 impression，并将 recommendationId/candidateId 返回续轮模型；
   Skill 指导确实注入，画像只读一次且没有 refresh。
2. 脚本模型发出 `recommendation_feedback(save)`，确认批准后调用 submit。
3. 相同反馈取消后 submit 不执行。

反馈 Runtime 用例隔离业务服务为 spy；持久化、重放、版本更新与重新推荐由既有
`recommendationFeedback`、`recommendationRecommendTool` 与 SQLite 回归覆盖。
以上不衡量自然语言排名指代解析的模型准确率，也不证明最终自然语言回答无幻觉。
工具预先由脚本模型指定，不把这些测试称为 LLM Tool Selection Accuracy。

复现命令（Node 24；若系统 PATH 无 Node，先加入本地 toolchain 的 bin）：

```sh
npx tsx node_modules/mocha/bin/mocha.js --require ./test/register.cjs test/recommendationResearchIntelligenceSkill.test.ts test/userSkills.bootstrapUpgrade.test.ts
npx tsx node_modules/mocha/bin/mocha.js --require ./test/register.cjs test/agentRuntime.test.ts --grep 'research intelligence'
npm run typecheck
npm run test:unit
npm run build
npm run check:cycles
```

首次两条分别为 63 passing、3 passing；全量为 4522 passing / 1 既有 pending。
Phase 7 排序/证据指标公式未变，evaluation 仍为只读 observer。

## 待执行：真实 Agent / 模型矩阵

所有实际结果为 NOT EXECUTED，pass/fail 留空。不记录隐藏推理；只记录公开
Skill ID、工具名/参数、结果状态、调用数、确认与错误信息，不含密钥。
在插件 Agent 下运行，记录 commit、模型/provider 配置名、Zotero 版本和库作用域。
不能用一次执行代表模型准确率；需要固定测试集、重复次数与独立判定后再报告指标。

| ID  | 用户输入                                                  | 语言 | 预期 Skill                           | 预期主工具                                | 禁止的冗余工具/行为                                       | 成功判据                                            | 实际结果     | PASS/FAIL | 备注               |
| --- | --------------------------------------------------------- | ---- | ------------------------------------ | ----------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- | ------------ | --------- | ------------------ |
| L01 | 根据我的研究兴趣推荐 5 篇论文                             | zh   | research-intelligence                | research_recommend                        | 前置 profile_get / candidate_discover / literature_search | 一次推荐调用，保留 rank 与 IDs                      | NOT EXECUTED | —         | 全局模式           |
| L02 | Recommend papers about agent memory based on my interests | en   | research-intelligence                | research_recommend                        | 重复外部搜索                                              | focus 临时生效，不改兴趣权重                        | NOT EXECUTED | —         | 带主题             |
| L03 | show my research profile                                  | en   | research-intelligence                | research_profile_get                      | research_recommend                                        | 读取缓存画像                                        | NOT EXECUTED | —         | 已有画像           |
| L04 | 先给我看看候选池                                          | zh   | research-intelligence                | research_candidate_discover               | research_recommend                                        | 返回查询/seed provenance                            | NOT EXECUTED | —         | 调试               |
| L05 | I like paper 2                                            | en   | research-intelligence / 上文反馈指导 | recommendation_feedback                   | 再召回、导入                                              | 解析上轮 rank 2，确认 positive                      | NOT EXECUTED | —         | 上文 L01           |
| L06 | 第 4 篇不感兴趣                                           | zh   | research-intelligence / 上文反馈指导 | recommendation_feedback                   | 无明确意图写入                                            | 确认 negative，更新 revision                        | NOT EXECUTED | —         | 上文 L01           |
| L07 | 第二篇我想保存                                            | zh   | research-intelligence / 上文反馈指导 | recommendation_feedback                   | Zotero import                                             | save 只影响偏好；取消不写入                         | NOT EXECUTED | —         | 上文 L01           |
| L08 | 把第 2 篇加入 Zotero                                      | zh   | 显式导入工作流                       | 既有导入/write capability                 | 隐式 feedback                                             | DOI/arXiv 导入经确认与 journal                      | NOT EXECUTED | —         | 不伪造导入工具名   |
| L09 | search for papers about RAG                               | en   | 普通检索                             | literature_search                         | research_recommend                                        | 保持普通学术检索                                    | NOT EXECUTED | —         | 负控制             |
| L10 | conduct a literature review on RAG                        | en   | literature-review                    | library_retrieve / 既有 review 工具       | research_recommend                                        | 既有综述工作流                                      | NOT EXECUTED | —         | 负控制             |
| L11 | explain this paper                                        | en   | simple-paper-qa                      | paper_read                                | recommendation_feedback                                   | 解释选中论文                                        | NOT EXECUTED | —         | 选中论文           |
| L12 | summarize my collection                                   | en   | library-analysis                     | library_retrieve                          | research_recommend                                        | 既有库分析                                          | NOT EXECUTED | —         | 选中 collection    |
| L13 | 为什么第 1 篇适合我？                                     | zh   | 推荐上文指导                         | 使用已有推荐证据                          | 编造论文结论                                              | 零 confidence / evidence_unavailable 时披露证据不足 | NOT EXECUTED | —         | 缺摘要候选         |
| L14 | give me a personalized research digest                    | en   | research-intelligence                | research_recommend                        | 自动 embedding 配置或 Scheduler                           | 无 embedding 配置仍确定性推荐                       | NOT EXECUTED | —         | semantic fallback  |
| L15 | 根据我的兴趣推荐论文                                      | zh   | research-intelligence                | research_recommend                        | 伪造完整成功                                              | partial provider 失败有警告，保留可用候选           | NOT EXECUTED | —         | 控制 provider 故障 |
| L16 | 再推荐一次                                                | zh   | 推荐上文指导                         | research_recommend                        | 默认 refresh                                              | 重启后读取已持久化反馈画像                          | NOT EXECUTED | —         | 先确认反馈并重启   |
| L17 | 结合我的文献库推荐新论文                                  | zh   | research-intelligence                | research_recommend                        | 发明 library ID                                           | group library scope 正确且隔离个人库                | NOT EXECUTED | —         | 选择 group library |
| L18 | 第 2 篇喜欢，第 4 篇不喜欢                                | zh   | 推荐上文指导                         | recommendation_feedback ×2                | 新 batch tool                                             | 两个 rank 正确，分别确认                            | NOT EXECUTED | —         | 多项反馈           |
| L19 | 更新我的研究画像后再推荐一次                              | zh   | research-intelligence                | research_profile_get → research_recommend | 候选检查前置                                              | 仅显式 refresh，然后一次推荐                        | NOT EXECUTED | —         | 有序两步           |
| L20 | Explain paper 2 in more detail                            | en   | 推荐上文指导 / QA                    | 已有 evidence；可用时 paper_read          | recommendation_feedback                                   | 外部候选不假装有本地 PDF                            | NOT EXECUTED | —         | 上文 L01           |

短反馈和“再推荐一次”没有独立文本自动激活正则，需要可解析的推荐对话上下文，
可使用正常 classifier/显式 Skill 机制和已有工具指导。测试没有增加 SkillStateStore
或隐藏的跨轮 Skill 强制激活；真实多轮连续性是本矩阵的重点验收项。
既有 Skill 的宽匹配可能同时激活，例如 `find … papers` 的证据 QA 模式；沿用
messageBuilder 的多 Skill 按子任务处理规则和当前用户意图，不加入隐藏互斥路由。

## 宿主与发布门槛

Zotero host、restart persistence、group library、OpenAlex、embedding、live model
均 **NOT EXECUTED**。本次环境没有已连接的 Zotero GUI/DB。复用
[Phase 7 宿主清单](phase7-host-validation.md)；离线 PASS 不能改写真实验收状态。
工程 checkpoint 可交付，但不宣称生产就绪、科研效果验证或 100% Agent accuracy。

后续先执行真实自然语言闭环和 group library 隔离，再考虑是否需要周期 Digest、
专用 UI、temporal holdout、live provider/model benchmark、跨设备身份同步或证据缓存。
本阶段未测 ablation，没有指标提升声明。
