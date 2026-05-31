// ============================================================
// feed-extras.js — Améliorations du feed
// • Tri : Récents / Populaires / Tendances
// • Compteur de vues (IntersectionObserver)
// • Bannière "Mood du jour"
// • Regroupement des posts par émotion
// • Infinite scroll (si l'API supporte ?page=X&limit=20)
// ============================================================

const API = 'https://moodshare-7dd7.onrender.com/api';

// ─── Mood du jour — couleur/emoji basé sur la date ───────────
const DAILY_MOODS = [
    { emoji: '☀️', theme: 'Bonne énergie', color: '#f7971e', text: 'quel est ton mood aujourd\'hui ?' },
    { emoji: '🌙', theme: 'Soirée calme', color: '#302b63', text: 'la nuit porte conseil…' },
    { emoji: '🌊', theme: 'Flow', color: '#4facfe', text: 'laisse-toi porter par le courant.' },
    { emoji: '🔥', theme: 'Motivation', color: '#f5576c', text: 'aujourd\'hui tu donne tout !' },
    { emoji: '🌸', theme: 'Douceur', color: '#a18cd1', text: 'prens soin de toi.' },
    { emoji: '🍂', theme: 'Nostalgie', color: '#8b5e3c', text: 'tes souvenirs ont leur beauté.' },
    { emoji: '🌈', theme: 'Optimisme', color: '#43cea2', text: 'après la pluie, le beau temps.' },
    { emoji: '💤', theme: 'Fatigue', color: '#9e9e9e', text: 'besoin d\'une petite pause ?' },
    { emoji: '💖', theme: 'Amour', color: '#ff6f91', text: 'répends un peu d\'amour aujourd\'hui.' },
    { emoji: '😎', theme: 'Cool', color: '#1f4037', text: 'reste détendu et confiant.' },
    { emoji: '😢', theme: 'Tristesse', color: '#4b6cb7', text: 'les émotions font partie de la vie.' },
    { emoji: '🤯', theme: 'Stress', color: '#f2994a', text: 'respire profondément, ça ira.' },
    { emoji: '😂', theme: 'Humour', color: '#f9d423', text: 'le rire est contagieux !' },
    { emoji: '🤗', theme: 'Bienveillance', color: '#43cea2', text: 'un câlin virtuel pour toi.' },
    { emoji: '🌀', theme: 'Confusion', color: '#5f2c82', text: 'prends le temps de clarifier tes idées.' },
    { emoji: '🌿', theme: 'Nature', color: '#76b852', text: 'reconnecte-toi avec le vert.' },
    { emoji: '🕊️', theme: 'Paix', color: '#c0c0c0', text: 'calme ton esprit et respire.' },
    { emoji: '🏃‍♂️', theme: 'Énergie', color: '#f12711', text: 'bouge et sent-toi vivant !' },
    { emoji: '🎶', theme: 'Musique', color: '#ff9a9e', text: 'laisse la musique guider ton humeur.' },
    { emoji: '📚', theme: 'Concentration', color: '#2c3e50', text: 'plonge toi dans tes passions.' },
    { emoji: '🎨', theme: 'Créativité', color: '#ff6a00', text: 'exprime-toi avec des couleurs.' },
    { emoji: '💡', theme: 'Inspiration', color: '#fceabb', text: 'une idée peut tout changer.' },
    { emoji: '🛌', theme: 'Relaxation', color: '#6a11cb', text: 'prends un moment pour toi.' },
    { emoji: '💪', theme: 'Force', color: '#56ab2f', text: 't\'es plus fort que tu ne le pense.' },
    { emoji: '🌻', theme: 'Joie', color: '#fbd786', text: 'souris, même pour un instant !' },
    { emoji: '🍁', theme: 'Automne', color: '#d1913c', text: 'les saisons rappellent le changement.' },
    { emoji: '🌌', theme: 'Mystère', color: '#141e30', text: 'contemple l\'univers et rêve.' },
    { emoji: '🕹️', theme: 'Jeu', color: '#ff512f', text: 'amuse-toi un peu !' },
    { emoji: '💭', theme: 'Réflexion', color: '#00c6ff', text: 'pense à ce qui compte vraiment.' },
    { emoji: '🌟', theme: 'Émerveillement', color: '#fceabb', text: 'les petites choses sont magiques.' },
    { emoji: '🌪️', theme: 'Chaos', color: '#283c86', text: 'accepte l\'imprévu.' },
    { emoji: '🧘‍♀️', theme: 'Sérénité', color: '#56ab2f', text: 'respire, tout est sous contrôle.' },
    { emoji: '🥳', theme: 'Fête', color: '#ff9a9e', text: 'célébre les petits moments !' },
    { emoji: '💔', theme: 'Cœur brisé', color: '#b31217', text: 'les émotions sont valides.' },
    { emoji: '🤩', theme: 'Excitation', color: '#f7971e', text: 'aujourd\'hui promet quelque chose de grand !' },
    { emoji: '🛶', theme: 'Aventure', color: '#2193b0', text: 'pars à la découverte du monde.' },
    { emoji: '🖤', theme: 'Mélancolie', color: '#000000', text: 'prends un moment pour te recentrer.' },
    { emoji: '🍀', theme: 'Chance', color: '#76b852', text: 'un peu de chance ne fait jamais de mal.' },
    { emoji: '💎', theme: 'Élégance', color: '#6a11cb', text: 'brille avec confiance.' },
    { emoji: '🌐', theme: 'Connexion', color: '#1f4037', text: 'rapproche-toi des autres.' },
    { emoji: '🍕', theme: 'Confort', color: '#f857a6', text: 'un petit plaisir pour se sentir bien.' },
    { emoji: '🦋', theme: 'Transformation', color: '#43cea2', text: 'chaque jour est une nouvelle chance.' },
    { emoji: '📸', theme: 'Souvenirs', color: '#ff512f', text: 'capture les moments précieux.' },
    { emoji: '🌅', theme: 'Espoir', color: '#f7971e', text: 'demain est un nouveau départ.' },
    { emoji: '🧩', theme: 'Curiosité', color: '#ff6a00', text: 'explore, apprends, découvre.' },
    { emoji: '🥰', theme: 'Gratitude', color: '#ff9a9e', text: 'remercie pour ce que tu as.' },
    { emoji: '🛡️', theme: 'Protection', color: '#283c86', text: 'prends soin de toi et de tes proches.' },
    { emoji: '⚓', theme: 'Stabilité', color: '#00c6ff', text: 'reste ancré dans le présent.' },
    { emoji: '🌺', theme: 'Beauté', color: '#fbd786', text: 'apprécie la beauté autour de toi.' },
    { emoji: '🦄', theme: 'Magie', color: '#a18cd1', text: 'crois en l\'impossible !' },
    { emoji: '🛍️', theme: 'Shopping', color: '#ff512f', text: 'un petit plaisir pour soi-même.' },
    { emoji: '🗻', theme: 'Défi', color: '#2c3e50', text: 'releve de nouveaux défis.' },
    { emoji: '🧸', theme: 'Confort émotionnel', color: '#f9d423', text: 'prends soin de ton cœur.' },
    { emoji: '🎯', theme: 'Objectifs', color: '#f12711', text: 'focalise-toi sur ce qui compte.' },
    { emoji: '🚀', theme: 'Ambition', color: '#56ab2f', text: 'vise haut et atteint tes rêves.' },
    { emoji: '🎉', theme: 'Célébration', color: '#ff9a9e', text: 'fête chaque victoire, petite ou grande.' },
    { emoji: '🥺', theme: 'Vulnérabilité', color: '#a18cd1', text: 'c\'est ok de montrer tes émotions.' },
    { emoji: '🪁', theme: 'Légèreté', color: '#43cea2', text: 'laisse tes soucis t\'envoler.' },
    { emoji: '🏖️', theme: 'Détente', color: '#f7971e', text: 'un moment pour respirer et se relaxer.' },
    { emoji: '🌪️', theme: 'Tourbillon', color: '#283c86', text: 'tout peut changer rapidement, reste calme.' },
    { emoji: '🕵️‍♂️', theme: 'Curiosité', color: '#ff6a00', text: 'explore ce qui t\'intrigue.' },
    { emoji: '🪄', theme: 'Magie du quotidien', color: '#fbd786', text: 'cherche la magie dans les petits gestes.' },
    { emoji: '🌼', theme: 'Fraîcheur', color: '#76b852', text: 'un souffle de nouveauté et d\'énergie.' },
    { emoji: '💃', theme: 'Danse', color: '#ff512f', text: 'bouge pour libérer tes émotions.' },
    { emoji: '🛶', theme: 'Aventure', color: '#2193b0', text: 'pars à la découverte de nouvelles expériences.' },
    { emoji: '🍩', theme: 'Plaisir', color: '#f9d423', text: 'un petit plaisir pour se remonter le moral.' },
    { emoji: '🎈', theme: 'Enfance', color: '#f7971e', text: 'rappelle-toi des joies simples.' },
    { emoji: '🧩', theme: 'Réflexion', color: '#00c6ff', text: 'résous tes problèmes étape par étape.' },
    { emoji: '🌙', theme: 'Calme nocturne', color: '#302b63', text: 'la nuit aide à apaiser l’esprit.' },
    { emoji: '💭', theme: 'Rêverie', color: '#ff6a00', text: 'laisse ton esprit vagabonder librement.' },
    { emoji: '📖', theme: 'Sagesse', color: '#2c3e50', text: 'apprends quelque chose de nouveau aujourd’hui.' },
    { emoji: '💫', theme: 'Espoir', color: '#fceabb', text: 'même les petites lueurs comptent.' },
    { emoji: '🛡️', theme: 'Protection', color: '#283c86', text: 'protége tes limites et tes proches.' },
    { emoji: '🌺', theme: 'Épanouissement', color: '#fbd786', text: 'fleuris malgré les obstacles.' },
    { emoji: '🦋', theme: 'Métamorphose', color: '#43cea2', text: 'change et évolue à ton rythme.' },
    { emoji: '🧸', theme: 'Confort', color: '#f9d423', text: 'un moment pour se sentir en sécurité.' },
    { emoji: '🏔️', theme: 'Défi', color: '#2c3e50', text: 'chaque sommet est atteignable avec patience.' },
    { emoji: '🥂', theme: 'Réussite', color: '#ff9a9e', text: 'célébre tes accomplissements.' },
    { emoji: '🎭', theme: 'Expression', color: '#ff512f', text: 'exprime tes émotions sans retenue.' },
    { emoji: '💡', theme: 'Idée', color: '#fceabb', text: 'une étincelle peut changer la journée.' },
    { emoji: '📸', theme: 'Souvenirs', color: '#ff512f', text: 'capture tes moments précieux.' },
    { emoji: '🧘‍♂️', theme: 'Zen', color: '#56ab2f', text: 'respire et trouvez l’équilibre.' },
    { emoji: '🚴‍♀️', theme: 'Énergie active', color: '#f12711', text: 'bouge pour recharger tes batteries.' },
    { emoji: '🌌', theme: 'Inspiration', color: '#141e30', text: 'laisse le ciel étoilé te guider.' },
    { emoji: '🤝', theme: 'Solidarité', color: '#1f4037', text: 'soutiens et sois soutenu.' },
    { emoji: '📬', theme: 'Communication', color: '#00b09b', text: 'partage tes pensées avec les autres.' },
    { emoji: '⚡', theme: 'Pulsion', color: '#f5576c', text: 'laisse l’énergie te guider.' },
    { emoji: '🥳', theme: 'Festivité', color: '#ff9a9e', text: 'fais la fête pour toi-même !' },
    { emoji: '🤔', theme: 'Réflexion', color: '#4b6cb7', text: 'prends le temps d’analyser calmement.' },
    { emoji: '🪁', theme: 'Liberté', color: '#43cea2', text: 'laisse ton esprit s’envoler.' },
    { emoji: '🏖️', theme: 'Évasion', color: '#f7971e', text: 'change d’air, même mentalement.' },
    { emoji: '🎶', theme: 'Musicalité', color: '#ff9a9e', text: 'laisse les sons guider tes émotions.' },
    { emoji: '🥰', theme: 'Gratitude', color: '#ff6a00', text: 'remercie pour ce que tu as aujourd\’hui.' },
    { emoji: '😇', theme: 'Bienveillance', color: '#43cea2', text: 'fais du bien autour de toi.' },
    { emoji: '😤', theme: 'Détermination', color: '#f12711', text: 'ne lâche rien, persévère !' },
    { emoji: '🧚‍♀️', theme: 'Rêve', color: '#a18cd1', text: 'crois aux merveilles du quotidien.' },
    { emoji: '💌', theme: 'Amour', color: '#ff6f91', text: 'envoie un mot doux à quelqu’un.' },
    { emoji: '🪞', theme: 'Introspection', color: '#283c86', text: 'regarde à l’intérieur pour mieux avancer.' },
    { emoji: '🎬', theme: 'Cinéma', color: '#f9d423', text: 'plonge dans une autre réalité.' },
    { emoji: '📍', theme: 'Focus', color: '#2c3e50', text: 'reste concentré sur tes objectifs.' },
    { emoji: '🛶', theme: 'Exploration', color: '#2193b0', text: 'découvre de nouveaux horizons.' },
    { emoji: '💎', theme: 'Brillance', color: '#6a11cb', text: 'sois fier de ce que tu es.' },
    { emoji: '🌈', theme: 'Positivité', color: '#43cea2', text: 'cheche le bon côté des choses.' },
    { emoji: '🦸‍♀️', theme: 'Pouvoir', color: '#f5576c', text: 'chaque action compte, sois ton héros.' },
    { emoji: '🌿', theme: 'Calme naturel', color: '#76b852', text: 'respire l’air frais et détends-toi.' },
    { emoji: '📅', theme: 'Organisation', color: '#00c6ff', text: 'planifie pour mieux avancer.' },
    { emoji: '🗺️', theme: 'Aventure', color: '#ff512f', text: 'Chaque jour est un nouveau voyage.' },
    { emoji: '🎨', theme: 'Art', color: '#ff6a00', text: 'exprime tes émotions avec créativité.' },
    { emoji: '🕊️', theme: 'Paix intérieure', color: '#c0c0c0', text: 'trouve la sérénité malgré le chaos.' },
    { emoji: '🏹', theme: 'Objectif', color: '#f12711', text: 'vise juste et atteint tes buts.' },
    { emoji: '🛍️', theme: 'Plaisir simple', color: '#ff512f', text: 'offre-toi un petit bonheur.' },
    { emoji: '🧗‍♂️', theme: 'Challenge', color: '#2c3e50', text: 'releve des défis pour grandir.' },
    { emoji: '🌟', theme: 'Émerveillement', color: '#fceabb', text: 'admire les beautés autour de toi.' },
    { emoji: '🕹️', theme: 'Jeu', color: '#ff512f', text: 'amuse-toi et détends-toi.' },
    { emoji: '🥗', theme: 'Santé', color: '#76b852', text: 'prends soin de ton corps.' },
    { emoji: '🛌', theme: 'Repos', color: '#6a11cb', text: 'un moment pour récupérer et recharger.' },
    { emoji: '🌅', theme: 'Renouveau', color: '#f7971e', text: 'chaque jour apporte une nouvelle chance.' }
];

function _getTodayMood() {
    // Pioche une phrase au hasard chaque jour
    return DAILY_MOODS[Math.floor(new Date().getTime() / (1000 * 60 * 60 * 24)) % DAILY_MOODS.length];
}

// ─── Point d'entrée ──────────────────────────────────────────
export function initFeedExtras() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
}

function _init() {
    _initFeedSelector();
    _injectSortBar();
    _watchFeedChanges();
    _injectMoodOfDay();
    _injectDClink();
    _initViewCounter();
    _initInfiniteScroll();
}

// ─── Sélecteur Feed: Posts / Stories ─────────────────────
function _initFeedSelector() {
    const feedSelector = document.getElementById('feed-selector');
    const storiesContainer = document.getElementById('stories-container');
    const postsContainer = document.getElementById('posts-container');

    if (!feedSelector) return;

    feedSelector.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const feed = btn.dataset.feed;
            
            // Mettre à jour l'état actif du bouton
            feedSelector.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('sort-btn--active'));
            btn.classList.add('sort-btn--active');

            // Afficher/masquer les containers
            if (feed === 'posts') {
                postsContainer.classList.remove('hidden');
                storiesContainer.classList.add('hidden');
            } else if (feed === 'stories') {
                storiesContainer.classList.remove('hidden');
                postsContainer.classList.add('hidden');
            }
        });
    });
}

// ─── Observer pour mettre à jour l'ordre original quand le feed change ─────
function _watchFeedChanges() {
    const wall = document.getElementById('moodWall');

    if (wall) {
        const observerPosts = new MutationObserver(() => {
            // Re-sauvegarder l'ordre original des posts
            _saveOriginalOrder();
        });
        observerPosts.observe(wall, { childList: true, subtree: false });
    }
}

// ─── 1. Système de tri pour Posts ───────────────────────
// État du tri
const _feedState = {
    posts: {
        originalOrder: [],
        currentSort: 'recent'
    }
};

function _injectSortBar() {
    const wall = document.getElementById('moodWall');
    const bar = document.getElementById('sort-bar');

    if (wall && bar && !bar.hasAttribute('data-initialized')) {
        bar.innerHTML = `
            <button class="sort-btn sort-btn--active" data-sort="recent">Récents</button>
            <button class="sort-btn" data-sort="popular">Populaires</button>
            <button class="sort-btn" data-sort="trending">Tendances</button>
        `;
        bar.setAttribute('data-initialized', 'true');

        bar.querySelectorAll('.sort-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                bar.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('sort-btn--active'));
                btn.classList.add('sort-btn--active');
                _sortFeed(btn.dataset.sort);
            });
        });
    }
}

// Fonction pour sauvegarder l'ordre original des posts
function _saveOriginalOrder() {
    const container = document.getElementById('moodWall');
    
    if (!container) return;

    const items = Array.from(container.querySelectorAll('.post:not(.WelcomeMood)'));
    _feedState.posts.originalOrder = items.map(item => item.cloneNode(true));
}

function _sortFeed(mode) {
    const wall = document.getElementById('moodWall');
    
    if (!wall) return;

    // Toujours récupérer l'ordre actuel du DOM
    const items = Array.from(wall.querySelectorAll('.post:not(.WelcomeMood)'));
    if (!items.length) return;

    // Si on n'a pas d'ordre original, le sauvegarder maintenant
    if (_feedState.posts.originalOrder.length === 0) {
        _saveOriginalOrder();
    }

    // Mettre à jour l'état
    _feedState.posts.currentSort = mode;

    // Créer un array de copie pour le tri
    const itemsToSort = [...items];

    itemsToSort.sort((a, b) => {
        if (mode === 'popular') {
            const la = parseInt(a.querySelector('.like-count')?.textContent || '0', 10);
            const lb = parseInt(b.querySelector('.like-count')?.textContent || '0', 10);
            return lb - la;
        }
        if (mode === 'trending') {
            // Score = likes + (bonus pour récents)
            const la = parseInt(a.querySelector('.like-count')?.textContent || '0', 10);
            const lb = parseInt(b.querySelector('.like-count')?.textContent || '0', 10);
            const ia = items.indexOf(a);
            const ib = items.indexOf(b);
            const scoreA = la * 2 + (items.length - ia);
            const scoreB = lb * 2 + (items.length - ib);
            return scoreB - scoreA;
        }
        // recent = ordre original
        return items.indexOf(a) - items.indexOf(b);
    });

    // Réordonner dans le DOM avec animation
    itemsToSort.forEach((item, i) => {
        item.style.transition = 'opacity 0.2s';
        item.style.opacity = '0';
        setTimeout(() => {
            wall.appendChild(item);
            item.style.opacity = '1';
        }, i * 30);
    });
}

// ─── 2. Bannière Mood du jour ────────────────────────────────
function _injectMoodOfDay() {
    const wall = document.getElementById('moodWall');
    if (!wall || document.getElementById('mood-today')) return;

    const mood = _getTodayMood();
    const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

    const banner = document.createElement('div');
    banner.id = 'mood-today';
    banner.className = 'mood-today';
    banner.style.setProperty('--mood-color', mood.color);
    banner.innerHTML = `
        <div class="mood-today__emoji">${mood.emoji}</div>
        <div class="mood-today__content">
            <p class="mood-today__theme">${mood.theme} du ${today}</p>
            <p class="mood-today__text">${mood.text}</p>
        </div>
        <button class="mood-today__share" title="Partager mon mood">Partager un post</button>
        <button class="mood-today__close"  title="Fermer" aria-label="Fermer" style="color: white; background: rgba(255, 0, 0, 0.31); width: 40px; height: 40px; border-radius: 5px; display: flex; align-items: center; justify-content: center;">✕</button>
    `;

    wall.insertAdjacentElement('beforebegin', banner);

    // Bouton "Partager"  → focus sur le créateur
    banner.querySelector('.mood-today__share').addEventListener('click', () => {
        const createBtn = document.getElementById('createTab');
        if (createBtn) createBtn.click();
        const moodInput = document.getElementById('moodInput');
        if (moodInput) {
            moodInput.focus();
            if (!moodInput.value) moodInput.value = mood.emoji + ' ';
            moodInput.dispatchEvent(new Event('input'));
        }
    });

    // Bouton fermer
    banner.querySelector('.mood-today__close').addEventListener('click', () => {
        banner.style.animation = 'v2FadeOut 0.3s ease forwards';
        setTimeout(() => banner.remove(), 300);
    });

}

// ─── 2. Bannière Mood du jour ────────────────────────────────
function _injectDClink() {
    const wall = document.getElementById('moodWall');
    if (!wall || document.getElementById('dc-link')) return;

    const linkbanner = document.createElement('div');
    linkbanner.id = 'dc-link';
    linkbanner.className = 'dc-link';

    linkbanner.innerHTML = `
        <a
        id="discordbtn"
        href="https://discord.gg/xvVnNAGNtP"
      >
        <div id="discordlogo">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
            <path
              d="M524.5 133.8C524.3 133.5 524.1 133.2 523.7 133.1C485.6 115.6 445.3 103.1 404 96C403.6 95.9 403.2 96 402.9 96.1C402.6 96.2 402.3 96.5 402.1 96.9C396.6 106.8 391.6 117.1 387.2 127.5C342.6 120.7 297.3 120.7 252.8 127.5C248.3 117 243.3 106.8 237.7 96.9C237.5 96.6 237.2 96.3 236.9 96.1C236.6 95.9 236.2 95.9 235.8 95.9C194.5 103 154.2 115.5 116.1 133C115.8 133.1 115.5 133.4 115.3 133.7C39.1 247.5 18.2 358.6 28.4 468.2C28.4 468.5 28.5 468.7 28.6 469C28.7 469.3 28.9 469.4 29.1 469.6C73.5 502.5 123.1 527.6 175.9 543.8C176.3 543.9 176.7 543.9 177 543.8C177.3 543.7 177.7 543.4 177.9 543.1C189.2 527.7 199.3 511.3 207.9 494.3C208 494.1 208.1 493.8 208.1 493.5C208.1 493.2 208.1 493 208 492.7C207.9 492.4 207.8 492.2 207.6 492.1C207.4 492 207.2 491.8 206.9 491.7C191.1 485.6 175.7 478.3 161 469.8C160.7 469.6 160.5 469.4 160.3 469.2C160.1 469 160 468.6 160 468.3C160 468 160 467.7 160.2 467.4C160.4 467.1 160.5 466.9 160.8 466.7C163.9 464.4 167 462 169.9 459.6C170.2 459.4 170.5 459.2 170.8 459.2C171.1 459.2 171.5 459.2 171.8 459.3C268 503.2 372.2 503.2 467.3 459.3C467.6 459.2 468 459.1 468.3 459.1C468.6 459.1 469 459.3 469.2 459.5C472.1 461.9 475.2 464.4 478.3 466.7C478.5 466.9 478.7 467.1 478.9 467.4C479.1 467.7 479.1 468 479.1 468.3C479.1 468.6 479 468.9 478.8 469.2C478.6 469.5 478.4 469.7 478.2 469.8C463.5 478.4 448.2 485.7 432.3 491.6C432.1 491.7 431.8 491.8 431.6 492C431.4 492.2 431.3 492.4 431.2 492.7C431.1 493 431.1 493.2 431.1 493.5C431.1 493.8 431.2 494 431.3 494.3C440.1 511.3 450.1 527.6 461.3 543.1C461.5 543.4 461.9 543.7 462.2 543.8C462.5 543.9 463 543.9 463.3 543.8C516.2 527.6 565.9 502.5 610.4 469.6C610.6 469.4 610.8 469.2 610.9 469C611 468.8 611.1 468.5 611.1 468.2C623.4 341.4 590.6 231.3 524.2 133.7zM222.5 401.5C193.5 401.5 169.7 374.9 169.7 342.3C169.7 309.7 193.1 283.1 222.5 283.1C252.2 283.1 275.8 309.9 275.3 342.3C275.3 375 251.9 401.5 222.5 401.5zM417.9 401.5C388.9 401.5 365.1 374.9 365.1 342.3C365.1 309.7 388.5 283.1 417.9 283.1C447.6 283.1 471.2 309.9 470.7 342.3C470.7 375 447.5 401.5 417.9 401.5z"
            ></path>
          </svg>
        </div>
        <h2>Rejoins notre serveur Discord !</h2>
      </a>
        <button class="dc-link__close" title="Fermer" aria-label="Fermer" style="color: white; background: rgba(255, 0, 0, 0.31); width: 40px; height: 40px; border-radius: 5px; display: flex; align-items: center; justify-content: center;">✕</button>
    `;

    wall.insertAdjacentElement('beforebegin', linkbanner);


    // Bouton fermer
    linkbanner.querySelector('.dc-link__close').addEventListener('click', () => {
        linkbanner.style.animation = 'v2FadeOut 0.3s ease forwards';
        setTimeout(() => linkbanner.remove(), 300);
    });

}

// ─── 3. Compteur de vues ────────────────────────────────────
const _viewedPosts = new Set();

function _initViewCounter() {
    if (!('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const post = entry.target;
            const postId = post.dataset.id;
            if (!postId || _viewedPosts.has(postId)) return;

            _viewedPosts.add(postId);
            observer.unobserve(post);

            // Incrémenter côté serveur (fire-and-forget)
            fetch(`${API}/posts/${postId}/view`, {
                method: 'POST',
                credentials: 'include'
            }).catch(() => { });

            // Afficher le compteur local si pas encore fait
            _showViewCount(post, postId);
        });
    }, { threshold: 0.6, rootMargin: '0px' });

    // Observer les posts existants
    document.querySelectorAll('.post[data-id]').forEach(p => observer.observe(p));

    // Observer les nouveaux posts
    const wall = document.getElementById('moodWall');
    if (wall) {
        new MutationObserver(mutations => {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.classList?.contains('post') && node.dataset?.id) {
                        observer.observe(node);
                    }
                });
            });
        }).observe(wall, { childList: true });
    }
}

async function _showViewCount(postEl, postId) {
    const dateP = postEl.querySelector('.postdate');
    if (!dateP || postEl.querySelector('.views')) return;

    const viewsEl = document.createElement('span');
    viewsEl.className = 'views';
    viewsEl.textContent = ' · … vues';
    dateP.appendChild(viewsEl);

    try {
        const res = await fetch(`${API}/posts/${postId}`);
        if (res.ok) {
            const data = await res.json();
            const views = data.views || data.viewCount || 1;
            viewsEl.textContent = ` · ${views} vues`;
        }
    } catch {
        viewsEl.textContent = ' · 1 vue';
    }
}

// ─── 4. Infinite scroll ──────────────────────────────────────
let _currentPage = 1;
let _isLoadingMore = false;
let _hasMore = true;

function _initInfiniteScroll() {
    if (!('IntersectionObserver' in window)) return;

    const sentinel = document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    sentinel.className = 'scroll-sentinel';
    sentinel.innerHTML = `<div class="scroll-loader" style="display:none">
        <span class="loader-dot"></span><span class="loader-dot"></span><span class="loader-dot"></span>
    </div>`;

    const wall = document.getElementById('moodWall');
    if (!wall) return;
    wall.insertAdjacentElement('afterend', sentinel);

    const loader = sentinel.querySelector('.scroll-loader');

    const observer = new IntersectionObserver(async (entries) => {
        if (!entries[0].isIntersecting) return;
        if (_isLoadingMore || !_hasMore) return;

        _isLoadingMore = true;
        loader.style.display = 'flex';

        try {
            _currentPage++;
            const res = await fetch(`${API}/posts?page=${_currentPage}&limit=20`);
            if (!res.ok) { _hasMore = false; return; }
            const posts = await res.json();

            if (!Array.isArray(posts) || posts.length === 0) {
                _hasMore = false;
                sentinel.innerHTML = '<p class="no-more">Tu avez tout vu ! 🎉</p>';
                return;
            }

            // Appeler displayMood depuis app.js (via window)
            if (typeof window.displayMoodV2 === 'function') {
                posts.forEach(p => window.displayMoodV2(p));
            }
        } catch {
            _hasMore = false;
        } finally {
            _isLoadingMore = false;
            loader.style.display = 'none';
        }
    }, { rootMargin: '200px' });

    observer.observe(sentinel);
}

// ─── Exposer pour que app.js puisse notifier qu'un post est ajouté ──
export function notifyPostAdded(postEl) {
    // Pour que le view counter observe les nouveaux posts dynamiques
    // (déjà géré par le MutationObserver interne)
}

// ─── Réinitialiser la pagination (si on recharge le feed) ────
export function resetPagination() {
    _currentPage = 1;
    _hasMore = true;
    _isLoadingMore = false;
}