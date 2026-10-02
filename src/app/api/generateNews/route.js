import { NextResponse } from "next/server";

const toBnDigits = s => (s || "").replace(/[0-9]/g, d => "০১২৩৪৫৬৭৮৯"[d]);
const toEnDigits = s => (s || "").replace(/[০-৯]/g, d => String("০১২৩৪৫৬৭৮৯".indexOf(d)));

function buildTranslatePrompt({ title, content, targetLanguage }) {
  const toBangla = targetLanguage === "বাংলা" || targetLanguage === "Bangla" || targetLanguage === "bn";
  const target = toBangla ? "Bangla (Bengali)" : "English";
  const numberRule = toBangla
    ? "Keep every player name in English exactly as written (e.g. Mr. Zed, Firoz Hassan). Convert ALL numbers, points, percentages, scores and ranks to Bangla digits (e.g. +24 becomes +২৪, 6-0 becomes ৬-০, 60% becomes ৬০%, #1 becomes #১, #3 to #2 becomes #৩ থেকে #২). The bold markers stay exactly where they are, e.g. **#1** becomes **#১**."
    : "Keep every player name in English exactly as written (e.g. Mr. Zed, Firoz Hassan). Convert any Bangla digits back to English digits (e.g. ৬-০ becomes 6-0, #১ becomes #1).";
  return `You are translating a fun carrom match report for FCT (Friends' Carrom Tracker), a Bangladeshi friend group's app. Translate the HEADLINE and BODY below into ${target}, keeping the same playful, witty banter tone.

STRICT RULES:
- ${numberRule}
- Preserve the **bold markers** around names, duos, AND rank numbers exactly (e.g. **Mr. Zed** stays **Mr. Zed**, **#1** stays **#১** when translating to Bangla). Every name and every # rank must remain wrapped in double asterisks.
- Keep the emojis (🤝 💔 etc.) where they are.
- NEVER use em dashes or en dashes. Use periods, commas, colons, or hyphens for scores.
- Keep the same structure: headline on line 1, blank line, then body. Separate the intro, the highlight paragraphs (if any), EACH player line, the Best Duo line, the Cursed Duo line, and the closing line by a COMPLETELY BLANK line (two newline characters between every block), exactly mirroring the paragraph breaks of the original. Never merge two lines into one paragraph.
- Translate the ENTIRE text fully. Do not stop early or truncate. Include every highlight paragraph, every player line, both duo lines, and the closing.
- Do not add or remove information. Translate faithfully but naturally (not word-for-word robotic).

HEADLINE:
${title}

BODY:
${content}

Output: translated headline on line 1, then a blank line, then the translated body. Nothing else.`;
}

function buildPrompt({ sessionType, sessionDate, seasonId, adminNote, sessionData, language }) {
  const isBangla = language === "বাংলা" || language === "Bangla" || language === "bn";

  const langRules = isBangla
    ? `LANGUAGE: Write the ENTIRE report in natural, conversational Bangla (Bengali). The ONLY exception that stays in English is player names (e.g. Mr. Zed, Firoz Hassan). Every number, point, percentage, score and rank must be written with Bangla digits (০১২৩৪৫৬৭৮৯), never English digits. Everything else, the headline, intro, highlights, banter, duo lines, closing, must be in Bangla. Keep the playful roasting tone but in Bangla. Use Bangla naturally, do not transliterate English sentences. Example line style: "**Mr. Zed** আজ একাই পুরো টেবিল শাসন করেছে, ৬ ম্যাচে ৬ জয়, +২৪ পয়েন্ট নিয়ে **#১** এ অটল।" Rank movements in Bangla are written like "**#৩ থেকে #২** এ উঠে এসেছে" (climbed), "**#২ থেকে #৪** এ নেমে গেছে" (slipped), "**#১** ধরে রেখেছে" (holds), "**#৩** এ অভিষেক" (debuts at), always bold and always with Bangla digits.`
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
- "highlights.cleanHits" = [{ name, count }], players who pocketed every piece in one turn (a clean hit) that day. Empty array if none happened.
- "highlights.cleanWins" = [{ winners, losers, score }], matches where the losing team scored zero (a nil game). "winners" delivered it, "losers" took it. Empty array if none happened.
- "highlights.milestones" = [{ name, type, value }], type is "careerMatches" (their all-time match count just crossed 100/200/300 etc.) or "seasonPoints" (their season points just crossed 100/200/300 etc. this session). Empty array if none happened.
- "highlights.debuts" = names of players who played their very first-ever match today. Empty array if none.
- "highlights.returning" = [{ name, daysAway }], players who hadn't played in daysAway days or more before today. Empty array if none.
- "highlights.season" = { number, isOpener, daysLeft, sessionsLeft, isFinalStretch }. isOpener = true if this is the first session of a new season. isFinalStretch = true if the season is wrapping up soon (daysLeft <= 14).

FORMATTING RULES (follow strictly):
- In the BODY, wrap every player name and every duo pair in double asterisks for bold, exactly like **Mr. Zed** or **Firoz & Imran**. Every single time a name appears, bold it.
- ALSO bold every rank number the same way: write ranks as **#1**, **#3**, or movements as **#3 to #2** / **#2 to #4**. Every # rank must be wrapped in double asterisks.
- NEVER use em dashes or en dashes (the long dash or the short dash). Use a period, comma, or colon instead. For score lines use a hyphen like 6-0.
- The HEADLINE (line 1) must be plain text with NO asterisks.
- No other markdown: no headers, no bullet points, no numbered lists.
- SPACING IS MANDATORY: separate the intro, EACH highlight paragraph, EACH player line, the Best Duo line, the Cursed Duo line, and the closing line by a COMPLETELY BLANK line (two newline characters between every block). Never run two blocks together. Every block gets its own paragraph with blank lines above and below.

Write the report in this EXACT structure:

Line 1: A catchy, punchy HEADLINE built around the single biggest story of the day, usually the top performer, but if someone had a spectacularly bad day make that the angle instead.
(blank line)
A 2 to 3 sentence intro setting the scene.
(blank line)
HIGHLIGHTS (1 to 2 paragraphs, 2 to 4 sentences each): cover ONLY the special events actually present in the highlights data, in whatever order makes a good story. If an event type's array/field is empty or false, do not mention it and do not invent one. If NOTHING in highlights qualifies, skip this section completely, no filler paragraph. Tone per event type:
  - cleanHits: a special shout-out, this is a rare skill (pocketing everything in one turn).
  - cleanWins: praise the team that delivered the nil game, and playfully roast the team that took it (friendly, never mean).
  - milestones: celebrate it like a century in cricket.
  - debuts: a warm welcome to the new player.
  - returning: a "look who's back" welcome, mention how long they were away.
  - season.isOpener: a special welcome to the new season (mention the season number).
  - season.isFinalStretch: a warning tone, only daysLeft days / sessionsLeft sessions left this season, the leaderboard is about to lock, time to fight.
  Bold every name and duo mentioned in the highlights too.
(blank line)
Then ONE line per player who played, in the given order. Each line starts with the player's name in bold (**Name**), then a witty one-liner that naturally works in their played/won/lost, win%, dayPoints (write it with a + or - sign), and rank movement. Rank movement ONLY for players with non-null ranks: phrase it like "climbed from **#3 to #2**", "slipped from **#2 to #4**", "holds **#1**", or for newlyQualified players "debuts at **#3**" (use the Bangla equivalent phrasing if writing in Bangla, but keep the #numbers bold). Always wrap rank numbers in double asterisks. For unranked players, skip rank entirely and just cover their day.
(blank line)
🤝 Best Duo of the Day: name the bestDuo pair in bold with a one-liner on their chemistry (they won that many together). Skip this whole line if bestDuo is null.
(blank line)
💔 Most Cursed Duo: name the cursedDuo pair in bold with a one-liner roasting the partnership (they lost that many together). Skip this whole line if cursedDuo is null.
(blank line)
A short fun CLOSING line looking ahead to the next session.

Output: headline on line 1, then a blank line, then the body. Keep it tight, around 260 to 380 words total.`;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not set in environment variables." }, { status: 500 });
    }

    const promptContent = body.mode === "translate"
      ? buildTranslatePrompt({ title: body.title, content: body.content, targetLanguage: body.targetLanguage })
      : buildPrompt(body);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: promptContent }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return NextResponse.json({ error: err.error?.message || "Anthropic API error" }, { status: 500 });
    }

    const data = await response.json();
    const text = (data.content?.[0]?.text || "").trim();
    const nl = text.indexOf("\n");
    let title = (nl > -1 ? text.slice(0, nl) : text).replace(/^#+\s*/, "").trim();
    let content = nl > -1 ? text.slice(nl).trim() : "";

    const outputLanguage = body.mode === "translate" ? body.targetLanguage : body.language;
    const outputIsBangla = outputLanguage === "বাংলা" || outputLanguage === "Bangla" || outputLanguage === "bn";
    if (outputIsBangla) {
      title = toBnDigits(title);
      content = toBnDigits(content);
    } else {
      title = toEnDigits(title);
      content = toEnDigits(content);
    }
    return NextResponse.json({ title, content });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Unexpected error" }, { status: 500 });
  }
}
