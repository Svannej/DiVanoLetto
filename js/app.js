/* ============================================================
   DiVanoLetto — Application Logic + TMDB API
   ============================================================ */

window.onerror = function(msg, url, line, col, error) {
    const errEl = document.getElementById('login-error');
    if (errEl) {
        errEl.textContent = 'FATAL ERR: ' + msg + ' (Line ' + line + ')';
        errEl.classList.remove('hidden');
    }
    console.error("FATAL ERROR: ", msg, url, line, col, error);
};

// ──────────────────────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────────────────────
const CONFIG = {
    TMDB_API_KEY: 'e4982dd5be0f6d31838c58597c9c345f',
    TMDB_BASE: 'https://api.themoviedb.org/3',
    TMDB_IMG: 'https://image.tmdb.org/t/p/',
    OMDB_API_KEY: '4a8ee498',
    OMDB_BASE: 'https://www.omdbapi.com/',
    APP_PASSWORD: 'divanoletto',
    STORAGE_KEY: 'divanoLetto_data',
    STORAGE_KEY_PROFILE: 'divanoLetto_currentProfile',
    SESSION_KEY: 'divanoLetto_session',
    DEBOUNCE_MS: 400,
    HERO_INTERVAL_MS: 4000,
    MAX_IMG_SIZE: 200,
    EMOJI_OPTIONS: ['😎', '💖', '🦊', '🐱', '👑', '🌸', '🎮', '🎵', '🌙', '⭐', '🔥', '🎭', '🦄', '🐼', '🌺', '💜', '🍕', '🎬', '🧸', '🌈', '🐉', '🦋', '🍿', '🎧'],
};

// ──────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────
let state = {
    profiles: [
        { name: 'Io', emoji: '😎', image: null },
        { name: 'Amore', emoji: '💖', image: null },
    ],
    currentProfile: null,
    currentTab: 'movie',
    lists: {
        movie: [],
        tv: [],
        anime: [],
    },
    // Catalog state
    catalog: {
        results: [],
        page: 1,
        totalPages: 1,
        loading: false,
        genres: { movie: [], tv: [] },
        filters: {
            type: 'movie',
            genre: '',
            year: '',
            rating: '',
            duration: '',
        },
    },
};

/*  List item shape:
    {
        tmdbId:       Number,
        mediaType:    'movie' | 'tv',
        title:        String,
        posterPath:   String | null,
        backdropPath: String | null,
        overview:     String,
        genres:       String[],
        releaseDate:  String,
        voteAverage:  Number,
        status:       'to_watch' | 'watching' | 'watched',
        ratings:      { 0: Number|null, 1: Number|null },
        notes:        String,
        addedBy:      Number,   // profile index
        addedAt:      String,   // ISO date string
    }
*/

// ──────────────────────────────────────────────────────────────
// DOM HELPERS
// ──────────────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);
const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') node.className = v;
        else if (k === 'textContent') node.textContent = v;
        else if (k === 'innerHTML') node.innerHTML = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else node.setAttribute(k, v);
    }
    children.forEach(c => {
        if (typeof c === 'string') node.appendChild(document.createTextNode(c));
        else if (c) node.appendChild(c);
    });
    return node;
};

// ──────────────────────────────────────────────────────────────
// TMDB API
// ──────────────────────────────────────────────────────────────
const TMDB = {
    _url(path, params = {}) {
        const url = new URL(`${CONFIG.TMDB_BASE}${path}`);
        url.searchParams.set('api_key', CONFIG.TMDB_API_KEY);
        url.searchParams.set('language', 'it-IT');
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        return url.toString();
    },

    async _fetch(path, params) {
        try {
            const res = await fetch(this._url(path, params));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error('TMDB fetch error:', e);
            return null;
        }
    },

    async search(query, tab) {
        if (!query.trim()) return [];
        const type = tab === 'anime' ? 'tv' : tab;
        const data = await this._fetch(`/search/${type}`, { query, page: 1 });
        if (!data) return [];
        let results = data.results || [];
        // For anime tab, filter to Japanese animation
        if (tab === 'anime') {
            results = results.filter(r =>
                r.genre_ids && r.genre_ids.includes(16) &&
                r.origin_country && r.origin_country.includes('JP')
            );
        }
        return results;
    },

    async searchAnime(query) {
        if (!query.trim()) return [];
        // First try searching TV with query, filtering for anime
        const tvData = await this._fetch('/search/tv', { query, page: 1 });
        let results = [];
        if (tvData && tvData.results) {
            results = tvData.results.filter(r =>
                (r.genre_ids && r.genre_ids.includes(16)) ||
                (r.origin_country && r.origin_country.includes('JP'))
            );
        }
        // If no results from filtered search, try discover endpoint
        if (results.length === 0) {
            const discoverData = await this._fetch('/discover/tv', {
                with_genres: '16',
                with_origin_country: 'JP',
                sort_by: 'popularity.desc',
            });
            if (discoverData && discoverData.results) {
                results = discoverData.results;
            }
        }
        return results;
    },

    async getDetails(id, type) {
        const mediaType = type === 'anime' ? 'tv' : type;
        return await this._fetch(`/${mediaType}/${id}`);
    },

    async getCredits(id, type) {
        const mediaType = type === 'anime' ? 'tv' : type;
        const data = await this._fetch(`/${mediaType}/${id}/credits`);
        if (!data || !data.cast) return [];
        return data.cast.slice(0, 10);
    },

    async getGenreList(type = 'movie') {
        const data = await this._fetch(`/genre/${type}/list`);
        return data && data.genres ? data.genres : [];
    },

    async discover(type = 'movie', params = {}) {
        return await this._fetch(`/discover/${type}`, params);
    },

    async trending(type = 'all', timeWindow = 'week') {
        return await this._fetch(`/trending/${type}/${timeWindow}`);
    },

    async getWatchProviders(id, type) {
        const mediaType = type === 'anime' ? 'tv' : type;
        const data = await this._fetch(`/${mediaType}/${id}/watch/providers`);
        if (!data || !data.results || !data.results.IT) return [];
        const it = data.results.IT;
        const providers = [];
        // Subscription streaming services
        if (it.flatrate) {
            it.flatrate.forEach(p => providers.push({
                name: p.provider_name,
                logo: p.logo_path,
                type: 'streaming',
            }));
        }
        // Free with ads
        if (it.ads) {
            it.ads.forEach(p => {
                if (!providers.some(x => x.name === p.provider_name)) {
                    providers.push({
                        name: p.provider_name,
                        logo: p.logo_path,
                        type: 'ads',
                    });
                }
            });
        }
        return providers;
    },

    imgUrl(path, size = 'w342') {
        if (!path) return null;
        return `${CONFIG.TMDB_IMG}${size}${path}`;
    },

    // Get IMDb ID from TMDb
    async getExternalIds(id, type) {
        const mediaType = type === 'anime' ? 'tv' : type;
        return await this._fetch(`/${mediaType}/${id}/external_ids`);
    },
};

// ──────────────────────────────────────────────────────────────
// OMDb API (for IMDb + Rotten Tomatoes ratings)
// ──────────────────────────────────────────────────────────────
const OMDB = {
    async getByImdbId(imdbId) {
        if (!imdbId) return null;
        try {
            const url = `${CONFIG.OMDB_BASE}?apikey=${CONFIG.OMDB_API_KEY}&i=${imdbId}&plot=short`;
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = await res.json();
            if (data.Response === 'False') return null;
            return data;
        } catch (e) {
            console.error('OMDb fetch error:', e);
            return null;
        }
    },

    parseRatings(omdbData) {
        if (!omdbData) return {};
        const result = {};
        // IMDb rating
        if (omdbData.imdbRating && omdbData.imdbRating !== 'N/A') {
            result.imdb = { score: omdbData.imdbRating, votes: omdbData.imdbVotes || '' };
        }
        // Rotten Tomatoes
        if (omdbData.Ratings) {
            const rt = omdbData.Ratings.find(r => r.Source === 'Rotten Tomatoes');
            if (rt) result.rottenTomatoes = { score: rt.Value };
            const mc = omdbData.Ratings.find(r => r.Source === 'Metacritic');
            if (mc) result.metacritic = { score: mc.Value };
        }
        return result;
    },
};

// ──────────────────────────────────────────────────────────────
// PERSISTENCE (Supabase + localStorage fallback)
// ──────────────────────────────────────────────────────────────
const supabaseUrl = 'https://okokzbyhgsuukdlyrwsc.supabase.co';
const supabaseKey = 'sb_publishable_g9QdKH-8OYZTjRx6EdImaA_iKN1zcjW';
let supabase = null;
try {
    if (window.supabase) {
        supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    } else {
        console.error('Supabase SDK non caricato correttamente dal CDN.');
    }
} catch (err) {
    console.error('Errore inizializzazione Supabase:', err);
}

async function saveState() {
    // Backup locally
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
        profiles: state.profiles,
        lists: state.lists,
    }));

    if (!supabase) return;

    // Save to Supabase
    try {
        await supabase.from('app_state').upsert({
            id: 1,
            data: { profiles: state.profiles, lists: state.lists }
        });
    } catch (e) {
        console.error('Error saving to Supabase:', e);
    }
}

function loadState() {
    // 1. Caricamento locale immediato (così l'app parte istantaneamente)
    fallbackLoadLocal();

    const profileIdx = localStorage.getItem(CONFIG.STORAGE_KEY_PROFILE);
    if (profileIdx !== null) state.currentProfile = parseInt(profileIdx, 10);

    // 2. Sincronizzazione Supabase in background (senza bloccare)
    if (supabase) {
        supabase.from('app_state').select('data').eq('id', 1).single()
            .then(({ data, error }) => {
                if (!error && data && data.data) {
                    const remoteData = data.data;
                    if (remoteData.profiles) state.profiles = remoteData.profiles;
                    if (remoteData.lists) {
                        state.lists.movie = remoteData.lists.movie || [];
                        state.lists.tv = remoteData.lists.tv || [];
                        state.lists.anime = remoteData.lists.anime || [];
                    }
                    refreshUIAfterDataChange();
                }
            })
            .catch(e => console.error('Supabase load error:', e));

        // Subscribe to realtime changes
        try {
            supabase.channel('public:app_state')
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_state' }, payload => {
                    const newData = payload.new.data;
                    if (newData.profiles) state.profiles = newData.profiles;
                    if (newData.lists) {
                        state.lists.movie = newData.lists.movie || [];
                        state.lists.tv = newData.lists.tv || [];
                        state.lists.anime = newData.lists.anime || [];
                    }
                    refreshUIAfterDataChange();
                })
                .subscribe();
        } catch (err) {
            console.error('Errore subscribe:', err);
        }
    }
}

function refreshUIAfterDataChange() {
    // Re-render UI only if we are in the main app or profile screen
    if (!$('#app').classList.contains('hidden')) {
        renderHeader();
        renderHero();
        renderContent();
    }
    if (!$('#profile-screen').classList.contains('hidden')) {
        showProfileScreen();
    }
    if (!$('#profile-edit-modal').classList.contains('hidden')) {
        renderProfileEditContent();
    }
}

function fallbackLoadLocal() {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (saved) {
        try {
            const localData = JSON.parse(saved);
            if (localData.profiles) state.profiles = localData.profiles;
            if (localData.lists) {
                state.lists.movie = localData.lists.movie || [];
                state.lists.tv = localData.lists.tv || [];
                state.lists.anime = localData.lists.anime || [];
            }
        } catch (err) {}
    }
}

function saveCurrentProfile(index) {
    state.currentProfile = index;
    localStorage.setItem(CONFIG.STORAGE_KEY_PROFILE, index);
}

// ──────────────────────────────────────────────────────────────
// AUTHENTICATION
// ──────────────────────────────────────────────────────────────
function isLoggedIn() {
    return sessionStorage.getItem(CONFIG.SESSION_KEY) === 'true';
}

function setLoggedIn() {
    sessionStorage.setItem(CONFIG.SESSION_KEY, 'true');
}

// ──────────────────────────────────────────────────────────────
// PROFILE IMAGE HANDLING
// ──────────────────────────────────────────────────────────────
function resizeImage(file, maxSize) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > h) {
                    if (w > maxSize) { h = h * maxSize / w; w = maxSize; }
                } else {
                    if (h > maxSize) { w = w * maxSize / h; h = maxSize; }
                }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

/** Renders a profile avatar element (image or emoji fallback) */
function renderAvatar(profile, size = 'normal') {
    const sizeClass = size === 'small' ? 'profile-avatar-sm' : 'profile-avatar';
    if (profile.image) {
        const wrap = el('div', { className: sizeClass });
        wrap.appendChild(el('img', {
            className: 'profile-img',
            src: profile.image,
            alt: profile.name,
        }));
        return wrap;
    }
    return el('div', { className: sizeClass, textContent: profile.emoji });
}

// ──────────────────────────────────────────────────────────────
// TOAST NOTIFICATIONS
// ──────────────────────────────────────────────────────────────
function showToast(message, duration = 2500) {
    const container = $('#toast-container');
    const toast = el('div', { className: 'toast', textContent: message });
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('out');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

// ──────────────────────────────────────────────────────────────
// UTILITY
// ──────────────────────────────────────────────────────────────
function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

function getTabLabel(tab) {
    return { movie: 'Film', tv: 'Serie TV', anime: 'Anime' }[tab] || tab;
}

function getTabIcon(tab) {
    return { movie: '🎬', tv: '📺', anime: '🎌' }[tab] || '';
}

function getStatusLabel(status) {
    return { to_watch: 'Da vedere', watching: 'In corso', watched: 'Visto' }[status] || status;
}

function getStatusEmoji(status) {
    return { to_watch: '🍿', watching: '▶️', watched: '✅' }[status] || '';
}

function getTitle(item) {
    return item.title || item.name || 'Senza titolo';
}

function getYear(item) {
    const date = item.release_date || item.first_air_date || item.releaseDate || '';
    return date ? date.substring(0, 4) : '';
}

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isInList(tmdbId, tab) {
    return state.lists[tab].some(item => item.tmdbId === tmdbId);
}

// ──────────────────────────────────────────────────────────────
// RENDERING — LOGIN SCREEN
// ──────────────────────────────────────────────────────────────
function showLoginScreen() {
    $('#login-screen').classList.remove('hidden');
    $('#profile-screen').classList.add('hidden');
    $('#app').classList.add('hidden');

    const input = $('#password-input');
    input.value = '';
    $('#login-error').classList.add('hidden');
    setTimeout(() => input.focus(), 300);
}

function handleLogin() {
    const input = $('#password-input');
    const pwd = input.value;

    if (!pwd) {
        $('#login-error').textContent = 'Inserisci una password.';
        $('#login-error').classList.remove('hidden');
        return;
    }

    if (pwd === CONFIG.APP_PASSWORD) {
        setLoggedIn();
        showProfileScreen();
    } else {
        $('#login-error').textContent = 'Password errata. Riprova.';
        $('#login-error').classList.remove('hidden');
        input.value = '';
        input.focus();
    }
}

function showToast(message) {
    let toast = $('#toast');
    if (!toast) {
        toast = el('div', { id: 'toast', className: 'toast hidden' });
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3000);
}

function getProfileImageUrl(profile) {
    if (!profile) return '';
    return profile.image || `https://api.dicebear.com/9.x/micah/svg?seed=${encodeURIComponent(profile.name || 'User')}&backgroundColor=b6e3f4`;
}

function renderAvatar(profile, size = 'normal') {
    const sizeClass = size === 'small' ? 'profile-avatar-sm' : 'profile-avatar';
    const wrap = el('div', { className: sizeClass });
    wrap.appendChild(el('img', { className: 'profile-img', src: getProfileImageUrl(profile), alt: profile.name }));
    return wrap;
}

// ──────────────────────────────────────────────────────────────
// RENDERING — PROFILE SCREEN
// ──────────────────────────────────────────────────────────────
function showProfileScreen() {
    $('#login-screen').classList.add('hidden');
    $('#profile-screen').classList.remove('hidden');
    $('#app').classList.add('hidden');

    const container = $('#profiles-container');
    container.innerHTML = '';

    state.profiles.forEach((profile, idx) => {
        const avatar = renderAvatar(profile);
        const card = el('div', {
            className: 'profile-card',
            onClick: () => selectProfile(idx),
        }, [
            avatar,
            el('span', { className: 'profile-name', textContent: profile.name }),
        ]);
        card.style.animationDelay = `${idx * 0.15}s`;
        container.appendChild(card);
    });
}

function selectProfile(index) {
    saveCurrentProfile(index);
    showApp();
}

// ──────────────────────────────────────────────────────────────
// RENDERING — MAIN APP
// ──────────────────────────────────────────────────────────────
function showApp() {
    $('#login-screen').classList.add('hidden');
    $('#profile-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderHeader();
    renderHero();
    renderContent();
}

function renderHeader() {
    const profile = state.profiles[state.currentProfile];
    if (!profile) return;

    const headerEl = $('#header-profile-emoji');
    headerEl.innerHTML = '';
    headerEl.appendChild(el('img', {
        className: 'profile-img',
        src: getProfileImageUrl(profile),
        alt: profile.name,
    }));
}

// ──────────────────────────────────────────────────────────────
// RENDERING — HERO BANNER (CAROUSEL)
// ──────────────────────────────────────────────────────────────
let heroCarouselTimer = null;
let heroCarouselIndex = 0;
let heroCarouselItems = [];

function cleanupHeroCarousel() {
    if (heroCarouselTimer) {
        clearInterval(heroCarouselTimer);
        heroCarouselTimer = null;
    }
}

function renderHero() {
    cleanupHeroCarousel();
    const hero = $('#hero');
    const list = state.lists[state.currentTab];
    if (!list) return;
    const toWatch = list.filter(i => i.status === 'to_watch');

    if (toWatch.length === 0) {
        hero.innerHTML = '';
        const gradBg = el('div', { className: 'hero-gradient-bg' });
        const content = el('div', { className: 'hero-empty' }, [
            el('div', { className: 'hero-empty-icon', textContent: getTabIcon(state.currentTab) }),
            el('h2', { textContent: `Nessun ${getTabLabel(state.currentTab).toLowerCase()} in lista` }),
            el('p', { textContent: 'Cerca e aggiungi qualcosa da guardare insieme! 🍿' }),
        ]);
        hero.appendChild(gradBg);
        hero.appendChild(content);
        return;
    }

    // Select up to 5 items for the carousel, shuffle
    const shuffled = [...toWatch].sort(() => Math.random() - 0.5);
    heroCarouselItems = shuffled.slice(0, Math.min(5, shuffled.length));
    heroCarouselIndex = 0;

    hero.innerHTML = '';
    hero.classList.add('hero-carousel');

    // Build all slides
    const slidesContainer = el('div', { className: 'hero-slides' });
    heroCarouselItems.forEach((item, i) => {
        const slide = buildHeroSlide(item);
        slide.classList.toggle('active', i === 0);
        slide.dataset.index = i;
        slidesContainer.appendChild(slide);
    });
    hero.appendChild(slidesContainer);

    // Dots navigation
    if (heroCarouselItems.length > 1) {
        const dotsWrap = el('div', { className: 'hero-dots' });
        heroCarouselItems.forEach((_, i) => {
            const dot = el('button', {
                className: `hero-dot ${i === 0 ? 'active' : ''}`,
                onClick: () => goToHeroSlide(i),
            });
            dotsWrap.appendChild(dot);
        });
        hero.appendChild(dotsWrap);

        // Start auto-rotation
        heroCarouselTimer = setInterval(() => {
            const next = (heroCarouselIndex + 1) % heroCarouselItems.length;
            goToHeroSlide(next);
        }, CONFIG.HERO_INTERVAL_MS);
    }
}

function buildHeroSlide(item) {
    const slide = el('div', { className: 'hero-slide' });

    // Backdrop
    const backdrop = el('div', { className: 'hero-backdrop' });
    const backdropUrl = TMDB.imgUrl(item.backdropPath, 'w1280');
    if (backdropUrl) {
        backdrop.style.backgroundImage = `url(${backdropUrl})`;
    } else {
        backdrop.innerHTML = '<div class="hero-gradient-bg"></div>';
    }
    slide.appendChild(backdrop);

    // Content
    const genres = item.genres ? item.genres.join(', ') : '';
    const content = el('div', { className: 'hero-content' }, [
        el('div', { className: 'hero-badge', textContent: `${getStatusEmoji('to_watch')} Da vedere` }),
        el('h2', { className: 'hero-title', textContent: item.title }),
        ...(item.voteAverage ? [
            el('div', { className: 'hero-meta' }, [
                el('span', { className: 'hero-rating', innerHTML: `⭐ ${item.voteAverage.toFixed(1)}` }),
                el('span', { className: 'hero-year', textContent: getYear(item) }),
                ...(genres ? [el('span', { className: 'hero-genres', textContent: genres })] : []),
            ]),
        ] : []),
        ...(item.overview ? [
            el('p', { className: 'hero-overview', textContent: item.overview }),
        ] : []),
        el('div', { className: 'hero-actions' }, [
            el('button', {
                className: 'btn btn-primary',
                textContent: 'ℹ️ Dettagli',
                onClick: () => openDetailModal(item),
            }),
            el('button', {
                className: 'btn btn-secondary',
                textContent: '▶️ In corso',
                onClick: () => {
                    updateItemStatus(item.tmdbId, 'watching');
                    showToast('Stato aggiornato: In corso ▶️');
                },
            }),
        ]),
    ]);
    slide.appendChild(content);
    return slide;
}

function goToHeroSlide(index) {
    const hero = $('#hero');
    if (!hero) return;
    const slides = hero.querySelectorAll('.hero-slide');
    const dots = hero.querySelectorAll('.hero-dot');

    slides.forEach((s, i) => {
        s.classList.toggle('active', i === index);
    });
    dots.forEach((d, i) => {
        d.classList.toggle('active', i === index);
    });

    heroCarouselIndex = index;

    // Reset timer on manual navigation
    if (heroCarouselTimer && heroCarouselItems.length > 1) {
        clearInterval(heroCarouselTimer);
        heroCarouselTimer = setInterval(() => {
            const next = (heroCarouselIndex + 1) % heroCarouselItems.length;
            goToHeroSlide(next);
        }, CONFIG.HERO_INTERVAL_MS);
    }
}

// ──────────────────────────────────────────────────────────────
// RENDERING — CONTENT ROWS
// ──────────────────────────────────────────────────────────────
function renderContent() {
    const main = $('#main-content');
    main.innerHTML = '';
    try {
        const list = state.lists[state.currentTab];

        const statuses = [
            { key: 'to_watch', label: 'Da vedere', emoji: '🍿' },
            { key: 'watching', label: 'In corso', emoji: '▶️' },
            { key: 'watched', label: 'Visti', emoji: '✅' },
        ];

        statuses.forEach(({ key, label, emoji }) => {
            const items = list.filter(i => i.status === key);
            const row = renderRow(items, label, emoji, key);
            main.appendChild(row);
        });
    } catch (err) {
        main.innerHTML = `<div style="padding: 20px; background: red; color: white; font-size: 20px;">
            <h2>Crash in renderContent</h2>
            <pre>${err.message}\n${err.stack}</pre>
        </div>`;
    }
}

function renderRow(items, label, emoji, statusKey) {
    const section = el('div', { className: 'content-row' });

    // Title
    const title = el('h2', { className: 'row-title' }, [
        document.createTextNode(`${emoji} ${label} `),
        el('span', { className: 'row-count', textContent: items.length > 0 ? `(${items.length})` : '' }),
    ]);
    section.appendChild(title);

    if (items.length === 0) {
        const empty = el('div', { className: 'row-empty' }, [
            document.createTextNode(`Nessun titolo ${label.toLowerCase()}`),
        ]);
        section.appendChild(empty);
        return section;
    }

    // "Da vedere" uses a 2-row grid layout; others use horizontal scroll
    if (statusKey === 'to_watch') {
        const gridItems = el('div', { className: 'row-items-grid' });
        items.forEach(item => gridItems.appendChild(renderCard(item)));
        section.appendChild(gridItems);
        return section;
    }

    // Row wrapper with scroll buttons
    const wrapper = el('div', { className: 'row-wrapper' });

    const scrollLeft = el('button', {
        className: 'scroll-btn left',
        innerHTML: '‹',
        onClick: () => scrollRow(rowItems, -1),
    });
    const scrollRight = el('button', {
        className: 'scroll-btn right',
        innerHTML: '›',
        onClick: () => scrollRow(rowItems, 1),
    });

    const rowItems = el('div', { className: 'row-items' });
    items.forEach(item => rowItems.appendChild(renderCard(item)));

    wrapper.appendChild(scrollLeft);
    wrapper.appendChild(rowItems);
    wrapper.appendChild(scrollRight);
    section.appendChild(wrapper);

    return section;
}

function scrollRow(rowEl, direction) {
    const scrollAmount = rowEl.clientWidth * 0.75;
    rowEl.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
}

function renderCard(item) {
    const card = el('div', {
        className: 'card',
        onClick: () => openDetailModal(item),
    });

    // Poster
    const posterUrl = TMDB.imgUrl(item.posterPath, 'w342');
    if (posterUrl) {
        const img = el('img', {
            className: 'card-poster',
            src: posterUrl,
            alt: item.title,
            loading: 'lazy',
        });
        card.appendChild(img);
    } else {
        card.appendChild(el('div', { className: 'card-no-poster' }, [
            el('span', { textContent: item.title }),
        ]));
    }

    // Status badge
    card.appendChild(el('div', {
        className: `card-status ${item.status}`,
        textContent: getStatusLabel(item.status),
    }));

    const addedProfile = state.profiles[item.addedBy];
    if (addedProfile) {
        const addedByImg = el('img', {
            className: 'profile-img-inline',
            src: getProfileImageUrl(addedProfile),
            alt: addedProfile.name,
            style: { position: 'absolute', top: '8px', right: '8px', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }
        });
        card.appendChild(addedByImg);
    }

    // Provider badges (show first 2)
    if (item.providers && item.providers.length > 0) {
        const provBadges = el('div', { className: 'card-providers' });
        item.providers.slice(0, 2).forEach(p => {
            const logoUrl = TMDB.imgUrl(p.logo, 'w92');
            if (logoUrl) {
                provBadges.appendChild(el('img', {
                    className: 'card-provider-logo',
                    src: logoUrl,
                    alt: p.name,
                    title: p.name,
                }));
            }
        });
        card.appendChild(provBadges);
    }

    // Hover overlay
    const year = getYear(item);
    const ratingText = item.voteAverage ? `⭐ ${item.voteAverage.toFixed(1)}` : '';
    const addedByProfile = state.profiles[item.addedBy];
    const overlay = el('div', { className: 'card-overlay' }, [
        el('div', { className: 'card-title', textContent: item.title }),
        el('div', { className: 'card-meta' }, [
            ...(ratingText ? [el('span', { className: 'card-rating', textContent: ratingText })] : []),
            ...(year ? [el('span', { textContent: year })] : []),
        ]),
        ...(addedByProfile ? [
            el('div', { className: 'card-added-label' }, [
                el('img', { 
                    src: getProfileImageUrl(addedByProfile), 
                    className: 'profile-img-inline', 
                    alt: addedByProfile.name 
                }),
                el('span', { textContent: ' ' + addedByProfile.name })
            ]),
        ] : []),
    ]);
    card.appendChild(overlay);

    return card;
}

// ──────────────────────────────────────────────────────────────
// MODALS — SEARCH
// ──────────────────────────────────────────────────────────────
function openSearchModal() {
    const modal = $('#search-modal');
    modal.classList.remove('hidden');
    const input = $('#search-input');
    input.placeholder = `Cerca ${getTabLabel(state.currentTab).toLowerCase()}...`;
    input.value = '';
    input.focus();

    // Reset results
    $('#search-results').innerHTML = `
        <div class="search-empty-state">
            <div class="search-empty-icon">🔍</div>
            <p>Cerca un titolo per aggiungerlo alla tua lista</p>
        </div>
    `;
}

function closeModal(id) {
    const modal = $(`#${id}`);
    if (modal) modal.classList.add('hidden');
}

const debouncedSearch = debounce(async (query) => {
    if (!query.trim()) {
        $('#search-results').innerHTML = `
            <div class="search-empty-state">
                <div class="search-empty-icon">🔍</div>
                <p>Cerca un titolo per aggiungerlo alla tua lista</p>
            </div>
        `;
        return;
    }

    // Show loading
    $('#search-results').innerHTML = `
        <div class="search-loading">
            <div class="loading-spinner"></div>
            <p style="margin-top: 12px; color: var(--text-muted);">Cerco...</p>
        </div>
    `;

    let results;
    if (state.currentTab === 'anime') {
        results = await TMDB.searchAnime(query);
    } else {
        results = await TMDB.search(query, state.currentTab);
    }

    renderSearchResults(results);
}, CONFIG.DEBOUNCE_MS);

function renderSearchResults(results) {
    const container = $('#search-results');

    if (!results || results.length === 0) {
        container.innerHTML = `
            <div class="search-empty-state">
                <div class="search-empty-icon">😕</div>
                <p>Nessun risultato trovato</p>
            </div>
        `;
        return;
    }

    const grid = el('div', { className: 'search-grid' });

    results.forEach(result => {
        const title = result.title || result.name || '';
        const year = getYear(result);
        const rating = result.vote_average ? result.vote_average.toFixed(1) : '';
        const posterUrl = TMDB.imgUrl(result.poster_path, 'w342');
        const alreadyInList = isInList(result.id, state.currentTab);

        const card = el('div', {
            className: 'search-card',
            onClick: () => openSearchPreview(result),
        });

        // Poster
        if (posterUrl) {
            card.appendChild(el('img', {
                className: 'search-card-poster',
                src: posterUrl,
                alt: title,
                loading: 'lazy',
            }));
        } else {
            card.appendChild(el('div', {
                className: 'search-card-no-poster',
                textContent: getTabIcon(state.currentTab),
            }));
        }

        // Info
        card.appendChild(el('div', { className: 'search-card-info' }, [
            el('div', { className: 'search-card-title', textContent: title }),
            el('div', { className: 'search-card-meta' }, [
                el('span', { className: 'search-card-year', textContent: year }),
                ...(rating ? [el('span', { className: 'search-card-rating', textContent: `⭐ ${rating}` })] : []),
            ]),
        ]));

        // Add / In-list badge
        if (alreadyInList) {
            card.appendChild(el('div', {
                className: 'search-card-in-list',
                textContent: '✓',
                title: 'Già nella lista',
            }));
        } else {
            const addBtn = el('button', {
                className: 'search-card-add',
                textContent: '+',
                title: 'Aggiungi alla lista',
                onClick: (e) => {
                    e.stopPropagation();
                    addToList(result);
                    // Replace add button with checkmark
                    addBtn.replaceWith(el('div', {
                        className: 'search-card-in-list',
                        textContent: '✓',
                    }));
                },
            });
            card.appendChild(addBtn);
        }

        grid.appendChild(card);
    });

    container.innerHTML = '';
    container.appendChild(grid);
}

// ──────────────────────────────────────────────────────────────
// MODALS — DETAIL
// ──────────────────────────────────────────────────────────────
function openDetailModal(item) {
    const modal = $('#detail-modal');
    modal.classList.remove('hidden');
    renderDetailContent(item);
}

function renderDetailContent(item) {
    const container = $('#detail-content');
    container.innerHTML = '';

    // Backdrop
    const backdropWrap = el('div', { className: 'detail-backdrop-wrap' });
    const backdropUrl = TMDB.imgUrl(item.backdropPath, 'w1280');
    if (backdropUrl) {
        backdropWrap.appendChild(el('img', {
            className: 'detail-backdrop-img',
            src: backdropUrl,
            alt: '',
        }));
    } else {
        backdropWrap.appendChild(el('div', { className: 'detail-backdrop-empty' }));
    }
    backdropWrap.appendChild(el('div', { className: 'detail-backdrop-gradient' }));
    container.appendChild(backdropWrap);

    // Body
    const body = el('div', { className: 'detail-body' });

    // Header (poster + info)
    const header = el('div', { className: 'detail-header' });

    // Poster
    const posterWrap = el('div', { className: 'detail-poster' });
    const posterUrl = TMDB.imgUrl(item.posterPath, 'w342');
    if (posterUrl) {
        posterWrap.appendChild(el('img', { src: posterUrl, alt: item.title }));
    } else {
        posterWrap.appendChild(el('div', {
            className: 'detail-poster-empty',
            textContent: getTabIcon(state.currentTab),
        }));
    }
    header.appendChild(posterWrap);

    // Info
    const info = el('div', { className: 'detail-info' });
    info.appendChild(el('h2', { className: 'detail-title', textContent: item.title }));

    const meta = el('div', { className: 'detail-meta' });
    if (item.voteAverage) {
        meta.appendChild(el('span', {
            className: 'detail-tmdb-rating',
            innerHTML: `⭐ ${item.voteAverage.toFixed(1)}/10`,
        }));
    }
    const year = getYear(item);
    if (year) meta.appendChild(el('span', { className: 'detail-year', textContent: year }));
    info.appendChild(meta);

    // External ratings (async, appended when loaded)
    const externalRatingsWrap = el('div', { className: 'external-ratings' });
    info.appendChild(externalRatingsWrap);
    loadExternalRatings(item.tmdbId, item.mediaType || state.currentTab, externalRatingsWrap);

    if (item.genres && item.genres.length) {
        info.appendChild(el('div', {
            className: 'detail-genres',
            textContent: item.genres.join(', '),
        }));
    }

    header.appendChild(info);
    body.appendChild(header);

    // Overview
    if (item.overview) {
        body.appendChild(el('p', { className: 'detail-overview', textContent: item.overview }));
    }

    // Watch Providers
    if (item.providers && item.providers.length > 0) {
        const provSection = el('div', { className: 'detail-providers' });
        provSection.appendChild(el('span', {
            className: 'detail-providers-label',
            textContent: '📺 Disponibile su',
        }));
        const provList = el('div', { className: 'detail-providers-list' });
        item.providers.forEach(p => {
            const logoUrl = TMDB.imgUrl(p.logo, 'w92');
            const badge = el('div', { className: 'provider-badge' }, [
                ...(logoUrl ? [el('img', {
                    className: 'provider-logo',
                    src: logoUrl,
                    alt: p.name,
                })] : []),
                el('span', { className: 'provider-name', textContent: p.name }),
            ]);
            provList.appendChild(badge);
        });
        provSection.appendChild(provList);
        body.appendChild(provSection);
    }

    body.appendChild(el('hr', { className: 'detail-divider' }));

    // Controls
    const controls = el('div', { className: 'detail-controls' });

    // Status selector
    const statusControl = el('div', { className: 'detail-control' });
    statusControl.appendChild(el('span', { className: 'detail-control-label', textContent: 'Stato' }));
    const select = el('select', {
        className: 'detail-select',
        onChange: (e) => {
            updateItemStatus(item.tmdbId, e.target.value);
            showToast(`Stato: ${getStatusLabel(e.target.value)} ${getStatusEmoji(e.target.value)}`);
        },
    }, [
        el('option', { value: 'to_watch', textContent: '🍿 Da vedere', ...(item.status === 'to_watch' ? { selected: '' } : {}) }),
        el('option', { value: 'watching', textContent: '▶️ In corso', ...(item.status === 'watching' ? { selected: '' } : {}) }),
        el('option', { value: 'watched', textContent: '✅ Visto', ...(item.status === 'watched' ? { selected: '' } : {}) }),
    ]);
    select.value = item.status;
    statusControl.appendChild(select);
    controls.appendChild(statusControl);

    // Ratings for each profile
    state.profiles.forEach((profile, pIdx) => {
        const ratingControl = el('div', { className: 'detail-control' });
        
        const labelWrap = el('div', { className: 'detail-control-label detail-profile-label' }, [
            el('img', { 
                src: getProfileImageUrl(profile), 
                className: 'profile-img-inline', 
                alt: profile.name 
            }),
            el('span', { textContent: ' ' + profile.name })
        ]);
        ratingControl.appendChild(labelWrap);
        
        const starsContainer = el('div', { className: 'stars-container' });
        const currentRating = (item.ratings && item.ratings[pIdx]) || 0;
        for (let i = 1; i <= 5; i++) {
            const star = el('span', {
                className: `star ${i <= currentRating ? 'active' : ''}`,
                textContent: '★',
                onClick: () => {
                    // Toggle: clicking same rating removes it
                    const newRating = i === currentRating ? 0 : i;
                    updateItemRating(item.tmdbId, pIdx, newRating);
                    // Re-render stars
                    starsContainer.querySelectorAll('.star').forEach((s, idx) => {
                        s.classList.toggle('active', idx < newRating);
                    });
                    if (newRating > 0) {
                        showToast(`${profile.name} ha dato ${'★'.repeat(newRating)}${'☆'.repeat(5 - newRating)}`);
                    }
                },
            });
            starsContainer.appendChild(star);
        }
        ratingControl.appendChild(starsContainer);
        controls.appendChild(ratingControl);
    });

    // Notes
    const notesControl = el('div', { className: 'detail-notes' });
    notesControl.appendChild(el('span', {
        className: 'detail-control-label',
        textContent: 'Note',
        style: { display: 'block', marginBottom: '8px' },
    }));
    const textarea = el('textarea', {
        placeholder: 'Aggiungi delle note...',
        value: item.notes || '',
    });
    textarea.value = item.notes || '';
    const debouncedNotes = debounce((val) => {
        updateItemNotes(item.tmdbId, val);
    }, 500);
    textarea.addEventListener('input', (e) => debouncedNotes(e.target.value));
    notesControl.appendChild(textarea);
    controls.appendChild(notesControl);

    body.appendChild(controls);

    // Footer
    const footer = el('div', { className: 'detail-footer' });

    // Added info
    const addedProfile = state.profiles[item.addedBy];
    const addedInfo = el('div', { className: 'detail-added-info detail-added-info-flex' });
    if (addedProfile) {
        addedInfo.appendChild(document.createTextNode('Aggiunto da '));
        addedInfo.appendChild(
            el('img', { 
                src: getProfileImageUrl(addedProfile), 
                className: 'profile-img-inline',
                alt: addedProfile.name
            })
        );
        addedInfo.appendChild(document.createTextNode(` ${addedProfile.name} • ${formatDate(item.addedAt)}`));
    }
    footer.appendChild(addedInfo);

    // Delete button
    footer.appendChild(el('button', {
        className: 'btn-danger',
        textContent: '🗑️ Rimuovi',
        onClick: () => {
            removeFromList(item.tmdbId);
            closeModal('detail-modal');
            showToast('Rimosso dalla lista');
        },
    }));

    body.appendChild(footer);
    container.appendChild(body);
}

// ──────────────────────────────────────────────────────────────
// EXTERNAL RATINGS
// ──────────────────────────────────────────────────────────────
async function loadExternalRatings(tmdbId, mediaType, containerNode) {
    if (!tmdbId || !mediaType || !containerNode) return;
    
    // Add loading state
    containerNode.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-muted);"><span class="loading-spinner" style="width: 12px; height: 12px; border-width: 1px; margin-right: 6px; vertical-align: middle;"></span>Recupero recensioni...</span>';
    
    // Get IMDb ID from TMDb
    const externalIds = await TMDB.getExternalIds(tmdbId, mediaType);
    if (!externalIds || !externalIds.imdb_id) {
        containerNode.innerHTML = ''; // No IMDb ID found
        return;
    }
    
    // Fetch from OMDb
    const omdbData = await OMDB.getByImdbId(externalIds.imdb_id);
    if (!omdbData) {
        containerNode.innerHTML = '';
        return;
    }
    
    const ratings = OMDB.parseRatings(omdbData);
    containerNode.innerHTML = '';
    
    // IMDb Badge
    if (ratings.imdb) {
        containerNode.appendChild(el('div', { className: 'rating-badge imdb' }, [
            el('span', { className: 'rating-badge-icon imdb-icon', textContent: 'IMDb' }),
            el('span', { textContent: ratings.imdb.score })
        ]));
    }
    
    // Rotten Tomatoes Badge
    if (ratings.rottenTomatoes) {
        const isFresh = parseInt(ratings.rottenTomatoes.score) >= 60;
        containerNode.appendChild(el('div', { className: 'rating-badge rt' }, [
            el('span', { className: 'rating-badge-icon rt-icon', textContent: isFresh ? '🍅' : '🤢' }),
            el('span', { textContent: ratings.rottenTomatoes.score })
        ]));
    }
    
    // Metacritic Badge
    if (ratings.metacritic) {
        containerNode.appendChild(el('div', { className: 'rating-badge mc' }, [
            el('span', { className: 'rating-badge-icon mc-icon', textContent: 'M' }),
            el('span', { textContent: ratings.metacritic.score })
        ]));
    }
}

// ──────────────────────────────────────────────────────────────
// MODALS — PROFILE EDIT
// ──────────────────────────────────────────────────────────────
function openProfileEditModal() {
    const modal = $('#profile-edit-modal');
    modal.classList.remove('hidden');
    renderProfileEditContent();
}

function renderProfileEditContent() {
    const container = $('#profile-edit-content');
    container.innerHTML = '';

    state.profiles.forEach((profile, idx) => {
        const item = el('div', { className: 'profile-edit-item' });

        // Avatar (clickable to upload image)
        const avatarWrap = el('div', { className: 'profile-edit-avatar-wrap' });
        const avatarDisplay = el('div', { className: 'profile-edit-avatar' });

        avatarDisplay.appendChild(el('img', {
            className: 'profile-img',
            src: getProfileImageUrl(profile),
            alt: profile.name,
        }));

        // Camera overlay
        avatarDisplay.appendChild(el('div', {
            className: 'avatar-upload-overlay',
            textContent: '📷',
        }));

        // Hidden file input
        const fileInput = el('input', {
            type: 'file',
            accept: 'image/*',
            className: 'hidden',
            id: `profile-img-input-${idx}`,
        });
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const dataUrl = await resizeImage(file, CONFIG.MAX_IMG_SIZE);
            state.profiles[idx].image = dataUrl;
            // Update avatar display
            avatarDisplay.innerHTML = '';
            avatarDisplay.appendChild(el('img', {
                className: 'profile-img',
                src: dataUrl,
                alt: profile.name,
            }));
            avatarDisplay.appendChild(el('div', {
                className: 'avatar-upload-overlay',
                textContent: '📷',
            }));
        });

        avatarDisplay.addEventListener('click', () => fileInput.click());
        avatarWrap.appendChild(avatarDisplay);
        avatarWrap.appendChild(fileInput);

        // Remove image button (if image exists)
        if (profile.image) {
            const removeImgBtn = el('button', {
                className: 'btn-text',
                textContent: '✕ Rimuovi foto',
                style: { fontSize: '0.75rem', padding: '4px 0', color: 'var(--text-muted)' },
                onClick: () => {
                    state.profiles[idx].image = null;
                    renderProfileEditContent(); // re-render
                },
            });
            avatarWrap.appendChild(removeImgBtn);
        }

        item.appendChild(avatarWrap);

        // Right column: name + emoji picker
        const rightCol = el('div', { className: 'profile-edit-right' });

        // Name input
        const nameInput = el('input', {
            className: 'profile-edit-name',
            value: profile.name,
            placeholder: 'Nome profilo',
        });
        nameInput.value = profile.name;
        nameInput.addEventListener('input', (e) => {
            state.profiles[idx].name = e.target.value;
        });
        rightCol.appendChild(nameInput);

        item.appendChild(rightCol);
        container.appendChild(item);
    });

    // ── Password Section ──
    const pwdSection = el('div', { className: 'profile-edit-section' });
    pwdSection.appendChild(el('h3', {
        className: 'profile-edit-section-title',
        textContent: '🔒 Cambia Password',
    }));

    const pwdRow = el('div', { className: 'pwd-change-row' });
    const newPwdInput = el('input', {
        className: 'profile-edit-name',
        type: 'password',
        placeholder: 'Nuova password...',
        id: 'new-password-input',
    });
    const confirmPwdInput = el('input', {
        className: 'profile-edit-name',
        type: 'password',
        placeholder: 'Conferma password...',
        id: 'confirm-password-input',
    });
    const pwdError = el('p', {
        className: 'setup-error hidden',
        id: 'pwd-change-error',
    });
    const changePwdBtn = el('button', {
        className: 'btn btn-secondary',
        textContent: 'Aggiorna',
        style: { marginTop: '8px' },
        onClick: () => {
            const newPwd = newPwdInput.value;
            const confirmPwd = confirmPwdInput.value;
            if (!newPwd) {
                pwdError.textContent = 'Inserisci una nuova password.';
                pwdError.classList.remove('hidden');
                return;
            }
            if (newPwd !== confirmPwd) {
                pwdError.textContent = 'Le password non corrispondono.';
                pwdError.classList.remove('hidden');
                return;
            }
            setPassword(newPwd);
            pwdError.classList.add('hidden');
            newPwdInput.value = '';
            confirmPwdInput.value = '';
            showToast('Password aggiornata! 🔒');
        },
    });
    pwdRow.appendChild(newPwdInput);
    pwdRow.appendChild(confirmPwdInput);
    pwdRow.appendChild(pwdError);
    pwdRow.appendChild(changePwdBtn);
    pwdSection.appendChild(pwdRow);
    container.appendChild(pwdSection);

    // ── Save Button ──
    const actions = el('div', { className: 'profile-edit-actions' });
    actions.appendChild(el('button', {
        className: 'btn btn-primary',
        textContent: 'Salva Profili',
        onClick: () => {
            saveState();
            closeModal('profile-edit-modal');
            renderHeader();
            showProfileScreen();
            showToast('Profili aggiornati ✓');
        },
    }));
    container.appendChild(actions);
}



// ──────────────────────────────────────────────────────────────
// DATA OPERATIONS
// ──────────────────────────────────────────────────────────────
async function addToList(tmdbResult) {
    let tab = state.currentTab;
    // When in catalog, use the filter type to determine the list
    if (tab === 'catalog') {
        tab = state.catalog.filters.type || 'movie';
    }
    const tmdbId = tmdbResult.id;

    if (isInList(tmdbId, tab)) {
        showToast('Già nella lista!');
        return;
    }

    // Fetch full details for genres + watch providers in parallel
    const [details, providers] = await Promise.all([
        TMDB.getDetails(tmdbId, tab),
        TMDB.getWatchProviders(tmdbId, tab),
    ]);
    const genres = details && details.genres ? details.genres.map(g => g.name) : [];

    const item = {
        tmdbId,
        mediaType: tab === 'anime' ? 'tv' : tab,
        title: tmdbResult.title || tmdbResult.name || '',
        posterPath: tmdbResult.poster_path || null,
        backdropPath: tmdbResult.backdrop_path || null,
        overview: tmdbResult.overview || '',
        genres,
        providers,
        releaseDate: tmdbResult.release_date || tmdbResult.first_air_date || '',
        voteAverage: tmdbResult.vote_average || 0,
        status: 'to_watch',
        ratings: {},
        notes: '',
        addedBy: state.currentProfile,
        addedAt: new Date().toISOString(),
    };

    state.lists[tab].push(item);
    saveState();
    renderHero();
    renderContent();
    showToast(`${item.title} aggiunto! 🎉`);
}

function removeFromList(tmdbId) {
    const tab = state.currentTab;
    state.lists[tab] = state.lists[tab].filter(i => i.tmdbId !== tmdbId);
    saveState();
    renderHero();
    renderContent();
}

function updateItemStatus(tmdbId, newStatus) {
    const tab = state.currentTab;
    const item = state.lists[tab].find(i => i.tmdbId === tmdbId);
    if (item) {
        item.status = newStatus;
        saveState();
        renderHero();
        renderContent();
    }
}

function updateItemRating(tmdbId, profileIdx, rating) {
    const tab = state.currentTab;
    const item = state.lists[tab].find(i => i.tmdbId === tmdbId);
    if (item) {
        if (!item.ratings) item.ratings = {};
        item.ratings[profileIdx] = rating;
        saveState();
    }
}

function updateItemNotes(tmdbId, notes) {
    const tab = state.currentTab;
    const item = state.lists[tab].find(i => i.tmdbId === tmdbId);
    if (item) {
        item.notes = notes;
        saveState();
    }
}

// ──────────────────────────────────────────────────────────────
// TAB NAVIGATION
// ──────────────────────────────────────────────────────────────
function switchTab(tab) {
    // Handle catalog tab separately
    if (tab === 'catalog') {
        state.currentTab = tab;
        $$('.nav-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        $('#hero').classList.add('hidden');
        $('#main-content').classList.add('hidden');
        $('#catalog-page').classList.remove('hidden');
        $('#fab-add').classList.add('hidden');
        initCatalog();
        return;
    }

    state.currentTab = tab;

    // Update active tab in both navs
    $$('.nav-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Show home layout, hide catalog
    $('#hero').classList.remove('hidden');
    $('#main-content').classList.remove('hidden');
    $('#catalog-page').classList.add('hidden');
    $('#fab-add').classList.remove('hidden');

    renderHero();
    renderContent();
}

// ──────────────────────────────────────────────────────────────
// SEARCH PREVIEW MODAL
// ──────────────────────────────────────────────────────────────
async function openSearchPreview(tmdbResult) {
    const modal = $('#search-preview-modal');
    modal.classList.remove('hidden');
    const container = $('#search-preview-content');
    container.innerHTML = `
        <div class="search-loading" style="min-height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div class="loading-spinner"></div>
            <p style="margin-top: 12px; color: var(--text-muted);">Caricamento dettagli...</p>
        </div>
    `;

    const tab = state.currentTab === 'catalog' ? (state.catalog.filters.type === 'tv' ? 'tv' : 'movie') : state.currentTab;
    const mediaType = tab === 'anime' ? 'tv' : tab;

    // Fetch details, credits, and providers in parallel
    const [details, credits, providers] = await Promise.all([
        TMDB.getDetails(tmdbResult.id, tab),
        TMDB.getCredits(tmdbResult.id, tab),
        TMDB.getWatchProviders(tmdbResult.id, tab),
    ]);

    container.innerHTML = '';

    // Backdrop
    const backdropWrap = el('div', { className: 'detail-backdrop-wrap' });
    const backdropPath = tmdbResult.backdrop_path || (details && details.backdrop_path);
    const backdropUrl = TMDB.imgUrl(backdropPath, 'w1280');
    if (backdropUrl) {
        backdropWrap.appendChild(el('img', { className: 'detail-backdrop-img', src: backdropUrl, alt: '' }));
    } else {
        backdropWrap.appendChild(el('div', { className: 'detail-backdrop-empty' }));
    }
    backdropWrap.appendChild(el('div', { className: 'detail-backdrop-gradient' }));
    container.appendChild(backdropWrap);

    // Body
    const body = el('div', { className: 'detail-body' });

    // Header (poster + info)
    const header = el('div', { className: 'detail-header' });
    const posterWrap = el('div', { className: 'detail-poster' });
    const posterUrl = TMDB.imgUrl(tmdbResult.poster_path, 'w342');
    if (posterUrl) {
        posterWrap.appendChild(el('img', { src: posterUrl, alt: tmdbResult.title || tmdbResult.name }));
    } else {
        posterWrap.appendChild(el('div', { className: 'detail-poster-empty', textContent: '🎬' }));
    }
    header.appendChild(posterWrap);

    const info = el('div', { className: 'detail-info' });
    info.appendChild(el('h2', { className: 'detail-title', textContent: tmdbResult.title || tmdbResult.name || '' }));

    const meta = el('div', { className: 'detail-meta' });
    const voteAvg = tmdbResult.vote_average || (details && details.vote_average);
    if (voteAvg) {
        meta.appendChild(el('span', { className: 'detail-tmdb-rating', innerHTML: `⭐ ${voteAvg.toFixed(1)}/10` }));
    }
    const year = getYear(tmdbResult) || (details ? getYear(details) : '');
    if (year) meta.appendChild(el('span', { className: 'detail-year', textContent: year }));

    // Runtime
    if (details && details.runtime) {
        const h = Math.floor(details.runtime / 60);
        const m = details.runtime % 60;
        meta.appendChild(el('span', { textContent: h > 0 ? `${h}h ${m}min` : `${m}min`, style: { color: 'var(--text-muted)' } }));
    }
    if (details && details.number_of_seasons) {
        meta.appendChild(el('span', { textContent: `${details.number_of_seasons} stagion${details.number_of_seasons === 1 ? 'e' : 'i'}`, style: { color: 'var(--text-muted)' } }));
    }
    info.appendChild(meta);

    // External ratings (async)
    const externalRatingsWrap = el('div', { className: 'external-ratings' });
    info.appendChild(externalRatingsWrap);
    loadExternalRatings(tmdbResult.id, tab, externalRatingsWrap);

    // Genres
    const genres = details && details.genres ? details.genres.map(g => g.name) : [];
    if (genres.length) {
        info.appendChild(el('div', { className: 'detail-genres', textContent: genres.join(', ') }));
    }
    header.appendChild(info);
    body.appendChild(header);

    // Overview
    const overview = tmdbResult.overview || (details && details.overview) || '';
    if (overview) {
        body.appendChild(el('p', { className: 'detail-overview', textContent: overview }));
    }

    // Cast section
    if (credits && credits.length > 0) {
        const castSection = el('div', { className: 'preview-cast-section' });
        castSection.appendChild(el('span', { className: 'preview-cast-label', textContent: '🎭 Cast principale' }));
        const castList = el('div', { className: 'preview-cast-list' });
        credits.forEach(actor => {
            const imgUrl = actor.profile_path ? TMDB.imgUrl(actor.profile_path, 'w185') : null;
            const castItem = el('div', { className: 'preview-cast-item' }, [
                imgUrl ? el('img', { className: 'preview-cast-img', src: imgUrl, alt: actor.name, loading: 'lazy' })
                       : el('div', { className: 'preview-cast-img', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }, textContent: '👤' }),
                el('span', { className: 'preview-cast-name', textContent: actor.name }),
                el('span', { className: 'preview-cast-character', textContent: actor.character || '' }),
            ]);
            castList.appendChild(castItem);
        });
        castSection.appendChild(castList);
        body.appendChild(castSection);
    }

    // Watch Providers
    if (providers && providers.length > 0) {
        const provSection = el('div', { className: 'detail-providers', style: { marginTop: '20px' } });
        provSection.appendChild(el('span', { className: 'detail-providers-label', textContent: '📺 Disponibile su' }));
        const provList = el('div', { className: 'detail-providers-list' });
        providers.forEach(p => {
            const logoUrl = TMDB.imgUrl(p.logo, 'w92');
            const badge = el('div', { className: 'provider-badge' }, [
                ...(logoUrl ? [el('img', { className: 'provider-logo', src: logoUrl, alt: p.name })] : []),
                el('span', { className: 'provider-name', textContent: p.name }),
            ]);
            provList.appendChild(badge);
        });
        provSection.appendChild(provList);
        body.appendChild(provSection);
    }

    // Add to List section
    const alreadyInAnyList = ['movie', 'tv', 'anime'].some(t => state.lists[t].some(i => i.tmdbId === tmdbResult.id));
    const addSection = el('div', { className: 'preview-add-section' });
    const addInfo = el('div', { className: 'preview-add-info' }, [
        el('span', { className: 'preview-add-info-title', textContent: alreadyInAnyList ? 'Già nella tua lista ✓' : 'Vuoi aggiungerlo alla lista?' }),
        el('span', { className: 'preview-add-info-sub', textContent: alreadyInAnyList ? 'Questo titolo è già presente' : `Verrà aggiunto come "${getTabLabel(tab)}"` }),
    ]);
    addSection.appendChild(addInfo);

    if (!alreadyInAnyList) {
        const addBtn = el('button', {
            className: 'preview-add-btn',
            innerHTML: '+ Aggiungi alla lista',
            onClick: async () => {
                // Determine the correct tab for adding
                let addTab = tab;
                if (state.currentTab !== 'catalog') addTab = state.currentTab;

                // Build the item using the tmdbResult + fetched details
                const itemGenres = genres;
                const item = {
                    tmdbId: tmdbResult.id,
                    mediaType: addTab === 'anime' ? 'tv' : addTab,
                    title: tmdbResult.title || tmdbResult.name || '',
                    posterPath: tmdbResult.poster_path || null,
                    backdropPath: backdropPath || null,
                    overview: overview,
                    genres: itemGenres,
                    providers: providers || [],
                    releaseDate: tmdbResult.release_date || tmdbResult.first_air_date || '',
                    voteAverage: tmdbResult.vote_average || 0,
                    status: 'to_watch',
                    ratings: {},
                    notes: '',
                    addedBy: state.currentProfile,
                    addedAt: new Date().toISOString(),
                };

                if (!state.lists[addTab].some(i => i.tmdbId === tmdbResult.id)) {
                    state.lists[addTab].push(item);
                    saveState();
                    renderHero();
                    renderContent();
                }

                addBtn.className = 'preview-add-btn added';
                addBtn.innerHTML = '✓ Aggiunto!';
                showToast(`${item.title} aggiunto! 🎉`);
            },
        });
        addSection.appendChild(addBtn);
    }

    body.appendChild(addSection);
    container.appendChild(body);
}

// ──────────────────────────────────────────────────────────────
// CATALOG PAGE
// ──────────────────────────────────────────────────────────────
let catalogScrollHandler = null;

async function initCatalog() {
    // Load genres if not already loaded
    if (state.catalog.genres.movie.length === 0) {
        const [movieGenres, tvGenres] = await Promise.all([
            TMDB.getGenreList('movie'),
            TMDB.getGenreList('tv'),
        ]);
        state.catalog.genres.movie = movieGenres;
        state.catalog.genres.tv = tvGenres;
    }

    renderCatalogFilters();
    state.catalog.page = 1;
    state.catalog.results = [];
    await loadCatalogPage(1);
    setupCatalogScroll();
}

function renderCatalogFilters() {
    const container = $('#catalog-filters');
    container.innerHTML = '';

    const filters = state.catalog.filters;

    // Type filter
    const typeGroup = el('div', { className: 'catalog-filter-group' }, [
        el('label', { className: 'catalog-filter-label', textContent: 'Tipologia' }),
    ]);
    const typeSelect = el('select', {
        className: 'catalog-filter-select',
        onChange: (e) => {
            filters.type = e.target.value;
            filters.genre = ''; // reset genre when type changes
            renderCatalogFilters();
            resetAndLoadCatalog();
        },
    }, [
        el('option', { value: 'movie', textContent: '🎬 Film', ...(filters.type === 'movie' ? { selected: '' } : {}) }),
        el('option', { value: 'tv', textContent: '📺 Serie TV', ...(filters.type === 'tv' ? { selected: '' } : {}) }),
        el('option', { value: 'anime', textContent: '🎌 Anime', ...(filters.type === 'anime' ? { selected: '' } : {}) }),
    ]);
    typeSelect.value = filters.type;
    typeGroup.appendChild(typeSelect);
    container.appendChild(typeGroup);

    // Genre filter
    const genreGroup = el('div', { className: 'catalog-filter-group' }, [
        el('label', { className: 'catalog-filter-label', textContent: 'Genere' }),
    ]);
    const genreType = filters.type === 'anime' ? 'tv' : filters.type;
    const genres = state.catalog.genres[genreType] || [];
    const genreSelect = el('select', {
        className: 'catalog-filter-select',
        onChange: (e) => { filters.genre = e.target.value; resetAndLoadCatalog(); },
    }, [
        el('option', { value: '', textContent: 'Tutti i generi' }),
        ...genres.map(g => el('option', { value: String(g.id), textContent: g.name, ...(filters.genre === String(g.id) ? { selected: '' } : {}) })),
    ]);
    genreSelect.value = filters.genre;
    genreGroup.appendChild(genreSelect);
    container.appendChild(genreGroup);

    // Year filter
    const yearGroup = el('div', { className: 'catalog-filter-group' }, [
        el('label', { className: 'catalog-filter-label', textContent: 'Anno' }),
    ]);
    const currentYear = new Date().getFullYear();
    const yearOptions = [el('option', { value: '', textContent: 'Tutti gli anni' })];
    for (let y = currentYear; y >= 1990; y--) {
        yearOptions.push(el('option', { value: String(y), textContent: String(y), ...(filters.year === String(y) ? { selected: '' } : {}) }));
    }
    yearOptions.push(el('option', { value: '1980', textContent: 'Anni \'80', ...(filters.year === '1980' ? { selected: '' } : {}) }));
    yearOptions.push(el('option', { value: '1970', textContent: 'Classici (pre-1980)', ...(filters.year === '1970' ? { selected: '' } : {}) }));
    const yearSelect = el('select', {
        className: 'catalog-filter-select',
        onChange: (e) => { filters.year = e.target.value; resetAndLoadCatalog(); },
    }, yearOptions);
    yearSelect.value = filters.year;
    yearGroup.appendChild(yearSelect);
    container.appendChild(yearGroup);

    // Rating filter
    const ratingGroup = el('div', { className: 'catalog-filter-group' }, [
        el('label', { className: 'catalog-filter-label', textContent: 'Valutazione min.' }),
    ]);
    const ratingSelect = el('select', {
        className: 'catalog-filter-select',
        onChange: (e) => { filters.rating = e.target.value; resetAndLoadCatalog(); },
    }, [
        el('option', { value: '', textContent: 'Qualsiasi' }),
        el('option', { value: '8', textContent: '⭐ 8+ Eccellente', ...(filters.rating === '8' ? { selected: '' } : {}) }),
        el('option', { value: '7', textContent: '⭐ 7+ Molto buono', ...(filters.rating === '7' ? { selected: '' } : {}) }),
        el('option', { value: '6', textContent: '⭐ 6+ Buono', ...(filters.rating === '6' ? { selected: '' } : {}) }),
        el('option', { value: '5', textContent: '⭐ 5+ Discreto', ...(filters.rating === '5' ? { selected: '' } : {}) }),
    ]);
    ratingSelect.value = filters.rating;
    ratingGroup.appendChild(ratingSelect);
    container.appendChild(ratingGroup);

    // Duration filter (only for movies)
    if (filters.type === 'movie') {
        const durationGroup = el('div', { className: 'catalog-filter-group' }, [
            el('label', { className: 'catalog-filter-label', textContent: 'Durata' }),
        ]);
        const durationSelect = el('select', {
            className: 'catalog-filter-select',
            onChange: (e) => { filters.duration = e.target.value; resetAndLoadCatalog(); },
        }, [
            el('option', { value: '', textContent: 'Qualsiasi' }),
            el('option', { value: '90', textContent: '< 90 min', ...(filters.duration === '90' ? { selected: '' } : {}) }),
            el('option', { value: '90-120', textContent: '90-120 min', ...(filters.duration === '90-120' ? { selected: '' } : {}) }),
            el('option', { value: '120', textContent: '> 120 min', ...(filters.duration === '120' ? { selected: '' } : {}) }),
        ]);
        durationSelect.value = filters.duration;
        durationGroup.appendChild(durationSelect);
        container.appendChild(durationGroup);
    }

    // Reset button
    container.appendChild(el('button', {
        className: 'catalog-filter-btn secondary',
        textContent: '↺ Reset',
        onClick: () => {
            state.catalog.filters = { type: 'movie', genre: '', year: '', rating: '', duration: '' };
            renderCatalogFilters();
            resetAndLoadCatalog();
        },
    }));
}

async function resetAndLoadCatalog() {
    state.catalog.page = 1;
    state.catalog.results = [];
    $('#catalog-grid').innerHTML = '';
    $('#catalog-end').classList.add('hidden');
    await loadCatalogPage(1);
}

async function loadCatalogPage(page) {
    if (state.catalog.loading) return;
    state.catalog.loading = true;

    const loader = $('#catalog-loader');
    loader.classList.remove('hidden');

    const filters = state.catalog.filters;
    const params = {
        page: String(page),
        sort_by: 'popularity.desc',
    };

    let discoverType = filters.type;
    if (filters.type === 'anime') {
        discoverType = 'tv';
        params.with_original_language = 'ja';
        params.with_genres = filters.genre ? `${filters.genre},16` : '16';
    } else {
        if (filters.genre) params.with_genres = filters.genre;
    }

    if (filters.rating) params['vote_average.gte'] = filters.rating;

    if (filters.year) {
        const y = parseInt(filters.year);
        const dateType = discoverType === 'movie' ? 'primary_release' : 'first_air';
        if (y >= 1990) {
            params[`${dateType}_year`] = filters.year;
        } else if (y === 1980) {
            params[`${dateType}_date.gte`] = '1980-01-01';
            params[`${dateType}_date.lte`] = '1989-12-31';
        } else {
            params[`${dateType}_date.lte`] = '1979-12-31';
        }
    }

    if (filters.duration && filters.type === 'movie') {
        if (filters.duration === '90') {
            params['with_runtime.lte'] = '90';
        } else if (filters.duration === '90-120') {
            params['with_runtime.gte'] = '90';
            params['with_runtime.lte'] = '120';
        } else if (filters.duration === '120') {
            params['with_runtime.gte'] = '120';
        }
    }

    const data = await TMDB.discover(discoverType, params);

    loader.classList.add('hidden');
    state.catalog.loading = false;

    if (!data || !data.results) return;

    state.catalog.page = page;
    state.catalog.totalPages = data.total_pages || 1;
    state.catalog.results = [...state.catalog.results, ...data.results];

    renderCatalogResults(data.results, page === 1);

    if (page >= state.catalog.totalPages) {
        $('#catalog-end').classList.remove('hidden');
    }
}

function renderCatalogResults(results, clear = false) {
    const grid = $('#catalog-grid');
    if (clear) grid.innerHTML = '';

    if (results.length === 0 && clear) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
                <div style="font-size: 3rem; margin-bottom: 16px;">🔍</div>
                <p style="color: var(--text-muted);">Nessun risultato trovato. Prova a cambiare i filtri.</p>
            </div>
        `;
        return;
    }

    const filters = state.catalog.filters;

    results.forEach(result => {
        const title = result.title || result.name || '';
        const year = getYear(result);
        const rating = result.vote_average ? result.vote_average.toFixed(1) : '';
        const posterUrl = TMDB.imgUrl(result.poster_path, 'w342');
        const alreadyInList = ['movie', 'tv', 'anime'].some(t => state.lists[t].some(i => i.tmdbId === result.id));

        const card = el('div', {
            className: 'catalog-card',
            onClick: () => openSearchPreview(result),
        });

        // Poster
        if (posterUrl) {
            card.appendChild(el('img', {
                className: 'catalog-card-poster',
                src: posterUrl,
                alt: title,
                loading: 'lazy',
            }));
        } else {
            card.appendChild(el('div', {
                className: 'catalog-card-no-poster',
                textContent: filters.type === 'tv' ? '📺' : '🎬',
            }));
        }

        // Type badge
        card.appendChild(el('div', {
            className: 'catalog-card-badge',
            textContent: filters.type === 'tv' ? 'Serie' : 'Film',
        }));

        // In-list badge or add button
        if (alreadyInList) {
            card.appendChild(el('div', { className: 'catalog-card-in-list', textContent: '✓' }));
        } else {
            const addBtn = el('button', {
                className: 'catalog-card-add',
                textContent: '+',
                title: 'Aggiungi alla lista',
                onClick: (e) => {
                    e.stopPropagation();
                    addToList(result);
                    addBtn.replaceWith(el('div', { className: 'catalog-card-in-list', textContent: '✓' }));
                },
            });
            card.appendChild(addBtn);
        }

        // Hover overlay
        card.appendChild(el('div', { className: 'catalog-card-overlay' }, [
            el('div', { className: 'catalog-card-title', textContent: title }),
            el('div', { className: 'catalog-card-meta' }, [
                ...(rating ? [el('span', { className: 'catalog-card-rating', textContent: `⭐ ${rating}` })] : []),
                ...(year ? [el('span', { textContent: year })] : []),
            ]),
        ]));

        grid.appendChild(card);
    });
}

function setupCatalogScroll() {
    // Remove old handler if exists
    if (catalogScrollHandler) {
        window.removeEventListener('scroll', catalogScrollHandler);
    }

    catalogScrollHandler = () => {
        if (state.currentTab !== 'catalog') return;
        if (state.catalog.loading) return;
        if (state.catalog.page >= state.catalog.totalPages) return;

        const scrollBottom = window.innerHeight + window.scrollY;
        const docHeight = document.documentElement.scrollHeight;

        if (scrollBottom >= docHeight - 600) {
            loadCatalogPage(state.catalog.page + 1);
        }
    };

    window.addEventListener('scroll', catalogScrollHandler, { passive: true });
}

// ──────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ──────────────────────────────────────────────────────────────
function setupEventListeners() {
    console.log('[DEBUG] Attaching event listeners...');
    // Login screen
    $('#login-btn').addEventListener('click', () => {
        console.log('[DEBUG] Login button clicked!');
        handleLogin();
    });
    $('#password-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Profile management
    $('#manage-profiles-btn').addEventListener('click', openProfileEditModal);

    // Header profile click — go back to profile selection
    $('#header-profile').addEventListener('click', showProfileScreen);

    // Logo click — go to profile screen
    $('#logo-home').addEventListener('click', showProfileScreen);

    // Tab navigation
    $$('.nav-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Search button + FAB
    $('#btn-search-header').addEventListener('click', openSearchModal);
    $('#fab-add').addEventListener('click', openSearchModal);

    // Search input
    $('#search-input').addEventListener('input', (e) => {
        debouncedSearch(e.target.value);
    });

    // Close modals via overlay & close buttons
    $$('[data-close]').forEach(trigger => {
        trigger.addEventListener('click', () => closeModal(trigger.dataset.close));
    });

    // Close modals on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            ['search-modal', 'detail-modal', 'search-preview-modal', 'profile-edit-modal'].forEach(id => {
                if (!$(`#${id}`).classList.contains('hidden')) {
                    closeModal(id);
                }
            });
        }
    });

    // Header scroll effect
    window.addEventListener('scroll', () => {
        const header = $('#main-header');
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }, { passive: true });
}

// ──────────────────────────────────────────────────────────────
// INITIALIZATION
// ──────────────────────────────────────────────────────────────
function init() {
    console.log('[DEBUG] init() started');
    loadState();
    console.log('[DEBUG] loadState() finished');
    setupEventListeners();
    console.log('[DEBUG] setupEventListeners() finished');

    if (!isLoggedIn()) {
        console.log('[DEBUG] Not logged in, showing login screen');
        showLoginScreen();
    } else if (state.currentProfile === null) {
        console.log('[DEBUG] Logged in, no profile selected, showing profile screen');
        showProfileScreen();
    } else {
        console.log('[DEBUG] Fully logged in, showing app');
        showApp();
    }
}

console.log('[DEBUG] DOMContentLoaded listener attached');
document.addEventListener('DOMContentLoaded', init);
