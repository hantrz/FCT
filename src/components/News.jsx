"use client";

import { useState, useRef } from "react";

function getSessionBadge(t) {
  if (t === "Friday") return { label: "🟢 Friday Session", color: "#14a800", bg: "rgba(20,168,0,0.12)" };
  if (t === "Sunday") return { label: "🟡 Sunday Session", color: "#9a7410", bg: "rgba(212,160,23,0.16)" };
  return { label: "🟣 Special Session", color: "#7c3aed", bg: "rgba(124,58,237,0.12)" };
}
function formatDisplayDate(s) {
  if (!s) return "";
  try { return new Date(s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
  catch { return s; }
}
function dayToSessionType(s) {
  const d = new Date(s + "T12:00:00").getDay();
  return d === 5 ? "Friday" : d === 0 ? "Sunday" : "Special";
}
function isRecent(n) {
  const p = n.publishedAt?.toDate?.() || (n.publishedAt ? new Date(n.publishedAt) : null);
  if (!p) return false;
  return (Date.now() - p.getTime()) / 86400000 < 3;
}
// Renders **text** as real bold; leaves everything else (incl. newlines) as-is.
function renderRich(text) {
  if (!text) return null;
  return text.split(/\*\*/).map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ color: "var(--text)", fontWeight: 700 }}>{part}</strong>
      : part
  );
}

export default function News({ news = [], onSave, onDelete, onPublish, isAdmin, getSessionData, defaultSessionDate }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  async function handleShare(n) {
    const cleanBody = (n.content || "").replace(/\*\*/g, "");
    const shareText = `📰 ${n.title}\n\n${cleanBody}\n\n— via FCT (Friends' Carrom Tracker)\nhttps://fct.fnfschool.com`;
    if (navigator.share) {
      try {
        await navigator.share({ title: n.title, text: shareText });
      } catch (err) {
        // user cancelled the share sheet — do nothing
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        setCopiedId(n.id);
        setTimeout(() => setCopiedId(c => (c === n.id ? null : c)), 2000);
      } catch (err) {
        // clipboard blocked — last-resort fallback
        window.prompt("Copy this news:", shareText);
      }
    }
  }
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [form, setForm] = useState({
    sessionType: "Sunday",
    sessionDate: defaultSessionDate || new Date().toISOString().split("T")[0],
    adminNote: "", title: "", content: "",
  });

  function openEditor(item = null) {
    if (item) {
      setForm({ sessionType: item.sessionType || "Sunday", sessionDate: item.sessionDate || defaultSessionDate, adminNote: "", title: item.title || "", content: item.content || "" });
      setEditingId(item.id);
    } else {
      const d = defaultSessionDate || new Date().toISOString().split("T")[0];
      setForm({ sessionType: dayToSessionType(d), sessionDate: d, adminNote: "", title: "", content: "" });
      setEditingId(null);
    }
    setAiError(""); setEditorOpen(true);
  }

  async function handleGenerate() {
    setGenerating(true); setAiError("");
    try {
      const data = getSessionData(form.sessionDate);
      if (!data || data.empty) { setAiError("No matches found for this date. Pick a date when games were actually played."); setGenerating(false); return; }
      const res = await fetch("/api/generateNews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionType: form.sessionType, sessionDate: formatDisplayDate(form.sessionDate), seasonId: data.seasonId, adminNote: form.adminNote, sessionData: data }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      setForm(f => ({ ...f, title: json.title || "", content: json.content || "" }));
    } catch (err) { setAiError(err.message || "Generation failed. Try again."); }
    finally { setGenerating(false); }
  }

  async function handleSave(publish) {
    if (!form.title.trim() || !form.content.trim()) { setAiError("Headline and article body are both required."); return; }
    await onSave({ id: editingId || null, title: form.title.trim(), content: form.content.trim(), sessionType: form.sessionType, sessionDate: form.sessionDate, isPublished: publish });
    setEditorOpen(false);
  }

  const visible = isAdmin ? news : news.filter(n => n.isPublished);
  const lbl = { fontSize: 11, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 6, letterSpacing: 0.5 };
  const inp = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 60px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: 0 }}>📰 Session News</h2>
        {isAdmin && (
          <button onClick={() => openEditor()} style={{ background: "#14a800", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>✏️ Write News</button>
        )}
      </div>

      {visible.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)", fontSize: 15 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📰</div>
          <div style={{ fontWeight: 600 }}>No news yet</div>
          {isAdmin && <div style={{ marginTop: 8, fontSize: 13 }}>After a session, hit "Write News" to publish a match report.</div>}
        </div>
      )}

      {visible.map(n => {
        const badge = getSessionBadge(n.sessionType);
        const isExpanded = expandedId === n.id;
        const draft = !n.isPublished;
        return (
          <div key={n.id} style={{ background: "var(--bg-card)", borderRadius: 14, border: "1px solid var(--border)", marginBottom: 16, overflow: "hidden", opacity: draft ? 0.72 : 1, boxShadow: "0 2px 10px rgba(0,0,0,0.06)" }}>
            <div style={{ padding: "16px 16px 0 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ background: badge.bg, color: badge.color, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20 }}>{badge.label}</span>
                {isRecent(n) && !draft && <span style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20 }}>NEW</span>}
                {draft && <span style={{ background: "rgba(107,114,128,0.12)", color: "#9ca3af", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20 }}>DRAFT</span>}
                <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: "auto" }}>{formatDisplayDate(n.sessionDate)}</span>
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", margin: "0 0 10px 0", lineHeight: 1.45 }}>{n.title}</h3>
            </div>
            <div style={{ padding: "0 16px 14px 16px" }}>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.75, margin: 0, whiteSpace: "pre-wrap", ...(isExpanded ? {} : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }) }}>{renderRich(n.content)}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: 6 }}>
                <button onClick={() => setExpandedId(isExpanded ? null : n.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#14a800", fontSize: 13, fontWeight: 600, padding: 0 }}>{isExpanded ? "Show less ↑" : "Read more ↓"}</button>
                <button onClick={() => handleShare(n)} style={{ background: "none", border: "none", cursor: "pointer", color: copiedId === n.id ? "#14a800" : "var(--text-muted)", fontSize: 13, fontWeight: 600, padding: 0, display: "inline-flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
                  {copiedId === n.id ? (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>
                      Share
                    </>
                  )}
                </button>
              </div>
            </div>
            {isAdmin && (
              <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {!n.isPublished
                  ? <button onClick={() => onPublish(n.id, true)} style={{ background: "#14a800", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🚀 Publish</button>
                  : <button onClick={() => onPublish(n.id, false)} style={{ background: "rgba(107,114,128,0.12)", color: "#9ca3af", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Unpublish</button>}
                <button onClick={() => openEditor(n)} style={{ background: "rgba(20,168,0,0.08)", color: "#14a800", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Edit</button>
                <button onClick={() => onDelete(n.id)} style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>Delete</button>
              </div>
            )}
          </div>
        );
      })}

      {editorOpen && isAdmin && (
        <div onClick={e => { if (e.target === e.currentTarget) setEditorOpen(false); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 2000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div style={{ background: "var(--bg-card)", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto", padding: "24px 20px 44px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{editingId ? "✏️ Edit News" : "✏️ Write Session News"}</h3>
              <button onClick={() => setEditorOpen(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-muted)", lineHeight: 1, padding: 4 }}>✕</button>
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 130 }}>
                <label style={lbl}>SESSION TYPE</label>
                <select value={form.sessionType} onChange={e => setForm(f => ({ ...f, sessionType: e.target.value }))} style={inp}>
                  <option value="Friday">🟢 Friday Session</option>
                  <option value="Sunday">🟡 Sunday Session</option>
                  <option value="Special">🟣 Special Session</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <label style={lbl}>SESSION DATE</label>
                <input type="date" value={form.sessionDate} onChange={e => setForm(f => ({ ...f, sessionDate: e.target.value, sessionType: dayToSessionType(e.target.value) }))} style={inp} />
              </div>
            </div>

            <div style={{ background: "rgba(20,168,0,0.05)", border: "1px solid rgba(20,168,0,0.2)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#14a800", marginBottom: 4 }}>✨ AI Match Report</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>The app reads that day's matches and the leaderboard automatically — no screenshots needed. Add an optional note below if you want something special mentioned.</div>
              <textarea placeholder="Optional note for the AI (e.g. 'It was Imran's birthday', 'we played in the rain')…" value={form.adminNote} onChange={e => setForm(f => ({ ...f, adminNote: e.target.value }))} rows={2} style={{ ...inp, resize: "vertical", marginBottom: 10, lineHeight: 1.5 }} />
              <button onClick={handleGenerate} disabled={generating} style={{ background: generating ? "#9ca3af" : "#14a800", color: "#fff", border: "none", borderRadius: 7, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: generating ? "not-allowed" : "pointer" }}>{generating ? "⏳ Reading the scoreboard…" : "✨ Generate Article"}</button>
              {aiError && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>{aiError}</div>}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>HEADLINE</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="A catchy headline…" style={{ ...inp, fontSize: 15, fontWeight: 600 }} />
            </div>
            <div style={{ marginBottom: 22 }}>
              <label style={lbl}>ARTICLE BODY</label>
              <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} placeholder="Generate above, or write the report here…" rows={11} style={{ ...inp, resize: "vertical", lineHeight: 1.75 }} />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setEditorOpen(false)} style={{ flex: 1, padding: 11, borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => handleSave(false)} style={{ flex: 1, padding: 11, borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Save Draft</button>
              <button onClick={() => handleSave(true)} style={{ flex: 2, padding: 11, borderRadius: 9, background: "#14a800", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>🚀 Publish</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
