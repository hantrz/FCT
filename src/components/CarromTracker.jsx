"use client";

import { useState, useEffect } from "react";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";

// ─── Color palette for player avatars ───────────────────────────────────────
const PALETTE = [
  "#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed",
  "#0891b2", "#be185d", "#65a30d", "#9333ea", "#0f766e",
];

function getInitials(name) {
  return name.trim().split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function Avatar({ id, name, allPlayers, size = 30 }) {
  const idx = allPlayers.findIndex((p) => p.id === id);
  const c = PALETTE[idx % PALETTE.length];
  const displayName = name || allPlayers.find((p) => p.id === id)?.name || "?";
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: c + "22",
        color: c,
      }}
    >
      {getInitials(displayName)}
    </div>
  );
}

function computeStats(players, matches) {
  return players
    .map((p) => {
      let played = 0, won = 0;
      for (const m of matches) {
        const inT1 = m.team1.includes(p.id);
        const inT2 = m.team2.includes(p.id);
        if (inT1 || inT2) {
          played++;
          if ((inT1 && m.winner === "team1") || (inT2 && m.winner === "team2")) won++;
        }
      }
      const winPct = played > 0 ? Math.round((won / played) * 100) : 0;
      return { ...p, played, won, lost: played - won, winPct };
    })
    .sort((a, b) => b.winPct - a.winPct || b.won - a.won || b.played - a.played);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Leaderboard({ players, matches }) {
  const stats = computeStats(players, matches);
  const thisWeek = matches.filter(
    (m) => m.createdAt && Date.now() - m.createdAt.toMillis() < 7 * 864e5
  ).length;

  return (
    <div>
      <div className="metrics">
        <div className="metric">
          <label>মোট ম্যাচ</label>
          <span>{matches.length}</span>
        </div>
        <div className="metric">
          <label>খেলোয়াড়</label>
          <span>{players.length}</span>
        </div>
        <div className="metric">
          <label>এই সপ্তাহে</label>
          <span>{thisWeek}</span>
        </div>
      </div>

      {stats.length === 0 ? (
        <div className="empty">
          <p>এখনো কোনো ডেটা নেই</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>নাম</th>
                <th style={{ width: 56, textAlign: "center" }}>খেলা</th>
                <th style={{ width: 48, textAlign: "center" }}>জিত</th>
                <th style={{ width: 48, textAlign: "center" }}>হার</th>
                <th style={{ width: 96, textAlign: "right" }}>জয়%</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((p, i) => (
                <tr key={p.id}>
                  <td className="text-muted">{i + 1}</td>
                  <td>
                    <div className="flex-center gap-2">
                      <Avatar id={p.id} allPlayers={players} size={28} />
                      <span style={{ fontWeight: i < 3 ? 600 : 400 }}>{p.name}</span>
                      {i === 0 && p.played > 0 && (
                        <span className="badge badge-top">শীর্ষে</span>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: "center" }}>{p.played}</td>
                  <td style={{ textAlign: "center" }} className="text-success">
                    {p.won}
                  </td>
                  <td style={{ textAlign: "center" }} className="text-danger">
                    {p.lost}
                  </td>
                  <td>
                    <div className="win-bar-wrap">
                      <div className="win-bar">
                        <div
                          className="win-bar-fill"
                          style={{ width: `${p.winPct}%` }}
                        />
                      </div>
                      <span className="win-pct">{p.winPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewMatch({ players, onSave }) {
  const [fmt, setFmt] = useState("1v1");
  const [t1, setT1] = useState([""]);
  const [t2, setT2] = useState([""]);
  const [winner, setWinner] = useState(null);
  const [saving, setSaving] = useState(false);

  function changeFmt(f) {
    setFmt(f);
    setT1(f === "1v1" ? [""] : ["", ""]);
    setT2(f === "1v1" ? [""] : ["", ""]);
    setWinner(null);
  }

  function setSlot(team, idx, val) {
    if (team === 1) {
      const next = [...t1]; next[idx] = val; setT1(next);
    } else {
      const next = [...t2]; next[idx] = val; setT2(next);
    }
    setWinner(null);
  }

  const t1ok = t1.every(Boolean);
  const t2ok = t2.every(Boolean);
  const canSave = t1ok && t2ok && winner;

  // Filter out already-selected players from dropdowns
  function availableFor(team, idx) {
    const otherT1 = t1.filter((_, i) => i !== idx);
    const otherT2 = t2.filter((_, i) => i !== idx);
    const excluded =
      team === 1 ? [...otherT1, ...t2] : [...otherT2, ...t1];
    return players.filter((p) => !excluded.includes(p.id));
  }

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    await onSave({ type: fmt, team1: t1, team2: t2, winner });
    changeFmt("1v1");
    setSaving(false);
  }

  const t1Label = t1.map((id) => players.find((p) => p.id === id)?.name || "?").join(" & ");
  const t2Label = t2.map((id) => players.find((p) => p.id === id)?.name || "?").join(" & ");

  if (players.length < 2) {
    return (
      <div className="empty">
        <p>ম্যাচ রেকর্ড করতে কমপক্ষে ২ জন খেলোয়াড় দরকার</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 460 }}>
      {/* Format */}
      <div style={{ marginBottom: "1.5rem" }}>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
          ফরম্যাট
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {["1v1", "2v2"].map((f) => (
            <button
              key={f}
              className={`btn btn-format ${fmt === f ? "active" : ""}`}
              onClick={() => changeFmt(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Teams */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: "1.5rem" }}>
        {[1, 2].map((team) => {
          const slots = team === 1 ? t1 : t2;
          return (
            <div key={team}>
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
                দল {team}
              </p>
              {slots.map((val, i) => (
                <select
                  key={i}
                  value={val}
                  onChange={(e) => setSlot(team, i, e.target.value)}
                  style={{ marginBottom: 8 }}
                >
                  <option value="">খেলোয়াড় বেছে নিন</option>
                  {availableFor(team, i).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          );
        })}
      </div>

      {/* Winner */}
      {t1ok && t2ok && (
        <div style={{ marginBottom: "1.5rem" }}>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
            বিজয়ী কে?
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { key: "team1", label: t1Label },
              { key: "team2", label: t2Label },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setWinner(key)}
                className={`btn ${winner === key ? "btn-active" : ""}`}
                style={{ padding: "10px 8px", fontSize: 13 }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ width: "100%", padding: "12px", fontSize: 14 }}
        onClick={handleSave}
        disabled={!canSave || saving}
      >
        {saving ? "সেভ হচ্ছে..." : "ম্যাচ সেভ করুন"}
      </button>
    </div>
  );
}

function Players({ players, matches, onAdd, onRemove }) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const stats = computeStats(players, matches);

  async function handleAdd() {
    if (!name.trim() || adding) return;
    setAdding(true);
    await onAdd(name.trim());
    setName("");
    setAdding(false);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="নতুন খেলোয়াড়ের নাম লিখুন"
          style={{ flex: 1 }}
        />
        <button className="btn" onClick={handleAdd} disabled={adding}>
          {adding ? "..." : "যোগ করুন"}
        </button>
      </div>

      {players.length === 0 ? (
        <div className="empty">
          <p>এখনো কোনো খেলোয়াড় যোগ করা হয়নি</p>
        </div>
      ) : (
        <div className="players-grid">
          {players.map((p, i) => {
            const st = stats.find((s) => s.id === p.id) || { played: 0, winPct: 0 };
            const c = PALETTE[i % PALETTE.length];
            return (
              <div key={p.id} className="player-card">
                <button
                  onClick={() => onRemove(p.id)}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 20,
                    color: "var(--text-muted)",
                    lineHeight: 1,
                    padding: "2px 6px",
                    fontFamily: "inherit",
                  }}
                  title="সরিয়ে দিন"
                >
                  ×
                </button>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: c + "22",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 10,
                    fontSize: 17,
                    fontWeight: 700,
                    color: c,
                  }}
                >
                  {getInitials(p.name)}
                </div>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                  {p.name}
                </p>
                <p className="text-muted" style={{ fontSize: 12 }}>
                  {st.played} ম্যাচ · {st.winPct}% জয়
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function History({ players, matches, onDelete }) {
  if (matches.length === 0) {
    return (
      <div className="empty">
        <p>এখনো কোনো ম্যাচ রেকর্ড করা হয়নি</p>
      </div>
    );
  }

  function getName(id) {
    return players.find((p) => p.id === id)?.name || "?";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {matches.map((m) => {
        const t1Names = m.team1.map(getName).join(" & ");
        const t2Names = m.team2.map(getName).join(" & ");
        const w1 = m.winner === "team1";
        const date = m.createdAt
          ? m.createdAt.toDate().toLocaleDateString("bn-BD", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "—";

        return (
          <div key={m.id} className="match-item">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: w1 ? 600 : 400,
                    color: w1 ? "var(--success)" : "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {w1 && (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <polygon
                        points="6,1 7.5,4.5 11,5 8.5,7.5 9.2,11 6,9.3 2.8,11 3.5,7.5 1,5 4.5,4.5"
                        fill="currentColor"
                      />
                    </svg>
                  )}
                  {t1Names}
                </span>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  vs
                </span>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: !w1 ? 600 : 400,
                    color: !w1 ? "var(--success)" : "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {!w1 && (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <polygon
                        points="6,1 7.5,4.5 11,5 8.5,7.5 9.2,11 6,9.3 2.8,11 3.5,7.5 1,5 4.5,4.5"
                        fill="currentColor"
                      />
                    </svg>
                  )}
                  {t2Names}
                </span>
              </div>
              <p className="text-muted" style={{ fontSize: 12 }}>
                {date} · {m.type}
              </p>
            </div>
            <button
              onClick={() => onDelete(m.id)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 20,
                color: "var(--text-muted)",
                padding: "2px 6px",
                fontFamily: "inherit",
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function CarromTracker() {
  const [tab, setTab] = useState("board");
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [synced, setSynced] = useState(false);

  // ── Real-time Firestore listeners ──
  useEffect(() => {
    const unsubPlayers = onSnapshot(
      query(collection(db, "players"), orderBy("createdAt", "asc")),
      (snap) => {
        setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setSynced(true);
      }
    );

    const unsubMatches = onSnapshot(
      query(collection(db, "matches"), orderBy("createdAt", "desc")),
      (snap) => {
        setMatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );

    return () => {
      unsubPlayers();
      unsubMatches();
    };
  }, []);

  async function addPlayer(name) {
    await addDoc(collection(db, "players"), {
      name,
      createdAt: serverTimestamp(),
    });
  }

  async function removePlayer(id) {
    if (!confirm("এই খেলোয়াড়কে সরিয়ে দেবেন?")) return;
    await deleteDoc(doc(db, "players", id));
  }

  async function saveMatch(data) {
    await addDoc(collection(db, "matches"), {
      ...data,
      createdAt: serverTimestamp(),
    });
    setTab("board");
  }

  async function deleteMatch(id) {
    if (!confirm("এই ম্যাচটি মুছে দেবেন?")) return;
    await deleteDoc(doc(db, "matches", id));
  }

  const TABS = [
    { k: "board", l: "লিডারবোর্ড" },
    { k: "match", l: "নতুন ম্যাচ" },
    { k: "players", l: "খেলোয়াড়" },
    { k: "history", l: "ইতিহাস" },
  ];

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="header-icon">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="10" cy="10" r="2.5" fill="currentColor" />
            <circle cx="6" cy="6" r="1.5" fill="currentColor" opacity="0.4" />
            <circle cx="14" cy="14" r="1.5" fill="currentColor" opacity="0.4" />
          </svg>
        </div>
        <div>
          <h1>Carrom Tracker</h1>
          <p>{players.length} জন খেলোয়াড় · {matches.length}টি ম্যাচ</p>
        </div>
      </div>

      {/* Sync status */}
      <div className="status-bar">
        <span className={`sync-dot ${synced ? "live" : "loading"}`} />
        {synced ? "রিয়েলটাইম সিঙ্ক চালু" : "কানেক্ট হচ্ছে..."}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(({ k, l }) => (
          <button
            key={k}
            className={`tab-btn ${tab === k ? "active" : ""}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "board" && <Leaderboard players={players} matches={matches} />}
      {tab === "match" && (
        <NewMatch players={players} onSave={saveMatch} />
      )}
      {tab === "players" && (
        <Players
          players={players}
          matches={matches}
          onAdd={addPlayer}
          onRemove={removePlayer}
        />
      )}
      {tab === "history" && (
        <History players={players} matches={matches} onDelete={deleteMatch} />
      )}
    </div>
  );
}
