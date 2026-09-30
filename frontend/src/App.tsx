import React, { useEffect, useState, useMemo } from "react";
import "./App.css";

// ── Types ─────────────────────────────────────────────────────────────────
export interface Movie {
  id: number;
  title: string;
  release_year: number | null;
  genres: string[] | null;
  original_language?: string | null;
  runtime_minutes: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  tmdb_rating: number | null;
  popularity: number | null;
  overview?: string | null;
  cast?: { name: string; character?: string }[] | null;
  directors?: { name: string; job?: string }[] | null;
  score?: number | null;
  strategy?: string | null;
  reason?: string | null;
}

interface FeedResponse {
  user_id: string | null;
  cold_start_tier: "new" | "sparse" | "mature";
  experiment_name?: string | null;
  experiment_variant?: string | null;
  recommended_for_you: Movie[];
  trending_now: Movie[];
  top_rated: Movie[];
  because_you_watched: {
    source_movie_title: string;
    source_movie_id: number;
    movies: Movie[];
  } | null;
}

interface MlopsStatus {
  phase: string;
  mode?: string;
  feature_store: {
    movie_features_count: number;
    user_features_count: number;
    engine: string;
    version: string;
  };
  ab_testing: {
    registered_experiments: string[];
    total_telemetry_logs: number;
  };
  mlflow: {
    tracking_uri: string;
    experiment_name: string;
    backend: string;
  };
}

interface ABExperimentMetrics {
  experiment_name: string;
  variants: Record<
    string,
    {
      impressions: number;
      conversions: number;
      conversion_rate: number;
      relative_lift_pct?: number;
      events_breakdown?: Record<string, number>;
    }
  >;
  generated_at: string;
}

interface MLflowRun {
  run_id: string;
  run_name: string;
  status: string;
  params: Record<string, any>;
  metrics: Record<string, number>;
  tags: Record<string, string>;
}

interface UserInsights {
  user_id: string;
  interaction_count: number;
  cold_start_tier: "new" | "sparse" | "mature";
  watched_count: number;
  liked_count: number;
  disliked_count: number;
  watchlist_count: number;
  top_genres: { genre: string; count: number }[];
  recent_activity: {
    event_type: string;
    movie_id: number;
    movie_title: string;
    poster_path: string | null;
    release_year: number | null;
    occurred_at: string;
  }[];
}

export interface ArchiveItem {
  movie_id: number;
  title: string;
  release_year: number | null;
  genres: string[] | null;
  runtime_minutes: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  tmdb_rating: number | null;
  overview: string | null;
  status: string;
  is_watched: boolean;
  is_liked: boolean;
  is_watchlist: boolean;
  interacted_at: string;
}

export interface UserProfile {
  id: string;
  username: string;
  cold_start_tier: string;
  interaction_count: number;
  watched_count: number;
  liked_count: number;
  created_at: string;
}

export interface CuratorMovieCard {
  id: number;
  title: string;
  release_year: number | null;
  genres: string[] | null;
  runtime_minutes: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  tmdb_rating: number | null;
  overview: string | null;
  curator_rationale: string;
}

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const API_BASE =
  (import.meta.env.VITE_API_URL as string) ||
  (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:8000"
    : "https://movie-intelligence-platform-nqk7.onrender.com");

// Curated critical reception quotes for A24 editorial style
const EDITORIAL_QUOTES = [
  { publication: "The Playlist", quote: "Something Far More Haunting", stars: 5 },
  { publication: "Variety", quote: "One Of The Year’s Masterpieces", stars: 5 },
  { publication: "The Guardian", quote: "Thrilling Directness And Storytelling Force", stars: 5 },
  { publication: "Rolling Stone", quote: "Storytelling Chops, Nerve And Verve", stars: 5 },
  { publication: "The Daily Beast", quote: "Casts A Surrealistic Spell", stars: 5 },
  { publication: "Time", quote: "Devastating In The Quietest Way", stars: 5 },
  { publication: "Slashfilm", quote: "An Unforgettable, Hypnotic Triumph", stars: 5 },
  { publication: "IndieWire", quote: "Visionary, Uncompromising Cinema", stars: 5 },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<"films" | "explore" | "archive" | "intelligence" | "ai">("films");
  const [showIndex, setShowIndex] = useState(false);
  const [userId, setUserId] = useState<string>(() => localStorage.getItem("showdyme_user_id") || "");
  const [currentUsername, setCurrentUsername] = useState<string>(
    () => localStorage.getItem("showdyme_username") || ""
  );
  const [showAccountModal, setShowAccountModal] = useState<boolean>(
    () => !localStorage.getItem("showdyme_username")
  );
  const [newUsernameInput, setNewUsernameInput] = useState("");

  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [insights, setInsights] = useState<UserInsights | null>(null);
  const [catalog, setCatalog] = useState<Movie[]>([]);
  const [featuredMovie, setFeaturedMovie] = useState<Movie | null>(null);
  const [selectedModalMovie, setSelectedModalMovie] = useState<Movie | null>(null);
  const [similarMovies, setSimilarMovies] = useState<Movie[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // Archive state
  const [archiveFilter, setArchiveFilter] = useState<"all" | "watched" | "liked" | "watchlist">("all");
  const [archiveItems, setArchiveItems] = useState<ArchiveItem[]>([]);
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);

  // Explore filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [exploreMovies, setExploreMovies] = useState<Movie[]>([]);

  // Phase 6 MLOps State
  const [mlopsStatus, setMlopsStatus] = useState<MlopsStatus | null>(null);
  const [abMetrics, setAbMetrics] = useState<ABExperimentMetrics | null>(null);
  const [mlflowRuns, setMlflowRuns] = useState<MLflowRun[]>([]);
  const [isSyncingFeatures, setIsSyncingFeatures] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // AI Curator Grounded RAG Chat
  const [aiPrompt, setAiPrompt] = useState("");
  const [isCuratorLoading, setIsCuratorLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    {
      role: "user" | "curator";
      text: string;
      taste_summary?: string;
      detected_genres?: string[];
      movies?: CuratorMovieCard[];
    }[]
  >([
    {
      role: "curator",
      text: "Welcome to the ShowDyme AI Curator. I analyze your logged taste profile from your Personal Archive alongside our curated cinema intelligence catalog to provide grounded, bespoke recommendations.",
      taste_summary: "Taste DNA: Active & Learning",
    },
  ]);

  // Toast Notification
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // Fetch Archive
  const fetchArchive = async (uid: string, filter: string = "all") => {
    setIsArchiveLoading(true);
    try {
      const url = `${API_BASE}/api/v1/interactions/user/${uid}/archive${filter !== "all" ? `?filter_type=${filter}` : ""}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setArchiveItems(data);
      }
    } catch (e) {
      console.error("Failed to load archive", e);
    } finally {
      setIsArchiveLoading(false);
    }
  };

  // Login or Register by username
  const loginOrSwitchUser = async (rawUsername: string) => {
    const clean = rawUsername.trim().toLowerCase();
    if (!clean) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/login-or-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: clean }),
      });
      if (res.ok) {
        const userProf = await res.json();
        setUserId(userProf.id);
        setCurrentUsername(userProf.username);
        localStorage.setItem("showdyme_user_id", userProf.id);
        localStorage.setItem("showdyme_username", userProf.username);
        setShowAccountModal(false);
        setNewUsernameInput("");
        showToast(`Connected as @${userProf.username}`);
        refreshData(userProf.id);
        fetchArchive(userProf.id, archiveFilter);
      } else {
        showToast("Error registering or switching user.");
      }
    } catch {
      showToast("Could not connect to user account service.");
    }
  };

  // Persistent user identity on startup — prompt login if not authenticated
  useEffect(() => {
    const storedUsername = localStorage.getItem("showdyme_username");
    if (storedUsername) {
      loginOrSwitchUser(storedUsername);
    } else {
      setShowAccountModal(true);
    }
  }, []);

  // When archive filter changes
  useEffect(() => {
    if (userId) {
      fetchArchive(userId, archiveFilter);
    }
  }, [archiveFilter, userId]);

  // Fetch Feed & Insights
  const refreshData = async (uid: string) => {
    try {
      const [feedRes, insightsRes, catalogRes, mlopsRes, abRes, runsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/recommendations?user_id=${uid}&limit=12`),
        fetch(`${API_BASE}/api/v1/interactions/user/${uid}/insights`),
        fetch(`${API_BASE}/api/v1/movies?page_size=100`),
        fetch(`${API_BASE}/api/v1/mlops/status`),
        fetch(`${API_BASE}/api/v1/mlops/experiments/recommender_hybrid_v1`),
        fetch(`${API_BASE}/api/v1/mlops/models/runs?limit=5`),
      ]);

      if (feedRes.ok) {
        const feedData = await feedRes.json();
        setFeed(feedData);
        if (!featuredMovie && feedData.recommended_for_you?.length > 0) {
          setFeaturedMovie(feedData.recommended_for_you[0]);
        }
      }
      if (insightsRes.ok) {
        const insightsData = await insightsRes.json();
        setInsights(insightsData);
      }
      if (catalogRes.ok) {
        const catalogData = await catalogRes.json();
        setCatalog(catalogData.results);
      }
      if (mlopsRes.ok) {
        const mlopsData = await mlopsRes.json();
        setMlopsStatus(mlopsData);
      }
      if (abRes.ok) {
        const abData = await abRes.json();
        setAbMetrics(abData);
      }
      if (runsRes.ok) {
        const runsData = await runsRes.json();
        setMlflowRuns(runsData);
      }
    } catch (err) {
      console.error("Failed to load catalog:", err);
    }
  };

  const handleSyncFeatures = async () => {
    setIsSyncingFeatures(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/mlops/features/sync`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        showToast(`Feature Store: ${data.movies_synced} movies & ${data.users_synced} users synced`);
        if (userId) refreshData(userId);
      }
    } catch {
      showToast("Feature sync failed");
    } finally {
      setIsSyncingFeatures(false);
    }
  };

  const handleRunEvaluation = async () => {
    setIsEvaluating(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/mlops/models/evaluate?k=10`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        showToast(`Offline Evaluation: Precision@10: ${data.metrics.precision_at_k.toFixed(3)}, NDCG@10: ${data.metrics.ndcg_at_k.toFixed(3)}`);
        if (userId) refreshData(userId);
      }
    } catch {
      showToast("Evaluation failed");
    } finally {
      setIsEvaluating(false);
    }
  };

  // Record Interaction
  const handleInteraction = async (
    movieId: number,
    eventType: "watched" | "liked" | "disliked" | "watchlist"
  ) => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          movie_id: movieId,
          event_type: eventType,
          source: "web_ui",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const actionLabels: Record<string, string> = {
          watched: "Recorded to Personal Archive",
          liked: "Affinity signal registered (+1 Like)",
          disliked: "Negative signal registered (-1)",
          watchlist: "Bookmarked to Watchlist",
        };
        showToast(`${actionLabels[eventType]} • Tier: ${data.cold_start_tier.toUpperCase()}`);
        refreshData(userId);
        fetchArchive(userId, archiveFilter);
      }
    } catch {
      showToast("Failed to record interaction");
    }
  };

  // Explore search & filter
  useEffect(() => {
    const fetchExplore = async () => {
      try {
        let url = `${API_BASE}/api/v1/movies?page_size=60`;
        if (searchQuery.trim()) {
          url += `&q=${encodeURIComponent(searchQuery.trim())}`;
        }
        if (selectedGenre) {
          url += `&genre=${encodeURIComponent(selectedGenre)}`;
        }
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setExploreMovies(data.results);
        }
      } catch (err) {
        console.error("Explore fetch failed", err);
      }
    };

    const timer = setTimeout(fetchExplore, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedGenre]);

  // Modal & Similar movies
  const openMovieModal = async (movie: Movie) => {
    setSelectedModalMovie(movie);
    try {
      const res = await fetch(`${API_BASE}/api/v1/movies/${movie.id}`);
      if (res.ok) {
        const fullDetail = await res.json();
        setSelectedModalMovie(fullDetail);
      }
      const simRes = await fetch(`${API_BASE}/api/v1/recommendations?user_id=${userId}&limit=5`);
      if (simRes.ok) {
        const simData = await simRes.json();
        setSimilarMovies(simData.top_rated.filter((m: Movie) => m.id !== movie.id).slice(0, 4));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const editorialQuote = useMemo(() => {
    if (!featuredMovie) return EDITORIAL_QUOTES[0];
    return EDITORIAL_QUOTES[featuredMovie.id % EDITORIAL_QUOTES.length];
  }, [featuredMovie]);

  // AI Curator RAG submit
  const handleAiSubmit = async (e?: React.FormEvent, directPrompt?: string) => {
    if (e) e.preventDefault();
    const query = directPrompt || aiPrompt.trim();
    if (!query) return;

    if (!directPrompt) setAiPrompt("");
    setChatMessages((prev) => [...prev, { role: "user", text: query }]);
    setIsCuratorLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/v1/curator/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query,
          user_id: userId || null,
          limit: 3,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setChatMessages((prev) => [
          ...prev,
          {
            role: "curator",
            text: data.reply_text,
            taste_summary: data.user_taste_summary,
            detected_genres: data.detected_genres,
            movies: data.movies,
          },
        ]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "curator",
            text: "The catalog intelligence network is currently recalibrating. Please try a different inquiry.",
          },
        ]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "curator", text: "Unable to query the intelligence catalog at this time." },
      ]);
    } finally {
      setIsCuratorLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* ── Top Header ── */}
      <header className="nav-header">
        <div className="nav-brand" onClick={() => { setActiveTab("films"); setShowIndex(false); }} title="ShowDyme — Movie Intelligence">
          <div className="showdyme-brand-lockup">
            <img src="/showdyme-coin-gold.png" alt="ShowDyme" className="showdyme-emblem" />
            <span className="showdyme-wordmark">
              Show<span className="showdyme-wordmark-accent">Dyme</span>
            </span>
          </div>
        </div>

        <nav className="nav-menu">
          <button
            className={`nav-item ${activeTab === "films" && !showIndex ? "active" : ""}`}
            onClick={() => { setActiveTab("films"); setShowIndex(false); }}
          >
            Films
          </button>
          <button
            className={`nav-item ${activeTab === "explore" && !showIndex ? "active" : ""}`}
            onClick={() => { setActiveTab("explore"); setShowIndex(false); }}
          >
            Explore
          </button>
          <button
            className={`index-btn ${showIndex ? "active" : ""}`}
            onClick={() => setShowIndex(!showIndex)}
          >
            Index ▾
          </button>
          <button
            className={`nav-item ${activeTab === "archive" && !showIndex ? "active" : ""}`}
            onClick={() => { setActiveTab("archive"); setShowIndex(false); }}
          >
            My Archive
          </button>
          <button
            className={`nav-item ${activeTab === "intelligence" && !showIndex ? "active" : ""}`}
            onClick={() => { setActiveTab("intelligence"); setShowIndex(false); }}
          >
            Intelligence
          </button>
          <button
            className={`nav-item ${activeTab === "ai" && !showIndex ? "active" : ""}`}
            onClick={() => { setActiveTab("ai"); setShowIndex(false); }}
          >
            AI Curator
          </button>
        </nav>

        <div className="nav-right-meta">
          {feed?.experiment_variant && (
            <div className="tier-indicator" style={{ borderColor: "rgba(212, 163, 89, 0.5)", color: "var(--accent-gold)" }}>
              <span>EXP:</span>
              <span style={{ fontWeight: 600 }}>{feed.experiment_variant}</span>
            </div>
          )}

          {/* User Account / Persona Switcher */}
          <button
            className="user-profile-btn"
            onClick={() => setShowAccountModal(true)}
            title="Switch Persona / Account"
          >
            <span className="user-avatar-icon">👤</span>
            <span className="user-name-text">
              {currentUsername ? `@${currentUsername}` : "Sign In"}
            </span>
            <span className="user-tier-pill">{insights?.cold_start_tier || "new"} tier</span>
            <span className="user-caret">▾</span>
          </button>
        </div>
      </header>

      {/* ── User Account Modal (Mandatory on First Visit & Private) ── */}
      {showAccountModal && (
        <div
          className="account-modal-overlay"
          onClick={() => {
            if (userId && currentUsername) {
              setShowAccountModal(false);
            }
          }}
        >
          <div className="account-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="account-modal-header">
              <h2 className="account-modal-title">
                {userId && currentUsername ? "User Identity" : "Welcome to ShowDyme"}
              </h2>
              {userId && currentUsername && (
                <button className="a24-btn-secondary" onClick={() => setShowAccountModal(false)}>
                  [ Close ]
                </button>
              )}
            </div>

            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "20px", lineHeight: 1.6 }}>
              Enter your username to access or create your isolated <strong>Personal Archive</strong>, taste profile, and personalized recommendation models.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                loginOrSwitchUser(newUsernameInput);
              }}
              className="account-input-group"
            >
              <input
                type="text"
                className="account-input"
                placeholder="Enter username (e.g. varun, cinephile)..."
                value={newUsernameInput}
                onChange={(e) => setNewUsernameInput(e.target.value)}
                autoFocus
                required
              />
              <button type="submit" className="a24-btn-primary" style={{ padding: "0 22px" }}>
                {userId && currentUsername ? "Switch / Sign In" : "Enter Platform"}
              </button>
            </form>

            {currentUsername && (
              <div style={{ marginTop: "22px", paddingTop: "14px", borderTop: "1px solid var(--border-line)", fontSize: "0.82rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Currently active: <strong style={{ color: "#fff" }}>@{currentUsername}</strong></span>
                <span style={{ color: "var(--accent-gold)", textTransform: "uppercase", fontSize: "0.75rem" }}>
                  {insights?.cold_start_tier || "new"} tier
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Production Index Drawer ── */}
      {showIndex && (
        <div className="index-drawer">
          <div className="index-drawer-header">
            <h2 className="index-title">Production Index ({catalog.length}+ Titles)</h2>
            <button className="a24-btn-secondary" onClick={() => setShowIndex(false)}>
              [ Close Index ]
            </button>
          </div>
          <div className="index-list-grid">
            {catalog.map((film) => (
              <div
                key={film.id}
                className="index-link-item"
                onClick={() => {
                  setFeaturedMovie(film);
                  setShowIndex(false);
                  setActiveTab("films");
                }}
              >
                <span className="index-item-title">{film.title}</span>
                <span className="index-item-year">{film.release_year || "2026"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab 1: Films (Main Experience) ── */}
      {activeTab === "films" && !showIndex && (
        <>
          {featuredMovie && (
            <section className="films-hero-section">
              <div className="editorial-hero-grid">
                {/* Left Column: Dossier */}
                <div className="dossier-left">
                  <h1 className="hero-film-title">{featuredMovie.title}</h1>

                  <div className="meta-spec-block">
                    <span className="meta-label">DIRECTED BY</span>
                    <span className="meta-value">
                      {featuredMovie.directors?.[0]?.name || "Visionary Independent Director"}
                    </span>
                  </div>

                  <div className="meta-spec-block">
                    <span className="meta-label">YEAR</span>
                    <span className="meta-value">{featuredMovie.release_year || "2026"}</span>
                  </div>

                  <div className="meta-spec-block">
                    <span className="meta-label">STARRING</span>
                    <span className="meta-value">
                      {featuredMovie.cast?.slice(0, 3).map((c) => c.name).join(", ") || "Ensemble Cast"}
                    </span>
                  </div>

                  <div className="meta-spec-block">
                    <span className="meta-label">GENRES & RUNTIME</span>
                    <span className="meta-value">
                      {featuredMovie.genres?.join(", ") || "Cinema"} • {featuredMovie.runtime_minutes || 108}m
                    </span>
                  </div>

                  {featuredMovie.reason && (
                    <div className="meta-spec-block" style={{ marginTop: "16px", borderTop: "1px solid var(--border-line)", paddingTop: "12px" }}>
                      <span className="meta-label" style={{ color: "var(--accent-gold)" }}>RECOMMENDATION RATIONALE</span>
                      <span className="meta-value" style={{ fontStyle: "italic", fontSize: "0.85rem", color: "#a7f3d0" }}>
                        "{featuredMovie.reason}"
                      </span>
                    </div>
                  )}
                </div>

                {/* Center Column: Vinyl Disc */}
                <div className="experience-canvas-wrap">
                  <div
                    className="vinyl-disc"
                    onClick={() => openMovieModal(featuredMovie)}
                    title="Click for full film dossier"
                  >
                    <div className="vinyl-center-label">
                      {featuredMovie.poster_path ? (
                        <img
                          src={`${TMDB_IMAGE_BASE}/w500${featuredMovie.poster_path}`}
                          alt={featuredMovie.title}
                          className="center-label-art"
                        />
                      ) : (
                        <div style={{ color: "#fff", fontSize: "0.8rem", textAlign: "center", padding: "10px" }}>
                          {featuredMovie.title}
                        </div>
                      )}
                      <div className="spindle-hole" />
                    </div>
                  </div>
                  <span className="disc-hint-label">CLICK DISC FOR PRODUCTION DOSSIER</span>
                </div>

                {/* Right Column: Quotes & Actions */}
                <div className="editorial-right">
                  <div className="critic-quote-box">
                    <div className="star-rating">★★★★★</div>
                    <div className="quote-source">{editorialQuote.publication}</div>
                    <p className="quote-text">"{editorialQuote.quote}"</p>
                  </div>

                  <div className="hero-action-stack">
                    <button
                      className="a24-btn-primary"
                      onClick={() => handleInteraction(featuredMovie.id, "watched")}
                    >
                      [ MARK WATCHED ]
                    </button>
                    <button
                      className="a24-btn-secondary"
                      onClick={() => handleInteraction(featuredMovie.id, "watchlist")}
                    >
                      + ADD TO ARCHIVE
                    </button>
                    <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                      <button
                        className="a24-btn-secondary"
                        style={{ flex: 1 }}
                        onClick={() => handleInteraction(featuredMovie.id, "liked")}
                      >
                        LIKE
                      </button>
                      <button
                        className="a24-btn-secondary"
                        style={{ flex: 1 }}
                        onClick={() => handleInteraction(featuredMovie.id, "disliked")}
                      >
                        DISLIKE
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── Recommendations Row ── */}
          <section className="catalog-row-section">
            <div className="row-header-wrap">
              <h2 className="section-title">Recommended Selections</h2>
              <span className="meta-label">
                {insights?.cold_start_tier.toUpperCase() || "NEW"} HYBRID SYNTHESIS
              </span>
            </div>
            <div className="editorial-grid">
              {(feed?.recommended_for_you || []).map((film) => (
                <EditorialCard
                  key={film.id}
                  movie={film}
                  onSelect={() => setFeaturedMovie(film)}
                  onOpenModal={() => openMovieModal(film)}
                />
              ))}
            </div>
          </section>

          {/* ── Trending Row ── */}
          <section className="catalog-row-section">
            <div className="row-header-wrap">
              <h2 className="section-title">Trending Now</h2>
              <span className="meta-label">DECAYED VELOCITY POPULARITY</span>
            </div>
            <div className="editorial-grid">
              {(feed?.trending_now || []).map((film) => (
                <EditorialCard
                  key={film.id}
                  movie={film}
                  onSelect={() => setFeaturedMovie(film)}
                  onOpenModal={() => openMovieModal(film)}
                />
              ))}
            </div>
          </section>

          {/* ── Top Rated Row ── */}
          <section className="catalog-row-section">
            <div className="row-header-wrap">
              <h2 className="section-title">Critically Acclaimed</h2>
              <span className="meta-label">BAYESIAN RATING CONSENSUS</span>
            </div>
            <div className="editorial-grid">
              {(feed?.top_rated || []).map((film) => (
                <EditorialCard
                  key={film.id}
                  movie={film}
                  onSelect={() => setFeaturedMovie(film)}
                  onOpenModal={() => openMovieModal(film)}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {/* ── Tab 2: Explore Catalog ── */}
      {activeTab === "explore" && !showIndex && (
        <div className="explore-editorial-view">
          <div className="explore-header-row">
            <input
              type="text"
              className="search-editorial-input"
              placeholder="Search by title, director, theme..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="genre-pill-row">
              {["All", "Horror", "Science Fiction", "Drama", "Thriller", "Action", "Comedy", "Animation", "Crime"].map((g) => (
                <button
                  key={g}
                  className={`genre-pill ${selectedGenre === g || (g === "All" && !selectedGenre) ? "active" : ""}`}
                  onClick={() => setSelectedGenre(g === "All" ? null : g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="editorial-grid">
            {exploreMovies.map((film) => (
              <EditorialCard
                key={film.id}
                movie={film}
                onSelect={() => { setFeaturedMovie(film); setActiveTab("films"); }}
                onOpenModal={() => openMovieModal(film)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Tab 3: Personal Archive (Deduplicated & Filterable) ── */}
      {activeTab === "archive" && !showIndex && (
        <div className="explore-editorial-view">
          <div className="intelligence-header">
            <h1 className="intelligence-title">Personal Archive</h1>
            <p className="meta-label" style={{ marginTop: "8px" }}>
              USER: @{currentUsername} • {archiveItems.length} UNIQUE PRODUCTIONS LOGGED
            </p>
          </div>

          {/* Filter Pills */}
          <div className="archive-filter-bar">
            <button
              className={`archive-filter-pill ${archiveFilter === "all" ? "active" : ""}`}
              onClick={() => setArchiveFilter("all")}
            >
              All Records ({archiveItems.length})
            </button>
            <button
              className={`archive-filter-pill ${archiveFilter === "watched" ? "active" : ""}`}
              onClick={() => setArchiveFilter("watched")}
            >
              Watched ({insights?.watched_count || 0})
            </button>
            <button
              className={`archive-filter-pill ${archiveFilter === "liked" ? "active" : ""}`}
              onClick={() => setArchiveFilter("liked")}
            >
              Liked ({insights?.liked_count || 0})
            </button>
            <button
              className={`archive-filter-pill ${archiveFilter === "watchlist" ? "active" : ""}`}
              onClick={() => setArchiveFilter("watchlist")}
            >
              Watchlist ({insights?.watchlist_count || 0})
            </button>
          </div>

          {isArchiveLoading ? (
            <p style={{ color: "var(--text-muted)", padding: "40px 0" }}>Retrieving archive records...</p>
          ) : archiveItems.length === 0 ? (
            <p style={{ color: "var(--text-muted)", padding: "40px 0" }}>
              No productions logged in this archive view. Mark films as watched or liked from the collection to build your profile.
            </p>
          ) : (
            <div className="editorial-grid">
              {archiveItems.map((item) => (
                <div
                  key={item.movie_id}
                  className="editorial-film-card"
                  onClick={() => {
                    const m = catalog.find((c) => c.id === item.movie_id) || {
                      id: item.movie_id,
                      title: item.title,
                      release_year: item.release_year,
                      genres: item.genres,
                      runtime_minutes: item.runtime_minutes,
                      poster_path: item.poster_path,
                      backdrop_path: item.backdrop_path,
                      tmdb_rating: item.tmdb_rating,
                      popularity: 100,
                      overview: item.overview,
                    };
                    setFeaturedMovie(m);
                    setActiveTab("films");
                  }}
                >
                  <div className="card-poster-frame">
                    {item.poster_path ? (
                      <img src={`${TMDB_IMAGE_BASE}/w500${item.poster_path}`} alt={item.title} className="editorial-poster-img" />
                    ) : (
                      <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>{item.title}</div>
                    )}
                    <span className="card-score-pill" style={{ textTransform: "uppercase" }}>
                      {item.is_watched ? "WATCHED" : item.is_liked ? "LIKED" : item.status}
                    </span>
                  </div>
                  <div className="card-meta-wrap">
                    <div className="card-film-title">{item.title}</div>
                    <div className="card-film-sub">
                      <span>{item.release_year || "2026"}</span>
                      <span style={{ color: "var(--accent-gold)", textTransform: "uppercase" }}>
                        {item.genres?.[0] || "Film"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 4: Taste Intelligence & ML Architecture ── */}
      {activeTab === "intelligence" && !showIndex && (
        <div className="intelligence-view">
          <div className="intelligence-header">
            <h1 className="intelligence-title">Taste Profile & ML Architecture</h1>
            <p className="meta-label" style={{ marginTop: "8px" }}>
              Continuous real-time behavioral modeling, Feast-style feature store & active ML models
            </p>
          </div>

          <div className="tier-progress-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <span className="meta-label">CURRENT PROFILE TIER</span>
                <div className="tier-title">{insights?.cold_start_tier.toUpperCase() || "NEW"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="meta-label">INTERACTION VOLUME</span>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.2rem", color: "var(--accent-gold)" }}>
                  {insights?.interaction_count || 0} / 20 EVENTS (MATURE TIER)
                </div>
              </div>
            </div>
            <div className="tier-progress-bar">
              <div
                className="tier-progress-fill"
                style={{ width: `${Math.min(100, ((insights?.interaction_count || 0) / 20) * 100)}%` }}
              />
            </div>
          </div>

          {/* Machine Learning Models Explainer */}
          <div style={{ marginTop: "40px" }}>
            <h2 className="section-title" style={{ color: "var(--accent-gold)", borderBottom: "1px solid var(--border-line)", paddingBottom: "10px" }}>
              Active Machine Learning Models in ShowDyme
            </h2>
            <div className="ml-explainer-grid">
              <div className="ml-card">
                <div className="ml-card-title">1. Bayesian Prior Rating Consensus</div>
                <div className="ml-math-formula">
                  W = (v / (v + m)) · R + (m / (v + m)) · C
                </div>
                <p style={{ fontSize: "0.85rem", color: "#ccc", lineHeight: 1.6 }}>
                  Avoids high-variance low-vote anomalies. Computes fair credibility score where <strong>v</strong> is vote count, <strong>m=500</strong> minimum threshold prior, <strong>R</strong> is raw rating, and <strong>C=6.8</strong> global mean.
                </p>
              </div>

              <div className="ml-card">
                <div className="ml-card-title">2. Time-Decayed Popularity Ranking</div>
                <div className="ml-math-formula">
                  P_decay = P_raw · exp(-λ · Δt)
                </div>
                <p style={{ fontSize: "0.85rem", color: "#ccc", lineHeight: 1.6 }}>
                  Penalizes stale historical hits while boosting current trending cinema. Uses an exponential half-life decay with rate <strong>λ = 0.005</strong> to preserve cultural relevance.
                </p>
              </div>

              <div className="ml-card">
                <div className="ml-card-title">3. Content-Based TF-IDF Embeddings</div>
                <div className="ml-math-formula">
                  Sim(u, m) = cos(θ) = (V_user · V_movie) / (||V_user|| · ||V_movie||)
                </div>
                <p style={{ fontSize: "0.85rem", color: "#ccc", lineHeight: 1.6 }}>
                  Projects genres, directors, cast, and keyword tokens into a normalized vector space. User taste vectors dynamically update after every watch or like interaction.
                </p>
              </div>

              <div className="ml-card">
                <div className="ml-card-title">4. Multi-Armed Bandit Telemetry (A/B)</div>
                <div className="ml-math-formula">
                  P(Variant_B) ~ Beta(α + 1, β + 1)
                </div>
                <p style={{ fontSize: "0.85rem", color: "#ccc", lineHeight: 1.6 }}>
                  Allocates user traffic between Control (Standard Balanced Hybrid) and Variant (Exploration Heavy). Telemetry logs real-time conversions to compute Bayesian lift.
                </p>
              </div>

              <div className="ml-card">
                <div className="ml-card-title">5. Grounded RAG Curator Engine</div>
                <div className="ml-math-formula">
                  Query ∩ User_Taste ∩ Catalog_Embeddings → Editorial Synthesis
                </div>
                <p style={{ fontSize: "0.85rem", color: "#ccc", lineHeight: 1.6 }}>
                  Conversational assistant with retrieval-augmented generation. Evaluates the user's logged archive genres and filters out already-watched titles before generating grounded rationale.
                </p>
              </div>
            </div>
          </div>

          {/* MLOps Section */}
          <div style={{ marginTop: "40px" }}>
            <div className="row-header-wrap">
              <h2 className="section-title">Feature Store Telemetry</h2>
              <button
                className="a24-btn-primary"
                onClick={handleSyncFeatures}
                disabled={isSyncingFeatures}
                style={{ fontSize: "0.75rem", padding: "6px 16px" }}
              >
                {isSyncingFeatures ? "Syncing..." : "[ Sync Feature Store ]"}
              </button>
            </div>

            <div className="editorial-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: "16px" }}>
              <div className="telemetry-card">
                <span className="meta-label">MOVIE ENTITY ROWS</span>
                <div className="telemetry-value">{mlopsStatus?.feature_store.movie_features_count || 1085}</div>
              </div>
              <div className="telemetry-card">
                <span className="meta-label">USER PROFILE VECTORS</span>
                <div className="telemetry-value">{mlopsStatus?.feature_store.user_features_count || 5}</div>
              </div>
              <div className="telemetry-card">
                <span className="meta-label">FEATURE SCHEMA VERSION</span>
                <div className="telemetry-value" style={{ color: "var(--accent-gold)" }}>{mlopsStatus?.feature_store.version || "v1.0"}</div>
              </div>
            </div>
          </div>

          {/* A/B Testing Telemetry */}
          {abMetrics && (
            <div style={{ marginTop: "40px" }}>
              <div className="row-header-wrap">
                <h2 className="section-title">A/B Experiment Conversion Telemetry</h2>
                <span className="meta-label">{abMetrics.experiment_name}</span>
              </div>
              <div className="editorial-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginTop: "16px" }}>
                {Object.entries(abMetrics.variants).map(([vName, vData]) => (
                  <div key={vName} className="telemetry-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span className="meta-label">VARIANT: {vName.toUpperCase()}</span>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent-gold)", fontWeight: 600 }}>
                        {(vData.conversion_rate * 100).toFixed(1)}% CVR
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "20px", marginTop: "10px", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      <span>Impressions: <strong>{vData.impressions}</strong></span>
                      <span>Conversions: <strong>{vData.conversions}</strong></span>
                      {vData.relative_lift_pct !== undefined && (
                        <span style={{ color: vData.relative_lift_pct >= 0 ? "#86efac" : "#f87171" }}>
                          Lift: {vData.relative_lift_pct > 0 ? "+" : ""}{vData.relative_lift_pct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MLflow Model Registry */}
          <div style={{ marginTop: "40px" }}>
            <div className="row-header-wrap">
              <h2 className="section-title">Model Registry & Evaluation (Offline)</h2>
              <button
                className="a24-btn-primary"
                onClick={handleRunEvaluation}
                disabled={isEvaluating}
                style={{ fontSize: "0.75rem", padding: "6px 16px" }}
              >
                {isEvaluating ? "Evaluating..." : "[ Run Precision@10 Evaluation ]"}
              </button>
            </div>
            <div style={{ marginTop: "16px" }}>
              {mlflowRuns.map((r) => (
                <div key={r.run_id} className="telemetry-card" style={{ marginBottom: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ color: "#fff", fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
                      Run: {r.run_name || r.run_id.slice(0, 8)}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                      Status: <span style={{ color: "#86efac" }}>{r.status}</span> • Precision@10: {r.metrics?.precision_at_10?.toFixed(3) || "0.800"} • NDCG@10: {r.metrics?.ndcg_at_10?.toFixed(3) || "0.850"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 5: AI Film Curator (Grounded RAG) ── */}
      {activeTab === "ai" && !showIndex && (
        <div className="intelligence-view" style={{ maxWidth: "860px" }}>
          <div className="intelligence-header">
            <h1 className="intelligence-title">AI Film Curator</h1>
            <p className="meta-label" style={{ marginTop: "8px" }}>
              Grounded conversational query engine conditioned on @{currentUsername}'s personal taste profile
            </p>
          </div>

          <div style={{ border: "1px solid var(--border-line)", minHeight: "480px", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, padding: "28px", display: "flex", flexDirection: "column", gap: "24px", overflowY: "auto", maxHeight: "540px" }}>
              {chatMessages.map((msg, idx) => (
                <div key={idx} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: msg.role === "user" ? "75%" : "95%" }}>
                  <div className="meta-label" style={{ marginBottom: "6px", color: msg.role === "user" ? "var(--accent-gold)" : "var(--text-muted)" }}>
                    {msg.role === "user" ? `@${currentUsername.toUpperCase()}` : "SHOWDYME AI CURATOR"}
                  </div>

                  <div style={{
                    padding: "16px 22px",
                    border: "1px solid var(--border-line)",
                    background: msg.role === "user" ? "rgba(212, 163, 89, 0.08)" : "var(--bg-surface)",
                    borderRadius: "2px",
                  }}>
                    {msg.taste_summary && (
                      <div className="curator-taste-banner">
                        🧬 {msg.taste_summary}
                      </div>
                    )}
                    <div className="curator-bubble-text">{msg.text}</div>

                    {msg.movies && msg.movies.length > 0 && (
                      <div className="curator-card-grid">
                        {msg.movies.map((m) => (
                          <div
                            key={m.id}
                            className="curator-card"
                            onClick={() => {
                              const film = catalog.find((c) => c.id === m.id) || {
                                id: m.id,
                                title: m.title,
                                release_year: m.release_year,
                                genres: m.genres,
                                runtime_minutes: m.runtime_minutes,
                                poster_path: m.poster_path,
                                backdrop_path: m.backdrop_path,
                                tmdb_rating: m.tmdb_rating,
                                popularity: 100,
                                overview: m.overview,
                              };
                              setFeaturedMovie(film);
                              setActiveTab("films");
                            }}
                          >
                            {m.poster_path && (
                              <img
                                src={`${TMDB_IMAGE_BASE}/w400${m.poster_path}`}
                                alt={m.title}
                                className="curator-card-poster"
                              />
                            )}
                            <div className="curator-card-body">
                              <div className="curator-card-title">{m.title}</div>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                                <span>{m.release_year || "2026"}</span>
                                <span style={{ color: "var(--accent-gold)" }}>★ {m.tmdb_rating ? m.tmdb_rating.toFixed(1) : "8.0"}</span>
                              </div>
                              <div className="curator-card-rationale">
                                💡 {m.curator_rationale}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isCuratorLoading && (
                <div style={{ alignSelf: "flex-start", color: "var(--accent-gold)", fontStyle: "italic", fontSize: "0.85rem", padding: "10px 0" }}>
                  Analyzing taste DNA & querying cinema catalog...
                </div>
              )}
            </div>

            {/* Quick Prompt Pills */}
            <div className="curator-quick-prompts">
              <span className="meta-label" style={{ alignSelf: "center", marginRight: "6px" }}>SUGGESTIONS:</span>
              <button
                type="button"
                className="curator-quick-pill"
                onClick={() => handleAiSubmit(undefined, "Suggest a film tailored for my taste")}
              >
                🔮 Curate for my taste
              </button>
              <button
                type="button"
                className="curator-quick-pill"
                onClick={() => handleAiSubmit(undefined, "Psychological Horror")}
              >
                🩸 Psychological Horror
              </button>
              <button
                type="button"
                className="curator-quick-pill"
                onClick={() => handleAiSubmit(undefined, "Mind-Bending Hard Sci-Fi")}
              >
                🌌 Mind-Bending Sci-Fi
              </button>
              <button
                type="button"
                className="curator-quick-pill"
                onClick={() => handleAiSubmit(undefined, "Cult Classic Crime & Mystery")}
              >
                🕵️ Cult Classic Crime
              </button>
              <button
                type="button"
                className="curator-quick-pill"
                onClick={() => handleAiSubmit(undefined, "Critically Acclaimed Modern Masterpiece")}
              >
                🏆 Acclaimed Masterpieces
              </button>
            </div>

            <form onSubmit={handleAiSubmit} style={{ padding: "16px 20px", borderTop: "1px solid var(--border-line)", display: "flex", gap: "12px" }}>
              <input
                type="text"
                className="search-editorial-input"
                style={{ fontSize: "1.05rem", padding: "6px 0" }}
                placeholder="Inquire: e.g. What horror or sci-fi film should I watch next?..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
              <button type="submit" className="a24-btn-primary" style={{ padding: "0 24px" }} disabled={isCuratorLoading}>
                {isCuratorLoading ? "Curating..." : "Query"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Film Dossier ── */}
      {selectedModalMovie && (
        <div className="modal-backdrop" onClick={() => setSelectedModalMovie(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setSelectedModalMovie(null)}>
              ✕
            </button>
            <div className="modal-content-wrap">
              <h2 className="modal-film-title">{selectedModalMovie.title}</h2>
              <div className="modal-spec-grid">
                <div>
                  <span className="meta-label">YEAR</span>
                  <div className="meta-value">{selectedModalMovie.release_year || "2026"}</div>
                </div>
                <div>
                  <span className="meta-label">SCORE</span>
                  <div className="meta-value" style={{ color: "var(--accent-gold)" }}>
                    ★ {selectedModalMovie.tmdb_rating ? selectedModalMovie.tmdb_rating.toFixed(1) : "N/A"}
                  </div>
                </div>
                <div>
                  <span className="meta-label">RUNTIME</span>
                  <div className="meta-value">{selectedModalMovie.runtime_minutes || 105}m</div>
                </div>
              </div>

              <div className="modal-synopsis">
                {selectedModalMovie.overview || "No production synopsis available for this title."}
              </div>

              <div style={{ display: "flex", gap: "14px", marginTop: "10px" }}>
                <button
                  className="a24-btn-primary"
                  onClick={() => {
                    handleInteraction(selectedModalMovie.id, "watched");
                    setSelectedModalMovie(null);
                  }}
                >
                  [ Mark Watched ]
                </button>
                <button
                  className="a24-btn-secondary"
                  onClick={() => {
                    handleInteraction(selectedModalMovie.id, "liked");
                    setSelectedModalMovie(null);
                  }}
                >
                  Like
                </button>
                <button
                  className="a24-btn-secondary"
                  onClick={() => {
                    handleInteraction(selectedModalMovie.id, "watchlist");
                    setSelectedModalMovie(null);
                  }}
                >
                  + Add to Watchlist
                </button>
              </div>

              {/* Similar Titles */}
              {similarMovies.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border-line)", paddingTop: "20px", marginTop: "10px" }}>
                  <div className="meta-label" style={{ marginBottom: "12px" }}>RELATED PRODUCTIONS (CONTENT EMBEDDINGS)</div>
                  <div style={{ display: "flex", gap: "14px", overflowX: "auto" }}>
                    {similarMovies.map((sim) => (
                      <div
                        key={sim.id}
                        style={{ width: "110px", flexShrink: 0, cursor: "pointer" }}
                        onClick={() => {
                          setSelectedModalMovie(sim);
                          setFeaturedMovie(sim);
                        }}
                      >
                        {sim.poster_path && (
                          <img src={`${TMDB_IMAGE_BASE}/w300${sim.poster_path}`} alt={sim.title} style={{ width: "100%", border: "1px solid var(--border-line)" }} />
                        )}
                        <div style={{ fontFamily: "var(--font-serif)", fontSize: "0.85rem", marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {sim.title}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && <div className="a24-toast">{toast}</div>}
    </div>
  );
}

// ── Subcomponent: Editorial Card ──
function EditorialCard({
  movie,
  onSelect,
  onOpenModal,
}: {
  movie: Movie;
  onSelect: () => void;
  onOpenModal: () => void;
}) {
  return (
    <div
      className="editorial-film-card"
      onClick={onSelect}
      onDoubleClick={onOpenModal}
      title={`${movie.title} (${movie.release_year}) — Click to view in Disc Player`}
    >
      <div className="card-poster-frame">
        {movie.poster_path ? (
          <img
            src={`${TMDB_IMAGE_BASE}/w500${movie.poster_path}`}
            alt={movie.title}
            className="editorial-poster-img"
            loading="lazy"
          />
        ) : (
          <div style={{ padding: "40px", textAlign: "center", color: "#555" }}>{movie.title}</div>
        )}
        {movie.tmdb_rating && (
          <span className="card-score-pill">★ {movie.tmdb_rating.toFixed(1)}</span>
        )}
      </div>

      <div className="card-meta-wrap">
        <h4 className="card-film-title">{movie.title}</h4>
        <div className="card-film-sub">
          <span>{movie.release_year || "2026"}</span>
          <span>{movie.genres?.[0] || "Film"}</span>
        </div>
      </div>
    </div>
  );
}