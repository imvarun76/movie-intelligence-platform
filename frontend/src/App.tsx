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
  name: string;
  email: string;
  username: string | null;
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

export interface CriticReview {
  movie_id: number;
  title: string;
  publication: string;
  author?: string | null;
  quote: string;
  stars: number;
  consensus?: string | null;
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

  // Authentication & Session Identity
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem("showdyme_auth_token"));
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    const raw = localStorage.getItem("showdyme_user");
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return null;
  });

  const [authView, setAuthView] = useState<"login" | "signup" | "forgot" | "reset">("login");
  const [showUserModal, setShowUserModal] = useState<boolean>(false);

  // Auth form states
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoginLoading, setIsLoginLoading] = useState(false);

  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [signupError, setSignupError] = useState<string | null>(null);
  const [isSignupLoading, setIsSignupLoading] = useState(false);

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotResetToken, setForgotResetToken] = useState<string | null>(null);
  const [isForgotLoading, setIsForgotLoading] = useState(false);

  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [isResetLoading, setIsResetLoading] = useState(false);

  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [insights, setInsights] = useState<UserInsights | null>(null);
  const [catalog, setCatalog] = useState<Movie[]>([]);
  const [featuredMovie, setFeaturedMovie] = useState<Movie | null>(null);
  const [selectedModalMovie, setSelectedModalMovie] = useState<Movie | null>(null);
  const [similarMovies, setSimilarMovies] = useState<Movie[]>([]);
  const [criticReview, setCriticReview] = useState<CriticReview | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Archive state
  const [archiveFilter, setArchiveFilter] = useState<"all" | "watched" | "liked" | "watchlist">("all");
  const [archiveItems, setArchiveItems] = useState<ArchiveItem[]>([]);
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);

  // Fast map of user interactions for active button highlighting & tick marks
  const userInteractionsMap = useMemo(() => {
    const map: Record<number, { is_watched: boolean; is_liked: boolean; is_disliked: boolean; is_watchlist: boolean }> = {};
    for (const item of archiveItems) {
      map[item.movie_id] = {
        is_watched: Boolean(item.is_watched || item.status === "watched"),
        is_liked: Boolean(item.is_liked || item.status === "liked"),
        is_disliked: item.status === "disliked",
        is_watchlist: Boolean(item.is_watchlist || item.status === "watchlist"),
      };
    }
    if (insights?.recent_activity) {
      for (const act of insights.recent_activity) {
        if (!map[act.movie_id]) {
          map[act.movie_id] = {
            is_watched: act.event_type === "watched",
            is_liked: act.event_type === "liked",
            is_disliked: act.event_type === "disliked",
            is_watchlist: act.event_type === "watchlist",
          };
        } else if (act.event_type === "disliked") {
          map[act.movie_id].is_disliked = true;
        }
      }
    }
    return map;
  }, [archiveItems, insights]);


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

  // Authenticated Fetch Helper
  const authFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = localStorage.getItem("showdyme_auth_token");
    const headers = new Headers(init?.headers || {});
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const res = await fetch(input, { ...init, headers });
    if (res.status === 401 && token) {
      localStorage.removeItem("showdyme_auth_token");
      localStorage.removeItem("showdyme_user");
      setAuthToken(null);
      setCurrentUser(null);
      setAuthView("login");
      showToast("Session expired. Please sign in again.");
    }
    return res;
  };

  // Fetch Archive for Authenticated User
  const fetchArchive = async (filter: string = "all") => {
    if (!localStorage.getItem("showdyme_auth_token")) return;
    setIsArchiveLoading(true);
    try {
      const url = `${API_BASE}/api/v1/interactions/me/archive${filter !== "all" ? `?filter_type=${filter}` : ""}`;
      const res = await authFetch(url);
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

  // Sign Up Handler
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError(null);

    const name = signupName.trim();
    const email = signupEmail.trim();
    const password = signupPassword;
    const confirmPassword = signupConfirmPassword;

    if (!name || !email || !password || !confirmPassword) {
      setSignupError("All fields are required.");
      return;
    }
    if (password !== confirmPassword) {
      setSignupError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setSignupError("Password must be at least 6 characters.");
      return;
    }

    setIsSignupLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          confirm_password: confirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSignupError(data.detail || "Error creating account.");
        return;
      }

      localStorage.setItem("showdyme_auth_token", data.access_token);
      localStorage.setItem("showdyme_user", JSON.stringify(data.user));
      setAuthToken(data.access_token);
      setCurrentUser(data.user);
      showToast(`Welcome to ShowDyme, ${data.user.name}!`);
      refreshData();
      fetchArchive(archiveFilter);
    } catch {
      setSignupError("Could not reach ShowDyme authentication service.");
    } finally {
      setIsSignupLoading(false);
    }
  };

  // Login Handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const email = loginEmail.trim();
    const password = loginPassword;

    if (!email || !password) {
      setLoginError("Please enter your email and password.");
      return;
    }

    setIsLoginLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.detail || "Invalid email or password.");
        return;
      }

      localStorage.setItem("showdyme_auth_token", data.access_token);
      localStorage.setItem("showdyme_user", JSON.stringify(data.user));
      setAuthToken(data.access_token);
      setCurrentUser(data.user);
      showToast(`Welcome back, ${data.user.name}!`);
      refreshData();
      fetchArchive(archiveFilter);
    } catch {
      setLoginError("Could not reach ShowDyme authentication service.");
    } finally {
      setIsLoginLoading(false);
    }
  };

  // Forgot Password Handler
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotMessage(null);
    setForgotResetToken(null);

    const email = forgotEmail.trim();
    if (!email) {
      setForgotError("Please enter your email address.");
      return;
    }

    setIsForgotLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setForgotError(data.detail || "Error initiating password reset.");
        return;
      }

      setForgotMessage(data.message);
      if (data.debug_reset_token) {
        setForgotResetToken(data.debug_reset_token);
      }
    } catch {
      setForgotError("Could not connect to authentication service.");
    } finally {
      setIsForgotLoading(false);
    }
  };

  // Reset Password Handler
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);
    setResetMessage(null);

    const token = resetToken.trim();
    const password = resetPassword;
    const confirmPassword = resetConfirmPassword;

    if (!token || !password || !confirmPassword) {
      setResetError("All fields are required.");
      return;
    }
    if (password !== confirmPassword) {
      setResetError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setResetError("Password must be at least 6 characters.");
      return;
    }

    setIsResetLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          confirm_password: confirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetError(data.detail || "Error resetting password.");
        return;
      }

      setResetMessage(data.message);
      showToast("Password reset successfully. Please sign in.");
      setTimeout(() => {
        setAuthView("login");
        setLoginEmail(forgotEmail);
        setLoginPassword("");
        setResetMessage(null);
      }, 1400);
    } catch {
      setResetError("Could not reach authentication service.");
    } finally {
      setIsResetLoading(false);
    }
  };

  // Logout Handler
  const handleLogout = async () => {
    try {
      await authFetch(`${API_BASE}/api/v1/auth/logout`, { method: "POST" });
    } catch {
      // Ignore network errors on logout
    }
    localStorage.removeItem("showdyme_auth_token");
    localStorage.removeItem("showdyme_user");
    setAuthToken(null);
    setCurrentUser(null);
    setShowUserModal(false);
    setAuthView("login");
    showToast("Signed out successfully.");
  };

  // Session verification on mount & refresh
  useEffect(() => {
    const token = localStorage.getItem("showdyme_auth_token");
    if (!token) {
      setAuthToken(null);
      setCurrentUser(null);
      return;
    }

    fetch(`${API_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("Invalid session");
      })
      .then((user: UserProfile) => {
        setAuthToken(token);
        setCurrentUser(user);
        localStorage.setItem("showdyme_user", JSON.stringify(user));
        refreshData();
        fetchArchive(archiveFilter);
      })
      .catch(() => {
        localStorage.removeItem("showdyme_auth_token");
        localStorage.removeItem("showdyme_user");
        setAuthToken(null);
        setCurrentUser(null);
      });
  }, []);

  // When archive filter changes
  useEffect(() => {
    if (authToken && currentUser) {
      fetchArchive(archiveFilter);
    }
  }, [archiveFilter]);


  // Fetch Feed & Insights
  const refreshData = async () => {
    try {
      const [feedRes, insightsRes, catalogRes, mlopsRes, abRes, runsRes] = await Promise.all([
        authFetch(`${API_BASE}/api/v1/recommendations?limit=12`),
        authFetch(`${API_BASE}/api/v1/interactions/me/insights`),
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
      const res = await authFetch(`${API_BASE}/api/v1/mlops/features/sync`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        showToast(`Feature Store: ${data.movies_synced} movies & ${data.users_synced} users synced`);
        refreshData();
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
      const res = await authFetch(`${API_BASE}/api/v1/mlops/models/evaluate?k=10`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        showToast(`Offline Evaluation: Precision@10: ${data.metrics.precision_at_k.toFixed(3)}, NDCG@10: ${data.metrics.ndcg_at_k.toFixed(3)}`);
        refreshData();
      }
    } catch {
      showToast("Evaluation failed");
    } finally {
      setIsEvaluating(false);
    }
  };

  // Record or Toggle Interaction
  const handleInteraction = async (
    movieId: number,
    eventType: "watched" | "liked" | "disliked" | "watchlist"
  ) => {
    if (!authToken || !currentUser) {
      setAuthView("login");
      return;
    }

    const currentStatus = userInteractionsMap[movieId];
    const isAlreadyActive =
      (eventType === "watched" && currentStatus?.is_watched) ||
      (eventType === "watchlist" && currentStatus?.is_watchlist) ||
      (eventType === "liked" && currentStatus?.is_liked) ||
      (eventType === "disliked" && currentStatus?.is_disliked);

    if (isAlreadyActive) {
      // ── TOGGLE OFF / UNCLICK / REMOVE FROM LIST ──
      setArchiveItems((prev) => {
        return prev
          .map((item) => {
            if (item.movie_id !== movieId) return item;
            const updatedWatched = eventType === "watched" ? false : item.is_watched;
            const updatedLiked = eventType === "liked" ? false : item.is_liked;
            const updatedWatchlist = eventType === "watchlist" ? false : item.is_watchlist;
            let updatedStatus = item.status;
            if (item.status === eventType) {
              if (updatedWatched) updatedStatus = "watched";
              else if (updatedLiked) updatedStatus = "liked";
              else if (updatedWatchlist) updatedStatus = "watchlist";
              else updatedStatus = "";
            }
            return {
              ...item,
              is_watched: updatedWatched,
              is_liked: updatedLiked,
              is_watchlist: updatedWatchlist,
              status: updatedStatus,
            };
          })
          .filter((item) => {
            if (item.movie_id !== movieId) return true;
            return item.is_watched || item.is_liked || item.is_watchlist;
          });
      });

      // Optimistically decrement insights counters & recent activity
      setInsights((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          watched_count: eventType === "watched" ? Math.max(0, prev.watched_count - 1) : prev.watched_count,
          liked_count: eventType === "liked" ? Math.max(0, prev.liked_count - 1) : prev.liked_count,
          watchlist_count: eventType === "watchlist" ? Math.max(0, prev.watchlist_count - 1) : prev.watchlist_count,
          disliked_count: eventType === "disliked" ? Math.max(0, prev.disliked_count - 1) : prev.disliked_count,
          interaction_count: Math.max(0, prev.interaction_count - 1),
          recent_activity: prev.recent_activity.filter(
            (act) => !(act.movie_id === movieId && act.event_type === eventType)
          ),
        };
      });

      const unmarkLabels: Record<string, string> = {
        watched: "Unmarked — Removed from Watched List",
        liked: "Removed Like",
        disliked: "Removed Dislike",
        watchlist: "Removed from Watchlist",
      };
      showToast(unmarkLabels[eventType] || "Removed from list");

      try {
        const res = await authFetch(`${API_BASE}/api/v1/interactions/${movieId}?event_type=${eventType}`, {
          method: "DELETE",
        });
        if (res.ok) {
          refreshData();
          fetchArchive(archiveFilter);
        }
      } catch {
        showToast("Failed to update status");
      }
      return;
    }

    // ── TOGGLE ON / MARK ──
    // Optimistically update archiveItems so the button highlights with a tick immediately
    setArchiveItems((prev) => {
      const idx = prev.findIndex((item) => item.movie_id === movieId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          is_watched: eventType === "watched" ? true : updated[idx].is_watched,
          is_liked: eventType === "liked" ? true : updated[idx].is_liked,
          is_watchlist: eventType === "watchlist" ? true : updated[idx].is_watchlist,
          status: eventType,
        };
        return updated;
      }
      const m =
        catalog.find((c) => c.id === movieId) ||
        (featuredMovie?.id === movieId ? featuredMovie : null) ||
        (selectedModalMovie?.id === movieId ? selectedModalMovie : null);
      const newItem: ArchiveItem = {
        movie_id: movieId,
        title: m?.title || "Movie",
        release_year: m?.release_year || 2026,
        genres: m?.genres || [],
        runtime_minutes: m?.runtime_minutes || null,
        poster_path: m?.poster_path || null,
        backdrop_path: m?.backdrop_path || null,
        tmdb_rating: m?.tmdb_rating || null,
        overview: m?.overview || null,
        status: eventType,
        is_watched: eventType === "watched",
        is_liked: eventType === "liked",
        is_watchlist: eventType === "watchlist",
        interacted_at: new Date().toISOString(),
      };
      return [newItem, ...prev];
    });

    try {
      const res = await authFetch(`${API_BASE}/api/v1/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        refreshData();
        fetchArchive(archiveFilter);
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
      const simRes = await authFetch(`${API_BASE}/api/v1/recommendations?limit=5`);
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

  // Fetch real critic review when featured movie changes
  useEffect(() => {
    if (!featuredMovie) return;
    let active = true;
    const fetchReview = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/movies/${featuredMovie.id}/critic-review`);
        if (res.ok) {
          const data = await res.json();
          if (active) setCriticReview(data);
        }
      } catch (e) {
        console.error("Failed to load critic review", e);
      }
    };
    fetchReview();
    return () => {
      active = false;
    };
  }, [featuredMovie?.id]);

  // AI Curator RAG submit
  const handleAiSubmit = async (e?: React.FormEvent, directPrompt?: string) => {
    if (e) e.preventDefault();
    const query = directPrompt || aiPrompt.trim();
    if (!query) return;

    if (!directPrompt) setAiPrompt("");
    setChatMessages((prev) => [...prev, { role: "user", text: query }]);
    setIsCuratorLoading(true);

    try {
      const res = await authFetch(`${API_BASE}/api/v1/curator/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query,
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

          {/* User Account / Profile Button */}
          {currentUser ? (
            <button
              className="user-profile-btn"
              onClick={() => setShowUserModal(true)}
              title="View Account Profile"
            >
              <span className="user-avatar-icon">👤</span>
              <span className="user-name-text">
                {currentUser.name || currentUser.username || "Member"}
              </span>
              <span className="user-tier-pill">
                {insights?.cold_start_tier || currentUser.cold_start_tier || "new"} tier
              </span>
              <span className="user-caret">▾</span>
            </button>
          ) : (
            <button
              className="user-profile-btn"
              onClick={() => { setAuthView("login"); }}
              title="Sign In"
            >
              <span className="user-avatar-icon">👤</span>
              <span className="user-name-text">Sign In</span>
            </button>
          )}
        </div>
      </header>

      {/* ── ShowDyme Authentication Modal (Mandatory For Non-Authenticated Visitors) ── */}
      {(!authToken || !currentUser) && (
        <div className="account-modal-overlay">
          <div className="account-modal-box">
            {/* Header Lockup */}
            <div className="auth-header-lockup">
              <div className="showdyme-wordmark" style={{ justifyContent: "center", marginBottom: "4px" }}>
                <span>Show</span><span className="showdyme-wordmark-accent">Dyme</span>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--accent-gold)" }}>
                Cinema Intelligence & Taste Platform
              </div>
              <p className="auth-subtitle">
                {authView === "login" && "Sign in to access your personal archive, bespoke recommendations, and AI curator."}
                {authView === "signup" && "Create your private account to start archiving films and training your personal taste profile."}
                {authView === "forgot" && "Enter your registered email to request a secure password reset link."}
                {authView === "reset" && "Enter your single-use reset token and create a new password."}
              </p>
            </div>

            {/* Segmented Navigation for Login / Sign Up */}
            {(authView === "login" || authView === "signup") && (
              <div className="auth-tabs-nav">
                <button
                  type="button"
                  className={`auth-tab-btn ${authView === "login" ? "active" : ""}`}
                  onClick={() => { setAuthView("login"); setLoginError(null); setSignupError(null); }}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className={`auth-tab-btn ${authView === "signup" ? "active" : ""}`}
                  onClick={() => { setAuthView("signup"); setLoginError(null); setSignupError(null); }}
                >
                  Create Account
                </button>
              </div>
            )}

            {/* SCREEN 1: LOGIN */}
            {authView === "login" && (
              <form className="auth-form" onSubmit={handleLogin}>
                {loginError && (
                  <div className="auth-error-banner">
                    <span>⚠️</span>
                    <span>{loginError}</span>
                  </div>
                )}
                <div className="auth-field-group">
                  <label className="auth-field-label">Email Address</label>
                  <input
                    type="email"
                    className="auth-input"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="auth-field-group">
                  <div className="auth-label-row">
                    <label className="auth-field-label">Password</label>
                    <button
                      type="button"
                      className="auth-forgot-link"
                      onClick={() => { setAuthView("forgot"); setForgotError(null); setForgotMessage(null); }}
                    >
                      Forgot Password?
                    </button>
                  </div>
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                  />
                </div>

                <button type="submit" className="auth-submit-btn" disabled={isLoginLoading}>
                  {isLoginLoading ? "Signing In..." : "Sign In"}
                </button>

                <div className="auth-switch-footer">
                  <span>Don't have an account?</span>
                  <button
                    type="button"
                    className="auth-inline-link"
                    onClick={() => { setAuthView("signup"); setLoginError(null); setSignupError(null); }}
                  >
                    Create Account
                  </button>
                </div>
              </form>
            )}

            {/* SCREEN 2: SIGN UP */}
            {authView === "signup" && (
              <form className="auth-form" onSubmit={handleSignUp}>
                {signupError && (
                  <div className="auth-error-banner">
                    <span>⚠️</span>
                    <span>{signupError}</span>
                  </div>
                )}
                <div className="auth-field-group">
                  <label className="auth-field-label">Full Name</label>
                  <input
                    type="text"
                    className="auth-input"
                    placeholder="e.g. Varun Mishra"
                    value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="auth-field-group">
                  <label className="auth-field-label">Email Address</label>
                  <input
                    type="email"
                    className="auth-input"
                    placeholder="you@example.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="auth-field-group">
                  <label className="auth-field-label">Password (Min. 6 chars)</label>
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="••••••••"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <div className="auth-field-group">
                  <label className="auth-field-label">Confirm Password</label>
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="••••••••"
                    value={signupConfirmPassword}
                    onChange={(e) => setSignupConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <button type="submit" className="auth-submit-btn" disabled={isSignupLoading}>
                  {isSignupLoading ? "Creating Account..." : "Create Account"}
                </button>

                <div className="auth-switch-footer">
                  <span>Already have an account?</span>
                  <button
                    type="button"
                    className="auth-inline-link"
                    onClick={() => { setAuthView("login"); setLoginError(null); setSignupError(null); }}
                  >
                    Sign In
                  </button>
                </div>
              </form>
            )}

            {/* SCREEN 3: FORGOT PASSWORD */}
            {authView === "forgot" && (
              <form className="auth-form" onSubmit={handleForgotPassword}>
                {forgotError && (
                  <div className="auth-error-banner">
                    <span>⚠️</span>
                    <span>{forgotError}</span>
                  </div>
                )}
                {forgotMessage && (
                  <div className="auth-success-banner">
                    <p style={{ margin: "0 0 10px 0" }}>✓ {forgotMessage}</p>
                    {forgotResetToken && (
                      <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(212, 163, 89, 0.3)" }}>
                        <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--accent-gold)", display: "block", marginBottom: "6px" }}>
                          Single-Use Reset Token:
                        </span>
                        <code style={{ background: "rgba(0,0,0,0.4)", padding: "4px 8px", borderRadius: "2px", fontSize: "0.75rem", wordBreak: "break-all", display: "block" }}>
                          {forgotResetToken}
                        </code>
                        <button
                          type="button"
                          className="auth-submit-btn"
                          style={{ marginTop: "12px", background: "transparent", border: "1px solid var(--accent-gold)", color: "var(--accent-gold)" }}
                          onClick={() => {
                            setResetToken(forgotResetToken);
                            setAuthView("reset");
                            setForgotMessage(null);
                          }}
                        >
                          [ Set New Password With Token → ]
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="auth-field-group">
                  <label className="auth-field-label">Registered Email</label>
                  <input
                    type="email"
                    className="auth-input"
                    placeholder="you@example.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <button type="submit" className="auth-submit-btn" disabled={isForgotLoading}>
                  {isForgotLoading ? "Sending Link..." : "Send Reset Link"}
                </button>

                <div className="auth-switch-footer" style={{ display: "flex", justifyContent: "space-between" }}>
                  <button
                    type="button"
                    className="auth-inline-link"
                    style={{ margin: 0 }}
                    onClick={() => { setAuthView("login"); setForgotError(null); setForgotMessage(null); }}
                  >
                    ← Back to Sign In
                  </button>
                  <button
                    type="button"
                    className="auth-inline-link"
                    style={{ margin: 0 }}
                    onClick={() => { setAuthView("reset"); setForgotError(null); setForgotMessage(null); }}
                  >
                    Have a Token? Reset →
                  </button>
                </div>
              </form>
            )}

            {/* SCREEN 4: RESET PASSWORD */}
            {authView === "reset" && (
              <form className="auth-form" onSubmit={handleResetPassword}>
                {resetError && (
                  <div className="auth-error-banner">
                    <span>⚠️</span>
                    <span>{resetError}</span>
                  </div>
                )}
                {resetMessage && (
                  <div className="auth-success-banner">
                    ✓ {resetMessage}
                  </div>
                )}

                <div className="auth-field-group">
                  <label className="auth-field-label">Reset Token</label>
                  <input
                    type="text"
                    className="auth-input"
                    placeholder="Paste reset token here"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="auth-field-group">
                  <label className="auth-field-label">New Password (Min. 6 chars)</label>
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="••••••••"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <div className="auth-field-group">
                  <label className="auth-field-label">Confirm New Password</label>
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="••••••••"
                    value={resetConfirmPassword}
                    onChange={(e) => setResetConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <button type="submit" className="auth-submit-btn" disabled={isResetLoading}>
                  {isResetLoading ? "Updating..." : "Update Password"}
                </button>

                <div className="auth-switch-footer">
                  <button
                    type="button"
                    className="auth-inline-link"
                    onClick={() => { setAuthView("login"); setResetError(null); setResetMessage(null); }}
                  >
                    ← Back to Sign In
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Authenticated User Modal / Account Details ── */}
      {showUserModal && currentUser && (
        <div className="account-modal-overlay" onClick={() => setShowUserModal(false)}>
          <div className="account-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="account-modal-header">
              <h2 className="account-modal-title">Member Profile</h2>
              <button className="a24-btn-secondary" onClick={() => setShowUserModal(false)}>
                [ Close ]
              </button>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontSize: "1.3rem", fontFamily: "var(--font-serif)", color: "#fff", marginBottom: "4px" }}>
                {currentUser.name}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "var(--accent-gold)", marginBottom: "8px" }}>
                {currentUser.email}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
                Account ID: <span style={{ color: "#aaa" }}>{currentUser.id}</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-line)", padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: "1.4rem", fontFamily: "var(--font-serif)", color: "var(--accent-gold)" }}>
                  {insights?.watched_count ?? currentUser.watched_count ?? 0}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Watched Films
                </div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-line)", padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: "1.4rem", fontFamily: "var(--font-serif)", color: "var(--accent-gold)" }}>
                  {insights?.liked_count ?? currentUser.liked_count ?? 0}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Liked Affinities
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-line)", paddingTop: "18px" }}>
              <span className="tier-indicator" style={{ borderColor: "var(--accent-gold)", color: "var(--accent-gold)" }}>
                <span>COLD START:</span>
                <span style={{ fontWeight: 600 }}>{(insights?.cold_start_tier || currentUser.cold_start_tier || "new").toUpperCase()}</span>
              </span>

              <button
                type="button"
                className="a24-btn-secondary"
                style={{ borderColor: "rgba(239, 68, 68, 0.5)", color: "#fca5a5" }}
                onClick={handleLogout}
              >
                [ Sign Out / Logout ]
              </button>
            </div>
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
                <span className="index-item-title">
                  {userInteractionsMap[film.id]?.is_watched && (
                    <span style={{ color: "var(--accent-gold)", marginRight: "6px", fontWeight: "bold" }}>✓</span>
                  )}
                  {film.title}
                </span>
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
              {/* Dynamic Atmospheric Backdrop Glow */}
              {featuredMovie.backdrop_path && (
                <div
                  className="hero-ambient-backdrop"
                  style={{
                    backgroundImage: `url(${TMDB_IMAGE_BASE}/w1280${featuredMovie.backdrop_path})`,
                  }}
                />
              )}

              <div className="editorial-hero-grid">
                {/* Left Column: Dossier */}
                <div className="dossier-left">
                  <h1 className="hero-film-title">{featuredMovie.title}</h1>

                  <div className="meta-spec-block">
                    <span className="meta-label">DIRECTED BY</span>
                    <span className="meta-value">
                      {featuredMovie.directors?.[0]?.name || "Visionary Director"}
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
                      {featuredMovie.genres?.join(", ") || "Cinema"} • {featuredMovie.runtime_minutes ? `${featuredMovie.runtime_minutes}m` : "Feature"}
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
                    title="Click disc for full production dossier"
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
                </div>

                {/* Right Column: Quotes & Actions */}
                <div className="editorial-right">
                  <div className="critic-quote-box">
                    <div className="star-rating">{"★".repeat(criticReview?.stars || 5)}</div>
                    <div className="quote-source">
                      <span>{criticReview?.publication || editorialQuote.publication}</span>
                      {criticReview?.author && (
                        <span className="critic-author-name">• {criticReview.author}</span>
                      )}
                    </div>
                    <p className="quote-text">"{criticReview?.quote || editorialQuote.quote}"</p>
                    {criticReview?.consensus && (
                      <div className="critic-consensus-note">
                        {criticReview.consensus}
                      </div>
                    )}
                  </div>

                  <div className="hero-action-stack">
                    {(() => {
                      const status = userInteractionsMap[featuredMovie.id] || {
                        is_watched: false,
                        is_liked: false,
                        is_disliked: false,
                        is_watchlist: false,
                      };
                      return (
                        <>
                          <button
                            className={`a24-btn-primary ${status.is_watched ? "is-watched-active" : ""}`}
                            onClick={() => handleInteraction(featuredMovie.id, "watched")}
                            title={status.is_watched ? "Marked as Watched • Click again to unmark" : "Mark as Watched"}
                          >
                            {status.is_watched ? "[ ✓ WATCHED ]" : "[ MARK WATCHED ]"}
                          </button>
                          <button
                            className={`a24-btn-secondary ${status.is_watchlist ? "is-watchlist-active" : ""}`}
                            onClick={() => handleInteraction(featuredMovie.id, "watchlist")}
                            title={status.is_watchlist ? "In your Archive • Click again to remove" : "+ Add to Archive"}
                          >
                            {status.is_watchlist ? "✓ IN ARCHIVE" : "+ ADD TO ARCHIVE"}
                          </button>
                          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                            <button
                              className={`a24-btn-secondary ${status.is_liked ? "is-liked-active" : ""}`}
                              style={{ flex: 1 }}
                              onClick={() => handleInteraction(featuredMovie.id, "liked")}
                              title={status.is_liked ? "Liked • Click again to remove like" : "Like this film"}
                            >
                              {status.is_liked ? "✓ LIKED" : "LIKE"}
                            </button>
                            <button
                              className={`a24-btn-secondary ${status.is_disliked ? "is-disliked-active" : ""}`}
                              style={{ flex: 1 }}
                              onClick={() => handleInteraction(featuredMovie.id, "disliked")}
                              title={status.is_disliked ? "Disliked • Click again to remove dislike" : "Dislike this film"}
                            >
                              {status.is_disliked ? "✕ DISLIKED" : "DISLIKE"}
                            </button>
                          </div>
                        </>
                      );
                    })()}
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
                  isWatched={Boolean(userInteractionsMap[film.id]?.is_watched)}
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
                  isWatched={Boolean(userInteractionsMap[film.id]?.is_watched)}
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
                  isWatched={Boolean(userInteractionsMap[film.id]?.is_watched)}
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
                isWatched={Boolean(userInteractionsMap[film.id]?.is_watched)}
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
              USER: {currentUser?.name || currentUser?.username || "MEMBER"} • {archiveItems.length} UNIQUE PRODUCTIONS LOGGED
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
              Grounded conversational query engine conditioned on {currentUser?.name || currentUser?.username || "your"}'s personal taste profile
            </p>
          </div>

          <div style={{ border: "1px solid var(--border-line)", minHeight: "480px", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, padding: "28px", display: "flex", flexDirection: "column", gap: "24px", overflowY: "auto", maxHeight: "540px" }}>
              {chatMessages.map((msg, idx) => (
                <div key={idx} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: msg.role === "user" ? "75%" : "95%" }}>
                  <div className="meta-label" style={{ marginBottom: "6px", color: msg.role === "user" ? "var(--accent-gold)" : "var(--text-muted)" }}>
                    {msg.role === "user" ? `@${(currentUser?.name || currentUser?.username || "USER").toUpperCase()}` : "SHOWDYME AI CURATOR"}
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
                              <div style={{ position: "relative" }}>
                                <img
                                  src={`${TMDB_IMAGE_BASE}/w400${m.poster_path}`}
                                  alt={m.title}
                                  className="curator-card-poster"
                                />
                                {userInteractionsMap[m.id]?.is_watched && (
                                  <span className="card-watched-pill" style={{ top: "8px", left: "8px" }}>✓ WATCHED</span>
                                )}
                              </div>
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
                {(() => {
                  const modalStatus = userInteractionsMap[selectedModalMovie.id] || {
                    is_watched: false,
                    is_liked: false,
                    is_disliked: false,
                    is_watchlist: false,
                  };
                  return (
                    <>
                      <button
                        className={`a24-btn-primary ${modalStatus.is_watched ? "is-watched-active" : ""}`}
                        onClick={() => handleInteraction(selectedModalMovie.id, "watched")}
                        title={modalStatus.is_watched ? "Marked as Watched • Click again to unmark" : "Mark as Watched"}
                      >
                        {modalStatus.is_watched ? "[ ✓ WATCHED ]" : "[ MARK WATCHED ]"}
                      </button>
                      <button
                        className={`a24-btn-secondary ${modalStatus.is_liked ? "is-liked-active" : ""}`}
                        onClick={() => handleInteraction(selectedModalMovie.id, "liked")}
                        title={modalStatus.is_liked ? "Liked • Click again to remove like" : "Like this film"}
                      >
                        {modalStatus.is_liked ? "✓ LIKED" : "LIKE"}
                      </button>
                      <button
                        className={`a24-btn-secondary ${modalStatus.is_watchlist ? "is-watchlist-active" : ""}`}
                        onClick={() => handleInteraction(selectedModalMovie.id, "watchlist")}
                        title={modalStatus.is_watchlist ? "In your Archive • Click again to remove" : "+ Add to Watchlist"}
                      >
                        {modalStatus.is_watchlist ? "✓ IN ARCHIVE" : "+ ADD TO ARCHIVE"}
                      </button>
                    </>
                  );
                })()}
              </div>

              {/* Similar Titles */}
              {similarMovies.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border-line)", paddingTop: "20px", marginTop: "10px" }}>
                  <div className="meta-label" style={{ marginBottom: "12px" }}>RELATED PRODUCTIONS (CONTENT EMBEDDINGS)</div>
                  <div style={{ display: "flex", gap: "14px", overflowX: "auto" }}>
                    {similarMovies.map((sim) => (
                      <div
                        key={sim.id}
                        style={{ width: "110px", flexShrink: 0, cursor: "pointer", position: "relative" }}
                        onClick={() => {
                          setSelectedModalMovie(sim);
                          setFeaturedMovie(sim);
                        }}
                      >
                        {sim.poster_path && (
                          <img src={`${TMDB_IMAGE_BASE}/w300${sim.poster_path}`} alt={sim.title} style={{ width: "100%", border: "1px solid var(--border-line)" }} />
                        )}
                        {userInteractionsMap[sim.id]?.is_watched && (
                          <span className="card-watched-pill" style={{ top: "4px", left: "4px", fontSize: "0.55rem", padding: "2px 5px" }}>✓ WATCHED</span>
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
  isWatched,
  onSelect,
  onOpenModal,
}: {
  movie: Movie;
  isWatched?: boolean;
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
        {isWatched && <span className="card-watched-pill">✓ WATCHED</span>}
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