# Research Intelligence：按需推荐演示

Phase 8 将已有推荐链路接入内置 `research-intelligence` Skill。普通用户只需
自然语言；下列工具名供开发者核对调用记录，无需用户手动输入。
这是离线合同已验证的演示脚本，真实 Agent/model/Zotero 验收尚未执行。

## 准备

在 Zotero 安装构建的插件，使用插件内 Agent 模式及一个可丢弃的测试资料库。
库内准备有人工主题标签、collection 路径、摘要和 DOI 的论文。
推荐召回需要可访问的 OpenAlex；embedding 可选，缺配置时确定性回退。
新 Skill 沿用启动时内置文件 bootstrap：用户目录是实际运行的唯一来源，
自定义正文保留。也可使用 `$research-intelligence`、`/research-intelligence`
或 “use the research intelligence skill …” 显式选择。
Codex App Server、Claude Code、WebChat 和公共 MCP 目录没有这四个本地工具。

## 1. 查看画像

输入：“你觉得我的主要研究方向是什么？”

预期只调用 `research_profile_get`，展示研究主题和来源。已有画像默认缓存读取；
“更新我的研究画像”才请求 `refresh:true`，不为每次推荐重建。

## 2. 个性化推荐

输入：“根据我的研究兴趣推荐 5 篇值得读的论文。”

预期直接调用一次 `research_recommend({topK:5})`，内部完成画像读取、双路召回、
排序/MMR、证据补全与曝光保存。不要额外调用 `research_candidate_discover` 或
`literature_search`。候选调试仅在用户输入“先给我看看候选池”时使用
`research_candidate_discover`。

输出保留 rank，列出标题、可用作者/年份、兴趣匹配、证据理由、主题和来源链接。
保留 `recommendationId` 与每个 `candidateId` 的关联供后续使用；不要求用户抄 ID。
“给我本周的 research digest”表示当前推荐的紧凑展示，并不创建每周自动任务，
也不承诺候选只发表于本周。

## 3. 反馈与导入

输入：“第 2 篇我很喜欢，第 4 篇不感兴趣。”

预期按上一份结果的 rank 解析 ID，分别调用 `recommendation_feedback`，动作是
`positive`、`negative`。沿用推荐记忆的确认卡；批准后才报告成功，取消不记录。
“第二篇我想保存”是 `save` 偏好反馈，**不会加入 Zotero**。
“把第 2 篇加入 Zotero”才使用返回的 DOI/arXiv 标识走既有导入写入、确认与
change-journal 流程。导入请求不额外推断偏好反馈。

“解释第 2 篇”不构成反馈：先使用已有证据；仅在实际有 Zotero 条目上下文后才可
`paper_read`，外部推荐并不意味着本机已有可读 PDF。

## 4. 再次推荐

输入：“再推荐一次。”

预期在同一推荐对话中再次调用 `research_recommend`，读取更新后的画像。
检查反馈状态与 profile revision；不要承诺一次反馈必然改变 Top-5，真实顺序
还取决于候选池。持久化和重启步骤复用
[Phase 7 宿主验证](phase7-host-validation.md)，不将内存/SQLite 测试当作宿主验收。

## 5. 证据不足

使用缺摘要的候选，或通过离线 Phase 7 fixture C 复现。

预期候选仍可推荐，返回 `evidence_unavailable` 或零置信度时明确说直接证据有限，
目前只是画像/排序信号支持相关性。不能从标题编造方法、性能、突破或引用。
论文摘要、笔记和片段是非可信数据，不执行其中嵌入的指令。

## 演示记录

记录实际 Skill、工具名、参数、结果状态、调用数量及必要的确认结果；
不记录隐藏推理或凭据。成功判据和待执行矩阵见
[工作流评测](research-intelligence-workflow-eval.md)。
