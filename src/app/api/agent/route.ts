import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, runTool } from "@/lib/agent-tools";
import { BRANDS } from "@/config/brands";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby cap

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const MAX_ROUNDS = 6; // tool-use loop safety cap

const SYSTEM = `You are an AI Search Visibility analyst for ${BRANDS.own}, comparing against ${BRANDS.competitor}.
The data measures how often each brand is cited/mentioned in AI answers (ChatGPT, Perplexity, AI Overviews) for tracked topics.

You have tools to query the database. ALWAYS use the tools to get real numbers — never invent figures.
Topics are organized into 3 categories (TV, Audio, Monitor) via tag prefixes (tv__, audio__, it__).
"visibility" is a 0–1 share. "gap" = ${BRANDS.own} − ${BRANDS.competitor} (negative means ${BRANDS.own} is behind).

There are two levels of analysis:
- Topic level: weak_topics, topic_visibility, topic_citations, owned_coverage.
- Prompt level (deeper): prompt_gaps (prompts where ${BRANDS.competitor} appears but ${BRANDS.own} doesn't, ranked by volume),
  prompt_sources (which URLs win a prompt, with channel type + whether LG-owned), prompt_fanout (the sub-queries a prompt expands into),
  prompt_brands (who appeared for one prompt).

When the user asks "where are we weak and what should we do", reason in this order and call tools at each step:
(1) weak_topics → pick a weak topic; (2) prompt_gaps on that topic → highest-volume prompts where ${BRANDS.own} is absent;
(3) prompt_sources on a target prompt → which domains/URLs currently win and their channel type; (4) prompt_fanout → the sub-intents the content must cover;
(5) recommend concrete content: what to create/fix, which content TYPE fits (Reddit thread, PR, owned info page, Wiki…) based on which channels win in prompt_sources, and which fan-out sub-queries it must answer.

Be concise and concrete, cite the numbers you retrieved, and answer in Korean. If a table is empty for the range, say so plainly rather than guessing.`;

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it in Vercel project settings." },
      { status: 500 },
    );
  }

  let body: { messages?: ClientMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const incoming = body.messages ?? [];
  if (incoming.length === 0) {
    return NextResponse.json({ error: "no messages" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey });

  // Seed the working transcript from the plain client history.
  const messages: Anthropic.MessageParam[] = incoming.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolsUsed: string[] = [];

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1800,
        system: SYSTEM,
        tools: TOOLS,
        messages,
      });

      if (resp.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of resp.content) {
          if (block.type === "tool_use") {
            toolsUsed.push(block.name);
            let result: unknown;
            try {
              result = await runTool(block.name, block.input as Record<string, unknown>);
            } catch (e) {
              result = { error: e instanceof Error ? e.message : String(e) };
            }
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }
        messages.push({ role: "assistant", content: resp.content });
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Final answer
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return NextResponse.json({ reply: text, toolsUsed });
    }

    return NextResponse.json({
      reply: "분석이 너무 많은 단계를 필요로 해서 중단했어요. 질문을 더 좁혀서 다시 물어봐 주세요.",
      toolsUsed,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
