// assets/js/social.js
// Bannière suggestions + partage posts + favoris

const API = 'https://moodshare-7dd7.onrender.com/api';

export async function initSocial() {
    console.log('🔧 Init social features');
    await new Promise(r => setTimeout(r, 1000)); // Attendre auth + feed

    // Injecter bannière suggestions
    injectSuggestionsBanner();


    // Refresh toutes les 30s
    setInterval(injectSuggestionsBanner, 30000);
}

// ============================================================
// BANNIÈRE SUGGESTIONS (comme Instagram)
// ============================================================

async function injectSuggestionsBanner() {
    try {
        const token = localStorage.getItem('moodshare_token');
        if (!token) {
            console.log('🔒 Pas connecté, pas de suggestions');
            return;
        }

        const res = await fetch(`${API}/social/suggestions`, { credentials: 'include' });
        if (!res.ok) return;

        const data = await res.json();

        // Trouver le feed
        const feed = document.getElementById('moodWall');
        if (!feed) return;

        // Vérifier si bannière existe déjà
        let banner = feed.querySelector('.suggestions-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.className = 'suggestions-banner';

            // Insérer après 3 posts
            const posts = feed.querySelectorAll('.post');
            if (posts.length >= 3) {
                posts[2].after(banner);
            } else {
                feed.appendChild(banner);
            }
        }

        // Remplir bannière
        banner.innerHTML = `
      <div class="banner-header">
        <h3>✨ Comptes que tu pourriez aimer</h3>
        <button class="banner-refresh" title="Actualiser">🔄</button>
      </div>
      <div class="suggestions-list"></div>
    `;

        const list = banner.querySelector('.suggestions-list');

        if (!data.suggestions || data.suggestions.length === 0) {
            list.innerHTML = '<div class="no-suggestions">Aucun compte à recommander pour le moment.</div>';
        } else {
            // Afficher 3 suggestions max
            data.suggestions.slice(0, 10).forEach(user => {
            const card = document.createElement('div');
            card.className = 'suggestion-card';
            card.innerHTML = `
        <div class="suggestion-avatar">${user.avatar || '👤'}</div>
        <div class="suggestion-info">
          <strong class="suggestion-name">${escHtml(user.displayName)}</strong>
          <small class="suggestion-stats">${user.followersCount || 0} followers • ${user.postsCount || 0} posts</small>
          ${user.bio ? `<p class="suggestion-bio">${escHtml(user.bio.substring(0, 50))}...</p>` : ''}
        </div>
        <button class="btn-follow-suggestion" data-user-id="${user._id}">+ Suivre</button>
      `;

            // Click sur la carte → profil
            card.addEventListener('click', (e) => {
                if (!e.target.classList.contains('btn-follow-suggestion')) {
                    import('./profile.js').then(m => m.viewProfile(user._id));
                }
            });

            // Bouton follow
            const followBtn = card.querySelector('.btn-follow-suggestion');
            followBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await handleQuickFollow(user._id, followBtn, card);
            });

            list.appendChild(card);
        });
        }

        // Refresh button
        banner.querySelector('.banner-refresh').addEventListener('click', injectSuggestionsBanner);

    } catch (err) {
        console.error('❌ Erreur suggestions:', err);
    }
}

async function handleQuickFollow(userId, btn, card) {
    try {
        const res = await fetch(`${API}/social/follow/${userId}`, {
            method: 'POST',
            credentials: 'include'
        });

        if (res.ok) {
            btn.textContent = '✓ Suivi';
            btn.classList.add('followed');
            btn.disabled = true;

            // Fadeout après 1s
            setTimeout(() => {
                card.style.transition = 'opacity 0.3s, transform 0.3s';
                card.style.opacity = '0';
                card.style.transform = 'translateX(-20px)';
                setTimeout(() => card.remove(), 300);
            }, 1000);
        }
    } catch (err) {
        console.error('❌ Erreur follow:', err);
    }
}

// ============================================================
// ACTIONS SUR POSTS (share + favorite)
// ============================================================

// ============================================================
// UTILS
// ============================================================

function escHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Auto-init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSocial);
} else {
    setTimeout(initSocial, 1000);
}