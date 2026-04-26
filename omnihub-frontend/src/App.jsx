import React, { useState, useEffect, useRef } from 'react';
import { Home, MonitorPlay, Film, Heart, Compass, LayoutGrid, Search, Play, Plus, AlertCircle, LogOut, User, History, Star, CreditCard, ShieldCheck } from 'lucide-react';

const API_KEY = '1f54bd990f1cdfb230adb312546d765d'; 
const TMDB_BASE = 'https://api.themoviedb.org/3';
const BACKEND_BASE = 'http://localhost:5000';

// --- VIDEO MODAL COMPONENT ---
const VideoModal = ({ movie, onClose, onAddFavorite, authToken }) => {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [statusText, setStatusText] = useState('Connecting to secure server...');
  const [seasonOptions, setSeasonOptions] = useState([]);
  const [episodeOptions, setEpisodeOptions] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [selectedEpisode, setSelectedEpisode] = useState(1);
  const [ratingSummary, setRatingSummary] = useState({ average_rating: null, total_ratings: 0 });
  const [recentReviews, setRecentReviews] = useState([]);
  const [myRating, setMyRating] = useState(0);
  const [myReview, setMyReview] = useState('');
  const [isRatingLoading, setIsRatingLoading] = useState(false);
  const timeoutRef = useRef(null);

  if (!movie) return null;

  // Determine if it's a TV show or Movie for the streaming APIs
  const isTv = movie.media_type === 'tv' || (!movie.media_type && movie.first_air_date);
  const mediaType = isTv ? 'tv' : 'movie';

  useEffect(() => {
    const fetchTvMeta = async () => {
      if (!isTv) {
        setSeasonOptions([]);
        setEpisodeOptions([]);
        setSelectedSeason(1);
        setSelectedEpisode(1);
        return;
      }

      try {
        const detailsRes = await fetch(`${TMDB_BASE}/tv/${movie.id}?api_key=${API_KEY}`);
        const detailsData = await detailsRes.json();

        const validSeasons = (detailsData.seasons || []).filter((s) => s.episode_count > 0);
        setSeasonOptions(validSeasons);

        const initialSeason = validSeasons.find((s) => s.season_number > 0)?.season_number ?? validSeasons[0]?.season_number ?? 1;
        setSelectedSeason(initialSeason);
      } catch (error) {
        console.error('TV metadata error:', error);
      }
    };

    fetchTvMeta();
  }, [isTv, movie.id]);

  useEffect(() => {
    const fetchEpisodes = async () => {
      if (!isTv) return;

      try {
        const seasonRes = await fetch(`${TMDB_BASE}/tv/${movie.id}/season/${selectedSeason}?api_key=${API_KEY}`);
        const seasonData = await seasonRes.json();
        const episodes = (seasonData.episodes || []).map((e) => e.episode_number).filter(Boolean);

        setEpisodeOptions(episodes);
        if (!episodes.includes(selectedEpisode)) {
          setSelectedEpisode(episodes[0] || 1);
        }
      } catch (error) {
        console.error('Episode list error:', error);
      }
    };

    fetchEpisodes();
  }, [isTv, movie.id, selectedSeason]);
  
  const sources = isTv
    ? [
        { name: 'Server 1 (VidSrc)', url: `https://vidsrc.xyz/embed/?tmdb=${movie.id}&type=tv&season=${selectedSeason}&episode=${selectedEpisode}` },
        { name: 'Server 2 (VidSrc To)', url: `https://vidsrc.to/embed/tv/${movie.id}/${selectedSeason}/${selectedEpisode}` },
        { name: 'Server 3 (VidSrc Me)', url: `https://vidsrc.me/embed/tv/${movie.id}/${selectedSeason}/${selectedEpisode}` },
        { name: 'Server 4 (2Embed)', url: `https://www.2embed.to/embed/tv/${movie.id}/${selectedSeason}/${selectedEpisode}` },
        { name: 'Server 5 (2Embed Alt)', url: `https://2embed.org/embed/tv/${movie.id}/${selectedSeason}/${selectedEpisode}` },
        { name: 'Server 6 (MovieAPI)', url: `https://moviesapi.to/tv/${movie.id}-${selectedSeason}-${selectedEpisode}` }
      ]
    : [
        { name: 'Server 1 (VidSrc)', url: `https://vidsrc.xyz/embed/?tmdb=${movie.id}&type=movie` },
        { name: 'Server 2 (VidSrc To)', url: `https://vidsrc.to/embed/movie/${movie.id}` },
        { name: 'Server 3 (VidSrc Me)', url: `https://vidsrc.me/embed/movie/${movie.id}` },
        { name: 'Server 4 (2Embed)', url: `https://www.2embed.to/embed/movie/${movie.id}` },
        { name: 'Server 5 (2Embed Alt)', url: `https://2embed.org/embed/movie/${movie.id}` },
        { name: 'Server 6 (MovieAPI)', url: `https://moviesapi.to/movie/${movie.id}` }
      ];

  const switchToNextSource = () => {
    if (sourceIndex < sources.length - 1) {
      setSourceIndex((prev) => prev + 1);
    } else {
      alert('All servers tried. Free embed servers may be blocked by ad blockers, browser settings, or region restrictions.');
      setIsLoading(false);
      setStatusText('All servers failed. Use Open Source to test current server directly.');
    }
  };

  useEffect(() => {
    const fetchRatings = async () => {
      try {
        const ratingsRes = await fetch(`${BACKEND_BASE}/api/ratings/${movie.id}?media_type=${mediaType}`);
        const ratingsData = await ratingsRes.json();

        if (ratingsRes.ok) {
          setRatingSummary(ratingsData.summary || { average_rating: null, total_ratings: 0 });
          setRecentReviews(ratingsData.reviews || []);
        }

        if (authToken) {
          const meRes = await fetch(`${BACKEND_BASE}/api/ratings/${movie.id}/me?media_type=${mediaType}`, {
            headers: { Authorization: `Bearer ${authToken}` }
          });

          const meData = await meRes.json();
          if (meRes.ok && meData) {
            setMyRating(Number(meData.rating_value || 0));
            setMyReview(meData.review_text || '');
          } else {
            setMyRating(0);
            setMyReview('');
          }
        }
      } catch (error) {
        console.error('Ratings load error:', error);
      }
    };

    fetchRatings();
  }, [movie.id, mediaType, authToken]);

  useEffect(() => {
    setIsLoading(true);
    const episodeLabel = isTv ? ` (S${selectedSeason}E${selectedEpisode})` : '';
    setStatusText(`Connecting to ${sources[sourceIndex].name}${episodeLabel}...`);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Some embeds never fire onLoad/onError; auto-try next source after timeout.
    timeoutRef.current = setTimeout(() => {
      setStatusText(`${sources[sourceIndex].name} timed out, switching server...`);
      switchToNextSource();
    }, 10000);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [sourceIndex, movie.id, isTv, selectedSeason, selectedEpisode]);

  const handleNextServer = () => {
    switchToNextSource();
  };

  const handleIframeLoad = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsLoading(false);
    setStatusText('');
  };

  const handleIframeError = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatusText(`${sources[sourceIndex].name} failed, switching server...`);
    switchToNextSource();
  };

  const handleSeasonChange = (event) => {
    setSelectedSeason(Number(event.target.value));
    setSourceIndex(0);
  };

  const handleEpisodeChange = (event) => {
    setSelectedEpisode(Number(event.target.value));
    setSourceIndex(0);
  };

  const submitRating = async () => {
    if (!authToken) {
      alert('Please login first to submit ratings.');
      return;
    }

    if (!myRating || myRating < 1 || myRating > 5) {
      alert('Please select a rating between 1 and 5 stars.');
      return;
    }

    setIsRatingLoading(true);
    try {
      const res = await fetch(`${BACKEND_BASE}/api/ratings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          tmdb_id: movie.id,
          media_type: mediaType,
          rating_value: myRating,
          review_text: myReview
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save rating');

      alert('Rating saved');
      const refresh = await fetch(`${BACKEND_BASE}/api/ratings/${movie.id}?media_type=${mediaType}`);
      const refreshData = await refresh.json();
      if (refresh.ok) {
        setRatingSummary(refreshData.summary || { average_rating: null, total_ratings: 0 });
        setRecentReviews(refreshData.reviews || []);
      }
    } catch (error) {
      alert(error.message || 'Failed to save rating');
    } finally {
      setIsRatingLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-6xl flex justify-between items-center mb-4 text-white">
        <div>
          <h2 className="text-2xl font-bold">{movie.title || movie.name}</h2>
          <div className="flex gap-4 items-center text-sm text-gray-400 mt-1">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>
              {sources[sourceIndex].name}
            </span>
            {isTv && (
              <>
                <label className="flex items-center gap-2">
                  <span className="text-xs text-gray-300">Season</span>
                  <select
                    value={selectedSeason}
                    onChange={handleSeasonChange}
                    className="bg-black/40 border border-gray-600 rounded px-2 py-1 text-xs text-white"
                  >
                    {seasonOptions.length > 0 ? (
                      seasonOptions.map((season) => (
                        <option key={season.id || season.season_number} value={season.season_number}>
                          S{season.season_number}
                        </option>
                      ))
                    ) : (
                      <option value={1}>S1</option>
                    )}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-xs text-gray-300">Episode</span>
                  <select
                    value={selectedEpisode}
                    onChange={handleEpisodeChange}
                    className="bg-black/40 border border-gray-600 rounded px-2 py-1 text-xs text-white"
                  >
                    {episodeOptions.length > 0 ? (
                      episodeOptions.map((episodeNo) => (
                        <option key={episodeNo} value={episodeNo}>
                          E{episodeNo}
                        </option>
                      ))
                    ) : (
                      <option value={1}>E1</option>
                    )}
                  </select>
                </label>
              </>
            )}
            <button onClick={handleNextServer} className="hover:text-white border border-gray-600 px-3 py-1 rounded transition-colors">
              Switch Server ↻
            </button>
            <button onClick={() => onAddFavorite(movie)} className="hover:text-white border border-gray-600 px-3 py-1 rounded transition-colors">
              Add to Favorites
            </button>
            <a
              href={sources[sourceIndex].url}
              target="_blank"
              rel="noreferrer"
              className="hover:text-white border border-gray-600 px-3 py-1 rounded transition-colors"
            >
              Open Source
            </a>
            <span className="text-yellow-500 text-xs flex items-center gap-1">
              <AlertCircle size={12} /> Turn off Ad-Blocker if video fails
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-4xl hover:text-red-500 transition-colors">&times;</button>
      </div>
      <div className="w-full max-w-6xl aspect-video bg-gray-900 rounded-xl overflow-hidden relative border border-gray-800 shadow-2xl">
        {isLoading && <div className="absolute inset-0 flex items-center justify-center text-gray-400">{statusText}</div>}
        <iframe
          key={sources[sourceIndex].url}
          src={sources[sourceIndex].url}
          title={`${movie.title || movie.name} player`}
          className="w-full h-full border-none"
          referrerPolicy="no-referrer"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          onLoad={handleIframeLoad}
          onError={handleIframeError}
        ></iframe>
      </div>
      <div className="w-full max-w-6xl mt-4 bg-[#111318] border border-gray-800 rounded-xl p-4 text-sm text-gray-300">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-white font-semibold">Ratings and Reviews</p>
            <p className="text-xs text-gray-400">
              Average: {ratingSummary.average_rating ?? 'N/A'} / 5 ({ratingSummary.total_ratings || 0} ratings)
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} onClick={() => setMyRating(value)} className="p-1">
                <Star size={18} className={value <= myRating ? 'text-yellow-400' : 'text-gray-600'} fill={value <= myRating ? '#facc15' : 'none'} />
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={myReview}
          onChange={(e) => setMyReview(e.target.value)}
          placeholder="Write your review (optional)"
          className="w-full h-20 bg-black/30 border border-gray-700 rounded p-2 outline-none focus:border-red-500"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={submitRating}
            disabled={isRatingLoading}
            className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {isRatingLoading ? 'Saving...' : 'Submit Rating'}
          </button>
        </div>
        {recentReviews.length > 0 && (
          <div className="mt-3 max-h-28 overflow-y-auto space-y-2">
            {recentReviews.slice(0, 3).map((review) => (
              <div key={review.rating_id} className="border-t border-gray-800 pt-2">
                <p className="text-xs text-gray-400">{review.full_name} • {review.rating_value}/5</p>
                <p className="text-xs text-gray-300 line-clamp-2">{review.review_text || 'No comment provided.'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// --- SIDEBAR COMPONENT ---
const Sidebar = ({ activeTab, setActiveTab }) => {
  const navItems = [
    { id: 'home', icon: Home },
    { id: 'tv', icon: MonitorPlay },
    { id: 'movies', icon: Film },
    { id: 'discover', icon: Compass },
    { id: 'favorites', icon: Heart },
    { id: 'history', icon: History },
    { id: 'subscription', icon: CreditCard }
  ];

  return (
    <aside className="w-20 fixed left-0 top-0 h-screen flex flex-col items-center py-8 bg-black/40 backdrop-blur-md border-r border-white/5 z-50">
      <div className="mb-12 cursor-pointer text-white/70 hover:text-white"><LayoutGrid size={24} /></div>
      <nav className="flex flex-col gap-8 w-full items-center">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <div 
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`p-3 rounded-full cursor-pointer transition-all duration-300 ${isActive ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(229,9,20,0.4)]' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
            >
              <Icon size={22} />
            </div>
          );
        })}
      </nav>
    </aside>
  );
};

// --- MOVIE ROW COMPONENT ---
const MovieRow = ({ title, movies, onMovieClick }) => {
  const rowRef = useRef(null);

  const handleWheelScroll = (event) => {
    if (!rowRef.current) return;
    rowRef.current.scrollLeft += event.deltaY;
  };

  return (
    <div className="mb-12 px-8">
      <h3 className="text-xl font-bold mb-4 text-white/90 px-2">{title}</h3>
      <div
        ref={rowRef}
        onWheel={handleWheelScroll}
        className="flex gap-4 overflow-x-auto pb-6 pt-2 px-2 scrollbar-hide"
        style={{ scrollbarWidth: 'none' }}
      >
        {movies && movies.map((movie) => (
          <div key={movie.id} onClick={() => onMovieClick(movie)} className="min-w-[200px] h-[300px] rounded-xl overflow-hidden relative cursor-pointer group bg-gray-900 flex-shrink-0 shadow-lg hover:shadow-red-900/20">
            {movie.poster_path ? (
              <img src={`https://image.tmdb.org/t/p/w500${movie.poster_path}`} alt={movie.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"/>
            ) : (<div className="w-full h-full flex items-center justify-center text-gray-600">No Image</div>)}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
              <h4 className="font-bold text-sm truncate">{movie.title || movie.name}</h4>
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-green-400 font-bold">⭐ {movie.vote_average?.toFixed(1) || 'N/A'}</span>
                <div className="bg-red-600 rounded-full p-1"><Play size={14} className="text-white" fill="white" /></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const MovieGrid = ({ title, movies, onMovieClick }) => (
  <div className="mb-12 px-8">
    <h3 className="text-xl font-bold mb-4 text-white/90">{title}</h3>
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {movies && movies.map((movie) => (
        <div key={movie.id} onClick={() => onMovieClick(movie)} className="h-[300px] rounded-xl overflow-hidden relative cursor-pointer group bg-gray-900 shadow-lg hover:shadow-red-900/20">
          {movie.poster_path ? (
            <img src={`https://image.tmdb.org/t/p/w500${movie.poster_path}`} alt={movie.title || movie.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"/>
          ) : (<div className="w-full h-full flex items-center justify-center text-gray-600">No Image</div>)}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
            <h4 className="font-bold text-sm truncate">{movie.title || movie.name}</h4>
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-green-400 font-bold">⭐ {movie.vote_average?.toFixed(1) || 'N/A'}</span>
              <div className="bg-red-600 rounded-full p-1"><Play size={14} className="text-white" fill="white" /></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const WatchHistoryGrid = ({ historyItems, onMovieClick }) => (
  <div className="px-8 pb-12">
    <h3 className="text-xl font-bold mb-4 text-white/90">🕒 Watch History</h3>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {historyItems.map((item) => (
        <div key={item.watch_id} className="bg-[#111318] border border-gray-800 rounded-xl p-3">
          <div className="flex gap-3">
            <img
              src={item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : 'https://via.placeholder.com/120x180?text=No+Poster'}
              alt={item.title || item.name || 'History item'}
              className="w-16 h-24 rounded object-cover"
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white truncate">{item.title || item.name || 'Untitled'}</p>
              <p className="text-xs text-gray-400 mt-1 capitalize">{item.media_type}</p>
              {item.media_type === 'tv' && (
                <p className="text-xs text-gray-400">S{item.season_number || 1} E{item.episode_number || 1}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">{item.profile_name || 'Default Profile'}</p>
              <p className="text-xs text-gray-500">{new Date(item.watched_at).toLocaleString()}</p>
            </div>
          </div>
          <button
            onClick={() => onMovieClick(item)}
            className="mt-3 w-full py-2 rounded bg-red-600 hover:bg-red-700 transition-colors text-sm"
          >
            Play Again
          </button>
        </div>
      ))}
    </div>
  </div>
);

// --- MAIN APP ---
function App() {
  const [authToken, setAuthToken] = useState(localStorage.getItem('omnihub_token') || '');
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ full_name: '', email: '', password: '' });

  const [activeTab, setActiveTab] = useState('home');
  const [heroMovies, setHeroMovies] = useState([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [trending, setTrending] = useState([]);
  const [topRated, setTopRated] = useState([]);
  const [tvShows, setTvShows] = useState([]);
  const [tvPage, setTvPage] = useState(1);
  const [hasMoreTv, setHasMoreTv] = useState(true);
  const [isLoadingMoreTv, setIsLoadingMoreTv] = useState(false);
  const [movieLibrary, setMovieLibrary] = useState([]);
  const [discoverList, setDiscoverList] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [watchHistory, setWatchHistory] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [currentSubscription, setCurrentSubscription] = useState(null);
  const [mySubscriptionRequests, setMySubscriptionRequests] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [selectedPlanCode, setSelectedPlanCode] = useState('pro');
  const [paymentMethod, setPaymentMethod] = useState('mock-card');
  const [paymentReference, setPaymentReference] = useState('');
  const [isSubmittingSubscription, setIsSubmittingSubscription] = useState(false);
  const [isTabLoading, setIsTabLoading] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [activeMovie, setActiveMovie] = useState(null); 

  const authHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  const isAdminUser = String(currentUser?.email || '').toLowerCase() === 'adilijaz227@gmail.com' || currentUser?.role === 'admin';

  const handleLogout = () => {
    localStorage.removeItem('omnihub_token');
    setAuthToken('');
    setCurrentUser(null);
    setFavorites([]);
    setProfiles([]);
    setSelectedProfileId(null);
    setWatchHistory([]);
    setCurrentSubscription(null);
    setMySubscriptionRequests([]);
    setPendingRequests([]);
  };

  const handleAuthInputChange = (event) => {
    const { name, value } = event.target;
    setAuthForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();

    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const payload = authMode === 'login'
      ? { email: authForm.email, password: authForm.password }
      : { full_name: authForm.full_name, email: authForm.email, password: authForm.password };

    try {
      const response = await fetch(`${BACKEND_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Authentication failed');

      localStorage.setItem('omnihub_token', data.token);
      setAuthToken(data.token);
      setCurrentUser(data.user);
      setAuthForm({ full_name: '', email: '', password: '' });
    } catch (error) {
      if (error.message === 'Failed to fetch') {
        alert('Cannot connect to backend API. Start streaming-backend on http://localhost:5000 and try again.');
      } else {
        alert(error.message || 'Authentication failed');
      }
    }
  };

  const getMediaType = (item) => (item.media_type === 'tv' || (!item.media_type && item.first_air_date) ? 'tv' : 'movie');

  const mapFavoriteRowToMovie = (row) => ({
    id: row.tmdb_id,
    media_type: row.media_type,
    title: row.media_type === 'movie' ? row.title : undefined,
    name: row.media_type === 'tv' ? row.title : undefined,
    poster_path: row.poster_path,
    vote_average: Number(row.vote_average || 0)
  });

  const loadFavorites = async () => {
    if (!authToken) {
      setFavorites([]);
      return;
    }

    if (!selectedProfileId) {
      setFavorites([]);
      return;
    }

    try {
      const res = await fetch(`${BACKEND_BASE}/api/favorites?profile_id=${selectedProfileId}`, { headers: authHeaders });
      const data = await res.json();
      if (Array.isArray(data)) {
        setFavorites(data.map(mapFavoriteRowToMovie));
      } else {
        setFavorites([]);
      }
    } catch (error) {
      console.error('Favorites Load Error:', error);
      setFavorites([]);
    }
  };

  const loadProfiles = async () => {
    if (!authToken) return;

    try {
      const response = await fetch(`${BACKEND_BASE}/api/profiles`, { headers: authHeaders });
      const data = await response.json();
      if (response.ok && Array.isArray(data)) {
        setProfiles(data);
        if (!selectedProfileId && data[0]?.profile_id) {
          setSelectedProfileId(data[0].profile_id);
        }
      }
    } catch (error) {
      console.error('Profiles Load Error:', error);
    }
  };

  const handleCreateProfile = async () => {
    const profileName = window.prompt('Enter new profile name');
    if (!profileName) return;

    const maturity = window.prompt('Maturity level (kids/teens/adults)', 'adults') || 'adults';
    try {
      const response = await fetch(`${BACKEND_BASE}/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ profile_name: profileName, maturity_level: maturity.toLowerCase() })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create profile');

      await loadProfiles();
      setSelectedProfileId(data.profile_id);
      alert('Profile created');
    } catch (error) {
      alert(error.message || 'Failed to create profile');
    }
  };

  const loadWatchHistory = async () => {
    if (!authToken) {
      setWatchHistory([]);
      return;
    }

    if (!selectedProfileId) {
      setWatchHistory([]);
      return;
    }

    try {
      const response = await fetch(`${BACKEND_BASE}/api/watch-history?limit=40&profile_id=${selectedProfileId}`, { headers: authHeaders });
      const rows = await response.json();
      if (!response.ok || !Array.isArray(rows)) {
        setWatchHistory([]);
        return;
      }

      const enriched = await Promise.all(rows.map(async (row) => {
        if (row.title || row.poster_path) {
          return {
            ...row,
            id: row.tmdb_id,
            title: row.media_type === 'movie' ? row.title : undefined,
            name: row.media_type === 'tv' ? row.title : undefined,
            poster_path: row.poster_path,
            release_date: row.release_date,
            vote_average: row.vote_average || 0
          };
        }

        try {
          const detailsRes = await fetch(`${TMDB_BASE}/${row.media_type}/${row.tmdb_id}?api_key=${API_KEY}`);
          const details = await detailsRes.json();
          return {
            ...row,
            id: row.tmdb_id,
            title: details.title,
            name: details.name,
            poster_path: details.poster_path,
            first_air_date: details.first_air_date,
            release_date: details.release_date,
            vote_average: details.vote_average
          };
        } catch (error) {
          return {
            ...row,
            id: row.tmdb_id,
            title: `${row.media_type.toUpperCase()} #${row.tmdb_id}`,
            poster_path: null,
            vote_average: 0
          };
        }
      }));

      setWatchHistory(enriched);
    } catch (error) {
      console.error('Watch History Load Error:', error);
      setWatchHistory([]);
    }
  };

  const loadSubscriptionPlans = async () => {
    try {
      const response = await fetch(`${BACKEND_BASE}/api/subscription/plans`);
      const data = await response.json();
      if (response.ok && Array.isArray(data)) {
        setSubscriptionPlans(data);
        if (!selectedPlanCode && data[0]?.plan_code) {
          setSelectedPlanCode(data[0].plan_code);
        }
      }
    } catch (error) {
      console.error('Subscription Plans Error:', error);
    }
  };

  const loadMySubscriptionRequests = async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${BACKEND_BASE}/api/subscription/requests/my`, { headers: authHeaders });
      const data = await response.json();
      if (response.ok && Array.isArray(data)) setMySubscriptionRequests(data);
    } catch (error) {
      console.error('My Subscription Requests Error:', error);
    }
  };

  const loadPendingRequests = async () => {
    if (!authToken || !isAdminUser) return;
    try {
      const response = await fetch(`${BACKEND_BASE}/api/subscription/requests/pending`, { headers: authHeaders });
      const data = await response.json();
      if (response.ok && Array.isArray(data)) setPendingRequests(data);
    } catch (error) {
      console.error('Pending Requests Error:', error);
    }
  };

  const submitSubscriptionRequest = async () => {
    if (!selectedPlanCode) {
      alert('Please select a plan first.');
      return;
    }

    setIsSubmittingSubscription(true);
    try {
      const response = await fetch(`${BACKEND_BASE}/api/subscription/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          plan_code: selectedPlanCode,
          payment_method: paymentMethod,
          payment_reference: paymentReference || `MOCK-${Date.now()}`
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to submit request');

      setPaymentReference('');
      alert('Your subscription will be active soon. Admin will approve it.');
      await loadMySubscriptionRequests();
    } catch (error) {
      alert(error.message || 'Failed to submit subscription request');
    } finally {
      setIsSubmittingSubscription(false);
    }
  };

  const approveRequest = async (requestId) => {
    try {
      const response = await fetch(`${BACKEND_BASE}/api/subscription/requests/${requestId}/approve`, {
        method: 'POST',
        headers: authHeaders
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Approval failed');

      alert('Subscription approved');
      await loadPendingRequests();
    } catch (error) {
      alert(error.message || 'Approval failed');
    }
  };

  const handleAddFavorite = async (movie) => {
    if (!movie) return;
    if (!selectedProfileId) {
      alert('Please select a profile first.');
      return;
    }

    const payload = {
      profile_id: selectedProfileId,
      tmdb_id: movie.id,
      media_type: getMediaType(movie),
      title: movie.title || movie.name || 'Untitled',
      poster_path: movie.poster_path || null,
      vote_average: Number(movie.vote_average || 0)
    };

    try {
      const res = await fetch(`${BACKEND_BASE}/api/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to save favorite');
      await loadFavorites();
      alert('Added to favorites');
    } catch (error) {
      console.error('Favorite Save Error:', error);
      alert('Could not save favorite to database');
    }
  };

  const loadMoreTvShows = async () => {
    if (isLoadingMoreTv || !hasMoreTv) return;

    setIsLoadingMoreTv(true);
    try {
      const nextPage = tvPage + 1;
      const res = await fetch(`${TMDB_BASE}/tv/popular?api_key=${API_KEY}&page=${nextPage}`);
      const data = await res.json();
      const incoming = (data.results || []).filter((m) => m.poster_path);

      if (incoming.length === 0 || nextPage >= (data.total_pages || nextPage)) {
        setHasMoreTv(false);
      }

      setTvShows((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        const uniqueIncoming = incoming.filter((item) => !seen.has(item.id));
        return [...prev, ...uniqueIncoming];
      });
      setTvPage(nextPage);
    } catch (error) {
      console.error('Load More TV Error:', error);
    } finally {
      setIsLoadingMoreTv(false);
    }
  };

  useEffect(() => {
    const bootstrapAuth = async () => {
      if (!authToken) {
        setAuthLoading(false);
        return;
      }

      try {
        const response = await fetch(`${BACKEND_BASE}/api/auth/me`, {
          headers: authHeaders
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Session expired');
        setCurrentUser(data.user);
        setProfiles(data.profiles || []);
        setSelectedProfileId(data.profiles?.[0]?.profile_id || null);
        setCurrentSubscription(data.subscription || null);
      } catch (error) {
        localStorage.removeItem('omnihub_token');
        setAuthToken('');
        setCurrentUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    bootstrapAuth();
  }, [authToken]);

  useEffect(() => {
    const fetchHomeData = async () => {
      try {
        const nowPlayingRes = await fetch(`${TMDB_BASE}/movie/now_playing?api_key=${API_KEY}`);
        const nowPlayingData = await nowPlayingRes.json();
        setHeroMovies(nowPlayingData.results.filter(m => m.backdrop_path).slice(0, 5));

        const trendingRes = await fetch(`${TMDB_BASE}/trending/all/week?api_key=${API_KEY}`);
        const trendingData = await trendingRes.json();
        setTrending(
          trendingData.results.filter(
            (m) => m.poster_path && (m.media_type === 'movie' || m.media_type === 'tv')
          )
        );

        const topRatedRes = await fetch(`${TMDB_BASE}/movie/top_rated?api_key=${API_KEY}`);
        const topRatedData = await topRatedRes.json();
        setTopRated(topRatedData.results.filter(m => m.poster_path));
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
    fetchHomeData();
  }, []);

  useEffect(() => {
    const fetchSearch = async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }
      try {
        const response = await fetch(`${BACKEND_BASE}/api/search?query=${encodeURIComponent(searchQuery)}`);
        const data = await response.json();
        if (data && data.length > 0) {
          setSearchResults(
            data.filter(
              (m) => m.poster_path && (m.media_type === 'movie' || m.media_type === 'tv')
            )
          );
        } else {
          setSearchResults([]);
        }
      } catch (error) { console.error("Search Error:", error); }
    };
    const timeoutId = setTimeout(() => fetchSearch(), 500); 
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    if (heroMovies.length === 0 || searchQuery.length >= 2) return;
    const interval = setInterval(() => setHeroIndex((prev) => (prev + 1) % heroMovies.length), 6000);
    return () => clearInterval(interval);
  }, [heroMovies, searchQuery]);

  useEffect(() => {
    if (currentUser) loadFavorites();
  }, [currentUser, selectedProfileId]);

  useEffect(() => {
    if (currentUser) loadProfiles();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !selectedProfileId) return;
    if (activeTab === 'favorites') loadFavorites();
    if (activeTab === 'history') loadWatchHistory();
  }, [selectedProfileId, activeTab, currentUser]);

  useEffect(() => {
    if (currentUser) {
      loadSubscriptionPlans();
      loadMySubscriptionRequests();
      if (isAdminUser) loadPendingRequests();
    }
  }, [currentUser]);

  useEffect(() => {
    const fetchTabData = async () => {
      if (activeTab === 'home' || activeTab === 'favorites' || activeTab === 'history' || activeTab === 'subscription') {
        if (activeTab === 'favorites' && currentUser) await loadFavorites();
        if (activeTab === 'history' && currentUser) await loadWatchHistory();
        if (activeTab === 'subscription' && currentUser) {
          await loadSubscriptionPlans();
          await loadMySubscriptionRequests();
          if (isAdminUser) await loadPendingRequests();
        }
        return;
      }

      setIsTabLoading(true);
      try {
        if (activeTab === 'tv' && tvShows.length === 0) {
          const popularTvRes = await fetch(`${TMDB_BASE}/tv/popular?api_key=${API_KEY}`);
          const popularTvData = await popularTvRes.json();
          setTvShows((popularTvData.results || []).filter((m) => m.poster_path));
          setTvPage(1);
          setHasMoreTv((popularTvData.total_pages || 1) > 1);
        }

        if (activeTab === 'movies' && movieLibrary.length === 0) {
          const popularMovieRes = await fetch(`${TMDB_BASE}/movie/popular?api_key=${API_KEY}`);
          const popularMovieData = await popularMovieRes.json();
          setMovieLibrary((popularMovieData.results || []).filter((m) => m.poster_path));
        }

        if (activeTab === 'discover' && discoverList.length === 0) {
          const discoverRes = await fetch(`${TMDB_BASE}/trending/all/day?api_key=${API_KEY}`);
          const discoverData = await discoverRes.json();
          setDiscoverList(
            (discoverData.results || []).filter(
              (m) => m.poster_path && (m.media_type === 'movie' || m.media_type === 'tv')
            )
          );
        }
      } catch (error) {
        console.error('Tab Data Error:', error);
      } finally {
        setIsTabLoading(false);
      }
    };

    fetchTabData();
  }, [activeTab, tvShows.length, movieLibrary.length, discoverList.length, currentUser]);

  const handleMovieClick = async (movie) => {
    setActiveMovie(movie); 
    setIsPlayerOpen(true);
    const isTv = movie.media_type === 'tv' || (!movie.media_type && movie.first_air_date);

    if (currentUser) {
      try {
        await fetch(`${BACKEND_BASE}/api/watch-history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            profile_id: selectedProfileId,
            tmdb_id: movie.id,
            media_type: isTv ? 'tv' : 'movie',
            completed: false
          })
        });
      } catch (error) {
        console.error('Watch History Error:', error);
      }
    }

    if (isTv) return;
    try { await fetch(`${BACKEND_BASE}/api/movies/${movie.id}`); } 
    catch (error) { console.error("Database Error:", error); }
  };

  if (authLoading) {
    return <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center text-white text-2xl font-bold animate-pulse">Checking session...</div>;
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] text-white flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-md">
          <h1 className="text-3xl font-black text-red-600 tracking-tight mb-2">OMNIHUB</h1>
          <p className="text-gray-400 mb-6">{authMode === 'login' ? 'Sign in to continue streaming' : 'Create your streaming account'}</p>
          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <input
                type="text"
                name="full_name"
                value={authForm.full_name}
                onChange={handleAuthInputChange}
                placeholder="Full name"
                required
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-red-500"
              />
            )}
            <input
              type="email"
              name="email"
              value={authForm.email}
              onChange={handleAuthInputChange}
              placeholder="Email"
              required
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-red-500"
            />
            <input
              type="password"
              name="password"
              value={authForm.password}
              onChange={handleAuthInputChange}
              placeholder="Password"
              required
              minLength={6}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-red-500"
            />
            <button type="submit" className="w-full bg-red-600 hover:bg-red-700 rounded-lg py-3 font-bold transition-colors">
              {authMode === 'login' ? 'Login' : 'Register'}
            </button>
          </form>
          <button
            onClick={() => setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'))}
            className="mt-4 text-sm text-gray-300 hover:text-white"
          >
            {authMode === 'login' ? 'No account? Create one' : 'Already registered? Login'}
          </button>
        </div>
      </div>
    );
  }

  if (heroMovies.length === 0) return <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center text-white text-2xl font-bold animate-pulse">Loading OmniHub...</div>;

  const currentHero = heroMovies[heroIndex];

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white font-sans overflow-x-hidden relative">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      {activeTab === 'home' ? (
        <>
          <section className="relative h-[85vh] w-full pl-20 transition-all duration-700 ease-in-out">
            <div className="absolute inset-0 pl-20 z-0">
              <img src={`https://image.tmdb.org/t/p/original${currentHero.backdrop_path}`} alt="Hero BG" className="w-full h-full object-cover transition-opacity duration-1000" key={currentHero.id}/>
              <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0c] via-[#0a0a0c]/80 to-transparent"></div>
              <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0c] via-transparent to-transparent"></div>
            </div>

            <header className="absolute top-8 left-28 right-12 z-20 flex justify-between items-center">
              <h1 className="text-3xl font-black text-red-600 tracking-tighter">OMNIHUB</h1>
              <div className="flex items-center gap-3">
                <div className="flex items-center bg-white/10 backdrop-blur-md rounded-full px-6 py-2 border border-white/10 w-[300px] focus-within:w-[400px] transition-all duration-300">
                  <Search size={16} className="text-white/50 mr-3" />
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search movies..." className="bg-transparent border-none outline-none text-sm w-full placeholder-white/50 text-white"/>
                </div>
                <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/10 text-sm">
                  <User size={14} />
                  <span className="truncate max-w-[140px]">{currentUser.full_name}</span>
                </div>
                {isAdminUser && (
                  <div className="hidden md:flex items-center gap-1 px-3 py-2 rounded-full bg-emerald-600/20 border border-emerald-500/40 text-xs text-emerald-300">
                    <ShieldCheck size={14} /> Admin
                  </div>
                )}
                <div className="hidden md:flex items-center gap-2">
                  <select
                    value={selectedProfileId || ''}
                    onChange={(e) => setSelectedProfileId(Number(e.target.value))}
                    className="bg-white/10 border border-white/10 rounded-full px-3 py-2 text-sm"
                  >
                    {profiles.map((profile) => (
                      <option key={profile.profile_id} value={profile.profile_id}>
                        {profile.profile_name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleCreateProfile}
                    className="px-3 py-2 rounded-full bg-white/10 border border-white/10 hover:bg-white/20 transition-colors text-xs"
                  >
                    + Profile
                  </button>
                </div>
                <button onClick={handleLogout} className="px-4 py-2 rounded-full bg-white/10 border border-white/10 hover:bg-white/20 transition-colors">
                  <LogOut size={16} />
                </button>
              </div>
            </header>

            {searchQuery.length < 2 && (
              <div className="relative z-10 h-full flex flex-col justify-center px-16 max-w-4xl pt-20">
                <div className="flex items-center gap-4 text-xs font-bold tracking-widest mb-4">
                  <span className="bg-red-600 px-3 py-1 rounded-sm">NEW RELEASE</span>
                  <span className="text-white/80">{currentHero.release_date?.split('-')[0]}</span>
                  <span className="text-green-400">⭐ {currentHero.vote_average?.toFixed(1)}</span>
                </div>
                <h2 className="text-6xl md:text-8xl font-black tracking-tighter mb-6 leading-none uppercase drop-shadow-2xl">{currentHero.title}</h2>
                <p className="text-lg text-gray-300 font-light mb-10 line-clamp-3 max-w-2xl drop-shadow-md">{currentHero.overview}</p>
                <div className="flex gap-4">
                  <button onClick={() => handleMovieClick(currentHero)} className="flex items-center gap-2 bg-red-600 text-white px-8 py-3 rounded-full font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/30">
                    <Play size={18} fill="white" /> Play Now
                  </button>
                  <button onClick={() => handleAddFavorite(currentHero)} className="px-8 py-3 rounded-full border border-white/30 text-white font-medium hover:bg-white/10 transition-colors flex items-center gap-2 backdrop-blur-sm">
                    <Plus size={18} /> My List
                  </button>
                </div>
              </div>
            )}

            {searchQuery.length < 2 && (
              <div className="absolute bottom-12 right-12 z-20 flex gap-2">
                {heroMovies.map((_, idx) => (
                  <div key={idx} className={`h-1.5 rounded-full transition-all duration-300 ${idx === heroIndex ? 'w-8 bg-red-600' : 'w-2 bg-white/30'}`}></div>
                ))}
              </div>
            )}
          </section>

          <section className="relative z-20 bg-[#0a0a0c] pl-20 pb-24 -mt-20">
            {searchQuery.length >= 2 ? (
              <div className="pt-8"><MovieRow title={`Search Results for "${searchQuery}"`} movies={searchResults} onMovieClick={handleMovieClick} /></div>
            ) : (
              <>
                <MovieRow title="🔥 Trending Now" movies={trending} onMovieClick={handleMovieClick} />
                <MovieRow title="⭐ Top Rated Masterpieces" movies={topRated} onMovieClick={handleMovieClick} />
              </>
            )}
          </section>
        </>
      ) : (
        <div className="pl-28 pt-12 pr-12 min-h-screen">
          <h1 className="text-4xl font-bold mb-8 text-white capitalize">{activeTab}</h1>
          {isTabLoading && <p className="text-gray-400">Loading content...</p>}

          {!isTabLoading && activeTab === 'tv' && (
            <>
              <MovieGrid title="📺 Popular TV Shows" movies={tvShows} onMovieClick={handleMovieClick} />
              <div className="px-8 pb-10">
                <button
                  onClick={loadMoreTvShows}
                  disabled={isLoadingMoreTv || !hasMoreTv}
                  className="px-5 py-2 rounded-full border border-white/25 text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoadingMoreTv ? 'Loading...' : hasMoreTv ? 'Load More TV Shows' : 'No More Shows'}
                </button>
              </div>
            </>
          )}

          {!isTabLoading && activeTab === 'movies' && (
            <MovieGrid title="🎬 Popular Movies" movies={movieLibrary} onMovieClick={handleMovieClick} />
          )}

          {!isTabLoading && activeTab === 'discover' && (
            <MovieGrid title="🧭 Discover Picks" movies={discoverList} onMovieClick={handleMovieClick} />
          )}

          {!isTabLoading && activeTab === 'favorites' && (
            favorites.length > 0 ? (
              <MovieGrid title="❤️ My Database Favorites" movies={favorites} onMovieClick={handleMovieClick} />
            ) : (
              <p className="text-gray-400">No favorites saved yet. Add titles with My List or from player modal.</p>
            )
          )}

          {!isTabLoading && activeTab === 'history' && (
            watchHistory.length > 0 ? (
              <WatchHistoryGrid historyItems={watchHistory} onMovieClick={handleMovieClick} />
            ) : (
              <p className="text-gray-400">No watch history yet. Start watching to populate this tab.</p>
            )
          )}

          {!isTabLoading && activeTab === 'subscription' && (
            <div className="px-8 pb-12 grid gap-6 lg:grid-cols-2">
              <div className="bg-[#111318] border border-gray-800 rounded-xl p-5">
                <h3 className="text-xl font-bold mb-2 text-white">Buy Subscription</h3>
                <p className="text-sm text-gray-400 mb-4">Choose a plan and submit mock payment. Your subscription will be active soon after admin approval.</p>

                <label className="text-xs text-gray-400">Current Plan</label>
                <p className="text-sm text-white mb-4">{currentSubscription?.plan_name || 'No active plan'}</p>

                <label className="text-xs text-gray-400">Plan</label>
                <select
                  value={selectedPlanCode}
                  onChange={(e) => setSelectedPlanCode(e.target.value)}
                  className="w-full mt-1 mb-3 bg-black/30 border border-gray-700 rounded px-3 py-2"
                >
                  {subscriptionPlans.map((plan) => (
                    <option key={plan.plan_id} value={plan.plan_code}>
                      {plan.plan_name} - ${Number(plan.monthly_price).toFixed(2)}/month
                    </option>
                  ))}
                </select>

                <label className="text-xs text-gray-400">Payment Method (Mock)</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full mt-1 mb-3 bg-black/30 border border-gray-700 rounded px-3 py-2"
                >
                  <option value="mock-card">Mock Card</option>
                  <option value="mock-easypaisa">Mock Easypaisa</option>
                  <option value="mock-jazzcash">Mock JazzCash</option>
                </select>

                <label className="text-xs text-gray-400">Payment Reference</label>
                <input
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="e.g. TXN-12345"
                  className="w-full mt-1 mb-4 bg-black/30 border border-gray-700 rounded px-3 py-2"
                />

                <button
                  onClick={submitSubscriptionRequest}
                  disabled={isSubmittingSubscription}
                  className="w-full py-2 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {isSubmittingSubscription ? 'Submitting...' : 'Purchase Subscription'}
                </button>
              </div>

              <div className="bg-[#111318] border border-gray-800 rounded-xl p-5">
                <h3 className="text-xl font-bold mb-2 text-white">My Requests</h3>
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {mySubscriptionRequests.length > 0 ? mySubscriptionRequests.map((req) => (
                    <div key={req.request_id} className="border border-gray-800 rounded-lg p-3 text-sm">
                      <p className="text-white font-medium">{req.plan_name}</p>
                      <p className="text-gray-400">Status: <span className="capitalize">{req.status}</span></p>
                      <p className="text-gray-500 text-xs">Ref: {req.payment_reference}</p>
                    </div>
                  )) : <p className="text-gray-400 text-sm">No subscription requests yet.</p>}
                </div>

                {isAdminUser && (
                  <>
                    <h4 className="text-lg font-semibold text-white mt-5 mb-2">Admin Approval Queue</h4>
                    <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                      {pendingRequests.length > 0 ? pendingRequests.map((req) => (
                        <div key={req.request_id} className="border border-emerald-800/40 rounded-lg p-3 text-sm">
                          <p className="text-white font-medium">{req.full_name} ({req.email})</p>
                          <p className="text-gray-300">{req.plan_name} • ${Number(req.payment_amount).toFixed(2)}</p>
                          <p className="text-gray-500 text-xs">Ref: {req.payment_reference}</p>
                          <button
                            onClick={() => approveRequest(req.request_id)}
                            className="mt-2 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-xs"
                          >
                            Approve
                          </button>
                        </div>
                      )) : <p className="text-gray-400 text-sm">No pending approvals.</p>}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {isPlayerOpen && <VideoModal movie={activeMovie} onClose={() => setIsPlayerOpen(false)} onAddFavorite={handleAddFavorite} authToken={authToken} />}
    </div>
  );
}

export default App;