/* ============================================================
   DiVanoLetto — Application Logic + TMDB API
   ============================================================ */

// ──────────────────────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────────────────────
const CONFIG = {
    TMDB_BASE: 'https://api.themoviedb.org/3',
    TMDB_IMG: 'https://image.tmdb.org/t/p/',
    STORAGE_KEY: 'divanoLetto_data',
    STORAGE_KEY_API: 'divanoLetto_apiKey',
    STORAGE_KEY_PROFILE: 'divanoLetto_currentProfile',
    DEBOUNCE_MS: 400,
    EMOJI_OPTIONS: ['😎', '💖', '🦊', '🐱', '👑', '🌸', '🎮', '🎵', '🌙', '⭐', '🔥', '🎭', '🦄', '🐼', '🌺', '💜', '🍕', '🎬', '🧸', '🌈', '🐉', '🦋', '🍿', '🎧'],
};

// ──────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────
let state = {
    apiKey: '',
    profiles: [
        { name: 'Io', emoji: '😎' },
        { name: 'Amore', emoji: '💖' },
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
        url.searchParams.set('api_key', state.apiKey);
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

    async validateKey(key) {
        try {
            const res = await fetch(`${CONFIG.TMDB_BASE}/configuration?api_key=${key}`);
            return res.ok;
        } catch {
            return false;
        }
    },

    imgUrl(path, size = 'w342') {
        if (!path) return null;
        return `${CONFIG.TMDB_IMG}${size}${path}`;
    },
};

// ──────────────────────────────────────────────────────────────
// PERSISTENCE (localStorage)
// ──────────────────────────────────────────────────────────────
function saveState() {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
        profiles: state.profiles,
        lists: state.lists,
    }));
}

function loadState() {
    state.apiKey = localStorage.getItem(CONFIG.STORAGE_KEY_API) || '';
    const profileIdx = localStorage.getItem(CONFIG.STORAGE_KEY_PROFILE);
    if (profileIdx !== null) state.currentProfile = parseInt(profileIdx, 10);

    const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if (data.profiles) state.profiles = data.profiles;
            if (data.lists) {
                state.lists.movie = data.lists.movie || [];
                state.lists.tv = data.lists.tv || [];
                state.lists.anime = data.lists.anime || [];
            }
        } catch (e) {
            console.error('Failed to parse saved state:', e);
        }
    }
}

function saveApiKey(key) {
    state.apiKey = key;
    localStorage.setItem(CONFIG.STORAGE_KEY_API, key);
}

function saveCurrentProfile(index) {
    state.currentProfile = index;
    localStorage.setItem(CONFIG.STORAGE_KEY_PROFILE, index);
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
// RENDERING — SETUP SCREEN
// ──────────────────────────────────────────────────────────────
function showSetupScreen() {
    $('#setup-screen').classList.remove('hidden');
    $('#profile-screen').classList.add('hidden');
    $('#app').classList.add('hidden');
    const input = $('#api-key-input');
    input.value = '';
    setTimeout(() => input.focus(), 300);
}

// ──────────────────────────────────────────────────────────────
// RENDERING — PROFILE SCREEN
// ──────────────────────────────────────────────────────────────
function showProfileScreen() {
    $('#setup-screen').classList.add('hidden');
    $('#profile-screen').classList.remove('hidden');
    $('#app').classList.add('hidden');

    const container = $('#profiles-container');
    container.innerHTML = '';

    state.profiles.forEach((profile, idx) => {
        const card = el('div', {
            className: 'profile-card',
            onClick: () => selectProfile(idx),
        }, [
            el('div', { className: 'profile-avatar', textContent: profile.emoji }),
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
    $('#setup-screen').classList.add('hidden');
    $('#profile-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderHeader();
    renderHero();
    renderContent();
}

function renderHeader() {
    const profile = state.profiles[state.currentProfile];
    if (profile) {
        $('#header-profile-emoji').textContent = profile.emoji;
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

    // Hover overlay
    const year = getYear(item);
    const ratingText = item.voteAverage ? `⭐ ${item.voteAverage.toFixed(1)}` : '';
    const overlay = el('div', { className: 'card-overlay' }, [
        el('div', { className: 'card-title', textContent: item.title }),
        el('div', { className: 'card-meta' }, [
            ...(ratingText ? [el('span', { className: 'card-rating', textContent: ratingText })] : []),
            ...(year ? [el('span', { textContent: year })] : []),
        ]),
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

        // Emoji selector
        const emojiBtn = el('span', {
            className: 'profile-edit-emoji',
            textContent: profile.emoji,
            onClick: () => toggleEmojiPicker(idx),
            id: `emoji-btn-${idx}`,
        });
        item.appendChild(emojiBtn);

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
        item.appendChild(nameInput);

        container.appendChild(item);

        // Emoji picker (hidden by default)
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
                    emojiBtn.textContent = emoji;
                    picker.querySelectorAll('.emoji-option').forEach(o => o.classList.remove('selected'));
                    picker.querySelector(`.emoji-option:nth-child(${CONFIG.EMOJI_OPTIONS.indexOf(emoji) + 1})`).classList.add('selected');
                },
            }));
        });
        container.appendChild(picker);
    });

    // Save button
    const actions = el('div', { className: 'profile-edit-actions' });
    actions.appendChild(el('button', {
        className: 'btn btn-primary',
        textContent: 'Salva',
        onClick: () => {
            saveState();
            closeModal('profile-edit-modal');
            renderHeader();
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

    // Fetch full details for genres
    const details = await TMDB.getDetails(tmdbId, tab);
    const genres = details && details.genres ? details.genres.map(g => g.name) : [];

    const item = {
        tmdbId,
        mediaType: tab === 'anime' ? 'tv' : tab,
        title: tmdbResult.title || tmdbResult.name || '',
        posterPath: tmdbResult.poster_path || null,
        backdropPath: tmdbResult.backdrop_path || null,
        overview: tmdbResult.overview || '',
        genres,
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
    // Setup screen — Save API key
    $('#save-api-key').addEventListener('click', async () => {
        const key = $('#api-key-input').value.trim();
        if (!key) {
            $('#setup-error').classList.remove('hidden');
            return;
        }
        $('#save-api-key').textContent = 'Verifico...';
        $('#save-api-key').disabled = true;
        const valid = await TMDB.validateKey(key);
        if (valid) {
            saveApiKey(key);
            showProfileScreen();
        } else {
            $('#setup-error').classList.remove('hidden');
        }
        $('#save-api-key').textContent = 'Inizia';
        $('#save-api-key').disabled = false;
    });

    // Setup — Enter key
    $('#api-key-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#save-api-key').click();
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
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
        const header = $('#main-header');
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
        lastScroll = window.scrollY;
    }, { passive: true });
}

// ──────────────────────────────────────────────────────────────
// INITIALIZATION
// ──────────────────────────────────────────────────────────────
function init() {
    loadState();
    setupEventListeners();

    if (!state.apiKey) {
        showSetupScreen();
    } else if (state.currentProfile === null) {
        showProfileScreen();
    } else {
        showApp();
    }
}

document.addEventListener('DOMContentLoaded', init);
