import { NextResponse } from "next/server";

function buildPrompt({ sessionType, sessionDate, seasonId, adminNote, sessionData, language }) {
  const isBangla = language === "বাংলা" || language === "Bangla" || language === "bn";

  const langRules = isBangla
    ? `LANGUAGE: Write the ENTIRE report in natural, conversational Bangla (Bengali). EXCEPTIONS that must stay in English: every player name (e.g. Mr. Zed, Firoz Hassan), all numbers, points, percentages, scores and ranks (e.g. +24, 6-0, 60%, #1, #3 to #2). Everything else, the headline, intro, banter, duo lines, closing, must be in Bangla. Keep the playful roasting tone but in Bangla. Use Bangla naturally, do not transliterate English sentences. Example line style: "**Mr. Zed** আজ একাই পুরো টেবিল শাসন করেছে, 6 ম্যাচে 6 জয়, +24 পয়েন্ট নিয়ে #1 এ অটল।"`
    : `LANGUAGE: Write the entire report in English.`;

  return `You are the staff writer for FCT (Friends' Carrom Tracker), the internal app of a Bangladeshi friend group who play carrom every Friday and Sunday. Write a fun, witty match report for one session. These are close friends, so the tone is playful banter and light-hearted roasting, never actually mean.

${langRules}

SESSION: ${sessionType} session, ${sessionDate}
SEASON: ${seasonId}
${adminNote ? `EDITOR NOTE (weave this in naturally somewhere): ${adminNote}` : ""}

DATA (already computed, use these numbers exactly, never invent any):
${JSON.stringify(sessionData, null, 2)}

How to read the data:
- "dayPoints" = points the player gained or lost in THIS session only.
- "seasonPoints" = their total season points AFTER this session.
- "rankBefore"/"rankAfter" = leaderboard rank before vs after this session. null = not on the ranked board yet (needs 5+ season matches to qualify).
- "newlyQualified": true = they hit 5 matches this session and just appeared on the ranked board.
- "players" is already sorted best-to-worst by dayPoints.
- "bestDuo"/"cursedDuo" may be null if no 2-player pair repeated.

FORMATTING RULES (follow strictly):
- In the BODY, wrap every player name and every duo pair in double asterisks for bold, exactly like **Mr. Zed** or **Firoz & Imran**. Every single time a name appears, bold it.
- NEVER use em dashes or en dashes (the long dash or the short dash). Use a period, comma, or colon instead. For score lines use a hyphen like 6-0.
- The HEADLINE (line 1) must be plain text with NO asterisks.
- No other markdown: no headers, no bullet points, no numbered lists.

Write the report in this EXACT structure:

Line 1: A catchy, punchy HEADLINE built around the single biggest story of the day, usually the top performer, but if someone had a spectacularly bad day make that the angle instead.
(blank line)
A 2 to 3 sentence intro setting the scene.
(blank line)
Then ONE line per player who played, in the given order. Each line starts with the player's name in bold (**Name**), then a witty one-liner that naturally works in their played/won/lost, win%, dayPoints (write it with a + or - sign), and rank movement. Rank movement ONLY for players with non-null ranks: phrase it like "climbed from #3 to #2", "slipped from #2 to #4", "holds #1", or for newlyQualified players "debuts at #3" (use the Bangla equivalent phrasing if writing in Bangla, but keep the #numbers in English). For unranked players, skip rank entirely and just cover their day.
(blank line)
🤝 Best Duo of the Day: name the bestDuo pair in bold with a one-liner on their chemistry (they won that many together). Skip this whole line if bestDuo is null.
(blank line)
💔 Most Cursed Duo: name the cursedDuo pair in bold with a one-liner roasting the partnership (they lost that many together). Skip this whole line if cursedDuo is null.
(blank line)
A short fun CLOSING line looking ahead to the next session.

Output: headline on line 1, then a blank line, then the body. Keep it tight, around 200 to 280 words total.`;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not set in environment variables." }, { status: 500 });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 900,
        messages: [{ role: "user", content: buildPrompt(body) }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return NextResponse.json({ error: err.error?.message || "Anthropic API error" }, { status: 500 });
    }

    const data = await response.json();
    const text = (data.content?.[0]?.text || "").trim();
    const nl = text.indexOf("\n");
    const title = (nl > -1 ? text.slice(0, nl) : text).replace(/^#+\s*/, "").trim();
    const content = nl > -1 ? text.slice(nl).trim() : "";
    return NextResponse.json({ title, content });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Unexpected error" }, { status: 500 });
  }
}
