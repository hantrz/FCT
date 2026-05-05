import Anthropic from "@anthropic-ai/sdk";

export async function POST(request) {
  const { playerName, played, wins, losses, winRate, hatTricks, cleanWins, cleanLosses, streak } = await request.json();
  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 80,
    messages: [{
      role: "user",
      content: `Write a single short sentence (max 20 words) describing this carrom player's playing style or form based on their stats. Be creative and fun. Player: ${playerName}. Stats: ${played} matches played, ${wins} wins, ${losses} losses, ${winRate}% win rate, current streak: ${streak}, hat-tricks: ${hatTricks}, clean wins: ${cleanWins}, clean losses: ${cleanLosses}. Return ONLY the description sentence, nothing else.`
    }]
  });
  return Response.json({ description: message.content[0].text });
}
