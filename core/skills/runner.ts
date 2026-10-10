// library imports
import { generateText } from "ai";
// local imports
import type { AgentContext, Skill, SkillData } from "../models.js";
import { getLlmDetails, llmProviderOptions, resolveModel } from "../utils.js";
import { PROVIDERS } from "./providers.js";

/** Runs the deterministic half of a skill. Instant, no model, always correct. */
export async function runSkillData(skill: Skill, ctx: AgentContext, args = ""): Promise<SkillData> {
  const provider = skill.data ? PROVIDERS[skill.data] : undefined;
  if (!provider) return { blocks: [], facts: "" };
  try {
    return await provider(ctx, args);
  } catch (error) {
    return {
      blocks: [],
      facts: `Could not gather data: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * The model's half: a few lines written from the facts, following the skill's
 * own instructions. Returns null when there is no model or no instructions —
 * the numbers stand on their own either way.
 */
export async function writeCommentary(
  skill: Skill,
  ctx: AgentContext,
  data: SkillData,
  abortSignal?: AbortSignal,
): Promise<string | null> {
  const llm = getLlmDetails();
  if (!llm || !skill.body.trim() || !data.facts.trim() || data.skipCommentary) return null;

  const about = [
    `You are writing for ${ctx.userName}.`,
    ctx.profile?.role ? `They are a ${ctx.profile.role}.` : "",
    ctx.profile?.stack ? `Their stack: ${ctx.profile.stack}.` : "",
    ctx.profile?.goal ? `Their goal: ${ctx.profile.goal}.` : "",
    ...(ctx.memories ?? []).map((memory) => `They told you: ${memory}`),
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const { text } = await generateText({
      model: resolveModel(llm),
      providerOptions: llmProviderOptions(llm),
      system: `${skill.body}\n\n${about}\n\nUse only the numbers in the data. Never invent one. Plain text for a terminal, no headings.`,
      prompt: `Data:\n${data.facts}`,
      temperature: 0.3,
      maxOutputTokens: 500,
      abortSignal,
    });
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** What a chat skill sends to the agent: its recipe, plus whatever was typed after the command. */
export function chatSkillPrompt(skill: Skill, args: string): string {
  return [
    `Follow the "${skill.name}" skill.`,
    "",
    skill.body,
    args.trim() ? `\nInput: ${args.trim()}` : "",
  ].join("\n");
}
