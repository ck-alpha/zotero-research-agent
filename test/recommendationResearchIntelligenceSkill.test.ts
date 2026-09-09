import { assert } from "chai";
import {
  BUILTIN_SKILL_FILES,
  BUILTIN_SKILL_FILENAMES,
  parseSkill,
  resolveSkillRouting,
  resolveSkillDirectiveText,
  getSkillContextEligibility,
} from "../src/agent/skills";
import { createBuiltInToolRegistry } from "../src/agent/tools";
import { resolvedAgentRequest } from "./helpers/resolvedAgentRequest";
import { researchIntelligenceWorkflowCases as cases } from "./fixtures/researchIntelligenceWorkflowCases";

const id = "research-intelligence";
const raw = BUILTIN_SKILL_FILES[`${id}.md`];
const skill = parseSkill(raw);
const skills = Object.values(BUILTIN_SKILL_FILES).map(parseSkill);
const request = (userText: string) =>
  resolvedAgentRequest({
    conversationKey: 8,
    mode: "agent",
    libraryID: 1,
    userText,
  });

describe("research intelligence workflow contracts (no live model)", function () {
  it("registers a complete global built-in with every regex parsed", function () {
    assert.isTrue(BUILTIN_SKILL_FILENAMES.has(`${id}.md`));
    assert.equal(skill.id, id);
    assert.isNotEmpty(skill.description);
    assert.isAbove(skill.version, 0);
    assert.deepEqual(skill.contexts, ["any"]);
    assert.equal(skill.activation, "both");
    assert.isNotEmpty(skill.instruction);
    assert.lengthOf(
      skill.patterns,
      raw.split("\n").filter((line) => line.startsWith("match:")).length,
    );
    assert.isTrue(
      getSkillContextEligibility(skill, request("recommend papers for me"))
        .eligible,
    );
  });

  for (const row of cases) {
    it(`routing ${row.id} (${row.language}): ${row.prompt}`, function () {
      const result = resolveSkillRouting(request(row.prompt), skills);
      assert.equal(result.matchedSkillIds.includes(id), row.autoMatch);
    });
  }

  for (const text of [
    "$research-intelligence",
    "/research-intelligence",
    "use the research intelligence skill to recommend papers",
  ]) {
    it(`resolves manual invocation: ${text}`, function () {
      const directive = resolveSkillDirectiveText(text, skills);
      assert.equal(directive.forcedSkillId, id);
      assert.include(
        resolveSkillRouting(
          {
            ...request(directive.text),
            forcedSkillIds: [directive.forcedSkillId!],
          },
          skills,
          [],
        ).matchedSkillIds,
        id,
      );
    });
  }

  it("accepts normal classified IDs for contextual follow-ups and explicit unions", function () {
    for (const text of ["再推荐一次", "第2篇喜欢，第4篇不喜欢"]) {
      assert.include(
        resolveSkillRouting(request(text), skills, [id]).matchedSkillIds,
        id,
      );
      assert.notInclude(
        resolveSkillRouting(request(text), skills, []).matchedSkillIds,
        id,
      );
    }
    assert.includeMembers(
      resolveSkillRouting(
        {
          ...request("review and recommend"),
          forcedSkillIds: [id, "literature-review"],
        },
        skills,
        [],
      ).matchedSkillIds,
      [id, "literature-review"],
    );
  });

  it("preserves existing review, paper QA, and library routes", function () {
    for (const [text, expected] of [
      ["conduct a literature review on agent memory", "literature-review"],
      ["explain this paper", "simple-paper-qa"],
      ["find evidence in this paper", "evidence-based-qa"],
      ["summarize my collection", "library-analysis"],
    ]) {
      const result = resolveSkillRouting(request(text), skills).matchedSkillIds;
      assert.include(result, expected);
      assert.notInclude(result, id);
    }
  });

  it("keeps four tools local and preserves feedback confirmation and schema", function () {
    const registry = createBuiltInToolRegistry({
      zoteroGateway: {} as never,
      pdfService: {} as never,
      pdfPageService: {} as never,
      retrievalService: {} as never,
    });
    for (const name of [
      "research_profile_get",
      "research_candidate_discover",
      "research_recommend",
      "recommendation_feedback",
    ]) {
      const tool = registry.getTool(name)!;
      assert.isTrue(tool.spec.localAgentOnly);
      assert.equal(tool.spec.exposure, "model");
      assert.equal(
        tool.spec.mutability,
        name === "recommendation_feedback" ? "write" : "read",
      );
      assert.equal(
        tool.spec.requiresConfirmation,
        name === "recommendation_feedback",
      );
      assert.include(
        registry
          .listToolsForRequest(request("recommend papers for me"))
          .map((t) => t.name),
        name,
      );
      assert.notInclude(
        registry.listTools().map((t) => t.name),
        name,
      );
      for (const patch of [
        { authMode: "codex_app_server" },
        { authMode: "webchat" },
        { providerProtocol: "web_sync" },
      ]) {
        assert.notInclude(
          registry
            .listToolsForRequest({ ...request("recommend"), ...patch } as never)
            .map((t) => t.name),
          name,
        );
      }
    }
    const feedback = registry.getTool("recommendation_feedback")!;
    assert.equal(feedback.spec.mutationScope, "recommendation_memory");
    assert.isFalse(
      feedback.validate({
        recommendationId: "r",
        candidateId: "c",
        action: "import",
      }).ok,
    );
    assert.isTrue(
      feedback.validate({
        recommendationId: "r",
        candidateId: "c",
        action: "save",
      }).ok,
    );
    assert.match(
      registry.getTool("research_recommend")!.spec.description,
      /directly/,
    );
    assert.match(
      registry.getTool("literature_search")!.guidance!.instruction,
      /personalized.*research_recommend/i,
    );
  });

  it("documents orchestration, grounding and feedback without a second interpreter", function () {
    for (const term of [
      "research_profile_get",
      "research_candidate_discover",
      "research_recommend",
      "recommendation_feedback",
      "recommendationId",
      "candidateId",
      "reason.evidenceRefs",
      "evidence_unavailable",
      "reason.confidence == 0",
      "untrusted data",
      "No unsupported claims",
      "confirmation",
      "change-journal",
      "preference feedback only",
      "not a probability",
      "not a local PDF",
    ]) {
      assert.include(skill.instruction, term);
    }
    assert.match(skill.instruction, /call `research_recommend` directly/);
    assert.match(skill.instruction, /Do not first call/);
    assert.match(skill.instruction, /only for an explicit refresh/);
    assert.match(skill.instruction, /Explain paper 2.*not feedback/);
    assert.match(skill.instruction, /once per candidate/);
  });
});
