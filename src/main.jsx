import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { AlertCircle, Bookmark, CalendarClock, Copy, Database, ExternalLink, Lock, MapPin, MessageSquare, Moon, Search, Send, SlidersHorizontal, Sparkles, Star, Unlock, UserRound, Users } from "lucide-react";
import "./styles.css";

const categories = [
  { key: "vibes", label: "Vibes" },
  { key: "drinks", label: "Drinks" },
  { key: "people", label: "People" },
  { key: "aesthetics", label: "Aesthetics" },
  { key: "music", label: "Music" },
  { key: "value", label: "Value" }
];

const cityOptions = ["New York", "San Francisco", "Los Angeles"];
const initialVenueCardLimit = 20;
const venueCardLimitStep = 20;
const initialPhotoLoadLimit = 6;
const photoLoadStep = 4;
const clientSeedVenues = [
  { id: "client-nightmoves", canonicalVenueKey: "nightmoves-new-york", name: "Nightmoves", address: "Williamsburg, Brooklyn, NY", city: "New York", types: ["bar", "night_club"], location: { lat: 40.7147, lng: -73.9614 }, categoryScores: {}, recentComments: [] },
  { id: "client-le-bain", canonicalVenueKey: "le-bain-new-york", name: "Le Bain", address: "Meatpacking District, New York, NY", city: "New York", types: ["bar", "night_club"], location: { lat: 40.7409, lng: -74.0088 }, categoryScores: {}, recentComments: [] },
  { id: "client-public-records", canonicalVenueKey: "public-records-new-york", name: "Public Records", address: "Gowanus, Brooklyn, NY", city: "New York", types: ["bar", "night_club"], location: { lat: 40.6781, lng: -73.9863 }, categoryScores: {}, recentComments: [] },
  { id: "client-smugglers-cove", canonicalVenueKey: "smugglers-cove-san-francisco", name: "Smuggler's Cove", address: "Hayes Valley, San Francisco, CA", city: "San Francisco", types: ["bar"], location: { lat: 37.7794, lng: -122.4232 }, categoryScores: {}, recentComments: [] },
  { id: "client-monarch", canonicalVenueKey: "monarch-san-francisco", name: "Monarch", address: "SoMa, San Francisco, CA", city: "San Francisco", types: ["bar", "night_club"], location: { lat: 37.7809, lng: -122.4085 }, categoryScores: {}, recentComments: [] },
  { id: "client-temple-nightclub", canonicalVenueKey: "temple-nightclub-san-francisco", name: "Temple Nightclub", address: "SoMa, San Francisco, CA", city: "San Francisco", types: ["night_club"], location: { lat: 37.7878, lng: -122.3972 }, categoryScores: {}, recentComments: [] },
  { id: "client-death-co", canonicalVenueKey: "death-and-co-los-angeles", name: "Death & Co", address: "Arts District, Los Angeles, CA", city: "Los Angeles", types: ["bar"], location: { lat: 34.0441, lng: -118.2327 }, categoryScores: {}, recentComments: [] }
];

function getAppBasePath() {
  const match = window.location.pathname.match(/^(\/p\/[^/]+\/\d+)(?:\/|$)/);
  return match ? match[1] : "";
}

function appPath(path) {
  if (!path?.startsWith("/")) return path;
  return `${getAppBasePath()}${path}`;
}

function getNightcapSession() {
  const existing = window.localStorage.getItem("nightcapSessionId");
  if (existing) return existing;
  const sessionId = crypto.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem("nightcapSessionId", sessionId);
  return sessionId;
}

function App() {
  const publicPath = window.location.pathname.replace(getAppBasePath(), "") || "/";
  const publicRankingMatch = publicPath.match(/^\/u\/([^/]+)\/rankings\/([^/]+)/);
  if (publicRankingMatch) {
    return <PublicRankingPage handle={publicRankingMatch[1]} slug={publicRankingMatch[2]} />;
  }

  const [city, setCity] = useState("New York");
  const [vibe, setVibe] = useState("cocktail bars");
  const [venues, setVenues] = useState([]);
  const [source, setSource] = useState("seed");
  const [loading, setLoading] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [detailVenue, setDetailVenue] = useState(null);
  const [priorities, setPriorities] = useState(["vibes", "people"]);
  const [groupSize, setGroupSize] = useState(1);
  const [plan, setPlan] = useState([]);
  const [progress, setProgress] = useState(null);
  const [inviteContact, setInviteContact] = useState("");
  const [contactsRaw, setContactsRaw] = useState("Maya Chen <maya@example.com>\nAlex Kim <alex@example.com>\nNina Patel <nina@example.com>");
  const [contactGraph, setContactGraph] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({ name: "", email: "", phone: "", password: "", profilePhoto: "" });
  const [resetForm, setResetForm] = useState({ contact: "", token: "", password: "" });
  const [resetNotice, setResetNotice] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [health, setHealth] = useState(null);
  const [ranking, setRanking] = useState(null);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleResults, setPeopleResults] = useState([]);
  const [peopleSearchMessage, setPeopleSearchMessage] = useState("");
  const [shareCard, setShareCard] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fallbackReason, setFallbackReason] = useState("");
  const [mapData, setMapData] = useState({ points: [], bounds: null });
  const [cacheStatus, setCacheStatus] = useState("");
  const [userLocation, setUserLocation] = useState(null);
  const [nearMeLoading, setNearMeLoading] = useState(false);
  const [activeView, setActiveView] = useState("spots");
  const [visibleMapVenueIds, setVisibleMapVenueIds] = useState([]);
  const [visibleVenueCardLimit, setVisibleVenueCardLimit] = useState(initialVenueCardLimit);
  const [photoLoadLimit, setPhotoLoadLimit] = useState(initialPhotoLoadLimit);
  const [sessionId] = useState(getNightcapSession);

  async function apiFetch(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 8000);
    const response = await fetch(appPath(path), {
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

  async function loadVenues(locationOverride = userLocation) {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ city, vibe });
      if (locationOverride) {
        params.set("lat", String(locationOverride.lat));
        params.set("lng", String(locationOverride.lng));
        params.set("radiusMeters", String(locationOverride.radiusMeters || 5000));
      }
      const data = await apiFetch(`/api/venues?${params}`, { timeout: 45000 });
      setVenues(data.venues);
      setVisibleVenueCardLimit(initialVenueCardLimit);
      setSource(data.source);
      setFallbackReason(data.fallbackReason || "");
      setMapData(data.map || buildMapData(data.venues));
      setCacheStatus(data.cacheStatus || "");
    } catch (loadError) {
      if (venues.length > clientSeedVenues.length) {
        setFallbackReason("Keeping stored venue data after a refresh failed.");
        setError(loadError.name === "AbortError" ? "Refresh timed out, keeping stored venues." : loadError.message);
        return;
      }
      const normalizedCity = city.toLowerCase();
      const fallbackVenues = clientSeedVenues.filter((venue) => venue.city.toLowerCase().includes(normalizedCity) || normalizedCity.includes(venue.city.toLowerCase()));
      const localVenues = fallbackVenues.length ? fallbackVenues : clientSeedVenues;
      setVenues(localVenues);
      setVisibleVenueCardLimit(initialVenueCardLimit);
      setSource("seed");
      setMapData(buildMapData(localVenues));
      setCacheStatus("local");
      setFallbackReason("Local demo fallback is active while the API is unavailable.");
      setError(loadError.name === "AbortError" ? "API timed out, showing demo venues." : loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function findNearMe() {
    if (!navigator.geolocation) {
      setError("Location is not available in this browser.");
      return;
    }
    setNearMeLoading(true);
    setError("");
    setNotice("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const nextLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          radiusMeters: 5000
        };
        setUserLocation(nextLocation);
        setCity("Near me");
        await loadVenues(nextLocation);
        setNotice("Showing bars and clubs near your current location.");
        setNearMeLoading(false);
      },
      (locationError) => {
        setNearMeLoading(false);
        setError(locationError.code === 1 ? "Location permission was denied." : "Could not get your current location.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
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

  async function loadContacts() {
    try {
      const data = await apiFetch("/api/contacts", { timeout: 5000 });
      setContactGraph(data);
    } catch {
      setContactGraph({
        importedCount: 0,
        onApp: [],
        inviteCandidates: [],
        recommendations: [],
        appMemberCount: 0,
        unlocks: []
      });
    }
  }

  async function loadProfile() {
    try {
      const data = await apiFetch("/api/profile", { timeout: 5000 });
      setProfile(data.profile);
      if (data.profile) {
        setProfileForm({
          name: data.profile.name || "",
          email: data.profile.email || "",
          phone: data.profile.phone || "",
          password: "",
          profilePhoto: data.profile.profilePhoto || ""
        });
      }
    } catch {
      setProfile(null);
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
        rankingLocked: true,
        ranking: []
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
    loadContacts();
    loadProfile();
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
    await inviteFriend({ contact: inviteContact });
  }

  async function inviteFriend(friend) {
    if (!friend?.contact?.trim()) return;
    try {
      const data = await apiFetch("/api/invites", {
        method: "POST",
        body: JSON.stringify({ contact: friend.contact, name: friend.name })
      });
      setProgress(data);
      setContactGraph(data.contactGraph || contactGraph);
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

  async function importContacts(event) {
    event.preventDefault();
    try {
      const data = await apiFetch("/api/contacts/import", {
        method: "POST",
        body: JSON.stringify({ raw: contactsRaw })
      });
      setContactGraph(data);
      setNotice("Contacts imported. Recommendations updated.");
      setError("");
    } catch (contactError) {
      setNotice("");
      setError(contactError.message);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    try {
      const data = await apiFetch("/api/profile", {
        method: "POST",
        body: JSON.stringify({
          ...profileForm,
          password: profileForm.password || undefined
        })
      });
      setProfile(data.profile);
      setProfileForm((form) => ({ ...form, password: "", profilePhoto: data.profile.profilePhoto || "" }));
      setNotice("Account saved.");
      setError("");
      setActiveView("friends");
    } catch (profileError) {
      setNotice("");
      setError(profileError.message);
    }
  }

  async function sendFeedback(event) {
    event.preventDefault();
    try {
      await apiFetch("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ message: feedbackMessage, path: window.location.pathname })
      });
      setFeedbackMessage("");
      setNotice("Feedback sent.");
      setError("");
    } catch (feedbackError) {
      setNotice("");
      setError(feedbackError.message);
    }
  }

  function handleProfilePhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size > 1_800_000) {
      setError("Profile picture must be under 1.8MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError("");
      setProfileForm((form) => ({ ...form, profilePhoto: String(reader.result || "") }));
    };
    reader.readAsDataURL(file);
  }

  async function requestPasswordReset(event) {
    event.preventDefault();
    try {
      const data = await apiFetch("/api/password/reset-request", {
        method: "POST",
        body: JSON.stringify({ email: resetForm.contact })
      });
      setResetForm((form) => ({ ...form, token: data.resetToken || "" }));
      setResetNotice(data.resetToken ? `Reset email sent to ${data.sentTo}. The local code is filled in for this build.` : `Reset email sent to ${data.sentTo}.`);
      setNotice("");
      setError("");
    } catch (resetError) {
      setResetNotice("");
      setError(resetError.message);
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    try {
      await apiFetch("/api/password/reset", {
        method: "POST",
        body: JSON.stringify({ token: resetForm.token, password: resetForm.password })
      });
      setResetForm({ contact: "", token: "", password: "" });
      setResetNotice("Password reset.");
      setError("");
    } catch (resetError) {
      setResetNotice("");
      setError(resetError.message);
    }
  }

  async function generatePlan() {
    setError("");
    setNotice("");
    try {
      const data = await apiFetch("/api/plans", {
        method: "POST",
        body: JSON.stringify({ venues: venues.map(plannerVenuePayload), priorities, groupSize })
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
      await createShareCard();
      setNotice("Your public ranking is unlocked.");
      setError("");
    } catch (publishError) {
      setNotice("");
      setError(publishError.message);
      await loadRanking();
    }
  }

  async function copyRanking() {
    const shareUrl = ranking?.shareUrl ? `${window.location.origin}${appPath(ranking.shareUrl)}` : "";
    const text = [ranking?.shareText || "I’m building my NightCap nightlife ranking.", shareUrl].filter(Boolean).join("\n");
    try {
      await navigator.clipboard?.writeText(text);
      setNotice("Ranking share text copied.");
    } catch {
      setError("Could not copy the ranking in this browser.");
    }
  }

  async function searchPeople(event) {
    event.preventDefault();
    try {
      const params = new URLSearchParams();
      if (peopleQuery.trim()) params.set("q", peopleQuery.trim());
      const data = await apiFetch(`/api/people/search?${params}`, { timeout: 5000 });
      setPeopleResults(data.people || []);
      setPeopleSearchMessage(data.people?.length ? "" : "No ranked people found yet.");
      setError("");
    } catch (searchError) {
      setPeopleResults([]);
      setPeopleSearchMessage(searchError.message);
      setError("");
    }
  }

  async function createShareCard() {
    try {
      const data = await apiFetch("/api/share-cards", {
        method: "POST",
        body: JSON.stringify({})
      });
      setShareCard(data.shareCard);
      return data.shareCard;
    } catch {
      setShareCard(null);
      return null;
    }
  }

  const topVenue = useMemo(() => {
    return [...venues].sort((a, b) => (b.overallScore ?? b.googleRating ?? 0) - (a.overallScore ?? a.googleRating ?? 0))[0];
  }, [venues]);

  const groupPlannerLocked = groupSize > 1 && (progress?.inviteCount ?? 0) < 2;
  const visibleVenueIdSet = useMemo(() => new Set(visibleMapVenueIds), [visibleMapVenueIds]);
  const mapVisibleVenues = useMemo(() => {
    if (!visibleMapVenueIds.length) return venues;
    return venues.filter((venue) => visibleVenueIdSet.has(venue.id));
  }, [venues, visibleMapVenueIds, visibleVenueIdSet]);
  const displayedMapVenues = useMemo(() => mapVisibleVenues.slice(0, visibleVenueCardLimit), [mapVisibleVenues, visibleVenueCardLimit]);
  const hiddenMapVenueCount = Math.max(mapVisibleVenues.length - displayedMapVenues.length, 0);
  const handleVisibleVenuesChange = useCallback((venueIds) => {
    setVisibleMapVenueIds(venueIds);
    setVisibleVenueCardLimit(initialVenueCardLimit);
    setPhotoLoadLimit(initialPhotoLoadLimit);
  }, []);
  useEffect(() => {
    setPhotoLoadLimit(initialPhotoLoadLimit);
  }, [visibleVenueCardLimit, visibleMapVenueIds]);
  useEffect(() => {
    if (photoLoadLimit >= displayedMapVenues.length) return undefined;
    const timeout = window.setTimeout(() => {
      setPhotoLoadLimit((limit) => Math.min(limit + photoLoadStep, displayedMapVenues.length));
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [displayedMapVenues.length, photoLoadLimit]);
  const appTabs = [
    { id: "spots", label: "Spots", icon: Search },
    { id: "friends", label: "Friends", icon: Users },
    { id: "plan", label: "Plan", icon: SlidersHorizontal },
    { id: "ranking", label: "Ranking", icon: Star },
    { id: "account", label: "Account", icon: UserRound }
  ];

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

      <nav className="app-tabs" aria-label="NightCap sections">
        {appTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={activeView === tab.id ? "app-tab active" : "app-tab"}
              onClick={() => setActiveView(tab.id)}
              onPointerUp={(event) => {
                if (event.pointerType === "touch") setActiveView(tab.id);
              }}
            >
              <Icon size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <ActivationChecklist profile={profile} progress={progress} ranking={ranking} onNavigate={setActiveView} />

      {(error || notice) && (
        <div className={error ? "banner error" : "banner"}>
          <AlertCircle size={18} />
          <span>{error || notice}</span>
        </div>
      )}

      {activeView === "spots" && (
        <>
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
            <button className="secondary" onClick={findNearMe} disabled={nearMeLoading || loading}>
              <MapPin size={18} />
              {nearMeLoading ? "Locating" : "Near me"}
            </button>
            <button className="primary" onClick={() => loadVenues()} disabled={loading}>
              <Search size={18} />
              {loading ? "Searching" : "Find spots"}
            </button>
          </section>

          <section className="venues">
            <div className="section-heading">
              <CalendarClock size={18} />
              <h2>{city} shortlist</h2>
              <span className="source">{sourceLabel(source, cacheStatus)}</span>
            </div>

            <VenueMap mapData={mapData} venues={venues} onVisibleVenuesChange={handleVisibleVenuesChange} />

            <div className="map-results-head">
              <strong>{mapVisibleVenues.length}</strong>
              <span>places visible in this map view</span>
              {hiddenMapVenueCount > 0 && <small>Showing {displayedMapVenues.length} to keep photos fast.</small>}
            </div>
            <div className="venue-grid">
              {displayedMapVenues.map((venue, index) => (
                <VenueCard key={venue.id} venue={venue} loadPhoto={index < photoLoadLimit} onOpen={setDetailVenue} onRate={setSelectedVenue} onSave={saveVenue} />
              ))}
            </div>
            {hiddenMapVenueCount > 0 && (
              <button type="button" className="secondary load-more" onClick={() => setVisibleVenueCardLimit((limit) => limit + venueCardLimitStep)}>
                Show {Math.min(venueCardLimitStep, hiddenMapVenueCount)} more spots
              </button>
            )}
          </section>
        </>
      )}

      {activeView === "friends" && (
        <section className="onboarding">
        <div className="onboarding-copy">
          <p className="eyebrow">Crew unlocks</p>
          <h2>More friends, better plans.</h2>
          <p>Import contacts to see who already has NightCap, then invite recommended friends with mutual app contacts to unlock group planning, match scores, city averages, and private mode.</p>
        </div>
        <form className="invite-form" onSubmit={submitInvite}>
          <label>
            <span>Quick invite by phone or email</span>
            <input value={inviteContact} onChange={(event) => setInviteContact(event.target.value)} placeholder="friend@example.com or +1 555 0100" />
          </label>
          <button className="primary" type="submit">
            <Send size={18} />
            Invite
          </button>
        </form>
        <form className="contacts-import" onSubmit={importContacts}>
          <label>
            <span>Paste contacts</span>
            <textarea value={contactsRaw} onChange={(event) => setContactsRaw(event.target.value)} placeholder="Name <email@example.com> or phone, one per line" />
          </label>
          <button className="secondary full" type="submit">
            <Users size={18} />
            Check contacts
          </button>
        </form>
        <ContactGraph graph={contactGraph} onInvite={inviteFriend} />
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
      )}

      {activeView === "ranking" && (
        <section className="ranking-section">
        <div className="ranking-copy">
          <p className="eyebrow">Public ranking</p>
          <h2>Your posts publish as you rate.</h2>
          <p>Ratings become public posts automatically. Invite 3 friends to reveal your own ranking and search top-ranked people based on posts and likes.</p>
        </div>
        <div className="ranking-card">
          <div className="ranking-card-head">
            <div>
              <span className="ranking-kicker">NightCap ranking</span>
              <strong>{ranking?.inviteGate?.unlocked ? (ranking?.published ? "Public" : "Unlocked") : "Locked preview"}</strong>
            </div>
            <span className={ranking?.inviteGate?.unlocked ? "gate-pill unlocked" : "gate-pill"}>
              {ranking?.inviteGate?.unlocked ? "Share unlocked" : `${ranking?.inviteGate?.successfulInvites ?? 0}/3 joined`}
            </span>
          </div>

          {ranking?.inviteGate?.unlocked ? (
            <>
              <div className="ranking-list">
                {(ranking?.ranking ?? []).slice(0, 5).map((venue, index) => (
                  <div className="ranking-row" key={`${venue.name}-${index}`}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{venue.name}</strong>
                      <small>{venue.overallScore ? `${venue.overallScore} overall` : "Rate to rank"}</small>
                    </div>
                  </div>
                ))}
                {!ranking?.ranking?.length && <p className="helper-text">Rate a few venues to build your ranking.</p>}
              </div>

              <form className="people-search" onSubmit={searchPeople}>
                <label>
                  <span>Search top-ranked people</span>
                  <input value={peopleQuery} onChange={(event) => setPeopleQuery(event.target.value)} placeholder="Search by person, venue, or post" />
                </label>
                <button className="secondary full" type="submit">
                  <Search size={18} />
                  Search people
                </button>
              </form>
              <div className="people-results">
                {peopleResults.map((person, index) => (
                  <div className="people-row" key={person.id}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{person.name}</strong>
                      <small>{person.postCount} post{person.postCount === 1 ? "" : "s"} · {person.likeCount} like{person.likeCount === 1 ? "" : "s"} · {person.averageScore} avg</small>
                      {person.topPost && <em>Top post: {person.topPost.venueName}</em>}
                    </div>
                    <b>{person.rankScore}</b>
                  </div>
                ))}
                {peopleSearchMessage && <p className="helper-text">{peopleSearchMessage}</p>}
              </div>
            </>
          ) : (
            <div className="ranking-locked">
              <Lock size={22} />
              <strong>Invite 3 friends to reveal your ranking and people search.</strong>
              <p>Your venue posts publish automatically when you rate, but your own ranking and top-ranked people search stay private until the invite gate is unlocked.</p>
            </div>
          )}

          {shareCard && (
            <div className="share-card-preview">
              <img src={shareCard.dataUrl} alt="NightCap ranking share card preview" />
            </div>
          )}

          {!ranking?.inviteGate?.unlocked && (
            <div className="ranking-gate">
              <p className="helper-text">Invite {ranking?.inviteGate?.remaining ?? 3} more friend{(ranking?.inviteGate?.remaining ?? 3) === 1 ? "" : "s"} to publish and share your ranking.</p>
              <button className="secondary full" onClick={() => setActiveView("friends")}>
                <Users size={18} />
                Invite friends
              </button>
            </div>
          )}
          {ranking?.published && ranking.shareUrl && (
            <a className="public-link" href={appPath(ranking.shareUrl)}>
              <ExternalLink size={16} />
              View public ranking
            </a>
          )}

          <div className="ranking-actions">
            <button className="primary full" onClick={publishRanking} disabled={!ranking?.inviteGate?.unlocked || ranking?.published}>
              <Unlock size={18} />
              {ranking?.published ? "Published" : "Publish ranking"}
            </button>
            <button className="secondary full" onClick={createShareCard} disabled={!ranking?.published}>
              <Sparkles size={18} />
              Share card
            </button>
            <button className="secondary full" onClick={copyRanking} disabled={!ranking?.inviteGate?.unlocked}>
              <Copy size={18} />
              Copy share
            </button>
          </div>
        </div>
      </section>
      )}

      {activeView === "plan" && (
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
      </section>
      )}

      {activeView === "account" && (
        <section className="account-section">
          <div className="account-copy">
            <p className="eyebrow">Account</p>
            <h2>{profile ? `Signed in as ${profile.name}` : "Save your NightCap profile."}</h2>
            <p>Your profile lets NightCap remember your ratings, connect friend recommendations, and carry the same identity into the future mobile app.</p>
            <div className="profile-preview">
              {profileForm.profilePhoto ? <img src={profileForm.profilePhoto} alt="" /> : <UserRound size={32} />}
              <div>
                <strong>{profile?.name || profileForm.name || "Your profile"}</strong>
                <span>{profile?.hasPassword ? "Password saved" : "Password needed"}</span>
              </div>
            </div>
          </div>

          <form className="account-form" onSubmit={saveProfile}>
            <label className="photo-upload">
              <span>Profile picture</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleProfilePhoto} />
            </label>
            <label>
              <span>Name</span>
              <input value={profileForm.name} onChange={(event) => setProfileForm((form) => ({ ...form, name: event.target.value }))} placeholder="Your name" />
            </label>
            <label>
              <span>Email</span>
              <input value={profileForm.email} onChange={(event) => setProfileForm((form) => ({ ...form, email: event.target.value }))} placeholder="you@example.com" />
            </label>
            <label>
              <span>Phone</span>
              <input value={profileForm.phone} onChange={(event) => setProfileForm((form) => ({ ...form, phone: event.target.value }))} placeholder="+1 555 0100" />
            </label>
            <label>
              <span>{profile?.hasPassword ? "New password" : "Password"}</span>
              <input type="password" value={profileForm.password} onChange={(event) => setProfileForm((form) => ({ ...form, password: event.target.value }))} placeholder="At least 8 characters" autoComplete="new-password" />
            </label>
            <button className="primary full" type="submit">
              <UserRound size={18} />
              {profile ? "Update account" : "Sign up"}
            </button>
          </form>

          <div className="account-tools">
            <form className="password-form" onSubmit={requestPasswordReset}>
              <label>
                <span>Reset password</span>
                <input type="email" value={resetForm.contact} onChange={(event) => setResetForm((form) => ({ ...form, contact: event.target.value }))} placeholder="Account email" />
              </label>
              <button className="secondary full" type="submit">Send reset</button>
            </form>

            <form className="password-form" onSubmit={resetPassword}>
              <label>
                <span>Reset code</span>
                <input value={resetForm.token} onChange={(event) => setResetForm((form) => ({ ...form, token: event.target.value }))} placeholder="Paste reset code" />
              </label>
              <label>
                <span>New password</span>
                <input type="password" value={resetForm.password} onChange={(event) => setResetForm((form) => ({ ...form, password: event.target.value }))} placeholder="At least 8 characters" autoComplete="new-password" />
              </label>
              <button className="secondary full" type="submit">Reset password</button>
              {resetNotice && <p className="helper-text">{resetNotice}</p>}
            </form>
          </div>

          <form className="feedback-form" onSubmit={sendFeedback}>
            <label>
              <span>Send feedback</span>
              <textarea value={feedbackMessage} onChange={(event) => setFeedbackMessage(event.target.value)} placeholder="Tell us what broke, what felt off, or what should be better." />
            </label>
            <button className="secondary full" type="submit">
              <MessageSquare size={18} />
              Send feedback
            </button>
          </form>
        </section>
      )}

      {selectedVenue && (
        <RatingModal
          venue={selectedVenue}
          onClose={() => setSelectedVenue(null)}
          onSubmit={submitRating}
        />
      )}
      {detailVenue && (
        <VenueDetailModal
          venue={detailVenue}
          onClose={() => setDetailVenue(null)}
          onRate={(venue) => {
            setDetailVenue(null);
            setSelectedVenue(venue);
          }}
        />
      )}
    </main>
  );
}

function ActivationChecklist({ profile, progress, ranking, onNavigate }) {
  const steps = [
    { id: "profile", label: "Save profile", done: Boolean(profile), action: "Sign up", view: "account" },
    { id: "rate", label: "Rate one spot", done: (progress?.ratingCount ?? 0) > 0, action: "Find spots", view: "spots" },
    { id: "invite", label: "Invite friends", done: (progress?.inviteCount ?? 0) >= 3, action: "Invite", view: "friends" },
    { id: "share", label: "Publish ranking", done: Boolean(ranking?.published), action: "Share", view: "ranking" }
  ];
  const completed = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done) || steps[steps.length - 1];

  return (
    <section className="activation-strip" aria-label="Getting started">
      <div className="activation-copy">
        <p className="eyebrow">Start here</p>
        <strong>{completed === steps.length ? "Your NightCap graph is live." : "Build your nightlife graph."}</strong>
        <span>{completed}/{steps.length} complete</span>
      </div>
      <div className="activation-steps">
        {steps.map((step) => (
          <button key={step.id} type="button" className={step.done ? "activation-step done" : "activation-step"} onClick={() => onNavigate(step.view)}>
            <span>{step.done ? "✓" : ""}</span>
            {step.label}
          </button>
        ))}
      </div>
      <button type="button" className="primary activation-cta" onClick={() => onNavigate(nextStep.view)}>
        {nextStep.action}
      </button>
    </section>
  );
}

function plannerVenuePayload(venue) {
  return {
    id: venue.id,
    canonicalVenueKey: venue.canonicalVenueKey,
    name: venue.name,
    address: venue.address,
    neighborhood: venue.neighborhood,
    city: venue.city,
    types: venue.types || [],
    location: venue.location,
    googleRating: venue.googleRating ?? null,
    overallScore: venue.overallScore ?? null,
    ratingCount: venue.ratingCount || 0,
    saved: Boolean(venue.saved),
    categoryScores: venue.categoryScores || {}
  };
}

function venueDisplayScore(venue) {
  if (venue.overallScore !== null && venue.overallScore !== undefined) {
    return { value: venue.overallScore, label: "NightCap" };
  }
  if (venue.yelpRating !== null && venue.yelpRating !== undefined) {
    return { value: venue.yelpRating, label: "Yelp" };
  }
  if (venue.googleRating !== null && venue.googleRating !== undefined) {
    return { value: venue.googleRating, label: "Reviews" };
  }
  return { value: null, label: "Unrated" };
}

function ContactGraph({ graph, onInvite }) {
  const recommendations = graph?.recommendations ?? [];
  const onApp = graph?.onApp ?? [];

  return (
    <div className="contact-graph">
      <div className="contact-stat">
        <strong>{graph?.importedCount ?? 0}</strong>
        <span>contacts checked</span>
      </div>
      <div className="contact-stat">
        <strong>{onApp.length}</strong>
        <span>already on NightCap</span>
      </div>
      <div className="contact-stat">
        <strong>{recommendations.length}</strong>
        <span>recommended invites</span>
      </div>

      <div className="contact-list">
        <h3>Already here</h3>
        {(onApp.length ? onApp : []).slice(0, 4).map((friend) => (
          <div className="contact-row active" key={friend.id}>
            <span>{friend.name || friend.contact}</span>
            <small>{friend.memberName || "NightCap member"}</small>
          </div>
        ))}
        {!onApp.length && <p className="helper-text">Import contacts to find friends already on NightCap.</p>}
      </div>

      <div className="contact-list">
        <h3>Invite next</h3>
        {(recommendations.length ? recommendations : []).slice(0, 4).map((friend) => (
          <div className="contact-row" key={friend.id}>
            <span>{friend.name || friend.contact}</span>
            <small>{friend.mutualMembers.length ? `${friend.mutualMembers.map((member) => member.name).join(", ")} also ${friend.mutualMembers.length === 1 ? "has" : "have"} NightCap` : "Not on NightCap yet"}</small>
            <button className="secondary" type="button" onClick={() => onInvite(friend)} disabled={friend.alreadyInvited}>
              <Send size={15} />
              {friend.alreadyInvited ? "Sent" : "Invite"}
            </button>
          </div>
        ))}
        {!recommendations.length && <p className="helper-text">Recommendations will appear when imported friends share mutual NightCap contacts.</p>}
      </div>
    </div>
  );
}

function sourceLabel(source, cacheStatus) {
  if (cacheStatus === "hit") return "Stored Maps data";
  if (source === "google-cache") return "Stored Maps data";
  if (source === "google") return "Google Places";
  return "Seed fallback";
}

function buildMapData(venues) {
  const points = venues
    .map((venue) => ({
      id: venue.id,
      name: venue.name,
      city: venue.city,
      lat: Number(venue.location?.lat),
      lng: Number(venue.location?.lng),
      score: venue.overallScore ?? venue.googleRating ?? null,
      source: venue.source || "client",
      photoUrl: venue.photoUrl || null
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  if (!points.length) return { points: [], bounds: null };
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const latPad = Math.max(0.002, (Math.max(...lats) - Math.min(...lats)) * 0.18);
  const lngPad = Math.max(0.002, (Math.max(...lngs) - Math.min(...lngs)) * 0.18);
  return {
    points,
    bounds: {
      north: Math.max(...lats) + latPad,
      south: Math.min(...lats) - latPad,
      east: Math.max(...lngs) + lngPad,
      west: Math.min(...lngs) - lngPad
    }
  };
}

function VenueMap({ mapData, venues, onVisibleVenuesChange }) {
  const [activeId, setActiveId] = useState(null);
  const [locationStatus, setLocationStatus] = useState("");
  const userMarkerRef = useRef(null);
  const mapRef = useRef(null);
  const mapNodeRef = useRef(null);
  const markerLayerRef = useRef(null);
  const points = mapData?.points ?? [];
  const activePoint = points.find((point) => point.id === activeId) || points[0];
  const venueById = new Map(venues.map((venue) => [venue.id, venue]));

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;
    mapRef.current = L.map(mapNodeRef.current, {
      zoomControl: false,
      scrollWheelZoom: true,
      touchZoom: "center",
      dragging: true,
      tap: true,
      bounceAtZoomLimits: false,
      zoomSnap: 0.25
    }).setView([40.7128, -74.0060], 12);
    mapRef.current.touchZoom.enable();
    mapRef.current.dragging.enable();
    mapRef.current.scrollWheelZoom.enable();
    mapNodeRef.current.__nightcapMap = mapRef.current;
    mapNodeRef.current.__nightcapPinchMoves = 0;
    const mapNode = mapNodeRef.current;
    let pinchState = null;
    const activePointers = new Map();
    function keepPinchOnMap(event) {
      if (event.touches?.length > 1) {
        event.preventDefault();
      }
    }
    function touchDistance(touches) {
      const first = touches[0];
      const second = touches[1];
      return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    }
    function touchCenter(touches) {
      const first = touches[0];
      const second = touches[1];
      const rect = mapNode.getBoundingClientRect();
      return L.point(((first.clientX + second.clientX) / 2) - rect.left, ((first.clientY + second.clientY) / 2) - rect.top);
    }
    function handlePinchStart(event) {
      if (event.touches.length !== 2 || !mapRef.current) return;
      pinchState = {
        distance: touchDistance(event.touches),
        zoom: mapRef.current.getZoom()
      };
    }
    function handlePinchMove(event) {
      if (event.touches.length !== 2 || !pinchState || !mapRef.current) return;
      event.preventDefault();
      const nextDistance = touchDistance(event.touches);
      if (!pinchState.distance || !nextDistance) return;
      const zoomDelta = Math.log2(nextDistance / pinchState.distance);
      const nextZoom = Math.max(mapRef.current.getMinZoom(), Math.min(mapRef.current.getMaxZoom(), pinchState.zoom + zoomDelta));
      mapNode.__nightcapPinchMoves += 1;
      mapRef.current.setZoom(nextZoom, { animate: false });
    }
    function handlePinchEnd(event) {
      if (event.touches.length < 2) pinchState = null;
    }
    function pointerDistance() {
      const pointers = Array.from(activePointers.values());
      if (pointers.length < 2) return 0;
      return Math.hypot(pointers[1].clientX - pointers[0].clientX, pointers[1].clientY - pointers[0].clientY);
    }
    function pointerCenter() {
      const pointers = Array.from(activePointers.values());
      const rect = mapNode.getBoundingClientRect();
      return L.point(((pointers[0].clientX + pointers[1].clientX) / 2) - rect.left, ((pointers[0].clientY + pointers[1].clientY) / 2) - rect.top);
    }
    function handlePointerDown(event) {
      if (event.pointerType !== "touch") return;
      activePointers.set(event.pointerId, event);
      if (activePointers.size === 2 && mapRef.current) {
        pinchState = {
          distance: pointerDistance(),
          zoom: mapRef.current.getZoom()
        };
      }
    }
    function handlePointerMove(event) {
      if (event.pointerType !== "touch" || !activePointers.has(event.pointerId)) return;
      activePointers.set(event.pointerId, event);
      if (activePointers.size !== 2 || !pinchState || !mapRef.current) return;
      event.preventDefault();
      const nextDistance = pointerDistance();
      if (!pinchState.distance || !nextDistance) return;
      const zoomDelta = Math.log2(nextDistance / pinchState.distance);
      const nextZoom = Math.max(mapRef.current.getMinZoom(), Math.min(mapRef.current.getMaxZoom(), pinchState.zoom + zoomDelta));
      mapNode.__nightcapPinchMoves += 1;
      mapRef.current.setZoom(nextZoom, { animate: false });
    }
    function handlePointerEnd(event) {
      activePointers.delete(event.pointerId);
      if (activePointers.size < 2) pinchState = null;
    }
    mapNode.addEventListener("touchmove", keepPinchOnMap, { passive: false });
    mapNode.addEventListener("touchstart", handlePinchStart, { passive: true });
    mapNode.addEventListener("touchmove", handlePinchMove, { passive: false });
    mapNode.addEventListener("touchend", handlePinchEnd, { passive: true });
    mapNode.addEventListener("touchcancel", handlePinchEnd, { passive: true });
    mapNode.addEventListener("pointerdown", handlePointerDown, { passive: true });
    mapNode.addEventListener("pointermove", handlePointerMove, { passive: false });
    mapNode.addEventListener("pointerup", handlePointerEnd, { passive: true });
    mapNode.addEventListener("pointercancel", handlePointerEnd, { passive: true });
    L.control.zoom({ position: "bottomright" }).addTo(mapRef.current);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(mapRef.current);
    markerLayerRef.current = L.layerGroup().addTo(mapRef.current);

    return () => {
      mapNode.removeEventListener("touchmove", keepPinchOnMap);
      mapNode.removeEventListener("touchstart", handlePinchStart);
      mapNode.removeEventListener("touchmove", handlePinchMove);
      mapNode.removeEventListener("touchend", handlePinchEnd);
      mapNode.removeEventListener("touchcancel", handlePinchEnd);
      mapNode.removeEventListener("pointerdown", handlePointerDown);
      mapNode.removeEventListener("pointermove", handlePointerMove);
      mapNode.removeEventListener("pointerup", handlePointerEnd);
      mapNode.removeEventListener("pointercancel", handlePointerEnd);
      delete mapNode.__nightcapMap;
      mapRef.current?.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerLayerRef.current) return;
    markerLayerRef.current.clearLayers();
    for (const point of points) {
      const venue = venueById.get(point.id);
      const latLng = L.latLng(point.lat, point.lng);
      const marker = L.circleMarker(latLng, {
        radius: point.id === activePoint?.id ? 9 : 7,
        color: "#f8eef6",
        weight: 2,
        fillColor: point.id === activePoint?.id ? "#e86aa7" : "#b994ff",
        fillOpacity: 0.92
      });
      marker.bindPopup(`<strong>${escapeHtml(point.name)}</strong><br>${escapeHtml(venue?.address || point.city || "NightCap venue")}`);
      marker.on("click", () => setActiveId(point.id));
      marker.addTo(markerLayerRef.current);
    }
  }, [points, activePoint?.id, venues]);

  useEffect(() => {
    if (!mapRef.current) return;
    function updateVisibleVenues() {
      if (!mapRef.current) return;
      const bounds = mapRef.current.getBounds();
      const visibleIds = points
        .filter((point) => bounds.contains([point.lat, point.lng]))
        .map((point) => point.id);
      onVisibleVenuesChange(visibleIds);
    }
    mapRef.current.on("moveend zoomend", updateVisibleVenues);
    setTimeout(updateVisibleVenues, 0);
    return () => {
      mapRef.current?.off("moveend zoomend", updateVisibleVenues);
    };
  }, [points, onVisibleVenuesChange]);

  useEffect(() => {
    if (!mapRef.current) return;
    const latLngs = denseMapLatLngs(points);
    if (latLngs.length === 1) {
      mapRef.current.setView(latLngs[0], 14);
    } else if (latLngs.length > 1) {
      setTimeout(() => {
        mapRef.current?.invalidateSize();
        mapRef.current?.fitBounds(L.latLngBounds(latLngs), { padding: [34, 34], maxZoom: 15 });
        setTimeout(() => {
          if (!mapRef.current) return;
          const bounds = mapRef.current.getBounds();
          onVisibleVenuesChange(points.filter((point) => bounds.contains([point.lat, point.lng])).map((point) => point.id));
        }, 0);
      }, 0);
    }
  }, [points, onVisibleVenuesChange]);

  function centerToUserLocation() {
    if (!navigator.geolocation || !mapRef.current) {
      setLocationStatus("Location unavailable");
      return;
    }
    setLocationStatus("Locating...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latLng = L.latLng(position.coords.latitude, position.coords.longitude);
        if (!userMarkerRef.current) {
          userMarkerRef.current = L.circleMarker(latLng, {
            radius: 8,
            color: "#f8eef6",
            weight: 2,
            fillColor: "#e86aa7",
            fillOpacity: 1
          }).addTo(mapRef.current);
        } else {
          userMarkerRef.current.setLatLng(latLng);
        }
        mapRef.current.setView(latLng, 15, { animate: true });
        setLocationStatus("Centered");
      },
      () => setLocationStatus("Location blocked"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }

  return (
    <div className="venue-map" aria-label="Stored venue map">
      <div className="map-canvas" ref={mapNodeRef} />
      <div className="map-side">
        <p className="eyebrow"><Database size={14} /> Cached map</p>
        <h3>{activePoint?.name || "No mapped venues yet"}</h3>
        <p>{activePoint ? venueById.get(activePoint.id)?.address || activePoint.city : "Search a launch city to populate stored coordinates."}</p>
        <div className="map-meta">
          <span>{points.length} points</span>
          <span>{activePoint?.source || "stored"}</span>
        </div>
        <button className="secondary full" type="button" onClick={centerToUserLocation}>
          <MapPin size={17} />
          Center my location
        </button>
        {locationStatus && <small className="map-status">{locationStatus}</small>}
      </div>
    </div>
  );
}

function denseMapLatLngs(points) {
  const validPoints = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (validPoints.length <= 30) return validPoints.map((point) => L.latLng(point.lat, point.lng));
  const lats = validPoints.map((point) => point.lat).sort((a, b) => a - b);
  const lngs = validPoints.map((point) => point.lng).sort((a, b) => a - b);
  const lowIndex = Math.floor(validPoints.length * 0.05);
  const highIndex = Math.ceil(validPoints.length * 0.95) - 1;
  const south = lats[lowIndex];
  const north = lats[highIndex];
  const west = lngs[lowIndex];
  const east = lngs[highIndex];
  return validPoints
    .filter((point) => point.lat >= south && point.lat <= north && point.lng >= west && point.lng <= east)
    .map((point) => L.latLng(point.lat, point.lng));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function PublicRankingPage({ handle, slug }) {
  const [ranking, setRanking] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadPublicRanking() {
      try {
        const response = await fetch(appPath(`/api/u/${encodeURIComponent(handle)}/rankings/${encodeURIComponent(slug)}`));
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Ranking unavailable");
        setRanking(data);
      } catch (loadError) {
        setError(loadError.message);
      }
    }

    loadPublicRanking();
  }, [handle, slug]);

  return (
    <main className="app public-page">
      <section className="public-hero">
        <p className="eyebrow"><Moon size={14} /> NightCap public ranking</p>
        <h1>{handle}'s nightlife ranking</h1>
        <p className="lede">A public NightCap list unlocked through friends, ratings, and actual nightlife taste.</p>
        <a className="secondary public-home" href={appPath("/")}>
          <ExternalLink size={17} />
          Build your ranking
        </a>
      </section>

      {error && (
        <div className="banner error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="public-ranking-board">
        {(ranking?.ranking ?? []).map((venue, index) => (
          <article className="public-rank-row" key={`${venue.name}-${index}`}>
            <span>{index + 1}</span>
            <div>
              <h2>{venue.name}</h2>
              <p>{venue.address || venue.city || "NightCap venue"}</p>
              {venue.comment && <small>{venue.comment}</small>}
            </div>
            <strong>{venue.overallScore}</strong>
          </article>
        ))}
        {ranking && !ranking.ranking.length && (
          <p className="helper-text">This ranking is public, but it needs a few ratings before the list fills in.</p>
        )}
      </section>
    </main>
  );
}

function VenueCard({ venue, loadPhoto, onOpen, onRate, onSave }) {
  const displayScore = venueDisplayScore(venue);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name} ${venue.address || venue.city}`)}`;
  const websiteUrl = venue.websiteUrl || `https://www.google.com/search?q=${encodeURIComponent(`${venue.name} ${venue.address || venue.city} official website`)}`;
  return (
    <article className="venue-card">
      <div
        className="venue-photo"
        role="button"
        tabIndex={0}
        onClick={() => onOpen(venue)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onOpen(venue);
        }}
        aria-label={`View ${venue.name} details`}
      >
        {venue.photoUrl && loadPhoto && <img src={appPath(venue.photoUrl)} alt="" loading="lazy" decoding="async" />}
        <span className="photo-action">View details</span>
        <button className={venue.saved ? "icon saved" : "icon"} onClick={(event) => {
          event.stopPropagation();
          onSave(venue);
        }} aria-label="Save venue">
          <Bookmark size={18} />
        </button>
      </div>
      <div className="venue-body">
        <div className="venue-title">
          <div>
            <h3>{venue.name}</h3>
            <p><MapPin size={14} /> {venue.neighborhood || venue.address}</p>
          </div>
          <div className="score">
            <b>{displayScore.value ?? "New"}</b>
            <small>{displayScore.label}</small>
          </div>
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
          <a className="secondary full link-button" href={websiteUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={17} />
            Website
          </a>
          <a className="secondary full link-button" href={mapsUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={17} />
            Map
          </a>
        </div>
      </div>
    </article>
  );
}

function VenueDetailModal({ venue, onClose, onRate }) {
  const titleId = useId();
  const displayScore = venueDisplayScore(venue);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name} ${venue.address || venue.city}`)}`;
  const websiteUrl = venue.websiteUrl || `https://www.google.com/search?q=${encodeURIComponent(`${venue.name} ${venue.address || venue.city} official website`)}`;

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <article className="modal venue-detail-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="venue-detail-photo">
          {venue.photoUrl && <img src={appPath(venue.photoUrl)} alt="" loading="eager" decoding="async" />}
        </div>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Venue details</p>
            <h2 id={titleId}>{venue.name}</h2>
            <p className="detail-address"><MapPin size={15} /> {venue.address || venue.city || "NightCap venue"}</p>
          </div>
          <button type="button" className="close" onClick={onClose}>Close</button>
        </div>

        <div className="detail-stats">
          <span><b>{displayScore.value ?? "New"}</b> {displayScore.label}</span>
          <span><b>{venue.ratingCount || 0}</b> NightCap ratings</span>
          <span><b>{venue.yelpReviewCount ?? venue.userRatingCount ?? "-"}</b> external reviews</span>
        </div>

        <div className="mini-scores detail-scores">
          {categories.map((category) => (
            <span key={category.key}>{category.label} <b>{venue.categoryScores?.[category.key] ?? "-"}</b></span>
          ))}
        </div>

        {venue.types?.length > 0 && (
          <div className="detail-tags">
            {venue.types.slice(0, 8).map((type) => <span key={type}>{type.replace(/_/g, " ")}</span>)}
          </div>
        )}

        {venue.recentComments?.length > 0 && (
          <div className="detail-comments">
            <h3>Recent notes</h3>
            {venue.recentComments.map((comment) => (
              <p key={`${comment.createdAt}-${comment.comment}`}><MessageSquare size={14} /> {comment.comment}</p>
            ))}
          </div>
        )}

        <div className="venue-actions detail-actions">
          <button className="primary full" onClick={() => onRate(venue)}>
            <Star size={17} />
            Rate
          </button>
          <a className="secondary full link-button" href={websiteUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={17} />
            Website
          </a>
          <a className="secondary full link-button" href={mapsUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={17} />
            Map
          </a>
        </div>
      </article>
    </div>
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

  function resetScore(key) {
    setOptionalScores((scores) => {
      const nextScores = { ...scores };
      delete nextScores[`${key}Score`];
      return nextScores;
    });
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
            <div key={category.key} className={optionalScores[`${category.key}Score`] === undefined ? "category-rating blank" : "category-rating"}>
              <div className="category-rating-head">
                <span>{category.label}</span>
                {optionalScores[`${category.key}Score`] === undefined ? (
                  <button type="button" className="secondary mini-button" onClick={() => updateScore(category.key, 7)}>
                    Add
                  </button>
                ) : (
                  <button type="button" className="secondary mini-button" onClick={() => resetScore(category.key)}>
                    Reset
                  </button>
                )}
              </div>
              {optionalScores[`${category.key}Score`] === undefined ? (
                <small>Not rated</small>
              ) : (
                <label className="range compact" htmlFor={`${titleId}-${index}`}>
                  <span>{optionalScores[`${category.key}Score`]}</span>
                  <input id={`${titleId}-${index}`} aria-label={`${category.label} score`} type="range" min="1" max="10" step="0.1" value={optionalScores[`${category.key}Score`]} onChange={(event) => updateScore(category.key, event.target.value)} />
                </label>
              )}
            </div>
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
