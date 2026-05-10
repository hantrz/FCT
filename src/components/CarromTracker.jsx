"use client";

import { useState, useEffect, useRef } from "react";
import {
  collection, addDoc, deleteDoc, doc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp, deleteField,
} from "firebase/firestore";
import { db } from "../lib/firebase";

async function fileToResizedBase64(file, maxSize = 200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) { height *= maxSize / width; width = maxSize; }
        } else {
          if (height > maxSize) { width *= maxSize / height; height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const PALETTE = [
  "#14a800","#D4A017","#2563eb","#dc2626","#7c3aed",
  "#0891b2","#059669","#d97706","#9333ea","#0f766e",
];

const AVATAR_ICONS = [
  "😀","😎","🤩","🥷","👑","🦁","🐯","🦊","🐺","🐻",
  "🦅","🦄","🐉","🔥","⚡","🌟","💎","🎯","🏆","🎲",
];

function computeStats(players, matches) {
  return players.map((p) => {
    let played = 0, won = 0;
    for (const m of matches) {
      const inT1 = m.team1.includes(p.id), inT2 = m.team2.includes(p.id);
      if (inT1 || inT2) {
        played++;
        if ((inT1 && m.winner === "team1") || (inT2 && m.winner === "team2")) won++;
      }
    }
    const winPct = played > 0 ? Math.round((won / played) * 100) : 0;
    return { ...p, played, won, lost: played - won, winPct };
  }).sort((a, b) => b.winPct - a.winPct || b.won - a.won || b.played - a.played);
}

function getStreak(playerId, matches) {
  const pm = [...matches]
    .filter(m => m.team1.includes(playerId) || m.team2.includes(playerId))
    .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
  if (!pm.length) return "—";
  let streak = 0, type = null;
  for (const m of pm) {
    const inT1 = m.team1.includes(playerId);
    const won = (inT1 && m.winner === "team1") || (!inT1 && m.winner === "team2");
    const cur = won ? "W" : "L";
    if (!type) type = cur;
    if (cur === type) streak++; else break;
  }
  return `${streak}${type}`;
}

function Avatar({ id, allPlayers, size = 30 }) {
  const player = allPlayers.find(p => p.id === id);
  const idx = allPlayers.findIndex(p => p.id === id);
  const c = PALETTE[idx % PALETTE.length];
  if (!player) return null;
  if (player.imageUrl) {
    return (
      <img src={player.imageUrl} alt={player.name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: `1.5px solid ${c}40`, flexShrink: 0 }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: c + "20", color: c,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: player.icon ? Math.round(size * 0.52) : Math.round(size * 0.36),
      fontWeight: 700, flexShrink: 0, border: `1.5px solid ${c}40`,
    }}>
      {player.icon || (player.name || "?").trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2)}
    </div>
  );
}

function calcBadges(playerId, matches) {
  const pm = [...matches]
    .filter(m => (m.team1 || []).includes(playerId) || (m.team2 || []).includes(playerId))
    .sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
  let hatTricks = 0, lossTricks = 0, winStreak = 0, lossStreak = 0, cleanWins = 0, cleanLosses = 0;
  for (const m of pm) {
    const inT1 = (m.team1 || []).includes(playerId);
    const isWinner = (inT1 && m.winner === "team1") || (!inT1 && m.winner === "team2");
    if (isWinner) {
      winStreak++;
      lossStreak = 0;
      if (winStreak === 3) { hatTricks++; winStreak = 0; }
      if (m.loserScore === 0) cleanWins++;
    } else {
      lossStreak++;
      winStreak = 0;
      if (lossStreak === 3) { lossTricks++; lossStreak = 0; }
      if (m.loserScore === 0) cleanLosses++;
    }
  }
  return { hatTricks, lossTricks, cleanWins, cleanLosses };
}

function generatePlayerDescription(played, wins, losses, winRate, hatTricks, cleanWins, cleanLosses, streak, streakType) {
  if (played === 0) return "No matches yet — the journey begins!";
  if (winRate === 100 && played >= 3) return `Unbeatable so far — ${played} matches, zero defeats.`;
  if (winRate === 0 && played >= 3) return `Tough times, but every legend has a comeback story.`;
  if (streakType === "W" && streak >= 5) return `On fire! ${streak} wins in a row — absolutely unstoppable.`;
  if (streakType === "W" && streak >= 3) return `${streak}-game winning streak — riding high right now.`;
  if (streakType === "L" && streak >= 4) return `${streak} losses in a row — a big win is long overdue.`;
  if (hatTricks >= 2) return `${hatTricks} hat-tricks earned — knows how to string wins together.`;
  if (hatTricks === 1) return `A hat-trick achieved — capable of going on serious runs.`;
  if (cleanWins >= 3) return `Dominant and clinical — ${cleanWins} times kept opponents scoreless.`;
  if (cleanLosses >= 3) return `Struggles to get on the board, but never stops showing up.`;
  if (winRate >= 75) return `One of the sharpest players with a ${winRate}% win rate.`;
  if (winRate >= 60) return `Solid and consistent — wins more often than not.`;
  if (winRate >= 40) return `A balanced competitor — every match is a real contest.`;
  return `Building experience with every game — the wins will come.`;
}

function PlayerAvatar({ player, size = 40 }) {
  if (player?.imageUrl) {
    return (
      <img src={player.imageUrl} alt={player.name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "0.5px solid var(--border)", flexShrink: 0 }} />
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.55, background: "var(--bg-secondary, #f3f4f6)", flexShrink: 0 }}>
      {player?.icon || "🎮"}
    </div>
  );
}

// ── PlayerSelect ──────────────────────────────────────────────────────────────
function PlayerSelect({ players, value, onChange, placeholder = "Select player", disabled = false, excludeIds = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selectedPlayer = players.find(p => p.id === value);
  const availablePlayers = players.filter(p => !excludeIds.includes(p.id) || p.id === value);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          border: "0.5px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "inherit",
          fontSize: 14,
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          outline: open ? "2px solid var(--border-strong)" : "none",
          minHeight: 40
        }}
      >
        {selectedPlayer ? (
          <>
            <PlayerAvatar player={selectedPlayer} size={24} />
            <span style={{ flex: 1, fontWeight: 500 }}>{selectedPlayer.name}</span>
          </>
        ) : (
          <span style={{ flex: 1, color: "var(--text-muted)" }}>{placeholder}</span>
        )}
        <span style={{ fontSize: 10, color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
      </button>

      {open && !disabled && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          background: "var(--bg)",
          border: "0.5px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          maxHeight: 280,
          overflowY: "auto",
          zIndex: 100
        }}>
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              border: "none",
              background: !value ? "var(--bg-secondary)" : "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 14,
              textAlign: "left",
              borderBottom: "0.5px solid var(--border)"
            }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--bg-secondary)"}
            onMouseLeave={e => e.currentTarget.style.background = !value ? "var(--bg-secondary)" : "transparent"}
          >
            {placeholder}
          </button>
          {availablePlayers.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.id); setOpen(false); }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                border: "none",
                background: p.id === value ? "var(--bg-secondary)" : "transparent",
                color: "var(--text)",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 14,
                textAlign: "left"
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--bg-secondary)"}
              onMouseLeave={e => e.currentTarget.style.background = p.id === value ? "var(--bg-secondary)" : "transparent"}
            >
              <PlayerAvatar player={p} size={24} />
              <span style={{ flex: 1, fontWeight: p.id === value ? 600 : 400 }}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function Leaderboard({ players, matches, onSelectPlayer, onNavigateToStats }) {
  const [sortBy, setSortBy] = useState("points");
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth <= 600);
  const [tooltip, setTooltip] = useState(null);
  const [guideTab, setGuideTab] = useState("points"); // "badges" | "points" | "spin"
  const isDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const guideColors = isDark ? {
    cardBg:      "#0f1f17",
    cardBorder:  "#1f3a2c",
    headerBg:    "#1a2e23",
    headerBorder:"#2a4435",
    separator:   "#1f3a2c",
    labelText:   "#d1d5db",
    noteText:    "#9ca3af",
    inactiveTab: "#9ca3af"
  } : {
    cardBg:      "#f0f7ee",
    cardBorder:  "#dfeeda",
    headerBg:    "#dfeeda",
    headerBorder:"#c8debf",
    separator:   "#d8e6cf",
    labelText:   "#374151",
    noteText:    "#6b7280",
    inactiveTab: "#6b7280"
  };

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const raw = computeStats(players, matches);
  const stats = raw.map(p => {
    const badges = calcBadges(p.id, matches);
    const points = 10
      + (p.won * 3)
      + (p.lost * -2)
      + (badges.cleanWins * 2)
      + (badges.cleanLosses * -3)
      + (badges.hatTricks * 3)
      + (badges.lossTricks * -3);
    return { ...p, points };
  });
  const sorted = [...stats].sort((a, b) => {
    if (sortBy === "points")   return b.points - a.points;
    if (sortBy === "winrate")  return b.winPct - a.winPct;
    if (sortBy === "matches")  return b.played - a.played;
    if (sortBy === "wins")     return b.won - a.won;
    if (sortBy === "losses") {
      const lossDiff = b.lost - a.lost;
      if (lossDiff !== 0) return lossDiff;
      const aRate = a.played > 0 ? a.lost / a.played : 0;
      const bRate = b.played > 0 ? b.lost / b.played : 0;
      return bRate - aRate;
    }
    return 0;
  });

  const thisWeek = matches.filter(m => m.createdAt && Date.now() - m.createdAt.toMillis() < 7 * 864e5).length;
  const rankClass = i => i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : "text-muted";
  const rankColors = ["#f59e0b", "#9ca3af", "#cd7c41"];

  const SORT_OPTIONS = [
    { k: "points",  l: "Points" },
    { k: "winrate", l: "Win %" },
    { k: "matches", l: "Matches" },
    { k: "wins",    l: "Wins" },
    { k: "losses",  l: "Losses" },
  ];

  function goToPlayer(id) {
    if (onSelectPlayer && onNavigateToStats) {
      onSelectPlayer(id);
      onNavigateToStats();
    }
  }

  const sortPills = (
    <div style={{ display: "flex", gap: 8, marginBottom: "1rem", overflowX: "auto", paddingBottom: 2 }}>
      {SORT_OPTIONS.map(({ k, l }) => (
        <button key={k} onClick={() => setSortBy(k)} style={{
          padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0,
          background: sortBy === k ? "#16a34a" : "#ffffff",
          color: sortBy === k ? "#ffffff" : "#374151",
          border: sortBy === k ? "1.5px solid #16a34a" : "1.5px solid #d1d5db",
        }}>{l}</button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="metrics">
        <div className="metric"><label>Total Matches</label><span>{matches.length}</span></div>
        <div className="metric"><label>Players</label><span>{players.length}</span></div>
        <div className="metric"><label>This Week</label><span>{thisWeek}</span></div>
      </div>
      {stats.length === 0 ? (
        <div className="empty"><p>No data yet. Add players and record matches!</p></div>
      ) : (
        <>
          {sortPills}
          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sorted.map((p, i) => {
                const rankColor = i < 3 ? rankColors[i] : "var(--text-muted)";
                const ptsColor = i < 3 ? "#f59e0b" : "var(--text)";
                const badges = calcBadges(p.id, matches);
                return (
                  <div key={p.id} onClick={() => goToPlayer(p.id)} style={{
                    background: "var(--card-bg)", borderRadius: 14,
                    border: "1px solid var(--border)", padding: "10px 14px",
                    display: "flex", alignItems: "center", gap: 10,
                    cursor: onSelectPlayer ? "pointer" : "default",
                  }}>
                    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", width: 24 }}>
                      {(() => {
                        const rank = i + 1;
                        const isTop3 = sortBy !== "losses" && rank <= 3;
                        const rankColors = { 1: "#d97706", 2: "#64748b", 3: "#b45309" };
                        return (
                          <span style={{ fontWeight: isTop3 ? 900 : 700, fontSize: isTop3 ? 18 : 14, color: isTop3 ? rankColors[rank] : "var(--color-text-primary)", lineHeight: 1 }}>
                            {rank}
                          </span>
                        );
                      })()}
                    </div>
                    <PlayerAvatar player={p} size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.name}{i === 0 && p.played > 0 && (sortBy === "losses" ? " 💩" : " 🏆")}
                        </span>
                        {badges.hatTricks > 0 && (
                          <span style={{ position:"relative", display:"inline-flex" }} onMouseEnter={() => setTooltip(`${p.id}-fire`)} onMouseLeave={() => setTooltip(null)}>
                            <span style={{ fontSize:11, borderRadius:20, padding:"1px 6px", fontWeight:600, background:"#fff7ed", color:"#c2410c", border:"0.5px solid #fed7aa" }}>{badges.hatTricks} 🔥</span>
                            {tooltip === `${p.id}-fire` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>🔥 Hat-trick!<br/>{badges.hatTricks === 1 ? "1 hat-trick achieved" : `${badges.hatTricks} hat-tricks achieved`}<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
                          </span>
                        )}
                        {badges.cleanWins > 0 && (
                          <span style={{ position:"relative", display:"inline-flex" }} onMouseEnter={() => setTooltip(`${p.id}-clean-win`)} onMouseLeave={() => setTooltip(null)}>
                            <span style={{ fontSize:11, borderRadius:20, padding:"1px 6px", fontWeight:600, background:"#dbeafe", color:"#1d4ed8", border:"0.5px solid #93c5fd" }}>{badges.cleanWins} 💎</span>
                            {tooltip === `${p.id}-clean-win` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>💎 Clean Win<br/>Won with opponent scoring 0<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
                          </span>
                        )}
                        {badges.cleanLosses > 0 && (
                          <span style={{ position:"relative", display:"inline-flex" }} onMouseEnter={() => setTooltip(`${p.id}-clean-loss`)} onMouseLeave={() => setTooltip(null)}>
                            <span style={{ fontSize:11, borderRadius:20, padding:"1px 6px", fontWeight:600, background:"#fee2e2", color:"#dc2626", border:"0.5px solid #fca5a5" }}>{badges.cleanLosses} 💎</span>
                            {tooltip === `${p.id}-clean-loss` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>💎 Clean Loss<br/>Lost while scoring 0 points<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-secondary)", borderRadius: 6, padding: "1px 6px" }}>{p.played}P</span>
                        <span style={{ fontSize: 11, color: "#16a34a", background: "var(--bg-secondary)", borderRadius: 6, padding: "1px 6px" }}>{p.won}W</span>
                        <span style={{ fontSize: 11, color: "#dc2626", background: "var(--bg-secondary)", borderRadius: 6, padding: "1px 6px" }}>{p.lost}L</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: ptsColor, lineHeight: 1 }}>{p.points}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, justifyContent: "flex-end" }}>
                        <div style={{ height: 4, borderRadius: 4, background: "var(--border)", width: 48, overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: 4, background: "#16a34a", width: `${p.winPct}%` }} />
                        </div>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.winPct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="table-wrap">
              <table style={{ tableLayout: "fixed", width: "100%" }}>
                <colgroup>
                  <col style={{ width: 30 }} />
                  <col />
                  <col style={{ width: 40 }} />
                  <col style={{ width: 40 }} />
                  <col style={{ width: 40 }} />
                  <col style={{ width: 50 }} />
                  <col style={{ width: 100 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ textAlign: "center" }}>#</th>
                    <th>Player</th>
                    <th style={{ textAlign: "center" }}>P</th>
                    <th style={{ textAlign: "center" }}>W</th>
                    <th style={{ textAlign: "center" }}>L</th>
                    <th style={{ textAlign: "center" }}>PTS</th>
                    <th style={{ textAlign: "right" }}>Win%</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, i) => {
                    const badges = calcBadges(p.id, matches);
                    return (
                    <tr key={p.id} onClick={() => goToPlayer(p.id)} style={{ cursor: "pointer" }}>
                      <td style={{ textAlign: "center" }}>
                        {(() => {
                        const rank = i + 1;
                        const isTop3 = sortBy !== "losses" && rank <= 3;
                        const rankColors = { 1: "#d97706", 2: "#64748b", 3: "#b45309" };
                        return (
                          <span style={{ fontWeight: isTop3 ? 900 : 700, fontSize: isTop3 ? 18 : 14, color: isTop3 ? rankColors[rank] : "var(--color-text-primary)", lineHeight: 1 }}>
                            {rank}
                          </span>
                        );
                      })()}
                      </td>
                      <td style={{ maxWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Avatar id={p.id} allPlayers={players} size={28} />
                          <span style={{ fontWeight: i < 3 ? 700 : 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1, minWidth: 0 }}>{p.name}</span>
                          {i === 0 && p.played > 0 && <span className="badge badge-top" style={{ flexShrink: 0 }}>{sortBy === "losses" ? "💩" : "🏆"}</span>}
                          {badges.hatTricks > 0 && (
                            <span style={{ position:"relative", display:"inline-flex", flexShrink:0 }} onMouseEnter={() => setTooltip(`${p.id}-fire`)} onMouseLeave={() => setTooltip(null)}>
                              <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, borderRadius:20, padding:"2px 8px", fontWeight:600, background:"#fff7ed", color:"#c2410c", border:"0.5px solid #fed7aa" }}>{badges.hatTricks} 🔥</span>
                              {tooltip === `${p.id}-fire` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>🔥 Hat-trick!<br/>{badges.hatTricks === 1 ? "1 hat-trick achieved" : `${badges.hatTricks} hat-tricks achieved`}<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
                            </span>
                          )}
                          {badges.cleanWins > 0 && (
                            <span style={{ position:"relative", display:"inline-flex", flexShrink:0 }} onMouseEnter={() => setTooltip(`${p.id}-clean-win`)} onMouseLeave={() => setTooltip(null)}>
                              <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, borderRadius:20, padding:"2px 8px", fontWeight:600, background:"#dbeafe", color:"#1d4ed8", border:"0.5px solid #93c5fd" }}>{badges.cleanWins} 💎</span>
                              {tooltip === `${p.id}-clean-win` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>💎 Clean Win<br/>Won with opponent scoring 0<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
                            </span>
                          )}
                          {badges.cleanLosses > 0 && (
                            <span style={{ position:"relative", display:"inline-flex", flexShrink:0 }} onMouseEnter={() => setTooltip(`${p.id}-clean-loss`)} onMouseLeave={() => setTooltip(null)}>
                              <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, borderRadius:20, padding:"2px 8px", fontWeight:600, background:"#fee2e2", color:"#dc2626", border:"0.5px solid #fca5a5" }}>{badges.cleanLosses} 💎</span>
                              {tooltip === `${p.id}-clean-loss` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>💎 Clean Loss<br/>Lost while scoring 0 points<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: "center", fontWeight: 500, fontSize: 13 }}>{p.played}</td>
                      <td style={{ textAlign: "center" }} className="text-success"><b style={{ fontSize: 13 }}>{p.won}</b></td>
                      <td style={{ textAlign: "center" }} className="text-danger"><span style={{ fontSize: 13 }}>{p.lost}</span></td>
                      <td style={{ textAlign: "center" }}>
                        <b style={{ fontSize: 13, color: i < 3 ? "#f59e0b" : "var(--text)" }}>{p.points}</b>
                      </td>
                      <td>
                        <div className="win-bar-wrap">
                          <div className="win-bar" style={{ width: 50 }}><div className="win-bar-fill" style={{ width: `${p.winPct}%` }} /></div>
                          <span className="win-pct">{p.winPct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{
            marginTop: 16,
            background: guideColors.cardBg,
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${guideColors.cardBorder}`
          }}>
            {/* TAB HEADER — deeper bg */}
            <div style={{
              display: "flex",
              gap: 20,
              padding: "10px 14px",
              background: guideColors.headerBg,
              borderBottom: `1px solid ${guideColors.headerBorder}`,
              overflowX: "auto"
            }}>
              {[
                { k: "points", l: "POINTS RULES" },
                { k: "spin",   l: "SPIN LOGIC" },
                { k: "badges", l: "BADGE GUIDE" }
              ].map(t => (
                <button
                  key={t.k}
                  onClick={() => setGuideTab(t.k)}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    padding: "4px 0",
                    border: "none",
                    background: "transparent",
                    color: guideTab === t.k ? "#16a34a" : guideColors.inactiveTab,
                    borderBottom: guideTab === t.k ? "2px solid #16a34a" : "2px solid transparent",
                    cursor: "pointer",
                    transition: "color 0.15s ease, border-color 0.15s ease",
                    whiteSpace: "nowrap",
                    flexShrink: 0
                  }}
                >
                  {t.l}
                </button>
              ))}
            </div>

            {/* CONTENT AREA — lighter bg */}
            <div style={{ padding: "12px 14px" }}>
              {/* BADGE GUIDE CONTENT */}
              {guideTab === "badges" && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {[
                    { badge: { bg:"#fff7ed", color:"#c2410c", border:"0.5px solid #fed7aa" }, icon:"🔥", label:"Hat-trick: Every 3 consecutive wins" },
                    { badge: { bg:"#dbeafe", color:"#1d4ed8", border:"0.5px solid #93c5fd" }, icon:"💎", label:"Clean Win: Opponent scored 0 points" },
                    { badge: { bg:"#fee2e2", color:"#dc2626", border:"0.5px solid #fca5a5" }, icon:"💎", label:"Clean Loss: You scored 0 points" },
                  ].map((item, i, arr) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      paddingTop: i === 0 ? 0 : 8,
                      paddingBottom: i === arr.length - 1 ? 0 : 8,
                      borderBottom: i === arr.length - 1 ? "none" : `0.5px solid ${guideColors.separator}`
                    }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 3,
                        fontSize: 11, borderRadius: 20, padding: "2px 8px", fontWeight: 600,
                        background: item.badge.bg, color: item.badge.color, border: item.badge.border,
                        flexShrink: 0
                      }}>1 {item.icon}</span>
                      <span style={{ fontSize: 12, color: guideColors.labelText }}>{item.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* POINTS RULES CONTENT */}
              {guideTab === "points" && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {[
                    { pts: "10",  color: { bg:"#f3f4f6", fg:"#374151", bd:"#d1d5db" }, label: "Base: Starting points for every player" },
                    { pts: "+3",  color: { bg:"#dcfce7", fg:"#15803d", bd:"#86efac" }, label: "Win: For every match you win" },
                    { pts: "-2",  color: { bg:"#fee2e2", fg:"#b91c1c", bd:"#fca5a5" }, label: "Loss: For every match you lose" },
                    { pts: "+5",  color: { bg:"#dbeafe", fg:"#1d4ed8", bd:"#93c5fd" }, label: "Clean Win: When opponent scores 0" },
                    { pts: "-5",  color: { bg:"#fee2e2", fg:"#b91c1c", bd:"#fca5a5" }, label: "Clean Loss: When you score 0" },
                    { pts: "+3",  color: { bg:"#fff7ed", fg:"#c2410c", bd:"#fed7aa" }, label: "Hat-trick Bonus: Every 3 consecutive wins" },
                    { pts: "-3",  color: { bg:"#fee2e2", fg:"#b91c1c", bd:"#fca5a5" }, label: "Loss-trick Penalty: Every 3 consecutive losses" },
                  ].map((item, i, arr) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      paddingTop: i === 0 ? 0 : 8,
                      paddingBottom: i === arr.length - 1 ? 0 : 8,
                      borderBottom: i === arr.length - 1 ? "none" : `0.5px solid ${guideColors.separator}`
                    }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, borderRadius: 20, padding: "2px 8px", fontWeight: 700,
                        background: item.color.bg, color: item.color.fg, border: `0.5px solid ${item.color.bd}`,
                        flexShrink: 0, minWidth: 36
                      }}>{item.pts}</span>
                      <span style={{ fontSize: 12, color: guideColors.labelText }}>{item.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* SPIN LOGIC CONTENT */}
              {guideTab === "spin" && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {[
                    { icon: "⚖️", color: { bg:"#dbeafe", fg:"#1d4ed8", bd:"#93c5fd" }, label: "Win Rate Balance: Both teams' combined win rates kept similar" },
                    { icon: "📈", color: { bg:"#dcfce7", fg:"#15803d", bd:"#86efac" }, label: "Recent Form: Balance based on last 5 matches" },
                    { icon: "🔀", color: { bg:"#fef3c7", fg:"#a16207", bd:"#fde68a" }, label: "Partner Split: Frequent partners get separated" },
                    { icon: "🔥", color: { bg:"#fff7ed", fg:"#c2410c", bd:"#fed7aa" }, label: "Loser Split: Last match's losers placed on opposite teams" },
                    { icon: "🎯", color: { bg:"#f3e8ff", fg:"#7e22ce", bd:"#d8b4fe" }, label: "Top + Bottom: Strongest paired with weakest for balance" },
                  ].map((item, i, arr) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      paddingTop: i === 0 ? 0 : 8,
                      paddingBottom: i === arr.length - 1 ? 0 : 8,
                      borderBottom: i === arr.length - 1 ? "none" : `0.5px solid ${guideColors.separator}`
                    }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, borderRadius: 20, padding: "2px 8px", fontWeight: 600,
                        background: item.color.bg, color: item.color.fg, border: `0.5px solid ${item.color.bd}`,
                        flexShrink: 0, minWidth: 32
                      }}>{item.icon}</span>
                      <span style={{ fontSize: 12, color: guideColors.labelText }}>{item.label}</span>
                    </div>
                  ))}
                  <div style={{
                    marginTop: 10, paddingTop: 10,
                    borderTop: `0.5px solid ${guideColors.separator}`,
                    fontSize: 11, color: guideColors.noteText,
                    fontStyle: "italic", textAlign: "center"
                  }}>
                    Each spin randomly applies 1-3 soft conditions for variety
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── New Match ─────────────────────────────────────────────────────────────────
function NewMatch({ players, onSave }) {
  const [fmt, setFmt] = useState("1v1");
  const [t1, setT1] = useState([""]);
  const [t2, setT2] = useState([""]);
  const [winner, setWinner] = useState(null);
  const [saving, setSaving] = useState(false);
  const [winnerScore, setWinnerScore] = useState("");
  const [loserScore, setLoserScore] = useState("");

  function changeFmt(f) { setFmt(f); setT1(f === "1v1" ? [""] : ["", ""]); setT2(f === "1v1" ? [""] : ["", ""]); setWinner(null); setWinnerScore(""); setLoserScore(""); }
  function setSlot(team, idx, val) {
    if (team === 1) { const n = [...t1]; n[idx] = val; setT1(n); }
    else { const n = [...t2]; n[idx] = val; setT2(n); }
    setWinner(null);
  }
  function availableFor(team, idx) {
    const excl = team === 1 ? [...t1.filter((_, i) => i !== idx), ...t2] : [...t2.filter((_, i) => i !== idx), ...t1];
    return players.filter(p => !excl.includes(p.id));
  }

  const t1ok = t1.every(Boolean), t2ok = t2.every(Boolean);
  const canSave = t1ok && t2ok && winner;
  const getName = id => players.find(p => p.id === id)?.name || "?";
  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    await onSave({
      type: fmt, team1: t1, team2: t2, winner,
      winnerScore: winnerScore !== "" ? Number(winnerScore) : null,
      loserScore: loserScore !== "" ? Number(loserScore) : null,
    });
    changeFmt("1v1"); setSaving(false);
  }

  if (players.length < 2) return (
    <div className="empty"><p>Need at least 2 players to record a match.</p></div>
  );

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: "1.25rem" }}>
        <p className="section-label">Format</p>
        <div style={{ display: "flex", gap: 8 }}>
          {["1v1", "2v2"].map(f => (
            <button key={f} className={`btn btn-format ${fmt === f ? "active" : ""}`} onClick={() => changeFmt(f)}>{f}</button>
          ))}
        </div>
      </div>

      <div className="teams-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: "1.25rem" }}>
        {[1, 2].map(team => {
          const slots = team === 1 ? t1 : t2;
          const teamColor = team === 1 ? "#14a800" : "#D4A017";
          return (
            <div key={team}>
              <p className="section-label" style={{ color: teamColor }}>Team {team}</p>
              {slots.map((val, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <PlayerSelect
                    players={players}
                    value={val}
                    onChange={id => setSlot(team, i, id)}
                    placeholder="Select player"
                    excludeIds={(team === 1 ? [...t1.filter((_, j) => j !== i), ...t2] : [...t2.filter((_, j) => j !== i), ...t1]).filter(Boolean)}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {t1ok && t2ok && (
        <div style={{ marginBottom: "1.25rem" }}>
          <p className="section-label">Who won?</p>
          <div className="win-btns-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { key: "team1", ids: t1, color: "#14a800" },
              { key: "team2", ids: t2, color: "#D4A017" },
            ].map(({ key, ids, color }) => (
              <button key={key} onClick={() => setWinner(key)}
                style={{
                  padding: "12px 8px", fontSize: 13, fontWeight: winner === key ? 700 : 500,
                  borderRadius: "var(--radius-sm)", cursor: "pointer", fontFamily: "inherit",
                  background: winner === key ? color + "15" : "transparent",
                  color: winner === key ? color : "var(--text)",
                  border: `1.5px solid ${winner === key ? color : "var(--border-strong)"}`,
                  transition: "all 0.15s", touchAction: "manipulation",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                }}>
                {winner === key && <span>★</span>}
                <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                  {ids.map((id, i) => (
                    <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      {i > 0 && <span style={{ opacity: 0.5 }}>&</span>}
                      <PlayerAvatar player={players.find(p => p.id === id)} size={20} />
                      <span>{getName(id)}</span>
                    </span>
                  ))}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {winner && (
        <div style={{ marginBottom: "1.25rem" }}>
          <p className="section-label">Score (optional)</p>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                {(winner === "team1" ? t1 : t2).map((id, i) => (
                  <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    {i > 0 && <span style={{ opacity: 0.5 }}>&</span>}
                    <PlayerAvatar player={players.find(p => p.id === id)} size={16} />
                    <span>{getName(id)}</span>
                  </span>
                ))}
                <span>score</span>
              </div>
              <input type="number" min="0" value={winnerScore} onChange={e => setWinnerScore(e.target.value)}
                placeholder="e.g. 24" style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div style={{ fontSize: 16, color: "var(--text-muted)", paddingTop: 20 }}>vs</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                {(winner === "team1" ? t2 : t1).map((id, i) => (
                  <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    {i > 0 && <span style={{ opacity: 0.5 }}>&</span>}
                    <PlayerAvatar player={players.find(p => p.id === id)} size={16} />
                    <span>{getName(id)}</span>
                  </span>
                ))}
                <span>score</span>
              </div>
              <input type="number" min="0" value={loserScore} onChange={e => setLoserScore(e.target.value)}
                placeholder="e.g. 0" style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
          </div>
        </div>
      )}

      <button className="btn btn-primary" style={{ width: "100%", padding: "13px", fontSize: 15 }}
        onClick={handleSave} disabled={!canSave || saving}>
        {saving ? "Saving..." : "💾 Save Match"}
      </button>
    </div>
  );
}

// ── Players ───────────────────────────────────────────────────────────────────
function Players({ players, matches, onAdd, onRemove, onEdit, isAdmin, onSelectPlayer, onNavigateToStats }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(AVATAR_ICONS[0]);
  const [adding, setAdding] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const fileInputRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [editImage, setEditImage] = useState(null);
  const editFileRef = useRef(null);
  const stats = computeStats(players, matches);

  async function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Please select an image file"); return; }
    try {
      const base64 = await fileToResizedBase64(file);
      setUploadedImage(base64);
    } catch {
      alert("Failed to process image");
    }
    e.target.value = "";
  }

  async function handleEditImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    try {
      const base64 = await fileToResizedBase64(file);
      setEditImage(base64);
    } catch {
      alert("Failed to process image");
    }
    e.target.value = "";
  }

  async function handleAdd() {
    if (!name.trim() || adding) return;
    setAdding(true);
    await onAdd(name.trim(), icon, uploadedImage);
    setName(""); setUploadedImage(null); setAdding(false);
  }

  function startEdit(p) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditIcon(p.icon || AVATAR_ICONS[0]);
    setEditImage(p.imageUrl || null);
  }

  async function handleEdit() {
    await onEdit(editingId, editName, editIcon, editImage);
    setEditingId(null);
  }

  return (
    <div>
      {isAdmin && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Add New Player</p>
          <div style={{ marginBottom: 12 }}>
            <p className="section-label">Profile Photo (optional)</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {uploadedImage ? (
                <div style={{ position: "relative" }}>
                  <img src={uploadedImage} alt="preview" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }} />
                  <button type="button" onClick={() => setUploadedImage(null)}
                    style={{ position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: "50%", background: "#dc2626", color: "white", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>×</button>
                </div>
              ) : (
                <button type="button" className="btn" onClick={() => fileInputRef.current?.click()} style={{ fontSize: 12 }}>📷 Upload Photo</button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} style={{ display: "none" }} />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Photo replaces the emoji icon</span>
            </div>
          </div>
          {!uploadedImage && (
            <div style={{ marginBottom: 12 }}>
              <p className="section-label">Choose an icon</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {AVATAR_ICONS.map(ic => (
                  <button key={ic} className={`emoji-btn ${ic === icon ? "selected" : ""}`}
                    onClick={() => setIcon(ic)}
                    style={{ border: `1.5px solid ${ic === icon ? "var(--green)" : "var(--border)"}` }}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="Player name" style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={handleAdd} disabled={adding} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
              {adding ? "..." : "Add"}
            </button>
          </div>
        </div>
      )}

      {players.length === 0 ? (
        <div className="empty"><p>No players added yet.</p></div>
      ) : (
        <div className="players-grid">
          {players.map((p, i) => {
            const st = stats.find(s => s.id === p.id) || { played: 0, winPct: 0 };
            const c = PALETTE[i % PALETTE.length];
            return (
              <div key={p.id} className="player-card" onClick={() => { if (onSelectPlayer && onNavigateToStats) { onSelectPlayer(p.id); onNavigateToStats(); } }} style={{ cursor: onSelectPlayer ? "pointer" : "default" }}>
                {isAdmin && (
                  <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 2 }}>
                    <button onClick={(e) => { e.stopPropagation(); startEdit(p); }} style={{
                      background: "none", border: "none", cursor: "pointer", fontSize: 14,
                      lineHeight: 1, padding: "3px 5px", fontFamily: "inherit", touchAction: "manipulation",
                    }}>✏️</button>
                    <button onClick={(e) => { e.stopPropagation(); onRemove(p.id); }} style={{
                      background: "none", border: "none", cursor: "pointer", fontSize: 17,
                      color: "var(--text-muted)", lineHeight: 1, padding: "3px 5px",
                      fontFamily: "inherit", touchAction: "manipulation",
                    }}>×</button>
                  </div>
                )}
                <div style={{ marginBottom: 10 }}>
                  <PlayerAvatar player={p} size={46} />
                </div>
                <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{p.name}</p>
                <p className="text-muted" style={{ fontSize: 11 }}>{st.played} matches</p>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--green)", marginTop: 2 }}>{st.winPct}% win rate</p>
              </div>
            );
          })}
        </div>
      )}

      {editingId && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: "1rem",
        }}>
          <div className="card" style={{ width: "100%", maxWidth: 380, margin: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Edit Player</p>
            <div style={{ marginBottom: 12 }}>
              <p className="section-label">Profile Photo</p>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {editImage ? (
                  <div style={{ position: "relative" }}>
                    <img src={editImage} alt="preview" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }} />
                    <button type="button" onClick={() => setEditImage(null)}
                      style={{ position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: "50%", background: "#dc2626", color: "white", border: "none", cursor: "pointer", fontSize: 12, padding: 0 }}>×</button>
                  </div>
                ) : (
                  <button type="button" className="btn" onClick={() => editFileRef.current?.click()} style={{ fontSize: 12 }}>📷 Upload Photo</button>
                )}
                <input ref={editFileRef} type="file" accept="image/*" onChange={handleEditImage} style={{ display: "none" }} />
              </div>
            </div>
            {!editImage && (
              <div style={{ marginBottom: 12 }}>
                <p className="section-label">Choose an icon</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {AVATAR_ICONS.map(ic => (
                    <button key={ic} className={`emoji-btn ${ic === editIcon ? "selected" : ""}`}
                      onClick={() => setEditIcon(ic)}
                      style={{ border: `1.5px solid ${ic === editIcon ? "var(--green)" : "var(--border)"}` }}>
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <input value={editName} onChange={e => setEditName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleEdit()}
              placeholder="Player name" style={{ marginBottom: 12 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setEditingId(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleEdit}
                disabled={!editName.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────
function History({ players, matches, onDelete, isAdmin }) {
  const getName = id => players.find(p => p.id === id)?.name || "?";

  if (!matches.length) return <div className="empty"><p>No matches recorded yet.</p></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {matches.map(m => {
        const w1 = m.winner === "team1";
        const date = m.createdAt
          ? m.createdAt.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
          : "—";
        const renderTeam = (ids, won) => (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap", fontSize: 13, fontWeight: won ? 700 : 400, color: won ? "var(--green)" : "var(--text-muted)" }}>
            {won && "★ "}
            {ids.map((id, i) => (
              <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                {i > 0 && <span style={{ margin: "0 2px", opacity: 0.5 }}>&</span>}
                <PlayerAvatar player={players.find(p => p.id === id)} size={22} />
                <span>{getName(id)}</span>
              </span>
            ))}
          </span>
        );
        return (
          <div key={m.id} className="match-item">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                {renderTeam(m.team1, w1)}
                <span className="text-muted" style={{ fontSize: 10, padding: "1px 5px", background: "var(--bg-secondary)", borderRadius: 4 }}>vs</span>
                {renderTeam(m.team2, !w1)}
              </div>
              <p className="text-muted" style={{ fontSize: 11 }}>{date} · {m.type}</p>
            </div>
            {isAdmin && (
              <button onClick={() => onDelete(m.id)} style={{
                background: "none", border: "none", cursor: "pointer", fontSize: 18,
                color: "var(--text-muted)", padding: "2px 6px", fontFamily: "inherit",
                lineHeight: 1, flexShrink: 0, touchAction: "manipulation",
              }}>×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function Stats({ players, matches, selectedPlayer, setSelectedPlayer }) {
  const [mode, setMode] = useState("player");
  const [dateFilter, setDateFilter] = useState("weekly");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));

  const getName = id => players.find(p => p.id === id)?.name || "?";

  function filterByDate(ms) {
    const now = new Date();
    return ms.filter(m => {
      if (!m.createdAt) return false;
      const d = m.createdAt.toDate();
      if (dateFilter === "weekly") return (now - d) / 864e5 < 7;
      if (dateFilter === "monthly") {
        return d.getFullYear() === parseInt(selectedMonth.split("-")[0]) &&
          d.getMonth() + 1 === parseInt(selectedMonth.split("-")[1]);
      }
      return d.getFullYear() === parseInt(selectedYear);
    });
  }

  function renderPlayerStats() {
    if (!selectedPlayer) return <div className="empty"><p>Select a player to view their stats.</p></div>;
    const p = players.find(x => x.id === selectedPlayer);
    if (!p) return null;
    const pm = matches.filter(m => m.team1.includes(p.id) || m.team2.includes(p.id));
    let won = 0, lost = 0;
    const opponents = {}, partners = {};
    for (const m of pm) {
      const inT1 = m.team1.includes(p.id);
      const isW = (inT1 && m.winner === "team1") || (!inT1 && m.winner === "team2");
      if (isW) won++; else lost++;
      (inT1 ? m.team2 : m.team1).forEach(oid => {
        if (!opponents[oid]) opponents[oid] = { played: 0, won: 0 };
        opponents[oid].played++; if (isW) opponents[oid].won++;
      });
      if (m.type === "2v2") {
        (inT1 ? m.team1 : m.team2).filter(x => x !== p.id).forEach(pid => {
          if (!partners[pid]) partners[pid] = { played: 0, won: 0 };
          partners[pid].played++; if (isW) partners[pid].won++;
        });
      }
    }
    const played = won + lost;
    const winPct = played > 0 ? Math.round((won / played) * 100) : 0;
    const streak = getStreak(p.id, matches);
    const idx = players.findIndex(x => x.id === p.id);
    const c = PALETTE[idx % PALETTE.length];

    return (
      <div>
        <div className="card" style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: 14 }}>
          <PlayerAvatar player={p} size={56} />
          <div>
            <p style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Sora', sans-serif" }}>{p.name}</p>
            <p className="text-muted" style={{ fontSize: 12 }}>
              Streak: <b style={{ color: streak.endsWith("W") ? "var(--green)" : "var(--danger)" }}>{streak}</b>
            </p>
            {(() => {
              const b = calcBadges(p.id, matches);
              return (b.hatTricks > 0 || b.cleanWins > 0 || b.cleanLosses > 0) ? (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:6 }}>
                  {b.hatTricks > 0 && <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, borderRadius:20, padding:"2px 8px", fontWeight:600, background:"#fff7ed", color:"#c2410c", border:"0.5px solid #fed7aa" }}>{b.hatTricks} 🔥</span>}
                  {b.cleanWins > 0 && <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, borderRadius:20, padding:"2px 8px", fontWeight:600, background:"#dbeafe", color:"#1d4ed8", border:"0.5px solid #93c5fd" }}>{b.cleanWins} 💎</span>}
                  {b.cleanLosses > 0 && <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, borderRadius:20, padding:"2px 8px", fontWeight:600, background:"#fee2e2", color:"#dc2626", border:"0.5px solid #fca5a5" }}>{b.cleanLosses} 💎</span>}
                </div>
              ) : null;
            })()}
            {(() => {
              const playerMatches = matches.filter(m => {
                const ids = [...(m.team1 || [m.player1]), ...(m.team2 || [m.player2])];
                return ids.includes(selectedPlayer);
              });
              const wins = playerMatches.filter(m => {
                const wids = m.winner === "team1" ? (m.team1 || [m.player1]) : (m.team2 || [m.player2]);
                return wids.includes(selectedPlayer);
              }).length;
              const losses = playerMatches.length - wins;
              const winRate = playerMatches.length > 0 ? Math.round((wins / playerMatches.length) * 100) : 0;
              const b = calcBadges(selectedPlayer, matches);
              const sorted = [...playerMatches].sort((a, b) => new Date(b.date) - new Date(a.date));
              let streak = 0, streakType = "";
              for (const m of sorted) {
                const wids = m.winner === "team1" ? (m.team1 || [m.player1]) : (m.team2 || [m.player2]);
                const won = wids.includes(selectedPlayer);
                if (streak === 0) { streakType = won ? "W" : "L"; streak = 1; }
                else if ((won && streakType === "W") || (!won && streakType === "L")) streak++;
                else break;
              }
              const desc = generatePlayerDescription(playerMatches.length, wins, losses, winRate, b.hatTricks, b.cleanWins, b.cleanLosses, streak, streakType);
              return (
                <div style={{
                  marginTop: 8, fontSize: 13, color: "var(--text-muted)",
                  lineHeight: 1.5, padding: "8px 10px",
                  background: "var(--bg-secondary)",
                  borderRadius: 8, borderLeft: "3px solid #16a34a",
                  fontStyle: "italic"
                }}>{desc}</div>
              );
            })()}
          </div>
        </div>
        <div className="metrics" style={{ marginBottom: "1rem" }}>
          <div className="metric"><label>Played</label><span>{played}</span></div>
          <div className="metric"><label>Won</label><span style={{ color: "var(--green)" }}>{won}</span></div>
          <div className="metric"><label>Win Rate</label><span style={{ color: "var(--green)", fontSize: 20 }}>{winPct}%</span></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: "1rem" }}>
          <div className="metric"><label>Lost</label><span style={{ color: "var(--danger)" }}>{lost}</span></div>
          <div className="metric"><label>Streak</label>
            <span style={{ fontSize: 20, color: streak.endsWith("W") ? "var(--green)" : "var(--danger)" }}>{streak}</span>
          </div>
        </div>
        {Object.keys(opponents).length > 0 && (
          <div className="card" style={{ marginBottom: "1rem" }}>
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>vs Opponents</p>
            {Object.entries(opponents).sort((a, b) => b[1].played - a[1].played).map(([oid, o]) => (
              <div key={oid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar id={oid} allPlayers={players} size={24} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{getName(oid)}</span>
                </div>
                <span style={{ fontSize: 12 }}>
                  <b style={{ color: "var(--green)" }}>{o.won}W</b>
                  <span className="text-muted"> — </span>
                  <b style={{ color: "var(--danger)" }}>{o.played - o.won}L</b>
                </span>
              </div>
            ))}
          </div>
        )}
        {Object.keys(partners).length > 0 && (
          <div className="card">
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>2v2 Partners</p>
            {Object.entries(partners).sort((a, b) => b[1].won - a[1].won).map(([pid, pt]) => (
              <div key={pid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar id={pid} allPlayers={players} size={24} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{getName(pid)}</span>
                </div>
                <span style={{ fontSize: 12 }}>
                  <b style={{ color: "var(--green)" }}>{pt.won}W</b>
                  <span className="text-muted"> — </span>
                  <b style={{ color: "var(--danger)" }}>{pt.played - pt.won}L</b>
                  <span className="text-muted"> · {Math.round((pt.won / pt.played) * 100)}%</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderDateStats() {
    const filtered = filterByDate(matches);
    if (!filtered.length) return <div className="empty"><p>No matches found for this period.</p></div>;
    const stats = computeStats(players, filtered).filter(s => s.played > 0);
    return (
      <div>
        <p className="text-muted" style={{ fontSize: 12, marginBottom: "1rem", fontWeight: 600 }}>{filtered.length} matches in this period</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Player</th>
                <th style={{ width: 56, textAlign: "center" }}>P</th>
                <th style={{ width: 44, textAlign: "center" }}>W</th>
                <th style={{ width: 88, textAlign: "right" }}>Win%</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((p, i) => (
                <tr key={p.id}>
                  <td className="text-muted" style={{ fontWeight: 600 }}>{i + 1}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Avatar id={p.id} allPlayers={players} size={24} />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: "center", fontSize: 13 }}>{p.played}</td>
                  <td style={{ textAlign: "center" }} className="text-success"><b>{p.won}</b></td>
                  <td>
                    <div className="win-bar-wrap">
                      <div className="win-bar"><div className="win-bar-fill" style={{ width: `${p.winPct}%` }} /></div>
                      <span className="win-pct">{p.winPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderDuoStats() {
    const duoMap = {};
    for (const m of matches) {
      if (m.type !== "2v2") continue;
      [m.team1, m.team2].forEach((team, ti) => {
        const [a, b] = [...team].sort();
        const key = `${a}___${b}`;
        if (!duoMap[key]) duoMap[key] = { p1: a, p2: b, played: 0, won: 0 };
        duoMap[key].played++;
        if ((ti === 0 && m.winner === "team1") || (ti === 1 && m.winner === "team2")) duoMap[key].won++;
      });
    }
    const duos = Object.values(duoMap)
      .map(d => ({ ...d, winPct: Math.round((d.won / d.played) * 100) }))
      .sort((a, b) => b.winPct - a.winPct || b.won - a.won);

    if (!duos.length) return <div className="empty"><p>No 2v2 matches recorded yet.</p></div>;

    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Partnership</th>
              <th style={{ width: 44, textAlign: "center" }}>P</th>
              <th style={{ width: 44, textAlign: "center" }}>W</th>
              <th style={{ width: 88, textAlign: "right" }}>Win%</th>
            </tr>
          </thead>
          <tbody>
            {duos.map((d, i) => (
              <tr key={i}>
                <td className={i === 0 ? "rank-1" : "text-muted"} style={{ fontWeight: 700 }}>{i + 1}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <PlayerAvatar player={players.find(p => p.id === d.p1)} size={28} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{getName(d.p1)}</span>
                    </div>
                    <span className="text-muted" style={{ fontSize: 10, fontWeight: 700 }}>+</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <PlayerAvatar player={players.find(p => p.id === d.p2)} size={28} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{getName(d.p2)}</span>
                    </div>
                    {i === 0 && <span className="badge badge-best">Best</span>}
                  </div>
                </td>
                <td style={{ textAlign: "center", fontSize: 13 }}>{d.played}</td>
                <td style={{ textAlign: "center" }} className="text-success"><b>{d.won}</b></td>
                <td>
                  <div className="win-bar-wrap">
                    <div className="win-bar"><div className="win-bar-fill" style={{ width: `${d.winPct}%` }} /></div>
                    <span className="win-pct">{d.winPct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const now = new Date();
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { val: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) };
  });
  const yearOptions = Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - i));

  return (
    <div>
      <div className="stats-mode-btns" style={{ display: "flex", gap: 8, marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {[{ k: "player", l: "By Player" }, { k: "date", l: "By Date" }, { k: "duo", l: "Best Partner" }].map(({ k, l }) => (
          <button key={k} className={`btn btn-format ${mode === k ? "active" : ""}`} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>

      {mode === "player" && (
        <div style={{ marginBottom: "1.25rem" }}>
          <p className="section-label">Select Player</p>
          <PlayerSelect
            players={players}
            value={selectedPlayer}
            onChange={setSelectedPlayer}
            placeholder="Choose a player..."
          />
        </div>
      )}

      {mode === "date" && (
        <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
          {[{ k: "weekly", l: "This Week" }, { k: "monthly", l: "Monthly" }, { k: "yearly", l: "Yearly" }].map(({ k, l }) => (
            <button key={k} className={`btn btn-format ${dateFilter === k ? "active" : ""}`} onClick={() => setDateFilter(k)}>{l}</button>
          ))}
          {dateFilter === "monthly" && (
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ maxWidth: 200 }}>
              {monthOptions.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
            </select>
          )}
          {dateFilter === "yearly" && (
            <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={{ maxWidth: 130 }}>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>
      )}

      {mode === "player" && renderPlayerStats()}
      {mode === "date" && renderDateStats()}
      {mode === "duo" && renderDuoStats()}
    </div>
  );
}

// ── Team Spin helpers ─────────────────────────────────────────────────────────
function getPlayerWinRate(playerId, matches) {
  let wins = 0, total = 0;
  matches.forEach(m => {
    const in1 = (m.team1 || []).includes(playerId);
    const in2 = (m.team2 || []).includes(playerId);
    if (in1) { total++; if (m.winner === "team1") wins++; }
    if (in2) { total++; if (m.winner === "team2") wins++; }
  });
  return total > 0 ? (wins / total) * 100 : 50;
}

function getRecentForm(playerId, matches) {
  const recent = matches
    .filter(m => (m.team1 || []).includes(playerId) || (m.team2 || []).includes(playerId))
    .slice(-5);
  if (!recent.length) return 50;
  let wins = 0;
  recent.forEach(m => {
    const in1 = (m.team1 || []).includes(playerId);
    if ((in1 && m.winner === "team1") || (!in1 && m.winner === "team2")) wins++;
  });
  return (wins / recent.length) * 100;
}

function getPartnershipCount(p1Id, p2Id, matches) {
  let count = 0;
  matches.forEach(m => {
    const a = m.team1 || [], b = m.team2 || [];
    if (a.includes(p1Id) && a.includes(p2Id)) count++;
    if (b.includes(p1Id) && b.includes(p2Id)) count++;
  });
  return count;
}

function getLastMatchLosers(matches) {
  if (!matches.length) return [];
  const sorted = [...matches].sort((a, b) =>
    (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
  );
  const last = sorted[0];
  if (last.winner === "team1") return last.team2 || [];
  if (last.winner === "team2") return last.team1 || [];
  return [];
}

// ── Team Spin ─────────────────────────────────────────────────────────────────
function TeamSpin({ players, matches, onClose }) {
  const [selected, setSelected] = useState([]);
  const [spinning, setSpinning] = useState(false);
  const [teams, setTeams] = useState(null);
  const [shuffleNames, setShuffleNames] = useState([]);
  const [appliedConditions, setAppliedConditions] = useState([]);

  const AVOID_PAIRS = [["Mr. Zed", "Firoz Hassan"]];

  const SOFT_CONDITIONS = [
    { id: "winRate", label: "⚖️ Win rate balanced" },
    { id: "recentForm", label: "🔥 Recent form balanced" },
    { id: "headToHead", label: "🔀 Frequent partners split" },
    { id: "lastLosers", label: "💔 Last losers separated" },
    { id: "topBottom", label: "🏆 Top + bottom paired" },
  ];

  const togglePlayer = (id) => {
    if (spinning) return;
    setTeams(null);
    setAppliedConditions([]);
    if (selected.includes(id)) {
      setSelected(selected.filter(p => p !== id));
    } else if (selected.length < 4) {
      setSelected([...selected, id]);
    }
  };

  const spin = () => {
    if (selected.length !== 4 || spinning) return;
    setSpinning(true);
    setTeams(null);
    setAppliedConditions([]);

    const selectedPlayers = selected.map(id => players.find(p => p.id === id));
    const [p1, p2, p3, p4] = selectedPlayers;

    let configs = [
      { teamA: [p1, p2], teamB: [p3, p4] },
      { teamA: [p1, p3], teamB: [p2, p4] },
      { teamA: [p1, p4], teamB: [p2, p3] },
    ];

    const filtered = configs.filter(c => {
      return !AVOID_PAIRS.some(([n1, n2]) => {
        const aBoth = c.teamA.some(p => p.name === n1) && c.teamA.some(p => p.name === n2);
        const bBoth = c.teamB.some(p => p.name === n1) && c.teamB.some(p => p.name === n2);
        return aBoth || bBoth;
      });
    });
    if (filtered.length > 0) configs = filtered;

    const numConds = 1 + Math.floor(Math.random() * 3);
    const shuffledConds = [...SOFT_CONDITIONS].sort(() => Math.random() - 0.5);
    const active = shuffledConds.slice(0, numConds);

    const scored = configs.map(cfg => {
      let score = 0;
      active.forEach(cond => {
        if (cond.id === "winRate") {
          const a = (getPlayerWinRate(cfg.teamA[0].id, matches) + getPlayerWinRate(cfg.teamA[1].id, matches)) / 2;
          const b = (getPlayerWinRate(cfg.teamB[0].id, matches) + getPlayerWinRate(cfg.teamB[1].id, matches)) / 2;
          score += 100 - Math.abs(a - b);
        } else if (cond.id === "recentForm") {
          const a = (getRecentForm(cfg.teamA[0].id, matches) + getRecentForm(cfg.teamA[1].id, matches)) / 2;
          const b = (getRecentForm(cfg.teamB[0].id, matches) + getRecentForm(cfg.teamB[1].id, matches)) / 2;
          score += 100 - Math.abs(a - b);
        } else if (cond.id === "headToHead") {
          const aP = getPartnershipCount(cfg.teamA[0].id, cfg.teamA[1].id, matches);
          const bP = getPartnershipCount(cfg.teamB[0].id, cfg.teamB[1].id, matches);
          score += Math.max(0, 100 - (aP + bP) * 10);
        } else if (cond.id === "lastLosers") {
          const losers = getLastMatchLosers(matches);
          const aL = cfg.teamA.filter(p => losers.includes(p.id)).length;
          const bL = cfg.teamB.filter(p => losers.includes(p.id)).length;
          if (aL + bL < 2) score += 50;
          else if (aL === 1 && bL === 1) score += 100;
        } else if (cond.id === "topBottom") {
          const sortedByRate = [...selectedPlayers].sort((x, y) => getPlayerWinRate(y.id, matches) - getPlayerWinRate(x.id, matches));
          const top = sortedByRate[0], bottom = sortedByRate[3];
          const topInA = cfg.teamA.some(p => p.id === top.id);
          const botInA = cfg.teamA.some(p => p.id === bottom.id);
          if (topInA === botInA) score += 100;
        }
      });
      score += Math.random() * 0.5;
      return { cfg, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const finalConfig = scored[0].cfg;

    let count = 0;
    const interval = setInterval(() => {
      const shuffleArr = [...selectedPlayers].sort(() => Math.random() - 0.5);
      setShuffleNames(shuffleArr.map(p => p.name));
      count++;
      if (count >= 20) {
        clearInterval(interval);
        setTeams(finalConfig);
        setAppliedConditions(active.map(c => c.label));
        setSpinning(false);
        setShuffleNames([]);
      }
    }, 100);
  };

  const reset = () => {
    setSelected([]);
    setTeams(null);
    setShuffleNames([]);
    setAppliedConditions([]);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 16, backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#ffffff",
          color: "#1a1a1a",
          borderRadius: 16, padding: 24,
          maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto",
          border: "1px solid rgba(0,0,0,0.1)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 12, right: 12, background: "rgba(0,0,0,0.05)",
            border: "none", color: "#1a1a1a", fontSize: 20, cursor: "pointer",
            lineHeight: 1, padding: "4px 10px", borderRadius: 6, fontWeight: 700,
          }}
        >×</button>

        <h2 style={{
          fontSize: 22, fontWeight: 800, marginBottom: 6, marginTop: 0,
          textAlign: "center", color: "#1a1a1a"
        }}>
          🎲 Random Team Spin
        </h2>
        <p style={{
          textAlign: "center", color: "#6b7280", fontSize: 13,
          marginBottom: 20, marginTop: 0
        }}>
          Select 4 players ({selected.length}/4)
        </p>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
          gap: 8, marginBottom: 20
        }}>
          {players.map(p => {
            const isSelected = selected.includes(p.id);
            const disabled = !isSelected && selected.length >= 4;
            return (
              <button
                key={p.id}
                onClick={() => togglePlayer(p.id)}
                disabled={disabled || spinning}
                style={{
                  padding: "10px 8px", borderRadius: 8,
                  border: isSelected ? "2px solid #16a34a" : "1px solid #d1d5db",
                  background: isSelected ? "#dcfce7" : "#f9fafb",
                  color: "#1a1a1a",
                  cursor: disabled || spinning ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.4 : 1,
                  fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <PlayerAvatar player={p} size={24} />
                  <span>{p.name}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 20 }}>
          <button
            onClick={spin}
            disabled={selected.length !== 4 || spinning}
            style={{
              padding: "12px 28px", borderRadius: 8, border: "none",
              background: selected.length === 4 && !spinning
                ? "linear-gradient(135deg, #f59e0b, #ef4444)"
                : "#9ca3af",
              color: "white", fontWeight: 700, fontSize: 15,
              cursor: selected.length === 4 && !spinning ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              boxShadow: selected.length === 4 && !spinning
                ? "0 4px 12px rgba(245, 158, 11, 0.4)"
                : "none",
            }}
          >
            {spinning ? "🌀 Spinning..." : "🎰 Spin!"}
          </button>
          {(selected.length > 0 || teams) && (
            <button
              onClick={reset}
              disabled={spinning}
              style={{
                padding: "12px 20px", borderRadius: 8,
                border: "1px solid #d1d5db", background: "#ffffff",
                color: "#1a1a1a", fontWeight: 600, fontSize: 14,
                cursor: spinning ? "not-allowed" : "pointer", fontFamily: "inherit",
              }}
            >
              Reset
            </button>
          )}
        </div>

        {spinning && shuffleNames.length > 0 && (
          <div style={{
            textAlign: "center", fontSize: 16, fontWeight: 700,
            padding: 20, color: "#1a1a1a",
            background: "#f3f4f6", borderRadius: 8, marginBottom: 8
          }}>
            {shuffleNames.join(" • ")}
          </div>
        )}

        {teams && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{
                padding: 16, borderRadius: 12,
                background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
                textAlign: "center", color: "white",
                boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)"
              }}>
                <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8, fontWeight: 600 }}>TEAM A</div>
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 4 }}>
                    <PlayerAvatar player={teams.teamA[0]} size={28} />
                    <span>{teams.teamA[0].name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <PlayerAvatar player={teams.teamA[1]} size={28} />
                    <span>{teams.teamA[1].name}</span>
                  </div>
                </div>
              </div>
              <div style={{
                padding: 16, borderRadius: 12,
                background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                textAlign: "center", color: "white",
                boxShadow: "0 4px 12px rgba(239, 68, 68, 0.3)"
              }}>
                <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8, fontWeight: 600 }}>TEAM B</div>
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 4 }}>
                    <PlayerAvatar player={teams.teamB[0]} size={28} />
                    <span>{teams.teamB[0].name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <PlayerAvatar player={teams.teamB[1]} size={28} />
                    <span>{teams.teamB[1].name}</span>
                  </div>
                </div>
              </div>
            </div>
            <p style={{
              textAlign: "center", marginTop: 16, marginBottom: 0,
              fontSize: 13, color: "#6b7280"
            }}>
              🎉 Teams ready! Let the game begin.
            </p>
            {appliedConditions.length > 0 && (
              <div style={{
                marginTop: 16, padding: 12,
                background: "#fef3c7", borderRadius: 10,
                border: "1px solid #fbbf24",
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "#92400e",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  marginBottom: 8, textAlign: "center",
                }}>
                  ⚙️ Balancing rules applied
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                  {appliedConditions.map((label, i) => (
                    <span key={i} style={{
                      fontSize: 12, fontWeight: 600,
                      padding: "4px 10px", borderRadius: 12,
                      background: "#fbbf24", color: "#1a1a1a",
                    }}>
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE || "fnf2024";
const MEMBER_PASSCODE = process.env.NEXT_PUBLIC_MEMBER_PASSCODE;
const SESSION_KEY = "ct_auth";

function LoginScreen({ onLogin }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  function handleLogin() {
    if (code === PASSCODE) {
      sessionStorage.setItem(SESSION_KEY, "admin");
      onLogin("admin");
    } else if (code === MEMBER_PASSCODE) {
      sessionStorage.setItem(SESSION_KEY, "member");
      onLogin("member");
    } else {
      setError(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  }

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #0e7a00 0%, #14a800 60%, #1dc400 100%)",
      padding: "1.5rem",
    }}>
      <div style={{
        width: "100%", maxWidth: 360,
        background: "#ffffff", borderRadius: 16,
        padding: "2rem 1.75rem",
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        animation: shake ? "shake 0.4s ease" : "none",
      }}>
        <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
          <div style={{
            width: 60, height: 60, borderRadius: 14,
            background: "linear-gradient(135deg, #0e7a00, #14a800)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 1rem",
            boxShadow: "0 4px 16px rgba(20,168,0,0.35)",
          }}>
            <svg width="28" height="28" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="9" stroke="white" strokeWidth="1.5" />
              <circle cx="11" cy="11" r="3" fill="white" />
              <circle cx="6.5" cy="6.5" r="1.8" fill="white" opacity="0.5" />
              <circle cx="15.5" cy="15.5" r="1.8" fill="white" opacity="0.5" />
            </svg>
          </div>
          <h1 style={{ fontFamily: "'Sora', sans-serif", fontSize: 22, fontWeight: 800, color: "#0d1f0b", marginBottom: 4 }}>
            Carrom Tracker
          </h1>
          <p style={{ fontSize: 13, color: "#5a7055" }}>Enter passcode to manage data</p>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <input
            type="password"
            value={code}
            onChange={e => { setCode(e.target.value); setError(false); }}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            placeholder="Enter passcode"
            style={{
              width: "100%", padding: "12px 14px", fontSize: 15,
              border: `1.5px solid ${error ? "#dc2626" : "#d4e8cf"}`,
              borderRadius: 8, outline: "none", fontFamily: "inherit",
              background: error ? "#fef2f2" : "#f7faf7",
              color: "#0d1f0b", letterSpacing: "0.1em",
              transition: "border-color 0.15s",
            }}
            autoFocus
          />
          {error && <p style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>Wrong passcode. Try again.</p>}
        </div>

        <button onClick={handleLogin} style={{
          width: "100%", padding: "13px", fontSize: 15, fontWeight: 700,
          background: "linear-gradient(135deg, #0e7a00, #14a800)",
          color: "#fff", border: "none", borderRadius: 8, cursor: "pointer",
          fontFamily: "inherit", boxShadow: "0 4px 12px rgba(20,168,0,0.3)",
          transition: "opacity 0.15s",
        }}>
          Login
        </button>

        <p style={{ textAlign: "center", fontSize: 11, color: "#5a7055", marginTop: "1.25rem" }}>
          You can also <button onClick={() => onLogin("guest")} style={{
            background: "none", border: "none", color: "#14a800", fontSize: 11,
            fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: "inherit",
          }}>view only</button> without passcode
        </p>
      </div>

      <a href="https://fnfschool.com" target="_blank" rel="noopener noreferrer"
        style={{ marginTop: "1.5rem", fontSize: 12, color: "rgba(255,255,255,0.7)", textDecoration: "none", fontWeight: 600 }}>
        fnfschool.com
      </a>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}

export default function CarromTracker() {
  const [tab, setTab] = useState("board");
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [synced, setSynced] = useState(false);
  const [authState, setAuthState] = useState("loading"); // loading | guest | member | admin | login
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [showSpin, setShowSpin] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.log("SW registration failed:", err);
      });
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    setAuthState(saved || "guest");
  }, []);

  useEffect(() => {
    const unsubP = onSnapshot(query(collection(db, "players"), orderBy("createdAt", "asc")), snap => {
      setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setSynced(true);
    });
    const unsubM = onSnapshot(query(collection(db, "matches"), orderBy("createdAt", "desc")), snap => {
      setMatches(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => { unsubP(); unsubM(); };
  }, []);

  function handleLogin(role = "admin") {
    setAuthState(role);
  }

  function handleLogout() {
    sessionStorage.removeItem(SESSION_KEY);
    setAuthState("login");
  }

  async function addPlayer(name, icon, imageUrl = null) {
    const data = { name, icon, createdAt: serverTimestamp() };
    if (imageUrl) data.imageUrl = imageUrl;
    await addDoc(collection(db, "players"), data);
  }
  async function removePlayer(id) {
    if (!confirm("Remove this player?")) return;
    await deleteDoc(doc(db, "players", id));
  }
  async function editPlayer(id, name, icon, imageUrl = null) {
    const data = { name, icon };
    data.imageUrl = imageUrl ? imageUrl : deleteField();
    await updateDoc(doc(db, "players", id), data);
  }
  async function saveMatch(data) {
    await addDoc(collection(db, "matches"), { ...data, createdAt: serverTimestamp() });
    setTab("board");
  }
  async function deleteMatch(id) {
    if (!confirm("Delete this match?")) return;
    await deleteDoc(doc(db, "matches", id));
  }

  if (authState === "loading") return null;
  if (authState === "login") return <LoginScreen onLogin={handleLogin} />;

  const isAdmin = authState === "admin";
  const isMember = authState === "member";

  const TABS = [
    { k: "board", l: "Leaderboard" },
    ...((isAdmin || isMember) ? [{ k: "match", l: "New Match" }] : []),
    ...(!isMember ? [{ k: "players", l: "Players" }] : []),
    { k: "stats", l: "Stats" },
    { k: "history", l: "History" },
  ];

  if (tab === "match" && !isAdmin && !isMember) setTab("board");
  if (tab === "players" && isMember) setTab("board");

  return (
    <div className="app">
      <style>{`
  .nav-btn-hover {
    transition: transform 0.2s ease, box-shadow 0.3s ease, filter 0.2s ease;
  }
  .nav-btn-hover:hover {
    transform: translateY(-2px) scale(1.04);
  }
  .nav-btn-fnf:hover {
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.5), 0 4px 12px rgba(255, 255, 255, 0.3);
    filter: brightness(1.15);
  }
  .nav-btn-spin:hover {
    box-shadow: 0 0 24px rgba(251, 191, 36, 0.7), 0 4px 14px rgba(245, 158, 11, 0.5);
    filter: brightness(1.1);
  }
  .nav-btn-login:hover {
    box-shadow: 0 0 18px rgba(255, 255, 255, 0.4), 0 4px 10px rgba(255, 255, 255, 0.25);
    background: rgba(255,255,255,0.25) !important;
  }
  .nav-btn-hover:active {
    transform: translateY(0) scale(0.98);
  }
  .upwork-banner:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 28px rgba(6, 78, 59, 0.4) !important;
  }
`}</style>
      <div className="app-header" style={{ position: "relative" }}>
        <div className="header-top" style={{ display: "flex", alignItems: "center", gap: 12, paddingRight: 140 }}>
          <div className="header-logo">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="9" stroke="white" strokeWidth="1.5" />
              <circle cx="11" cy="11" r="3" fill="white" />
              <circle cx="6.5" cy="6.5" r="1.8" fill="white" opacity="0.5" />
              <circle cx="15.5" cy="15.5" r="1.8" fill="white" opacity="0.5" />
            </svg>
          </div>
          <div className="header-text">
            <h1>Carrom Tracker</h1>
            <div className="subtitle">{players.length} players · {matches.length} matches</div>
          </div>
        </div>
        <div style={{ position: "absolute", top: "50%", right: 16, transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6, zIndex: 2 }}>
          <a href="https://fnfschool.com" target="_blank" rel="noopener noreferrer"
            className="nav-btn-hover nav-btn-fnf"
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: "var(--radius-sm)", padding: "5px 10px", textDecoration: "none",
            }}>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>App by</span>
            <span style={{ fontSize: 12, color: "#ffffff", fontFamily: "'Sora', sans-serif", fontWeight: 800, lineHeight: 1.2 }}>Zahidul</span>
          </a>
          <button
            onClick={() => setShowSpin(true)}
            className="nav-btn-hover nav-btn-spin"
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)",
              border: "1px solid rgba(255, 215, 0, 0.6)",
              borderRadius: "var(--radius-sm)",
              padding: "5px 10px", cursor: "pointer",
              fontFamily: "inherit", width: "100%",
              boxShadow: "0 2px 8px rgba(251, 191, 36, 0.3)",
            }}
          >
            <span style={{ fontSize: 9, color: "rgba(0, 0, 0, 0.7)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>
              🎲 Random
            </span>
            <span style={{ fontSize: 12, color: "#1a1a1a", fontFamily: "'Sora', sans-serif", fontWeight: 800, lineHeight: 1.2 }}>
              Team Spin
            </span>
          </button>
        </div>
        <div className="status-bar">
          <span className={`sync-dot ${synced ? "live" : "loading"}`} />
          {synced ? "Live sync active" : "Connecting..."}
          {(isAdmin || isMember) && <span style={{ marginLeft: 8, background: isAdmin ? "rgba(212,160,23,0.3)" : "rgba(37,99,235,0.3)", color: isAdmin ? "#fef3c7" : "#dbeafe", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10 }}>{isAdmin ? "Admin" : "Member"}</span>}
        </div>
      </div>

      <div className="tabs-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="tabs">
          {TABS.map(({ k, l }) => (
            <button key={k} className={`tab-btn ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {(isAdmin || isMember) ? (
          <button onClick={handleLogout} className="nav-btn-hover nav-btn-login" style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.5)",
            borderRadius: 6, padding: "4px 14px", color: "rgba(255,255,255,0.9)",
            fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
            marginRight: 4, flexShrink: 0,
          }}>Logout</button>
        ) : (
          <button onClick={() => setAuthState("login")} className="nav-btn-hover nav-btn-login" style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.5)",
            borderRadius: 6, padding: "4px 14px", color: "rgba(255,255,255,0.9)",
            fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
            marginRight: 4, flexShrink: 0,
          }}>Login</button>
        )}
      </div>

      <div className="content">
        {tab === "board" && <Leaderboard players={players} matches={matches} onSelectPlayer={setSelectedPlayer} onNavigateToStats={() => setTab("stats")} />}
        {tab === "match" && (isAdmin || isMember) && <NewMatch players={players} onSave={saveMatch} />}
        {tab === "players" && <Players players={players} matches={matches} onAdd={isAdmin ? addPlayer : undefined} onRemove={isAdmin ? removePlayer : undefined} onEdit={isAdmin ? editPlayer : undefined} isAdmin={isAdmin} onSelectPlayer={setSelectedPlayer} onNavigateToStats={() => setTab("stats")} />}
        {tab === "stats" && <Stats players={players} matches={matches} selectedPlayer={selectedPlayer} setSelectedPlayer={setSelectedPlayer} />}
        {tab === "history" && <History players={players} matches={matches} onDelete={deleteMatch} isAdmin={isAdmin} />}
      </div>
      {showSpin && <TeamSpin players={players} matches={matches} onClose={() => setShowSpin(false)} />}

      {/* Upwork Promotional Banner */}
      <a
        href="https://fnfschool.com"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          margin: "32px 16px 24px",
          background: "linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)",
          borderRadius: 16,
          padding: "20px 24px",
          textDecoration: "none",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 4px 20px rgba(6, 78, 59, 0.25)",
          transition: "transform 0.2s ease, box-shadow 0.3s ease",
        }}
        className="upwork-banner"
      >
        <div style={{
          position: "absolute", top: -40, right: -40, width: 160, height: 160,
          borderRadius: "50%", background: "rgba(255, 255, 255, 0.05)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: -30, right: 80, width: 100, height: 100,
          borderRadius: "50%", background: "rgba(255, 255, 255, 0.04)",
          pointerEvents: "none",
        }} />

        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          position: "relative", zIndex: 1, flexWrap: "wrap",
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12,
            background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, flexShrink: 0,
            boxShadow: "0 4px 12px rgba(251, 191, 36, 0.4)",
          }}>
            🎓
          </div>

          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: "#fbbf24",
              letterSpacing: "0.1em", textTransform: "uppercase",
              marginBottom: 4,
            }}>
              Powered by FNF School
            </div>
            <div style={{
              fontSize: 17, fontWeight: 800, color: "#ffffff",
              marginBottom: 4, lineHeight: 1.3,
            }}>
              Upwork এ সফল ফ্রিল্যান্সার হতে চান?
            </div>
            <div style={{
              fontSize: 13, color: "rgba(255, 255, 255, 0.85)",
              lineHeight: 1.4,
            }}>
              Profile optimization, proposal writing, এবং client management শিখুন।
            </div>
          </div>

          <div style={{
            background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
            color: "#1a1a1a", fontWeight: 700, fontSize: 14,
            padding: "10px 18px", borderRadius: 8,
            whiteSpace: "nowrap", flexShrink: 0,
            boxShadow: "0 4px 12px rgba(251, 191, 36, 0.4)",
          }}>
            বিস্তারিত →
          </div>
        </div>
      </a>

      {/* Footer */}
      <footer style={{
        margin: "48px 16px 32px",
        padding: "32px 16px 16px",
        borderTop: "1px solid var(--border, rgba(0,0,0,0.1))",
        textAlign: "center",
        fontSize: 13,
        color: "var(--muted, #6b7280)",
        lineHeight: 1.8,
      }}>
        <div>
          Built by{" "}
          <a
            href="https://fnfschool.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#16a34a", fontWeight: 700, textDecoration: "none" }}
          >
            FNF School
          </a>
          {" · "}Carrom Tracker for Friends
        </div>
        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
          © 2026 · Realtime sync · Made with ❤️ for carrom lovers
        </div>
      </footer>
    </div>
  );
}