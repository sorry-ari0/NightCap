import React, { useEffect, useId, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertCircle, Bookmark, CalendarClock, Copy, ExternalLink, Lock, MapPin, MessageSquare, Moon, Search, Send, SlidersHorizontal, Sparkles, Star, Unlock, Users } from "lucide-react";
import "./styles.css";

const categories = [
  { key: "vibes", label: "Vibes" },
  { key: "drinks", label: "Drinks" },
  { key: "people", label: "People" },
  { key: "aesthetics", label: "Aesthetics" },
  { key: "music", label: "Music" },
  { key: "value", label: "Value" }
];

const cityOptions = ["New York", "Miami", "Los Angeles"];

function getNightcapSession() {
  const existing = window.localStorage.getItem("nightcapSessionId");
  if (existing) return existing;
  const sessionId = crypto.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem("nightcapSessionId", sessionId);
  return sessionId;
}

function App() {
  const [city, setCity] = useState("New York");
  const [vibe, setVibe] = useState("cocktail bars");
  const [venues, setVenues] = useState([]);
  const [source, setSource] = useState("seed");
  const [loading, setLoading] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [priorities, setPriorities] = useState(["vibes", "people"]);
  const [groupSize, setGroupSize] = useState(1);
  const [plan, setPlan] = useState([]);
  const [progress, setProgress] = useState(null);
  const [inviteContact, setInviteContact] = useState("");
  const [health, setHealth] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fallbackReason, setFallbackReason] = useState("");
  const [sessionId] = useState(getNightcapSession);

  async function apiFetch(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-nightcap-session": sessionId,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function loadVenues() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ city, vibe });
      const data = await apiFetch(`/api/venues?${params}`);
      setVenues(data.venues);
      setSource(data.source);
      setFallbackReason(data.fallbackReason || "");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadProgress() {
    const data = await apiFetch("/api/progress");
    setProgress(data);
  }

  async function loadHealth() {
    const data = await apiFetch("/api/health");
    setHealth(data);
  }

  useEffect(() => {
    loadVenues();
    loadProgress();
    loadHealth();
  }, []);

  async function saveVenue(venue) {
    try {
      await apiFetch("/api/saved-venues", {
        method: "POST",
        body: JSON.stringify({ venueId: venue.id })
      });
      setVenues((items) => items.map((item) => item.id === venue.id ? { ...item, saved: !item.saved } : item));
      setNotice(venue.saved ? "Removed from saved spots." : "Saved to your shortlist.");
      await loadProgress();
    } catch (saveError) {
      setNotice("");
      setError(saveError.message);
    }
  }

  async function submitInvite(event) {
    event.preventDefault();
    if (!inviteContact.trim()) return;
    try {
      const data = await apiFetch("/api/invites", {
        method: "POST",
        body: JSON.stringify({ contact: inviteContact })
      });
      setProgress(data);
      setInviteContact("");
      setError("");
      setNotice("Invite recorded. Unlock progress updated.");
    } catch (inviteError) {
      setNotice("");
      setError(inviteError.message);
    }
  }

  async function generatePlan() {
    setError("");
    setNotice("");
    try {
      const data = await apiFetch("/api/plans", {
        method: "POST",
        body: JSON.stringify({ venues, priorities, groupSize })
      });
      setPlan(data.plan);
      await loadProgress();
    } catch (planError) {
      setPlan([]);
      setError(planError.message);
    }
  }

  async function copyPlan() {
    if (!plan.length) return;
    try {
      const text = plan.map((stop) => `${stop.stop}. ${stop.role}: ${stop.venue.name}`).join("\n");
      await navigator.clipboard?.writeText(`Nightcap plan\n${text}`);
      setNotice("Plan copied.");
    } catch {
      setError("Could not copy the plan in this browser.");
    }
  }

  async function submitRating(payload) {
    try {
      await apiFetch("/api/ratings", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setSelectedVenue(null);
      setError("");
      setNotice("Rating saved.");
      await loadVenues();
      await loadProgress();
    } catch (ratingError) {
      setError(ratingError.message);
    }
  }

  const topVenue = useMemo(() => {
    return [...venues].sort((a, b) => (b.overallScore ?? b.googleRating ?? 0) - (a.overallScore ?? a.googleRating ?? 0))[0];
  }, [venues]);

  const groupPlannerLocked = groupSize > 1 && (progress?.inviteCount ?? 0) < 2;

  return (
    <main className="app">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><Moon size={14} /> Nightcap</p>
          <h1>Your night, ranked before it starts.</h1>
          <p className="lede">Find the right bar, club, or late-night move from live venue data, your ratings, and the friends you bring into the graph.</p>
        </div>
        <div className="hero-panel">
          <div className="panel-stat">
            <Star size={18} />
            <span>{topVenue?.overallScore ?? topVenue?.googleRating ?? "8.7"}</span>
            <small>best signal</small>
          </div>
          <div className="panel-stat">
            <MapPin size={18} />
            <span>{venues.length}</span>
            <small>venues loaded</small>
          </div>
          <div className="panel-stat">
            <Users size={18} />
            <span>{groupSize}</span>
            <small>tonight</small>
          </div>
        </div>
      </section>

      <section className="controls" aria-label="Venue search">
        <label>
          <span>City</span>
          <input className="city-freeform" value={city} onChange={(event) => setCity(event.target.value)} list="city-options" />
          <datalist id="city-options">
            {cityOptions.map((option) => <option key={option} value={option} />)}
          </datalist>
        </label>
        <label>
          <span>Search vibe</span>
          <input value={vibe} onChange={(event) => setVibe(event.target.value)} placeholder="cocktail bars, clubs, rooftops" />
        </label>
        <button className="primary" onClick={loadVenues} disabled={loading}>
          <Search size={18} />
          {loading ? "Searching" : "Find spots"}
        </button>
      </section>

      {(error || notice) && (
        <div className={error ? "banner error" : "banner"}>
          <AlertCircle size={18} />
          <span>{error || notice}</span>
        </div>
      )}

      <section className="status-bar">
        <span>{health?.mapsConfigured ? "Maps connected" : "Maps key not set, using seed venues"}</span>
        <span>Storage: {health?.storage ?? "checking"}</span>
        <span>{source === "google" ? "Live Google Places results" : (fallbackReason || "Demo data active")}</span>
      </section>

      <section className="onboarding">
        <div className="onboarding-copy">
          <p className="eyebrow">Crew unlocks</p>
          <h2>More friends, better plans.</h2>
          <p>Invite friends to unlock group planning, match scores, city averages, and private mode. Ratings keep working from the first visit.</p>
        </div>
        <form className="invite-form" onSubmit={submitInvite}>
          <label>
            <span>Invite by phone or email</span>
            <input value={inviteContact} onChange={(event) => setInviteContact(event.target.value)} placeholder="friend@example.com" />
          </label>
          <button className="primary" type="submit">
            <Send size={18} />
            Invite
          </button>
        </form>
        <div className="unlock-grid">
          {(progress?.unlocks ?? []).map((unlock) => (
            <div className={unlock.unlocked ? "unlock-card active" : "unlock-card"} key={unlock.id}>
              {unlock.unlocked ? <Unlock size={18} /> : <Lock size={18} />}
              <strong>{unlock.label}</strong>
              <span>{unlock.unlocked ? "Unlocked" : `${unlock.remaining} invite${unlock.remaining === 1 ? "" : "s"} left`}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="workspace">
        <aside className="planner">
          <div className="section-heading planner-title">
            <SlidersHorizontal size={18} />
            <h2>Tonight</h2>
          </div>

          <div className="progress-strip">
            <span><b>{progress?.inviteCount ?? 0}</b> invites</span>
            <span><b>{progress?.ratingCount ?? 0}</b> ratings</span>
            <span><b>{progress?.savedCount ?? 0}</b> saved</span>
          </div>

          <label className="range">
            <span>Group size: {groupSize}</span>
            <input type="range" min="1" max="12" value={groupSize} onChange={(event) => setGroupSize(Number(event.target.value))} />
          </label>

          <div className="chips">
            {categories.map((category) => (
              <button
                key={category.key}
                className={priorities.includes(category.key) ? "chip selected" : "chip"}
                onClick={() => setPriorities((items) => items.includes(category.key) ? items.filter((item) => item !== category.key) : [...items, category.key])}
              >
                {category.label}
              </button>
            ))}
          </div>

          <button className="primary full" onClick={generatePlan} disabled={groupPlannerLocked}>
            <Sparkles size={18} />
            {groupPlannerLocked ? "Unlock group planner" : "Build tonight"}
          </button>
          {groupPlannerLocked && <p className="helper-text">Invite two friends to build plans for groups. Solo plans are available now.</p>}

          <button className="secondary full" onClick={copyPlan} disabled={!plan.length}>
            <Copy size={18} />
            Copy plan
          </button>

          <div className="plan-list">
            {plan.map((stop) => (
              <article className="plan-stop" key={`${stop.stop}-${stop.venue.id}`}>
                <strong>{stop.stop}. {stop.role}</strong>
                <span>{stop.venue.name}</span>
                <p>{stop.reason}</p>
              </article>
            ))}
          </div>
        </aside>

        <section className="venues">
          <div className="section-heading">
            <CalendarClock size={18} />
            <h2>{city} shortlist</h2>
            <span className="source">{source === "google" ? "Google Places" : "Seed fallback"}</span>
          </div>

          <div className="venue-grid">
            {venues.map((venue) => (
              <VenueCard key={venue.id} venue={venue} onRate={setSelectedVenue} onSave={saveVenue} />
            ))}
          </div>
        </section>
      </section>

      {selectedVenue && (
        <RatingModal
          venue={selectedVenue}
          onClose={() => setSelectedVenue(null)}
          onSubmit={submitRating}
        />
      )}
    </main>
  );
}

function VenueCard({ venue, onRate, onSave }) {
  const score = venue.overallScore ?? venue.googleRating;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name} ${venue.address || venue.city}`)}`;
  return (
    <article className="venue-card">
      <div className="venue-photo" style={{ backgroundImage: `url(${venue.photoUrl || "https://images.unsplash.com/photo-1575444758702-4a6b9222336e?auto=format&fit=crop&w=1200&q=80"})` }}>
        <button className={venue.saved ? "icon saved" : "icon"} onClick={() => onSave(venue)} aria-label="Save venue">
          <Bookmark size={18} />
        </button>
      </div>
      <div className="venue-body">
        <div className="venue-title">
          <div>
            <h3>{venue.name}</h3>
            <p><MapPin size={14} /> {venue.neighborhood || venue.address}</p>
          </div>
          <div className="score">{score ?? "New"}</div>
        </div>

        <div className="mini-scores">
          {categories.slice(0, 4).map((category) => (
            <span key={category.key}>{category.label} <b>{venue.categoryScores?.[category.key] ?? "-"}</b></span>
          ))}
        </div>

        {venue.recentComments?.[0] && (
          <p className="comment"><MessageSquare size={14} /> {venue.recentComments[0].comment}</p>
        )}

        <div className="venue-actions">
          <button className="secondary full" onClick={() => onRate(venue)}>
            <Star size={17} />
            Rate
          </button>
          <a className="secondary full link-button" href={mapsUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={17} />
            Map
          </a>
        </div>
      </div>
    </article>
  );
}

function RatingModal({ venue, onClose, onSubmit }) {
  const [overallScore, setOverallScore] = useState(8);
  const [optionalScores, setOptionalScores] = useState({});
  const [comment, setComment] = useState("");
  const titleId = useId();
  const overallId = useId();
  const commentId = useId();

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function updateScore(key, value) {
    setOptionalScores((scores) => ({ ...scores, [`${key}Score`]: Number(value) }));
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ venueId: venue.id, canonicalVenueKey: venue.canonicalVenueKey, overallScore, ...optionalScores, comment });
        }}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Rate venue</p>
            <h2 id={titleId}>{venue.name}</h2>
          </div>
          <button type="button" className="close" onClick={onClose}>Close</button>
        </div>

        <label className="range">
          <span>Overall: {overallScore}</span>
          <input id={overallId} aria-label="Overall score" type="range" min="1" max="10" step="0.1" value={overallScore} onChange={(event) => setOverallScore(Number(event.target.value))} />
        </label>

        <div className="rating-grid">
          {categories.map((category, index) => (
            <label key={category.key} className="range compact">
              <span>{category.label}: {optionalScores[`${category.key}Score`] ?? "-"}</span>
              <input id={`${titleId}-${index}`} aria-label={`${category.label} score`} type="range" min="1" max="10" step="0.1" onChange={(event) => updateScore(category.key, event.target.value)} />
            </label>
          ))}
        </div>

        <label htmlFor={commentId}>
          <span>Comment</span>
          <textarea id={commentId} maxLength={500} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Line was fast, crowd was fun, drinks were pricey..." />
        </label>

        <button className="primary full" type="submit">Save rating</button>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
