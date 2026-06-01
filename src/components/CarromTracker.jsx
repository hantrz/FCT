"use client";

import { useState, useEffect, useRef } from "react";
import {
  collection, addDoc, deleteDoc, doc, getDoc, getDocs, updateDoc, setDoc,
  onSnapshot, query, orderBy, serverTimestamp, deleteField, limit,
} from "firebase/firestore";
import {
  signInWithEmailAndPassword, signOut, updatePassword, onAuthStateChanged,
} from "firebase/auth";
import { db, auth } from "../lib/firebase";
import Bills from "./Bills";

function getSeasonId(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  if (year === 2026 && month === 5) return "May 2026";
  const pairs = [
    [6,7,"Jun-Jul"], [8,9,"Aug-Sep"], [10,11,"Oct-Nov"]
  ];
  const fullYearPairs = [
    [2,3,"Feb-Mar"], [4,5,"Apr-May"], [6,7,"Jun-Jul"],
    [8,9,"Aug-Sep"], [10,11,"Oct-Nov"]
  ];
  const decJanCheck = (month === 12 || month === 1);
  if (decJanCheck) {
    const y = month === 12 ? year : year - 1;
    return `Dec-Jan ${y}-${String(y+1).slice(-2)}`;
  }
  if (year === 2026) {
    const pair = pairs.find(([s,e]) => month >= s && month <= e);
    if (pair) return `${pair[2]} ${year}`;
  }
  const pair = fullYearPairs.find(([s,e]) => month >= s && month <= e);
  if (pair) return `${pair[2]} ${year}`;
  return `${year}`;
}

function getSeasonDateRange(seasonId) {
  if (seasonId === "May 2026") return { start: new Date(2026, 4, 1), end: new Date(2026, 4, 31, 23, 59, 59) };
  if (seasonId.startsWith("Dec-Jan")) {
    const parts = seasonId.split(" ");
    const years = parts[1].split("-");
    const y1 = parseInt(years[0]);
    const y2 = 2000 + parseInt(years[1]);
    return { start: new Date(y1, 11, 1), end: new Date(y2, 0, 31, 23, 59, 59) };
  }
  const monthMap = {
    "Jun-Jul": [5, 6], "Aug-Sep": [7, 8], "Oct-Nov": [9, 10],
    "Feb-Mar": [1, 2], "Apr-May": [3, 4]
  };
  const parts = seasonId.split(" ");
  const label = parts[0];
  const year = parseInt(parts[1]);
  const [startM, endM] = monthMap[label];
  return { start: new Date(year, startM, 1), end: new Date(year, endM + 1, 0, 23, 59, 59) };
}

function getSeasonNumber(seasonId) {
  if (seasonId === "May 2026") return 0;
  if (seasonId === "Jun-Jul 2026") return 1;
  if (seasonId === "Aug-Sep 2026") return 2;
  if (seasonId === "Oct-Nov 2026") return 3;
  if (seasonId === "Dec-Jan 2026-27") return 4;
  const order = ["Feb-Mar", "Apr-May", "Jun-Jul", "Aug-Sep", "Oct-Nov"];
  const decJanPattern = /^Dec-Jan (\d{4})-(\d{2})$/;
  const decJanMatch = seasonId.match(decJanPattern);
  if (decJanMatch) {
    const y1 = parseInt(decJanMatch[1]);
    if (y1 < 2026) return null;
    const yearsAfter2026 = y1 - 2026;
    return 4 + (yearsAfter2026 * 6);
  }
  const parts = seasonId.split(" ");
  const label = parts[0];
  const year = parseInt(parts[1]);
  if (isNaN(year)) return null;
  const idx = order.indexOf(label);
  if (idx === -1) return null;
  if (year === 2027) return 5 + idx;
  if (year > 2027) {
    const yearsAfter2027 = year - 2027;
    return 5 + (yearsAfter2027 * 6) + idx;
  }
  return null;
}

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
  const currentSeasonId = getSeasonId(new Date());
  const [seasonView, setSeasonView] = useState("current"); // "current" | "alltime" | "past"
  const [selectedPastSeason, setSelectedPastSeason] = useState("");
  const availableSeasons = (() => {
    const ids = new Set();
    matches.forEach(m => { if (m.seasonId) ids.add(m.seasonId); });
    return Array.from(ids).sort((a, b) => getSeasonDateRange(b).start - getSeasonDateRange(a).start);
  })();
  const pastSeasons = availableSeasons.filter(s => s !== currentSeasonId);
  const [showSeasonDropdown, setShowSeasonDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const { end } = getSeasonDateRange(currentSeasonId);
    const msLeft = end - new Date();
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    const interval = daysLeft <= 1 ? 1000 : 60000;
    const timer = setInterval(() => forceUpdate(n => n + 1), interval);
    return () => clearInterval(timer);
  }, [currentSeasonId]);
  const displayMatches = (() => {
    if (seasonView === "alltime") return matches.filter(m => m.seasonId !== "May 2026");
    if (seasonView === "past") {
      const target = selectedPastSeason || pastSeasons[0] || currentSeasonId;
      return matches.filter(m => m.seasonId === target);
    }
    return matches.filter(m => m.seasonId === currentSeasonId);
  })();
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

  useEffect(() => {
    if (!showSeasonDropdown) return;
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowSeasonDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSeasonDropdown]);

  const raw = computeStats(players, displayMatches);
  const stats = raw.map(p => {
    const badges = calcBadges(p.id, displayMatches);
    const points = 0
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
  const QUALIFY_THRESHOLD = 5;
  const qualifiedSorted = sorted.filter(p => p.played >= QUALIFY_THRESHOLD);
  const unqualifiedSorted = sorted.filter(p => p.played < QUALIFY_THRESHOLD);
  const qualifyColors = isDark ? {
    cardBg: "#1c1a12", cardBorder: "#78350f",
    headerBg: "#451a03", textColor: "#fde68a",
    subtitleColor: "#fcd34d", needColor: "#fbbf24",
  } : {
    cardBg: "#fffbeb", cardBorder: "#fcd34d",
    headerBg: "#fef3c7", textColor: "#92400e",
    subtitleColor: "#b45309", needColor: "#d97706",
  };

  const thisWeek = (() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    return displayMatches.filter(m => m.createdAt && m.createdAt.toDate() >= monday).length;
  })();
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
      {/* Season view tabs */}
      <div style={{ marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {/* Tab 1: Current Season */}
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
          {/* Tab 2: All Time */}
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
          {/* Tab 3: Previous Seasons with custom dropdown */}
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
              Previous Seasons
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
                  <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-muted)" }}>No previous seasons yet</div>
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
                  >{(() => { const num = getSeasonNumber(s); return num === 0 ? `Season 0 (Archive) (${s})` : num !== null ? `Season ${num} (${s})` : s; })()}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Active season header */}
        {seasonView === "current" && (() => {
          const seasonNum = getSeasonNumber(currentSeasonId);
          const seasonLabel = seasonNum !== null ? (seasonNum === 0 ? `Season 0 (Archive): ${currentSeasonId}` : `Season ${seasonNum}: ${currentSeasonId}`) : `Season: ${currentSeasonId}`;
          const { end } = getSeasonDateRange(currentSeasonId);
          const now = new Date();
          const msLeft = end - now;
          const totalHours = Math.floor(msLeft / (1000 * 60 * 60));
          const days = Math.floor(totalHours / 24);
          const hours = totalHours % 24;
          const minutes = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((msLeft % (1000 * 60)) / 1000);
          const isUrgent = days <= 7;
          let countdownText = "";
          if (msLeft <= 0) {
            countdownText = "Ending...";
          } else if (days > 0) {
            countdownText = `${days}d : ${String(hours).padStart(2, "0")}h`;
          } else if (hours > 0) {
            countdownText = `${hours}h : ${String(minutes).padStart(2, "0")}m`;
          } else {
            countdownText = `${minutes}m : ${String(seconds).padStart(2, "0")}s`;
          }
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{seasonLabel}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#dcfce7", color: "#16a34a", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>
                  <span className="live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a", flexShrink: 0 }} />
                  LIVE
                </span>
              </div>
              <span style={{ fontSize: 11, color: isUrgent ? "#dc2626" : "var(--text-muted)", fontWeight: 600 }}>⏳ Season ending & next season coming up: {countdownText}</span>
            </div>
          );
        })()}
        {seasonView === "alltime" && (
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>All Time Stats</span>
        )}
        {seasonView === "past" && (selectedPastSeason || pastSeasons[0] || currentSeasonId) !== "May 2026" && (
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            {(() => { const sid = selectedPastSeason || pastSeasons[0] || currentSeasonId; const num = getSeasonNumber(sid); return num !== null ? `Season ${num}: ${sid}` : `Season: ${sid}`; })()}
          </span>
        )}
      </div>
      {!(seasonView === "past" && (selectedPastSeason || pastSeasons[0] || currentSeasonId) === "May 2026") && (
        <div className="metrics">
          <div className="metric">
            <label>{seasonView === "alltime" ? "ALL TIME" : seasonView === "current" ? "THIS SEASON" : (selectedPastSeason || pastSeasons[0] || currentSeasonId)}</label>
            <span>{displayMatches.length}</span>
          </div>
          <div className="metric"><label>Players</label><span>{players.length}</span></div>
          <div className="metric"><label>This Week</label><span>{thisWeek}</span></div>
        </div>
      )}
      {seasonView === "past" && (selectedPastSeason || pastSeasons[0]) === "May 2026" ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Season 0 (Archive): May 2026</span>
            <span style={{ background: "#f3f4f6", color: "#6b7280", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>📦 ARCHIVED</span>
          </div>
          <Season0Archive players={players} />
        </div>
      ) : stats.length === 0 ? (
        <div className="empty"><p>No data yet. Add players and record matches!</p></div>
      ) : displayMatches.length === 0 ? (
        <div className="empty"><p>No matches played in this season yet.</p></div>
      ) : (
        <>
          {sortPills}
          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {qualifiedSorted.map((p, i) => {
                const rankColor = i < 3 ? rankColors[i] : "var(--text-muted)";
                const ptsColor = i < 3 ? "#f59e0b" : "var(--text)";
                const badges = calcBadges(p.id, displayMatches);
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
                            <span style={{ fontSize:11, borderRadius:20, padding:"1px 6px", fontWeight:600, background:"#dbeafe", color:"#1d4ed8", border:"0.5px solid #93c5fd" }}>{badges.cleanWins} ⚡</span>
                            {tooltip === `${p.id}-clean-win` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>⚡ Clean Win<br/>Won with opponent scoring 0<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
                          </span>
                        )}
                        {badges.cleanLosses > 0 && (
                          <span style={{ position:"relative", display:"inline-flex" }} onMouseEnter={() => setTooltip(`${p.id}-clean-loss`)} onMouseLeave={() => setTooltip(null)}>
                            <span className="clean-loss-badge" style={{ fontSize:11, borderRadius:20, padding:"1px 6px", fontWeight:600 }}>{badges.cleanLosses} 💀</span>
                            {tooltip === `${p.id}-clean-loss` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>💀 Clean Loss<br/>Lost while scoring 0 points<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
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
                  {qualifiedSorted.map((p, i) => {
                    const badges = calcBadges(p.id, displayMatches);
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
                              <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, borderRadius:20, padding:"2px 8px", fontWeight:600, background:"#dbeafe", color:"#1d4ed8", border:"0.5px solid #93c5fd" }}>{badges.cleanWins} ⚡</span>
                              {tooltip === `${p.id}-clean-win` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>⚡ Clean Win<br/>Won with opponent scoring 0<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
                            </span>
                          )}
                          {badges.cleanLosses > 0 && (
                            <span style={{ position:"relative", display:"inline-flex", flexShrink:0 }} onMouseEnter={() => setTooltip(`${p.id}-clean-loss`)} onMouseLeave={() => setTooltip(null)}>
                              <span className="clean-loss-badge" style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, borderRadius:20, padding:"2px 8px", fontWeight:600 }}>{badges.cleanLosses} 💀</span>
                              {tooltip === `${p.id}-clean-loss` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>💀 Clean Loss<br/>Lost while scoring 0 points<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
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
          {unqualifiedSorted.length > 0 && (
            <div className="qualify-card" style={{
              marginTop: 16,
              background: qualifyColors.cardBg,
              borderRadius: 12,
              border: `1px solid ${qualifyColors.cardBorder}`,
              overflow: "hidden",
            }}>
              <div className="qualify-header" style={{
                padding: "10px 14px",
                background: qualifyColors.headerBg,
                borderBottom: `1px solid ${qualifyColors.cardBorder}`,
              }}>
                <div className="qualify-title" style={{ fontWeight: 700, fontSize: 13, color: qualifyColors.textColor }}>🏆 Qualify for the Leaderboard</div>
                <div className="qualify-subtitle" style={{ fontSize: 11, color: qualifyColors.subtitleColor, marginTop: 2 }}>These players need more matches to appear on the leaderboard</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {unqualifiedSorted.map((p, i) => (
                  <div key={p.id} className="qualify-row" onClick={() => goToPlayer(p.id)} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px",
                    borderBottom: i < unqualifiedSorted.length - 1 ? `1px solid ${qualifyColors.cardBorder}` : "none",
                    cursor: onSelectPlayer ? "pointer" : "default",
                  }}>
                    <PlayerAvatar player={p} size={34} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="qualify-player-name" style={{ fontWeight: 600, fontSize: 13, color: qualifyColors.textColor }}>{p.name}</div>
                      <div style={{ display: "flex", gap: 5, marginTop: 2 }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-secondary)", borderRadius: 6, padding: "1px 6px" }}>{p.played}P</span>
                        <span style={{ fontSize: 11, color: "#16a34a", background: "var(--bg-secondary)", borderRadius: 6, padding: "1px 6px" }}>{p.won}W</span>
                        <span style={{ fontSize: 11, color: "#dc2626", background: "var(--bg-secondary)", borderRadius: 6, padding: "1px 6px" }}>{p.lost}L</span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-secondary)", borderRadius: 6, padding: "1px 6px" }}>{p.points}PTS</span>
                      </div>
                    </div>
                    <div className="qualify-need" style={{ fontSize: 11, color: qualifyColors.needColor, fontWeight: 600, textAlign: "right", flexShrink: 0 }}>
                      Need {QUALIFY_THRESHOLD - p.played} more<br />match{QUALIFY_THRESHOLD - p.played === 1 ? "" : "es"} to qualify
                    </div>
                  </div>
                ))}
              </div>
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
                { k: "points",   l: "POINTS RULES" },
                { k: "spin",     l: "SPIN/HIT RULES" },
                { k: "badges",   l: "BADGE GUIDE" },
                { k: "features", l: "APP FEATURES" }
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
                    { badge: { bg:"#fef2f2", color:"#b91c1c", border:"0.5px solid #fca5a5" }, icon:"😢", label:"Loss-trick: Every 3 consecutive losses" },
                    { badge: { bg:"#dbeafe", color:"#1d4ed8", border:"0.5px solid #93c5fd" }, icon:"⚡", label:"Clean Win: Opponent scored 0 points" },
                    { badge: { cls:"clean-loss-badge" }, icon:"💀", label:"Clean Loss: You scored 0 points" },
                  ].map((item, i, arr) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      paddingTop: i === 0 ? 0 : 8,
                      paddingBottom: i === arr.length - 1 ? 0 : 8,
                      borderBottom: i === arr.length - 1 ? "none" : `0.5px solid ${guideColors.separator}`
                    }}>
                      <span className={item.badge.cls || ""} style={{
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
                    { icon: "🚫", color: { bg:"#fee2e2", fg:"#dc2626", bd:"#fca5a5" }, label: "Partner Cooldown: Last 2 match teammates stay separated" },
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
                      <span style={{ fontSize: 12, color: item.textColor || guideColors.labelText }}>{item.label}</span>
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
                  <div style={{
                    marginTop: 16,
                    paddingTop: 16,
                    borderTop: "2px solid rgba(251, 191, 36, 0.3)",
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
                      textTransform: "uppercase", color: "#f59e0b",
                      marginBottom: 10,
                    }}>
                      🎯 Strike First Logic
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                        background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 20,
                        boxShadow: "0 2px 8px rgba(251, 191, 36, 0.4)",
                      }}>
                        🎯
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          First Strike: Fully Random
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                          No rules or points-based logic — one random player from the 4 selected players gets to strike first
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {/* APP FEATURES CONTENT */}
              {guideTab === "features" && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {[
                    { icon: "🏆", name: "Leaderboard", desc: "Points-based ranking system & Win%, Matches, Wins, Losses filter" },
                    { icon: "📊", name: "Stats", desc: "By Date, By Player, Best Partner analysis & Head to Head record" },
                    { icon: "📜", name: "Match History", desc: "Full match log with date & time, Hat-trick & Loss-trick notifications, Clean Win & Clean Loss tracking" },
                    { icon: "🎰", name: "Team Spin", desc: "Smart balanced team selection with Partner Cooldown rule & Strike First logic" },
                    { icon: "🏅", name: "Badge System", desc: "Hat-trick (3 consecutive wins), Loss-trick (3 consecutive losses), Clean Win & Clean Loss badges" },
                    { icon: "💬", name: "Chat", desc: "Real-time group chat & private messaging between members" },
                    { icon: "👤", name: "Profile", desc: "Personal stats, rank, points & match history" },
                  ].map((item, i, arr) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      paddingTop: i === 0 ? 0 : 8,
                      paddingBottom: i === arr.length - 1 ? 0 : 8,
                      borderBottom: i === arr.length - 1 ? "none" : `0.5px solid ${guideColors.separator}`
                    }}>
                      <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1 }}>{item.icon}</span>
                      <span style={{ fontSize: 12, color: guideColors.labelText }}>
                        <span style={{ fontWeight: 600 }}>{item.name}:</span>{" "}{item.desc}
                      </span>
                    </div>
                  ))}
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
function Players({ players, matches, onAdd, onRemove, onEdit, onResetPassword, isAdmin, onSelectPlayer, onNavigateToStats }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
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
    await onAdd(name.trim(), icon, uploadedImage, mobile.trim());
    setName(""); setMobile(""); setUploadedImage(null); setAdding(false);
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
          <div style={{ display: "flex", gap: 8, marginBottom: name.trim().toLowerCase() !== "random man" ? 8 : 0 }}>
            <input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="Player name" style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={handleAdd} disabled={adding} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
              {adding ? "..." : "Add"}
            </button>
          </div>
          {name.trim().toLowerCase() !== "random man" && (
            <input
              value={mobile}
              onChange={e => setMobile(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="Mobile number (01XXXXXXXXX) — for login account"
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          )}
        </div>
      )}

      {players.length === 0 ? (
        <div className="empty"><p>No players added yet.</p></div>
      ) : (
        <div className="players-grid">
          {[...players].sort((a, b) => {
            const getPoints = (p) => {
              const st = computeStats([p], matches)[0] || { won: 0, lost: 0 };
              const badges = calcBadges(p.id, matches);
              return (st.won * 3) + (st.lost * -2) + (badges.cleanWins * 2) + (badges.cleanLosses * -3) + (badges.hatTricks * 3) + (badges.lossTricks * -3);
            };
            return getPoints(b) - getPoints(a);
          }).map((p, i) => {
            const st = stats.find(s => s.id === p.id) || { played: 0, winPct: 0 };
            return (
              <div key={p.id} className="player-card" onClick={() => { if (onSelectPlayer && onNavigateToStats) { onSelectPlayer(p.id); onNavigateToStats(); } }}
                style={{ cursor: onSelectPlayer ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
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
                <div style={{ margin: "0 auto 8px" }}>
                  <PlayerAvatar player={p} size={46} />
                </div>
                <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 3, textAlign: "center" }}>{p.name}</p>
                <p className="text-muted" style={{ fontSize: 11, textAlign: "center" }}>{st.played} matches</p>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--green)", marginTop: 2, textAlign: "center" }}>{st.winPct}% win rate</p>
                {isAdmin && onResetPassword && p.name.toLowerCase() !== "random man" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Reset ${p.name}'s password to default?`)) {
                        onResetPassword(p.name);
                      }
                    }}
                    style={{
                      marginTop: 7, fontSize: 11, fontWeight: 500,
                      padding: "3px 8px", borderRadius: 5,
                      border: "1px solid var(--border-strong)",
                      background: "var(--bg-secondary)",
                      color: "var(--text-muted)", cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    🔑 Reset pwd
                  </button>
                )}
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

function getMatchBadgeLogs(match, allMatches, players) {
  const logs = [];
  const team1 = match.team1 || [];
  const team2 = match.team2 || [];
  const winnerTeam = match.winner === "team1" ? team1 : team2;
  const loserTeam = match.winner === "team1" ? team2 : team1;

  const getPlayerName = (id) => {
    const p = players.find(p => p.id === id);
    return p ? p.name : id;
  };

  function getTime(m) {
    const t = m.timestamp || m.date || m.createdAt || m.time;
    if (!t) return 0;
    if (typeof t === "number") return t;
    if (typeof t.toMillis === "function") return t.toMillis();
    if (t.seconds) return t.seconds * 1000;
    if (t instanceof Date) return t.getTime();
    return 0;
  }
  const sortedMatches = [...allMatches].sort((a, b) => getTime(a) - getTime(b));
  const thisMatchIndex = sortedMatches.findIndex(m => m.id === match.id);
  const matchesUpToAndIncludingThis = sortedMatches.slice(0, thisMatchIndex + 1);

  winnerTeam.forEach(playerId => {
    const playerMatches = matchesUpToAndIncludingThis.filter(m =>
      (m.team1 || []).includes(playerId) || (m.team2 || []).includes(playerId)
    );

    let consecutiveWins = 0;
    for (let i = playerMatches.length - 1; i >= 0; i--) {
      const m = playerMatches[i];
      const inTeam1 = (m.team1 || []).includes(playerId);
      const isWin = (inTeam1 && m.winner === "team1") || (!inTeam1 && m.winner === "team2");
      if (isWin) {
        consecutiveWins++;
      } else {
        break;
      }
    }

    const isThisMatchAWin = (() => {
      const inTeam1 = (match.team1 || []).includes(playerId);
      return (inTeam1 && match.winner === "team1") || (!inTeam1 && match.winner === "team2");
    })();

    if (isThisMatchAWin && consecutiveWins > 0 && consecutiveWins % 3 === 0) {
      logs.push({ type: "hattrick", text: `🔥 ${getPlayerName(playerId)} earned Hat-trick` });
    }
  });

  loserTeam.forEach(playerId => {
    const playerMatches = matchesUpToAndIncludingThis.filter(m =>
      (m.team1 || []).includes(playerId) || (m.team2 || []).includes(playerId)
    );

    let consecutiveLosses = 0;
    for (let i = playerMatches.length - 1; i >= 0; i--) {
      const m = playerMatches[i];
      const inTeam1 = (m.team1 || []).includes(playerId);
      const isLoss = !((inTeam1 && m.winner === "team1") || (!inTeam1 && m.winner === "team2"));
      if (isLoss) {
        consecutiveLosses++;
      } else {
        break;
      }
    }

    if (consecutiveLosses > 0 && consecutiveLosses % 3 === 0) {
      logs.push({ type: "losstrick", text: `😢 ${getPlayerName(playerId)} earned Loss-trick` });
    }
  });

  if (match.loserScore !== null && match.loserScore !== undefined && Number(match.loserScore) === 0) {
    const winnerNames = winnerTeam.map(getPlayerName).join(" & ");
    logs.push({ type: "cleanwin", text: `⚡ ${winnerNames} — Clean Win (Opponent scored 0 points)` });
  }

  return logs;
}

function formatMatchDateTime(match) {
  function getTime(m) {
    const t = m.timestamp || m.date || m.createdAt || m.time;
    if (!t) return null;
    if (typeof t === "number") return new Date(t);
    if (typeof t.toMillis === "function") return new Date(t.toMillis());
    if (t.seconds) return new Date(t.seconds * 1000);
    if (t instanceof Date) return t;
    return null;
  }
  const date = getTime(match);
  if (!date) return "Unknown date";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const bdOffset = 6 * 60;
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  const bdDate = new Date(utc + (bdOffset * 60000));
  const day = bdDate.getDate();
  const month = months[bdDate.getMonth()];
  const year = bdDate.getFullYear();
  let hours = bdDate.getHours();
  const minutes = bdDate.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
}

// ── History ───────────────────────────────────────────────────────────────────
function History({ players, matches, onDelete, isAdmin }) {
  const getName = id => players.find(p => p.id === id)?.name || "?";

  if (!matches.length) return <div className="empty"><p>No matches recorded yet.</p></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {matches.map(m => {
        const w1 = m.winner === "team1";
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
              <p className="text-muted" style={{ fontSize: 11 }}>{formatMatchDateTime(m)} · {m.type || "2v2"}</p>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.6 }}>
                  <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Added by {m.addedBy?.name ?? "Admin"}
              </p>
              {(() => {
                const badgeLogs = getMatchBadgeLogs(m, matches, players);
                return badgeLogs.length > 0 ? (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 3 }}>
                    {badgeLogs.map((log, i) => (
                      <div key={i} style={{ fontSize: 12, color: log.type === "hattrick" ? "#d97706" : log.type === "losstrick" ? "#dc2626" : log.type === "cleanwin" ? "#1d4ed8" : "#6b7280", fontWeight: 500 }}>
                        {log.text}
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}
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
function Stats({ players, matches, selectedPlayer, setSelectedPlayer, statsMode, setStatsMode }) {
  const mode = statsMode;
  const setMode = setStatsMode;
  const [dateFilter, setDateFilter] = useState("alltime");
  const [tooltip, setTooltip] = useState(null);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth <= 768);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [h2hPlayer1, setH2hPlayer1] = useState("");
  const [h2hPlayer2, setH2hPlayer2] = useState("");

  const getName = id => players.find(p => p.id === id)?.name || "?";

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  function filterByDate(ms) {
    if (dateFilter === "alltime") return ms;
    const now = new Date();
    if (dateFilter === "today") {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return ms.filter(m => {
        function getTime(m) {
          const t = m.timestamp || m.date || m.createdAt || m.time;
          if (!t) return 0;
          if (typeof t === "number") return t;
          if (typeof t.toMillis === "function") return t.toMillis();
          if (t.seconds) return t.seconds * 1000;
          if (t instanceof Date) return t.getTime();
          return 0;
        }
        const matchTime = getTime(m);
        return matchTime >= startOfDay.getTime() && matchTime <= endOfDay.getTime();
      });
    }
    if (dateFilter === "weekly") {
      const dayOfWeek = now.getDay();
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() + diffToMonday);
      startOfWeek.setHours(0, 0, 0, 0);
      return ms.filter(m => {
        if (!m.createdAt) return false;
        return m.createdAt.toDate() >= startOfWeek;
      });
    }
    return ms.filter(m => {
      if (!m.createdAt) return false;
      const d = m.createdAt.toDate();
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
    const pmSorted = [...pm].sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
    let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
    for (const m of pmSorted) {
      const inT1 = m.team1.includes(p.id);
      const isW = (inT1 && m.winner === "team1") || (!inT1 && m.winner === "team2");
      if (isW) { curWin++; curLoss = 0; if (curWin > maxWinStreak) maxWinStreak = curWin; }
      else { curLoss++; curWin = 0; if (curLoss > maxLossStreak) maxLossStreak = curLoss; }
    }
    const idx = players.findIndex(x => x.id === p.id);
    const c = PALETTE[idx % PALETTE.length];
    const lbStats = computeStats(players, matches).map(q => {
      const qb = calcBadges(q.id, matches);
      return { id: q.id, pts: (q.won * 3) + (q.lost * -2) + (qb.hatTricks * 3) + (qb.lossTricks * -3) + (qb.cleanWins * 2) + (qb.cleanLosses * -3) };
    }).sort((a, b) => b.pts - a.pts);
    const playerRank = lbStats.findIndex(q => q.id === p.id) + 1;
    const playerPts = lbStats.find(q => q.id === p.id)?.pts ?? 0;

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
                  {b.cleanWins > 0 && <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, borderRadius:20, padding:"2px 8px", fontWeight:600, background:"#dbeafe", color:"#1d4ed8", border:"0.5px solid #93c5fd" }}>{b.cleanWins} ⚡</span>}
                  {b.cleanLosses > 0 && <span className="clean-loss-badge" style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, borderRadius:20, padding:"2px 8px", fontWeight:600 }}>{b.cleanLosses} 💀</span>}
                </div>
              ) : null;
            })()}
            <div style={{ display: "flex", gap: 10, marginTop: 6, marginBottom: 6 }}>
              <span style={{ background: "#fef9c3", color: "#92400e", border: "1px solid #fde68a", borderRadius: 20, padding: "3px 10px", fontSize: 13, fontWeight: 700 }}>🏆 Rank #{playerRank}</span>
              <span style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0", borderRadius: 20, padding: "3px 10px", fontSize: 13, fontWeight: 700 }}>✦ {playerPts} pts</span>
            </div>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: "1rem" }}>
          <div className="metric"><label>Lost</label><span style={{ color: "var(--danger)" }}>{lost}</span></div>
          <div className="metric"><label>MAX WIN STREAK</label><span style={{ fontSize: 20, color: "var(--green)" }}>{maxWinStreak}W</span></div>
          <div className="metric"><label>MAX LOSS STREAK</label><span style={{ fontSize: 20, color: "var(--danger)" }}>{maxLossStreak}L</span></div>
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
    const baseStats = computeStats(players, filtered).filter(s => s.played > 0);
    const stats = baseStats.map(p => {
      const badges = calcBadges(p.id, filtered);
      const base = 0;
      const points = base + (p.won * 3) + (p.lost * -2) + (badges.cleanWins * 2) + (badges.cleanLosses * -3) + (badges.hatTricks * 3) + (badges.lossTricks * -3);
      return { ...p, points, badges };
    }).sort((a, b) => b.points - a.points || b.winPct - a.winPct);
    const rankColors = { 1: "#d97706", 2: "#64748b", 3: "#b45309" };
    const badgePills = (p) => (<>
      {p.badges.hatTricks > 0 && (
        <span style={{ position:"relative", display:"inline-flex" }} onMouseEnter={() => setTooltip(`${p.id}-fire`)} onMouseLeave={() => setTooltip(null)}>
          <span style={{ fontSize:11, borderRadius:20, padding:"1px 6px", fontWeight:600, background:"#fff7ed", color:"#c2410c", border:"0.5px solid #fed7aa" }}>{p.badges.hatTricks} 🔥</span>
          {tooltip === `${p.id}-fire` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>🔥 Hat-trick!<br/>{p.badges.hatTricks === 1 ? "1 hat-trick achieved" : `${p.badges.hatTricks} hat-tricks achieved`}<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
        </span>
      )}
      {p.badges.lossTricks > 0 && (
        <span style={{ position:"relative", display:"inline-flex" }} onMouseEnter={() => setTooltip(`${p.id}-loss-trick`)} onMouseLeave={() => setTooltip(null)}>
          <span style={{ fontSize:11, borderRadius:20, padding:"1px 6px", fontWeight:600, background:"#fef2f2", color:"#b91c1c", border:"0.5px solid #fca5a5" }}>{p.badges.lossTricks} 😢</span>
          {tooltip === `${p.id}-loss-trick` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>😢 Loss-trick!<br/>{p.badges.lossTricks === 1 ? "1 loss-trick" : `${p.badges.lossTricks} loss-tricks`}<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
        </span>
      )}
      {p.badges.cleanWins > 0 && (
        <span style={{ position:"relative", display:"inline-flex" }} onMouseEnter={() => setTooltip(`${p.id}-clean-win`)} onMouseLeave={() => setTooltip(null)}>
          <span style={{ fontSize:11, borderRadius:20, padding:"1px 6px", fontWeight:600, background:"#dbeafe", color:"#1d4ed8", border:"0.5px solid #93c5fd" }}>{p.badges.cleanWins} ⚡</span>
          {tooltip === `${p.id}-clean-win` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>⚡ Clean Win<br/>Won with opponent scoring 0<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
        </span>
      )}
      {p.badges.cleanLosses > 0 && (
        <span style={{ position:"relative", display:"inline-flex" }} onMouseEnter={() => setTooltip(`${p.id}-clean-loss`)} onMouseLeave={() => setTooltip(null)}>
          <span className="clean-loss-badge" style={{ fontSize:11, borderRadius:20, padding:"1px 6px", fontWeight:600 }}>{p.badges.cleanLosses} 💀</span>
          {tooltip === `${p.id}-clean-loss` && <span style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)", background:"#1f2937", color:"#fff", fontSize:11, borderRadius:8, padding:"6px 10px", whiteSpace:"nowrap", zIndex:100, lineHeight:1.5, textAlign:"center", pointerEvents:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>💀 Clean Loss<br/>Lost while scoring 0 points<span style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#1f2937 transparent transparent transparent" }}/></span>}
        </span>
      )}
    </>);

    return (
      <div>
        <p className="text-muted" style={{ fontSize: 12, marginBottom: "1rem", fontWeight: 600 }}>{dateFilter === "alltime" ? `All ${filtered.length} matches` : `${filtered.length} matches in this period`}</p>
        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stats.map((p, i) => {
              const isTop3 = i < 3;
              const ptsColor = isTop3 ? "#f59e0b" : p.points < 0 ? "#dc2626" : "var(--text)";
              return (
                <div key={p.id} style={{ background: "var(--card-bg)", borderRadius: 14, border: "1px solid var(--border)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", width: 24 }}>
                    <span style={{ fontWeight: isTop3 ? 900 : 700, fontSize: isTop3 ? 18 : 14, color: isTop3 ? rankColors[i + 1] : "var(--color-text-primary)", lineHeight: 1 }}>{i + 1}</span>
                  </div>
                  <PlayerAvatar player={p} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      {badgePills(p)}
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
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Player</th>
                <th style={{ width: 44, textAlign: "center" }}>P</th>
                <th style={{ width: 44, textAlign: "center" }}>W</th>
                <th style={{ width: 44, textAlign: "center" }}>L</th>
                <th style={{ width: 54, textAlign: "center" }}>PTS</th>
                <th style={{ width: 88, textAlign: "right" }}>Win%</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((p, i) => (
                <tr key={p.id}>
                  <td className="text-muted" style={{ fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ maxWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Avatar id={p.id} allPlayers={players} size={24} />
                      <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1, minWidth: 0 }}>{p.name}</span>
                      {badgePills(p)}
                    </div>
                  </td>
                  <td style={{ textAlign: "center", fontSize: 13 }}>{p.played}</td>
                  <td style={{ textAlign: "center" }} className="text-success"><b>{p.won}</b></td>
                  <td style={{ textAlign: "center", color: "#dc2626", fontWeight: 600, fontSize: 13 }}>{p.lost}</td>
                  <td style={{ textAlign: "center", color: "#f59e0b", fontWeight: 700, fontSize: 13 }}>{p.points}</td>
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
        )}
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

  function renderH2HStats() {
    const p1 = players.find(p => p.id === h2hPlayer1);
    const p2 = players.find(p => p.id === h2hPlayer2);

    function getMatchTime(m) {
      const t = m.timestamp || m.date || m.createdAt || m.time;
      if (!t) return 0;
      if (typeof t === "number") return t;
      if (typeof t.toMillis === "function") return t.toMillis();
      if (t.seconds) return t.seconds * 1000;
      if (t instanceof Date) return t.getTime();
      return 0;
    }

    const relevantMatches = matches
      .filter(m => {
        const p1InT1 = (m.team1 || []).includes(h2hPlayer1);
        const p1InT2 = (m.team2 || []).includes(h2hPlayer1);
        const p2InT1 = (m.team1 || []).includes(h2hPlayer2);
        const p2InT2 = (m.team2 || []).includes(h2hPlayer2);
        return (p1InT1 || p1InT2) && (p2InT1 || p2InT2);
      })
      .sort((a, b) => getMatchTime(b) - getMatchTime(a));

    let p1Wins = 0, p2Wins = 0, sameTeam = 0, sameTeamWins = 0, sameTeamLosses = 0;
    for (const m of relevantMatches) {
      const p1InT1 = (m.team1 || []).includes(h2hPlayer1);
      const p2InT1 = (m.team1 || []).includes(h2hPlayer2);
      if (p1InT1 === p2InT1) {
        sameTeam++;
        const theirTeamWon = (p1InT1 && m.winner === "team1") || (!p1InT1 && m.winner === "team2");
        if (theirTeamWon) sameTeamWins++; else sameTeamLosses++;
      } else {
        const p1Won = (p1InT1 && m.winner === "team1") || (!p1InT1 && m.winner === "team2");
        if (p1Won) p1Wins++; else p2Wins++;
      }
    }

    const h2hTotal = p1Wins + p2Wins;

    // FIX 4: box colors based on who leads
    const p1Leading = p1Wins > p2Wins;
    const p2Leading = p2Wins > p1Wins;
    const p1BoxStyle = p1Leading
      ? { background: "#dcfce7" }
      : p2Leading
        ? { background: "#fee2e2" }
        : { background: "#dcfce7" };
    const p2BoxStyle = p2Leading
      ? { background: "#dcfce7" }
      : p1Leading
        ? { background: "#fee2e2" }
        : { background: "#dcfce7" };
    const p1NumColor = p1Leading ? "#16a34a" : p2Leading ? "#dc2626" : "#16a34a";
    const p2NumColor = p2Leading ? "#16a34a" : p1Leading ? "#dc2626" : "#16a34a";

    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem" }}>
          <div style={{ flex: 1 }}>
            <p className="section-label">Player 1</p>
            <PlayerSelect
              players={players}
              value={h2hPlayer1}
              onChange={setH2hPlayer1}
              placeholder="Select Player 1"
              excludeIds={h2hPlayer2 ? [h2hPlayer2] : []}
            />
          </div>
          <div style={{ flex: 1 }}>
            <p className="section-label">Player 2</p>
            <PlayerSelect
              players={players}
              value={h2hPlayer2}
              onChange={setH2hPlayer2}
              placeholder="Select Player 2"
              excludeIds={h2hPlayer1 ? [h2hPlayer1] : []}
            />
          </div>
        </div>

        {p1 && p2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* FIX 1: VS card as 3-col grid matching stat boxes */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, background: "var(--bg-secondary)", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <PlayerAvatar player={p1} size={40} />
                <span style={{ fontSize: 13, fontWeight: 700, textAlign: "center" }}>{p1.name}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text-muted)", letterSpacing: 2 }}>VS</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <PlayerAvatar player={p2} size={40} />
                <span style={{ fontSize: 13, fontWeight: 700, textAlign: "center" }}>{p2.name}</span>
              </div>
            </div>

            {/* Result summary boxes */}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, borderRadius: 8, padding: "12px 8px", textAlign: "center", ...p1BoxStyle }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: p1NumColor }}>{p1Wins}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{p1.name} wins</div>
              </div>
              {/* FIX 2: Same Team box with W/L record */}
              <div style={{ flex: 1, background: "var(--bg-secondary)", borderRadius: 8, padding: "12px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-muted)" }}>{sameTeam}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Same Team</div>
                {sameTeam > 0 && (
                  <div style={{ fontSize: 11, marginTop: 3, display: "flex", justifyContent: "center", gap: 4 }}>
                    <span style={{ color: "#16a34a", fontWeight: 600 }}>{sameTeamWins}W</span>
                    <span style={{ color: "var(--text-muted)" }}>/</span>
                    <span style={{ color: "#dc2626", fontWeight: 600 }}>{sameTeamLosses}L</span>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, borderRadius: 8, padding: "12px 8px", textAlign: "center", ...p2BoxStyle }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: p2NumColor }}>{p2Wins}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{p2.name} wins</div>
              </div>
            </div>

            {/* Win bar */}
            {h2hTotal > 0 && (
              <div style={{ display: "flex", height: 8, borderRadius: 6, overflow: "hidden", gap: 2 }}>
                {p1Wins > 0 && <div style={{ flex: p1Wins, background: "var(--green)", borderRadius: "6px 0 0 6px" }} />}
                {sameTeam > 0 && <div style={{ flex: sameTeam, background: "var(--border)" }} />}
                {p2Wins > 0 && <div style={{ flex: p2Wins, background: "var(--green)", borderRadius: "0 6px 6px 0" }} />}
              </div>
            )}

            {/* FIX 3: Match history with H2H vs Same Team breakdown */}
            <div style={{ marginTop: 4 }}>
              <p className="section-label" style={{ marginBottom: 8 }}>
                Match History — H2H: {h2hTotal} &nbsp;|&nbsp; Same Team: {sameTeam} &nbsp;|&nbsp; Total: {h2hTotal + sameTeam}
              </p>
              {relevantMatches.length === 0 ? (
                <div className="empty"><p>No matches between these players yet.</p></div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {relevantMatches.map(m => {
                    const p1InT1 = (m.team1 || []).includes(h2hPlayer1);
                    const sameTeamMatch = p1InT1 === (m.team1 || []).includes(h2hPlayer2);
                    const p1Team = p1InT1 ? m.team1 : m.team2;
                    const p2Team = p1InT1 ? m.team2 : m.team1;
                    const p1TeamWon = (p1InT1 && m.winner === "team1") || (!p1InT1 && m.winner === "team2");
                    const badgeLogs = getMatchBadgeLogs(m, matches, players);
                    const renderSide = (ids, won) => (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flexWrap: "wrap", fontSize: 12, fontWeight: won ? 700 : 400, color: won ? "var(--green)" : "var(--text-muted)" }}>
                        {won && "★ "}
                        {ids.map((id, i) => (
                          <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                            {i > 0 && <span style={{ opacity: 0.5 }}>&amp;</span>}
                            <PlayerAvatar player={players.find(p => p.id === id)} size={18} />
                            <span>{getName(id)}</span>
                          </span>
                        ))}
                      </span>
                    );
                    return (
                      <div key={m.id} className="match-item">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                            {renderSide(p1Team, p1TeamWon)}
                            <span className="text-muted" style={{ fontSize: 10, padding: "1px 5px", background: "var(--bg-secondary)", borderRadius: 4 }}>vs</span>
                            {renderSide(p2Team, !p1TeamWon)}
                            {sameTeamMatch && (
                              <span style={{ fontSize: 10, padding: "1px 6px", background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, fontWeight: 600 }}>same team</span>
                            )}
                          </div>
                          <p className="text-muted" style={{ fontSize: 11 }}>{formatMatchDateTime(m)}</p>
                          {badgeLogs.length > 0 && (
                            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                              {badgeLogs.map((log, i) => (
                                <div key={i} style={{ fontSize: 11, color: log.type === "hattrick" ? "#d97706" : log.type === "losstrick" ? "#dc2626" : "#1d4ed8", fontWeight: 500 }}>
                                  {log.text}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
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
        {[{ k: "date", l: "By Date" }, { k: "player", l: "By Player" }, { k: "duo", l: "Best Partner" }, { k: "h2h", l: "Head to Head" }].map(({ k, l }) => (
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
          {[{ k: "alltime", l: "All Time" }, { k: "today", l: "Today" }, { k: "weekly", l: "This Week" }, { k: "monthly", l: "Monthly" }, { k: "yearly", l: "Yearly" }].map(({ k, l }) => (
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
      {mode === "h2h" && renderH2HStats()}
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

function getRecentTeammatePairs(matches, selectedPlayerIds, lastN = 2) {
  try {
    function getTime(m) {
      try {
        const t = m.timestamp || m.date || m.createdAt || m.time;
        if (!t) return 0;
        if (typeof t === "number") return t;
        if (typeof t.toMillis === "function") return t.toMillis();
        if (t.seconds) return t.seconds * 1000;
        if (t instanceof Date) return t.getTime();
        return 0;
      } catch (e) { return 0; }
    }

    const sorted = [...matches].sort((a, b) => getTime(b) - getTime(a));
    const blockedPairs = new Set();

    selectedPlayerIds.forEach(playerId => {
      const playerMatches = sorted.filter(m => {
        const teamA = m.teamA || m.team1 || [];
        const teamB = m.teamB || m.team2 || [];
        return teamA.includes(playerId) || teamB.includes(playerId);
      });

      const recentForPlayer = playerMatches.slice(0, lastN);

      recentForPlayer.forEach(m => {
        const teamA = m.teamA || m.team1 || [];
        const teamB = m.teamB || m.team2 || [];
        const playerInA = teamA.includes(playerId);
        const myTeam = playerInA ? teamA : teamB;

        myTeam.forEach(teammateId => {
          if (teammateId !== playerId) {
            const pair = [playerId, teammateId].sort().join("|||");
            blockedPairs.add(pair);
          }
        });
      });
    });

    return blockedPairs;
  } catch (err) {
    console.error("getRecentTeammatePairs error:", err);
    return new Set();
  }
}

function getStrikeFirstPlayer(matches, selectedPlayers) {
  return selectedPlayers[Math.floor(Math.random() * selectedPlayers.length)];
}

// ── Team Spin ─────────────────────────────────────────────────────────────────
function TeamSpin({ players, matches, onClose }) {
  const [selected, setSelected] = useState([]);
  const [spinning, setSpinning] = useState(false);
  const [teams, setTeams] = useState(null);
  const [shuffleNames, setShuffleNames] = useState([]);
  const [appliedConditions, setAppliedConditions] = useState([]);
  const [recentPairBlocked, setRecentPairBlocked] = useState(false);
  const [strikeFirst, setStrikeFirst] = useState(null);
  const [particles, setParticles] = useState([]);
  const [showResult, setShowResult] = useState(false);
  const strikeBoxRef = useRef(null);
  const audioCtxRef = useRef(null);

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
    setRecentPairBlocked(false);
    setStrikeFirst(null);
    setParticles([]);
    setShowResult(false);
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

    let filteredByRecent = configs;
    try {
      const selectedPlayerIds = selectedPlayers.map(p => p.id);
      const blockedPairs = getRecentTeammatePairs(matches, selectedPlayerIds, 2);
      const afterFilter = configs.filter(c => {
        const allTeams = [c.teamA, c.teamB];
        return allTeams.every(team => {
          for (let i = 0; i < team.length; i++) {
            for (let j = i + 1; j < team.length; j++) {
              const pair = [team[i].id, team[j].id].sort().join("|||");
              if (blockedPairs.has(pair)) {
                console.log("Config blocked because of pair:", team[i].name, "+", team[j].name);
                return false;
              }
            }
          }
          return true;
        });
      });
      if (afterFilter.length > 0) {
        filteredByRecent = afterFilter;
        console.log("Configs after recent pair filter:", filteredByRecent.length);
      } else {
        console.warn("All configs blocked — using fallback");
      }
    } catch (err) {
      console.error("Recent pair filtering error:", err);
    }
    configs = filteredByRecent;
    setRecentPairBlocked(filteredByRecent.length > 0 && filteredByRecent.length < 3);

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

    let spinAudioCtx = null;
    try {
      spinAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {}

    let count = 0;
    const interval = setInterval(() => {
      const shuffleArr = [...selectedPlayers].sort(() => Math.random() - 0.5);
      setShuffleNames(shuffleArr.map(p => p.name));
      count++;
      if (spinAudioCtx) {
        try {
          const progress = count / 20;
          const now = spinAudioCtx.currentTime;
          const pitch = 300 + (progress * 600);
          const vol = 0.08 + (progress * 0.18);
          const osc = spinAudioCtx.createOscillator();
          const gain = spinAudioCtx.createGain();
          osc.connect(gain);
          gain.connect(spinAudioCtx.destination);
          osc.type = "sine";
          osc.frequency.setValueAtTime(pitch, now);
          gain.gain.setValueAtTime(vol, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
          osc.start(now);
          osc.stop(now + 0.09);
        } catch(e) {}
      }
      if (count >= 20) {
        clearInterval(interval);
        if (spinAudioCtx) {
          try {
            const now = spinAudioCtx.currentTime;
            const thud = spinAudioCtx.createOscillator();
            const thudGain = spinAudioCtx.createGain();
            thud.connect(thudGain);
            thudGain.connect(spinAudioCtx.destination);
            thud.type = "sine";
            thud.frequency.setValueAtTime(150, now);
            thud.frequency.exponentialRampToValueAtTime(40, now + 0.15);
            thudGain.gain.setValueAtTime(0.7, now);
            thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
            thud.start(now);
            thud.stop(now + 0.2);
            const click = spinAudioCtx.createOscillator();
            const clickGain = spinAudioCtx.createGain();
            click.connect(clickGain);
            clickGain.connect(spinAudioCtx.destination);
            click.type = "square";
            click.frequency.setValueAtTime(400, now);
            click.frequency.exponentialRampToValueAtTime(80, now + 0.05);
            clickGain.gain.setValueAtTime(0.4, now);
            clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
            click.start(now);
            click.stop(now + 0.07);
            setTimeout(() => { try { spinAudioCtx.close(); } catch(e) {} }, 250);
          } catch(e) {}
        }
        setTeams(finalConfig);
        setAppliedConditions(active.map(c => c.label));
        const striker = getStrikeFirstPlayer(matches, selectedPlayers);
        setStrikeFirst(striker);
        setTimeout(() => {
          const box = strikeBoxRef.current;
          if (!box) return;
          const rect = box.getBoundingClientRect();
          const modalEl = box.closest('[data-modal="spin-result"]');
          const modalRect = modalEl ? modalEl.getBoundingClientRect() : { left: 0, top: 0 };
          const originX = rect.left - modalRect.left + rect.width / 2;
          const originY = rect.top - modalRect.top + rect.height / 2;

          const newParticles = Array.from({ length: 80 }).map((_, i) => {
            const angle = (Math.random() * 360) * (Math.PI / 180);
            const distance = 80 + Math.random() * 180;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;
            const size = 4 + Math.random() * 8;
            const duration = 0.8 + Math.random() * 0.8;
            const delay = Math.random() * 0.3;
            const colors = ["#fbbf24","#ef4444","#3b82f6","#10b981","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#ffffff"];
            return { id: i, x: originX, y: originY, tx, ty, size, duration, delay, color: colors[i % colors.length], shape: Math.random() > 0.5 ? "50%" : "2px" };
          });
          setParticles(newParticles);
          setTimeout(() => setParticles([]), 2000);

          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const playBang = (time, freq, type = "square") => {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.type = type;
              osc.frequency.setValueAtTime(freq, time);
              osc.frequency.exponentialRampToValueAtTime(freq * 0.1, time + 0.3);
              gain.gain.setValueAtTime(0.3, time);
              gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
              osc.start(time);
              osc.stop(time + 0.4);
            };
            const now = ctx.currentTime;
            playBang(now, 800, "sawtooth");
            playBang(now + 0.05, 600, "square");
            playBang(now + 0.1, 1000, "sawtooth");
            playBang(now + 0.15, 500, "triangle");
            playBang(now + 0.3, 750, "sawtooth");
            playBang(now + 0.35, 900, "square");
          } catch(e) {}
        }, 100);
        setSpinning(false);
        setShuffleNames([]);
        setShowResult(true);
      }
    }, 100);
  };

  const reset = () => {
    setSelected([]);
    setTeams(null);
    setShuffleNames([]);
    setAppliedConditions([]);
    setRecentPairBlocked(false);
    setStrikeFirst(null);
    setParticles([]);
    setShowResult(false);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 16, backdropFilter: "blur(6px)", overflow: "visible",
      }}
    >
      <div
        data-modal="spin"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#ffffff",
          color: "#1a1a1a",
          borderRadius: 16, padding: 24,
          maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto",
          border: "1px solid rgba(0,0,0,0.1)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          position: "relative", overflow: "visible",
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
      </div>

      {showResult && (
        <div
          onClick={() => setShowResult(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1100, padding: 16,
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            data-modal="spin-result"
            style={{
              background: "#ffffff", borderRadius: 20, padding: 24,
              maxWidth: 440, width: "100%", maxHeight: "90vh", overflowY: "auto",
              border: "1px solid rgba(0,0,0,0.08)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
              position: "relative", overflow: "visible",
            }}
          >
            {particles.map(p => (
              <div
                key={p.id}
                className="particle"
                style={{
                  left: p.x, top: p.y,
                  width: p.size, height: p.size,
                  background: p.color,
                  borderRadius: p.shape,
                  animationDuration: `${p.duration}s`,
                  animationDelay: `${p.delay}s`,
                  "--tx": `${p.tx}px`,
                  "--ty": `${p.ty}px`,
                }}
              />
            ))}

            <button
              onClick={() => setShowResult(false)}
              style={{
                position: "absolute", top: 12, right: 12,
                background: "rgba(0,0,0,0.05)", border: "none",
                color: "#1a1a1a", fontSize: 20, cursor: "pointer",
                lineHeight: 1, padding: "4px 10px", borderRadius: 6, fontWeight: 700,
              }}
            >×</button>

            <h3 style={{ textAlign: "center", fontSize: 18, fontWeight: 800, margin: "0 0 20px", color: "#1a1a1a" }}>
              🎲 Teams Ready!
            </h3>

            {teams && (
              <div className="team-result-pop" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div style={{
                  padding: 16, borderRadius: 12,
                  background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
                  textAlign: "center", color: "white",
                  boxShadow: "0 4px 12px rgba(59,130,246,0.3)",
                }}>
                  <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8, fontWeight: 600 }}>TEAM A</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 6 }}>
                    <PlayerAvatar player={teams.teamA[0]} size={32} />
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{teams.teamA[0].name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                    <PlayerAvatar player={teams.teamA[1]} size={32} />
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{teams.teamA[1].name}</span>
                  </div>
                </div>
                <div style={{
                  padding: 16, borderRadius: 12,
                  background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                  textAlign: "center", color: "white",
                  boxShadow: "0 4px 12px rgba(239,68,68,0.3)",
                }}>
                  <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8, fontWeight: 600 }}>TEAM B</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 6 }}>
                    <PlayerAvatar player={teams.teamB[0]} size={32} />
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{teams.teamB[0].name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                    <PlayerAvatar player={teams.teamB[1]} size={32} />
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{teams.teamB[1].name}</span>
                  </div>
                </div>
              </div>
            )}

            {strikeFirst && (
              <div ref={strikeBoxRef} style={{
                marginBottom: 12, padding: "12px 16px",
                background: "linear-gradient(135deg, #fef3c7, #fde68a)",
                borderRadius: 12, border: "1px solid #fbbf24",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                boxShadow: "0 2px 8px rgba(251,191,36,0.2)",
                textAlign: "center",
              }}>
                <span style={{ fontSize: 22 }}>🎯</span>
                <div style={{ fontSize: 15, color: "#1a1a1a" }}>
                  Strikes First: <span style={{ fontWeight: 800 }}>{strikeFirst.name}</span>
                </div>
              </div>
            )}

            {(appliedConditions.length > 0 || recentPairBlocked) && (
              <div style={{
                padding: 12, background: "#fef3c7",
                borderRadius: 10, border: "1px solid #fbbf24",
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "#92400e",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  marginBottom: 8, textAlign: "center",
                }}>
                  ⚙️ Balancing Rules Applied
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                  {appliedConditions.map((label, i) => (
                    <span key={i} style={{
                      fontSize: 11, fontWeight: 600, padding: "5px 10px",
                      borderRadius: 12, background: "#fbbf24", color: "#1a1a1a",
                    }}>{label}</span>
                  ))}
                  {recentPairBlocked && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: "5px 10px",
                      borderRadius: 12, background: "#ef4444", color: "#ffffff",
                    }}>🚫 Last 2 match partners separated</span>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={() => setShowResult(false)}
              style={{
                marginTop: 16, width: "100%",
                padding: "12px", borderRadius: 10, border: "none",
                background: "linear-gradient(135deg, #f59e0b, #ef4444)",
                color: "white", fontWeight: 700, fontSize: 15,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              🎰 Spin Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Chat audio + notifications ────────────────────────────────────────────────
function playDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.3);
  } catch {}
}

function showChatNotification(senderName, text, chatContext, isActive, mode, activeChatId) {
  if (typeof window === "undefined" || Notification.permission !== "granted") return;
  if (chatContext === "group" && isActive && mode === "group") return;
  if (chatContext !== "group" && isActive && mode === "private" && activeChatId === chatContext) return;
  try {
    new Notification(`New message from ${senderName}`, {
      body: text.slice(0, 50),
      icon: "/icon-192.png",
    });
  } catch {}
}

// ── Chat helpers (module-level so React never remounts them on re-render) ─────
function formatChatTime(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function ChatDotBadge() {
  return <span style={{ display: "inline-block", width: 7, height: 7, background: "#dc2626", borderRadius: "50%", marginLeft: 6, verticalAlign: "middle" }} />;
}

function ChatSendBtn({ onClick, val, sending }) {
  return (
    <button onClick={onClick} disabled={!val.trim() || sending}
      style={{
        width: 38, height: 38, borderRadius: "50%", background: "var(--green)", border: "none",
        cursor: val.trim() && !sending ? "pointer" : "default",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: val.trim() ? 1 : 0.4, flexShrink: 0, transition: "opacity 0.15s",
      }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function ChatBubbles({ messages, endRef, currentUid }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px 80px", display: "flex", flexDirection: "column", gap: 10 }}>
      {messages.length === 0 && (
        <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, marginTop: 28 }}>
          No messages yet — say something! 👋
        </p>
      )}
      {messages.map(m => {
        const isOwn = m.uid === currentUid;
        return (
          <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: isOwn ? "flex-end" : "flex-start" }}>
            {!isOwn && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2, paddingLeft: 2 }}>
                {m.senderName}
              </span>
            )}
            <div style={{
              maxWidth: "75%", padding: "8px 13px",
              borderRadius: isOwn ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: isOwn ? "#2563eb" : "var(--bg-secondary)",
              color: isOwn ? "#fff" : "var(--text)",
              fontSize: 14, lineHeight: 1.45, wordBreak: "break-word",
            }}>
              {m.text}
            </div>
            <span style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, paddingInline: 2 }}>
              {formatChatTime(m.timestamp)}
            </span>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function ChatInputRow({ val, setVal, onSend, placeholder, sending }) {
  const inputRef = useRef(null);
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-card)", zIndex: 1001 }}>
      <input
        ref={inputRef}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => e.key === "Enter" && !e.shiftKey && onSend()}
        placeholder={placeholder}
        style={{
          flex: 1, fontSize: 14, padding: "9px 14px", borderRadius: 22,
          border: "1px solid var(--border)", background: "var(--bg)",
          color: "var(--text)", outline: "none", fontFamily: "inherit",
        }}
      />
      <ChatSendBtn onClick={onSend} val={val} sending={sending} />
    </div>
  );
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function Chat({ currentUser, onUnreadChange, isActive }) {
  const [mode, setMode] = useState("group");
  const [groupMessages, setGroupMessages] = useState([]);
  const [groupInput, setGroupInput] = useState("");
  const [groupUnread, setGroupUnread] = useState(0);
  const [members, setMembers] = useState([]);
  const [memberUnreads, setMemberUnreads] = useState({});
  const [activeChatId, setActiveChatId] = useState(null);
  const [activeMember, setActiveMember] = useState(null);
  const [privateMessages, setPrivateMessages] = useState([]);
  const [privateInput, setPrivateInput] = useState("");
  const [readStatus, setReadStatus] = useState({});
  const [sending, setSending] = useState(false);
  const groupEndRef = useRef(null);
  const privateEndRef = useRef(null);
  const groupMsgCountRef = useRef(-1);
  const privateMsgCountRef = useRef(-1);
  const modeRef = useRef(mode);
  const activeChatIdRef = useRef(activeChatId);
  const isActiveRef = useRef(isActive);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Read status from Firestore (tracks last-read timestamps)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "chatReads", currentUser.uid), snap => {
      setReadStatus(snap.exists() ? snap.data() : {});
    });
    return () => unsub();
  }, [currentUser.uid]);

  // Group messages (last 50)
  useEffect(() => {
    const q = query(collection(db, "groupChat"), orderBy("timestamp", "asc"), limit(50));
    const unsub = onSnapshot(q, snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const prev = groupMsgCountRef.current;
      if (prev >= 0 && msgs.length > prev) {
        const fromOther = msgs.slice(prev).find(m => m.uid !== currentUser.uid);
        if (fromOther) {
          playDing();
          showChatNotification(fromOther.senderName, fromOther.text, "group",
            isActiveRef.current, modeRef.current, activeChatIdRef.current);
        }
      }
      groupMsgCountRef.current = msgs.length;
      setGroupMessages(msgs);
    });
    return () => unsub();
  }, []);

  // Members list (all users except self)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), snap => {
      setMembers(snap.docs.map(d => d.data()).filter(u => u.uid !== currentUser.uid));
    });
    return () => unsub();
  }, [currentUser.uid]);

  // Mark group as read whenever viewing group mode
  useEffect(() => {
    if (mode !== "group") return;
    setDoc(doc(db, "chatReads", currentUser.uid), { groupLastRead: serverTimestamp() }, { merge: true }).catch(() => {});
  }, [mode, groupMessages.length, currentUser.uid]);

  // Compute group unread count
  useEffect(() => {
    const lastReadTs = readStatus.groupLastRead?.toMillis?.() ?? 0;
    setGroupUnread(
      groupMessages.filter(m => m.uid !== currentUser.uid && (m.timestamp?.toMillis?.() ?? 0) > lastReadTs).length
    );
  }, [groupMessages, readStatus, currentUser.uid]);

  // Compute per-member unread counts (one-time fetch per readStatus update)
  useEffect(() => {
    if (!members.length) return;
    const go = async () => {
      const counts = {};
      for (const member of members) {
        const chatId = [currentUser.uid, member.uid].sort().join("_");
        const lastReadTs = readStatus[chatId]?.toMillis?.() ?? 0;
        try {
          const snap = await getDocs(
            query(collection(db, "privateChats", chatId, "messages"), orderBy("timestamp", "asc"), limit(50))
          );
          counts[chatId] = snap.docs.filter(d => {
            const data = d.data();
            return data.uid !== currentUser.uid && (data.timestamp?.toMillis?.() ?? 0) > lastReadTs;
          }).length;
        } catch { counts[chatId] = 0; }
      }
      setMemberUnreads(counts);
    };
    go();
  }, [members, readStatus, currentUser.uid]);

  // Private conversation messages
  useEffect(() => {
    if (!activeChatId) { setPrivateMessages([]); return; }
    privateMsgCountRef.current = -1;
    const q = query(collection(db, "privateChats", activeChatId, "messages"), orderBy("timestamp", "asc"), limit(50));
    const unsub = onSnapshot(q, snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const prev = privateMsgCountRef.current;
      if (prev >= 0 && msgs.length > prev) {
        const fromOther = msgs.slice(prev).find(m => m.uid !== currentUser.uid);
        if (fromOther) {
          playDing();
          showChatNotification(fromOther.senderName, fromOther.text, activeChatId,
            isActiveRef.current, modeRef.current, activeChatIdRef.current);
        }
      }
      privateMsgCountRef.current = msgs.length;
      setPrivateMessages(msgs);
    });
    setDoc(doc(db, "chatReads", currentUser.uid), { [activeChatId]: serverTimestamp() }, { merge: true }).catch(() => {});
    return () => unsub();
  }, [activeChatId, currentUser.uid]);

  // Auto-scroll to latest message
  useEffect(() => { groupEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [groupMessages]);
  useEffect(() => { privateEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [privateMessages]);

  // Notify parent tab of any unread
  useEffect(() => {
    const hasPrivate = Object.values(memberUnreads).some(c => c > 0);
    onUnreadChange(groupUnread > 0 || hasPrivate);
  }, [groupUnread, memberUnreads]); // onUnreadChange (setChatUnread) is stable

  async function sendGroup() {
    const text = groupInput.trim();
    if (!text || sending) return;
    setSending(true); setGroupInput("");
    try {
      await addDoc(collection(db, "groupChat"), {
        uid: currentUser.uid, senderName: currentUser.displayName,
        text, timestamp: serverTimestamp(),
      });
    } finally { setSending(false); }
  }

  async function sendPrivate() {
    const text = privateInput.trim();
    if (!text || sending || !activeChatId) return;
    setSending(true); setPrivateInput("");
    try {
      await addDoc(collection(db, "privateChats", activeChatId, "messages"), {
        uid: currentUser.uid, senderName: currentUser.displayName,
        text, timestamp: serverTimestamp(),
      });
    } finally { setSending(false); }
  }

  function initials(name) {
    return (name || "?").trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
  }

  const privateUnreadTotal = Object.values(memberUnreads).reduce((s, c) => s + c, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Mode toggles */}
      <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-card)", flexShrink: 0 }}>
        {[
          { id: "group", label: "💬 Group Chat", badge: mode !== "group" && groupUnread > 0 },
          { id: "private", label: "🔒 Private", badge: mode !== "private" && privateUnreadTotal > 0 },
        ].map(btn => (
          <button key={btn.id}
            onClick={() => { setMode(btn.id); setActiveChatId(null); setActiveMember(null); }}
            style={{
              flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 600,
              background: mode === btn.id ? "var(--green)" : "var(--bg-secondary)",
              color: mode === btn.id ? "#fff" : "var(--text-muted)",
              border: "1px solid var(--border)", borderRadius: 8,
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
            }}>
            {btn.label}{btn.badge && <ChatDotBadge />}
          </button>
        ))}
      </div>

      {mode === "group" ? (
        <>
          <ChatBubbles messages={groupMessages} endRef={groupEndRef} currentUid={currentUser.uid} />
          <ChatInputRow val={groupInput} setVal={setGroupInput} onSend={sendGroup} placeholder="Message the group…" sending={sending} />
        </>
      ) : activeChatId ? (
        <>
          {/* Private chat header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-card)", flexShrink: 0 }}>
            <button onClick={() => { setActiveChatId(null); setActiveMember(null); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--text)", lineHeight: 1, padding: "2px 6px" }}>
              ←
            </button>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: PALETTE[2] + "20", color: PALETTE[2], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
              {initials(activeMember.displayName)}
            </div>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{activeMember.displayName}</span>
          </div>
          <ChatBubbles messages={privateMessages} endRef={privateEndRef} currentUid={currentUser.uid} />
          <ChatInputRow val={privateInput} setVal={setPrivateInput} onSend={sendPrivate} placeholder={`Message ${activeMember.displayName}…`} sending={sending} />
        </>
      ) : (
        /* Members list */
        <div style={{ flex: 1, overflowY: "auto" }}>
          {members.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, padding: "24px 16px" }}>No other members found.</p>
          ) : members.map(member => {
            const chatId = [currentUser.uid, member.uid].sort().join("_");
            const unread = memberUnreads[chatId] || 0;
            return (
              <button key={member.uid} onClick={() => { setActiveChatId(chatId); setActiveMember(member); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                  padding: "13px 16px", background: "none", border: "none",
                  borderBottom: "1px solid var(--border)", cursor: "pointer",
                  fontFamily: "inherit", textAlign: "left", transition: "background 0.1s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-secondary)"}
                onMouseLeave={e => e.currentTarget.style.background = "none"}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: PALETTE[2] + "20", color: PALETTE[2], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>
                    {initials(member.displayName)}
                  </div>
                  {unread > 0 && (
                    <span style={{ position: "absolute", top: -2, right: -2, minWidth: 17, height: 17, background: "#dc2626", borderRadius: 10, color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
                      {unread}
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 2px", color: "var(--text)" }}>{member.displayName}</p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>Tap to chat</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.35, flexShrink: 0 }}>
                  <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── My Profile ────────────────────────────────────────────────────────────────
function ProfileAvatar({ displayName, matchedPlayer, size = 72 }) {
  if (matchedPlayer?.imageUrl) {
    return (
      <img src={matchedPlayer.imageUrl} alt={displayName}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border)", flexShrink: 0 }} />
    );
  }
  if (matchedPlayer?.icon) {
    return (
      <div style={{ width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.5), background: "var(--bg-secondary)", border: "2px solid var(--border)", flexShrink: 0 }}>
        {matchedPlayer.icon}
      </div>
    );
  }
  const initials = (displayName || "?").trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: PALETTE[0] + "20", color: PALETTE[0],
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: Math.round(size * 0.34), fontWeight: 700,
      border: `2px solid ${PALETTE[0]}40`, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

function MyProfile({ currentUser, players, matches, onNameUpdate, onLogout }) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentUser.displayName);
  const [savingName, setSavingName] = useState(false);

  const matchedPlayer = players.find(
    p => p.name.toLowerCase() === currentUser.displayName.toLowerCase()
  );
  const playerId = matchedPlayer?.id;

  const myMatches = playerId
    ? matches.filter(m => m.team1.includes(playerId) || m.team2.includes(playerId))
    : [];

  let wins = 0, losses = 0;
  const partnerWins = {};
  for (const m of myMatches) {
    const inT1 = m.team1.includes(playerId);
    const won = (inT1 && m.winner === "team1") || (!inT1 && m.winner === "team2");
    if (won) {
      wins++;
      const partners = (inT1 ? m.team1 : m.team2).filter(id => id !== playerId);
      for (const pid of partners) partnerWins[pid] = (partnerWins[pid] || 0) + 1;
    } else {
      losses++;
    }
  }
  const meBadges = playerId ? calcBadges(playerId, matches) : { hatTricks: 0, lossTricks: 0, cleanWins: 0, cleanLosses: 0 };
  const totalPoints = playerId
    ? (wins * 3) + (losses * -2) + (meBadges.hatTricks * 3) + (meBadges.lossTricks * -3) + (meBadges.cleanWins * 2) + (meBadges.cleanLosses * -3)
    : 0;
  const played = wins + losses;
  const winRate = played > 0 ? Math.round((wins / played) * 100) : 0;

  let bestPartnerId = null, bestPartnerWins = 0;
  for (const [pid, w] of Object.entries(partnerWins)) {
    if (w > bestPartnerWins) { bestPartnerWins = w; bestPartnerId = pid; }
  }
  const bestPartner = bestPartnerId ? players.find(p => p.id === bestPartnerId) : null;

  const recentMatches = myMatches.slice(0, 5);

  function maskMobile(mobile) {
    if (!mobile || mobile.length < 6) return mobile || "—";
    return mobile.slice(0, 3) + "XXXXX" + mobile.slice(-2);
  }

  const memberSince = currentUser.createdAt?.toDate
    ? currentUser.createdAt.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";

  async function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === currentUser.displayName) { setEditingName(false); return; }
    setSavingName(true);
    await updateDoc(doc(db, "users", currentUser.uid), { displayName: trimmed });
    onNameUpdate(trimmed);
    setSavingName(false);
    setEditingName(false);
  }

  const getName = id => players.find(p => p.id === id)?.name || "?";

  return (
    <div>
      {/* Profile card */}
      <div className="card" style={{ marginBottom: "1rem", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <ProfileAvatar displayName={currentUser.displayName} matchedPlayer={matchedPlayer} size={72} />
        </div>

        {editingName ? (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", marginBottom: 6 }}>
            <input
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
              style={{ fontSize: 15, fontWeight: 700, textAlign: "center", maxWidth: 180 }}
              autoFocus
            />
            <button onClick={saveName} disabled={savingName} className="btn btn-primary" style={{ fontSize: 12, padding: "5px 10px" }}>
              {savingName ? "…" : "Save"}
            </button>
            <button onClick={() => setEditingName(false)} className="btn" style={{ fontSize: 12, padding: "5px 10px" }}>✕</button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 6 }}>
            <p style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Sora', sans-serif", margin: 0 }}>
              {currentUser.displayName}
            </p>
            <button
              onClick={() => { setNameInput(currentUser.displayName); setEditingName(true); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "2px 4px", opacity: 0.55, lineHeight: 1 }}
              title="Edit name"
            >✏️</button>
          </div>
        )}

        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "3px 0" }}>
          📱 {maskMobile(currentUser.mobile)}
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          Member since {memberSince}
        </p>
      </div>

      {/* Stats */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>My Stats</p>
        {!playerId ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "8px 0" }}>
            No player profile found matching your name.
          </p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: bestPartner ? 10 : 0 }}>
              {[
                { label: "Played", value: played, size: 22 },
                { label: "Win Rate", value: null },
                { label: "Wins / Losses", value: null },
                { label: "Points Scored", value: totalPoints, size: 22 },
              ].map((item, i) => (
                <div key={i} style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: "10px 12px" }}>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 3px" }}>{item.label}</p>
                  {i === 1 && (
                    <p style={{ fontSize: 22, fontWeight: 800, margin: 0, color: winRate > 50 ? "var(--green)" : winRate < 50 ? "#dc2626" : "var(--text)" }}>
                      {winRate}%
                    </p>
                  )}
                  {i === 2 && (
                    <p style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
                      <span style={{ color: "var(--green)" }}>{wins}W</span>
                      <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> / </span>
                      <span style={{ color: "#dc2626" }}>{losses}L</span>
                    </p>
                  )}
                  {item.value !== null && item.value !== undefined && i !== 2 && (
                    <p style={{ fontSize: item.size || 22, fontWeight: 800, margin: 0 }}>{item.value}</p>
                  )}
                </div>
              ))}
            </div>
            {bestPartner && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg-secondary)", borderRadius: 8 }}>
                <PlayerAvatar player={bestPartner} size={34} />
                <div>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 2px" }}>Best Partner</p>
                  <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
                    {bestPartner.name}{" "}
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>({bestPartnerWins} wins together)</span>
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Recent matches */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Recent Matches</p>
        {recentMatches.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "8px 0" }}>No matches yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recentMatches.map(m => {
              const w1 = m.winner === "team1";
              const myInT1 = m.team1.includes(playerId);
              const won = (myInT1 && w1) || (!myInT1 && !w1);
              const date = m.createdAt?.toDate
                ? m.createdAt.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                : "—";
              const hasScore = m.winnerScore != null || m.loserScore != null;
              const scoreStr = hasScore ? ` · ${m.winnerScore ?? "?"}–${m.loserScore ?? "?"}` : "";
              const renderTeam = ids => ids.map(id => getName(id)).join(" & ");
              return (
                <div key={m.id} className="match-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, marginBottom: 2, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: w1 ? 700 : 400, color: w1 ? "var(--green)" : "var(--text-muted)" }}>
                        {w1 ? "★ " : ""}{renderTeam(m.team1)}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", padding: "1px 4px", background: "var(--bg-secondary)", borderRadius: 4 }}>vs</span>
                      <span style={{ fontWeight: !w1 ? 700 : 400, color: !w1 ? "var(--green)" : "var(--text-muted)" }}>
                        {!w1 ? "★ " : ""}{renderTeam(m.team2)}
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                      {date}{scoreStr} · {m.type}
                    </p>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12, flexShrink: 0,
                    background: won ? "rgba(20,168,0,0.12)" : "rgba(220,38,38,0.1)",
                    color: won ? "var(--green)" : "#dc2626",
                  }}>
                    {won ? "Win" : "Loss"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Logout */}
      <button onClick={onLogout} style={{
        width: "100%", padding: "13px", borderRadius: 8,
        background: "#dc2626", color: "#fff", border: "none",
        cursor: "pointer", fontSize: 14, fontWeight: 700,
        fontFamily: "inherit", display: "flex", alignItems: "center",
        justifyContent: "center", gap: 8, marginBottom: "1rem",
      }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Logout
      </button>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
const MR_ZED_MOBILE = "01719130859";
const MR_ZED_UID    = "EKEFCMgARIhUWUn3Eu1GbVAUAD62";

function LoginScreen() {
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }

  async function handleLogin() {
    if (!mobile.trim() || !password) {
      setError("Enter mobile number and password.");
      triggerShake();
      return;
    }

    setLoading(true);
    setError("");

    try {
      await signInWithEmailAndPassword(auth, `${mobile.trim()}@fnf.app`, password);
      // onAuthStateChanged in CarromTracker handles state update
    } catch (err) {
      const msg = err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password"
        ? "Wrong mobile number or password."
        : err.code === "auth/too-many-requests"
        ? "Too many attempts. Try again later."
        : "Login failed. Please try again.";
      setError(msg);
      triggerShake();
      setLoading(false);
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
          <p style={{ fontSize: 13, color: "#5a7055" }}>Sign in to manage data</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: "1rem" }}>
          <input
            type="tel"
            value={mobile}
            onChange={e => { setMobile(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            placeholder="Mobile number (01XXXXXXXXX)"
            style={{
              width: "100%", padding: "12px 14px", fontSize: 15,
              border: `1.5px solid ${error ? "#dc2626" : "#d4e8cf"}`,
              borderRadius: 8, outline: "none", fontFamily: "inherit",
              background: error ? "#fef2f2" : "#f7faf7",
              color: "#0d1f0b", boxSizing: "border-box",
            }}
            autoFocus
          />
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            placeholder="Password"
            style={{
              width: "100%", padding: "12px 14px", fontSize: 15,
              border: `1.5px solid ${error ? "#dc2626" : "#d4e8cf"}`,
              borderRadius: 8, outline: "none", fontFamily: "inherit",
              background: error ? "#fef2f2" : "#f7faf7",
              color: "#0d1f0b", boxSizing: "border-box",
            }}
          />
          {error && <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>{error}</p>}
        </div>

        <button onClick={handleLogin} disabled={loading} style={{
          width: "100%", padding: "13px", fontSize: 15, fontWeight: 700,
          background: "linear-gradient(135deg, #0e7a00, #14a800)",
          color: "#fff", border: "none", borderRadius: 8,
          cursor: loading ? "not-allowed" : "pointer",
          fontFamily: "inherit", boxShadow: "0 4px 12px rgba(20,168,0,0.3)",
          opacity: loading ? 0.7 : 1, transition: "opacity 0.15s",
        }}>
          {loading ? "Signing in…" : "Login"}
        </button>
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

function ForcePasswordChange({ currentUser, onComplete }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await updatePassword(auth.currentUser, newPassword);
      await updateDoc(doc(db, "users", currentUser.uid), { mustChangePassword: false });
      onComplete();
    } catch (err) {
      setError(err.code === "auth/requires-recent-login"
        ? "Session expired. Please log out and log in again."
        : "Failed to update password. Try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "linear-gradient(135deg, #0e7a00 0%, #14a800 60%, #1dc400 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "1.5rem",
    }}>
      <div style={{
        width: "100%", maxWidth: 360,
        background: "#ffffff", borderRadius: 16,
        padding: "2rem 1.75rem",
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
      }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
          <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: 20, fontWeight: 800, color: "#0d1f0b", margin: "0 0 6px" }}>
            Set New Password
          </h2>
          <p style={{ fontSize: 13, color: "#5a7055", margin: 0 }}>
            Welcome, {currentUser.displayName}! Please set a new password before continuing.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: "1rem" }}>
          <input
            type="password"
            value={newPassword}
            onChange={e => { setNewPassword(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            placeholder="New password (min 6 chars)"
            style={{
              width: "100%", padding: "12px 14px", fontSize: 15,
              border: `1.5px solid ${error ? "#dc2626" : "#d4e8cf"}`,
              borderRadius: 8, outline: "none", fontFamily: "inherit",
              background: error ? "#fef2f2" : "#f7faf7",
              color: "#0d1f0b", boxSizing: "border-box",
            }}
            autoFocus
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={e => { setConfirmPassword(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            placeholder="Confirm new password"
            style={{
              width: "100%", padding: "12px 14px", fontSize: 15,
              border: `1.5px solid ${error ? "#dc2626" : "#d4e8cf"}`,
              borderRadius: 8, outline: "none", fontFamily: "inherit",
              background: error ? "#fef2f2" : "#f7faf7",
              color: "#0d1f0b", boxSizing: "border-box",
            }}
          />
          {error && <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>{error}</p>}
        </div>

        <button onClick={handleSubmit} disabled={loading} style={{
          width: "100%", padding: "13px", fontSize: 15, fontWeight: 700,
          background: "linear-gradient(135deg, #0e7a00, #14a800)",
          color: "#fff", border: "none", borderRadius: 8,
          cursor: loading ? "not-allowed" : "pointer",
          fontFamily: "inherit", boxShadow: "0 4px 12px rgba(20,168,0,0.3)",
          opacity: loading ? 0.7 : 1,
        }}>
          {loading ? "Saving…" : "Set Password & Continue"}
        </button>
      </div>
    </div>
  );
}

function Season0Archive({ players = [] }) {
  const getPlayerId = (name) => {
    const p = players.find(pl => pl.name === name || pl.displayName === name);
    return p?.id || null;
  };
  return (
    <div style={{ fontFamily: "inherit" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        {[["THIS SEASON", "44"], ["PLAYERS", "11"], ["STATUS", "📦 Archived"]].map(([label, val]) => (
          <div key={label} style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
            <div style={{ fontWeight: 800, fontSize: label === "STATUS" ? 13 : 28, color: label === "STATUS" ? "var(--text-muted)" : "var(--text)" }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 44px 44px 44px 56px 72px", padding: "10px 16px", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)", fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.07em", textTransform: "uppercase" }}>
          <div>#</div><div>PLAYER</div>
          <div style={{textAlign:"right"}}>P</div><div style={{textAlign:"right"}}>W</div><div style={{textAlign:"right"}}>L</div><div style={{textAlign:"right"}}>PTS</div><div style={{textAlign:"right"}}>WIN%</div>
        </div>
        {[
          { rank: 1, name: "Mr. Zed",        badges: [["4 🔥","fire"]], p:39, w:25, l:14, pts:59,  win:64 },
          { rank: 2, name: "Masud Rana",      badges: [["2 🔥","fire"],["1 💀","loss"]], p:18, w:11, l:7,  pts:22,  win:61 },
          { rank: 3, name: "Suvas Bin Monir", badges: [["1 🔥","fire"],["1 💀","loss"]], p:22, w:11, l:11, pts:11,  win:50 },
          { rank: 4, name: "Sabiul Haque",    badges: [["2 🔥","fire"],["3 💀","loss"]], p:27, w:13, l:14, pts:8,   win:48 },
          { rank: 5, name: "Firoz Hassan",    badges: [["2 🔥","fire"],["4 💀","loss"]], p:29, w:13, l:16, pts:1,   win:45 },
          { rank: 6, name: "Imran Hossain",   badges: [["1 💀","loss"]], p:18, w:8,  l:10, pts:1,   win:44 },
          { rank: 7, name: "Rashedul Islam",  badges: [["1 💀","loss"]], p:17, w:6,  l:11, pts:-7,  win:35 },
        ].map(({ rank, name, badges, p, w, l, pts, win }) => (
          <div key={name} style={{ display: "grid", gridTemplateColumns: "36px 1fr 44px 44px 44px 56px 72px", padding: "12px 16px", alignItems: "center", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 700, color: rank === 1 ? "#d97706" : rank === 2 ? "#9ca3af" : rank === 3 ? "#b45309" : "var(--text-muted)", fontSize: 13 }}>{rank}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {(() => {
                const pid = getPlayerId(name);
                return pid
                  ? <Avatar id={pid} allPlayers={players} size={32} />
                  : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#15803d", flexShrink: 0 }}>{name[0]}</div>;
              })()}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                  {badges.map(([label, type]) => (
                    <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: type === "fire" ? "#fff7ed" : "#fef2f2", border: `1px solid ${type === "fire" ? "#fed7aa" : "#fecaca"}`, borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 700, color: type === "fire" ? "#9a3412" : "#991b1b" }}>{label}</span>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 13 }}>{p}</div>
            <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: "#16a34a" }}>{w}</div>
            <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: "#dc2626" }}>{l}</div>
            <div style={{ textAlign: "right", fontSize: 13, fontWeight: 800, color: pts < 0 ? "#dc2626" : "#d97706" }}>{pts}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
              <div style={{ width: 36, height: 6, background: "#e5e7eb", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${win}%`, background: win >= 50 ? "#16a34a" : "#d1d5db", borderRadius: 99 }} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: win >= 50 ? "#16a34a" : "var(--text-muted)", width: 34, textAlign: "right" }}>{win}%</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 16, padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#d97706", marginBottom: 2 }}>🏅 Qualify for the Leaderboard</div>
        <div style={{ fontSize: 11, color: "#92400e", marginBottom: 10 }}>These players did not reach the qualification threshold (5 matches) this season</div>
        {[
          { name: "Ashik Rahman",  p:1, w:1, l:0, pts:3,  need:4 },
          { name: "Nazmul Haque",  p:1, w:0, l:1, pts:-2, need:4 },
          { name: "Random Man",    p:2, w:0, l:2, pts:-4, need:3 },
          { name: "Riduwan Molla", p:2, w:0, l:2, pts:-4, need:3 },
        ].map(({ name, p, w, l, pts, need }) => (
          <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #fde68a" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {(() => {
                const pid = getPlayerId(name);
                return pid
                  ? <Avatar id={pid} allPlayers={players} size={32} />
                  : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#15803d", flexShrink: 0 }}>{name[0]}</div>;
              })()}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{name}</div>
                <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                  {[[`${p}P`,"#e5e7eb","#374151"],[`${w}W`,"#dcfce7","#15803d"],[`${l}L`,"#fee2e2","#991b1b"],[`${pts}PTS`, "#f3f4f6", pts < 0 ? "#dc2626" : "#374151"]].map(([t,bg,fg]) => (
                    <span key={t} style={{ fontSize: 10, fontWeight: 600, background: bg, color: fg, padding: "1px 5px", borderRadius: 4 }}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", textAlign: "right" }}>Need {need} more matches</div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ fontSize: 18 }}>📦</span>
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text)" }}>Season 0 — Testing & Archive</strong><br />
          This was the first trial season of Carrom Tracker (May 2026). Results are preserved for reference. Official rankings begin from Season 1 (Jun–Jul 2026).
        </div>
      </div>
    </div>
  );
}

export default function CarromTracker() {
  const [tab, setTab] = useState("board");
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [bills, setBills] = useState([]);
  const [synced, setSynced] = useState(false);
  const [authState, setAuthState] = useState("loading"); // loading | guest | member | admin | login
  const [currentUser, setCurrentUser] = useState(null); // { uid, displayName, mobile, role, mustChangePassword }
  const [showForcePasswordChange, setShowForcePasswordChange] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [statsMode, setStatsMode] = useState("date");
  const [showSpin, setShowSpin] = useState(false);
  const [toast, setToast] = useState(null);
  const [chatUnread, setChatUnread] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.log("SW registration failed:", err);
      });
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (snap.exists()) {
          const profile = snap.data();
          // Mr. Zed always gets admin role regardless of what's stored
          if (firebaseUser.uid === MR_ZED_UID && profile.role !== "admin") {
            await updateDoc(doc(db, "users", MR_ZED_UID), { role: "admin" });
            profile.role = "admin";
          }
          setCurrentUser(profile);
          setShowForcePasswordChange(!!profile.mustChangePassword);
          setAuthState(profile.role);
        } else {
          await signOut(auth);
          setCurrentUser(null);
          setAuthState("guest");
        }
      } else {
        setCurrentUser(null);
        setShowForcePasswordChange(false);
        setAuthState("guest");
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsubP = onSnapshot(query(collection(db, "players"), orderBy("createdAt", "asc")), snap => {
      setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setSynced(true);
    });
    const unsubM = onSnapshot(query(collection(db, "matches"), orderBy("createdAt", "desc")), snap => {
      setMatches(snap.docs.map(d => {
        const m = { id: d.id, ...d.data() };
        if (m.seasonId === "May-Jun 2026") {
          const ts = m.createdAt?.toDate?.() || (m.date ? new Date(m.date) : new Date());
          m.seasonId = (ts.getMonth() + 1) === 5 ? "May 2026" : "Jun-Jul 2026";
        }
        if (m.seasonId === "Jun 2026") m.seasonId = "Jun-Jul 2026";
        return m;
      }));
    });
    const unsubB = onSnapshot(query(collection(db, "bills"), orderBy("createdAt", "desc")), snap => {
      setBills(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => { unsubP(); unsubM(); unsubB(); };
  }, []);

  useEffect(() => {
    if (authState !== "admin") return;
    async function runSeasonMigration() {
      const metaSnap = await getDoc(doc(db, "meta", "migration"));
      if (metaSnap.exists() && metaSnap.data().matchSeasonTagged) return;
      const matchesSnap = await getDocs(collection(db, "matches"));
      const updates = [];
      matchesSnap.docs.forEach(d => {
        const data = d.data();
        if (!data.seasonId) {
          const ts = data.createdAt?.toDate?.() || (data.date ? new Date(data.date) : new Date());
          updates.push(updateDoc(doc(db, "matches", d.id), { seasonId: getSeasonId(ts) }));
        }
      });
      await Promise.all(updates);
      await setDoc(doc(db, "meta", "migration"), { matchSeasonTagged: true }, { merge: true });
    }
    runSeasonMigration().catch(() => {});
  }, [authState]);

  async function handleLogout() {
    await signOut(auth);
    // onAuthStateChanged clears currentUser and sets authState to "guest"
  }

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  async function addPlayer(name, icon, imageUrl = null, mobile = "") {
    const data = { name, icon, createdAt: serverTimestamp() };
    if (imageUrl) data.imageUrl = imageUrl;
    await addDoc(collection(db, "players"), data);

    if (mobile && name.trim().toLowerCase() !== "random man") {
      try {
        const res = await fetch("/api/createUser", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: name.trim(), mobile }),
        });
        if (res.ok) {
          showToast("Player added and login account created");
        }
      } catch {
        // player was saved; auth creation failure is non-fatal
      }
    }
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
    const addedBy = { uid: currentUser?.uid || "admin", name: currentUser?.displayName || "Admin" };
    await addDoc(collection(db, "matches"), { ...data, addedBy, seasonId: getSeasonId(new Date()), createdAt: serverTimestamp() });
    setTab("board");
  }
  async function deleteMatch(id) {
    if (!confirm("Delete this match?")) return;
    await deleteDoc(doc(db, "matches", id));
  }
  async function saveBill(data) {
    await addDoc(collection(db, "bills"), { ...data, createdAt: serverTimestamp() });
  }
  async function deleteBill(id) {
    if (!confirm("Delete this bill entry?")) return;
    await deleteDoc(doc(db, "bills", id));
  }

  async function handleResetPassword(playerName) {
    const usersSnap = await getDocs(collection(db, "users"));
    const userDoc = usersSnap.docs.find(
      d => d.data().displayName?.toLowerCase() === playerName.toLowerCase()
    );
    if (!userDoc) {
      showToast(`No login account found for ${playerName}`);
      return;
    }
    const uid = userDoc.data().uid;
    try {
      const res = await fetch("/api/resetPassword", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid }),
      });
      if (res.ok) {
        showToast(`${playerName}'s password has been reset to fct@123`);
      } else {
        const err = await res.json();
        showToast(`Reset failed: ${err.error || "unknown error"}`);
      }
    } catch {
      showToast(`Reset failed: network error`);
    }
  }

  if (authState === "loading") return null;
  if (authState === "login") return <LoginScreen />;

  const isAdmin = authState === "admin";
  const isMember = authState === "member";
  // Firebase-auth users (Mr. Zed = admin, others = member) get chat + profile tabs
  const isFirebaseUser = !!currentUser;

  const TAB_ICONS = {
    board: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H3.5a2.5 2.5 0 010-5H6"/><path d="M18 9h2.5a2.5 2.5 0 000-5H18"/>
        <path d="M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0012 0V2z"/>
      </svg>
    ),
    match: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
      </svg>
    ),
    players: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
    stats: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M18 20V10M12 20V4M6 20v-6"/>
      </svg>
    ),
    history: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
    chat: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
    ),
    profile: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
    ),
    bills: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
      </svg>
    ),
  };

  const TABS = [
    { k: "board", l: "Leaderboard" },
    ...((isAdmin || isMember) ? [{ k: "match", l: "New Match" }] : []),
    { k: "players", l: "Players" },
    { k: "stats", l: "Stats" },
    { k: "history", l: "History" },
    { k: "bills", l: "Bills", requiresLogin: true },
    ...(isFirebaseUser ? [{ k: "chat", l: "Chat" }, { k: "profile", l: "Me" }] : []),
  ].filter(t => !t.requiresLogin || isFirebaseUser);

  if (tab === "match" && !isAdmin && !isMember) setTab("board");
  if (tab === "profile" && !isFirebaseUser) setTab("board");
  if (tab === "chat" && !isFirebaseUser) setTab("board");
  if (tab === "bills" && !isFirebaseUser) setTab("board");

  return (
    <div className="app">
      <style>{`
  @keyframes live-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.35; transform: scale(0.75); }
  }
  .live-dot {
    animation: live-pulse 1.5s ease-in-out infinite;
  }
  @keyframes pop-in {
    0% { transform: scale(0.5); opacity: 0; }
    60% { transform: scale(1.08); }
    100% { transform: scale(1); opacity: 1; }
  }
  .team-result-pop {
    animation: pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }
  @keyframes burst {
    0% { transform: translate(0, 0) scale(1); opacity: 1; }
    100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
  }
  .particle {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    animation: burst ease-out forwards;
  }
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
  .clean-loss-badge {
    background: rgba(0, 0, 0, 0.24);
    color: #1a1a1a;
    border: 0.5px solid rgba(0, 0, 0, 0.50);
  }
  @media (prefers-color-scheme: dark) {
    .clean-loss-badge {
      background: rgba(60, 60, 60, 0.85);
      color: #ffffff;
      border: 0.5px solid rgba(255, 255, 255, 0.2);
    }
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
          <a href="https://www.facebook.com/TechZahidul/" target="_blank" rel="noopener noreferrer"
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
          {(isAdmin || isMember) && <span style={{ marginLeft: 8, background: isAdmin ? "rgba(212,160,23,0.3)" : "rgba(37,99,235,0.3)", color: isAdmin ? "#fef3c7" : "#dbeafe", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10 }}>{isAdmin ? "Admin" : (currentUser?.displayName || "Member")}</span>}
        </div>
      </div>

      <div className="tabs-wrap" style={{ display: "flex", alignItems: "center" }}>
        <div className="tabs">
          {TABS.map(({ k, l }) => (
            <button key={k}
              className={`tab-btn ${(k === "chat" ? chatOpen : (!chatOpen && tab === k)) ? "active" : ""}`}
              onClick={() => { if (k === "chat") { setChatOpen(true); } else { setChatOpen(false); setTab(k); } }}
              style={k === "chat" ? { marginLeft: "auto" } : undefined}>
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                {TAB_ICONS[k]}
                {k === "chat" && chatUnread && !chatOpen && (
                  <span style={{ position: "absolute", top: -3, right: -5, width: 6, height: 6, background: "#dc2626", borderRadius: "50%" }} />
                )}
              </span>
              <span className="tab-label">{l}</span>
            </button>
          ))}
        </div>
        {!isFirebaseUser && (
          <button onClick={() => setAuthState("login")} className="nav-btn-hover nav-btn-login" style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.5)",
            borderRadius: 6, padding: "4px 14px", color: "rgba(255,255,255,0.9)",
            fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
            marginRight: 4, flexShrink: 0,
          }}>Login</button>
        )}
      </div>

      <div className="content">
        {tab === "board" && <Leaderboard players={players} matches={matches} onSelectPlayer={setSelectedPlayer} onNavigateToStats={() => { setStatsMode("player"); setTab("stats"); }} />}
        {tab === "match" && (isAdmin || isMember) && <NewMatch players={players} onSave={saveMatch} />}
        {tab === "players" && <Players players={players} matches={matches} onAdd={isAdmin ? addPlayer : undefined} onRemove={isAdmin ? removePlayer : undefined} onEdit={isAdmin ? editPlayer : undefined} onResetPassword={isAdmin ? handleResetPassword : undefined} isAdmin={isAdmin} onSelectPlayer={setSelectedPlayer} onNavigateToStats={() => { setStatsMode("player"); setTab("stats"); }} />}
        {tab === "stats" && <Stats players={players} matches={matches} selectedPlayer={selectedPlayer} setSelectedPlayer={setSelectedPlayer} statsMode={statsMode} setStatsMode={setStatsMode} />}
        {tab === "history" && <History players={players} matches={matches} onDelete={deleteMatch} isAdmin={isAdmin} />}
        {tab === "bills" && isFirebaseUser && (
          <Bills
            players={players}
            bills={bills}
            onSaveBill={saveBill}
            onDeleteBill={deleteBill}
            isLoggedIn={isFirebaseUser}
            isAdmin={isAdmin}
            loggedInPlayerName={currentUser?.displayName || "Admin"}
          />
        )}
        {null /* chat is rendered as fullscreen overlay below */}
        {tab === "profile" && isFirebaseUser && currentUser && (
          <MyProfile
            currentUser={currentUser}
            players={players}
            matches={matches}
            onNameUpdate={name => setCurrentUser(prev => ({ ...prev, displayName: name }))}
            onLogout={handleLogout}
          />
        )}
      </div>
      {/* Fullscreen chat overlay */}
      {chatOpen && isFirebaseUser && currentUser && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000, height: "100dvh",
          background: "var(--bg)", display: "flex", flexDirection: "column",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 16px",
            background: "var(--bg-card)", borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}>
            <button onClick={() => setChatOpen(false)} style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 22, color: "var(--text)", lineHeight: 1, padding: "2px 8px 2px 0",
            }}>←</button>
            <span style={{ fontSize: 16, fontWeight: 700 }}>Chat</span>
          </div>
          <Chat currentUser={currentUser} onUnreadChange={setChatUnread} isActive={chatOpen} />
        </div>
      )}
      {showSpin && <TeamSpin players={players} matches={matches} onClose={() => setShowSpin(false)} />}
      {toast && (
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          background: "#14a800", color: "#fff",
          padding: "10px 22px", borderRadius: 8,
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
          fontSize: 14, fontWeight: 600, zIndex: 3000,
          whiteSpace: "nowrap", pointerEvents: "none",
        }}>
          {toast}
        </div>
      )}
      {showForcePasswordChange && currentUser && (
        <ForcePasswordChange
          currentUser={currentUser}
          onComplete={() => {
            setCurrentUser(prev => ({ ...prev, mustChangePassword: false }));
            setShowForcePasswordChange(false);
          }}
        />
      )}

      {/* Upwork Promotional Banner */}
      <a
        href="https://fnfschool.com"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: chatOpen ? "none" : "block",
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