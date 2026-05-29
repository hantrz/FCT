const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccount.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Tier 1: matches 1-10,  Win +5, Loss -2
// Tier 2: matches 11-25, Win +4, Loss -2
// Tier 3: matches 26+,   Win +3, Loss -2
const TIERS = [
  { label: "T1", win: 5, loss: -2 },
  { label: "T2", win: 4, loss: -2 },
  { label: "T3", win: 3, loss: -2 },
];

function getTier(matchNumber) {
  if (matchNumber <= 10) return TIERS[0];
  if (matchNumber <= 25) return TIERS[1];
  return TIERS[2];
}

async function main() {
  const [playersSnap, matchesSnap] = await Promise.all([
    db.collection("players").orderBy("createdAt", "asc").get(),
    db.collection("matches").orderBy("createdAt", "asc").get(),
  ]);

  const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log(`\nTier Score Calculation (${players.length} players, ${matches.length} matches)\n`);

  players.forEach(player => {
    const playerMatches = matches.filter(
      m => (m.team1 || []).includes(player.id) || (m.team2 || []).includes(player.id)
    );

    const counts = { T1: { wins: 0, losses: 0 }, T2: { wins: 0, losses: 0 }, T3: { wins: 0, losses: 0 } };
    let total = 0;

    playerMatches.forEach((m, idx) => {
      const tier = getTier(idx + 1);
      const inT1 = (m.team1 || []).includes(player.id);
      const won = (inT1 && m.winner === "team1") || (!inT1 && m.winner === "team2");
      counts[tier.label][won ? "wins" : "losses"]++;
      total += won ? tier.win : tier.loss;
    });

    const breakdown = TIERS
      .map((t, i) => {
        const c = counts[t.label];
        if (c.wins === 0 && c.losses === 0) return null;
        const pts = c.wins * t.win + c.losses * t.loss;
        return `${t.label}(${c.wins}W-${c.losses}L):${pts >= 0 ? "+" : ""}${pts}`;
      })
      .filter(Boolean)
      .join(", ");

    console.log(`${player.name}: ${breakdown || "no matches"} = ${total}`);
  });

  console.log("\nDone.");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
