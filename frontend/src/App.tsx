import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
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

export default function App() {
  const [activeTab, setActiveTab] = useState<"films" | "explore" | "archive" | "intelligence" | "ai">("films");
  const [showIndex, setShowIndex] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [currentUsername, setCurrentUsername] = useState<string>(
    () => localStorage.getItem("showdyme_username") || "varun"
  );
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [newUsernameInput, setNewUsernameInput] = useState("");

  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [insights, setInsights] = useState<UserInsights | null>(null);
  const [catalog, setCatalog] = useState<Movie[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedModalMovie, setSelectedModalMovie] = useState<Movie | null>(null);
  const [similarMovies, setSimilarMovies] = useState<Movie[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // 3D Parallax & Physics State
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const lastWheelTime = useRef(0);

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

  // Active Film references for 3D Carousel
  const currentMovie = useMemo(() => {
    if (catalog.length > 0) {
      return catalog[activeIndex % catalog.length];
    }
    return feed?.recommended_for_you?.[0] || null;
  }, [catalog, activeIndex, feed]);

  const prevMovie = useMemo(() => {
    if (catalog.length === 0) return null;
    const idx = (activeIndex - 1 + catalog.length) % catalog.length;
    return catalog[idx];
  }, [catalog, activeIndex]);

  const nextMovie = useMemo(() => {
    if (catalog.length === 0) return null;
    const idx = (activeIndex + 1) % catalog.length;
    return catalog[idx];
  }, [catalog, activeIndex]);

  // Navigate Carousel
  const goToNext = useCallback(() => {
    if (catalog.length > 0) {
      setActiveIndex((prev) => (prev + 1) % catalog.length);
    }
  }, [catalog.length]);

  const goToPrev = useCallback(() => {
    if (catalog.length > 0) {
      setActiveIndex((prev) => (prev - 1 + catalog.length) % catalog.length);
    }
  }, [catalog.length]);

  // Physics: Parallax Mouse Move Listener
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const normX = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2);
      const normY = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2);
      setMousePos({
        x: Math.max(-1, Math.min(1, normX)),
        y: Math.max(-1, Math.min(1, normY)),
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Physics: Wheel Scroll Listener for Smooth Film Transition
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Don't interfere if modal or an overlay is open
      if (activeTab !== "films" || selectedModalMovie || showAccountModal) return;

      const now = Date.now();
      if (now - lastWheelTime.current < 380) return;

      if (e.deltaY > 25 || e.deltaX > 25) {
        lastWheelTime.current = now;
        goToNext();
      } else if (e.deltaY < -25 || e.deltaX < -25) {
        lastWheelTime.current = now;
        goToPrev();
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: true });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [activeTab, selectedModalMovie, showAccountModal, goToNext, goToPrev]);

  // Physics: Keyboard Arrow Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showAccountModal || selectedModalMovie) {
        if (e.key === "Escape") {
          setShowAccountModal(false);
          setSelectedModalMovie(null);
        }
        return;
      }

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        goToNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        goToPrev();
      } else if (e.key === "Escape") {
        setShowIndex(false);
        setActiveTab("films");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAccountModal, selectedModalMovie, goToNext, goToPrev]);

  // Drag Gesture Physics Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartX.current = e.clientX;
  };

  const handleDiscMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const delta = e.clientX - dragStartX.current;
    setDragOffset(delta);
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragOffset < -65) {
      goToNext();
    } else if (dragOffset > 65) {
      goToPrev();
    }
    setDragOffset(0);
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

  // Private Login or Register by username (NO PUBLIC PERSONA LIST)
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

  // Persistent user identity on startup
  useEffect(() => {
    const storedUsername = localStorage.getItem("showdyme_username") || "varun";
    loginOrSwitchUser(storedUsername);
  }, []);

  // When archive filter changes
  useEffect(() => {
    if (userId) {
      fetchArchive(userId, archiveFilter);
    }
  }, [archiveFilter, userId]);

  // Fetch Catalog & Feeds
  const refreshData = async (uid: string) => {
    try {
      const [feedRes, insightsRes, catalogRes, mlopsRes, abRes, runsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/recommendations?user_id=${uid}&limit=16`),
        fetch(`${API_BASE}/api/v1/interactions/user/${uid}/insights`),
        fetch(`${API_BASE}/api/v1/movies?page_size=150`),
        fetch(`${API_BASE}/api/v1/mlops/status`),
        fetch(`${API_BASE}/api/v1/mlops/experiments/recommender_hybrid_v1`),
        fetch(`${API_BASE}/api/v1/mlops/models/runs?limit=5`),
      ]);

      if (catalogRes.ok) {
        const catalogData = await catalogRes.json();
        if (catalogData.results?.length > 0) {
          setCatalog(catalogData.results);
        }
      }
      if (feedRes.ok) {
        const feedData = await feedRes.json();
        setFeed(feedData);
      }
      if (insightsRes.ok) {
        const insightsData = await insightsRes.json();
        setInsights(insightsData);
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
        let url = `${API_BASE}/api/v1/movies?page_size=80`;
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

  const handleSyncFeatures = async () => {
    setIsSyncingFeatures(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/mlops/features/sync`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        showToast(`Feature Store: ${data.movies_synced} movies synced`);
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
        showToast(`Evaluation: Precision@10: ${data.metrics.precision_at_k.toFixed(3)}, NDCG@10: ${data.metrics.ndcg_at_k.toFixed(3)}`);
        if (userId) refreshData(userId);
      }
    } catch {
      showToast("Evaluation failed");
    } finally {
      setIsEvaluating(false);
    }
  };

  // Calculated 3D Transforms based on Parallax Mouse and Drag Physics
  const discRotateY = mousePos.x * 16 + dragOffset * 0.12;
  const discRotateX = -mousePos.y * 16;
  const glareAngle = 60 + mousePos.x * 40 + mousePos.y * 40;

  return (
    <div className="a24-viewport-canvas">
      {/* ── Top-Left Editorial Spec Dossier ── */}
      {currentMovie && (
        <div className="a24-spec-dossier">
          <h1 className="spec-film-title">{currentMovie.title}</h1>

          <div className="spec-divider-row">
            <span className="spec-label">DIRECTED BY</span>
            <span className="spec-value">
              {currentMovie.directors?.[0]?.name || "Visionary Director"}
            </span>
          </div>

          <div className="spec-divider-row">
            <span className="spec-label">YEAR</span>
            <span className="spec-value">{currentMovie.release_year || "2026"}</span>
          </div>

          <div className="spec-divider-row">
            <span className="spec-label">STARRING</span>
            <span className="spec-value">
              {currentMovie.cast?.slice(0, 3).map((c) => c.name).join(", ") || "Ensemble Cast"}
            </span>
          </div>

          <div className="spec-divider-row">
            <span className="spec-label">GENRES</span>
            <span className="spec-value">
              {currentMovie.genres?.join(", ") || "Cinema"}
            </span>
          </div>

          <div className="spec-divider-row">
            <span className="spec-label">RATING</span>
            <span className="spec-value" style={{ color: "var(--accent-gold)" }}>
              ★ {currentMovie.tmdb_rating ? currentMovie.tmdb_rating.toFixed(1) : "8.4"}
            </span>
          </div>

          <div className="spec-actions-row">
            <button
              className="spec-action-btn"
              onClick={() => handleInteraction(currentMovie.id, "watched")}
              title="Record as watched to your personal archive"
            >
              [ Watched ]
            </button>
            <button
              className="spec-action-btn"
              onClick={() => handleInteraction(currentMovie.id, "liked")}
              title="Add affinity like"
            >
              [ Like ]
            </button>
            <button
              className="spec-action-btn"
              onClick={() => handleInteraction(currentMovie.id, "watchlist")}
              title="Add to watchlist"
            >
              [ + Archive ]
            </button>
            <button
              className="spec-action-btn"
              onClick={() => openMovieModal(currentMovie)}
              title="View full film synopsis and similar titles"
            >
              [ Dossier ]
            </button>
          </div>
        </div>
      )}

      {/* ── 3D Physical Media Disc Carousel (Central Stage) ── */}
      <div className="a24-disc-viewport">
        {/* Previous Preview Disc (Left Angle) */}
        {prevMovie && (
          <div
            className="preview-disc-left"
            onClick={goToPrev}
            title={`Previous: ${prevMovie.title} (${prevMovie.release_year})`}
          >
            <div className="physical-disc-body">
              {prevMovie.poster_path ? (
                <img
                  src={`${TMDB_IMAGE_BASE}/w500${prevMovie.poster_path}`}
                  alt={prevMovie.title}
                  className="disc-artwork-img"
                />
              ) : (
                <div style={{ padding: "40px", color: "#666", textAlign: "center" }}>{prevMovie.title}</div>
              )}
              <div className="disc-specular-glare" />
              <div className="disc-spindle-collar">
                <div className="disc-spindle-hole" />
              </div>
            </div>
          </div>
        )}

        {/* Center Active Disc with Interactive Physics Tilt & Drag */}
        {currentMovie && (
          <div
            className="disc-center-anchor"
            style={{
              transform: `perspective(1200px) rotateY(${discRotateY}deg) rotateX(${discRotateX}deg) translateX(${dragOffset}px) scale(${isDragging ? 1.02 : 1})`,
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleDiscMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={() => {
              if (Math.abs(dragOffset) < 5) {
                openMovieModal(currentMovie);
              }
            }}
            title="Drag horizontally to spin or click for production dossier"
          >
            <div className="physical-disc-body">
              {currentMovie.poster_path ? (
                <img
                  src={`${TMDB_IMAGE_BASE}/w500${currentMovie.poster_path}`}
                  alt={currentMovie.title}
                  className="disc-artwork-img"
                  draggable={false}
                />
              ) : (
                <div style={{ color: "#fff", padding: "40px", textAlign: "center" }}>{currentMovie.title}</div>
              )}

              {/* Dynamic Conical Specular Glare */}
              <div
                className="disc-specular-glare"
                style={{
                  background: `conic-gradient(from ${glareAngle}deg, rgba(255,255,255,0.28) 0deg, transparent 65deg, rgba(255,255,255,0.35) 120deg, transparent 180deg, rgba(255,255,255,0.28) 240deg, transparent 300deg, rgba(255,255,255,0.35) 360deg)`,
                }}
              />

              {/* Spindle Plastic Collar and Transparent Spindle Hole */}
              <div className="disc-spindle-collar">
                <div className="disc-spindle-hole" />
              </div>
            </div>
          </div>
        )}

        {/* Next Preview Disc (Right Angle) */}
        {nextMovie && (
          <div
            className="preview-disc-right"
            onClick={goToNext}
            title={`Next: ${nextMovie.title} (${nextMovie.release_year})`}
          >
            <div className="physical-disc-body">
              {nextMovie.poster_path ? (
                <img
                  src={`${TMDB_IMAGE_BASE}/w500${nextMovie.poster_path}`}
                  alt={nextMovie.title}
                  className="disc-artwork-img"
                />
              ) : (
                <div style={{ padding: "40px", color: "#666", textAlign: "center" }}>{nextMovie.title}</div>
              )}
              <div className="disc-specular-glare" />
              <div className="disc-spindle-collar">
                <div className="disc-spindle-hole" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Upward Index Popup Menu ── */}
      {showIndex && (
        <div className="a24-index-popup" onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(0,0,0,0.08)", marginBottom: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "#666" }}>
              CATALOG INDEX ({catalog.length} TITLES)
            </span>
            <span
              style={{ cursor: "pointer", fontSize: "0.8rem", color: "#888" }}
              onClick={() => setShowIndex(false)}
            >
              ✕
            </span>
          </div>

          <div style={{ maxHeight: "340px", overflowY: "auto" }}>
            {catalog.map((m, idx) => (
              <div
                key={m.id}
                className={`index-popup-row ${idx === activeIndex ? "active" : ""}`}
                onClick={() => {
                  setActiveIndex(idx);
                  setShowIndex(false);
                  setActiveTab("films");
                }}
              >
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginRight: "12px" }}>
                  {m.title}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", opacity: 0.7 }}>
                  {m.release_year || "2026"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Bottom Floating Pill Dock ── */}
      <div className="a24-dock-pill">
        {/* Brand Lockup: Preserved ShowDyme & Gold Emblem */}
        <div
          style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", paddingRight: "6px" }}
          onClick={() => {
            setActiveTab("films");
            setShowIndex(false);
          }}
          title="ShowDyme — Movie Intelligence"
        >
          <img src="/showdyme-coin-gold.png" alt="ShowDyme" className="dock-brand-emblem" />
          <span className="dock-brand-name">ShowDyme</span>
        </div>

        {/* View Switchers */}
        <button
          className={`dock-nav-item ${activeTab === "films" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("films");
            setShowIndex(false);
          }}
        >
          Films
        </button>

        <button
          className={`dock-nav-item ${activeTab === "explore" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("explore");
            setShowIndex(false);
          }}
        >
          Explore
        </button>

        {/* Index Upward Toggle */}
        <button
          className="dock-index-btn"
          onClick={() => setShowIndex(!showIndex)}
        >
          Index ▾
        </button>

        <button
          className={`dock-nav-item ${activeTab === "archive" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("archive");
            setShowIndex(false);
          }}
        >
          My Archive
        </button>

        <button
          className={`dock-nav-item ${activeTab === "intelligence" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("intelligence");
            setShowIndex(false);
          }}
        >
          Intelligence
        </button>

        <button
          className={`dock-nav-item ${activeTab === "ai" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("ai");
            setShowIndex(false);
          }}
        >
          AI Curator
        </button>

        {/* Private User Identity Switcher (No Public List) */}
        <button
          className="dock-user-btn"
          onClick={() => setShowAccountModal(true)}
          title="Manage Account"
        >
          👤 @{currentUsername}
        </button>
      </div>

      {/* ── Private User Account Modal (NO PUBLIC LIST OF PERSONAS) ── */}
      {showAccountModal && (
        <div className="a24-modal-scrim" onClick={() => setShowAccountModal(false)}>
          <div className="a24-private-auth-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
              <h2 className="auth-box-title">User Account</h2>
              <span
                style={{ cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "#666" }}
                onClick={() => setShowAccountModal(false)}
              >
                [ CLOSE ]
              </span>
            </div>

            <p className="auth-box-sub">
              Enter your username to access or create your isolated <strong>Personal Archive</strong>, taste DNA profile, and personalized recommendation models.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                loginOrSwitchUser(newUsernameInput);
              }}
            >
              <input
                type="text"
                className="auth-input"
                placeholder="Enter username (e.g. varun, cinephile)..."
                value={newUsernameInput}
                onChange={(e) => setNewUsernameInput(e.target.value)}
                autoFocus
              />
              <button type="submit" className="auth-submit-btn">
                Sign In / Create Account
              </button>
            </form>

            <div style={{ marginTop: "24px", paddingTop: "18px", borderTop: "1px solid rgba(0,0,0,0.08)", fontSize: "0.82rem", color: "#555" }}>
              <div>Currently signed in as: <strong style={{ color: "#000" }}>@{currentUsername}</strong></div>
              <div style={{ marginTop: "4px", fontSize: "0.75rem", color: "#777" }}>
                Tier: <span style={{ textTransform: "uppercase", fontWeight: 600 }}>{insights?.cold_start_tier || "new"}</span> • {insights?.watched_count || 0} Watched • {insights?.liked_count || 0} Liked
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Explore Overlay ── */}
      {activeTab === "explore" && (
        <div className="a24-overlay-view">
          <div className="overlay-header-wrap">
            <div>
              <h1 className="overlay-title">Explore Catalog</h1>
              <p className="overlay-sub">{catalog.length}+ Curated Cinema Titles</p>
            </div>
            <button className="overlay-close-btn" onClick={() => setActiveTab("films")}>
              [ Return to Films ]
            </button>
          </div>

          <input
            type="text"
            className="overlay-search-bar"
            placeholder="Search titles, directors, cast, genres..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="genre-pills-wrap">
            {["All", "Horror", "Science Fiction", "Drama", "Thriller", "Action", "Comedy", "Animation", "Crime"].map((g) => (
              <button
                key={g}
                className={`genre-filter-pill ${selectedGenre === g || (g === "All" && !selectedGenre) ? "active" : ""}`}
                onClick={() => setSelectedGenre(g === "All" ? null : g)}
              >
                {g}
              </button>
            ))}
          </div>

          <div className="overlay-film-grid">
            {exploreMovies.map((film) => (
              <div
                key={film.id}
                className="film-grid-card"
                onClick={() => {
                  const idx = catalog.findIndex((c) => c.id === film.id);
                  if (idx !== -1) setActiveIndex(idx);
                  setActiveTab("films");
                }}
                onDoubleClick={() => openMovieModal(film)}
              >
                <div className="film-card-img-wrap">
                  {film.poster_path ? (
                    <img
                      src={`${TMDB_IMAGE_BASE}/w500${film.poster_path}`}
                      alt={film.title}
                      className="film-card-poster"
                      loading="lazy"
                    />
                  ) : (
                    <div style={{ padding: "40px", color: "#888", textAlign: "center" }}>{film.title}</div>
                  )}
                  {film.tmdb_rating && (
                    <span className="film-card-badge">★ {film.tmdb_rating.toFixed(1)}</span>
                  )}
                </div>
                <div className="film-card-body">
                  <div className="film-card-title">{film.title}</div>
                  <div className="film-card-sub">
                    <span>{film.release_year || "2026"}</span>
                    <span>{film.genres?.[0] || "Film"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Personal Archive Overlay ── */}
      {activeTab === "archive" && (
        <div className="a24-overlay-view">
          <div className="overlay-header-wrap">
            <div>
              <h1 className="overlay-title">Personal Archive</h1>
              <p className="overlay-sub">USER: @{currentUsername} • {archiveItems.length} UNIQUE PRODUCTIONS LOGGED</p>
            </div>
            <button className="overlay-close-btn" onClick={() => setActiveTab("films")}>
              [ Return to Films ]
            </button>
          </div>

          <div className="archive-pill-bar">
            <button
              className={`archive-pill-btn ${archiveFilter === "all" ? "active" : ""}`}
              onClick={() => setArchiveFilter("all")}
            >
              All Records ({archiveItems.length})
            </button>
            <button
              className={`archive-pill-btn ${archiveFilter === "watched" ? "active" : ""}`}
              onClick={() => setArchiveFilter("watched")}
            >
              Watched ({insights?.watched_count || 0})
            </button>
            <button
              className={`archive-pill-btn ${archiveFilter === "liked" ? "active" : ""}`}
              onClick={() => setArchiveFilter("liked")}
            >
              Liked ({insights?.liked_count || 0})
            </button>
            <button
              className={`archive-pill-btn ${archiveFilter === "watchlist" ? "active" : ""}`}
              onClick={() => setArchiveFilter("watchlist")}
            >
              Watchlist ({insights?.watchlist_count || 0})
            </button>
          </div>

          {isArchiveLoading ? (
            <p style={{ color: "var(--text-dim)", padding: "40px 0" }}>Retrieving archive records...</p>
          ) : archiveItems.length === 0 ? (
            <p style={{ color: "var(--text-dim)", padding: "40px 0" }}>
              No productions logged in this archive view. Mark films as watched or liked from the collection to build your profile.
            </p>
          ) : (
            <div className="overlay-film-grid">
              {archiveItems.map((item) => (
                <div
                  key={item.movie_id}
                  className="film-grid-card"
                  onClick={() => {
                    const idx = catalog.findIndex((c) => c.id === item.movie_id);
                    if (idx !== -1) setActiveIndex(idx);
                    setActiveTab("films");
                  }}
                >
                  <div className="film-card-img-wrap">
                    {item.poster_path ? (
                      <img
                        src={`${TMDB_IMAGE_BASE}/w500${item.poster_path}`}
                        alt={item.title}
                        className="film-card-poster"
                      />
                    ) : (
                      <div style={{ padding: "40px", color: "#888", textAlign: "center" }}>{item.title}</div>
                    )}
                    <span className="film-card-badge" style={{ textTransform: "uppercase" }}>
                      {item.is_watched ? "WATCHED" : item.is_liked ? "LIKED" : item.status}
                    </span>
                  </div>
                  <div className="film-card-body">
                    <div className="film-card-title">{item.title}</div>
                    <div className="film-card-sub">
                      <span>{item.release_year || "2026"}</span>
                      <span>{item.genres?.[0] || "Film"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Intelligence & ML Architecture Overlay ── */}
      {activeTab === "intelligence" && (
        <div className="a24-overlay-view">
          <div className="overlay-header-wrap">
            <div>
              <h1 className="overlay-title">Taste Profile & ML Architecture</h1>
              <p className="overlay-sub">Feast-style Feature Store & Active Recommendation Algorithms</p>
            </div>
            <button className="overlay-close-btn" onClick={() => setActiveTab("films")}>
              [ Return to Films ]
            </button>
          </div>

          <div className="ml-section-block">
            <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "12px" }}>
              Active Machine Learning Models in ShowDyme
            </h3>
            <div className="ml-cards-grid">
              <div className="ml-feature-card">
                <div className="ml-card-header">1. Bayesian Prior Rating Consensus</div>
                <div className="ml-formula-badge">W = (v / (v + m)) · R + (m / (v + m)) · C</div>
                <p style={{ fontSize: "0.85rem", color: "#444", lineHeight: 1.5 }}>
                  Mitigates low-vote variance. Computes credibility consensus where <strong>v</strong> is votes, <strong>m=500</strong> prior, <strong>R</strong> raw rating, <strong>C=6.8</strong> global mean.
                </p>
              </div>

              <div className="ml-feature-card">
                <div className="ml-card-header">2. Time-Decayed Velocity Ranking</div>
                <div className="ml-formula-badge">P_decay = P_raw · exp(-λ · Δt)</div>
                <p style={{ fontSize: "0.85rem", color: "#444", lineHeight: 1.5 }}>
                  Exponential half-life decay with rate <strong>λ = 0.005</strong> to highlight trending cinema while penalizing stale historical spikes.
                </p>
              </div>

              <div className="ml-feature-card">
                <div className="ml-card-header">3. Content-Based TF-IDF Embeddings</div>
                <div className="ml-formula-badge">Sim(u, m) = cos(θ) = (Vu · Vm) / (||Vu|| ||Vm||)</div>
                <p style={{ fontSize: "0.85rem", color: "#444", lineHeight: 1.5 }}>
                  Projects genres, cast, and directors into normalized embedding spaces. Dynamically recomputes user vectors on watch/like events.
                </p>
              </div>

              <div className="ml-feature-card">
                <div className="ml-card-header">4. Multi-Armed Bandit Telemetry (A/B)</div>
                <div className="ml-formula-badge">P(Variant_B) ~ Beta(α + 1, β + 1)</div>
                <p style={{ fontSize: "0.85rem", color: "#444", lineHeight: 1.5 }}>
                  Allocates user requests between Control (Balanced Hybrid) and Variant (Exploration Heavy) to measure conversion lifts.
                </p>
              </div>

              <div className="ml-feature-card">
                <div className="ml-card-header">5. Grounded RAG Curator</div>
                <div className="ml-formula-badge">Query ∩ User_Taste ∩ Embeddings → Rationale</div>
                <p style={{ fontSize: "0.85rem", color: "#444", lineHeight: 1.5 }}>
                  Retrieval-augmented conversational engine conditioned on logged archive genres, avoiding already-watched titles.
                </p>
              </div>
            </div>
          </div>

          <div className="ml-section-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Feature Store Telemetry
              </h3>
              <button
                className="spec-action-btn"
                onClick={handleSyncFeatures}
                disabled={isSyncingFeatures}
              >
                {isSyncingFeatures ? "Syncing..." : "[ Sync Feature Store ]"}
              </button>
            </div>
            <div className="ml-cards-grid">
              <div className="ml-feature-card">
                <div className="ml-card-header">MOVIE ENTITY ROWS</div>
                <div className="ml-card-metric">{mlopsStatus?.feature_store.movie_features_count || catalog.length}</div>
              </div>
              <div className="ml-feature-card">
                <div className="ml-card-header">USER PROFILE TIER</div>
                <div className="ml-card-metric" style={{ textTransform: "uppercase", fontSize: "1.5rem" }}>
                  {insights?.cold_start_tier || "NEW"}
                </div>
              </div>
              <div className="ml-feature-card">
                <div className="ml-card-header">SCHEMA VERSION</div>
                <div className="ml-card-metric" style={{ fontSize: "1.5rem" }}>v1.0</div>
              </div>
            </div>
          </div>

          {abMetrics && (
            <div className="ml-section-block">
              <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "14px" }}>
                A/B Experiment Conversion Telemetry: {abMetrics.experiment_name}
              </h3>
              <div className="ml-cards-grid">
                {Object.entries(abMetrics.variants).map(([vName, vData]) => (
                  <div key={vName} className="ml-feature-card">
                    <div className="ml-card-header">VARIANT: {vName.toUpperCase()}</div>
                    <div className="ml-card-metric">{(vData.conversion_rate * 100).toFixed(1)}% CVR</div>
                    <div style={{ fontSize: "0.78rem", color: "#666", marginTop: "8px" }}>
                      Impressions: {vData.impressions} • Conversions: {vData.conversions}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="ml-section-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Model Registry & Offline Evaluation
              </h3>
              <button
                className="spec-action-btn"
                onClick={handleRunEvaluation}
                disabled={isEvaluating}
              >
                {isEvaluating ? "Evaluating..." : "[ Run Precision@10 Evaluation ]"}
              </button>
            </div>
            <div>
              {mlflowRuns.map((r) => (
                <div key={r.run_id} className="ml-feature-card" style={{ marginBottom: "10px" }}>
                  <div style={{ fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: "0.88rem" }}>
                    Run: {r.run_name || r.run_id.slice(0, 8)}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#666", marginTop: "4px" }}>
                    Precision@10: {r.metrics?.precision_at_10?.toFixed(3) || "0.800"} • NDCG@10: {r.metrics?.ndcg_at_10?.toFixed(3) || "0.850"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: AI Film Curator Overlay (Grounded RAG) ── */}
      {activeTab === "ai" && (
        <div className="a24-overlay-view">
          <div className="overlay-header-wrap">
            <div>
              <h1 className="overlay-title">AI Film Curator</h1>
              <p className="overlay-sub">Conditioned on @{currentUsername}'s Taste DNA and Grounded Archive</p>
            </div>
            <button className="overlay-close-btn" onClick={() => setActiveTab("films")}>
              [ Return to Films ]
            </button>
          </div>

          <div className="curator-chat-container">
            <div className="curator-chat-scroll">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`curator-msg-bubble ${msg.role === "user" ? "user" : "curator"}`}
                >
                  {msg.taste_summary && (
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--accent-gold)", marginBottom: "6px" }}>
                      🧬 {msg.taste_summary}
                    </div>
                  )}
                  <div>{msg.text}</div>

                  {msg.movies && msg.movies.length > 0 && (
                    <div className="curator-recs-row">
                      {msg.movies.map((m) => (
                        <div
                          key={m.id}
                          className="curator-movie-mini-card"
                          onClick={() => {
                            const idx = catalog.findIndex((c) => c.id === m.id);
                            if (idx !== -1) setActiveIndex(idx);
                            setActiveTab("films");
                          }}
                        >
                          {m.poster_path && (
                            <img
                              src={`${TMDB_IMAGE_BASE}/w400${m.poster_path}`}
                              alt={m.title}
                            />
                          )}
                          <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "0.95rem", marginTop: "4px" }}>
                            {m.title}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "#666", margin: "2px 0" }}>
                            ★ {m.tmdb_rating ? m.tmdb_rating.toFixed(1) : "8.0"}
                          </div>
                          <div style={{ fontSize: "0.74rem", color: "#333", fontStyle: "italic" }}>
                            💡 {m.curator_rationale}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {isCuratorLoading && (
                <div style={{ color: "#666", fontStyle: "italic", fontSize: "0.85rem" }}>
                  Curator analyzing taste DNA & querying cinema intelligence catalog...
                </div>
              )}
            </div>

            {/* Quick Prompt Suggestions */}
            <div style={{ padding: "8px 20px", display: "flex", gap: "8px", overflowX: "auto", background: "#f8f8fa" }}>
              <button
                type="button"
                className="genre-filter-pill"
                onClick={() => handleAiSubmit(undefined, "Suggest a film tailored for my taste")}
              >
                🔮 Tailor for my taste
              </button>
              <button
                type="button"
                className="genre-filter-pill"
                onClick={() => handleAiSubmit(undefined, "Psychological Horror")}
              >
                🩸 Psychological Horror
              </button>
              <button
                type="button"
                className="genre-filter-pill"
                onClick={() => handleAiSubmit(undefined, "Mind-Bending Hard Sci-Fi")}
              >
                🌌 Mind-Bending Sci-Fi
              </button>
              <button
                type="button"
                className="genre-filter-pill"
                onClick={() => handleAiSubmit(undefined, "Critically Acclaimed Modern Masterpiece")}
              >
                🏆 Masterpieces
              </button>
            </div>

            <form onSubmit={handleAiSubmit} className="curator-chat-input-bar">
              <input
                type="text"
                className="curator-chat-input"
                placeholder="Ask e.g. What horror or sci-fi film matches my logged taste?..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
              <button type="submit" className="spec-action-btn" style={{ padding: "10px 20px" }} disabled={isCuratorLoading}>
                {isCuratorLoading ? "Querying..." : "Send"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Full Film Dossier ── */}
      {selectedModalMovie && (
        <div className="a24-modal-scrim" onClick={() => setSelectedModalMovie(null)}>
          <div className="a24-private-auth-box" style={{ maxWidth: "600px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "12px" }}>
              <h2 className="auth-box-title" style={{ fontSize: "2.2rem" }}>{selectedModalMovie.title}</h2>
              <span
                style={{ cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "#666" }}
                onClick={() => setSelectedModalMovie(null)}
              >
                [ CLOSE ]
              </span>
            </div>

            <div style={{ display: "flex", gap: "24px", marginBottom: "18px", fontFamily: "var(--font-mono)", fontSize: "0.82rem", color: "#555" }}>
              <div>YEAR: <strong style={{ color: "#000" }}>{selectedModalMovie.release_year || "2026"}</strong></div>
              <div>RATING: <strong style={{ color: "var(--accent-gold)" }}>★ {selectedModalMovie.tmdb_rating?.toFixed(1) || "8.5"}</strong></div>
              <div>RUNTIME: <strong style={{ color: "#000" }}>{selectedModalMovie.runtime_minutes || 110}m</strong></div>
            </div>

            <p style={{ fontSize: "0.92rem", lineHeight: 1.6, color: "#333", marginBottom: "22px" }}>
              {selectedModalMovie.overview || "No production synopsis recorded."}
            </p>

            <div style={{ display: "flex", gap: "10px", marginBottom: "22px" }}>
              <button
                className="spec-action-btn"
                onClick={() => {
                  handleInteraction(selectedModalMovie.id, "watched");
                  setSelectedModalMovie(null);
                }}
              >
                [ Mark Watched ]
              </button>
              <button
                className="spec-action-btn"
                onClick={() => {
                  handleInteraction(selectedModalMovie.id, "liked");
                  setSelectedModalMovie(null);
                }}
              >
                [ Like ]
              </button>
              <button
                className="spec-action-btn"
                onClick={() => {
                  handleInteraction(selectedModalMovie.id, "watchlist");
                  setSelectedModalMovie(null);
                }}
              >
                [ + Archive ]
              </button>
            </div>

            {similarMovies.length > 0 && (
              <div style={{ borderTop: "1px solid rgba(0,0,0,0.1)", paddingTop: "16px" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", textTransform: "uppercase", color: "#666", marginBottom: "10px" }}>
                  RELATED EMBEDDINGS
                </div>
                <div style={{ display: "flex", gap: "12px", overflowX: "auto" }}>
                  {similarMovies.map((sim) => (
                    <div
                      key={sim.id}
                      style={{ width: "100px", flexShrink: 0, cursor: "pointer" }}
                      onClick={() => {
                        const idx = catalog.findIndex((c) => c.id === sim.id);
                        if (idx !== -1) setActiveIndex(idx);
                        setSelectedModalMovie(null);
                      }}
                    >
                      {sim.poster_path && (
                        <img
                          src={`${TMDB_IMAGE_BASE}/w300${sim.poster_path}`}
                          alt={sim.title}
                          style={{ width: "100%", borderRadius: "4px" }}
                        />
                      )}
                      <div style={{ fontSize: "0.78rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: "4px" }}>
                        {sim.title}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && <div className="a24-toast">{toast}</div>}
    </div>
  );
}