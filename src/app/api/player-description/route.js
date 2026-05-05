import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request) {
  try {
    const body = await request.json();
    console.log("API called for player:", body.playerName);

    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is missing!");
      return Response.json({ error: "API key missing" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Write ONE short sentence (max 20 words) describing this carrom player's current form or playing style. Be creative and fun. Player: ${body.playerName}. Stats: ${body.played} matches, ${body.wins} wins, ${body.losses} losses, ${body.winRate}% win rate, streak: ${body.streak}. Return ONLY the sentence.`;

    const result = await model.generateContent(prompt);
    const description = result.response.text().trim();
    console.log("Generated:", description);

    return Response.json({ description });
  } catch (e) {
    console.error("API route error:", e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
