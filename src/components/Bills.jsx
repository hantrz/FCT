import { useState, useEffect, useRef, useMemo } from "react";
import { getSeasonId, getSeasonDateRange, getSeasonNumber } from "../lib/seasons";

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

// Determines which season a bill belongs to, based on its date string (YYYY-MM-DD).
// Parsed at noon local time to avoid timezone edge cases shifting the date.
function getBillSeasonId(bill) {
  if (!bill?.date) return null;
  const [y, m, d] = bill.date.split("-").map(Number);
  if (!y || !m || !d) return null;
  return getSeasonId(new Date(y, m - 1, d, 12, 0, 0));
}

function formatBillTimestamp(ts) {
  if (!ts) return null;
  let date;
  if (typeof ts.toMillis === "function") date = new Date(ts.toMillis());
  else if (ts.seconds) date = new Date(ts.seconds * 1000);
  else if (ts instanceof Date) date = ts;
  else return null;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const bdOffset = 6 * 60;
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  const bd = new Date(utc + bdOffset * 60000);
  const day = bd.getDate();
  const month = months[bd.getMonth()];
  const year = bd.getFullYear();
  let hours = bd.getHours();
  const minutes = bd.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
}

export default function Bills({ players, bills, onSaveBill, onDeleteBill, isLoggedIn, isAdmin, loggedInPlayerName }) {
  const [seasonView, setSeasonView] = useState("current"); // "current" | "alltime" | "past"
  const [selectedPastSeason, setSelectedPastSeason] = useState("");
  const [showSeasonDropdown, setShowSeasonDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payments, setPayments] = useState({});
  const [saving, setSaving] = useState(false);

  const currentSeasonId = getSeasonId(new Date());

  const pastSeasons = useMemo(() => {
    const ids = Array.from(new Set(bills.map(b => getBillSeasonId(b)).filter(Boolean)));
    return ids.sort((a, b) => getSeasonDateRange(b).start - getSeasonDateRange(a).start);
  }, [bills]);

  useEffect(() => {
    if (!showSeasonDropdown) return;
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowSeasonDropdown(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSeasonDropdown]);

  function filterBills(bs) {
    if (seasonView === "alltime") return bs;
    if (seasonView === "past") {
      const target = selectedPastSeason || pastSeasons[0] || currentSeasonId;
      return bs.filter(b => getBillSeasonId(b) === target);
    }
    return bs.filter(b => getBillSeasonId(b) === currentSeasonId);
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
        addedBy: loggedInPlayerName || "Unknown",
      });
      setPayments({});
      setFormDate(new Date().toISOString().slice(0, 10));
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* SECTION A: Season Filter (mirrors Leaderboard) */}
      <div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button
            onClick={() => { setSeasonView("current"); setShowSeasonDropdown(false); }}
            className="btn"
            style={{
              flex: 1, fontSize: 12, padding: "7px 8px",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              background: seasonView === "current" ? "#16a34a" : "#ffffff",
              color: seasonView === "current" ? "#ffffff" : "#374151",
              border: seasonView === "current" ? "1.5px solid #16a34a" : "1.5px solid #d1d5db",
            }}
          >
            <span className="live-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: seasonView === "current" ? "#ffffff" : "#16a34a", flexShrink: 0 }} />
            Current Season
          </button>
          <button
            onClick={() => { setSeasonView("alltime"); setShowSeasonDropdown(false); }}
            className="btn"
            style={{
              flex: 1, fontSize: 12, padding: "7px 8px",
              background: seasonView === "alltime" ? "#16a34a" : "#ffffff",
              color: seasonView === "alltime" ? "#ffffff" : "#374151",
              border: seasonView === "alltime" ? "1.5px solid #16a34a" : "1.5px solid #d1d5db",
            }}
          >All Time</button>
          <div ref={dropdownRef} style={{ position: "relative", flex: 1 }}>
            <button
              onClick={() => { setSeasonView("past"); setShowSeasonDropdown(prev => !prev); }}
              className="btn"
              style={{
                width: "100%", fontSize: 12, padding: "7px 8px",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                background: seasonView === "past" ? "#16a34a" : "#ffffff",
                color: seasonView === "past" ? "#ffffff" : "#374151",
                border: seasonView === "past" ? "1.5px solid #16a34a" : "1.5px solid #d1d5db",
              }}
            >
              All Seasons
              <span style={{ fontSize: 10, display: "inline-block", transform: showSeasonDropdown ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
            </button>
            {showSeasonDropdown && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0,
                background: "var(--bg)", borderRadius: 10,
                border: "1px solid var(--border)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                zIndex: 200, minWidth: 160, overflow: "hidden",
              }}>
                {pastSeasons.length === 0 ? (
                  <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-muted)" }}>No bill history yet</div>
                ) : pastSeasons.map((s, i) => (
                  <button key={s}
                    onClick={() => { setSelectedPastSeason(s); setShowSeasonDropdown(false); }}
                    style={{
                      width: "100%", padding: "10px 14px", textAlign: "left",
                      border: "none", borderBottom: i < pastSeasons.length - 1 ? "1px solid var(--border)" : "none",
                      background: s === (selectedPastSeason || pastSeasons[0]) ? "var(--bg-secondary)" : "transparent",
                      color: "var(--text)", fontSize: 13, fontWeight: 500,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--bg-secondary)"}
                    onMouseLeave={e => e.currentTarget.style.background = s === (selectedPastSeason || pastSeasons[0]) ? "var(--bg-secondary)" : "transparent"}
                  >{(() => {
                    const num = getSeasonNumber(s);
                    const isLive = s === currentSeasonId;
                    const label = num === 0 ? `Season 0 (Archive) (${s})` : num !== null ? `Season ${num} (${s})` : s;
                    return isLive ? `${label} 🟢 LIVE` : label;
                  })()}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
          {seasonView === "alltime" && "All Time"}
          {seasonView === "current" && (() => {
            const num = getSeasonNumber(currentSeasonId);
            return num !== null ? `Season ${num}: ${currentSeasonId}` : currentSeasonId;
          })()}
          {seasonView === "past" && (() => {
            const sid = selectedPastSeason || pastSeasons[0] || currentSeasonId;
            const num = getSeasonNumber(sid);
            return num !== null ? `Season ${num}: ${sid}` : sid;
          })()}
        </div>
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
        <div className="metric">
          <label>Avg / Session</label>
          <span>{filteredBills.length > 0 ? `৳${Math.round(grandTotal / filteredBills.length).toLocaleString()}` : "৳0"}</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginTop: 2, opacity: 0.75 }}>Total {filteredBills.length} session</span>
        </div>
      </div>

      {/* SECTION C: Payment Leaderboard */}
      <style>{`
        @media (max-width: 640px) {
          .bills-col-times, .bills-col-share, .bills-col-bar { display: none; }
          .bills-mobile-sub { display: block; }
        }
        @media (min-width: 641px) {
          .bills-mobile-sub { display: none; }
        }
      `}</style>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>No</th>
              <th>Player</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th className="bills-col-times" style={{ textAlign: "right" }}>Times</th>
              <th className="bills-col-share" style={{ textAlign: "right" }}>Share</th>
              <th className="bills-col-bar" style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map(({ player, total, count }, idx) => {
              const share = grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
              const isZero = total === 0;
              const rankColor = idx === 0 ? "#e07b20" : idx <= 2 ? "#1a9e1a" : "var(--text-muted)";
              return (
                <tr key={player.id}>
                  <td style={{ fontWeight: 700, fontSize: 13, color: rankColor, verticalAlign: "top", paddingTop: 11 }}>{idx + 1}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <PlayerAvatar player={player} size={26} />
                      <span style={{ fontWeight: 600, color: isZero ? "var(--danger)" : "var(--text)", fontSize: 13, whiteSpace: "nowrap" }}>
                        {player.name}
                      </span>
                    </div>
                    <div className="bills-mobile-sub" style={{ marginTop: 5, paddingLeft: 33 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{count} times · {share}%</span>
                      <div style={{ marginTop: 4, height: 5, background: "var(--border)", borderRadius: 5, overflow: "hidden" }}>
                        <div style={{ width: `${share}%`, height: "100%", background: "linear-gradient(90deg, var(--green), #1dc400)", borderRadius: 5 }} />
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: isZero ? "var(--danger)" : "var(--green)", verticalAlign: "top", paddingTop: 11 }}>
                    ৳{total.toLocaleString()}
                  </td>
                  <td className="bills-col-times" style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>{count}</td>
                  <td className="bills-col-share" style={{ textAlign: "right", fontSize: 12, color: "var(--text-muted)" }}>{share}%</td>
                  <td className="bills-col-bar">
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
        <>
          <button
            className={`btn${showForm ? "" : " btn-primary"}`}
            onClick={() => setShowForm(v => !v)}
            style={{ width: "100%", fontSize: 14, fontWeight: 700, padding: "10px 16px" }}>
            {showForm ? "✕ Cancel" : "＋ Add Bill Entry"}
          </button>
          {showForm && (
            <div className="card">
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
        </>
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
                  {(bill.addedBy || bill.createdAt) && (
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 3 }}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.6 }}>
                        <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      {[bill.addedBy && `Added by ${bill.addedBy}`, formatBillTimestamp(bill.createdAt)].filter(Boolean).join(" · ")}
                    </p>
                  )}
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
