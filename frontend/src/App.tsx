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
  score?: number | null;
  strategy?: string | null;
  reason?: string | null;
}

interface FeedResponse {
  user_id: string | null;
  cold_start_tier: "new" | "sparse" | "mature";
  recommended_for_you: Movie[];
  trending_now: Movie[];
  top_rated: Movie[];
  because_you_watched: {
    source_movie_title: string;
    source_movie_id: number;
    movies: Movie[];
  } | null;
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

// ── Component ─────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState<"home" | "explore" | "my-movies" | "insights" | "ai">("home");
  const [userId, setUserId] = useState<string>("");
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [insights, setInsights] = useState<UserInsights | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [similarMovies, setSimilarMovies] = useState<Movie[]>([]);
  const [, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Explore page state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [exploreMovies, setExploreMovies] = useState<Movie[]>([]);

  // AI Assistant state
  const [aiPrompt, setAiPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "assistant"; text: string; movies?: Movie[] }[]
  >([
    {
      role: "assistant",
      text: "Hello! I am your CinePulse AI assistant. Ask me to recommend movies based on themes, genres, moods, or titles you love!",
    },
  ]);

  // Initialize or fetch persistent User ID
  useEffect(() => {
    let id = localStorage.getItem("cinepulse_user_id");
    if (!id) {
      id = "c8f12a34-5678-4321-9abc-def012345678";
      localStorage.setItem("cinepulse_user_id", id);
    }
    setUserId(id);
  }, []);

  // Fetch Feed & Insights
  const refreshData = async (uid: string) => {
    try {
      setLoading(true);
      const [feedRes, insightsRes] = await Promise.all([
        fetch(`http://127.0.0.1:8000/api/v1/recommendations?user_id=${uid}&limit=12`),
        fetch(`http://127.0.0.1:8000/api/v1/interactions/user/${uid}/insights`),
      ]);

      if (feedRes.ok) {
        const feedData = await feedRes.json();
        setFeed(feedData);
      }
      if (insightsRes.ok) {
        const insightsData = await insightsRes.json();
        setInsights(insightsData);
      }
    } catch (err) {
      console.error("Failed to load recommendations:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      refreshData(userId);
    }
  }, [userId]);

  // Fetch Explore Movies
  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        let url = `http://127.0.0.1:8000/api/v1/movies?page_size=60`;
        if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;
        if (selectedGenre) url += `&genre=${encodeURIComponent(selectedGenre)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setExploreMovies(data.results);
        }
      } catch (e) {
        console.error("Failed to load explore catalog:", e);
      }
    };
    fetchCatalog();
  }, [searchQuery, selectedGenre]);

  // Fetch Similar Movies when modal opens
  useEffect(() => {
    if (selectedMovie) {
      fetch(`http://127.0.0.1:8000/api/v1/recommendations/similar/${selectedMovie.id}?limit=6`)
        .then((r) => r.json())
        .then((data) => setSimilarMovies(data))
        .catch(() => setSimilarMovies([]));
    }
  }, [selectedMovie]);

  // Record Interaction
  const handleInteraction = async (movie: Movie, eventType: "watched" | "liked" | "disliked" | "watchlist") => {
    try {
      const res = await fetch("http://127.0.0.1:8000/api/v1/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          movie_id: movie.id,
          event_type: eventType,
        }),
      });

      if (res.ok) {
        await res.json();
        const actionLabels: Record<string, string> = {
          watched: "Marked as Watched",
          liked: "Added to Liked",
          disliked: "Marked as Disliked",
          watchlist: "Added to Watchlist",
        };
        showToast(`${actionLabels[eventType] || eventType}: "${movie.title}"`);
        // Refresh personalized feed to show real-time adaptation
        refreshData(userId);
      }
    } catch (err) {
      showToast("Error updating taste profile");
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  // Extract all unique genres for filter pills
  const allGenres = useMemo(() => {
    const set = new Set<string>();
    (feed?.trending_now || []).forEach((m) => m.genres?.forEach((g) => set.add(g)));
    (feed?.recommended_for_you || []).forEach((m) => m.genres?.forEach((g) => set.add(g)));
    return Array.from(set).slice(0, 14);
  }, [feed]);

  // Hero movie
  const heroMovie = feed?.trending_now?.[0] || feed?.recommended_for_you?.[0];

  // AI Chat handler
  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;

    const userText = aiPrompt.trim();
    setAiPrompt("");
    setChatMessages((prev) => [...prev, { role: "user", text: userText }]);

    // Query catalog with keywords
    try {
      const res = await fetch(
        `http://127.0.0.1:8000/api/v1/movies?q=${encodeURIComponent(userText.replace(/recommend|find|movie|similar|like/gi, "").trim())}&page_size=3`
      );
      let matched: Movie[] = [];
      if (res.ok) {
        const data = await res.json();
        matched = data.results || [];
      }

      if (matched.length === 0) {
        // Fallback to top recommendation
        matched = (feed?.recommended_for_you || []).slice(0, 3);
      }

      setTimeout(() => {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `Based on your request "${userText}", here are top matches from our intelligence engine:`,
            movies: matched,
          },
        ]);
      }, 500);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: "I encountered an error querying the catalog. Please try again!" },
      ]);
    }
  };

  return (
    <div className="app-container">
      {/* ── Top Navigation ── */}
      <header className="navbar">
        <div className="nav-brand" onClick={() => setActiveTab("home")}>
          <div className="brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 3v2h-2V3H8v2H6V3H4v18h2v-2h2v2h8v-2h2v2h2V3h-2zM8 17H6v-2h2v2zm0-4H6v-2h2v2zm0-4H6V7h2v2zm10 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z" />
            </svg>
          </div>
          <span>Cine<span className="brand-accent">Pulse</span></span>
        </div>

        <nav className="nav-links">
          <button className={`nav-tab ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>
            Home
          </button>
          <button className={`nav-tab ${activeTab === "explore" ? "active" : ""}`} onClick={() => setActiveTab("explore")}>
            Explore
          </button>
          <button className={`nav-tab ${activeTab === "my-movies" ? "active" : ""}`} onClick={() => setActiveTab("my-movies")}>
            My Movies
          </button>
          <button className={`nav-tab ${activeTab === "insights" ? "active" : ""}`} onClick={() => setActiveTab("insights")}>
            My Insights
          </button>
          <button className={`nav-tab ${activeTab === "ai" ? "active" : ""}`} onClick={() => setActiveTab("ai")}>
            AI Assistant
          </button>
        </nav>

        <div className="nav-right">
          <div className={`tier-badge ${insights?.cold_start_tier || "new"}`}>
            <span className="pulse-dot"></span>
            <span>{insights?.cold_start_tier || "new"} Tier ({insights?.interaction_count || 0})</span>
          </div>
        </div>
      </header>

      {/* ── Main Tab Content ── */}
      {activeTab === "home" && (
        <main>
          {/* Hero Banner */}
          {heroMovie && (
            <section className="hero-banner">
              <img
                src={heroMovie.backdrop_path ? `${TMDB_IMAGE_BASE}/original${heroMovie.backdrop_path}` : `${TMDB_IMAGE_BASE}/w500${heroMovie.poster_path}`}
                alt={heroMovie.title}
                className="hero-backdrop"
              />
              <div className="hero-overlay" />
              <div className="hero-content">
                <div className="hero-badge">Featured Spotlight</div>
                <h1 className="hero-title">{heroMovie.title}</h1>
                <div className="hero-meta">
                  <span className="rating">★ {heroMovie.tmdb_rating ? heroMovie.tmdb_rating.toFixed(1) : "N/A"}</span>
                  <span>{heroMovie.release_year}</span>
                  {heroMovie.runtime_minutes && <span>{heroMovie.runtime_minutes}m</span>}
                  {heroMovie.genres?.map((g) => (
                    <span key={g} className="genre-tag">{g}</span>
                  ))}
                </div>
                <p className="hero-overview">{heroMovie.overview || "An exceptional cinematic journey featured across our intelligence network."}</p>
                <div className="hero-actions">
                  <button className="glow-btn" onClick={() => setSelectedMovie(heroMovie)}>
                    View Details
                  </button>
                  <button className="ghost-btn" onClick={() => handleInteraction(heroMovie, "watchlist")}>
                    + Add to Watchlist
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Movie Rails */}
          <div className="rails-container">
            {/* Recommended For You */}
            <section className="movie-row">
              <div className="row-header">
                <div className="row-title-wrap">
                  <h2 className="row-title">Recommended For You</h2>
                  <span className="row-subtitle-badge">
                    {insights?.cold_start_tier === "new" ? "Cold Start Popularity + Diversity" : `${insights?.cold_start_tier} Hybrid Ranking`}
                  </span>
                </div>
              </div>
              <div className="rail-cards">
                {feed?.recommended_for_you.map((movie) => (
                  <MovieCardComponent key={movie.id} movie={movie} onClick={() => setSelectedMovie(movie)} />
                ))}
              </div>
            </section>

            {/* Because You Watched... (if user has watched movies) */}
            {feed?.because_you_watched && (
              <section className="movie-row">
                <div className="row-header">
                  <div className="row-title-wrap">
                    <h2 className="row-title">Because You Watched "{feed.because_you_watched.source_movie_title}"</h2>
                    <span className="row-subtitle-badge">Content Similarity</span>
                  </div>
                </div>
                <div className="rail-cards">
                  {feed.because_you_watched.movies.map((movie) => (
                    <MovieCardComponent key={movie.id} movie={movie} onClick={() => setSelectedMovie(movie)} />
                  ))}
                </div>
              </section>
            )}

            {/* Trending Now */}
            <section className="movie-row">
              <div className="row-header">
                <div className="row-title-wrap">
                  <h2 className="row-title">Trending Now</h2>
                  <span className="row-subtitle-badge">High Velocity</span>
                </div>
              </div>
              <div className="rail-cards">
                {feed?.trending_now.map((movie) => (
                  <MovieCardComponent key={movie.id} movie={movie} onClick={() => setSelectedMovie(movie)} />
                ))}
              </div>
            </section>

            {/* Top Rated */}
            <section className="movie-row">
              <div className="row-header">
                <div className="row-title-wrap">
                  <h2 className="row-title">Critically Acclaimed</h2>
                  <span className="row-subtitle-badge">Bayesian Weighted</span>
                </div>
              </div>
              <div className="rail-cards">
                {feed?.top_rated.map((movie) => (
                  <MovieCardComponent key={movie.id} movie={movie} onClick={() => setSelectedMovie(movie)} />
                ))}
              </div>
            </section>
          </div>
        </main>
      )}

      {/* ── Explore Catalog Tab ── */}
      {activeTab === "explore" && (
        <div className="explore-container">
          <div className="filter-bar">
            <div className="search-input-wrap">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="search-input"
                placeholder="Search movies by title, director, or actor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="genre-pills">
              <button
                className={`genre-pill ${selectedGenre === null ? "active" : ""}`}
                onClick={() => setSelectedGenre(null)}
              >
                All Genres
              </button>
              {allGenres.map((g) => (
                <button
                  key={g}
                  className={`genre-pill ${selectedGenre === g ? "active" : ""}`}
                  onClick={() => setSelectedGenre(selectedGenre === g ? null : g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="catalog-grid">
            {exploreMovies.map((movie) => (
              <MovieCardComponent key={movie.id} movie={movie} onClick={() => setSelectedMovie(movie)} />
            ))}
          </div>
        </div>
      )}

      {/* ── My Movies Tab ── */}
      {activeTab === "my-movies" && (
        <div className="explore-container">
          <h1 style={{ fontSize: "2rem", marginBottom: "16px" }}>My Saved & Watched Movies</h1>
          {insights?.recent_activity.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No movie interactions yet! Browse the home feed and click "Watch" or "Like" to build your profile.</p>
          ) : (
            <div className="catalog-grid">
              {insights?.recent_activity.map((act) => (
                <div key={act.movie_id + act.event_type} className="movie-card" onClick={() => setSelectedMovie({ id: act.movie_id, title: act.movie_title, release_year: act.release_year, poster_path: act.poster_path } as any)}>
                  <div className="poster-wrap">
                    {act.poster_path ? (
                      <img src={`${TMDB_IMAGE_BASE}/w500${act.poster_path}`} alt={act.movie_title} className="movie-poster" />
                    ) : (
                      <div style={{ padding: "40px 10px", textAlign: "center", color: "#666" }}>{act.movie_title}</div>
                    )}
                    <div className="card-reason-tag" style={{ textTransform: "capitalize" }}>{act.event_type}</div>
                  </div>
                  <div className="card-info">
                    <div className="card-title">{act.movie_title}</div>
                    <div className="card-meta">
                      <span>{act.release_year}</span>
                      <span style={{ color: "var(--accent-cyan)", textTransform: "capitalize" }}>{act.event_type}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Insights Tab ── */}
      {activeTab === "insights" && (
        <div className="insights-container">
          <div className="insights-header">
            <h1 style={{ fontSize: "2.4rem", fontWeight: 800 }}>Your Taste Intelligence</h1>
            <p style={{ color: "var(--text-secondary)" }}>Real-time machine learning profile, cold-start tier tracking, and taste vectors.</p>
          </div>

          {/* Tier Meter Card */}
          <div className="tier-meter-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ fontSize: "1.2rem", fontWeight: 700 }}>Personalization Engine Status</h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>
                  Current Tier: <strong style={{ color: "var(--text-white)", textTransform: "uppercase" }}>{insights?.cold_start_tier}</strong> ({insights?.interaction_count || 0} interactions)
                </p>
              </div>
              <div className={`tier-badge ${insights?.cold_start_tier || "new"}`}>
                <span className="pulse-dot"></span>
                <span>Active</span>
              </div>
            </div>

            <div className="meter-track">
              <div
                className="meter-fill"
                style={{
                  width: `${Math.min(100, Math.max(12, ((insights?.interaction_count || 0) / 20) * 100))}%`,
                }}
              />
            </div>
            <div className="meter-labels">
              <span>Tier 1: New (0 interactions)</span>
              <span>Tier 2: Sparse (1–15 interactions)</span>
              <span>Tier 3: Mature (15+ collaborative)</span>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="insights-stats-grid">
            <div className="stat-card">
              <span className="stat-label">Total Interactions</span>
              <span className="stat-value">{insights?.interaction_count || 0}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Watched Movies</span>
              <span className="stat-value" style={{ color: "var(--accent-cyan)" }}>{insights?.watched_count || 0}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Liked Films</span>
              <span className="stat-value" style={{ color: "var(--primary)" }}>{insights?.liked_count || 0}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Watchlist</span>
              <span className="stat-value" style={{ color: "var(--accent-gold)" }}>{insights?.watchlist_count || 0}</span>
            </div>
          </div>

          {/* Top Genres */}
          <div className="stat-card">
            <h3 style={{ fontSize: "1.1rem", marginBottom: "16px" }}>Top Preferred Genres</h3>
            {insights?.top_genres.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>Interact with movies to calculate your affinity distribution.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {insights?.top_genres.map((g) => (
                  <div key={g.genre} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>{g.genre}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", width: "60%" }}>
                      <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.08)", borderRadius: "4px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.min(100, g.count * 25)}%`, background: "var(--primary)", borderRadius: "4px" }} />
                      </div>
                      <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", width: "30px" }}>{g.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AI Assistant Tab ── */}
      {activeTab === "ai" && (
        <div className="insights-container" style={{ maxWidth: "800px" }}>
          <div className="insights-header">
            <h1 style={{ fontSize: "2rem" }}>AI Conversational Discovery</h1>
            <p style={{ color: "var(--text-secondary)" }}>Ask for personalized recommendations grounded in catalog metadata & semantic vector profiles.</p>
          </div>

          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", minHeight: "420px", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, padding: "24px", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto", maxHeight: "480px" }}>
              {chatMessages.map((msg, idx) => (
                <div key={idx} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                  <div style={{
                    padding: "12px 18px",
                    borderRadius: "14px",
                    background: msg.role === "user" ? "var(--primary)" : "var(--bg-card)",
                    color: "white",
                    fontSize: "0.95rem",
                    lineHeight: 1.5,
                  }}>
                    {msg.text}
                  </div>
                  {msg.movies && (
                    <div style={{ display: "flex", gap: "12px", marginTop: "12px", overflowX: "auto", paddingBottom: "6px" }}>
                      {msg.movies.map((m) => (
                        <div key={m.id} style={{ width: "130px", flexShrink: 0, cursor: "pointer" }} onClick={() => setSelectedMovie(m)}>
                          {m.poster_path && (
                            <img src={`${TMDB_IMAGE_BASE}/w300${m.poster_path}`} alt={m.title} style={{ width: "100%", borderRadius: "8px" }} />
                          )}
                          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: "4px", color: "white" }}>{m.title}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <form onSubmit={handleAiSubmit} style={{ padding: "16px 20px", borderTop: "1px solid var(--border-subtle)", display: "flex", gap: "12px" }}>
              <input
                type="text"
                className="search-input"
                style={{ height: "44px" }}
                placeholder="e.g. Recommend a dark sci-fi thriller with great plot twists..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
              <button type="submit" className="glow-btn" style={{ padding: "0 22px" }}>
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Movie Detail Modal ── */}
      {selectedMovie && (
        <div className="modal-backdrop" onClick={() => setSelectedMovie(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setSelectedMovie(null)}>✕</button>

            <div className="modal-hero">
              <img
                src={selectedMovie.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${selectedMovie.backdrop_path}` : `${TMDB_IMAGE_BASE}/w500${selectedMovie.poster_path}`}
                alt={selectedMovie.title}
                className="modal-backdrop-img"
              />
              <div className="modal-hero-overlay" />
            </div>

            <div className="modal-body">
              <div className="modal-title-row">
                <h2 style={{ fontSize: "2rem", fontWeight: 800 }}>{selectedMovie.title}</h2>
                <span style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>({selectedMovie.release_year})</span>
              </div>

              <div className="hero-meta">
                <span className="rating">★ {selectedMovie.tmdb_rating ? selectedMovie.tmdb_rating.toFixed(1) : "N/A"}/10</span>
                {selectedMovie.runtime_minutes && <span>{selectedMovie.runtime_minutes} mins</span>}
                <span style={{ textTransform: "uppercase" }}>{selectedMovie.original_language}</span>
                {selectedMovie.genres?.map((g) => (
                  <span key={g} className="genre-tag">{g}</span>
                ))}
              </div>

              {selectedMovie.reason && (
                <div style={{ background: "rgba(16, 185, 129, 0.12)", border: "1px solid rgba(16, 185, 129, 0.3)", padding: "10px 16px", borderRadius: "8px", color: "#a7f3d0", fontSize: "0.88rem" }}>
                  💡 <strong>Recommendation rationale:</strong> {selectedMovie.reason}
                </div>
              )}

              <p style={{ lineHeight: 1.7, color: "#d1d5db" }}>
                {selectedMovie.overview || "In-depth synopsis and production telemetry available in our multi-source movie intelligence registry."}
              </p>

              {/* Interaction Action Buttons */}
              <div className="modal-actions">
                <button className="glow-btn" onClick={() => handleInteraction(selectedMovie, "watched")}>
                  ✓ Mark Watched
                </button>
                <button className="ghost-btn" onClick={() => handleInteraction(selectedMovie, "liked")}>
                  👍 Like
                </button>
                <button className="ghost-btn" onClick={() => handleInteraction(selectedMovie, "disliked")}>
                  👎 Dislike
                </button>
                <button className="ghost-btn" onClick={() => handleInteraction(selectedMovie, "watchlist")}>
                  + Watchlist
                </button>
              </div>

              {/* Similar Movies Row */}
              {similarMovies.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <h4 style={{ fontSize: "1.1rem", marginBottom: "12px", color: "var(--text-white)" }}>Similar Titles (Content Embeddings)</h4>
                  <div style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "8px" }}>
                    {similarMovies.map((sim) => (
                      <div
                        key={sim.id}
                        style={{ width: "120px", flexShrink: 0, cursor: "pointer" }}
                        onClick={() => setSelectedMovie(sim)}
                      >
                        {sim.poster_path && (
                          <img src={`${TMDB_IMAGE_BASE}/w300${sim.poster_path}`} alt={sim.title} style={{ width: "100%", borderRadius: "6px" }} />
                        )}
                        <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: "4px", color: "var(--text-white)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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

      {/* ── Toast Notification ── */}
      {toast && <div className="toast-notice">{toast}</div>}
    </div>
  );
}

// Sub-component for individual Movie Card
function MovieCardComponent({ movie, onClick }: { movie: Movie; onClick: () => void }) {
  return (
    <div className="movie-card" onClick={onClick}>
      <div className="poster-wrap">
        {movie.poster_path ? (
          <img src={`${TMDB_IMAGE_BASE}/w500${movie.poster_path}`} alt={movie.title} className="movie-poster" loading="lazy" />
        ) : (
          <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "16px", color: "#666" }}>
            {movie.title}
          </div>
        )}
        {movie.tmdb_rating && (
          <div className="card-rating-badge">
            ★ {movie.tmdb_rating.toFixed(1)}
          </div>
        )}
        {movie.reason && (
          <div className="card-reason-tag" title={movie.reason}>
            {movie.reason}
          </div>
        )}
      </div>
      <div className="card-info">
        <div className="card-title" title={movie.title}>{movie.title}</div>
        <div className="card-meta">
          <span>{movie.release_year || "—"}</span>
          <span>{movie.genres?.[0] || "Film"}</span>
        </div>
      </div>
    </div>
  );
}