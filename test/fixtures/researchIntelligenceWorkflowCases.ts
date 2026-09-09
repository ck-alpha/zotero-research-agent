/** Labels describe intended capabilities, not measured model tool choices. */
export type ResearchIntelligenceWorkflowCase = {
  id: string;
  language: "en" | "zh";
  prompt: string;
  autoMatch: boolean;
  primaryTool: string;
  priorRecommendation?: boolean;
};
const groups: Array<{
  prefix: string;
  autoMatch: boolean;
  primaryTool: string;
  priorRecommendation?: boolean;
  prompts: string[];
}> = [
  {
    prefix: "recommend",
    autoMatch: true,
    primaryTool: "research_recommend",
    prompts: [
      "recommend papers based on my research interests",
      "what papers should I read next?",
      "what should I read next based on my library?",
      "find recent papers that fit my library",
      "give me a personalized research digest",
      "recommend new work based on what I study",
      "suggest articles for me",
      "give me a weekly research digest",
      "根据我的研究兴趣推荐几篇新论文",
      "结合我的 Zotero 文献库，最近有什么值得读的？",
      "最近有哪些论文适合我读？",
      "按我的研究方向推荐论文",
      "给我一份值得读的研究论文清单",
      "根据我收藏的论文发现一些新工作",
      "结合我的文献库，最近什么值得读？",
      "给我一份个性化科研论文清单",
      "根据我的兴趣推荐几篇 agent memory 论文",
      "根据我的整个文献库推荐下一批值得读的论文",
      "最近有什么论文值得我读？",
      "下一篇读什么",
    ],
  },
  {
    prefix: "profile",
    autoMatch: true,
    primaryTool: "research_profile_get",
    prompts: [
      "show my research profile",
      "refresh my research profile",
      "你觉得我的主要研究方向是什么？",
      "更新我的研究画像",
    ],
  },
  {
    prefix: "candidate",
    autoMatch: true,
    primaryTool: "research_candidate_discover",
    prompts: [
      "inspect candidate discovery",
      "先给我看看候选池",
      "这些推荐是从哪些 query/seed 找到的？",
    ],
  },
  {
    prefix: "feedback",
    autoMatch: false,
    primaryTool: "recommendation_feedback",
    priorRecommendation: true,
    prompts: [
      "第2篇喜欢，第4篇不喜欢",
      "I like paper 2",
      "第二篇我想保存",
      "skip the third paper",
    ],
  },
  {
    prefix: "followup",
    autoMatch: false,
    primaryTool: "research_recommend",
    priorRecommendation: true,
    prompts: ["再推荐一次", "recommend again"],
  },
  {
    prefix: "search",
    autoMatch: false,
    primaryTool: "literature_search",
    prompts: ["search for papers about RAG", "搜索 diffusion model 论文"],
  },
  {
    prefix: "review",
    autoMatch: false,
    primaryTool: "library_retrieve",
    prompts: [
      "conduct a literature review on RAG",
      "conduct a literature review on agent memory",
      "写一篇关于 RAG 的文献综述",
    ],
  },
  {
    prefix: "qa",
    autoMatch: false,
    primaryTool: "paper_read",
    prompts: [
      "explain this paper",
      "summarize this article",
      "what does this paper propose?",
      "解释一下这篇论文的方法",
      "这篇论文引用了谁？",
    ],
  },
  {
    prefix: "library",
    autoMatch: false,
    primaryTool: "library_retrieve",
    prompts: [
      "summarize my collection",
      "audit my library",
      "总结我的整个文献库",
      "分析这个 collection 的主题分布",
    ],
  },
  {
    prefix: "note",
    autoMatch: false,
    primaryTool: "note_write",
    prompts: ["write a reading note", "写一篇阅读笔记"],
  },
];
export const researchIntelligenceWorkflowCases: ResearchIntelligenceWorkflowCase[] =
  groups.flatMap(({ prompts, prefix, ...contract }) =>
    prompts.map((prompt, index) => ({
      ...contract,
      id: `${prefix}-${index + 1}`,
      language: /[\u3400-\u9fff]/u.test(prompt) ? "zh" : "en",
      prompt,
    })),
  );
