import React, { useEffect, useState, useMemo } from "react";
import "./App.css";

// ── Types ─────────────────────────────────────────────────────────────────
export interface Movie {
  id: number;
  title: string;
  release_year: number | null;
  genres: string[] | null;
  original_language: string | null;
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

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://127.0.0.1:8000";

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
  const [userId, setUserId] = useState<string>("");
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [insights, setInsights] = useState<UserInsights | null>(null);
  const [catalog, setCatalog] = useState<Movie[]>([]);
  const [featuredMovie, setFeaturedMovie] = useState<Movie | null>(null);
  const [selectedModalMovie, setSelectedModalMovie] = useState<Movie | null>(null);
  const [similarMovies, setSimilarMovies] = useState<Movie[]>([]);
  const [toast, setToast] = useState<string | null>(null);

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

  // AI Assistant chat
  const [aiPrompt, setAiPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "curator"; text: string; movies?: Movie[] }[]
  >([
    {
      role: "curator",
      text: "Welcome to the ShowDyme Intelligence Archive. Describe your cinematic mood or thematic interests, and I will recommend productions from our curated collection.",
    },
  ]);

  // Persistent user identity
  useEffect(() => {
    let id = localStorage.getItem("showdyme_user_id") || localStorage.getItem("cinepulse_user_id");
    if (!id) {
      id = "c8f12a34-5678-4321-9abc-def012345678";
      localStorage.setItem("showdyme_user_id", id);
    }
    setUserId(id);
  }, []);

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

  const handleRunOfflineEvaluation = async () => {
    setIsEvaluating(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/mlops/models/evaluate?k=10`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        showToast(`MLflow evaluation logged (Run: ${data.run_id?.slice(0, 8)})`);
        if (userId) refreshData(userId);
      }
    } catch {
      showToast("Evaluation run failed");
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleSwitchMode = async (targetMode: "local" | "databricks") => {
    let host = "";
    let token = "";
    if (targetMode === "databricks") {
      const inputHost = window.prompt("Enter Azure Databricks Workspace URL (e.g. https://adb-12345.azuredatabricks.net):");
      if (!inputHost) return;
      host = inputHost.trim();
      const inputToken = window.prompt("Enter Databricks Personal Access Token (dapi...):");
      if (!inputToken) return;
      token = inputToken.trim();
    }
    try {
      const res = await fetch(`${API_BASE}/api/v1/mlops/config/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: targetMode,
          databricks_host: host || undefined,
          databricks_token: token || undefined,
        }),
      });
      if (res.ok) {
        showToast(`Switched MLOps mode to: ${targetMode === "databricks" ? "Azure Databricks" : "Free Local ($0)"}`);
        if (userId) refreshData(userId);
      }
    } catch {
      showToast("Failed to switch MLOps mode");
    }
  };

  useEffect(() => {
    if (userId) {
      refreshData(userId);
    }
  }, [userId]);

  // Explore search & filter
  useEffect(() => {
    const fetchExplore = async () => {
      try {
        let url = `${API_BASE}/api/v1/movies?page_size=60`;
        if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;
        if (selectedGenre) url += `&genre=${encodeURIComponent(selectedGenre)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setExploreMovies(data.results);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchExplore();
  }, [searchQuery, selectedGenre]);

  // Similar movies for modal
  useEffect(() => {
    if (selectedModalMovie) {
      fetch(`${API_BASE}/api/v1/recommendations/similar/${selectedModalMovie.id}?limit=6`)
        .then((r) => r.json())
        .then((data) => setSimilarMovies(data))
        .catch(() => setSimilarMovies([]));
    }
  }, [selectedModalMovie]);

  // Interactions
  const handleInteraction = async (movie: Movie, eventType: "watched" | "liked" | "disliked" | "watchlist") => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          movie_id: movie.id,
          event_type: eventType,
        }),
      });

      if (res.ok) {
        const labels: Record<string, string> = {
          watched: "Recorded as Watched",
          liked: "Added to Favorites",
          disliked: "Excluded from Recommendations",
          watchlist: "Archived to Watchlist",
        };
        showToast(`${labels[eventType] || eventType}: "${movie.title}"`);
        refreshData(userId);
      }
    } catch (e) {
      showToast("Error updating taste profile");
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Unique genres for filter
  const genresList = useMemo(() => {
    const s = new Set<string>();
    catalog.forEach((m) => m.genres?.forEach((g) => s.add(g)));
    return Array.from(s).slice(0, 12);
  }, [catalog]);

  // Deterministic quote based on movie id
  const currentQuote = useMemo(() => {
    if (!featuredMovie) return EDITORIAL_QUOTES[0];
    return EDITORIAL_QUOTES[featuredMovie.id % EDITORIAL_QUOTES.length];
  }, [featuredMovie]);

  // AI submit
  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;

    const query = aiPrompt.trim();
    setAiPrompt("");
    setChatMessages((prev) => [...prev, { role: "user", text: query }]);

    try {
      const cleanQ = query.replace(/recommend|film|movie|show|like|find/gi, "").trim();
      const res = await fetch(`${API_BASE}/api/v1/movies?q=${encodeURIComponent(cleanQ)}&page_size=3`);
      let matches: Movie[] = [];
      if (res.ok) {
        const data = await res.json();
        matches = data.results || [];
      }
      if (matches.length === 0) {
        matches = (feed?.recommended_for_you || []).slice(0, 3);
      }

      setTimeout(() => {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "curator",
            text: `Curated selections responding to your inquiry "${query}":`,
            movies: matches,
          },
        ]);
      }, 400);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "curator", text: "Unable to query the intelligence catalog at this time." },
      ]);
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
          <div className="tier-indicator">
            <span className="active">●</span>
            <span>{insights?.cold_start_tier || "new"} Tier [{insights?.interaction_count || 0}]</span>
          </div>
        </div>
      </header>

      {/* ── A24 Full Catalog Index Drawer ── */}
      {showIndex && (
        <div className="index-drawer">
          <div className="index-drawer-header">
            <h2 className="index-title">Production Index</h2>
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

      {/* ── Main Tab 1: Films Experience (A24 Disc Showcase + Curated Rails) ── */}
      {activeTab === "films" && !showIndex && (
        <main>
          {featuredMovie && (
            <section className="a24-hero-experience">
              {/* Left Column: Film Information */}
              <div className="experience-info">
                <h1 className="film-hero-title">{featuredMovie.title}</h1>

                <div className="info-content-panel">
                  <div className="meta-label">DIRECTED BY</div>
                  <div className="info-row">
                    <span></span>
                    <span className="info-value">
                      {featuredMovie.directors?.[0]?.name || "Visionary Independent Director"}
                    </span>
                  </div>
                </div>

                <div className="info-content-panel">
                  <div className="meta-label">YEAR</div>
                  <div className="info-row">
                    <span></span>
                    <span className="info-value">{featuredMovie.release_year || "2026"}</span>
                  </div>
                </div>

                <div className="info-content-panel">
                  <div className="meta-label">STARRING</div>
                  <div className="info-row">
                    <span></span>
                    <span className="info-value">
                      {featuredMovie.cast && featuredMovie.cast.length > 0
                        ? featuredMovie.cast.slice(0, 2).map((c) => c.name).join(" • ")
                        : "Ensemble Cast"}
                    </span>
                  </div>
                </div>

                <div className="info-content-panel">
                  <div className="meta-label">GENRES & RUNTIME</div>
                  <div className="info-row">
                    <span></span>
                    <span className="info-value">
                      {featuredMovie.genres?.join(", ") || "Cinema"} {featuredMovie.runtime_minutes ? `• ${featuredMovie.runtime_minutes}m` : ""}
                    </span>
                  </div>
                </div>

                {featuredMovie.reason && (
                  <div className="curator-note-box">
                    <div className="meta-label">RECOMMENDATION RATIONALE</div>
                    <p className="curator-note-text">"{featuredMovie.reason}"</p>
                  </div>
                )}
              </div>

              {/* Center Column: Revolving Vinyl / Film Disc */}
              <div className="experience-canvas-wrap">
                <div
                  className="vinyl-disc"
                  onClick={() => setSelectedModalMovie(featuredMovie)}
                  title="Click to view production dossier"
                >
                  <div className="vinyl-center-art">
                    {featuredMovie.poster_path ? (
                      <img
                        src={`${TMDB_IMAGE_BASE}/w500${featuredMovie.poster_path}`}
                        alt={featuredMovie.title}
                        className="vinyl-poster-img"
                      />
                    ) : (
                      <img src="/showdyme-coin.png" alt="ShowDyme" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "50%" }} />
                    )}
                    <div className="spindle-hole" />
                  </div>
                </div>
                <div className="disc-caption">Click Disc For Production Dossier</div>
              </div>

              {/* Right Column: Critical Acclaim & Editorial Controls */}
              <div className="experience-acclaim">
                <div className="testimonial-block">
                  <div className="star-rating-row">
                    {[...Array(currentQuote.stars)].map((_, i) => (
                      <svg key={i} className="star-icon" viewBox="0 0 11 10">
                        <path d="M5.24862 0L6.68508 3.53591L10.4972 3.81215L7.62431 6.29834L8.50829 10L5.24862 8.01105L1.98895 10L2.87293 6.29834L0 3.81215L3.81215 3.53591L5.24862 0Z" />
                      </svg>
                    ))}
                  </div>
                  <div className="publication-name">{currentQuote.publication}</div>
                  <div className="quote-text">"{currentQuote.quote}"</div>
                </div>

                <div className="editorial-btn-group">
                  <button
                    className="a24-btn-primary"
                    onClick={() => handleInteraction(featuredMovie, "watched")}
                  >
                    [ Mark Watched ]
                  </button>

                  <button
                    className="a24-btn-secondary"
                    onClick={() => handleInteraction(featuredMovie, "watchlist")}
                  >
                    + Add To Archive
                  </button>

                  <div className="editorial-btn-subgroup">
                    <button
                      className="a24-btn-secondary"
                      onClick={() => handleInteraction(featuredMovie, "liked")}
                    >
                      Like
                    </button>
                    <button
                      className="a24-btn-secondary"
                      onClick={() => handleInteraction(featuredMovie, "disliked")}
                    >
                      Dislike
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── Curated Editorial Rails (The Collection) ── */}
          <div className="collection-section">
            {/* Recommended For You */}
            <div className="editorial-row">
              <div className="editorial-row-header">
                <h2 className="editorial-row-title">Recommended Selections</h2>
                <span className="editorial-row-subtitle">
                  {insights?.cold_start_tier === "new" ? "Cold Start Popularity & Exploration" : `${insights?.cold_start_tier} Hybrid Synthesis`}
                </span>
              </div>
              <div className="editorial-cards-rail">
                {feed?.recommended_for_you.map((m) => (
                  <EditorialCard
                    key={m.id}
                    movie={m}
                    onSelect={() => setFeaturedMovie(m)}
                    onOpenModal={() => setSelectedModalMovie(m)}
                  />
                ))}
              </div>
            </div>

            {/* Because You Watched... */}
            {feed?.because_you_watched && (
              <div className="editorial-row">
                <div className="editorial-row-header">
                  <h2 className="editorial-row-title">
                    Echoes of "{feed.because_you_watched.source_movie_title}"
                  </h2>
                  <span className="editorial-row-subtitle">Content Vector Affinity</span>
                </div>
                <div className="editorial-cards-rail">
                  {feed.because_you_watched.movies.map((m) => (
                    <EditorialCard
                      key={m.id}
                      movie={m}
                      onSelect={() => setFeaturedMovie(m)}
                      onOpenModal={() => setSelectedModalMovie(m)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Trending Productions */}
            <div className="editorial-row">
              <div className="editorial-row-header">
                <h2 className="editorial-row-title">Contemporary Cinema</h2>
                <span className="editorial-row-subtitle">Audience Velocity</span>
              </div>
              <div className="editorial-cards-rail">
                {feed?.trending_now.map((m) => (
                  <EditorialCard
                    key={m.id}
                    movie={m}
                    onSelect={() => setFeaturedMovie(m)}
                    onOpenModal={() => setSelectedModalMovie(m)}
                  />
                ))}
              </div>
            </div>

            {/* Critically Acclaimed */}
            <div className="editorial-row">
              <div className="editorial-row-header">
                <h2 className="editorial-row-title">Critical Acclaim</h2>
                <span className="editorial-row-subtitle">Bayesian Evaluation</span>
              </div>
              <div className="editorial-cards-rail">
                {feed?.top_rated.map((m) => (
                  <EditorialCard
                    key={m.id}
                    movie={m}
                    onSelect={() => setFeaturedMovie(m)}
                    onOpenModal={() => setSelectedModalMovie(m)}
                  />
                ))}
              </div>
            </div>
          </div>
        </main>
      )}

      {/* ── Tab 2: Explore Catalog ── */}
      {activeTab === "explore" && !showIndex && (
        <div className="explore-editorial-view">
          <div className="search-editorial-wrap">
            <span className="meta-label">QUERY THE CATALOG</span>
            <input
              type="text"
              className="search-editorial-input"
              placeholder="Search by title, director, keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="genre-filter-row">
              <button
                className={`genre-btn ${selectedGenre === null ? "active" : ""}`}
                onClick={() => setSelectedGenre(null)}
              >
                All Genres
              </button>
              {genresList.map((g) => (
                <button
                  key={g}
                  className={`genre-btn ${selectedGenre === g ? "active" : ""}`}
                  onClick={() => setSelectedGenre(selectedGenre === g ? null : g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="editorial-grid">
            {exploreMovies.map((m) => (
              <EditorialCard
                key={m.id}
                movie={m}
                onSelect={() => { setFeaturedMovie(m); setActiveTab("films"); }}
                onOpenModal={() => setSelectedModalMovie(m)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Tab 3: My Archive ── */}
      {activeTab === "archive" && !showIndex && (
        <div className="explore-editorial-view">
          <div className="intelligence-header">
            <h1 className="intelligence-title">Personal Archive</h1>
            <p className="meta-label" style={{ marginTop: "8px" }}>
              USER IDENTITY: {userId} • {insights?.interaction_count || 0} TOTAL RECORDS
            </p>
          </div>

          {insights?.recent_activity.length === 0 ? (
            <p style={{ color: "var(--text-muted)", padding: "40px 0" }}>
              Your archive is empty. Select productions from the collection to log viewing activity.
            </p>
          ) : (
            <div className="editorial-grid">
              {insights?.recent_activity.map((act) => (
                <div
                  key={act.movie_id + act.event_type}
                  className="editorial-film-card"
                  onClick={() => {
                    const m = catalog.find((c) => c.id === act.movie_id);
                    if (m) { setFeaturedMovie(m); setActiveTab("films"); }
                  }}
                >
                  <div className="card-poster-frame">
                    {act.poster_path ? (
                      <img src={`${TMDB_IMAGE_BASE}/w500${act.poster_path}`} alt={act.movie_title} className="editorial-poster-img" />
                    ) : (
                      <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>{act.movie_title}</div>
                    )}
                    <span className="card-score-pill" style={{ textTransform: "uppercase" }}>{act.event_type}</span>
                  </div>
                  <div className="card-meta-wrap">
                    <div className="card-film-title">{act.movie_title}</div>
                    <div className="card-film-sub">
                      <span>{act.release_year || "2026"}</span>
                      <span style={{ color: "var(--accent-gold)", textTransform: "uppercase" }}>{act.event_type}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 4: Taste Intelligence ── */}
      {activeTab === "intelligence" && !showIndex && (
        <div className="intelligence-view">
          <div className="intelligence-header">
            <h1 className="intelligence-title">Taste Profile Telemetry</h1>
            <p className="meta-label" style={{ marginTop: "8px" }}>
              Continuous real-time behavioral modeling & cold-start tier management
            </p>
          </div>

          <div className="tier-progress-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <span className="meta-label">CURRENT RECOMMENDATION TIER</span>
                <h3 style={{ fontSize: "1.6rem", textTransform: "uppercase", marginTop: "4px" }}>
                  {insights?.cold_start_tier} Tier
                </h3>
              </div>
              <span className="meta-label">
                {insights?.interaction_count || 0} / 16 INTERACTIONS FOR MATURE COLLABORATIVE MATRIX
              </span>
            </div>

            <div className="progress-hairline-track">
              <div
                className="progress-hairline-fill"
                style={{ width: `${Math.min(100, Math.max(8, ((insights?.interaction_count || 0) / 16) * 100))}%` }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              <span>Tier 1: New (Popularity + Diversity)</span>
              <span>Tier 2: Sparse (Content Vectors)</span>
              <span>Tier 3: Mature (Collaborative Filtering)</span>
            </div>
          </div>

          <div className="intelligence-meta-panel">
            <div className="meta-metric-card">
              <span className="meta-label">TOTAL INTERACTIONS</span>
              <span className="metric-val">{insights?.interaction_count || 0}</span>
            </div>
            <div className="meta-metric-card">
              <span className="meta-label">WATCHED PRODUCTIONS</span>
              <span className="metric-val">{insights?.watched_count || 0}</span>
            </div>
            <div className="meta-metric-card">
              <span className="meta-label">FAVORITED FILMS</span>
              <span className="metric-val">{insights?.liked_count || 0}</span>
            </div>
            <div className="meta-metric-card">
              <span className="meta-label">ARCHIVED TO WATCHLIST</span>
              <span className="metric-val">{insights?.watchlist_count || 0}</span>
            </div>
          </div>

          <div className="meta-metric-card" style={{ gridColumn: "span 4" }}>
            <span className="meta-label" style={{ marginBottom: "12px" }}>DOMINANT GENRE DISTRIBUTION</span>
            {insights?.top_genres.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No positive interactions logged yet to construct your genre distribution vector.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {insights?.top_genres.map((g) => (
                  <div key={g.genre} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem" }}>{g.genre}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", width: "50%" }}>
                      <div style={{ flex: 1, height: "1px", background: "var(--border-line)" }}>
                        <div style={{ height: "100%", width: `${Math.min(100, g.count * 30)}%`, background: "var(--text-pure)" }} />
                      </div>
                      <span className="meta-label">{g.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Phase 6: Real-Time MLOps & Experimentation ── */}
          <div className="tier-progress-section" style={{ marginTop: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <span className="meta-label">PHASE 6 MLOPS & SYSTEM TELEMETRY</span>
                <h3 style={{ fontSize: "1.4rem", textTransform: "uppercase", marginTop: "4px" }}>
                  Real-Time Feature Store & Online Experimentation
                </h3>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", border: "1px solid var(--border-line)", padding: "2px" }}>
                  <button
                    onClick={() => handleSwitchMode("local")}
                    style={{
                      background: mlopsStatus?.mode !== "databricks" ? "rgba(255,255,255,0.1)" : "transparent",
                      border: "none",
                      color: mlopsStatus?.mode !== "databricks" ? "var(--text-pure)" : "var(--text-muted)",
                      padding: "6px 12px",
                      fontSize: "0.72rem",
                      cursor: "pointer",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    ● Local Free ($0)
                  </button>
                  <button
                    onClick={() => handleSwitchMode("databricks")}
                    style={{
                      background: mlopsStatus?.mode === "databricks" ? "rgba(100, 181, 246, 0.2)" : "transparent",
                      border: "none",
                      color: mlopsStatus?.mode === "databricks" ? "#64b5f6" : "var(--text-muted)",
                      padding: "6px 12px",
                      fontSize: "0.72rem",
                      cursor: "pointer",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    ☁ Databricks Cloud
                  </button>
                </div>
                <button
                  className="a24-btn-secondary"
                  disabled={isSyncingFeatures}
                  onClick={handleSyncFeatures}
                  style={{ fontSize: "0.75rem", padding: "8px 14px" }}
                >
                  {isSyncingFeatures ? "[ Syncing Store... ]" : "[ Sync Feature Store ]"}
                </button>
                <button
                  className="a24-btn-secondary"
                  disabled={isEvaluating}
                  onClick={handleRunOfflineEvaluation}
                  style={{ fontSize: "0.75rem", padding: "8px 14px" }}
                >
                  {isEvaluating ? "[ Evaluating... ]" : "[ Run Offline Eval ]"}
                </button>
              </div>
            </div>

            {/* MLOps 3-column stats */}
            <div className="intelligence-meta-panel" style={{ marginTop: "20px" }}>
              <div className="meta-metric-card">
                <span className="meta-label">FEATURE STORE CATALOG</span>
                <span className="metric-val">{mlopsStatus?.feature_store.movie_features_count || 442}</span>
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  Active Movie Feature Rows
                </span>
              </div>
              <div className="meta-metric-card">
                <span className="meta-label">A/B EXPERIMENT</span>
                <span className="metric-val" style={{ fontSize: "1.3rem", color: "var(--accent-gold)" }}>
                  {feed?.experiment_variant || "control"}
                </span>
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  Assigned Variant (50/50 Split)
                </span>
              </div>
              <div className="meta-metric-card">
                <span className="meta-label">MLFLOW TRACKING</span>
                <span className="metric-val" style={{ fontSize: "1.2rem" }}>
                  {mlflowRuns.length} Runs
                </span>
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  $0 Local SQLite / Artifacts
                </span>
              </div>
              <div className="meta-metric-card">
                <span className="meta-label">CLOUD TRIAL SHOWCASE</span>
                <span className="metric-val" style={{ fontSize: "1.1rem", color: "#64b5f6" }}>
                  Databricks
                </span>
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  PySpark Delta & Streaming Ready
                </span>
              </div>
            </div>

            {/* Experiment Variants Comparison */}
            {abMetrics && (
              <div style={{ marginTop: "20px", borderTop: "1px solid var(--border-line)", paddingTop: "16px" }}>
                <span className="meta-label">ACTIVE EXPERIMENT: recommender_hybrid_v1 (ONLINE CONVERSIONS)</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "12px" }}>
                  {Object.entries(abMetrics.variants).map(([vName, vData]) => (
                    <div
                      key={vName}
                      style={{
                        padding: "16px",
                        border: "1px solid var(--border-line)",
                        background: vName === feed?.experiment_variant ? "rgba(212, 163, 89, 0.04)" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, textTransform: "uppercase" }}>
                          Variant: {vName} {vName === feed?.experiment_variant ? "(Your Session)" : ""}
                        </span>
                        <span style={{ color: "var(--accent-gold)", fontSize: "0.85rem", fontFamily: "var(--font-mono)" }}>
                          {vData.relative_lift_pct ? `${vData.relative_lift_pct > 0 ? "+" : ""}${vData.relative_lift_pct}% Lift` : "Baseline"}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "20px", marginTop: "10px", fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        <div>Impressions: <strong style={{ color: "var(--text-pure)" }}>{vData.impressions}</strong></div>
                        <div>Conversions: <strong style={{ color: "var(--text-pure)" }}>{vData.conversions}</strong></div>
                        <div>Rate: <strong style={{ color: "var(--text-pure)" }}>{(vData.conversion_rate * 100).toFixed(1)}%</strong></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* MLflow Offline Evaluation History */}
            {mlflowRuns.length > 0 && (
              <div style={{ marginTop: "20px", borderTop: "1px solid var(--border-line)", paddingTop: "16px" }}>
                <span className="meta-label">RECENT MLFLOW OFFLINE EVALUATION RUNS</span>
                <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {mlflowRuns.slice(0, 3).map((r) => (
                    <div
                      key={r.run_id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        border: "1px solid var(--border-line)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.78rem",
                      }}
                    >
                      <span>{r.run_name}</span>
                      <div style={{ display: "flex", gap: "16px", color: "var(--text-muted)" }}>
                        <span>NDCG@10: <strong style={{ color: "var(--text-pure)" }}>{r.metrics.ndcg_at_k ?? "0.0"}</strong></span>
                        <span>Diversity: <strong style={{ color: "var(--text-pure)" }}>{r.metrics.intra_list_diversity ?? "0.0"}</strong></span>
                        <span>Coverage: <strong style={{ color: "var(--text-pure)" }}>{((r.metrics.catalog_coverage ?? 0) * 100).toFixed(1)}%</strong></span>
                        <span style={{ color: "var(--accent-gold)" }}>{r.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab 5: AI Curator ── */}
      {activeTab === "ai" && !showIndex && (
        <div className="intelligence-view" style={{ maxWidth: "800px" }}>
          <div className="intelligence-header">
            <h1 className="intelligence-title">AI Film Curator</h1>
            <p className="meta-label" style={{ marginTop: "8px" }}>
              Grounded conversational query engine linked to catalog metadata & embeddings
            </p>
          </div>

          <div style={{ border: "1px solid var(--border-line)", minHeight: "440px", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, padding: "28px", display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto", maxHeight: "480px" }}>
              {chatMessages.map((msg, idx) => (
                <div key={idx} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                  <div className="meta-label" style={{ marginBottom: "4px" }}>
                    {msg.role === "user" ? "YOU" : "SHOWDYME CURATOR"}
                  </div>
                  <div style={{
                    padding: "14px 20px",
                    border: "1px solid var(--border-line)",
                    background: msg.role === "user" ? "var(--bg-card-hover)" : "var(--bg-surface)",
                    fontSize: "0.95rem",
                    lineHeight: 1.6,
                    color: "var(--text-pure)",
                  }}>
                    {msg.text}
                  </div>
                  {msg.movies && (
                    <div style={{ display: "flex", gap: "16px", marginTop: "14px", overflowX: "auto" }}>
                      {msg.movies.map((m) => (
                        <div
                          key={m.id}
                          style={{ width: "130px", flexShrink: 0, cursor: "pointer" }}
                          onClick={() => { setFeaturedMovie(m); setActiveTab("films"); }}
                        >
                          {m.poster_path && (
                            <img src={`${TMDB_IMAGE_BASE}/w300${m.poster_path}`} alt={m.title} style={{ width: "100%", border: "1px solid var(--border-line)" }} />
                          )}
                          <div style={{ fontFamily: "var(--font-serif)", fontSize: "0.9rem", marginTop: "6px" }}>{m.title}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <form onSubmit={handleAiSubmit} style={{ padding: "16px 20px", borderTop: "1px solid var(--border-line)", display: "flex", gap: "12px" }}>
              <input
                type="text"
                className="search-editorial-input"
                style={{ fontSize: "1.1rem", padding: "6px 0" }}
                placeholder="Inquire: e.g. An atmospheric psychological thriller with existential themes..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
              <button type="submit" className="a24-btn-primary" style={{ padding: "0 24px" }}>
                Query
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Production Dossier Modal ── */}
      {selectedModalMovie && (
        <div className="a24-modal-backdrop" onClick={() => setSelectedModalMovie(null)}>
          <div className="a24-modal-card" onClick={(e) => e.stopPropagation()}>
            <span className="modal-close-icon" onClick={() => setSelectedModalMovie(null)}>[ CLOSE ]</span>

            <div className="modal-hero-frame">
              <img
                src={selectedModalMovie.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${selectedModalMovie.backdrop_path}` : `${TMDB_IMAGE_BASE}/w500${selectedModalMovie.poster_path}`}
                alt={selectedModalMovie.title}
                className="modal-hero-backdrop"
              />
            </div>

            <div className="modal-content-wrap">
              <h2 className="modal-film-title">{selectedModalMovie.title}</h2>

              <div className="modal-spec-grid">
                <div>
                  <div className="meta-label">DIRECTOR</div>
                  <div style={{ marginTop: "4px" }}>{selectedModalMovie.directors?.[0]?.name || "Independent"}</div>
                </div>
                <div>
                  <div className="meta-label">YEAR & RUNTIME</div>
                  <div style={{ marginTop: "4px" }}>{selectedModalMovie.release_year || "2026"} • {selectedModalMovie.runtime_minutes || "—"}m</div>
                </div>
                <div>
                  <div className="meta-label">CRITICAL RATING</div>
                  <div style={{ marginTop: "4px", color: "var(--accent-gold)" }}>★ {selectedModalMovie.tmdb_rating ? selectedModalMovie.tmdb_rating.toFixed(1) : "N/A"}/10</div>
                </div>
              </div>

              <p className="modal-synopsis">{selectedModalMovie.overview || "Official production dossier curated from our multi-source movie intelligence registry."}</p>

              <div className="editorial-btn-group" style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <button className="a24-btn-primary" onClick={() => handleInteraction(selectedModalMovie, "watched")}>
                  [ Mark Watched ]
                </button>
                <button className="a24-btn-secondary" onClick={() => handleInteraction(selectedModalMovie, "liked")}>
                  Like
                </button>
                <button className="a24-btn-secondary" onClick={() => handleInteraction(selectedModalMovie, "disliked")}>
                  Dislike
                </button>
                <button className="a24-btn-secondary" onClick={() => handleInteraction(selectedModalMovie, "watchlist")}>
                  + Watchlist
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