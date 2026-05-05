import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request) {
  const { playerName, played, wins, losses, winRate, hatTricks, cleanWins, cleanLosses, streak } = await request.json();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `Write ONE short sentence (max 20 words) describing this carrom player's current form or playing style based on stats. Be creative, fun and specific. Player: ${playerName}. Stats: ${played} matches, ${wins} wins, ${losses} losses, ${winRate}% win rate, streak: ${streak}, hat-tricks: ${hatTricks}, clean wins: ${cleanWins}, clean losses: ${cleanLosses}. Return ONLY the sentence, no quotes, no extra text.`;

  const result = await model.generateContent(prompt);
  const description = result.response.text().trim();

  return Response.json({ description });
}
