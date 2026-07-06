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
const clientSeedVenues = [
  { id: "client-nightmoves", canonicalVenueKey: "nightmoves-new-york", name: "Nightmoves", address: "Williamsburg, Brooklyn, NY", city: "New York", types: ["bar", "night_club"], categoryScores: {}, recentComments: [] },
  { id: "client-le-bain", canonicalVenueKey: "le-bain-new-york", name: "Le Bain", address: "Meatpacking District, New York, NY", city: "New York", types: ["bar", "night_club"], categoryScores: {}, recentComments: [] },
  { id: "client-public-records", canonicalVenueKey: "public-records-new-york", name: "Public Records", address: "Gowanus, Brooklyn, NY", city: "New York", types: ["bar", "night_club"], categoryScores: {}, recentComments: [] },
  { id: "client-sweet-liberty", canonicalVenueKey: "sweet-liberty-miami", name: "Sweet Liberty", address: "Miami Beach, FL", city: "Miami", types: ["bar"], categoryScores: {}, recentComments: [] },
  { id: "client-club-space", canonicalVenueKey: "club-space-miami", name: "Club Space", address: "Downtown Miami, FL", city: "Miami", types: ["night_club"], categoryScores: {}, recentComments: [] },
  { id: "client-death-co", canonicalVenueKey: "death-and-co-los-angeles", name: "Death & Co", address: "Arts District, Los Angeles, CA", city: "Los Angeles", types: ["bar"], categoryScores: {}, recentComments: [] }
];

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
  const [ranking, setRanking] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fallbackReason, setFallbackReason] = useState("");
  const [sessionId] = useState(getNightcapSession);

  async function apiFetch(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 8000);
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-nightcap-session": sessionId,
        ...(options.headers || {})
      }
    }).finally(() => clearTimeout(timeout));
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
      const normalizedCity = city.toLowerCase();
      const fallbackVenues = clientSeedVenues.filter((venue) => venue.city.toLowerCase().includes(normalizedCity) || normalizedCity.includes(venue.city.toLowerCase()));
      setVenues(fallbackVenues.length ? fallbackVenues : clientSeedVenues);
      setSource("seed");
      setFallbackReason("Local demo fallback is active while the API is unavailable.");
      setError(loadError.name === "AbortError" ? "API timed out, showing demo venues." : loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadProgress() {
    try {
      const data = await apiFetch("/api/progress", { timeout: 5000 });
      setProgress(data);
    } catch {
      setProgress({
        inviteCount: 0,
        ratingCount: 0,
        savedCount: 0,
        unlocks: [
          { id: "friend-match", label: "Friend match scores", requiredInvites: 1, unlocked: false, remaining: 1 },
          { id: "group-planner", label: "Group planner", requiredInvites: 2, unlocked: false, remaining: 2 },
          { id: "city-scores", label: "City average scores", requiredInvites: 3, unlocked: false, remaining: 3 },
          { id: "stealth-mode", label: "Private mode", requiredInvites: 4, unlocked: false, remaining: 4 }
        ]
      });
    }
  }

  async function loadRanking() {
    try {
      const data = await apiFetch("/api/rankings/me", { timeout: 5000 });
      setRanking(data);
    } catch {
      setRanking({
        published: false,
        shareText: "I’m building my NightCap nightlife ranking.",
        inviteGate: {
          required: 3,
          successfulInvites: progress?.inviteCount ?? 0,
          remaining: Math.max(0, 3 - (progress?.inviteCount ?? 0)),
          unlocked: (progress?.inviteCount ?? 0) >= 3
        },
        ranking: venues
          .filter((venue) => Number.isFinite(venue.overallScore))
          .sort((a, b) => b.overallScore - a.overallScore)
          .slice(0, 10)
          .map((venue) => ({
            name: venue.name,
            address: venue.address,
            overallScore: venue.overallScore,
            comment: venue.recentComments?.[0]?.comment
          }))
      });
    }
  }

  async function loadHealth() {
    try {
      const data = await apiFetch("/api/health", { timeout: 5000 });
      setHealth(data);
    } catch {
      setHealth({ ok: false, mapsConfigured: false, storage: "offline demo" });
    }
  }

  useEffect(() => {
    loadVenues();
    loadProgress();
    loadHealth();
    loadRanking();
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
      await loadRanking();
      setInviteContact("");
      setError("");
      setNotice("Invite recorded. Unlock progress updated.");
    } catch (inviteError) {
      setProgress((current) => {
        const inviteCount = (current?.inviteCount ?? 0) + 1;
        return {
          ...(current || {}),
          inviteCount,
          ratingCount: current?.ratingCount ?? 0,
          savedCount: current?.savedCount ?? 0,
          unlocks: (current?.unlocks ?? []).map((unlock) => ({
            ...unlock,
            unlocked: inviteCount >= unlock.requiredInvites,
            remaining: Math.max(0, unlock.requiredInvites - inviteCount)
          }))
        };
      });
      await loadRanking();
      setInviteContact("");
      setNotice("Invite recorded locally. API sync is unavailable.");
      setError("");
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
      const localPlan = venues.slice(0, 3).map((venue, index) => ({
        stop: index + 1,
        venue,
        role: index === 0 ? "Start here" : index === 1 ? "Main move" : "Late-night backup",
        reason: "Built from local demo venues while API sync is unavailable."
      }));
      setPlan(localPlan);
      setNotice("Plan built locally. API sync is unavailable.");
      setError("");
    }
  }

  async function copyPlan() {
    if (!plan.length) return;
    try {
      const text = plan.map((stop) => `${stop.stop}. ${stop.role}: ${stop.venue.name}`).join("\n");
      await navigator.clipboard?.writeText(`NightCap plan\n${text}`);
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
      await loadRanking();
    } catch (ratingError) {
      setVenues((items) => items.map((item) => item.id === payload.venueId ? {
        ...item,
        overallScore: payload.overallScore,
        ratingCount: (item.ratingCount || 0) + 1,
        recentComments: payload.comment ? [{ comment: payload.comment, overallScore: payload.overallScore, createdAt: new Date().toISOString() }] : item.recentComments
      } : item));
      setProgress((current) => ({
        ...(current || {}),
        inviteCount: current?.inviteCount ?? 0,
        ratingCount: (current?.ratingCount ?? 0) + 1,
        savedCount: current?.savedCount ?? 0,
        unlocks: current?.unlocks ?? []
      }));
      setSelectedVenue(null);
      setNotice("Rating saved locally. API sync is unavailable.");
      setError("");
      await loadRanking();
    }
  }

  async function publishRanking() {
    try {
      const data = await apiFetch("/api/rankings/publish", {
        method: "POST",
        body: JSON.stringify({})
      });
      setRanking(data);
      setNotice("Your public ranking is unlocked.");
      setError("");
    } catch (publishError) {
      setNotice("");
      setError(publishError.message);
      await loadRanking();
    }
  }

  async function copyRanking() {
    const text = ranking?.shareText || "I’m building my NightCap nightlife ranking.";
    try {
      await navigator.clipboard?.writeText(text);
      setNotice("Ranking share text copied.");
    } catch {
      setError("Could not copy the ranking in this browser.");
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
          <p className="eyebrow"><Moon size={14} /> NightCap</p>
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

      <section className="ranking-section">
        <div className="ranking-copy">
          <p className="eyebrow">Public ranking</p>
          <h2>Your top spots become the growth loop.</h2>
          <p>Preview your ranking now. Publish and share it after 3 successful invites so the list launches with friends attached.</p>
        </div>
        <div className="ranking-card">
          <div className="ranking-card-head">
            <div>
              <span className="ranking-kicker">NightCap ranking</span>
              <strong>{ranking?.published ? "Public" : "Private preview"}</strong>
            </div>
            <span className={ranking?.inviteGate?.unlocked ? "gate-pill unlocked" : "gate-pill"}>
              {ranking?.inviteGate?.unlocked ? "Share unlocked" : `${ranking?.inviteGate?.successfulInvites ?? 0}/3 joined`}
            </span>
          </div>

          <div className="ranking-list">
            {(ranking?.ranking?.length ? ranking.ranking : venues.slice(0, 3)).slice(0, 5).map((venue, index) => (
              <div className="ranking-row" key={`${venue.name}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{venue.name}</strong>
                  <small>{venue.overallScore ? `${venue.overallScore} overall` : "Rate to rank"}</small>
                </div>
              </div>
            ))}
          </div>

          {!ranking?.inviteGate?.unlocked && (
            <p className="helper-text">Invite {ranking?.inviteGate?.remaining ?? 3} more friend{(ranking?.inviteGate?.remaining ?? 3) === 1 ? "" : "s"} to publish and share your ranking.</p>
          )}

          <div className="ranking-actions">
            <button className="primary full" onClick={publishRanking} disabled={!ranking?.inviteGate?.unlocked || ranking?.published}>
              <Unlock size={18} />
              {ranking?.published ? "Published" : "Publish ranking"}
            </button>
            <button className="secondary full" onClick={copyRanking} disabled={!ranking?.inviteGate?.unlocked}>
              <Copy size={18} />
              Copy share
            </button>
          </div>
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
  const photoStyle = venue.photoUrl
    ? { backgroundImage: `url(${venue.photoUrl})` }
    : undefined;
  return (
    <article className="venue-card">
      <div className="venue-photo" style={photoStyle}>
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
          onSubmit({
            venueId: venue.id,
            canonicalVenueKey: venue.canonicalVenueKey,
            venueName: venue.name,
            venueAddress: venue.address,
            venueCity: venue.city,
            overallScore,
            ...optionalScores,
            comment
          });
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
