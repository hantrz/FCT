import { useState } from "react";

function PlayerAvatar({ player, size = 32 }) {
  if (player?.imageUrl) {
    return (
      <img src={player.imageUrl} alt={player.name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "0.5px solid var(--border)", flexShrink: 0 }} />
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.55, background: "var(--bg-secondary)", flexShrink: 0 }}>
      {player?.icon || "🎮"}
    </div>
  );
}

function getMonthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Bills({ players, bills, onSaveBill, onDeleteBill, isLoggedIn, isAdmin }) {
  const [period, setPeriod] = useState("alltime");
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payments, setPayments] = useState({});
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

  function filterBills(bs) {
    if (period === "currentMonth") return bs.filter(b => getMonthKey(b.date) === currentMonthKey);
    if (period === "lastMonth") return bs.filter(b => getMonthKey(b.date) === lastMonthKey);
    return bs;
  }

  const filteredBills = filterBills(bills);

  const playerTotals = {};
  const playerCounts = {};
  let grandTotal = 0;
  for (const p of players) {
    playerTotals[p.name] = 0;
    playerCounts[p.name] = 0;
  }
  for (const bill of filteredBills) {
    for (const [name, amt] of Object.entries(bill.payments || {})) {
      const amount = Number(amt) || 0;
      if (amount > 0) {
        playerTotals[name] = (playerTotals[name] || 0) + amount;
        playerCounts[name] = (playerCounts[name] || 0) + 1;
        grandTotal += amount;
      }
    }
  }

  const leaderboard = [...players]
    .map(p => ({ player: p, total: playerTotals[p.name] || 0, count: playerCounts[p.name] || 0 }))
    .sort((a, b) => b.total - a.total);

  const topPayer = leaderboard.find(r => r.total > 0);
  const neverPaid = leaderboard.filter(r => r.total === 0);

  const formTotal = Object.values(payments).reduce((s, v) => s + (Number(v) || 0), 0);

  async function handleSave() {
    if (formTotal === 0) return;
    setSaving(true);
    try {
      await onSaveBill({
        date: formDate,
        payments: Object.fromEntries(
          Object.entries(payments).map(([k, v]) => [k, Number(v) || 0])
        ),
        total: formTotal,
      });
      setPayments({});
      setFormDate(new Date().toISOString().slice(0, 10));
    } finally {
      setSaving(false);
    }
  }

  const periodLabel = { alltime: "All Time", currentMonth: "This Month", lastMonth: "Last Month" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* SECTION A: Period Filter */}
      <div style={{ display: "flex", gap: 6 }}>
        {["alltime", "currentMonth", "lastMonth"].map(p => (
          <button key={p}
            className={`btn${period === p ? " btn-active" : ""}`}
            onClick={() => setPeriod(p)}
            style={{ flex: 1, fontSize: 12, padding: "7px 8px" }}>
            {periodLabel[p]}
          </button>
        ))}
      </div>

      {/* SECTION B: Summary Stats */}
      <div className="metrics">
        <div className="metric">
          <label>Total Paid</label>
          <span>৳{grandTotal.toLocaleString()}</span>
        </div>
        <div className="metric" style={{ overflow: "hidden" }}>
          <label>Top Payer</label>
          {topPayer ? (
            <>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--green)", display: "block", lineHeight: 1.3 }}>{topPayer.player.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>৳{topPayer.total.toLocaleString()}</span>
            </>
          ) : (
            <span style={{ fontSize: 16 }}>—</span>
          )}
        </div>
        <div className="metric" style={{ overflow: "hidden" }}>
          <label>Never Paid ⚠</label>
          {neverPaid.length > 0 ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", display: "block", lineHeight: 1.4, wordBreak: "break-word" }}>
              {neverPaid.map(r => r.player.name).join(", ")}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: "var(--green)" }}>All paid ✓</span>
          )}
        </div>
      </div>

      {/* SECTION C: Payment Leaderboard */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th style={{ textAlign: "right" }}>Times</th>
              <th style={{ textAlign: "right" }}>Share</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map(({ player, total, count }) => {
              const share = grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
              const isZero = total === 0;
              return (
                <tr key={player.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <PlayerAvatar player={player} size={26} />
                      <span style={{ fontWeight: 600, color: isZero ? "var(--danger)" : "var(--text)", fontSize: 13 }}>
                        {player.name}
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: isZero ? "var(--danger)" : "var(--green)" }}>
                    ৳{total.toLocaleString()}
                  </td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>{count}</td>
                  <td style={{ textAlign: "right", fontSize: 12, color: "var(--text-muted)" }}>{share}%</td>
                  <td>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <div style={{ width: 48, height: 5, background: "var(--border)", borderRadius: 5, overflow: "hidden" }}>
                        <div style={{ width: `${share}%`, height: "100%", background: "linear-gradient(90deg, var(--green), #1dc400)", borderRadius: 5 }} />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* SECTION D: New Bill Entry */}
      {isLoggedIn && (
        <div className="card">
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Add Bill Entry</p>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Date</label>
            <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {players.map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <PlayerAvatar player={p} size={28} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, minWidth: 60 }}>{p.name}</span>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={payments[p.name] || ""}
                  onChange={e => setPayments(prev => ({ ...prev, [p.name]: e.target.value }))}
                  style={{ width: 90, textAlign: "right" }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>
              Total: <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 15 }}>৳{formTotal.toLocaleString()}</span>
            </span>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || formTotal === 0}>
              {saving ? "Saving…" : "Save Bill"}
            </button>
          </div>
        </div>
      )}

      {/* SECTION E: Session History */}
      <div>
        <p className="section-label">Bill History</p>
        {bills.length === 0 ? (
          <div className="empty"><p>No bill entries yet.</p></div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...bills].sort((a, b) => new Date(b.date) - new Date(a.date)).map(bill => (
              <div key={bill.id} className="match-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>{bill.date}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {Object.entries(bill.payments || {})
                      .filter(([, amt]) => Number(amt) > 0)
                      .map(([name, amt]) => (
                        <span key={name} style={{
                          background: "var(--green-light)", color: "var(--green-dark)",
                          border: "1px solid var(--border-strong)", borderRadius: 20,
                          fontSize: 11, fontWeight: 600, padding: "2px 8px",
                        }}>
                          {name} ৳{Number(amt).toLocaleString()}
                        </span>
                      ))}
                  </div>
                  <div style={{ marginTop: 5, fontSize: 12, color: "var(--text-muted)" }}>
                    Total: <span style={{ fontWeight: 700, color: "var(--text)" }}>৳{Number(bill.total).toLocaleString()}</span>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={() => onDeleteBill(bill.id)} style={{
                    background: "none", border: "none", cursor: "pointer", fontSize: 18,
                    color: "var(--text-muted)", padding: "2px 6px", fontFamily: "inherit",
                    lineHeight: 1, flexShrink: 0, touchAction: "manipulation",
                  }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
