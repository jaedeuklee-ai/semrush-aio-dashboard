import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// AGENT — NEXT PHASE (scaffold only)
//
// This route is where the analysis agent will live. It is intentionally not
// implemented yet; the dashboard above is the foundation it reads from.
//
// Planned design (agent queries the DB through tools instead of being fed all
// the data at once — keeps it fast, cheap, and grounded):
//
//   Phase 1  getWeakTopics(start,end)
//            -> reads visibility_daily; returns topics where LG trails Samsung
//               (use multi-day averages, not a single day — AI answers are
//               non-deterministic). Focus on non-brand tags only.
//
//   Phase 2  getCompetitorGap(tag, start, end)         [on-demand SEMrush call]
//            -> element 414352b4: prompts where Samsung appears but LG doesn't.
//
//   Phase 3  getTopicCitations(tag)                    [from DB, batch-synced]
//            getPromptCitations(keyword, model)        [on-demand SEMrush call]
//            isOwned(url) -> normalizeUrl() + lookup in owned_content
//            -> splits cited sources into "ours" vs "not ours".
//
//   Phase 4  prescribe(state) -> cited / not-cited -> improve vs create.
//
//   Phase 5  classifyChannel(domain) -> blog / reddit / news / wikipedia ...
//
// Wire this to the Anthropic API (ANTHROPIC_API_KEY) with the above as tools.
// ---------------------------------------------------------------------------

export async function POST() {
  return NextResponse.json(
    {
      status: "not_implemented",
      message:
        "The analysis agent is the next phase. The dashboard and data layer are ready for it to build on.",
    },
    { status: 501 },
  );
}
