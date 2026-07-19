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
    APP_PASSWORD: 'divanoletto',
    STORAGE_KEY: 'divanoLetto_data',
    STORAGE_KEY_PROFILE: 'divanoLetto_currentProfile',
    SESSION_KEY: 'divanoLetto_session',
    DEBOUNCE_MS: 400,
    MAX_IMG_SIZE: 200, // max width/height in px for profile images (to keep localStorage small)
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

function renderAvatar(profile) {
    const wrap = el('div', { className: profile.image ? 'profile-avatar' : 'profile-avatar profile-emoji' });
    if (profile.image) {
        wrap.appendChild(el('img', { className: 'profile-img', src: profile.image, alt: profile.name }));
    } else {
        wrap.textContent = profile.emoji;
    }
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
    if (profile.image) {
        headerEl.appendChild(el('img', {
            className: 'profile-img',
            src: profile.image,
            alt: profile.name,
        }));
    } else {
        headerEl.textContent = profile.emoji;
    }
}

// ──────────────────────────────────────────────────────────────
// RENDERING — HERO BANNER
// ──────────────────────────────────────────────────────────────
function renderHero() {
    const hero = $('#hero');
    const list = state.lists[state.currentTab];
    const toWatch = list.filter(i => i.status === 'to_watch');

    if (toWatch.length === 0) {
        // Empty hero
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

    // Pick a random item for the hero
    const heroItem = toWatch[Math.floor(Math.random() * toWatch.length)];
    const backdropUrl = TMDB.imgUrl(heroItem.backdropPath, 'w1280');

    hero.innerHTML = '';

    // Backdrop
    const backdrop = el('div', { className: 'hero-backdrop' });
    if (backdropUrl) {
        backdrop.style.backgroundImage = `url(${backdropUrl})`;
    } else {
        backdrop.innerHTML = '<div class="hero-gradient-bg"></div>';
    }
    hero.appendChild(backdrop);

    // Content
    const genres = heroItem.genres ? heroItem.genres.join(', ') : '';
    const content = el('div', { className: 'hero-content' }, [
        el('div', { className: 'hero-badge', textContent: `${getStatusEmoji('to_watch')} Da vedere` }),
        el('h2', { className: 'hero-title', textContent: heroItem.title }),
        ...(heroItem.voteAverage ? [
            el('div', { className: 'hero-meta' }, [
                el('span', { className: 'hero-rating', innerHTML: `⭐ ${heroItem.voteAverage.toFixed(1)}` }),
                el('span', { className: 'hero-year', textContent: getYear(heroItem) }),
                ...(genres ? [el('span', { className: 'hero-genres', textContent: genres })] : []),
            ]),
        ] : []),
        ...(heroItem.overview ? [
            el('p', { className: 'hero-overview', textContent: heroItem.overview }),
        ] : []),
        el('div', { className: 'hero-actions' }, [
            el('button', {
                className: 'btn btn-primary',
                textContent: 'ℹ️ Dettagli',
                onClick: () => openDetailModal(heroItem),
            }),
            el('button', {
                className: 'btn btn-secondary',
                textContent: '▶️ In corso',
                onClick: () => {
                    updateItemStatus(heroItem.tmdbId, 'watching');
                    showToast('Stato aggiornato: In corso ▶️');
                },
            }),
        ]),
    ]);
    hero.appendChild(content);
}

// ──────────────────────────────────────────────────────────────
// RENDERING — CONTENT ROWS
// ──────────────────────────────────────────────────────────────
function renderContent() {
    const main = $('#main-content');
    main.innerHTML = '';
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

    // Added by emoji
    if (state.profiles[item.addedBy]) {
        card.appendChild(el('div', {
            className: 'card-added-by',
            textContent: state.profiles[item.addedBy].emoji,
        }));
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
            el('div', { className: 'card-added-label', textContent: `${addedByProfile.emoji} ${addedByProfile.name}` }),
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

        const card = el('div', { className: 'search-card' });

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
        ratingControl.appendChild(el('span', {
            className: 'detail-control-label',
            textContent: `${profile.emoji} ${profile.name}`,
        }));
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
                        showToast(`${profile.emoji} ha dato ${'★'.repeat(newRating)}${'☆'.repeat(5 - newRating)}`);
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
    const addedInfo = el('div', { className: 'detail-added-info' });
    if (addedProfile) {
        addedInfo.textContent = `Aggiunto da ${addedProfile.emoji} ${addedProfile.name} • ${formatDate(item.addedAt)}`;
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

        if (profile.image) {
            avatarDisplay.appendChild(el('img', {
                className: 'profile-img',
                src: profile.image,
                alt: profile.name,
            }));
        } else {
            avatarDisplay.textContent = profile.emoji;
        }

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

        // Emoji selector button (only if no image)
        if (!profile.image) {
            const emojiBtn = el('button', {
                className: 'btn-text emoji-toggle-btn',
                textContent: `${profile.emoji} Cambia emoji`,
                onClick: () => toggleEmojiPicker(idx),
                id: `emoji-btn-${idx}`,
            });
            rightCol.appendChild(emojiBtn);
        }

        item.appendChild(rightCol);
        container.appendChild(item);

        // Emoji picker (hidden by default, only if no image)
        if (!profile.image) {
            const picker = el('div', {
                className: 'emoji-picker hidden',
                id: `emoji-picker-${idx}`,
            });
            CONFIG.EMOJI_OPTIONS.forEach(emoji => {
                picker.appendChild(el('span', {
                    className: `emoji-option ${emoji === profile.emoji ? 'selected' : ''}`,
                    textContent: emoji,
                    onClick: () => {
                        state.profiles[idx].emoji = emoji;
                        const btn = $(`#emoji-btn-${idx}`);
                        if (btn) btn.textContent = `${emoji} Cambia emoji`;
                        picker.querySelectorAll('.emoji-option').forEach(o => o.classList.remove('selected'));
                        picker.querySelector(`.emoji-option:nth-child(${CONFIG.EMOJI_OPTIONS.indexOf(emoji) + 1})`).classList.add('selected');
                    },
                }));
            });
            container.appendChild(picker);
        }
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

function toggleEmojiPicker(idx) {
    const picker = $(`#emoji-picker-${idx}`);
    picker.classList.toggle('hidden');
}

// ──────────────────────────────────────────────────────────────
// DATA OPERATIONS
// ──────────────────────────────────────────────────────────────
async function addToList(tmdbResult) {
    const tab = state.currentTab;
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
    state.currentTab = tab;

    // Update active tab in both navs
    $$('.nav-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    renderHero();
    renderContent();
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
            ['search-modal', 'detail-modal', 'profile-edit-modal'].forEach(id => {
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
