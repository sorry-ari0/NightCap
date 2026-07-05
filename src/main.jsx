import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bookmark, CalendarClock, MapPin, MessageSquare, Search, SlidersHorizontal, Sparkles, Star, Users } from "lucide-react";
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

function App() {
  const [city, setCity] = useState("New York");
  const [vibe, setVibe] = useState("cocktail bars");
  const [venues, setVenues] = useState([]);
  const [source, setSource] = useState("seed");
  const [loading, setLoading] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [priorities, setPriorities] = useState(["vibes", "people"]);
  const [groupSize, setGroupSize] = useState(4);
  const [plan, setPlan] = useState([]);

  async function loadVenues() {
    setLoading(true);
    const params = new URLSearchParams({ city, vibe });
    const response = await fetch(`/api/venues?${params}`);
    const data = await response.json();
    setVenues(data.venues);
    setSource(data.source);
    setLoading(false);
  }

  useEffect(() => {
    loadVenues();
  }, []);

  async function saveVenue(venue) {
    await fetch("/api/saved-venues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venueId: venue.id })
    });
    setVenues((items) => items.map((item) => item.id === venue.id ? { ...item, saved: true } : item));
  }

  async function generatePlan() {
    const response = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venues, priorities, groupSize })
    });
    const data = await response.json();
    setPlan(data.plan);
  }

  async function submitRating(payload) {
    await fetch("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSelectedVenue(null);
    await loadVenues();
  }

  const topVenue = useMemo(() => {
    return [...venues].sort((a, b) => (b.overallScore ?? b.googleRating ?? 0) - (a.overallScore ?? a.googleRating ?? 0))[0];
  }, [venues]);

  return (
    <main className="app">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Nightlife Planner MVP</p>
          <h1>Rank the spots. Plan the night.</h1>
          <p className="lede">Pull bars and clubs from Maps, then layer on real ratings for vibes, drinks, people, aesthetics, music, and comments.</p>
        </div>
        <div className="hero-panel">
          <div className="panel-stat">
            <Star size={18} />
            <span>{topVenue?.overallScore ?? topVenue?.googleRating ?? "8.7"}</span>
            <small>top signal</small>
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

      <section className="controls">
        <label>
          <span>City</span>
          <select value={city} onChange={(event) => setCity(event.target.value)}>
            {cityOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <label>
          <span>Search vibe</span>
          <input value={vibe} onChange={(event) => setVibe(event.target.value)} placeholder="cocktail bars, clubs, rooftops" />
        </label>
        <button className="primary" onClick={loadVenues} disabled={loading}>
          <Search size={18} />
          {loading ? "Loading" : "Pull from Maps"}
        </button>
      </section>

      <section className="workspace">
        <aside className="planner">
          <div className="section-heading">
            <SlidersHorizontal size={18} />
            <h2>Planner</h2>
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

          <button className="primary full" onClick={generatePlan}>
            <Sparkles size={18} />
            Build tonight
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
            <h2>{city} spots</h2>
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

        <button className="secondary full" onClick={() => onRate(venue)}>
          <Star size={17} />
          Rate this spot
        </button>
      </div>
    </article>
  );
}

function RatingModal({ venue, onClose, onSubmit }) {
  const [overallScore, setOverallScore] = useState(8);
  const [optionalScores, setOptionalScores] = useState({});
  const [comment, setComment] = useState("");

  function updateScore(key, value) {
    setOptionalScores((scores) => ({ ...scores, [`${key}Score`]: Number(value) }));
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ venueId: venue.id, overallScore, ...optionalScores, comment });
        }}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Rate venue</p>
            <h2>{venue.name}</h2>
          </div>
          <button type="button" className="close" onClick={onClose}>Close</button>
        </div>

        <label className="range">
          <span>Overall: {overallScore}</span>
          <input type="range" min="1" max="10" step="0.1" value={overallScore} onChange={(event) => setOverallScore(Number(event.target.value))} />
        </label>

        <div className="rating-grid">
          {categories.map((category) => (
            <label key={category.key} className="range compact">
              <span>{category.label}: {optionalScores[`${category.key}Score`] ?? "-"}</span>
              <input type="range" min="1" max="10" step="0.1" onChange={(event) => updateScore(category.key, event.target.value)} />
            </label>
          ))}
        </div>

        <label>
          <span>Comment</span>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Line was fast, crowd was fun, drinks were pricey..." />
        </label>

        <button className="primary full" type="submit">Save rating</button>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
