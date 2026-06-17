import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, runTool } from "@/lib/agent-tools";
import { BRANDS } from "@/config/brands";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby cap

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const MAX_ROUNDS = 6;

const SYSTEM = `You are an AI Search Visibility analyst for ${BRANDS.own}, comparing against ${BRANDS.competitor}.
The data measures how often each brand is cited/mentioned in AI answers (ChatGPT, Perplexity, AI Overviews) for tracked topics.

You have tools to query the database. ALWAYS use the tools to get real numbers — never invent figures.
Do NOT assume what year or dates the data covers. If you are unsure which dates have data, call data_coverage FIRST and base any date range on the latest available date it reports. When the user doesn't specify dates, the tools already default to the most recent available window, so just call them without dates rather than guessing a year.
Topics are organized into 3 categories (TV, Audio, Monitor) via tag prefixes (tv__, audio__, it__).
NEVER guess or invent a tag string. Tags look like "tv__non-brand__oled tv" (note: "non-brand", spaces not underscores). Before using any tag, call list_topics to get the exact tag strings and use them verbatim. If a tool returns "tag not found" with did_you_mean candidates, pick the correct one from that list and retry — do not tell the user there is no data.
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

Be concise and concrete, cite the numbers you retrieved, and answer in Korean. If a table is empty for the range, say so plainly rather than guessing.

Prompt-level data is fetched live from SEMrush on first use and then cached, so the first call for a new prompt may take a few seconds. For prompt_gaps, pass a specific tag so that topic's prompts get loaded; if it reports more_to_load > 0, tell the user you can load more on the next question.`;

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

// --------------------------- Claude (Anthropic) ---------------------------
async function runClaude(incoming: ClientMessage[]): Promise<{ reply: string; toolsUsed: string[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Add it in Vercel project settings.");
  const anthropic = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = incoming.map((m) => ({ role: m.role, content: m.content }));
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await anthropic.messages.create({
      model: CLAUDE_MODEL,
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
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        }
      }
      messages.push({ role: "assistant", content: resp.content });
      messages.push({ role: "user", content: toolResults });
      continue;
    }
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { reply: text, toolsUsed };
  }
  return { reply: "분석 단계가 너무 많아 중단했어요. 질문을 더 좁혀서 다시 물어봐 주세요.", toolsUsed };
}

// ------------------------------- Gemini ------------------------------------
interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: "user" | "model" | "function";
  parts: GeminiPart[];
}

async function runGemini(incoming: ClientMessage[]): Promise<{ reply: string; toolsUsed: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it in Vercel project settings.");

  const functionDeclarations = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));

  const contents: GeminiContent[] = incoming.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        tools: [{ functionDeclarations }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] } }[];
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length > 0) {
      contents.push({ role: "model", parts });
      const responseParts: GeminiPart[] = [];
      for (const c of calls) {
        const name = c.functionCall!.name;
        toolsUsed.push(name);
        let result: unknown;
        try {
          result = await runTool(name, c.functionCall!.args ?? {});
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        responseParts.push({ functionResponse: { name, response: { result } } });
      }
      contents.push({ role: "function", parts: responseParts });
      continue;
    }

    const text = parts
      .map((p) => p.text)
      .filter((t): t is string => typeof t === "string")
      .join("\n")
      .trim();
    return { reply: text, toolsUsed };
  }
  return { reply: "분석 단계가 너무 많아 중단했어요. 질문을 더 좁혀서 다시 물어봐 주세요.", toolsUsed };
}

export async function POST(req: NextRequest) {
  let body: { messages?: ClientMessage[]; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const incoming = body.messages ?? [];
  if (incoming.length === 0) {
    return NextResponse.json({ error: "no messages" }, { status: 400 });
  }

  try {
    const out = body.model === "gemini" ? await runGemini(incoming) : await runClaude(incoming);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
