window.openPermalinkModal = openPostModal;

const API_BASE = "https://moodshare-7dd7.onrender.com";
const API = API_BASE + '/api/';



// ============================================================
// PRÉFÉRENCE D'AFFICHAGE DES POSTS IA — allow | avoid | block
// ============================================================
let _aiPostsPreference = localStorage.getItem('aiPostsPreference') || 'allow';

async function loadAiPostsPreference() {
    try {
        const token = localStorage.getItem('oifeel_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${API}users/me`, { credentials: 'include', headers });
        if (!res.ok) return; // invité non connecté: on garde la préférence locale
        const data = await res.json();
        if (data.aiPostsPreference) {
            _aiPostsPreference = data.aiPostsPreference;
            localStorage.setItem('aiPostsPreference', _aiPostsPreference);
        }
    } catch (e) {
        // silencieux: la préférence en cache locale reste valable
    }
}

// Exposé pour que account.js applique le changement sans recharger la page
window.setAiPostsPreference = function (pref) {
    if (!['allow', 'avoid', 'block'].includes(pref)) return;
    _aiPostsPreference = pref;
    localStorage.setItem('aiPostsPreference', pref);
    document.querySelectorAll('.post.ai-generated').forEach(applyAiVisibility);
};

function applyAiVisibility(moodcard) {
    if (!moodcard.classList.contains('ai-generated')) return;
    moodcard.classList.remove('ai-avoid');
    moodcard.style.display = '';
    if (_aiPostsPreference === 'block') {
        moodcard.style.display = 'none';
    } else if (_aiPostsPreference === 'avoid') {
        moodcard.classList.add('ai-avoid');
    }
}

async function checkMaintenanceMode() {
    try {
        const res = await fetch(`${API}maintenance`, { cache: 'no-store' });
        if (!res.ok) return false;
        const data = await res.json();
        if (data?.maintenance) {
            showMaintenanceOverlay();
            return true;
        }
    } catch (err) {
        console.warn('Impossible de vérifier le mode maintenance', err);
    }
    return false;
}

function showMaintenanceOverlay() {
    const overlay = document.getElementById('maintenance-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
}

// ============================================================
// SSE — Live updates (posts, stories) + Notifications
// ============================================================

// ── 1. SSE principal pour le feed (posts + stories) ──────────
// Ce flux existe déjà côté serveur (/api/stream)
try {
    const feedSSE = new EventSource(`${API}stream`, { withCredentials: true });

    feedSSE.addEventListener('new_post', (e) => {
        try {
            const post = JSON.parse(e.data);
            if (!document.querySelector(`.post[data-id="${post.id}"]`)) displayMood(post);
        } catch (err) { console.warn('Invalid new_post event', err); }
    });

    feedSSE.addEventListener('new_story', (e) => {
        try { addStoryToList(JSON.parse(e.data)); } catch (err) { console.warn('Invalid new_story event', err); }
    });

    feedSSE.addEventListener('stories_update', (e) => {
        try { JSON.parse(e.data).forEach(s => addStoryToList(s)); } catch (err) { console.warn('Invalid stories_update event', err); }
    });



    feedSSE.addEventListener('connected', () => { /* ok */ });
    feedSSE.onerror = () => { /* reconnexion automatique gérée par le navigateur */ };
} catch (err) {
    console.warn('Feed SSE not supported:', err);
}

// ── 2. SSE dédié aux notifications (/api/notifications/stream) ─
// Détecte si l'endpoint existe avant de s'y connecter,
// bascule sur polling si absent — sans jamais spammer la console.

let _notifSSEActive = false;
let _notifPollTimer = null;
let _notifReconnectTimer = null;
let _notifSSE = null;

function _startNotifStream() {
    if (_notifSSEActive || _notifSSE) return;

    const token = localStorage.getItem('oifeel_token');
    if (!token) return;

    _notifSSE = new EventSource(`${API}notifications/stream?token=${encodeURIComponent(token)}`);

    _notifSSE.onopen = () => {
        _notifSSEActive = true;
        if (_notifPollTimer) {
            clearInterval(_notifPollTimer);
            _notifPollTimer = null;
        }
    };

    _notifSSE.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.type === 'ping' || data.type === 'connected') return;
            _receiveNotif(data);
        } catch (_) { }
    };

    _notifSSE.onerror = () => {
        if (_notifSSE) _notifSSE.close();
        _notifSSE = null;
        _notifSSEActive = false;

        if (!_notifPollTimer) {
            _notifPollTimer = setInterval(_pollNotifications, 30000);
            _pollNotifications();
        }

        clearTimeout(_notifReconnectTimer);
        _notifReconnectTimer = setTimeout(_startNotifStream, 45000);
    };
}

async function _pollNotifications() {
    const token = localStorage.getItem('oifeel_token');
    if (!token) return;

    try {
        const res = await fetch(`${API}notifications?limit=150`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) return;

        const data = await res.json();
        const notifs = data.notifications || data || [];

        notifs.reverse().forEach(n => _receiveNotif(n, { silent: true }));
    } catch (_) { }
}
const _notifSeenIds = new Set();

// Démarrer le flux de notifs après connexion
document.addEventListener('userLoggedIn', () => {
    _startNotifStream();
});
// Et au chargement si déjà connecté
(function () {
    const token = localStorage.getItem('oifeel_token');
    if (token) setTimeout(_startNotifStream, 2000);
})();

// ── 3. Système de notifications (toasts + cloche + panneau) ───

const _notifItems = [];
let _notifUnread = 0;

function _normalizeNotifType(notif) {
    const raw = String(notif.type || notif.kind || notif.data?.type || '').toLowerCase();
    if (['like', 'reaction', 'comment', 'follow', 'mention', 'message', 'system'].includes(raw)) return raw;

    const text = `${notif.title || ''} ${notif.body || ''} ${notif.message || ''}`.toLowerCase();
    if (text.includes('aim�') || text.includes('aime') || text.includes('like')) return 'like';
    if (text.includes('comment')) return 'comment';
    if (text.includes('suit') || text.includes('follow')) return 'follow';
    if (text.includes('message') || text.includes('sticker') || text.includes('partag�')) return 'message';
    return 'system';
}

function _receiveNotif(notif, opts = {}) {
    const sid = notif._id || notif.id;
    if (sid && _notifSeenIds.has(sid)) return;
    if (sid) _notifSeenIds.add(sid);

    const type = _normalizeNotifType(notif);
    const data = notif.data || {};
    const n = {
        ...notif,
        ...data,
        type,
        actorName: notif.actorName || notif.title || data.actorName || 'Quelqu\'un',
        message: notif.message || notif.body || notif.text || data.message || '',
        postId: notif.postId || data.postId || null,
        conversationId: notif.conversationId || data.conversationId || null,
        _localId: sid || Date.now() + Math.random(),
        createdAt: notif.createdAt || new Date().toISOString(),
        read: !!notif.read
    };

    _notifItems.unshift(n);
    if (_notifItems.length > 300) _notifItems.length = 300;

    if (!n.read) _notifUnread++;

    _renderNotifBadge();
    if (!opts.silent) _showNotifToast(n);
    _refreshNotifPanel();
}
function _renderNotifBadge() {
    const badge = document.getElementById('_notif-badge');
    if (!badge) return;
    badge.textContent = _notifUnread > 99 ? '99+' : _notifUnread;
    badge.style.display = _notifUnread > 0 ? 'flex' : 'none';
}

// Toasts
const _toastQ = [];
let _toastBusy = false;

function _showNotifToast(notif) {
    _toastQ.push(notif);
    if (!_toastBusy) _nextToast();
}

function _nextToast() {
    if (!_toastQ.length) { _toastBusy = false; return; }
    _toastBusy = true;
    const n = _toastQ.shift();
    const icons = { like: '+', reaction: '*', comment: 'C', follow: 'F', mention: '@', message: 'M', system: 'i' };
    const msgs = {
        like: (n) => `${n.actorName || 'Quelqu\'un'} a aimé ton post`,
        reaction: (n) => `${n.actorName || 'Quelqu\'un'} a réagi à ton post ${n.emoji || ''}`,
        comment: (n) => `${n.actorName || 'Quelqu\'un'} a commenté ton post`,
        follow: (n) => `${n.actorName || 'Quelqu\'un'} te suit maintenant`,
        mention: (n) => `${n.actorName || 'Quelqu\'un'} t'a mentionné`,
        message: (n) => `${n.actorName || 'Quelqu\'un'} t'a envoy� un message`, system: (n) => n.message || n.text || 'Nouvelle notification'
    };
    const msg = (msgs[n.type] || msgs.system)(n);

    const el = document.createElement('div');
    el.className = `_notif-toast _notif-toast--${n.type || 'system'}`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `
        <span class="_nt-icon">${icons[n.type] || icons.system}</span>
        <div class="_nt-body">
            <p class="_nt-msg">${_escHtml(msg)}</p>
            ${n.postId ? `<span class="_nt-link">Voir le post →</span>` : ''}
        </div>
        <button class="_nt-close" aria-label="fermer">✕</button>`;

    if (n.postId) {
        el.querySelector('._nt-link')?.addEventListener('click', () => { openPostModal(n.postId); _dismissToast(el); });
    }
    el.querySelector('._nt-close').addEventListener('click', () => _dismissToast(el));

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('_notif-toast--in'));

    let tid = setTimeout(() => { _dismissToast(el); }, 4500);
    el.addEventListener('mouseenter', () => clearTimeout(tid));
    el.addEventListener('mouseleave', () => { tid = setTimeout(() => _dismissToast(el), 1500); });
}

function _dismissToast(el) {
    el.classList.remove('_notif-toast--in');
    el.classList.add('_notif-toast--out');
    setTimeout(() => { el.remove(); _toastBusy = false; _nextToast(); }, 320);
}


function _refreshNotifPanel() {
    const list = document.getElementById('_np-list');
    if (!list) return;
    if (!_notifItems.length) {
        list.innerHTML = `<div class="_np-empty"><div class="_np-empty-icon"></div><p>aucune notification pour le moment. </p><small>tout tes likes, commentaires et abonnements s'afficheront ici</small></div>`;
        return;
    }
    list.innerHTML = '';
    _notifItems.forEach(n => {
        const icons = { like: '+', reaction: '*', comment: 'C', follow: 'F', mention: '@', message: 'M', system: 'i' };
        const msgs = {
            like: (n) => `${n.actorName || 'quelqu\'un'} a aimé ton post`,
            reaction: (n) => `${n.actorName || 'quelqu\'un'} a réagi à ton post avec ${n.emoji || ''}`,
            comment: (n) => `${n.actorName || 'quelqu\'un'} a commenté ton post!`,
            follow: (n) => `${n.actorName || 'quelqu\'un'} à comencé à te suivre!`,
            mention: (n) => `${n.actorName || 'quelqu\'un'} t'a mentionné`,
            message: (n) => `${n.actorName || 'quelqu\'un'} t'a envoy� un message`, system: (n) => n.message || n.text || 'notification diverse'
        };
        const msg = (msgs[n.type] || msgs.system)(n);

        const ago = (() => {
            const d = Date.now() - new Date(n.createdAt);
            const s = Math.floor(d / 1000);
            if (s < 60) return "à l'instant";
            const m = Math.floor(s / 60);
            if (m < 60) return `il y a ${m}min`;
            const h = Math.floor(m / 60);
            if (h < 24) return `il y a ${h}h`;
            return `il y a ${Math.floor(h / 24)}j`;
        })();

        const item = document.createElement('div');
        item.className = `_np-item${n.read ? '' : ' unread'}`;
        if (n.postId) { item.style.cursor = 'pointer'; item.addEventListener('click', () => openPostModal(n.postId)); }
        item.innerHTML = `
            <div class="_np-icon ${n.type || ''}">${icons[n.type]}</div>
            <div class="_np-body"><p class="_np-msg">${_escHtml(msg)}</p><span class="_np-time">${ago}</span></div>
            ${!n.read ? '<div class="_np-dot"></div>' : ''}`;
        list.appendChild(item);
    });
}

function _escHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }


document.addEventListener('DOMContentLoaded', async () => {
    const isUnderMaintenance = await checkMaintenanceMode();
    if (isUnderMaintenance) return;

    // load recommended users on home
    // await loadRecommended();
    // try to restore session for UI (auth.js already handles initial state)
    const user = await getCurrentUser();
    if (user) {
        // set some UI state if needed
    }
    // 1️⃣ Charger la langue AVANT TOUTE CHOSE
    const lang = localStorage.getItem("lang") || "fr";
    await loadLanguage(lang);

    // 2️⃣ Maintenant le site peut utiliser t()=
    checkSiteVersion();

    // Sécurité anti-code dans le textarea
    const moodInput = document.getElementById("moodInput");

    // Regex détectant TOUT code suspect (script, tags, JS, HTML, onerror, onclick...)
    const forbiddenPattern = /(javascript:|onerror=|onclick=|onload=|<iframe|<img|<svg|document\.|window\.)/i;

    // Compteur de tentatives
    let securityStrike = parseInt(localStorage.getItem("xss_strikes") || "0");

    moodInput.addEventListener("input", () => {
        const text = moodInput.value;

        if (forbiddenPattern.test(text)) {

            // Efface automatiquement
            moodInput.value = "";

            // Ajoute un strike
            securityStrike++;
            localStorage.setItem("xss_strikes", securityStrike.toString());

            // Feedback
            showFeedback("warning", "fb_xss_detected");

            // (OPTIONNEL) → Au bout de 3 tentatives, on bloque temporairement :
            if (securityStrike >= 3) {
                showFeedback("error", "fb_xss_ban_warning");
                addInboxNotification("critical", null, "fb_xss_ban_warning");
                moodInput.disabled = true;
                const bandiv = document.getElementById("ban-overlay");
                bandiv.classList.remove("hidden");

                // Tu peux réactiver après 5 minutes :
                setTimeout(() => {
                    moodInput.disabled = false;
                    securityStrike = 0;
                    localStorage.setItem("xss_strikes", "0");
                    showFeedback("info", "fb_xss_unblocked");
                    bandiv.classList.add("hidden");
                }, 5 * 60 * 1000); // Ban de 5 minutes
            }
        }
    });

});

const nav = document.querySelector('nav');
const header = document.querySelector('header');
const profileheader = document.getElementById('accountheader');
const tabSections = document.querySelectorAll('section.tab');
const feedSelector = document.getElementById('feed-selector');

// Chaque section scrollable doit déclencher l'effet de scroll du header
if (tabSections.length) {

    tabSections.forEach(section => {
        section.addEventListener('scroll', () => {
            const currentScroll = section.scrollTop;
            if (currentScroll > 50) {
                header.classList.add('scrolled');
                profileheader.classList.add('scrolled');
                nav.classList.add('scrolled');
                feedSelector.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
                profileheader.classList.remove('scrolled');
                nav.classList.remove('scrolled');
                feedSelector.classList.remove('scrolled');
            }
        });
    });
}

document.querySelector('#accountheader').addEventListener("click", () => {
    document.getElementById("profilemenu").classList.toggle("show");
})

async function checkSiteVersion() {

    const siteVersion = document.getElementById("SiteVersion");
    const buildVersion = document.getElementById("buildVersion");

    try {
        const res = await fetch('../../version.json', {
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }

        const data = await res.json();
        const latest = data.version;
        const latestBuild = data.build;

        const current = localStorage.getItem('siteVersion');
        const currentBuild = localStorage.getItem('buildVersion');

        // Mise à jour de l'affichage
        if (siteVersion) siteVersion.innerText = `v${latest} | build ${latestBuild}`;


        // Vérification des mises à jour
        if (current && current !== latest || currentBuild && currentBuild !== latestBuild) {
            showFeedback("warning", "fb_version_not_up_to_date");
            addInboxNotification("warning", "fb_version_not_up_to_date", "fb_update_how_to");
            localStorage.clear();

            // Recharge après un petit délai
            setTimeout(() => {
                window.location.reload(true);
            }, 1500);
        }

        // Sauvegarde des nouvelles versions
        localStorage.setItem('siteVersion', latest);
        localStorage.setItem('buildVersion', latestBuild);

        console.log(`%c version du site: ${latest} (${latestBuild})`, "color: blue; font-size: 16px;");
    } catch (error) {
        console.error('erreur lors de la vérification de la version du site:', error);
        showFeedback("error", "fb_error_verify_version");
        addInboxNotification("critical", "erreur lors de la vérification de la version du site", "voir console.", "dangerous")            // Désactive le cache du navigateur et recharge la page proprement

    }
}

// scripts/app.js
const wall = document.getElementById("moodWall");
const modal = document.getElementById("postModal");
const submitBtn = document.getElementById("create-submit-btn");

// Ajouter après les autres constantes
const ephemeralToggle = document.getElementById('ephemeralToggle');
const durationPicker = document.getElementById('durationPicker');
const durationInputs = document.querySelectorAll('#durationPicker input[type="number"]');
const msgDeleteTime = document.getElementById('msgdeletetime');



// Mise à jour du texte de suppression en fonction des inputs
// Vérification et mise à jour du temps de suppression
function updateMsgDeleteTime() {


    const days = parseInt(document.getElementById('durationDays')?.value || 0);
    const hours = parseInt(document.getElementById('durationHours')?.value || 0);
    const minutes = parseInt(document.getElementById('durationMinutes')?.value || 0);

    // ✅ Vérification des valeurs invalides
    if (days >= 31) {
        showFeedback("error", "fb_error_day");
        document.getElementById('durationDays').value = 30;
    }
    if (hours >= 24) {
        showFeedback("error", "fb_error_hour");
        document.getElementById('durationHours').value = 23;
    }
    if (minutes >= 60) {
        showFeedback("error", "fb_error_minute");
        document.getElementById('durationMinutes').value = 59;
    }
    if (!ephemeralToggle.checked) {
        msgDeleteTime.textContent = '---';
        return;
    }
    // Recalcul après correction
    const totalMs =
        (((days * 24 + hours) * 60 + minutes) * 60 * 1000);

    if (totalMs <= 0) {
        msgDeleteTime.textContent = '';
        return;
    }

    const expirationDate = new Date(Date.now() + totalMs);
    const formatted = expirationDate.toLocaleString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    msgDeleteTime.textContent = formatted;
}

// ✅ Relier correctement la fonction à chaque champ
durationInputs.forEach(input => {
    input.addEventListener('input', updateMsgDeleteTime);
});

// ✅ Réinitialiser quand on (dé)coche
ephemeralToggle.addEventListener('change', updateMsgDeleteTime);

// Mettre à jour quand on modifie une durée
durationInputs.forEach(input => {
    input.addEventListener('input', updateMsgDeleteTime);
});

// Réinitialiser quand on (dé)coche la case
ephemeralToggle.addEventListener('change', updateMsgDeleteTime);

// Appel initial
updateMsgDeleteTime();

// Ajouter des écouteurs d'événements aux inputs de durée
durationInputs.forEach(input => {
    input.addEventListener('input', updateMsgDeleteTime);
});

// Gestion du toggle
ephemeralToggle.addEventListener('change', () => {
    durationInputs.forEach((input, index) => {
        input.style.opacity = ephemeralToggle.checked ? '1' : '0.5';
        input.style.transform = ephemeralToggle.checked ? 'translateY(0)' : 'translateY(15px)';
        input.style.transitionDelay = (index * 0.05) + 's';
        input.disabled = !ephemeralToggle.checked;
    });
    durationPicker.style.opacity = ephemeralToggle.checked ? '1' : '0.5';
});


function displayMood(mood) {
    const moodcard = document.createElement("div");
    moodcard.className = "post";
    moodcard.dataset.id = mood.id;
    wall.prepend(moodcard);
    if (mood.id == "1") {
        moodcard.classList.add('WelcomeMood');
    }

    // ---- POST CONTENT ----
    const content = document.createElement("div");
    content.className = "post-content";
    content.style.background = mood.color;

    // Wrapper pour centrer emoji + texte
    const innerWrap = document.createElement("div");
    innerWrap.className = "post-inner";

    const emojiSpan = document.createElement("span");
    emojiSpan.textContent = mood.emoji;
    emojiSpan.className = "post-emoji";

    const textSpan = document.createElement("span");
    textSpan.textContent = mood.text;
    textSpan.className = "post-text";

    // Appliquer couleur de texte si fournie, sinon choisir automatiquement
    const textColor = mood.textColor || (() => { return getBrightness(mood.color || "#ffffff") < 128 ? "#FFFFFF" : "#000000"; })();

    emojiSpan.style.color = textColor;
    textSpan.style.color = textColor;

    innerWrap.appendChild(emojiSpan);
    innerWrap.appendChild(textSpan);

    // Sticker GIF if present
    if (mood.stickerUrl) {
        const stickerImg = document.createElement("img");
        stickerImg.src = mood.stickerUrl;
        stickerImg.className = "post-sticker";
        stickerImg.alt = "sticker";
        innerWrap.appendChild(stickerImg);
    }

    content.appendChild(innerWrap);

    // Tag "généré par IA"
    if (mood.aiGenerated) {
        moodcard.classList.add('ai-generated');
        const aiTag = document.createElement('span');
        aiTag.className = 'ai-tag';
        aiTag.innerHTML = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5z"/></svg><span>généré par IA</span>`;
        content.appendChild(aiTag);

        // Overlay affiché en mode "éviter" : le post est flouté tant qu'il n'est pas révélé au clic
        const aiOverlay = document.createElement('div');
        aiOverlay.className = 'ai-avoid-overlay';
        aiOverlay.innerHTML = `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5z"/></svg><span>post généré par IA — cliquer pour afficher</span>`;
        aiOverlay.addEventListener('click', (e) => {
            e.stopPropagation();
            moodcard.classList.remove('ai-avoid');
        });
        content.appendChild(aiOverlay);

        applyAiVisibility(moodcard);
    }

    // Expiration
    if (mood.ephemeral && mood.expiresAt) {
        moodcard.classList.add('ephemeral');

        const icon = document.createElement("svg");
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert-icon lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;

        const expiration = document.createElement("p");
        expiration.className = "expiration-date";
        expiration.textContent = "message ephémère";


        const expirationDate = new Date(mood.expiresAt).toLocaleString("fr-FR", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });


        document.getElementById('msgdeletetime').textContent = "message ephémère";
        expiration.appendChild(icon);
        content.appendChild(expiration);
    }

    moodcard.appendChild(content);
    content.style.cursor = 'pointer';
    content.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input')) return;
        openPostModal(mood.id);
    });

    // ---- OPTIONS ----
    const options = document.createElement("div");
    options.id = "postoptions";
    moodcard.appendChild(options);

    const buttons = document.createElement("div");
    buttons.className = "buttons";
    options.appendChild(buttons);


    // Date
    const dateP = document.createElement("p");
    dateP.className = "postdate";

    const createdDate = new Date(mood.createdAt).toLocaleString("fr-FR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });


    // Like button
    const likeBtn = document.createElement("button");
    likeBtn.className = "likebtn";

    const likeIcon = document.createElement("span");
    likeIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-heart-icon lucide-heart"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>`;

    const likeCount = document.createElement("span");
    likeCount.className = "like-count";
    likeCount.textContent = mood.likes || 0;
    // Adapter la couleur du bouton like au fond du post
    const isDarkBg = getBrightness(mood.color || "#ffffff") < 128;
    likeBtn.classList.add(isDarkBg ? "likebtn-clair" : "likebtn-sombre");
    likeBtn.appendChild(likeIcon);
    likeBtn.appendChild(likeCount);

    buttons.appendChild(likeBtn);

    // ---- Restaurer les likes ----
    const likedPosts = JSON.parse(localStorage.getItem("likedPosts") || "[]");
    if (likedPosts.includes(String(mood.id))) {
        likeBtn.classList.add("liked");
    }

    // handle post like click
    let likePending = false;
    likeBtn.addEventListener('click', async () => {
        if (likePending) return;          // ignore si déjà en cours
        likePending = true;
        likeBtn.style.pointerEvents = 'none';

        const isLiked = likeBtn.classList.contains('liked');
        try {
            const endpoint = isLiked ? `${API}posts/${mood.id}/unlike` : `${API}posts/${mood.id}/like`;
            const token = localStorage.getItem('oifeel_token');
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const res = await fetch(endpoint, { method: 'POST', credentials: 'include', headers });
            if (res.ok) {
                const updated = await res.json();
                // Source de vérité = la réponse serveur (pas d'update local optimiste)
                mood.likes = updated.likes;
                likeCount.textContent = mood.likes;
                likeBtn.classList.toggle('liked');
                // persist locally
                let arr = JSON.parse(localStorage.getItem('likedPosts') || '[]');
                if (!isLiked) { arr.push(String(mood.id)); } else { arr = arr.filter(x => x !== String(mood.id)); }
                localStorage.setItem('likedPosts', JSON.stringify(arr));
            } else {
                showFeedback("warning", "not_logged_in");
            }
        } catch (e) { console.error(e); showFeedback("error", "network_error"); }
        finally {
            likePending = false;
            likeBtn.style.pointerEvents = '';
        }
    });

    // ---- ACTIONS:  share / report / repost ----
    const actionBar = document.createElement('div');
    actionBar.className = 'post-actions';

    const shareBtn = document.createElement('button');
    shareBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-link-icon lucide-link"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    shareBtn.title = 'Copier le lien du post';
    actionBar.appendChild(shareBtn);

    // const repostBtn = document.createElement('button');
    // repostBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-repeat2-icon lucide-repeat-2"><path d="m2 9 3-3 3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/></svg>';
    // repostBtn.title = 'Reposter';
    // repostBtn.disabled = true;  // Disable initially
    // actionBar.appendChild(repostBtn);

    // ---- Report button ----
    const reportBtn = document.createElement('button');
    reportBtn.className = 'reportbtn';
    reportBtn.title = 'Signaler ce post';
    reportBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';
    actionBar.appendChild(reportBtn);

    // const shareInMsg = document.createElement('button');
    // shareInMsg.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-share2-icon lucide-share-2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>';
    // shareInMsg.title = 'partager dans un message';
    // shareInMsg.addEventListener('click', async () => {
    //     const otherUserId = prompt('ID de l\'utilisateur :');
    //     if (otherUserId) {
    //         await window.sharePostInMessage(mood.id, otherUserId);
    //     }
    // });
    // actionBar.appendChild(shareInMsg);
    reportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openReportModal(mood.id);
    });
    dateP.textContent = "créé le " + createdDate;
    buttons.appendChild(dateP);
    buttons.appendChild(actionBar);

    if (mood.id == "404") {
        actionBar.style.display = "none";
        options.style.display = "none";
        moodcard.style.pointerEvents = "none";
        emojiSpan.style.fontSize = "65px";
        textSpan.style.fontSize = "40px";
    }

    shareBtn.addEventListener('click', () => {
        const url = `${location.origin}${location.pathname}#post-${mood.id}`;
        if (navigator.share) {
            navigator.share({ title: 'oifeel.', text: mood.text, url }).catch(() => { });
        } else {
            navigator.clipboard.writeText(url).then(() => showFeedback("success", "copied_link"));
        }
    });

    // repostBtn.addEventListener('click', async () => {
    //     try {
    //         const res = await fetchWithAuth(`/posts/${mood.id}/repost`, { method: 'POST' });
    //         if (res.status === 201) {
    //             const newp = await res.json();
    //             showFeedback("success", "reposted");
    //         } else {
    //             const errData = await res.json().catch(() => ({}));
    //             console.error('❌ Repost error:', res.status, errData);
    //             showFeedback("error", "repost_failed");
    //         }
    //     } catch (err) {
    //         console.error('❌ Repost fetch error:', err);
    //         showFeedback("error", "repost_failed");
    //     }
    // });
    attachV2ToPost(moodcard, mood.id);

}
window.displayMoodV2 = displayMood;

// ============================================================
// REPORT MODAL
// ============================================================
function openReportModal(postId) {
    const overlay = document.getElementById('reportModalOverlay');
    if (!overlay) return;

    // Reset form
    document.getElementById('reportCategory').value = '';
    document.getElementById('reportDetail').value = '';
    document.getElementById('reportCharCount').textContent = '0 / 500';
    document.getElementById('reportError').style.display = 'none';
    document.getElementById('reportSuccess').style.display = 'none';
    document.getElementById('reportSubmitBtn').disabled = false;
    document.getElementById('reportSubmitBtn').textContent = 'Envoyer le signalement';

    // Store post id on the form
    overlay.dataset.postId = postId;

    overlay.classList.remove('hidden');
    overlay.classList.add('visible');
    // Slight delay so animation fires
    requestAnimationFrame(() => overlay.querySelector('.report-modal-panel').classList.add('open'));
}

function closeReportModal() {
    const overlay = document.getElementById('reportModalOverlay');
    if (!overlay) return;
    overlay.querySelector('.report-modal-panel').classList.remove('open');
    setTimeout(() => {
        overlay.classList.remove('visible');
        overlay.classList.add('hidden');
    }, 280);
}

async function submitReport() {
    const overlay = document.getElementById('reportModalOverlay');
    const postId = overlay.dataset.postId;
    const category = document.getElementById('reportCategory').value;
    const detail = document.getElementById('reportDetail').value.trim();
    const errorEl = document.getElementById('reportError');
    const successEl = document.getElementById('reportSuccess');
    const submitBtn = document.getElementById('reportSubmitBtn');

    errorEl.style.display = 'none';

    if (!category) {
        errorEl.textContent = 'Veuillez choisir une catégorie.';
        errorEl.style.display = 'block';
        return;
    }
    if (!detail || detail.length < 5) {
        errorEl.textContent = 'Merci de décrire le problème (5 caractères minimum).';
        errorEl.style.display = 'block';
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Envoi…';

    const reason = `[${category}] ${detail}`;

    try {
        const res = await fetch(`${API}posts/${postId}/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });

        if (res.ok) {
            successEl.style.display = 'block';
            submitBtn.textContent = 'Signalement envoyé ✓';
            setTimeout(() => closeReportModal(), 1800);
        } else {
            const data = await res.json().catch(() => ({}));
            errorEl.textContent = data.error || 'Une erreur est survenue.';
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Envoyer le signalement';
        }
    } catch (err) {
        errorEl.textContent = 'Erreur réseau. Réessaie dans quelques secondes.';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Envoyer le signalement';
    }
}

// Expose to global scope for inline HTML handlers
window.closeReportModal = closeReportModal;
window.submitReport = submitReport;
(async () => {
    try {
        const user = await getCurrentUser();
        await loadAiPostsPreference();
        const res = await fetch(`${API}posts`);
        if (user) {
            const res = await fetch(`${API}users/${user.id}/posts`);
            const userPosts = await res.json();
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        let moods;
        try {
            moods = JSON.parse(text);
        } catch (jsonErr) {
            console.error('❌ Posts JSON corrompu:', jsonErr.message);
            return;
        }
        if (!Array.isArray(moods)) return;
        moods.reverse().forEach(displayMood);
        initV2();

        // 🔥 AJOUT : activer la navigation par permalien APRÈS le chargement des posts
        initPermalinks();

    } catch (err) {
        console.error('❌ Erreur chargement posts:', err);
    }
})();
const tabs = document.querySelectorAll("nav a");
const sections = document.querySelectorAll(".tab");

tabs.forEach(tab => {
    tab.addEventListener("click", (e) => {
        // Supprime la classe active de tous les boutons
        tabs.forEach(btn => btn.classList.remove("active"));
        // Ajoute la classe active au bouton cliqué
        tab.classList.add("active");

        // Récupère l'ID du bouton (ex: "homeTab", "postsTab", etc.)
        const tabId = tab.id;
        // Affiche la section correspondante
        sections.forEach(section => {
            if (section.id.startsWith(tabId)) {
                section.classList.add("active");
                section.classList.remove("hidden");
                location.hash = `${section.id}`; // Met à jour le hash pour le permalien
            } else {
                section.classList.remove("active");
                section.classList.add("hidden");
            }
        });
    });
});

// 🔥 Bouton Settings dans le profil → navigue vers settingsTab
const goToSettingsBtn = document.getElementById('goToSettingsBtn');
if (goToSettingsBtn) {
    goToSettingsBtn.addEventListener('click', () => {
        // Enlève active de tous les tabs nav
        tabs.forEach(btn => btn.classList.remove("active"));

        // Active le settingsTab dans nav (s'il existe)
        const settingsNavTab = document.querySelector('nav a#settingsTab');
        if (settingsNavTab) settingsNavTab.classList.add('active');

        // Affiche la section settingsTab
        sections.forEach(section => {
            if (section.id === 'settingsTab') {
                section.classList.add("active");
                section.classList.remove("hidden");
            } else {
                section.classList.remove("active");
                section.classList.add("hidden");
            }
        });
    });
};


// const previewMood = document.getElementById('previewMood');
// const previewEmoji = document.getElementById('previewEmoji');
// const previewText = document.getElementById('previewText');
const moodInput = document.getElementById('moodInput');
const moodColor = document.getElementById('moodColor');
const moodColorHex = document.getElementById('moodColorHex');
const moodEmoji = document.querySelector('.moodEmoji');

// Fonction de mise à jour de l'aperçu
const textColorInput = document.getElementById('textColor');
const textColorHex = document.getElementById('textColorHex');
let useManualTextColor = false;

// Fonction utilitaire pour formater le hex
function formatHex(hex) {
    return hex.replace('#', '').toUpperCase();
}

// Fonction utilitaire pour valider et formater l'hex
function cleanHex(hex) {
    return hex.replace(/[^0-9A-Fa-f]/g, '').substring(0, 6);
}

// Synchronisation textColor <-> textColorHex
textColorInput.addEventListener('input', () => {
    textColorHex.value = formatHex(textColorInput.value);
    useManualTextColor = true;
    // ;
});

textColorHex.addEventListener('input', (e) => {
    let hex = cleanHex(e.target.value);
    if (hex.length === 6) {
        textColorInput.value = '#' + hex;
        useManualTextColor = true;
        // ;
    }
});

// Initialiser les valeurs hex au démarrage
textColorHex.value = formatHex(textColorInput.value);

// ============================================
// MODAL COULEURS/GRADIENTS
// ============================================

function getAllGradients() {
    return {
        default: ["#39e8ff", "#436fb6"],
        aurora: ["#00D4FF", "#5B0FBE"],
        venom: ["#B5E853", "#0A1200"],
        Inferno: ["#FF6B35", "#1A0508"],
        twilight: ["#FF9A8B", "#1E1040"],
        sangrie: ["#C0392B", "#080205"],
        ocean: ["#2193b0", "#6dd5ed"],
        sunset: ["#ee9ca7", "#ffdde1"],
        forest: ["#5A3F37", "#2C7744"],
        candy: ["#D3959B", "#BFE6BA"],
        sky: ["#2980B9", "#6DD5FA"],
        summer: ["#FAD0C4", "#FFD1FF"],
        winter: ["#E0EAFc", "#CFDEF3"],
        spring: ["#FBC2EB", "#A6C1EE"],
        autumn: ["#D1913C", "#FFD194"]
    };
}

const colorPickerModal = document.getElementById('colorPickerModal');
const colorPickerTrigger = document.getElementById('colorPickerTrigger');
const closeColorPicker = document.getElementById('closeColorPicker');
const colorPickerTabs = document.querySelectorAll('.color-picker-tab');
const colorPickerTabContents = document.querySelectorAll('.color-picker-tab-content');
const gradientButtonsModal = document.querySelectorAll('.gradient-btn-modal');
const customColorInput = document.getElementById('moodColor');
const customColorPreview = document.getElementById('customColorPreview');
const moodColorHexModal = document.getElementById('moodColorHexModal');
const colorPreviewBox = document.getElementById('colorPreviewBox');

// Ouvrir le modal au clic
colorPickerTrigger.addEventListener('click', () => {
    colorPickerModal.classList.remove('hidden');
    // Initialiser les valeurs du modal
    moodColorHexModal.value = moodColorHex.value;
});

// Fermer le modal
closeColorPicker.addEventListener('click', () => {
    colorPickerModal.classList.add('hidden');
});

// Fermer au clic sur l'overlay
colorPickerModal.addEventListener('click', (e) => {
    if (e.target === colorPickerModal) {
        colorPickerModal.classList.add('hidden');
    }
});

// Gestion des tabs
colorPickerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        // Retirer la classe active de tous les tabs
        colorPickerTabs.forEach(t => t.classList.remove('active'));
        colorPickerTabContents.forEach(content => content.classList.remove('active'));

        // Ajouter la classe active au tab cliqué
        tab.classList.add('active');
        document.getElementById(tabName + '-tab').classList.add('active');
    });
});

// Initialiser les boutons de gradients du modal
gradientButtonsModal.forEach(btn => {
    const gradientName = btn.dataset.gradient;
    const colors = getAllGradients()[gradientName];
    if (colors) {
        btn.style.background = `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;

        btn.addEventListener('click', () => {
            // Retirer la classe active
            gradientButtonsModal.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Appliquer le gradient
            const gradientValue = `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
            window._v2SelectedGradient = gradientValue;
            // previewMood.style.background = gradientValue;
            colorPreviewBox.style.background = gradientValue;

            // Fermer le modal
            colorPickerModal.classList.add('hidden');

            ;
        });
    }
});

// Couleur personnalisée
customColorInput.addEventListener('input', () => {
    window._v2SelectedGradient = null;
    gradientButtonsModal.forEach(b => b.classList.remove('active'));

    const hexValue = formatHex(customColorInput.value);
    moodColorHexModal.value = hexValue;
    moodColorHex.value = hexValue;
    customColorPreview.style.backgroundColor = customColorInput.value;
    colorPreviewBox.style.background = customColorInput.value;

    ;
});

moodColorHexModal.addEventListener('input', (e) => {
    window._v2SelectedGradient = null;
    gradientButtonsModal.forEach(b => b.classList.remove('active'));

    let hex = cleanHex(e.target.value);
    if (hex.length === 6) {
        customColorInput.value = '#' + hex;
        moodColorHex.value = hex;
        customColorPreview.style.backgroundColor = '#' + hex;
        colorPreviewBox.style.background = '#' + hex;
        ;
    }
});

// function  {
//     const bgColor = window._v2SelectedGradient || customColorInput.value;
//     previewMood.style.background = bgColor;
//     previewEmoji.textContent = moodEmoji.value;
//     previewText.textContent = moodInput.value;

//     if (useManualTextColor) {
//         const color = textColorInput.value;
//         previewText.style.color = color;
//         previewEmoji.style.color = color;
//     } else {
//         // Si c'est un gradient, utiliser une couleur claire par défaut
//         if (window._v2SelectedGradient) {
//             previewText.style.color = "#FFFFFF";
//             previewEmoji.style.color = "#FFFFFF";
//         } else {
//             const brightness = getBrightness(bgColor);
//             const autoColor = brightness < 128 ? "#FFFFFF" : "#000000";
//             previewText.style.color = autoColor;
//             previewEmoji.style.color = autoColor;
//         }
//     }
// }


// Fonction utilitaire pour calculer la luminosité perçue
function getBrightness(hexColor) {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
}



// Initialiser les valeurs au démarrage
moodColorHex.value = formatHex(customColorInput.value);


function showFeedback(type, messageKey, vars = {}) {
    const translated = t(messageKey, vars) || messageKey;

    const feedback = document.createElement("div");
    feedback.className = `upload-feedback feedback-${type}`;

    const icons = {
        success: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"36\" height=\"36\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.25\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"lucide lucide-circle-check-icon lucide-circle-check\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m9 12 2 2 4-4\"/></svg>",
        error: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"36\" height=\"36\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.25\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"lucide lucide-circle-x-icon lucide-circle-x\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m15 9-6 6\"/><path d=\"m9 9 6 6\"/></svg>",
        warning: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"36\" height=\"36\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.25\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"lucide lucide-triangle-alert-icon lucide-triangle-alert\"><path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"/><path d=\"M12 9v4\"/><path d=\"M12 17h.01\"/></svg>   ",
        info: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"36\" height=\"36\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.25\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"lucide lucide-circle-alert-icon lucide-circle-alert\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\"/><line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\"/></svg>",
        remark: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"36\" height=\"36\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.25\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"lucide lucide-message-circle-warning-icon lucide-message-circle-warning\"><path d=\"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719\"/><path d=\"M12 8v4\"/><path d=\"M12 16h.01\"/></svg>",
        welcome: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"36\" height=\"36\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.25\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"lucide lucide-party-popper-icon lucide-party-popper\"><path d=\"M5.8 11.3 2 22l10.7-3.79\"/><path d=\"M4 3h.01\"/><path d=\"M22 8h.01\"/><path d=\"M15 2h.01\"/><path d=\"M22 20h.01\"/><path d=\"m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10\"/><path d=\"m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17\"/><path d=\"m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7\"/><path d=\"M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1..93-2..83-4..75, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5\""
    };

    // ---- Icône ----
    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    icon.innerHTML = icons[type];

    // ---- Texte ----
    const p = document.createElement("p");
    p.textContent = translated;

    // ---- Ajout DOM ----
    feedback.appendChild(icon);
    feedback.appendChild(p);

    document.body.appendChild(feedback);

    const duration = 7500;
    feedback.style.animation = `slideInOut ${duration / 1000}s ease forwards`;

    setTimeout(() => feedback.remove(), duration);
}

document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        if (navigator.onLine) {
            showFeedback("success", "connecté à internet, récupération des données auprès du serveur...");
        } else {

            const offlineMood = {
                "text": "tu n'es pas connecté(e) à internet \n vérifie tes paramètres internet et réessaye!",
                "color": "#eb0000",
                "date": "01/01/2026",
                "emoji": "📵",
                "ephemeral": false,
                "expiresAt": null,
                "id": 404
            }
            displayMood(offlineMood)
            showFeedback("error", "tu n'es pas connecté/e à internet. vérifie ta connexion puis réessaye");

        }
    }, 4500);
});

/**
 * Ajoute une notification dans la boîte de réception (Inbox)
 * @param {string} type - Le type de notification (info, success, warning, error, critical)
 * @param {string} title - Le titre de la notification
 * @param {string} message - Le message à afficher (HTML autorisé)
 * @param {string} [icon] - Icône Material Symbols facultative
 * @param {string} [actionLabel] - Texte du bouton d'action (facultatif)
 * @param {function} [actionFn] - Fonction à exécuter au clic sur le bouton
 */



// ============================================================
// BOUTON "pLUS OPTIONS" — Afficher/masquer les options avancées
// ============================================================
const advancedOptions = document.getElementById('advancedOptions');

if (advancedOptions) {
    moreOptionsBtn.addEventListener('click', () => {
        const isHidden = advancedOptions.hasAttribute('hidden');
        if (isHidden) {
            // Afficher les options avancées et le flou

            advancedOptions.removeAttribute('hidden');
            moreOptionsBtn.classList.add('active');
            moreOptionsBtn.innerHTML = "<svg width = '20' height = '20' fill = 'none' stroke = 'currentColor' stroke-width='2' viewBox = '0 0 24 24' > <line x1='4' x2='20' y1='6' y2='6' /> <line x1='4' x2='20'  y1='12' y2='12' /> <line x1='4' x2='20' y1='18' y2='18' /><circle cx='14' cy='6' r='2' fill='currentColor' /> <circle cx='10'  cy='12' r='2' fill='currentColor' /><circle cx='16' cy='18' r='2' fill='currentColor'/></svg ><span data-i18n='create_more_options'>fermer</span>";

        } else {
            moreOptionsBtn.innerHTML = "<svg width = '20' height = '20' fill = 'none' stroke = 'currentColor' stroke-width='2' viewBox = '0 0 24 24' > <line x1='4' x2='20' y1='6' y2='6' /> <line x1='4' x2='20'  y1='12' y2='12' /> <line x1='4' x2='20' y1='18' y2='18' /><circle cx='14' cy='6' r='2' fill='currentColor' /> <circle cx='10'  cy='12' r='2' fill='currentColor' /><circle cx='16' cy='18' r='2' fill='currentColor'/></svg ><span data-i18n='create_more_options'>options avancées</span>";
            closeAdvancedOptions();
        }
    });
}

function closeAdvancedOptions() {
    if (advancedOptions && moreOptionsBtn) {
        advancedOptions.setAttribute('hidden', '');
        moreOptionsBtn.classList.remove('active');
    }
}

// ============================================================
// DURATION PICKER — Afficher/masquer au toggle ephemeralToggle
// ============================================================
const _ephemeralToggle = document.getElementById('ephemeralToggle');
const _durationPicker = document.getElementById('durationPicker');
const optionnalsettings = document.querySelector('#advancedOptions #container');

if (_ephemeralToggle && _durationPicker) {
    _durationPicker.style.opacity = '0';
    _durationPicker.style.position = 'absolute';
    _ephemeralToggle.addEventListener('change', () => {
        if (_ephemeralToggle.checked) {
            _durationPicker.style.opacity = '1';
            _durationPicker.style.position = 'default';
        } else {
            _durationPicker.style.opacity = '0';
            _durationPicker.style.position = 'absolute';
        }
    });
}

const addStoryBtn = document.getElementById('addStoryBtn');
const storyModeToggle = document.getElementById('storyModeToggle');

if (addStoryBtn) {
    addStoryBtn.addEventListener('click', () => {
        // Active automatiquement le mode "story"
        const createTabBtn = document.querySelector('#create');
        createTabBtn?.click();
        if (storyModeToggle) storyModeToggle.checked = true;
    });
}

// ============================================================
// GÉNÉRATION DE POST AVEC IA (Groq) — limité à 3 fois / semaine / IP
// ============================================================
const aiGenerateBtn = document.getElementById('ai-generate');
let _lastAiGeneratedText = null; // sert à taguer le post si le texte n'a pas été modifié après génération

function formatRetryDate(isoString) {
    try {
        const d = new Date(isoString);
        return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '';
    }
}

// Affiche le quota restant au survol/titre du bouton, sans consommer de requête
async function refreshAiQuota() {
    if (!aiGenerateBtn) return;
    try {
        const res = await fetch(`${API}ai/usage`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.remaining <= 0 && data.retryAt) {
            aiGenerateBtn.title = `limite atteinte, réessaie après le ${formatRetryDate(data.retryAt)}`;
        } else {
            aiGenerateBtn.title = `${data.remaining}/${data.limit} générations IA restantes cette semaine`;
        }
    } catch (e) {
        // silencieux: l'absence de quota affiché n'est pas bloquant
    }
}
refreshAiQuota();

if (aiGenerateBtn) {
    aiGenerateBtn.addEventListener('click', async () => {
        const moodInputEl = document.getElementById('moodInput');
        if (!moodInputEl) return;

        const hint = moodInputEl.value.trim();

        aiGenerateBtn.disabled = true;
        aiGenerateBtn.classList.add('generating');
        const originalLabel = aiGenerateBtn.querySelector('span')?.textContent;
        const labelEl = aiGenerateBtn.querySelector('span');
        if (labelEl) labelEl.textContent = 'génération...';

        try {
            const res = await fetch(`${API}ai/generate-post`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hint })
            });

            const data = await res.json();

            if (res.status === 429) {
                showFeedback('error', data.error || 'limite de générations IA atteinte pour cette semaine');
                return;
            }

            if (!res.ok) {
                showFeedback('error', data.error || "erreur lors de la génération IA");
                return;
            }

            moodInputEl.value = data.text;
            _lastAiGeneratedText = data.text;
            moodInputEl.dispatchEvent(new Event('input'));
            showFeedback('success', `texte généré ! (${data.remaining}/3 générations restantes cette semaine)`);
        } catch (error) {
            console.error('Erreur génération IA:', error);
            showFeedback('error', "impossible de contacter le générateur IA");
        } finally {
            aiGenerateBtn.disabled = false;
            aiGenerateBtn.classList.remove('generating');
            if (labelEl && originalLabel) labelEl.textContent = originalLabel;
            refreshAiQuota();
        }
    });
}

// Lors de la création d’un post
// Remplace le code du submitBtn par celui-ci dans app.js

if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
        try {
            const text = document.getElementById("moodInput").value.trim();
            const color = document.getElementById("moodColor").value;
            const emoji = document.querySelector(".moodEmoji").value || _selectedEmoji;
            const isStory = storyModeToggle?.checked;

            if (!text) {
                showFeedback("error", "écris quelque chose!", "fb_write_something");
                return;
            }

            submitBtn.classList.add('submitting');
            submitBtn.disabled = true;

            // ✅ Cas STORY - on crée UNIQUEMENT une story
            if (isStory) {
                const storyData = {
                    text,
                    color,
                    textColor: document.getElementById('textColor')?.value || null,
                    emoji,
                    stickerUrl: _selectedStickerUrl || null,
                    createdAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                };

                const resStory = await fetch(`${API}stories`, {
                    method: "POST",
                    headers: { "content-Type": "application/json" },
                    body: JSON.stringify(storyData)
                });

                if (!resStory.ok) throw new Error(`HTTP ${resStory.status}`);

                const savedStory = await resStory.json();
                addStoryToList(savedStory);
                showFeedback("success", "story publiée!", "fb_story_posted");
            }
            // ✅ Cas POST classique - on crée UNIQUEMENT un post
            else {
                // Calcul de l'expiration si ephemeral
                let expiresAt = null;
                if (ephemeralToggle.checked) {
                    const days = parseInt(document.getElementById('durationDays')?.value || 0);
                    const hours = parseInt(document.getElementById('durationHours')?.value || 0);
                    const minutes = parseInt(document.getElementById('durationMinutes')?.value || 0);

                    const totalMs = (((days * 24 + hours) * 60 + minutes) * 60 * 1000);

                    if (totalMs > 0) {
                        expiresAt = new Date(Date.now() + totalMs).toISOString();
                    }
                }

                const newMood = {
                    text,
                    color: window._v2SelectedGradient || color,
                    textColor: document.getElementById('textColor')?.value || null,
                    emoji,
                    stickerUrl: _selectedStickerUrl || null,
                    ephemeral: ephemeralToggle.checked,
                    expiresAt,
                    aiGenerated: _lastAiGeneratedText !== null && text === _lastAiGeneratedText.trim()
                };
                window._v2SelectedGradient = null;
                document.querySelectorAll('.swatch').forEach(s => s.classList.remove('swatch--active'));

                const response = await fetch(`${API}posts`, {
                    method: "POST",
                    headers: { "content-Type": "application/json" },
                    body: JSON.stringify(newMood)
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const savedMood = await response.json();
                showFeedback("success", "fb_post_shared"); // au lieu d'un texte brut
            }

            document.getElementById("moodInput").value = "";
            document.querySelector(".moodEmoji").value = "";
            _selectedEmoji = '👋';
            _selectedStickerUrl = null;
            _lastAiGeneratedText = null;
            ephemeralToggle.checked = false;
            if (storyModeToggle) storyModeToggle.checked = false;
            updateMsgDeleteTime();

        } catch (error) {
            console.error('Erreur envoi post:', error);
            showFeedback("error", "fb_error_post");
        } finally {
            submitBtn.classList.remove('submitting');
            submitBtn.disabled = false;
        }
    });
}

// ============================================================
// LOADER
// ============================================================
const loader = document.getElementById('loader');
if (loader) {
    // Ajouter classe body.loading
    document.body.classList.add('loading');

    // Fade out après 2s
    setTimeout(() => {
        loader.classList.add('loader-hidden');
        document.body.classList.remove('loading');

        // Retirer du DOM après transition
        setTimeout(() => {
            loader.remove();
        }, 7000);
    }, 3600);
}

async function loadLanguages() {
    const manifest = await fetch("/app/lang/manifest.json").then(r => r.json());

    const languages = [];

    for (const entry of manifest.languages) {
        const fileName = entry.file;   // ex: "fr.json"
        const code = entry.code;       // ex: "fr"

        // sécurité : s'assurer que c’est bien une string
        if (typeof fileName !== "string") {
            console.error("❌ Mauvais format file:", fileName);
            continue;
        }

        const data = await fetch(`/app/lang/${fileName}`).then(r => r.json());

        languages.push({
            code,
            name: entry.name || data.__name__ || code,
            flag: entry.flag || data.__flag__ || "🌐"
        });
    }

    return languages;
}


const grid = document.getElementById("langGrid");
const popup = document.getElementById("langPopup");
const openBtn = document.getElementById("currentLangLabel");

const langPopup = document.getElementById("langPopup");
const langGrid = document.getElementById("langGrid");

async function initLanguageSelector() {
    const langs = await loadLanguages();

    function render(filtered) {
        langGrid.textContent = "";

        filtered.forEach(lang => {
            const item = document.createElement("div");
            item.className = "lp-item";
            item.dataset.lang = lang.code;
            item.textContent = `
                <div class="lp-flag">${lang.flag}</div>
                <div>${lang.name}</div>
            `;

            item.addEventListener("click", () => {
                localStorage.setItem("lang", lang.code);
                location.reload();
            });

            langGrid.appendChild(item);
        });
    }

}

initLanguageSelector();
if (openBtn) {
    openBtn.addEventListener("click", () => {
        popup.style.display = popup.style.display === "block" ? "none" : "block";
    });
}


console.log(`%c⚠ fais gaffe: ne rentre jamais de commande ici sans connaître son but! toute tentative d'injection de commande entraînera le bannissement immédiat de ton compte.`, "color: orange; font-size: 25px; font-family: DM Sans");

function detectLowEnd() {
    const mem = navigator.deviceMemory || 1; // GB
    const cores = navigator.hardwareConcurrency || 1;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // court test FPS
    return new Promise(resolve => {
        let frames = 0, start = performance.now();
        function f() {
            frames++; if (performance.now() - start < 200) { requestAnimationFrame(f); } else {
                const fps = frames / ((performance.now() - start) / 1000);
                const score = (mem * 2 + cores + (reduceMotion ? 2 : 0) + (fps > 45 ? 2 : fps > 25 ? 1 : 0));
                resolve(score < 5); // true = low-end
            }
        }; requestAnimationFrame(f);
    });
}

async function applyLowEndMode() {
    const pref = localStorage.getItem('lowEndMode') || 'auto';
    let isLow = false;
    if (pref === 'on') isLow = true;
    else if (pref === 'off') isLow = false;
    else isLow = await detectLowEnd();
    document.documentElement.classList.toggle('low-end', isLow);
}
applyLowEndMode();


// gestion propre du contrôle radio "low-end"
(async function initLowEndUI() {
    // récupération des radios
    const radios = document.querySelectorAll('input[name="lowEndMode"]');
    if (!radios || radios.length === 0) return; // rien à faire si le HTML n'est pas présent

    // lecture de la préférence et mise à jour de l'UI
    const pref = localStorage.getItem('lowEndMode') || 'auto';
    const match = Array.from(radios).find(r => r.value === pref);
    if (match) match.checked = true;

    // quand l'utilisateur change la sélection
    radios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (!e.target.checked) return;
            localStorage.setItem('lowEndMode', e.target.value);
            // réapplique immédiatement le mode low-end
            applyLowEndMode();
        });
    });

    // applique l'état au chargement (applyLowEndMode est async)
    await applyLowEndMode();

    // charger conditionnellement le picker emoji si pas en low-end
    if (!document.documentElement.classList.contains('low-end')) {
        import('https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js').catch(() => {/* ignore load errors */ });
    }
})();

// ============================================================
// STORIES — tableau global + chargement initial
// ============================================================
let _allStories = [];
let _storyViewerActive = false;
let _storyIndex = 0;
let _storyTimer = null;

// Chargement initial depuis l'API
(async function _loadStories() {
    try {
        const res = await fetch(`${API}stories`);
        if (!res.ok) return;
        const stories = await res.json();
        // Supprimer le skeleton si présent
        document.querySelectorAll('.story.skeleton').forEach(el => el.remove());
        stories.forEach(s => {
            if (!_allStories.find(x => x.id === s.id)) {
                _allStories.push(s);
                _renderStoryBubble(s, false);
            }
        });
    } catch (e) { console.warn('Stories load error:', e); }
})();

function addStoryToList(story) {
    // Déduplique les events SSE
    if (_allStories.find(s => s.id === story.id)) return;
    _allStories.unshift(story);
    _renderStoryBubble(story, true);
}

function _renderStoryBubble(story, prepend) {
    const list = document.querySelector('.stories-list');
    if (!list) return;

    const wrap = document.createElement('button');
    wrap.className = 'sv-bubble';
    wrap.type = 'button';
    wrap.dataset.sid = story.id;

    const c = story.color || '#00cfeb';

    wrap.innerHTML = `
      <span class="sv-bubble__ring" style="--sc:${c};">
        <span class="sv-bubble__face" style="background:${c};">
          <span class="sv-bubble__emoji">${story.emoji || '📸'}</span>
        </span>
      </span>
      <span class="sv-bubble__label">${(story.text || 'Story').split(' ').slice(0, 2).join(' ')}</span>
    `;

    wrap.addEventListener('click', () => {
        const idx = _allStories.findIndex(s => s.id === story.id);
        _openViewer(idx >= 0 ? idx : 0);
    });

    // Insérer juste après le bouton "+"
    const addBtn = list.querySelector('#addStoryBtn');
    if (prepend && addBtn) {
        addBtn.insertAdjacentElement('afterend', wrap);
    } else {
        list.appendChild(wrap);
    }
}

// ============================================================
// STORY VIEWER — visionneuse fullscreen avec nav + progress
// ============================================================
function _openViewer(startIdx) {
    if (_storyViewerActive || !_allStories.length) return;
    _storyViewerActive = true;
    _storyIndex = Math.max(0, Math.min(startIdx, _allStories.length - 1));
    _buildViewer();
}

function _buildViewer() {
    document.getElementById('_svOverlay')?.remove();
    clearTimeout(_storyTimer);

    const story = _allStories[_storyIndex];
    if (!story) { _closeViewer(); return; }

    const tc = story.textColor ||
        ((story.color && getBrightness(story.color) < 128) ? '#fff' : '#1a1a1a');
    const c = story.color || '#00cfeb';

    const ago = _timeAgo(story.createdAt);

    const ov = document.createElement('div');
    ov.id = '_svOverlay';
    ov.className = 'sv-overlay';

    // Barres de progression
    const barsHtml = _allStories.map((_, i) => `
      <div class="sv-bar-track">
        <div class="sv-bar-fill ${i < _storyIndex ? 'sv-bar--done' : i === _storyIndex ? 'sv-bar--active' : ''}"></div>
      </div>`).join('');

    ov.innerHTML = `
      <div class="sv-backdrop"></div>
      <div class="sv-card" style="background:${c};">
        <div class="sv-bars">${barsHtml}</div>
        <div class="sv-header">
          <div class="sv-avatar" style="background:${c}; border-color:${tc}30;">
            <span>${story.emoji || '📸'}</span>
          </div>
          <div class="sv-meta">
            <span class="sv-meta-time" style="color:${tc}99;">${ago}</span>
          </div>
          <button class="sv-close-btn" aria-label="fermer" style="color:${tc};">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="sv-body">
          <div class="sv-big-emoji" style="color:${tc};">${story.emoji || ''}</div>
          <p class="sv-text" style="color:${tc};">${story.text || ''}</p>
        </div>
        <button class="sv-nav sv-nav--prev" aria-label="précédente" ${_storyIndex === 0 ? 'disabled' : ''}>
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button class="sv-nav sv-nav--next" aria-label="suivante">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg>
        </button>
      </div>`;

    document.body.appendChild(ov);

    // Animer l'entrée
    requestAnimationFrame(() => {
        requestAnimationFrame(() => ov.classList.add('sv-open'));
    });

    // Progress bar animation
    const fill = ov.querySelector('.sv-bar--active');
    if (fill) {
        fill.style.transition = 'width 5s linear';
        requestAnimationFrame(() => { requestAnimationFrame(() => { fill.style.width = '100%'; }); });
    }
    _storyTimer = setTimeout(() => _storyGo(1), 5000);

    // Events
    ov.querySelector('.sv-close-btn').addEventListener('click', _closeViewer);
    ov.querySelector('.sv-nav--prev').addEventListener('click', e => { e.stopPropagation(); _storyGo(-1); });
    ov.querySelector('.sv-nav--next').addEventListener('click', e => { e.stopPropagation(); _storyGo(1); });
    ov.querySelector('.sv-backdrop').addEventListener('click', _closeViewer);

    // Clavier
    ov._onKey = e => {
        if (e.key === 'ArrowRight') _storyGo(1);
        else if (e.key === 'ArrowLeft') _storyGo(-1);
        else if (e.key === 'Escape') _closeViewer();
    };
    document.addEventListener('keydown', ov._onKey);
}

function _storyGo(dir) {
    clearTimeout(_storyTimer);
    const next = _storyIndex + dir;
    if (next < 0 || next >= _allStories.length) { _closeViewer(); return; }
    _storyIndex = next;
    _buildViewer();
}

function _closeViewer() {
    clearTimeout(_storyTimer);
    const ov = document.getElementById('_svOverlay');
    if (ov) {
        if (ov._onKey) document.removeEventListener('keydown', ov._onKey);
        ov.classList.remove('sv-open');
        ov.classList.add('sv-closing');
        setTimeout(() => ov.remove(), 260);
    }
    _storyViewerActive = false;
}

function _timeAgo(dateStr) {
    if (!dateStr) return '';
    const m = Math.floor((Date.now() - new Date(dateStr)) / 60000);
    if (m < 1) return "à l'instant";
    if (m < 60) return `il y a ${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `il y a ${h}h`;
    return `il y a ${Math.floor(h / 24)}j`;
}

// Alias rétrocompat
function openStoryViewer(story) { _openViewer(_allStories.findIndex(s => s.id === story?.id) || 0); }

// ============================================================
// CREATE POST — Nouvelle UI
// ============================================================

// Compteur caractères live
const _moodInput = document.getElementById('moodInput');
const _charCount = document.getElementById('charCount');
if (_moodInput && _charCount) {
    _moodInput.addEventListener('input', () => {
        _charCount.textContent = _moodInput.value.length;
    });
}

// Color presets
document.querySelectorAll('.create-color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        document.getElementById('moodColor').value = color;
        document.querySelectorAll('.create-color-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// Custom color picker
const _customColor = document.getElementById('moodColor');
if (_customColor) {
    _customColor.addEventListener('change', () => {
        document.querySelectorAll('.create-color-preset').forEach(b => b.classList.remove('active'));

    });
}

// Emoji picker overlay
const _emojiToolBtn = document.getElementById('emojiToolBtn');
const _emojiOverlay = document.getElementById('emojiPickerOverlay');
const _emojiPicker = document.getElementById('emojiPicker');
const _deleteEmojiBtn = document.getElementById('deleteCurrentEmoji');
let _selectedEmoji = '👋';

if (_emojiToolBtn && _emojiOverlay) {
    _emojiToolBtn.addEventListener('click', () => {
        _emojiOverlay.style.setProperty('display', 'flex', 'important');
    });

    _emojiOverlay.querySelector('.create-picker-close-emoji').addEventListener('click', () => {
        _emojiOverlay.style.setProperty('display', 'none', 'important');
    });

    _emojiOverlay.addEventListener('click', (e) => {
        if (e.target === _emojiOverlay) _emojiOverlay.style.setProperty('display', 'none', 'important');
    });
}

// Delete emoji button
if (_deleteEmojiBtn) {
    _deleteEmojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _selectedEmoji = '👋';
        document.querySelector('.moodEmoji').value = _selectedEmoji;
        //_;
    });
}

if (_emojiPicker) {
    _emojiPicker.addEventListener('emoji-click', (e) => {
        _selectedEmoji = e.detail.unicode;
        document.querySelector('.moodEmoji').value = _selectedEmoji;
        //_;
        _emojiOverlay.style.setProperty('display', 'none', 'important');
    });
}

// Sticker picker with Tenor API
const _stickerToolBtn = document.getElementById('stickerToolBtn');
const _stickerOverlay = document.getElementById('stickerPickerOverlay');
const _stickerSearchInput = document.getElementById('stickerSearchInput');
const _stickerSearchBtn = document.getElementById('stickerSearchBtn');
const _stickerResults = document.getElementById('stickerResults');
let _selectedStickerUrl = null;
let currentUserId = null;
let currentConversation = null;
let _myPrivateKey = null;
let _myPublicKeyB64 = null;
let unreadMessages = 0;
let _e2eReady = false; // true s
const TENOR_V1_KEY = 'LIVDSRZULELA';


if (_stickerToolBtn && _stickerOverlay) {
    _stickerToolBtn.addEventListener('click', () => {
        _stickerOverlay.style.setProperty('display', 'flex', 'important');
        if (_stickerResults.children.length === 0) {
            _loadTrendingStickers(); // Trending au premier load
        }
    });

    _stickerOverlay.querySelector('.create-picker-close').addEventListener('click', () => {
        _stickerOverlay.style.setProperty('display', 'none', 'important');
    });

    _stickerOverlay.addEventListener('click', (e) => {
        if (e.target === _stickerOverlay) _stickerOverlay.style.setProperty('display', 'none', 'important');
    });
}

if (_stickerSearchBtn && _stickerSearchInput) {
    _stickerSearchBtn.addEventListener('click', () => {
        const q = _stickerSearchInput.value.trim();
        if (q) _searchStickers(q);
    });

    _stickerSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const q = _stickerSearchInput.value.trim();
            if (q) _searchStickers(q);
        }
    });
}


function _renderStickers(results, apiVersion) {
    _stickerResults.innerHTML = '';

    results.forEach(item => {
        let previewUrl, fullUrl;

        if (apiVersion === 'v2') {
            // v2: media_formats.nanogif pour preview, gif pour share
            previewUrl = item.media_formats?.nanogif?.url || item.media_formats?.gif?.url;
            fullUrl = item.media_formats?.gif?.url;
        } else {
            // v1: media[0].nanogif pour preview, tinygif pour share
            previewUrl = item.media?.[0]?.nanogif?.url || item.media?.[0]?.tinygif?.url;
            fullUrl = item.media?.[0]?.tinygif?.url || item.media?.[0]?.gif?.url;
        }

        if (!previewUrl || !fullUrl) return;

        const div = document.createElement('div');
        div.className = 'sticker-item';
        div.innerHTML = `<img src="${previewUrl}" alt="${item.content_description || item.title || ''}" />`;
        div.addEventListener('click', () => {
            _selectedStickerUrl = fullUrl;
            // _;
            _stickerOverlay.style.display = 'none';
        });
        _stickerResults.appendChild(div);
    });
}

// Preview live
// function _ {
//     const text = _moodInput.value || 'Ton message apparaîtra ici...';
//     const bgColor = document.getElementById('moodColor').value;
//     const previewCard = document.getElementById('previewMood');
//     const previewEmoji = document.getElementById('previewEmoji');
//     const previewText = document.getElementById('previewText');
//     const previewSticker = document.getElementById('previewSticker');


//     previewEmoji.textContent = _selectedEmoji;
//     previewText.textContent = text;

//     // Set background color
//     if (previewCard) {
//         previewCard.style.background = bgColor;
//     }

//     // Auto text color based on brightness
//     const brightness = _getBrightness(bgColor);
//     const textColor = brightness > 128 ? '#1a1a1a' : '#ffffff';
//     previewText.style.color = textColor;
//     previewEmoji.style.color = textColor;

//     // Sticker
//     if (_selectedStickerUrl) {
//         previewSticker.src = _selectedStickerUrl;
//         previewSticker.style.display = 'block';
//     } else {
//         previewSticker.style.display = 'none';
//     }
// }

function _getBrightness(hex) {
    const rgb = parseInt(hex.slice(1), 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = (rgb >> 0) & 0xff;
    return (r * 299 + g * 587 + b * 114) / 1000;
}

// Ephemeral toggle

if (_ephemeralToggle && _durationPicker) {
    _ephemeralToggle.addEventListener('change', () => {
        _durationPicker.style.opacity = _ephemeralToggle.checked ? '1' : '0';
    });
}


async function addInboxNotification(
    type,
    titleKey,
    messageKey,
    icon = "!",
    imgsrc
) {
    const title = t(titleKey) || titleKey;
    const message = t(messageKey) || messageKey;

    const inboxDiv = document.getElementById("inboxdiv");
    if (!inboxDiv) return console.error("❌ Inbox non trouvée dans le DOM");

    const typeColors = {
        info: "#3498dbb0",
        success: "#27ae60b0",
        warning: "#f1c40fb0",
        error: "#e74c3cb0",
        critical: "#c0392bb0"
    };

    const notif = document.createElement("div");
    notif.className = `notificationInbox ${type}`;
    notif.style.borderLeft = `6px solid ${typeColors[type] || "#777"}`;

    // Structure de base
    const iconSpan = document.createElement("span");
    iconSpan.className = "material-symbols-rounded";
    iconSpan.style.color = typeColors[type] || "#777";
    iconSpan.textContent = icon; // 🔒 OK : icône interne, safe

    const wrapper = document.createElement("div");

    const h3 = document.createElement("h3");
    h3.textContent = title;

    const p = document.createElement("p");
    p.textContent = message;

    const img = document.createElement("img");
    if (imgsrc) {
        img.src = imgsrc;
        img.alt = title;
        img.height = 60;
        img.className = "notif-img";

    }

    wrapper.appendChild(h3);
    wrapper.appendChild(p);
    wrapper.appendChild(img);

    notif.appendChild(wrapper);

    // Injection finale
    inboxDiv.prepend(notif);

    // Animation safe
    notif.style.opacity = "0";
    notif.style.transform = "translateY(-10px)";
    setTimeout(() => {
        notif.style.transition = "all 0.3s ease";
        notif.style.opacity = "1";
        notif.style.transform = "translateY(0)";
    }, 50);
}

function gradients() {
    return {
        default: ["#39e8ff", "#436fb6"],
        aurora: ["#00D4FF", "#5B0FBE"],
        venom: ["#B5E853", "#0A1200"],
        Inferno: ["#FF6B35", "#1A0508"],
        twilight: ["#FF9A8B", "#1E1040"],
        sangrie: ["#C0392B", "#080205"],
        ocean: ["#2193b0", "#6dd5ed"],
        sunset: ["#ee9ca7", "#ffdde1"],
        forest: ["#5A3F37", "#2C7744"],
        candy: ["#D3959B", "#BFE6BA"],
        sky: ["#2980B9", "#6DD5FA"],
        summer: ["#FAD0C4", "#FFD1FF"],
        winter: ["#E0EAFc", "#CFDEF3"],
        spring: ["#FBC2EB", "#A6C1EE"],
        autumn: ["#D1913C", "#FFD194"]
    };
}




// only for desktop : cacher la nav quand le curseur n'est pas proche
//check if the cursor is less than 10% of the left of the screen or on the nav
if (window.innerWidth > 768) {
    const nav = document.getElementById('nav');
    const logo = document.querySelector('header img');

    logo.addEventListener('click', () => {
        nav.classList.toggle('shown');
    });
    nav.addEventListener('click', () => {
        nav.classList.toggle('shown');
    });

};


//auth.js


// assets/js/auth.js
// Détection simple : en dev (localhost/127.0.0.1 ou 127.0.0.1) on utilise le backend local,
// sinon on utilise l'URL de production (Render)

export function getToken() {
    return localStorage.getItem('oifeel_token');
}

export function setToken(t) {
    localStorage.setItem('oifeel_token', t);
}

export function clearToken() {
    localStorage.removeItem('oifeel_token');
}

export async function fetchWithAuth(path, opts = {}) {
    const token = getToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Accept either a full URL or a path starting with '/'
    const url = path && (path.startsWith('http://') || path.startsWith('https://')) ? path : `${API}${path}`;

    return fetch(url, { ...opts, headers, credentials: 'include' });
}

export async function registerUser(username, password) {
    // send displayName to server
    const res = await fetch(`${API}auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName: username, password })
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => null);
        throw new Error(txt || 'Register failed');
    }
    // registration succeeded; server doesn't return tokens, so perform login to obtain session
    try {
        await loginUser(password);
    } catch (e) {
        // ignore auto-login failure but still return created user data
    }
    const data = await res.json().catch(() => null);
    return data && data.user ? data.user : null;
}

export async function loginUser(identifier, password) {
    const body = identifier && identifier.includes('@') ? { displayName: identifier, password } : { displayName: identifier, password };
    const res = await fetch(`${API}auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => null);
        const errorData = JSON.parse(txt || '{}');
        if (errorData.banned) {
            showBanScreen(errorData);
            throw new Error('Account banned');
        }
        throw new Error(txt || 'Login failed');
    }
    const data = await res.json();
    // 2FA activé sur ce compte : pas de session/token tant que le code n'est pas validé
    if (data && data.requires2FA) {
        return { requires2FA: true, method: data.method, pendingToken: data.pendingToken };
    }
    // server may return an access token in body and a user object
    if (data && data.token) setToken(data.token);
    return data.user || data;
}

// ── Étape 2 de la connexion : validation du code 2FA ──────────────────
export async function verifyLogin2FA(pendingToken, code) {
    const res = await fetch(`${API}auth/login/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pendingToken, code })
    });
    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (errorData.banned) {
            showBanScreen(errorData);
            throw new Error('Account banned');
        }
        throw new Error(errorData.error || 'Code invalide');
    }
    const data = await res.json();
    if (data && data.token) setToken(data.token);
    return data.user || data;
}

export async function resendLogin2FA(pendingToken) {
    const res = await fetch(`${API}auth/login/2fa/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pendingToken })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur lors du renvoi du code');
    return data;
}

// ── Gestion du 2FA depuis les réglages du compte ───────────────────────
export async function get2FAStatus() {
    const res = await fetchWithAuth('auth/2fa/status');
    if (!res.ok) throw new Error('Impossible de récupérer le statut 2FA');
    return res.json();
}

export async function startTotpSetup() {
    const res = await fetchWithAuth('auth/2fa/totp/start', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur');
    return data; // { secret, qrCode }
}

export async function verifyTotpSetup(code) {
    const res = await fetchWithAuth('auth/2fa/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Code invalide');
    return data;
}

export async function startEmail2FA(email) {
    const res = await fetchWithAuth('auth/2fa/email/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur');
    return data;
}

export async function verifyEmail2FA(code) {
    const res = await fetchWithAuth('auth/2fa/email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Code invalide');
    return data;
}



export async function disable2FA(password) {
    const res = await fetchWithAuth('auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur');
    return data;
}

export async function loginGuest() {
    const res = await fetch(`${API}auth/guest`, {
        method: 'POST',
        credentials: 'include'
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => null);
        throw new Error(txt || 'Guest failed');
    }
    const data = await res.json();
    setToken(data.token);
    return data.user;
}

export async function logout() {
    try {
        await fetch(`${API}auth/logout`, { method: 'POST', credentials: 'include' });
    } catch (e) { /* ignore */ }
    clearToken();
    // Reset UI
    const userName = document.getElementById('userName');
    const userNameProfile = document.getElementById('userNameProfile');
    const userIDspan = document.getElementById('userId');
    const accountAvatar = document.getElementById('accountavatar');
    if (userName) userName.textContent = 'non connecté';
    if (userNameProfile) userNameProfile.textContent = 'USERNAME';
    if (userIDspan) userIDspan.textContent = 'Connectez tu';
    if (accountAvatar) accountAvatar.alt = '';
    // Hide ban screen if shown
    const banOverlay = document.getElementById('ban-overlay');
    if (banOverlay) banOverlay.classList.add('hidden');
}

function showBanScreen(banData) {
    const banOverlay = document.getElementById('ban-overlay');
    const banReason = document.getElementById('ban-reason');
    const banUntil = document.getElementById('ban-until');

    if (banReason) {
        banReason.textContent = banData.reason || 'Votre compte a été banni pour violation des règles.';
    }

    function updateTimeRemaining() {
        if (banUntil) {
            if (banData.permanent) {
                banUntil.textContent = 'Ce ban est définitif.';
            } else if (banData.until) {
                const untilDate = new Date(banData.until);
                const now = new Date();
                const remaining = untilDate - now;
                if (remaining > 0) {
                    const hours = Math.floor(remaining / (1000 * 60 * 60));
                    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
                    banUntil.textContent = `Temps restant: ${hours}h ${minutes}m ${seconds}s`;
                } else {
                    banUntil.textContent = 'Le ban est terminé. Rafraîchissez la page.';
                }
            } else {
                banUntil.textContent = '';
            }
        }
    }

    updateTimeRemaining();
    if (!banData.permanent && banData.until) {
        setInterval(updateTimeRemaining, 1000);
    }

    if (banOverlay) {
        banOverlay.classList.remove('hidden');
    }
}

export async function getCurrentUser() {
    const token = getToken();
    if (!token) return null;
    // <-- corrige l'appel: passer un path relatif à fetchWithAuth
    const res = await fetchWithAuth('auth/me');
    if (!res.ok) {
        if (res.status === 403) {
            const data = await res.json().catch(() => ({}));
            if (data.banData) {
                showBanScreen(data.banData);
                return null;
            }
        }
        return null;
    }
    const data = await res.json().catch(() => null);
    // server returns { user: ... }
    return data && data.user ? data.user : data;
}

// UI wiring (simple)
document.addEventListener('DOMContentLoaded', () => {
    const openLogin = document.getElementById('openLogin');
    const openRegister = document.getElementById('openRegister');
    const guestBtn = document.getElementById('guestLogin');
    const authModal = document.getElementById('authModal');
    // In index.html the modal wrapper has id 'authModalForm' and the actual <form> has id 'authForm'
    const authModalForm = document.getElementById('authModalForm');
    const authForm = document.getElementById('authForm');
    const authTitle = document.getElementById('authFormTitle');
    const usernameInput = document.getElementById('authUsername');
    const passwordInput = document.getElementById('authPassword');
    const cancelBtn = document.getElementById('authCancel');
    const userName = document.getElementById('userName');
    const userNameProfile = document.getElementById('userNameProfile');
    const userIDspan = document.getElementById('userId');
    const logoutBtn = document.getElementById('logoutBtn');
    const accountHeader = document.getElementById('accountheader');
    const accountAvatar = document.getElementById('accountavatar');

    let isRegister = false;
    let pending2FA = null; // { pendingToken, method }

    // Éléments de l'étape OTP (voir markup ajouté dans index.html)
    const otpStep = document.getElementById('authOtpStep');
    const otpInput = document.getElementById('authOtpCode');
    const otpError = document.getElementById('authOtpError');
    const otpSubmit = document.getElementById('authOtpSubmit');
    const otpResend = document.getElementById('authOtpResend');
    const otpMethodLabel = document.getElementById('authOtpMethodLabel');
    const otpBack = document.getElementById('authOtpBack');

    function finalizeLoggedInUI(user, fallbackName) {
        const uname = (user && (user.displayName || user.display_name || user.username)) || fallbackName || 'non connecté';
        userName.textContent = uname;
        userNameProfile.textContent = uname;
        userIDspan.textContent = user.id;
        saveProfileLocal({ displayName: uname });
        hideModal();
        document.dispatchEvent(new CustomEvent('userLoggedIn'));
        location.reload(); // reload to refresh UI and fetch user data
    }

    function showOtpStep(method) {
        pending2FA = pending2FA || {};
        pending2FA.method = method;
        const labels = {
            email: 'Un code a été envoyé par email. Entre-le ci-dessous.',
            totp: 'Ouvre ton appli d\'authentification et entre le code affiché.'
        };
        if (otpMethodLabel) otpMethodLabel.textContent = labels[method] || 'Entre ton code de vérification.';
        if (otpResend) otpResend.style.display = method === 'totp' ? 'none' : '';
        if (authForm) authForm.classList.add('hidden');
        if (otpStep) otpStep.classList.remove('hidden');
        if (otpError) otpError.style.display = 'none';
        setTimeout(() => otpInput && otpInput.focus(), 100);
    }

    function hideOtpStep() {
        pending2FA = null;
        if (otpInput) otpInput.value = '';
        if (otpError) otpError.style.display = 'none';
        if (otpStep) otpStep.classList.add('hidden');
        if (authForm) authForm.classList.remove('hidden');
    }

    function showModal(register = false) {
        isRegister = register;
        authTitle.textContent = register ? "inscription" : 'connexion';
        if (authModalForm) authModalForm.classList.add('shown');
        if (authModal) authModal.style.display = 'block';
        hideOtpStep();
        // focus username
        setTimeout(() => usernameInput && usernameInput.focus(), 100);
    }
    function hideModal() {
        if (authModalForm) authModalForm.classList.remove('shown');
        if (authModal) authModal.style.display = 'none';
        usernameInput && (usernameInput.value = '');
        passwordInput && (passwordInput.value = '');
        hideOtpStep();
    }

    if (openLogin) openLogin.addEventListener('click', () => showModal(false));
    if (openRegister) openRegister.addEventListener('click', () => showModal(true));
    cancelBtn.addEventListener('click', hideModal);
    if (otpBack) otpBack.addEventListener('click', hideOtpStep);
    if (authForm) authForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
            if (isRegister) {
                const user = await registerUser(usernameInput.value, passwordInput.value);
                finalizeLoggedInUI(user, usernameInput.value);
            } else {
                const result = await loginUser(usernameInput.value, passwordInput.value);
                if (result && result.requires2FA) {
                    pending2FA = { pendingToken: result.pendingToken, method: result.method };
                    showOtpStep(result.method);
                    return;
                }
                finalizeLoggedInUI(result, usernameInput.value);
            }
        } catch (err) {
            showFeedback(err.message || 'Erreur de connexion', 'error');
        }
    });

    if (otpSubmit) otpSubmit.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!pending2FA || !otpInput) return;
        try {
            if (otpError) otpError.style.display = 'none';
            const user = await verifyLogin2FA(pending2FA.pendingToken, otpInput.value.trim());
            finalizeLoggedInUI(user, usernameInput.value);
        } catch (err) {
            if (otpError) { otpError.textContent = err.message; otpError.style.display = 'block'; }
        }
    });

    if (otpResend) otpResend.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!pending2FA) return;
        try {
            await resendLogin2FA(pending2FA.pendingToken);
            if (otpError) { otpError.textContent = 'Nouveau code envoyé.'; otpError.style.color = ''; otpError.style.display = 'block'; }
        } catch (err) {
            if (otpError) { otpError.textContent = err.message; otpError.style.display = 'block'; }
        }
    });

    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
        await logout();
        // clear UI
        if (logoutBtn) logoutBtn.classList.add('hidden');
        if (guestBtn) guestBtn.classList.remove('hidden');
        // restore stored profile name or default
        const saved = loadProfileLocal();
        userName.textContent = saved && saved.displayName ? saved.displayName : 'non connecté';
        userNameProfile.textContent = saved && saved.displayName ? saved.displayName : 'non connecté';
        userIDspan.textContent = saved && saved.id ? saved.id : 'Connectez tu';
    });

    // Small helpers to persist simple profile prefs locally
    function saveProfileLocal(data) {
        try {
            const cur = JSON.parse(localStorage.getItem('oifeel_profile') || '{}');
            const next = { ...cur, ...data };
            localStorage.setItem('oifeel_profile', JSON.stringify(next));
            applyProfileToUI(next);
        } catch (e) { /* ignore */ }
    }
    function loadProfileLocal() {
        try { return JSON.parse(localStorage.getItem('oifeel_profile') || '{}'); } catch (e) { return {}; }
    }
    function applyProfileToUI(profile) {
        if (!profile) return;
        if (profile.displayName && userName) userName.textContent = profile.displayName;
        if (profile.displayName && userNameProfile) userNameProfile.textContent = profile.displayName;
        if (profile.id && userIDspan) userIDspan.textContent = profile.id;
        if (profile.emoji && accountAvatar) accountAvatar.alt = profile.emoji;
    }

    // When page loads, check token and UI
    (async () => {
        // Apply any locally saved profile first
        const localProfile = loadProfileLocal();
        applyProfileToUI(localProfile);

        const user = await getCurrentUser();
        if (user) {
            const uname = (user && (user.displayName || user.display_name || user.username)) || localProfile.displayName || 'non connecté';
            // userName.textContent = uname;
            saveProfileLocal({ displayName: uname });
            if (guestBtn) guestBtn.classList.add('hidden');
            if (logoutBtn) logoutBtn.classList.remove('hidden');
            if (accountHeader) accountHeader.classList.remove('hidden');
        } else {
            if (guestBtn) guestBtn.classList.remove('hidden');
        }
    })();

    // Inject simple profile customization UI into profile tab
    function injectProfileSettings() {
        try {
            const accountInfo = document.getElementById('accountinfo');
            if (!accountInfo) return;
            // avoid duplicate
            if (document.getElementById('profile-customization')) return;

            const container = document.createElement('div');
            container.id = 'profile-customization';
            container.style.marginTop = '20px';
            container.innerHTML = `
        <h3>Personnalisation du profil</h3>
        <label>Nom d'affichage<br><input id="profileDisplayName" placeholder="votre pseudo" /></label>
        <label>Emoji d'avatar<br><input id="profileEmoji" placeholder="🙂" /></label>
        <div style="margin-top:8px;"><button id="saveProfileBtn">Enregistrer</button></div>
      `;
            accountInfo.appendChild(container);

            const displayInput = document.getElementById('profileDisplayName');
            const emojiInput = document.getElementById('profileEmoji');
            const saveBtn = document.getElementById('saveProfileBtn');

            // load existing
            const p = loadProfileLocal();
            if (p.displayName) displayInput.value = p.displayName;
            if (p.emoji) emojiInput.value = p.emoji;

            saveBtn.addEventListener('click', () => {
                const newProfile = { displayName: displayInput.value || undefined, emoji: emojiInput.value || undefined };
                saveProfileLocal(newProfile);
            });
        } catch (e) { console.error('profile inject error', e); }
    }

    injectProfileSettings();
});
// Expose logout globally for ban screen
window.logout = logout;


// ============================================================
// account.js — Module de gestion du compte oifeel.
// À ajouter dans index.html : <script type="module" src="/app/scripts/account.js"></script>
// ============================================================

// ============================================================
// STYLES
// ============================================================
function injectStyles() {
    if (document.getElementById('account-styles')) return;
    const style = document.createElement('style');
    style.id = 'account-styles';
    document.head.appendChild(style);
}





// ============================================================
// HELPERS UI
// ============================================================
function showMsg(id, text, type = 'info') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `account-msg show account-msg-${type}`;
    setTimeout(() => el.className = 'account-msg', 4000);
}

function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
        btn._orig = btn.innerHTML;
        btn.innerHTML = '<span class="account-spinner"></span>';
    } else {
        btn.innerHTML = btn._orig || btn.innerHTML;
    }
}


// ============================================================
// CHARGEMENT DES DONNÉES UTILISATEUR
// ============================================================
async function loadAccountData() {
    try {
        const token = localStorage.getItem('oifeel_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const res = await fetch(`${API}users/me`, { credentials: 'include', headers });
        if (!res.ok) return;

        const user = await res.json();

        // Profil
        const avatarPreview = document.getElementById('accountAvatarPreview');
        const avatarInput = document.getElementById('accountAvatarInput');
        const displayName = document.getElementById('accountDisplayName');
        const bio = document.getElementById('accountBio');
        const bioCount = document.getElementById('accountBioCount');

        if (avatarPreview) avatarPreview.textContent = user.avatar || '👤';
        if (avatarInput) avatarInput.value = user.avatar || '';
        if (displayName) displayName.value = user.displayName || '';
        if (bio) {
            bio.value = user.bio || '';
            if (bioCount) bioCount.textContent = (user.bio || '').length;
        }

        // Email
        const emailInput = document.getElementById('accountEmail');
        const emailNotif = document.getElementById('accountEmailNotif');
        if (emailInput) emailInput.value = user.email || '';
        if (emailNotif) emailNotif.checked = !!(user.emailNotifications?.announcements || user.emailNotifications?.updates);

        // Préférence posts IA
        const aiPref = user.aiPostsPreference || 'allow';
        document.querySelectorAll('input[name="aiPref"]').forEach(radio => {
            radio.checked = (radio.value === aiPref);
        });

        // Masquer le changement de MDP pour les invités
        if (user.isGuest) {
            const pwdSection = document.querySelector('#account-tab-securite hr:last-of-type')?.nextElementSibling;
            document.getElementById('changePasswordBtn')?.closest('.account-field')?.remove();
        }

    } catch (err) {
        console.warn('⚠️ Impossible de charger les données du compte:', err);
    }
}


// ============================================================
// SAUVEGARDER LE PROFIL
// ============================================================
async function saveProfile() {
    const avatar = document.getElementById('accountAvatarInput')?.value.trim() || '👤';
    const displayName = document.getElementById('accountDisplayName')?.value.trim();
    const bio = document.getElementById('accountBio')?.value.trim();

    if (!displayName) return showMsg('profileMsg', 'le pseudo ne peut pas être vide.', 'error');

    setLoading('saveProfileBtn', true);
    try {
        const token = localStorage.getItem('oifeel_token');
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        const res = await fetch(`${API}social/profile`, {
            method: 'PUT',
            credentials: 'include',
            headers,
            body: JSON.stringify({ avatar, displayName, bio })
        });

        const data = await res.json();
        if (!res.ok) return showMsg('profileMsg', data.error || 'erreur lors de la sauvegarde.', 'error');

        // Mettre à jour l'aperçu avatar
        const preview = document.getElementById('accountAvatarPreview');
        if (preview) preview.textContent = avatar;

        // Mettre à jour le pseudo affiché dans l'app
        const userNameEl = document.getElementById('userName');
        if (userNameEl) userNameEl.textContent = displayName;

        showMsg('profileMsg', 'profil mis à jour avec succès.', 'success');
    } catch (err) {
        showMsg('profileMsg', 'une erreur réseau s\'est produite de notre côté lors de la modification de ton profil! réessaie dans un instant.', 'error');
    } finally {
        setLoading('saveProfileBtn', false);
    }
}


// ============================================================
// SAUVEGARDER L'EMAIL
// ============================================================
async function saveEmail() {
    const email = document.getElementById('accountEmail')?.value.trim();
    const emailNotif = document.getElementById('accountEmailNotif')?.checked;

    setLoading('saveEmailBtn', true);
    try {
        const token = localStorage.getItem('oifeel_token');
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        const res = await fetch(`${API}users/me/email`, {
            method: 'PATCH',
            credentials: 'include',
            headers,
            body: JSON.stringify({ email, emailNotifications: emailNotif })
        });

        const data = await res.json();
        if (!res.ok) return showMsg('emailMsg', data.error || 'une erreur est survenue de notre côté lors de la sauvegarde.', 'error');

        showMsg('emailMsg', 'e-mail mis à jour avec succès.', 'success');
    } catch (err) {
        showMsg('emailMsg', 'une erreur réseau s\'est produite de notre côté lors de la modification de ton e-mail! réessaie dans un instant.', 'error');
    } finally {
        setLoading('saveEmailBtn', false);
    }
}


// ============================================================
// SAUVEGARDER LA PRÉFÉRENCE D'AFFICHAGE DES POSTS IA
// ============================================================
async function saveAiPreference() {
    const selected = document.querySelector('input[name="aiPref"]:checked');
    const preference = selected ? selected.value : 'allow';

    setLoading('saveAiPrefBtn', true);
    try {
        const token = localStorage.getItem('oifeel_token');
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        const res = await fetch(`${API}users/me/ai-preference`, {
            method: 'PATCH',
            credentials: 'include',
            headers,
            body: JSON.stringify({ preference })
        });

        const data = await res.json();
        if (!res.ok) return showMsg('aiPrefMsg', data.error || 'erreur lors de la sauvegarde.', 'error');

        // Appliquer immédiatement le filtre sur le fil déjà affiché, sans recharger la page
        window.setAiPostsPreference?.(preference);

        showMsg('aiPrefMsg', 'préférence mise à jour avec succès.', 'success');
    } catch (err) {
        showMsg('aiPrefMsg', 'une erreur réseau s\'est produite de notre côté! réessaie dans un instant.', 'error');
    } finally {
        setLoading('saveAiPrefBtn', false);
    }
}


// ============================================================
// CHANGER LE MOT DE PASSE
// ============================================================
async function changePassword() {
    const oldPwd = document.getElementById('accountOldPwd')?.value;
    const newPwd = document.getElementById('accountNewPwd')?.value;
    const newPwd2 = document.getElementById('accountNewPwd2')?.value;

    if (!oldPwd || !newPwd || !newPwd2) return showMsg('passwordMsg', 'tous les champs sont requis.', 'error');
    if (newPwd !== newPwd2) return showMsg('passwordMsg', 'les nouveaux mots de passe ne correspondent pas.', 'error');
    if (newPwd.length < 6) return showMsg('passwordMsg', 'le nouveau mot de passe doit faire au moins 6 caractères.', 'error');
    if (newPwd === oldPwd) return showMsg('passwordMsg', 'le nouveau mot de passe doit être différent.', 'error');

    setLoading('changePasswordBtn', true);
    try {
        const token = localStorage.getItem('oifeel_token');
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        const res = await fetch(`${API}auth/change-password`, {
            method: 'PUT',
            credentials: 'include',
            headers,
            body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd })
        });

        const data = await res.json();
        if (!res.ok) return showMsg('passwordMsg', data.error || 'une erreur de notre côté s\'est produit lors du changement.', 'error');

        // Effacer les champs
        document.getElementById('accountOldPwd').value = '';
        document.getElementById('accountNewPwd').value = '';
        document.getElementById('accountNewPwd2').value = '';

        showMsg('passwordMsg', 'mot de passe changé avec succès.', 'success');
    } catch (err) {
        showMsg('passwordMsg', 'une erreur réseau s\'est produite de notre côté lors de la modification de ton mot de passe! réessaie dans un instant.', 'error');
    } finally {
        setLoading('changePasswordBtn', false);
    }
}


// ============================================================
// EXPORT DES DONNÉES
// ============================================================
async function exportData() {
    setLoading('exportDataBtn', true);
    showMsg('exportMsg', 'préparation des infos', 'info');
    try {
        const token = localStorage.getItem('oifeel_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const res = await fetch(`${API}users/me/export`, { credentials: 'include', headers });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            return showMsg('exportMsg', data.error || 'erreur lors de la préparations de tes infos!.', 'error');
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `oifeel-donnees-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showMsg('exportMsg', 'données téléchargées avec succès.', 'success');
    } catch (err) {
        showMsg('exportMsg', 'une erreur réseau s\'est produite de notre côté lors du téléchargement de tes données, réessaie dans un instant.', 'error');
    } finally {
        setLoading('exportDataBtn', false);
    }
}


// ============================================================
// SUPPRIMER LE COMPTE
// ============================================================
async function confirmDeleteAccount() {
    const pwd = document.getElementById('deleteConfirmPwd')?.value;
    if (!pwd) return showMsg('deleteMsg', 'saisis ton mot de passe pour confirmer.', 'error');

    setLoading('confirmDeleteBtn', true);
    try {
        const token = localStorage.getItem('oifeel_token');
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        const res = await fetch(`${API}auth/account`, {
            method: 'DELETE',
            credentials: 'include',
            headers,
            body: JSON.stringify({ password: pwd })
        });

        const data = await res.json();
        if (!res.ok) return showMsg('deleteMsg', data.error || 'une erreur s\'est produite de notre côté lors de la suppression.', 'error');

        showMsg('deleteMsg', 'compte supprimé, on est désolés de te voir partir mais nous espérons que tu as passé un bon moment avec nous !', 'success');
        // Nettoyer et déconnecter
        localStorage.clear();
        setTimeout(() => { window.location.reload(); }, 2000);
    } catch (err) {
        showMsg('deleteMsg', 'une erreur réseau s\'est produite de notre côté lors de la suppression de ton profil! réessaie dans un instant.', 'error');
    } finally {
        setLoading('confirmDeleteBtn', false);
    }
}


// ============================================================
// OUVRIR / FERMER
// ============================================================
export function openAccountModal() {
    const overlay = document.getElementById('accountOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    loadAccountData();
}

function closeAccountModal() {
    const overlay = document.getElementById('accountOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
}

// Exposer au scope global (utilisé via onclick HTML)
window.openAccountModal = openAccountModal;


// ============================================================
// INIT
// ============================================================
function init() {
    injectStyles();

    // ── Fermer ───────────────────────────────────────────────
    document.getElementById('accountCloseBtn')?.addEventListener('click', closeAccountModal);
    document.getElementById('accountOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('accountOverlay')) closeAccountModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeAccountModal();
    });

    // ── Onglets ──────────────────────────────────────────────
    document.querySelectorAll('.account-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.account-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.account-section').forEach(s => s.classList.remove('active'));
            tab.classList.add('active');
            const panel = document.getElementById(`account-tab-${tab.dataset.tab}`);
            if (panel) panel.classList.add('active');
        });
    });

    // ── Avatar live preview ───────────────────────────────────
    document.getElementById('accountAvatarInput')?.addEventListener('input', e => {
        const preview = document.getElementById('accountAvatarPreview');
        if (preview) preview.textContent = e.target.value || '👤';
    });

    // ── Bio char count ────────────────────────────────────────
    document.getElementById('accountBio')?.addEventListener('input', e => {
        const counter = document.getElementById('accountBioCount');
        if (counter) counter.textContent = e.target.value.length;
    });

    // ── Boutons ───────────────────────────────────────────────
    document.getElementById('saveProfileBtn')?.addEventListener('click', saveProfile);
    document.getElementById('saveEmailBtn')?.addEventListener('click', saveEmail);
    document.getElementById('saveAiPrefBtn')?.addEventListener('click', saveAiPreference);
    document.getElementById('changePasswordBtn')?.addEventListener('click', changePassword);
    document.getElementById('exportDataBtn')?.addEventListener('click', exportData);

    // ── Suppression compte ───────────────────────────────────
    document.getElementById('deleteAccountBtn')?.addEventListener('click', () => {
        document.getElementById('deleteConfirmBox')?.classList.add('show');
        document.getElementById('deleteAccountBtn').style.display = 'none';
    });
    document.getElementById('cancelDeleteBtn')?.addEventListener('click', () => {
        document.getElementById('deleteConfirmBox')?.classList.remove('show');
        document.getElementById('deleteAccountBtn').style.display = '';
        document.getElementById('deleteConfirmPwd').value = '';
    });
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDeleteAccount);

    // ── Ajouter le bouton dans #profilemenu ───────────────────
    addMenuButton();
}

function addMenuButton() {
    const profileMenu = document.getElementById('profilemenu');
    if (!profileMenu || document.getElementById('openAccountModalBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'openAccountModalBtn';
    btn.textContent = 'paramètres de mon compte';
    btn.addEventListener('click', () => {
        document.getElementById('profilemenu')?.classList.remove('show');
        openAccountModal();
    });

    // Insérer avant le bouton "portail admin"
    const adminLink = profileMenu.querySelector('a[href*="admin"]');
    if (adminLink) {
        profileMenu.insertBefore(btn, adminLink);
    } else {
        profileMenu.appendChild(btn);
    }
}

// Lancer l'init au bon moment
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// comments.js — v3 : rangées pleine largeur + panneau de saisie séparé,
// d'après la maquette Figma (fond teinté selon la couleur du post,
// like/dislike/report en pilule, "afficher plus" pour le texte long)

const COMMENTS_PER_PAGE = 4;
const COMMENT_MAX_LENGTH = 250;
const CTEXT_TRUNCATE_AT = 90; // caractères avant d'afficher "afficher plus"

// ─── Teinte dynamique à partir de la couleur du post ──────────
// Reprend le principe de getAutoTextColor (canvas 1x1) pour resoudre
// n'importe quelle valeur CSS (hex, rgb, gradient...) en un RGB exploitable,
// puis injecte cette teinte en variables CSS sur la section commentaires.
function _resolvePostRGB(colorValue) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = colorValue || '#5f95b9';
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return { r, g, b };
    } catch {
        return { r: 95, g: 149, b: 185 }; // fallback = --accent de la charte
    }
}

function _applyCommentTint(section, colorValue) {
    const { r, g, b } = _resolvePostRGB(colorValue);
    section.style.setProperty('--c-tint-r', r);
    section.style.setProperty('--c-tint-g', g);
    section.style.setProperty('--c-tint-b', b);
}

// ─── Point d'entrée ──────────────────────────────────────────
// postColor : la couleur/gradient du post (mood.color), utilisée pour teinter
// la zone commentaires. Optionnel : si absent, retombe sur --accent.
export function attachComments(postEl, postId, postColor) {
    if (postEl.dataset.commentsAttached) {
        // Deja attache (ex: reouverture de la modal permalink) : on met
        // juste a jour la teinte au cas ou la couleur du post ait change.
        const existingWrap = postEl.querySelector('.cwrap');
        if (existingWrap && postColor) _applyCommentTint(existingWrap, postColor);
        return;
    }
    postEl.dataset.commentsAttached = 'true';

    // Bouton toggle commentaires
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'ctoggle';
    toggleBtn.innerHTML = `<span class="cicon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 11h.01"/><path d="M16 11h.01"/><path d="M8 11h.01"/></svg></span><span class="ccount">0</span>`;
    toggleBtn.title = 'Commentaires';

    // Insérer dans la barre d'actions (fil principal), sinon directement
    // dans postEl (cas de la modal permalink, qui n'a pas ces barres).
    const actionBar = postEl.querySelector('.post-actions');
    const buttons = postEl.querySelector('.buttons');
    if (actionBar) {
        actionBar.insertBefore(toggleBtn, actionBar.firstChild);
    } else if (buttons) {
        buttons.appendChild(toggleBtn);
    } else {
        postEl.appendChild(toggleBtn);
    }

    // ── Structure : rangées de commentaires à gauche + panneau de
    // saisie à droite (desktop), empilés verticalement (mobile) ──
    const wrap = document.createElement('div');
    wrap.className = 'cwrap';
    wrap.style.display = 'none';
    _applyCommentTint(wrap, postColor);
    wrap.innerHTML = `
        <div class="clist-col">
            <div class="clist"></div>
            <div class="cmore-wrap" style="display:none">
                <button class="cmore-btn" type="button">afficher plus de commentaires</button>
            </div>
        </div>
        <div class="cinput-col">
            <textarea class="cinput" placeholder="écris ton commentaire ici…" maxlength="${COMMENT_MAX_LENGTH}"></textarea>
            <div class="cinput-footer">
                <span class="ccharcount">0/${COMMENT_MAX_LENGTH} chr.</span>
                <span class="ctos">en écrivant un commentaire tu acceptes les conditions d'utilisation</span>
                <button class="csend" title="envoyer" aria-label="envoyer" type="button">
                    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"/>
                        <polyline points="12 5 19 12 12 19"/>
                    </svg>
                </button>
            </div>
        </div>
    `;
    postEl.appendChild(wrap);

    let allComments = [];
    let showCount = COMMENTS_PER_PAGE;
    let open = false;

    // Charger le compte initial sans ouvrir
    _fetchComments(postId).then(comments => {
        allComments = comments;
        _updateCount(toggleBtn, allComments.length);
    });

    // ─── Toggle ─────────────────────────────────────────────
    toggleBtn.addEventListener('click', () => {
        open = !open;
        wrap.style.display = open ? 'flex' : 'none';
        toggleBtn.classList.toggle('copen', open);
        if (open) {
            showCount = COMMENTS_PER_PAGE;
            _render(wrap, allComments, showCount, postId);
        }
    });

    // ─── Voir plus ──────────────────────────────────────────
    wrap.querySelector('.cmore-btn').addEventListener('click', () => {
        showCount += COMMENTS_PER_PAGE;
        _render(wrap, allComments, showCount, postId);
    });

    // ─── Envoi commentaire ──────────────────────────────────
    const input = wrap.querySelector('.cinput');
    const sendBtn = wrap.querySelector('.csend');
    const charCount = wrap.querySelector('.ccharcount');

    input.addEventListener('input', () => {
        charCount.textContent = `${input.value.length}/${COMMENT_MAX_LENGTH} chr.`;
    });

    const send = async () => {
        const text = input.value.trim();
        if (!text) return;

        // Récupérer le nom depuis localStorage
        const profile = _getProfile();

        // Optimistic
        const tempComment = {
            _id: `temp_${Date.now()}`,
            text,
            author: profile.displayName || 'Tu',
            createdAt: new Date().toISOString(),
            pending: true
        };
        allComments.push(tempComment);
        _updateCount(toggleBtn, allComments.length);
        _render(wrap, allComments, showCount + 99, postId);
        input.value = '';
        charCount.textContent = `0/${COMMENT_MAX_LENGTH} chr.`;

        // API
        try {
            const res = await fetch(`${API}posts/${postId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('oifeel_token') ? { Authorization: `Bearer ${localStorage.getItem('oifeel_token')}` } : {}) },
                credentials: 'include',
                body: JSON.stringify({ text, author: profile.displayName || '' })
            });
            if (res.ok) {
                const saved = await res.json();
                // Remplacer le temp par le vrai
                const idx = allComments.findIndex(c => c._id === tempComment._id);
                if (idx >= 0) allComments[idx] = saved.comment || { ...tempComment, pending: false };
            } else {
                // Conserver en local quand même
                tempComment.pending = false;
            }
        } catch (_) {
            tempComment.pending = false;
        }

        // Sauvegarder localement
        _saveLocalComments(postId, allComments);
        _render(wrap, allComments, showCount + 99, postId);
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
}

// ─── Like / dislike visuel (local uniquement pour l'instant) ──
// Pas encore branché à l'API : juste un état visuel par session,
// stocké en mémoire sur l'objet commentaire lui-même (c._reaction).
function _setCommentReaction(comment, reaction) {
    // toggle : re-cliquer sur le même bouton annule la réaction
    comment._reaction = comment._reaction === reaction ? null : reaction;
}

// ─── Rendu liste commentaires ────────────────────────────────
function _render(wrap, comments, maxShow, postId) {
    const list = wrap.querySelector('.clist');
    const moreWrap = wrap.querySelector('.cmore-wrap');

    list.innerHTML = '';

    const shown = comments.slice(0, maxShow);
    shown.forEach(c => {
        const el = document.createElement('div');
        el.className = `ccomment${c.pending ? ' cpending' : ''}`;

        const date = c.createdAt ? new Date(c.createdAt).toLocaleString('fr-FR', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        }) : '';

        const initial = (c.author || '?')[0].toUpperCase();
        const hue = _strHue(c.author || '?');

        const fullText = _esc(c.text);
        const isLong = c.text.length > CTEXT_TRUNCATE_AT;
        const shortText = isLong ? _esc(c.text.slice(0, CTEXT_TRUNCATE_AT).trimEnd()) + '…' : fullText;

        el.innerHTML = `
            <div class="cavatar" style="background:hsl(${hue},58%,42%)">${initial}</div>
            <div class="ctext-wrap">
                <p class="ctext">
                    <span class="ctext-short">${shortText}</span>${isLong ? `<span class="ctext-full" hidden>${fullText}</span><button class="cexpand-btn" type="button">afficher plus</button>` : ''}
                </p>
            </div>
            <div class="cactions-wrap">
                
                <span class="cdate">${c.pending ? 'envoi…' : date}</span>
            </div>
        `;

        // Expand "afficher plus"
        const expandBtn = el.querySelector('.cexpand-btn');
        if (expandBtn) {
            expandBtn.addEventListener('click', () => {
                el.querySelector('.ctext-short').hidden = true;
                el.querySelector('.ctext-full').hidden = false;
                expandBtn.hidden = true;
            });
        }

        list.appendChild(el);
    });

    // Bouton "voir plus"
    const hasMore = comments.length > maxShow;
    moreWrap.style.display = hasMore ? 'block' : 'none';
    if (hasMore) {
        wrap.querySelector('.cmore-btn').textContent =
            `afficher ${comments.length - maxShow} commentaire(s) de plus`;
    }
}

// ─── Fetch depuis API + fallback localStorage ────────────────
async function _fetchComments(postId) {
    try {
        const res = await fetch(`${API}posts/${postId}/comments`);
        if (res.ok) {
            const data = await res.json();
            const comments = data.comments || data || [];
            _saveLocalComments(postId, comments);
            return comments;
        }
    } catch (_) { }
    return _loadLocalComments(postId);
}

function _updateCount(btn, count) {
    const span = btn.querySelector('.ccount');
    if (span) span.textContent = count > 0 ? count : '';
}

// ─── LocalStorage ───────────────────────────────────────────
function _saveLocalComments(pid, data) {
    try { localStorage.setItem(`comments_${pid}`, JSON.stringify(data)); } catch { }
}
function _loadLocalComments(pid) {
    try { return JSON.parse(localStorage.getItem(`comments_${pid}`) || '[]'); } catch { return []; }
}
function _getProfile() {
    try { return JSON.parse(localStorage.getItem('oifeel_profile') || '{}'); } catch { return {}; }
}


function _strHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h) % 360;
}

// creator-extras
// ============================================================
// creator-extras.js — Améliorations du créateur de posts
// • Palette de 12 dégradés prédéfinis
// • Sauvegarde automatique du brouillon
// • Mode focus (masquer tout sauf le créateur)
// • Autocomplétion @mention
// ============================================================

const DRAFT_KEY = 'draft';

// ─── Palette de dégradés ──────────────────────────────────────
const PRESETS = [
    { name: 'Coucher de soleil', value: 'linear-gradient(135deg,#f093fb,#f5576c)' },
    { name: 'Océan', value: 'linear-gradient(135deg,#4facfe,#00f2fe)' },
    { name: 'Minuit', value: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' },
    { name: 'Forêt', value: 'linear-gradient(135deg,#134e5e,#71b280)' },
    { name: 'Aurore', value: 'linear-gradient(135deg,#a18cd1,#fbc2eb)' },
    { name: 'Feu', value: 'linear-gradient(135deg,#f7971e,#ffd200)' },
    { name: 'Néon', value: 'linear-gradient(135deg,#00b09b,#96c93d)' },
    { name: 'Rose doré', value: 'linear-gradient(135deg,#f6d365,#fda085)' },
    { name: 'Tempête', value: 'linear-gradient(135deg,#373b44,#4286f4)' },
    { name: 'Cerise', value: 'linear-gradient(135deg,#eb3349,#f45c43)' },
    { name: 'Lilas', value: 'linear-gradient(135deg,#c471ed,#12c2e9)' },
    { name: 'Chocolat', value: 'linear-gradient(135deg,#3e1f00,#8b5e3c)' },
];

// ─── Point d'entrée ──────────────────────────────────────────
export function initCreatorExtras() {
    // Attendre que le DOM soit prêt
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
}

// ─── 1. Palette couleurs ─────────────────────────────────────
function _injectColorPresets() {
    const colorInput = document.getElementById('create-color-preset');
    if (!colorInput || document.getElementById('presets')) return;

    const container = document.createElement('div');
    container.id = 'presets';
    container.className = 'presets';


    const grid = document.createElement('div');
    grid.className = 'presets-grid';

    PRESETS.forEach(preset => {
        const swatch = document.createElement('button');
        swatch.className = 'swatch';
        swatch.title = preset.name;
        swatch.style.background = preset.value;
        swatch.setAttribute('aria-label', preset.name);

        swatch.addEventListener('click', () => {
            // // Appliquer le dégradé au preview et stocker dans un data attribute
            // const previewCard = document.getElementById('previewCard') || document.getElementById('previewMood');
            // if (previewCard) previewCard.style.background = preset.value;

            // Stocker la valeur pour la soumission
            document.getElementById('moodColor').dataset.gradient = preset.value;

            // Mettre en evidence la swatch active
            grid.querySelectorAll('.swatch').forEach(s => s.classList.remove('swatch--active'));
            swatch.classList.add('swatch--active');
        });

        grid.appendChild(swatch);
    });

    container.appendChild(grid);
    colorInput.closest('label')?.insertAdjacentElement('afterend', container) ||
        colorInput.insertAdjacentElement('afterend', container);

    // Patcher submitBtn pour utiliser le gradient si défini
    _patchSubmitForGradient();
}

function _patchSubmitForGradient() {
    const submitBtn = document.getElementById('submitMood');
    if (!submitBtn || submitBtn.dataset.gradientPatched) return;
    submitBtn.dataset.gradientPatched = 'true';

    // Intercepter avant soumission : si gradient sélectionné, on override color
    submitBtn.addEventListener('click', () => {
        const gradient = document.getElementById('moodColor')?.dataset.gradient;
        if (gradient) {
            // Stocker temporairement pour que app.js le récupère
            window._v2SelectedGradient = gradient;
        }
    }, true); // capture phase
}

// ─── 2. Brouillon auto-sauvegardé ───────────────────────────
let _draftTimer = null;

function _initDraftAutosave() {
    const input = document.getElementById('moodInput');
    if (!input) return;

    // Indicateur visuel
    const indicator = document.createElement('div');
    indicator.id = 'draft-indicator';
    indicator.className = 'draft-indicator';
    indicator.textContent = '';
    input.insertAdjacentElement('afterend', indicator);

    input.addEventListener('input', () => {
        clearTimeout(_draftTimer);
        indicator.textContent = '';
        indicator.classList.remove('draft--saved');

        _draftTimer = setTimeout(() => {
            _saveDraft();
            indicator.textContent = '💾 Brouillon sauvegardé';
            indicator.classList.add('draft--saved');
            setTimeout(() => {
                indicator.textContent = '';
                indicator.classList.remove('draft--saved');
            }, 2500);
        }, 800);
    });

    // Effacer brouillon à la soumission
    const submitBtn = document.getElementById('submitMood');
    if (submitBtn) {
        submitBtn.addEventListener('click', () => {
            setTimeout(_clearDraft, 500);
        });
    }
}

function _saveDraft() {
    const text = document.getElementById('moodInput')?.value || '';
    const emoji = document.querySelector('.moodEmoji')?.value || '';
    const color = document.getElementById('moodColor')?.value || '#ffffff';
    const gradient = document.getElementById('moodColor')?.dataset.gradient || null;

    if (!text && !emoji) return;
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, emoji, color, gradient, savedAt: Date.now() }));
    } catch { }
}

function _restoreDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const draft = JSON.parse(raw);

        // Ne restaurer que si moins de 24h
        if (Date.now() - (draft.savedAt || 0) > 86400000) { _clearDraft(); return; }

        const input = document.getElementById('moodInput');
        const emojiInput = document.querySelector('.moodEmoji');
        const colorInput = document.getElementById('moodColor');

        if (input && draft.text) {
            input.value = draft.text;
            input.dispatchEvent(new Event('input')); // déclenche updatePreview
        }
        if (emojiInput && draft.emoji) {
            emojiInput.value = draft.emoji;
        }
        if (colorInput && draft.color && !draft.gradient) {
            colorInput.value = draft.color;
        }
        if (draft.gradient) {
            // colorInput.dataset.gradient = draft.gradient;
            // const preview = document.getElementById('previewCard') || document.getElementById('previewMood');
            // if (preview) preview.style.background = draft.gradient;
        }

        // Notification discrète
        if (draft.text) {
            const banner = document.createElement('div');
            banner.className = 'draft-banner';
            banner.innerHTML = `📝 Brouillon restauré <button id="discard-draft">Ignorer</button>`;
            document.getElementById('moodInput')?.insertAdjacentElement('beforebegin', banner);

            document.getElementById('discard-draft')?.addEventListener('click', () => {
                _clearDraft();
                if (input) input.value = '';
                banner.remove();
            });
        }
    } catch { }
}

function _clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { }
    document.getElementById('draft-banner')?.remove();
}

// ─── 3. Mode Focus ──────────────────────────────────────────
function _initFocusMode() {
    const createTab = document.getElementById('createTab');
    if (!createTab || document.getElementById('focus-btn')) return;

    const form = document.getElementById('postModal') || createTab;

    // Injecter le bouton focus dans le formulaire
    const btn = document.createElement('button');
    btn.id = 'focus-btn';
    btn.className = 'focus-btn';
    btn.type = 'button';
    btn.innerHTML = `
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>
        Mode focus
    `;

    const submitBtn = document.getElementById('submitMood');
    if (submitBtn) submitBtn.insertAdjacentElement('beforebegin', btn);

    let focused = false;

    btn.addEventListener('click', () => {
        focused = !focused;
        document.body.classList.toggle('focus-mode', focused);
        btn.classList.toggle('focus-btn--active', focused);
        btn.querySelector('svg')?.setAttribute('stroke', focused ? '#667eea' : 'currentColor');

        if (focused) {
            btn.innerHTML = btn.innerHTML.replace('Mode focus', 'Quitter le focus');
            // Scroll vers le créateur
            document.getElementById('moodInput')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            btn.innerHTML = btn.innerHTML.replace('Quitter le focus', 'Mode focus');
        }
    });

    // Echap pour quitter le focus
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && focused) btn.click();
    });
}



function _initMentions() {
    const input = document.getElementById('moodInput');
    if (!input || document.getElementById('mention-dropdown')) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'mention-dropdown';
    dropdown.className = 'mention-dropdown';
    dropdown.style.display = 'none';
    input.insertAdjacentElement('afterend', dropdown);

    let mentionStart = -1;
    let searchTimer = null;

    input.addEventListener('input', () => {
        const text = input.value;
        const cursor = input.selectionStart;

        // Trouver @ avant le curseur
        const before = text.substring(0, cursor);
        const match = before.match(/@(\w*)$/);

        if (match) {
            mentionStart = cursor - match[0].length;
            const query = match[1];

            clearTimeout(searchTimer);
            if (query.length >= 1) {
                searchTimer = setTimeout(() => _searchMentions(query, dropdown, input, mentionStart), 250);
            } else {
                dropdown.style.display = 'none';
            }
        } else {
            dropdown.style.display = 'none';
            mentionStart = -1;
        }
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== input) {
            dropdown.style.display = 'none';
        }
    });
}

async function _searchMentions(query, dropdown, input, mentionStart) {
    try {
        const res = await fetch(`${API}users/search?q=${encodeURIComponent(query)}&limit=5`);
        if (!res.ok) { dropdown.style.display = 'none'; return; }
        const users = await res.json();

        if (!users.length) { dropdown.style.display = 'none'; return; }

        dropdown.innerHTML = '';
        users.forEach(user => {
            const item = document.createElement('div');
            item.className = 'mention-item';
            const initial = (user.displayName || '?')[0].toUpperCase();
            item.innerHTML = `
                <span class="mention-avatar">${initial}</span>
                <span class="mention-name">${_esc(user.displayName)}</span>
            `;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const text = input.value;
                const cursor = input.selectionStart;
                const newText = text.substring(0, mentionStart) + `@${user.displayName} ` + text.substring(cursor);
                input.value = newText;
                input.setSelectionRange(mentionStart + user.displayName.length + 2, mentionStart + user.displayName.length + 2);
                input.dispatchEvent(new Event('input'));
                dropdown.style.display = 'none';
            });
            dropdown.appendChild(item);
        });

        dropdown.style.display = 'block';
    } catch {
        dropdown.style.display = 'none';
    }
}

function _esc(t) {
    const d = document.createElement('div'); d.textContent = t; return d.innerHTML;
}


// crypte e2e
const DB_NAME = 'oifeel_e2e';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

// ─── IndexedDB ──────────────────────────────────────────────

let _dbInstance = null;

function _openDB() {
    if (_dbInstance) return Promise.resolve(_dbInstance);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        };
        req.onsuccess = (e) => { _dbInstance = e.target.result; resolve(_dbInstance); };
        req.onerror = (e) => reject(e.target.error);
    });
}

async function _dbGet(key) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = (e) => resolve(e.target.result?.value ?? null);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function _dbSet(key, value) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ id: key, value });
        tx.oncomplete = resolve;
        tx.onerror = (e) => reject(e.target.error);
    });
}

// ─── Génération / récupération de la paire de clés ──────────

export async function ensureKeyPair(userId) {
    const stored = await _dbGet(`keypair_${userId}`);
    if (stored) {
        const { publicKeyJwk, privateKeyJwk } = stored;
        const publicKey = await crypto.subtle.importKey(
            'jwk', publicKeyJwk,
            { name: 'ECDH', namedCurve: 'P-256' }, true, []
        );
        const privateKey = await crypto.subtle.importKey(
            'jwk', privateKeyJwk,
            { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
        );
        return { publicKey, privateKey, publicKeyB64: _jwkToB64(publicKeyJwk) };
    }

    // Nouvelle paire
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    await _dbSet(`keypair_${userId}`, { publicKeyJwk, privateKeyJwk });

    return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, publicKeyB64: _jwkToB64(publicKeyJwk) };
}

// ─── Enregistrement de la clé publique (avec retry) ─────────

/**
 * Enregistre la clé publique sur le serveur.
 * Retente jusqu'à 5 fois avec délai croissant.
 */
export async function registerPublicKey(publicKeyB64, maxRetries = 5) {
    const token = localStorage.getItem('oifeel_token');
    if (!token) {
        console.warn('⚠️  E2E: pas de token, clé non enregistrée');
        return false;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(`${API}users/public-key`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include',
                body: JSON.stringify({ publicKey: publicKeyB64 })
            });

            if (res.ok) {
                return true;
            }

            const body = await res.json().catch(() => ({}));
            console.warn(`⚠️  E2E registerPublicKey tentative ${attempt}/${maxRetries} — ${res.status}: ${body.error || '?'}`);

            // Si 503 retryable ou 5xx → réessayer
            if (res.status === 503 || res.status >= 500) {
                if (attempt < maxRetries) {
                    await _sleep(attempt * 2000); // 2s, 4s, 6s…
                    continue;
                }
            }
            // 401, 400, 404 → pas la peine de réessayer
            return false;
        } catch (err) {
            console.warn(`⚠️  E2E registerPublicKey tentative ${attempt}/${maxRetries} — réseau:`, err.message);
            if (attempt < maxRetries) await _sleep(attempt * 2000);
        }
    }

    console.error('❌ E2E: clé non enregistrée après', maxRetries, 'tentatives');
    return false;
}

// ─── Récupération de la clé publique (avec cache IndexedDB) ──

// Cache mémoire court terme (session)
const _pubKeyMemCache = new Map(); // userId → CryptoKey | null

/**
 * Récupère la clé publique d'un utilisateur.
 * Cache : mémoire (session) + IndexedDB (persistant).
 * Retourne null si l'utilisateur n'a pas encore de clé E2E.
 */
export async function fetchPublicKey(userId) {
    // 1. Cache mémoire (seulement les résultats POSITIFS : une absence de
    // clé ne doit jamais être mise en cache indéfiniment, sinon on reste
    // bloqué pour toute la session si l'autre utilisateur termine son
    // enregistrement E2E juste après notre premier essai)
    if (_pubKeyMemCache.has(userId)) return _pubKeyMemCache.get(userId);

    // 2. Cache IndexedDB (évite un appel réseau)
    const cached = await _dbGet(`pubkey_${userId}`).catch(() => null);
    if (cached?.b64) {
        const key = await _importPublicKeyB64(cached.b64);
        _pubKeyMemCache.set(userId, key);
        return key;
    }

    // 3. Appel serveur
    try {
        const res = await fetch(`${API}users/${userId}/public-key`, {
            credentials: 'include',
            cache: 'no-store'
        });

        if (!res.ok) {
            return null; // pas mis en cache : on retentera au prochain appel
        }

        const data = await res.json();

        if (!data.publicKey) {
            // Pas encore de clé E2E pour cet utilisateur : ne PAS mettre en
            // cache, pour qu'un prochain appel (ex: à l'arrivée d'un
            // nouveau message) retente et trouve la clé si elle a été
            // enregistrée entre-temps.
            return null;
        }

        // Mettre en cache (uniquement le résultat positif)
        await _dbSet(`pubkey_${userId}`, { b64: data.publicKey, cachedAt: Date.now() });
        const key = await _importPublicKeyB64(data.publicKey);
        _pubKeyMemCache.set(userId, key);
        return key;

    } catch (err) {
        console.warn('⚠️  fetchPublicKey réseau:', err.message);
        return null; // pas mis en cache : on retentera au prochain appel
    }
}

/**
 * Invalide le cache d'une clé publique (utile si on veut forcer re-fetch).
 */
export function invalidatePubKeyCache(userId) {
    _pubKeyMemCache.delete(userId);
    _dbSet(`pubkey_${userId}`, null).catch(() => { });
}

// ─── Dérivation de la clé partagée (ECDH + HKDF) ────────────

const _sharedKeyCache = new Map();

export async function getSharedKey(myPrivateKey, theirPublicKey, convId) {
    if (_sharedKeyCache.has(convId)) return _sharedKeyCache.get(convId);

    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: theirPublicKey },
        myPrivateKey,
        256
    );

    const hkdfKey = await crypto.subtle.importKey(
        'raw', sharedBits, { name: 'HKDF' }, false, ['deriveKey']
    );

    const aesKey = await crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new TextEncoder().encode('oifeel-e2e-v1'),
            info: new TextEncoder().encode(convId)
        },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );

    _sharedKeyCache.set(convId, aesKey);
    return aesKey;
}

// ─── Chiffrement ─────────────────────────────────────────────

export async function encryptMessage(plaintext, aesKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ctBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);
    return `${_ab2b64(iv.buffer)}.${_ab2b64(ctBuffer)}`;
}

// ─── Déchiffrement ────────────────────────────────────────────

export async function decryptMessage(encryptedPayload, aesKey) {
    try {
        const [ivB64, ctB64] = encryptedPayload.split('.');
        if (!ivB64 || !ctB64) return null;

        const plainBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(_b642ab(ivB64)) },
            aesKey,
            _b642ab(ctB64)
        );
        return new TextDecoder().decode(plainBuffer);
    } catch {
        return null; // message non-chiffré ou clé incorrecte
    }
}

// ─── Utilitaires ─────────────────────────────────────────────

function _ab2b64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function _b642ab(b64) {
    const binary = atob(b64);
    const buf = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
    return buf;
}

function _jwkToB64(jwk) {
    return btoa(JSON.stringify(jwk));
}

async function _importPublicKeyB64(b64) {
    try {
        const jwk = JSON.parse(atob(b64));
        return await crypto.subtle.importKey(
            'jwk', jwk,
            { name: 'ECDH', namedCurve: 'P-256' }, true, []
        );
    } catch {
        return null;
    }
}

function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}


// feed extras
// ─── Mood du jour — couleur/emoji basé sur la date ───────────
const DAILY_MOODS = [
    { emoji: '☀️', text: 'quel est ton mood aujourd\'hui ?' },
    { emoji: '🌙', text: 'la nuit porte conseil…' },
    { emoji: '🌊', text: 'laisse-toi porter par le courant.' },
    { emoji: '🔥', text: 'aujourd\'hui tu donne tout!' },
    { emoji: '🌸', text: 'prens soin de toi.' },
    { emoji: '🍂', text: 'tes souvenirs ont leur beauté.' },
    { emoji: '🌈', text: 'après la pluie, le beau temps.' },
    { emoji: '💤', text: 'besoin d\'une petite pause ?' },
    { emoji: '💖', text: 'répends un peu d\'amour aujourd\'hui.' },
    { emoji: '😎', text: 'reste détendu et confiant.' },
    { emoji: '😢', text: 'les émotions font partie de la vie.' },
    { emoji: '🤯', text: 'respire profondément, ça ira.' },
    { emoji: '😂', text: 'le rire est contagieux!' },
    { emoji: '🤗', text: 'un câlin virtuel pour toi.' },
    { emoji: '🌀', text: 'prends le temps de clarifier tes idées.' },
    { emoji: '🌿', text: 'reconnecte-toi avec le vert.' },
    { emoji: '🕊️', text: 'calme ton esprit et respire.' },
    { emoji: '🏃‍♂️', text: 'bouge et sent-toi vivant!' },
    { emoji: '🎶', text: 'laisse la musique guider ton humeur.' },
    { emoji: '📚', text: 'plonge toi dans tes passions.' },
    { emoji: '🎨', text: 'exprime-toi avec des couleurs.' },
    { emoji: '💡', text: 'une idée peut tout changer.' },
    { emoji: '🛌', text: 'prends un moment pour toi.' },
    { emoji: '💪', text: 't\'es plus fort que tu ne le pense.' },
    { emoji: '🌻', text: 'souris, même pour un instant!' },
    { emoji: '🍁', text: 'les saisons rappellent le changement.' },
    { emoji: '🌌', text: 'contemple l\'univers et rêve.' },
    { emoji: '🕹️', text: 'amuse-toi un peu!' },
    { emoji: '💭', text: 'pense à ce qui compte vraiment.' },
    { emoji: '🌟', text: 'les petites choses sont magiques.' },
    { emoji: '🌪️', text: 'accepte l\'imprévu.' },
    { emoji: '🧘‍♀️', text: 'respire, tout est sous contrôle.' },
    { emoji: '🥳', text: 'célébre les petits moments!' },
    { emoji: '💔', text: 'les émotions sont valides.' },
    { emoji: '🤩', text: 'aujourd\'hui promet quelque chose de grand!' },
    { emoji: '🛶', text: 'pars à la découverte du monde.' },
    { emoji: '🖤', text: 'prends un moment pour te recentrer.' },
    { emoji: '🍀', text: 'un peu de chance ne fait jamais de mal.' },
    { emoji: '💎', text: 'brille avec confiance.' },
    { emoji: '🌐', text: 'rapproche-toi des autres.' },
    { emoji: '🍕', text: 'un petit plaisir pour se sentir bien.' },
    { emoji: '🦋', text: 'chaque jour est une nouvelle chance.' },
    { emoji: '📸', text: 'capture les moments précieux.' },
    { emoji: '🌅', text: 'demain est un nouveau départ.' },
    { emoji: '🧩', text: 'explore, apprends, découvre.' },
    { emoji: '🥰', text: 'remercie pour ce que tu as.' },
    { emoji: '🛡️', text: 'prends soin de toi et de tes proches.' },
    { emoji: '⚓', text: 'reste ancré dans le présent.' },
    { emoji: '🌺', text: 'apprécie la beauté autour de toi.' },
    { emoji: '🦄', text: 'crois en l\'impossible!' },
    { emoji: '🛍️', text: 'un petit plaisir pour soi-même.' },
    { emoji: '🗻', text: 'releve de nouveaux défis.' },
    { emoji: '🧸', text: 'prends soin de ton cœur.' },
    { emoji: '🎯', text: 'focalise-toi sur ce qui compte.' },
    { emoji: '🚀', text: 'vise haut et atteint tes rêves.' },
    { emoji: '🎉', text: 'fête chaque victoire, petite ou grande.' },
    { emoji: '🥺', text: 'c\'est ok de montrer tes émotions.' },
    { emoji: '🪁', text: 'laisse tes soucis t\'envoler.' },
    { emoji: '🏖️', text: 'un moment pour respirer et se relaxer.' },
    { emoji: '🌪️', text: 'tout peut changer rapidement, reste calme.' },
    { emoji: '🕵️‍♂️', text: 'explore ce qui t\'intrigue.' },
    { emoji: '🪄', text: 'cherche la magie dans les petits gestes.' },
    { emoji: '🌼', text: 'un souffle de nouveauté et d\'énergie.' },
    { emoji: '💃', text: 'bouge pour libérer tes émotions.' },
    { emoji: '🛶', text: 'pars à la découverte de nouvelles expériences.' },
    { emoji: '🍩', text: 'un petit plaisir pour se remonter le moral.' },
    { emoji: '🎈', text: 'rappelle-toi des joies simples.' },
    { emoji: '🧩', text: 'résous tes problèmes étape par étape.' },
    { emoji: '🌙', text: 'la nuit aide à apaiser l’esprit.' },
    { emoji: '💭', text: 'laisse ton esprit vagabonder librement.' },
    { emoji: '📖', text: 'apprends quelque chose de nouveau aujourd’hui.' },
    { emoji: '💫', text: 'même les petites lueurs comptent.' },
    { emoji: '🛡️', text: 'protége tes limites et tes proches.' },
    { emoji: '🌺', text: 'fleuris malgré les obstacles.' },
    { emoji: '🦋', text: 'change et évolue à ton rythme.' },
    { emoji: '🧸', text: 'un moment pour se sentir en sécurité.' },
    { emoji: '🏔️', text: 'chaque sommet est atteignable avec patience.' },
    { emoji: '🥂', text: 'célébre tes accomplissements.' },
    { emoji: '🎭', text: 'exprime tes émotions sans retenue.' },
    { emoji: '💡', text: 'une étincelle peut changer la journée.' },
    { emoji: '📸', text: 'capture tes moments précieux.' },
    { emoji: '🧘‍♂️', text: 'respire et trouvez l’équilibre.' },
    { emoji: '🚴‍♀️', text: 'bouge pour recharger tes batteries.' },
    { emoji: '🌌', text: 'laisse le ciel étoilé te guider.' },
    { emoji: '🤝', text: 'soutiens et sois soutenu.' },
    { emoji: '📬', text: 'partage tes pensées avec les autres.' },
    { emoji: '⚡', text: 'laisse l’énergie te guider.' },
    { emoji: '🥳', text: 'fais la fête pour toi-même!' },
    { emoji: '🤔', text: 'prends le temps d’analyser calmement.' },
    { emoji: '🪁', text: 'laisse ton esprit s’envoler.' },
    { emoji: '🏖️', text: 'change d’air, même mentalement.' },
    { emoji: '🎶', text: 'laisse les sons guider tes émotions.' },
    { emoji: '🥰', text: 'remercie pour ce que tu as aujourd\’hui.' },
    { emoji: '😇', text: 'fais du bien autour de toi.' },
    { emoji: '😤', text: 'ne lâche rien, persévère!' },
    { emoji: '🧚‍♀️', text: 'crois aux merveilles du quotidien.' },
    { emoji: '💌', text: 'envoie un mot doux à quelqu’un.' },
    { emoji: '🪞', text: 'regarde à l’intérieur pour mieux avancer.' },
    { emoji: '🎬', text: 'plonge dans une autre réalité.' },
    { emoji: '📍', text: 'reste concentré sur tes objectifs.' },
    { emoji: '🛶', text: 'découvre de nouveaux horizons.' },
    { emoji: '💎', text: 'sois fier de ce que tu es.' },
    { emoji: '🌈', text: 'cheche le bon côté des choses.' },
    { emoji: '🦸‍♀️', text: 'chaque action compte, sois ton héros.' },
    { emoji: '🌿', text: 'respire l’air frais et détends-toi.' },
    { emoji: '📅', text: 'planifie pour mieux avancer.' },
    { emoji: '🗺️', text: 'Chaque jour est un nouveau voyage.' },
    { emoji: '🎨', text: 'exprime tes émotions avec créativité.' },
    { emoji: '🕊️', text: 'trouve la sérénité malgré le chaos.' },
    { emoji: '🏹', text: 'vise juste et atteint tes buts.' },
    { emoji: '🛍️', text: 'offre-toi un petit bonheur.' },
    { emoji: '🧗‍♂️', text: 'releve des défis pour grandir.' },
    { emoji: '🌟', text: 'admire les beautés autour de toi.' },
    { emoji: '🥗', text: 'prends soin de ton corps.' },
    { emoji: '🕹️', text: 'amuse-toi et détends-toi.' },
    { emoji: '🛌', text: 'un moment pour récupérer et recharger.' },
    { emoji: '🌅', text: 'chaque jour apporte une nouvelle chance.' }
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
    _watchFeedChanges();
    _injectMoodOfDay();
    _initViewCounter();
    _initInfiniteScroll();
    _injectColorPresets();
    _initDraftAutosave();
    _initFocusMode();
    _initMentions();
    _restoreDraft();
}

// ─── Sélecteur Feed: Posts / Stories ─────────────────────
function _initFeedSelector() {
    const feedSelector = document.getElementById('feed-selector');
    const storiesContainer = document.getElementById('stories-container');
    const postsContainer = document.getElementById('posts-container');
    const buttons = feedSelector ? Array.from(feedSelector.querySelectorAll('.sort-btn')) : [];
    const indicator = feedSelector ? feedSelector.querySelector('.feed-selector__indicator') : null;
    const postBtn = document.querySelector('.sort-btn[data-feed="posts"]');


    if (!feedSelector || !buttons.length || !indicator) return;

    const updateIndicator = () => {
        const activeBtn = feedSelector.querySelector('.sort-btn.active');

        if (!activeBtn) return;

        const left = activeBtn.offsetLeft + 25;
        const width = Math.max(activeBtn.offsetWidth - 50, 16);

        indicator.style.left = `${left}px`;
        indicator.style.width = `${width}px`;
    };

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const feed = btn.dataset.feed;

            // Mettre à jour l'état actif du bouton
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateIndicator();

            // Afficher/masquer les containers
            if (feed === 'posts') {
                postsContainer.classList.remove('hidden');

                storiesContainer.classList.add('hidden');
            } else if (feed === 'stories') {
                storiesContainer.classList.remove('hidden');
                postsContainer.classList.add('hidden');
            }
        });
        postBtn.classList.add('active');
        updateIndicator();
    });

    updateIndicator();
    window.addEventListener('resize', updateIndicator);


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
            <p class="mood-today__date">${today}</p>
            <p class="mood-today__text">${mood.text}</p>
        </div>
        <button class="mood-today__share" title="partager mon mood">partage un post!</button>
        <button class="mood-today__close"  title="fermer" aria-label="fermer" style="color: white; background: rgba(255, 0, 0, 0.31); width: 40px; height: 40px; border-radius: 5px; display: flex; align-items: center; justify-content: center;">✕</button>
    `;

    wall.insertAdjacentElement('beforebegin', banner);

    // Bouton "partager"  → focus sur le créateur
    banner.querySelector('.mood-today__share').addEventListener('click', () => {
        const createBtn = document.getElementById('create');
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
            fetch(`${API}posts/${postId}/view`, {
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
        const res = await fetch(`${API}posts/${postId}`);
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
            const res = await fetch(`${API}posts?page=${_currentPage}&limit=20`);
            if (!res.ok) { _hasMore = false; return; }
            const posts = await res.json();

            if (!Array.isArray(posts) || posts.length === 0) {
                _hasMore = false;
                sentinel.innerHTML = '<p class="no-more">tu as tout vu! quelle performance! 🎉</p>';
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



//init 
export async function initV2() {

    // 1. Améliorations du créateur de post
    initCreatorExtras();

    // 2. Feed : tri, vue, mood du jour, infinite scroll
    initFeedExtras();

    // 5. Attacher réactions + commentaires à tous les posts existants
    document.querySelectorAll('.post[data-id]').forEach(postEl => {
        attachV2ToPost(postEl, postEl.dataset.id);
    });

    // 6. Observer les nouveaux posts ajoutés dynamiquement (SSE / repost)
    _observeNewPosts();
}

// ─── attachV2ToPost() : appelé dans displayMood() ─────────────
export function attachV2ToPost(postEl, postId) {
    if (!postEl || !postId) return;
    // Petit délai pour laisser le DOM se stabiliser
    requestAnimationFrame(() => {
        attachReactions(postEl, postId);
        // Couleur du post lue directement depuis le DOM (déjà posée par
        // displayMood via content.style.background = mood.color), pour
        // teinter dynamiquement la zone commentaires sans avoir à faire
        // remonter mood.color à travers tous les appelants d'attachV2ToPost.
        const postColor = postEl.querySelector('.post-content')?.style.background || null;
        attachComments(postEl, postId, postColor);
    });
}

// ─── Observer les nouveaux posts (SSE / pagination) ──────────
function _observeNewPosts() {
    const wall = document.getElementById('moodWall');
    if (!wall) return;

    new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                if (node.classList?.contains('post') && node.dataset?.id) {
                    attachV2ToPost(node, node.dataset.id);
                }
                // Au cas où le post est enveloppé dans un div
                node.querySelectorAll?.('.post[data-id]').forEach(p => {
                    attachV2ToPost(p, p.dataset.id);
                });
            });
        });
    }).observe(wall, { childList: true, subtree: false });
}



async function _getCurrentUserId() {
    try {
        const token = localStorage.getItem('oifeel_token');
        if (!token) return null;
        const res = await fetch('https://moodshare-7dd7.onrender.com/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include'
        });
        if (res.ok) {
            const data = await res.json();
            return (data.user || data)?.id || (data.user || data)?._id || null;
        }
    } catch { }
    return null;
}


//lang picker

// scripts/lang-picker.js

// helper: mapping couleurs / gradients par code (simplifié — tu peux compléter)
const flagBackgrounds = {
    "fr": "linear-gradient(90deg,#0055A4,#EDF0F6, #C8102E)",
    "en": "linear-gradient(45deg,#012169,#C8102E, #EDF0F6)",
    "es": "linear-gradient(180deg,#C60B1E,#F1BF00, #C60B1E)",
    "de": "linear-gradient(180deg,#000,#DD0000, #F1BF00)",
    "it": "linear-gradient(90deg,#008C45,#F4F4F4, #C8102E)"
};

const manifestUrl = "/app/lang/manifest.json"; // must exist

async function loadLanguagesFromManifest() {
    try {
        const res = await fetch(manifestUrl, { cache: "no-cache" });
        if (!res.ok) throw new Error("manifest fetch error " + res.status);
        const data = await res.json();
        return data.languages || [];
    } catch (e) {
        console.error("lang manifest load error:", e);
        return [];
    }
}

function createItem(lang) {
    const div = document.createElement("div");
    div.className = "lp-item";
    div.dataset.code = lang.code;

    // flag container
    const flag = document.createElement("div");
    flag.className = "flag";
    flag.textContent = lang.flag || "🌐";

    // apply background gradient if mapping exists
    const bg = flagBackgrounds[lang.code] || flagBackgrounds[lang.code.split("-")[0]] || flagBackgrounds.default;
    flag.style.background = bg;

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = lang.name || lang.code;

    div.appendChild(flag);
    div.appendChild(label);
    return div;
}

async function initLangPicker() {
    const select = document.getElementById("languageSelect");
    if (!select) return;

    const langs = await loadLanguagesFromManifest();
    const current = localStorage.getItem("lang") || "fr";

    select.innerHTML = "";
    langs.forEach(lang => {
        const option = document.createElement("option");
        option.value = lang.code;
        option.textContent = `${lang.name || lang.code} ${lang.flag || "🌐"}`;
        select.appendChild(option);
    });

    const fallback = langs.some(lang => lang.code === current) ? current : "fr";
    select.value = fallback;

    select.addEventListener("change", async () => {
        const code = select.value;
        if (!code) return;
        localStorage.setItem("lang", code);
        await loadLanguage(code);
    });

    await loadLanguage(fallback);
}

// auto-init on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    initLangPicker().catch(err => console.error(err));
});

// lang

export let currentTranslations = {}; // <-- ajout

export async function loadLanguage(lang) {

    // 🔥 mémorisation automatique
    if (!lang) {
        lang = localStorage.getItem("lang") || "fr";
    } else {
        localStorage.setItem("lang", lang);
    }

    const res = await fetch(`/app/lang/${lang}.json`);
    const translations = await res.json();

    // set HTML lang attribute so les librairies et screen readers savent la langue
    document.documentElement.lang = lang;

    // Support both text and HTML injections
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.dataset.i18n;
        if (translations[key]) {
            el.textContent = translations[key];
        }
    });

    // new: allow HTML content keys (e.g. for links/buttons)
    document.querySelectorAll("[data-i18n-html]").forEach(el => {
        const key = el.dataset.i18nHtml;
        if (translations[key]) {
            el.textContent = translations[key];
        }
    });

    // cache global pour réutilisation côté app.js (évite fetch répétés)
    currentTranslations = translations;
    window.__translations__ = translations;

    // 🔥 Renvoie les traductions pour les appels dans app.js
    return translations;
}

// Fonction utilitaire pour traduire une clé
// Traduction avec variables : t("key", {var1: "..."} )
export function t(key, vars = {}) {
    let text = currentTranslations[key] || key;

    Object.keys(vars).forEach(k => {
        text = text.replace(`{${k}}`, vars[k]);
    });

    return text;
}


// messages

const MESSAGE_CACHE_KEY = 'oifeel_messages_cache';

// ─── Cache local ─────────────────────────────────────────────
function getCached() {
    try { return JSON.parse(sessionStorage.getItem(MESSAGE_CACHE_KEY) || '{}'); } catch { return {}; }
}
function setCached(convId, messages) {
    try {
        const c = getCached(); c[convId] = messages;
        sessionStorage.setItem(MESSAGE_CACHE_KEY, JSON.stringify(c));
    } catch (e) { console.error('Cache error:', e); }
}



function updateBadge() {
    const badge = document.getElementById('messagesBadge');
    if (!badge) return;
    badge.textContent = unreadMessages > 0 ? unreadMessages : '';
    badge.style.display = unreadMessages > 0 ? 'inline-block' : 'none';
}
function clearBadge() { unreadMessages = 0; updateBadge(); }

// ─── Init E2E avec retry ──────────────────────────────────────
async function _initE2E(userId) {
    try {
        const { privateKey, publicKeyB64 } = await ensureKeyPair(userId);
        _myPrivateKey = privateKey;
        _myPublicKeyB64 = publicKeyB64;

        // Vérifier si notre clé est déjà sur le serveur
        const existing = await fetchPublicKey(userId);
        if (existing) {
            _e2eReady = true;
            return;
        }

        // Pas encore enregistrée → tenter l'enregistrement
        const ok = await registerPublicKey(publicKeyB64, 5);
        _e2eReady = ok;

        if (ok) {
            // Invalider le cache pour forcer re-fetch au prochain accès
            invalidatePubKeyCache(userId);
        } else {
            // Réessayer en arrière-plan dans 30s
            setTimeout(() => _retryE2ERegistration(userId, publicKeyB64), 30_000);
        }
    } catch (err) {
        console.error('❌ E2E init error:', err);
    }
}

async function _retryE2ERegistration(userId, publicKeyB64) {
    if (_e2eReady) return;
    const ok = await registerPublicKey(publicKeyB64, 3);
    if (ok) {
        _e2eReady = true;
        invalidatePubKeyCache(userId);
        // Mettre à jour le badge dans la conv ouverte
        if (currentConversation) _showE2EBadge(currentConversation.otherUserId);
    } else {
        setTimeout(() => _retryE2ERegistration(userId, publicKeyB64), 60_000);
    }
}

// ─── Init messages ────────────────────────────────────────────
async function initMessages() {
    const user = await getCurrentUser();
    if (!user) { return; }

    currentUserId = user.id;
    if (window._messagesInitialized) return;
    window._messagesInitialized = true;

    // Init E2E (non bloquant)
    _initE2E(currentUserId);

    // SSE pour messages temps réel
    try {
        const es = new EventSource(`${API}stream`, { withCredentials: true });
        es.addEventListener('new_message', async (e) => {
            try {
                const data = JSON.parse(e.data);
                const { conversationId, message, participants } = data;
                if (!participants?.includes(currentUserId)) return;
                if (message.senderId === currentUserId) return;

                const otherUserId = participants.find(id => id !== currentUserId);
                const decrypted = await _tryDecrypt(message, conversationId, otherUserId);
                const displayMsg = { ...message, content: decrypted ?? message.content, _wasEncrypted: !!decrypted };

                const cache = getCached();
                const msgs = cache[conversationId] || [];
                msgs.push(displayMsg);
                setCached(conversationId, msgs);

                const openConvId = currentConversation
                    ? [currentUserId, currentConversation.otherUserId].sort().join('_')
                    : null;

                if (openConvId === conversationId) {
                    renderMessages(msgs);
                } else {
                    unreadMessages++;
                    updateBadge();
                    if (typeof showFeedback === 'function') {
                        showFeedback('info', `Nouveau message de ${message.senderName}`);
                    }
                }
                loadConversations();
            } catch (err) { console.warn('Invalid new_message event', err); }
        });
    } catch (err) { console.warn('SSE for messages failed', err); }

    injectMessagingUI();
}

document.addEventListener('userLoggedIn', initMessages);
document.addEventListener('DOMContentLoaded', () => setTimeout(initMessages, 500));

// ─── UI injection ─────────────────────────────────────────────
function injectMessagingUI() {
    const container = document.getElementById('messagesdiv') || document.getElementById('profileTab');
    const messagesSection = document.getElementById('messages-section');
    if (container && messagesSection) container.appendChild(messagesSection);

    const navLink = document.getElementById('messagesTab');
    if (navLink && !document.getElementById('messagesBadge')) {
        const badge = document.createElement('span');
        badge.id = 'messagesBadge'; badge.className = 'nav-badge'; badge.style.display = 'none';
        navLink.appendChild(badge);
        navLink.addEventListener('click', clearBadge);
    }

    createUserSearchModal();
    // createStickerPicker();
    // injectStickerButton();
    loadConversations();

    document.getElementById('send-message-btn')?.addEventListener('click', sendMessage);
    document.getElementById('message-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    document.getElementById('back-to-list')?.addEventListener('click', closeThread);
    document.getElementById('new-conversation-btn')?.addEventListener('click', openUserSearch);
}

// ─── User search ──────────────────────────────────────────────
function createUserSearchModal() {
    if (document.getElementById('user-search-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'user-search-modal'; modal.className = 'modal-overlay'; modal.style.display = 'none';
    modal.innerHTML = `
    <div class="modal-panel user-search-panel">
      <div class="modal-header">
        <h3>Nouvelle conversation</h3>
        <button class="modal-close" id="close-user-search">×</button>
      </div>
      <div class="search-input-wrap">
        <input type="text" id="user-search-input" placeholder="rechercher un utilisateur..." autofocus />
      </div>
      <div id="user-search-results"></div>
    </div>`;
    document.body.appendChild(modal);

    document.getElementById('close-user-search').addEventListener('click', closeUserSearch);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeUserSearch(); });

    let st;
    document.getElementById('user-search-input').addEventListener('input', (e) => {
        clearTimeout(st);
        st = setTimeout(() => searchUsers(e.target.value), 300);
    });
}

function openUserSearch() {
    const m = document.getElementById('user-search-modal');
    if (m) { m.style.display = 'flex'; document.getElementById('user-search-input').focus(); }
}





function closeUserSearch() {
    const m = document.getElementById('user-search-modal');
    if (m) {
        m.style.display = 'none';
        document.getElementById('user-search-input').value = '';
        document.getElementById('user-search-results').innerHTML = '';
    }
}

async function searchUsers(query) {
    if (!query || query.length < 2) {
        document.getElementById('user-search-results').innerHTML = '';
        return;
    }
    try {
        const res = await fetchWithAuth(`users/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) return;
        const users = await res.json();
        const results = document.getElementById('user-search-results');
        results.innerHTML = '';
        if (!users.length) { results.innerHTML = '<div class="search-empty">Aucun utilisateur trouvé</div>'; return; }
        users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'user-search-item';
            div.innerHTML = `
                <div class="user-avatar">${user.displayName[0].toUpperCase()}</div>
                <div class="user-info"><div class="user-name">${user.displayName}</div></div>
                <button class="btn-start-chat">message</button>`;
            div.querySelector('.btn-start-chat').addEventListener('click', () => {
                closeUserSearch();
                openConversation(user._id, user.displayName);
            });
            results.appendChild(div);
        });
    } catch (err) { console.error('❌ Search users error:', err); }
}

// ─── Conversations ────────────────────────────────────────────
async function loadConversations() {
    try {
        const res = await fetchWithAuth('conversations');
        if (!res.ok) return;
        const conversations = await res.json();
        const list = document.getElementById('conversations-list');
        if (!list) return;
        list.innerHTML = '';

        if (!conversations.length) {
            list.innerHTML = '<p class="empty">Aucune conversation</p>';
            return;
        }

        for (const conv of conversations) {
            const otherUserId = conv.participants.find(id => id !== currentUserId);
            const otherName = conv.participantNames?.[otherUserId] || 'Utilisateur';
            const lastMsg = conv.messages?.[conv.messages.length - 1];

            let preview = 'Post partagé';
            if (lastMsg?.content) {
                if (lastMsg.encrypted) {
                    // Tenter déchiffrement pour la preview
                    const convId = [currentUserId, otherUserId].sort().join('_');
                    const plain = await _tryDecrypt(lastMsg, convId, otherUserId);
                    preview = plain ? plain.substring(0, 60) : '🔒 message chiffré';
                } else {
                    preview = lastMsg.content.substring(0, 60);
                }
            }

            const div = document.createElement('div');
            div.className = 'conversation-item';
            div.innerHTML = `
                <div class="conv-avatar">${otherName[0].toUpperCase()}</div>
                <div class="conv-info">
                    <div class="conv-name">${otherName}</div>
                    <div class="conv-preview">${preview}</div>
                </div>`;
            div.addEventListener('click', () => openConversation(otherUserId, otherName));
            list.appendChild(div);
        }
    } catch (err) { console.error('❌ Load conversations error:', err); }
}

// Afficher "non connecté" si pas de userId
if (!currentUserId) {
    const el = document.getElementById('conversations-list');
    if (el) el.innerHTML = '<p class="empty">tu n\'es pas connecté(e), connecte-toi afin de discuter!</p>';
}

async function openConversation(otherUserId, otherName) {
    currentConversation = { otherUserId, otherName };

    const messagesMain = document.querySelector('.messages-main');
    const messagesSidebar = document.querySelector('.messages-sidebar');

    document.getElementById('messages-empty').style.display = 'none';
    document.getElementById('messages-thread').style.display = 'flex';
    document.getElementById('current-chat-name').textContent = otherName;

    if (messagesMain) messagesMain.classList.add('active');
    if (messagesSidebar) messagesSidebar.classList.add('hidden');
    document.body.classList.add('messages-open');

    // Badge E2E (async, non bloquant)
    _showE2EBadge(otherUserId);

    const convId = [currentUserId, otherUserId].sort().join('_');
    const cache = getCached();
    if (cache[convId]) renderMessages(cache[convId]);

    try {
        const res = await fetchWithAuth(`conversations/${otherUserId}`);
        if (!res.ok) return;
        const conv = await res.json();
        const msgs = conv.messages || [];

        // Déchiffrer en parallèle
        const decryptedMsgs = await Promise.all(msgs.map(async (msg) => {
            if (!msg.content || msg.sharedPostId || !msg.encrypted) return msg;
            const plain = await _tryDecrypt(msg, convId, otherUserId);
            return { ...msg, content: plain ?? msg.content, _wasEncrypted: plain !== null };
        }));

        setCached(convId, decryptedMsgs);
        renderMessages(decryptedMsgs);
    } catch (err) { console.error('❌ Load conversation error:', err); }
}

// ─── Rendu des messages ───────────────────────────────────────
function renderMessages(messages) {
    const body = document.getElementById('messages-body');
    if (!body) return;
    body.innerHTML = '';

    messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = msg.senderId === currentUserId ? 'message message-sent' : 'message message-received';

        if (msg.sharedPostId) {
            div.innerHTML = `<div class="shared-post" data-post-id="${msg.sharedPostId}"><p>📌 Post partagé</p></div>`;
        } else {
            if (msg.content) {
                const p = document.createElement('p');
                p.textContent = msg.content;
                if (msg._wasEncrypted) {
                    const lock = document.createElement('span');
                    lock.textContent = ' 🔒';
                    lock.style.cssText = 'font-size:0.65em;opacity:0.5;';
                    p.appendChild(lock);
                }
                div.appendChild(p);
            }
            if (msg.stickerUrl) {
                const stickerImg = document.createElement('img');
                stickerImg.src = msg.stickerUrl;
                stickerImg.alt = 'Sticker';
                stickerImg.style.cssText = 'max-width:220px;max-height:180px;border-radius:5px;margin-top:10px;object-fit:contain;';
                div.appendChild(stickerImg);
            }
            if (!msg.content && !msg.stickerUrl) {
                const empty = document.createElement('p');
                empty.textContent = 'message vide';
                empty.style.opacity = '0.7';
                div.appendChild(empty);
            }
        }

        body.appendChild(div);
    });

    body.scrollTop = body.scrollHeight;
}

// ─── Envoi d'un message ───────────────────────────────────────
async function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    const stickerUrl = _selectedStickerUrl;
    if ((!content && !stickerUrl) || !currentConversation) return;

    const { otherUserId } = currentConversation;
    const convId = [currentUserId, otherUserId].sort().join('_');

    // Tenter chiffrement du texte uniquement
    let toSend = content;
    let isEncrypted = false;

    if (_myPrivateKey && _e2eReady && content) {
        try {
            const theirKey = await fetchPublicKey(otherUserId);
            if (theirKey) {
                const aesKey = await getSharedKey(_myPrivateKey, theirKey, convId);
                toSend = await encryptMessage(content, aesKey);
                isEncrypted = true;
            }
        } catch (err) {
            console.warn('⚠️  Chiffrement échoué, envoi en clair:', err.message);
        }
    }

    // Affichage optimiste (clair)
    const cache = getCached();
    const messages = cache[convId] || [];
    const newMsg = {
        senderId: currentUserId,
        senderName: 'Moi',
        content,
        stickerUrl: stickerUrl || null,
        _wasEncrypted: isEncrypted,
        timestamp: new Date().toISOString()
    };
    messages.push(newMsg);
    setCached(convId, messages);
    renderMessages(messages);
    input.value = '';

    // Envoi au serveur (payload chiffré)
    fetch(`${API}conversations/${otherUserId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: toSend, encrypted: isEncrypted, stickerUrl: stickerUrl || null })
    }).catch(err => console.error('Send error:', err));
}

function closeThread() {
    const messagesMain = document.querySelector('.messages-main');
    const messagesSidebar = document.querySelector('.messages-sidebar');
    document.getElementById('messages-thread').style.display = 'none';
    document.getElementById('messages-empty').style.display = 'flex';
    currentConversation = null;
    if (messagesMain) messagesMain.classList.remove('active');
    if (messagesSidebar) messagesSidebar.classList.remove('hidden');
    document.body.classList.remove('messages-open');
    document.getElementById('e2e-badge')?.remove();
}

// ─── Badge E2E ────────────────────────────────────────────────
async function _showE2EBadge(otherUserId) {
    document.getElementById('e2e-badge')?.remove();
    const header = document.getElementById('current-chat-name');
    if (!header) return;

    const badge = document.createElement('span');
    badge.id = 'e2e-badge';
    badge.style.cssText = `
        display:inline-flex;align-items:center;gap:4px;
        font-size:1rem;font-weight:700;letter-spacing:0.06em;
        padding:2px 8px;border-radius:5px;margin-left:10px;
        vertical-align:middle;cursor:default;`;

    const theirKey = _myPrivateKey && _e2eReady ? await fetchPublicKey(otherUserId) : null;

    if (_myPrivateKey && _e2eReady && theirKey) {
        badge.textContent = 'Conversation chiffrée';
        badge.style.background = 'rgba(16,185,129,0.15)';
        badge.style.color = '#10b981';
        badge.style.border = '1px solid rgba(16,185,129,0.3)';
        badge.title = 'La conversation et les messages sont cryptés de bout en bout.';
    } else {
        badge.textContent = _e2eReady ? 'Conversation non chiffrée' : 'E2E en attente...';
        badge.style.background = 'rgba(255,0,11,0.12)';
        badge.style.color = '#f50b0b';
        badge.style.border = '1px solid rgba(255,0,11,0.3)';
        badge.title = !_e2eReady
            ? 'Vos clés E2E sont en cours d\'enregistrement.'
            : 'Votre interlocuteur n\'a pas encore de clé E2E.';
    }

    header.insertAdjacentElement('afterend', badge);
}

// ─── Déchiffrement gracieux ───────────────────────────────────
async function _tryDecrypt(msg, convId, otherUserId) {
    if (!msg.content || !msg.encrypted || !_myPrivateKey) return null;
    try {
        // Toujours dériver la clé partagée avec l'AUTRE participant de la
        // conversation, jamais avec l'expéditeur du message : pour nos
        // propres messages envoyés, msg.senderId === currentUserId, ce qui
        // récupérait notre propre clé publique et calculait une clé AES
        // erronée (ECDH(moi, moi) != ECDH(moi, eux)). Cette mauvaise clé
        // était ensuite mise en cache sous le même convId, ce qui cassait
        // aussi le déchiffrement de tous les messages reçus dans la même
        // conversation.
        const theirKey = await fetchPublicKey(otherUserId);
        if (!theirKey) return null;
        const aesKey = await getSharedKey(_myPrivateKey, theirKey, convId);
        return await decryptMessage(msg.content, aesKey);
    } catch {
        return null;
    }
}

// ─── Partage de post ──────────────────────────────────────────
window.sharePostInMessage = async function (postId, otherUserId) {
    if (!currentUserId) { showFeedback('Connexion requise', 'error'); return; }
    try {
        const res = await fetch(`${API}conversations/${otherUserId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ sharedPostId: postId })
        });
        if (res.ok) showFeedback('success', 'Post partagé dans la conversation');
    } catch (err) { console.error('Share error:', err); }
};



// post-permalink

// ============================================================
// POINT D'ENTRÉE PRINCIPAL
// ============================================================

/**
 * À appeler UNE FOIS après que les posts sont chargés dans le DOM.
 * Gère le hash initial ET les changements de hash ultérieurs.
 */
export function initPermalinks() {
    // Lecture du hash à l'arrivée sur la page
    handleHash(window.location.hash);

    // Écoute les changements (retour arrière, navigation)
    window.addEventListener('hashchange', () => handleHash(window.location.hash));
}

// ============================================================
// LECTURE DU HASH
// ============================================================

function handleHash(hash) {
    if (!hash || !hash.startsWith('#post-')) return;

    const postId = hash.replace('#post-', '').trim();
    if (!postId) return;

    openPostModal(postId);
}

// ============================================================
// MODAL POST PERMALINK
// ============================================================

/**
 * Ouvre la modale d'un post.
 * Exporté pour être appelé au clic depuis displayMood() dans app.js.
 */
export async function openPostModal(postId) {
    // Évite les doublons
    if (document.getElementById('permalink-modal')) return;

    // Chercher d'abord dans le DOM
    const postEl = document.querySelector(`.post[data-id="${postId}"]`);

    let mood = null;

    if (postEl) {
        // Extraire les données depuis le DOM existant
        mood = extractMoodFromEl(postEl, postId);
    } else {
        // Pas trouvé dans le DOM → fetch direct API
        try {
            const res = await fetch(`${API}posts/${postId}`);
            if (!res.ok) {
                showPermalinkError(postId);
                return;
            }
            mood = await res.json();
        } catch (err) {
            console.error('❌ Permalink fetch error:', err);
            showPermalinkError(postId);
            return;
        }
    }

    renderModal(mood, postId, postEl);
}

// ============================================================
// EXTRACTION DES DONNÉES DEPUIS LE DOM
// ============================================================

function extractMoodFromEl(postEl, postId) {
    const emoji = postEl.querySelector('.post-emoji')?.textContent || '';
    const text = postEl.querySelector('.post-text')?.textContent || '';
    const bg = postEl.querySelector('.post-content')?.style.background || '';
    const likeCount = postEl.querySelector('.like-count')?.textContent || '0';
    const dateText = postEl.querySelector('.postdate')?.textContent?.replace('créé le ', '') || '';
    const stickerSrc = postEl.querySelector('.post-sticker')?.src || null;
    const isEphemeral = postEl.classList.contains('ephemeral');

    return {
        id: postId,
        emoji,
        text,
        color: bg,
        likes: parseInt(likeCount, 10) || 0,
        createdAt: dateText,
        stickerUrl: stickerSrc,
        ephemeral: isEphemeral
    };
}

// ============================================================
// RENDU DU MODAL
// ============================================================

function renderModal(mood, postId, postEl) {
    const overlay = document.createElement('div');
    overlay.id = 'permalink-modal';


    const panel = document.createElement('div');
    panel.id = 'permalink-panel';



    // ---- Bouton fermer ----
    const closeBtn = document.createElement('button');
    closeBtn.id = 'permalink-close';
    closeBtn.innerHTML = '<p>✕</p>';


    // ---- Carte post ----
    const card = document.createElement('div');
    card.id = 'permalink-card';
    card.style.background = mood.color || '#222';

    // Calcul couleur texte auto
    const textColor = mood.textColor || getAutoTextColor(mood.color || '#222');

    if (mood.emoji) {
        const emojiEl = document.createElement('span');
        emojiEl.id = 'permalink-emoji';
        emojiEl.textContent = mood.emoji;
        emojiEl.style.color = textColor;
        card.appendChild(emojiEl);
    }

    if (mood.text) {
        const textEl = document.createElement('p');
        textEl.id = 'permalink-text';
        textEl.textContent = mood.text;
        textEl.style.color = textColor;
        card.appendChild(textEl);
    }

    if (mood.stickerUrl) {
        const stickerImg = document.createElement('img');
        stickerImg.id = 'permalink-sticker';
        stickerImg.src = mood.stickerUrl;
        stickerImg.alt = 'Sticker';
        card.appendChild(stickerImg);
    }

    if (mood.ephemeral) {
        const ephLabel = document.createElement('span');
        ephLabel.id = 'permalink-ephemeral';
        ephLabel.textContent = 'message éphémère';
        ephLabel.style.color = textColor;

        card.appendChild(ephLabel);
    }

    // ---- Métadonnées ----
    const meta = document.createElement('div');
    meta.id = 'permalink-meta';

    const likesBadge = document.createElement('span');
    likesBadge.id = 'permalink-likes';

    likesBadge.innerHTML = `${mood.likes || 0} like${(mood.likes || 0) !== 1 ? 's' : ''}`;

    const dateBadge = document.createElement('span');
    dateBadge.id = 'permalink-date';
    if (mood.createdAt) {
        // Si c'est déjà une string formatée (depuis DOM), l'afficher tel quel
        // Si c'est une date ISO (depuis API), la formatter
        let dateStr = mood.createdAt;
        if (dateStr.includes('T') || dateStr.includes('Z')) {
            dateStr = new Date(dateStr).toLocaleString('fr-FR', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        }
        dateBadge.textContent = dateStr;
    }

    meta.appendChild(likesBadge);
    if (mood.createdAt) meta.appendChild(dateBadge);

    // ---- Actions ----
    const actions = document.createElement('div');
    actions.id = 'permalink-actions';

    // Bouton "voir dans le fil"
    const goToFeedBtn = document.createElement('button');
    goToFeedBtn.id = 'permalink-feed-btn';
    goToFeedBtn.textContent = 'voir dans le fil';
    goToFeedBtn.addEventListener('click', () => {
        closeModal(overlay);
        // Activer l'onglet Home si nécessaire
        const home = document.getElementById('home');
        if (home) home.click();

        // Scroll vers le post avec un léger délai
        setTimeout(() => {
            const target = document.querySelector(`.post[data-id="${postId}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Flash highlight
                target.style.transition = 'box-shadow 0.3s';
                target.style.boxShadow = '0 0 0 13px #d31313, 0 0 20px rgba(255, 13, 106, 0.4)';
                setTimeout(() => { target.style.boxShadow = ''; }, 2200);
            }
        }, 300);
    });

    // Bouton "copier le lien"
    const copyBtn = document.createElement('button');
    copyBtn.id = 'permalink-copy-btn';
    copyBtn.textContent = 'copier le lien';
    copyBtn.addEventListener('click', async () => {
        const url = `${location.origin}${location.pathname}#post-${postId}`;
        try {
            await navigator.clipboard.writeText(url);
            copyBtn.textContent = 'copié!';
            setTimeout(() => copyBtn.textContent = 'copier le lien', 2000);
        } catch {
            prompt('copie ce lien :', url);
        }
    });

    actions.appendChild(goToFeedBtn);
    actions.appendChild(copyBtn);

    // ---- Commentaires ----
    // On réutilise le même moteur que le fil principal (attachComments),
    // teinté avec la couleur du post pour rester cohérent avec la carte
    // au-dessus. postEl ici est le panel lui-même : attachComments y
    // cherche .post-actions/.buttons (absents) et se rabat sur un simple
    // appendChild en fin de panel, ce qui convient pour la modale.
    const commentsHost = document.createElement('div');
    commentsHost.className = 'permalink-comments-host';
    panel.appendChild(commentsHost);

    // ---- Assembly ----
    panel.appendChild(closeBtn);
    panel.appendChild(card);
    panel.appendChild(meta);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    attachComments(commentsHost, postId, mood.color);
    // Dans la modale, les commentaires doivent être visibles directement
    // (pas de toggle caché) : on ouvre la section et on masque le bouton
    // toggle qui n'a pas sa place ici (pas de barre d'actions post-style).
    requestAnimationFrame(() => {
        const toggleBtn = commentsHost.querySelector('.ctoggle');
        const section = commentsHost.querySelector('.csection');
        if (toggleBtn) toggleBtn.style.display = 'none';
        if (section) {
            section.style.display = 'block';
            section.classList.add('csection--modal');
        }
    });

    // ---- Fermeture ----
    function close() { closeModal(overlay); }

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
}

// ============================================================
// FERMETURE MODALE + NETTOYAGE HASH
// ============================================================

function closeModal(overlay) {
    overlay.style.animation = 'plFadeOut 0.2s ease forwards';
    setTimeout(() => {
        overlay.remove();
        // Retirer le hash sans recharger la page
        history.replaceState(null, '', location.pathname + location.search);
    }, 200);
}

// ============================================================
// ERREUR : post introuvable
// ============================================================

function showPermalinkError(postId) {
    const overlay = document.createElement('div');
    overlay.id = 'permalink-modal';


    const panel = document.createElement('div');
    panel.id = 'permalink-error-panel';

    panel.innerHTML = `
        <div style="font-size:3rem;margin-bottom:16px">🔍</div>
        <h3 style="margin:0 0 8px;font-size:1.2rem">Post introuvable</h3>
        <p style="color:#888;margin:0 0 24px;font-size:0.9rem">
            Ce post n'existe plus ou le lien est invalide.
        </p>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Fermer';
    closeBtn.style.cssText = btnStyle('linear-gradient(135deg,#667eea,#764ba2)', '#fff');
    closeBtn.addEventListener('click', () => closeModal(overlay));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });

    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
}



// ============================================================
// UTILITAIRES
// ============================================================

function getAutoTextColor(hexOrColor) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = hexOrColor;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128 ? '#1a1a1a' : '#ffffff';
    } catch {
        return '#ffffff';
    }
}

function btnStyle(bg, color, border = 'none') {
    return `
        border: ${border};
        background: ${bg};
        color: ${color};
    `;
}

// profile
export async function getProfile(id) {
    const res = await fetch(`${API}users/${id}`);
    if (!res.ok) throw new Error('Profile not found');
    return res.json();
}

export async function updateProfile(id, patch) {
    const res = await fetchWithAuth(`${API}users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    });
    if (!res.ok) throw new Error('Update failed');
    return res.json();
}

// reaction
export const REACTIONS = [
    { type: 'heart', emoji: '❤️', label: "j'aime" },
    { type: 'haha', emoji: '😂', label: 'Haha' },
    { type: 'wow', emoji: '😮', label: 'Wow' },
    { type: 'sad', emoji: '😢', label: 'Triste' },
    { type: 'fire', emoji: '🔥', label: 'Feu' },
    { type: 'clap', emoji: '👏', label: 'Bravo' },


];

// ─── Point d'entrée ──────────────────────────────────────────
export function attachReactions(postEl, postId) {
    const likeBtn = postEl.querySelector('.likebtn');
    if (!likeBtn || postEl.dataset.reactionsAttached) return;
    postEl.dataset.reactionsAttached = 'true';

    // Wrapper autour du bouton like
    const wrapper = document.createElement('div');
    wrapper.className = 'rwrapper';
    likeBtn.parentNode.insertBefore(wrapper, likeBtn);
    wrapper.appendChild(likeBtn);

    // Popup réactions
    const popup = document.createElement('div');
    popup.className = 'rpopup';
    popup.setAttribute('role', 'tooltip');
    popup.innerHTML = REACTIONS.map(r =>
        `<button class="rbtn" data-type="${r.type}" title="${r.label}" aria-label="${r.label}">
            <span class="remoji">${r.emoji}</span>
            <span class="rlabel">${r.label}</span>
         </button>`
    ).join('');
    wrapper.appendChild(popup);

    // Barre de compteurs sous le like
    const bar = document.createElement('div');
    bar.className = 'rbar';
    bar.dataset.pid = postId;
    likeBtn.insertAdjacentElement('afterend', bar);

    // Charger les réactions existantes
    _loadReactions(postId, bar);

    // ─── Affichage popup ────────────────────────────────────
    let hideTimer;
    const show = () => { clearTimeout(hideTimer); popup.classList.add('rvisible'); };
    const hide = (delay = 280) => { hideTimer = setTimeout(() => popup.classList.remove('rvisible'), delay); };

    wrapper.addEventListener('mouseenter', show);
    wrapper.addEventListener('mouseleave', () => hide());
    popup.addEventListener('mouseenter', show);
    popup.addEventListener('mouseleave', () => hide());

    // Long press mobile
    let pressTimer;
    likeBtn.addEventListener('touchstart', (e) => {
        pressTimer = setTimeout(() => { e.preventDefault(); show(); }, 400);
    }, { passive: false });
    likeBtn.addEventListener('touchend', () => clearTimeout(pressTimer));

    // Tap rapide = reaction "heart" par défaut (comportement like classique)
    likeBtn.addEventListener('click', (e) => {
        if (popup.classList.contains('rvisible')) return;
        _handleReaction(postId, 'heart', bar, postEl);
    });

    // Clic sur une réaction
    popup.querySelectorAll('.rbtn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            hide(0);
            _handleReaction(postId, btn.dataset.type, bar, postEl);
        });
    });

    // Restaurer réaction locale
    const myReaction = _getMyReaction(postId);
    if (myReaction) _applyReactionToBtn(likeBtn, myReaction);
}

// ─── Toggle réaction ─────────────────────────────────────────
async function _handleReaction(postId, type, bar, postEl) {
    const likeBtn = postEl.querySelector('.likebtn');
    const current = _getMyReaction(postId);
    const removing = current === type;

    // Mise à jour locale optimiste
    if (removing) {
        _setMyReaction(postId, null);
        _resetBtn(likeBtn);
        _adjustLocalCount(postId, type, -1);
    } else {
        if (current) _adjustLocalCount(postId, current, -1);
        _setMyReaction(postId, type);
        _applyReactionToBtn(likeBtn, type);
        _adjustLocalCount(postId, type, +1);

        // Animation pop
        likeBtn.classList.add('rpop');
        setTimeout(() => likeBtn.classList.remove('rpop'), 400);
    }

    // Mettre à jour la barre localement
    _renderBar(bar, _getLocalCounts(postId));

    // Appel API (gracieux)
    try {
        const url = removing
            ? `${API}posts/${postId}/unreact`
            : `${API}posts/${postId}/react`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ type })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.reactions) _renderBar(bar, data.reactions);
        }
    } catch (_) { /* API indisponible — localStorage suffit */ }
}

// ─── Chargement depuis API ───────────────────────────────────
async function _loadReactions(postId, bar) {
    try {
        const res = await fetch(`${API}posts/${postId}/reactions`);
        if (res.ok) {
            const data = await res.json();
            if (data.reactions && Object.keys(data.reactions).length > 0) {
                _setLocalCounts(postId, data.reactions);
                _renderBar(bar, data.reactions);
                return;
            }
        }
    } catch (_) { }
    // Fallback localStorage
    const local = _getLocalCounts(postId);
    if (Object.keys(local).length) _renderBar(bar, local);
}

// ─── Rendu barre de compteurs ────────────────────────────────
function _renderBar(bar, reactions) {
    bar.innerHTML = '';
    const entries = REACTIONS.filter(r => (reactions[r.type] || 0) > 0);
    if (!entries.length) return;

    entries.forEach(r => {
        const chip = document.createElement('button');
        chip.className = 'rchip';
        chip.dataset.type = r.type;
        chip.innerHTML = `${r.emoji}<span>${reactions[r.type]}</span>`;
        bar.appendChild(chip);
    });
}

// ─── Visuel bouton like ──────────────────────────────────────
function _applyReactionToBtn(btn, type) {
    const r = REACTIONS.find(x => x.type === type);
    if (!r) return;
    btn.classList.add('liked', `ractive-${type}`);

    const svg = btn.querySelector('svg');
    if (svg) {
        if (!btn.dataset.svgBak) btn.dataset.svgBak = svg.outerHTML;
        const span = document.createElement('span');
        span.className = 'ractive-emoji';
        span.textContent = r.emoji;
        svg.replaceWith(span);
    }
}

function _resetBtn(btn) {
    btn.classList.remove('liked', ...REACTIONS.map(r => `ractive-${r.type}`));
    const span = btn.querySelector('.ractive-emoji');
    if (span && btn.dataset.svgBak) {
        const t = document.createElement('div');
        t.innerHTML = btn.dataset.svgBak;
        span.replaceWith(t.firstChild);
    }
}

// ─── Persistance locale ──────────────────────────────────────
function _getMyReaction(pid) {
    try { return JSON.parse(localStorage.getItem('my_reactions') || '{}')[pid] || null; }
    catch { return null; }
}
function _setMyReaction(pid, type) {
    try {
        const d = JSON.parse(localStorage.getItem('my_reactions') || '{}');
        if (type) d[pid] = type; else delete d[pid];
        localStorage.setItem('my_reactions', JSON.stringify(d));
    } catch { }
}
function _getLocalCounts(pid) {
    try { return JSON.parse(localStorage.getItem(`rc_${pid}`) || '{}'); }
    catch { return {}; }
}
function _setLocalCounts(pid, data) {
    try { localStorage.setItem(`rc_${pid}`, JSON.stringify(data)); } catch { }
}
function _adjustLocalCount(pid, type, delta) {
    const d = _getLocalCounts(pid);
    d[type] = Math.max(0, (d[type] || 0) + delta);
    _setLocalCounts(pid, d);
}

// social

export async function initSocial() {
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
        const token = localStorage.getItem('oifeel_token');
        if (!token) {
            return;
        }

        const res = await fetch(`${API}social/suggestions`, { credentials: 'include' });
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
        <h3>comptes que tu pourrais aimer</h3>
        <button class="banner-refresh" title="actualiser"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>
      </div>
      <div class="suggestions-list"></div>
    `;

        const list = banner.querySelector('.suggestions-list');

        if (!data.suggestions || data.suggestions.length === 0) {
            list.innerHTML = '<div class="no-suggestions">Aucun compte à recommander pour le moment.</div>';
        } else {
            // Afficher 10 suggestions max
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
        <button class="btn-follow-suggestion" data-user-id="${user._id}"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-plus-icon lucide-user-plus"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg> suivre</button>
      `;

                // Click sur la carte → profil
                card.addEventListener('click', (e) => {
                    if (!e.target.classList.contains('btn-follow-suggestion')) {
                        viewProfile(user._id);
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

// ============================================================
// PROFIL D'UN AUTRE UTILISATEUR (modale)
// ============================================================
let _profileViewTargetId = null;
let _profileViewIsFollowing = false;

function createProfileViewModal() {
    if (document.getElementById('profile-view-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'profile-view-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `
    <div class="modal-panel profile-view-panel" style="max-width:400px;width:100%">
      <div class="modal-header">
        <h3>Profil</h3>
        <button class="modal-close" id="close-profile-view">×</button>
      </div>
      <div style="padding:24px;text-align:center">
        <div id="profile-view-avatar" style="width:72px;height:72px;border-radius:50%;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 14px;overflow:hidden"></div>
        <div id="profile-view-name" style="font-size:18px;font-weight:700;margin-bottom:4px"></div>
        <div id="profile-view-bio" style="font-size:13px;color:#888;margin-bottom:18px;line-height:1.4"></div>
        <div style="display:flex;justify-content:center;gap:28px;margin-bottom:20px">
          <div><div id="profile-view-posts" style="font-weight:700;font-size:15px">0</div><div style="font-size:11px;color:#888">posts</div></div>
          <div><div id="profile-view-followers" style="font-weight:700;font-size:15px">0</div><div style="font-size:11px;color:#888">followers</div></div>
          <div><div id="profile-view-following" style="font-weight:700;font-size:15px">0</div><div style="font-size:11px;color:#888">suivis</div></div>
        </div>
        <button id="profile-view-follow-btn" style="display:none;width:100%;padding:11px;border-radius:9px;border:none;cursor:pointer;font-weight:600;font-size:14px"></button>
        <div id="profile-view-error" style="color:#e74c3c;font-size:12px;margin-top:10px;display:none"></div>
      </div>
    </div>`;
    document.body.appendChild(modal);

    document.getElementById('close-profile-view').addEventListener('click', closeProfileView);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeProfileView(); });
}

function closeProfileView() {
    const m = document.getElementById('profile-view-modal');
    if (m) m.style.display = 'none';
}

async function viewProfile(userId) {
    createProfileViewModal();
    const modal = document.getElementById('profile-view-modal');
    modal.style.display = 'flex';
    _profileViewTargetId = userId;

    // État "chargement"
    document.getElementById('profile-view-avatar').textContent = '👤';
    document.getElementById('profile-view-name').textContent = 'Chargement…';
    document.getElementById('profile-view-bio').textContent = '';
    document.getElementById('profile-view-posts').textContent = '0';
    document.getElementById('profile-view-followers').textContent = '0';
    document.getElementById('profile-view-following').textContent = '0';
    document.getElementById('profile-view-error').style.display = 'none';
    const btn = document.getElementById('profile-view-follow-btn');
    btn.style.display = 'none';

    try {
        const token = localStorage.getItem('oifeel_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${API}social/profile/${userId}`, { credentials: 'include', headers });
        if (!res.ok) throw new Error('Profil introuvable');
        const data = await res.json();
        const u = data.user || {};

        document.getElementById('profile-view-avatar').textContent =
            (u.avatar && u.avatar.length <= 4) ? u.avatar : (u.displayName?.charAt(0).toUpperCase() || '?');
        document.getElementById('profile-view-name').textContent = u.displayName || 'Utilisateur';
        document.getElementById('profile-view-bio').textContent = u.bio || '';
        document.getElementById('profile-view-posts').textContent = u.postsCount ?? (data.posts?.length || 0);
        document.getElementById('profile-view-followers').textContent = u.followersCount || 0;
        document.getElementById('profile-view-following').textContent = u.followingCount || 0;

        _profileViewIsFollowing = !!u.isFollowing;

        if (!u.isOwnProfile) {
            btn.style.display = 'block';
            _renderProfileFollowBtn(btn);
            btn.onclick = () => _toggleProfileViewFollow(btn);
        }
    } catch (err) {
        console.error('❌ Erreur chargement profil:', err);
        document.getElementById('profile-view-name').textContent = 'Erreur';
        const errEl = document.getElementById('profile-view-error');
        errEl.textContent = 'Impossible de charger ce profil.';
        errEl.style.display = 'block';
    }
}

function _renderProfileFollowBtn(btn) {
    if (_profileViewIsFollowing) {
        btn.textContent = '✓ Suivi(e)';
        btn.style.background = '#e2e8f0';
        btn.style.color = '#334155';
    } else {
        btn.textContent = '+ Suivre';
        btn.style.background = '#2563eb';
        btn.style.color = '#fff';
    }
}

async function _toggleProfileViewFollow(btn) {
    if (!_profileViewTargetId) return;
    const token = localStorage.getItem('oifeel_token');
    if (!token) { showFeedback('warning', 'not_logged_in'); return; }

    const action = _profileViewIsFollowing ? 'unfollow' : 'follow';
    btn.disabled = true;

    try {
        const res = await fetch(`${API}social/${action}/${_profileViewTargetId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Erreur');

        _profileViewIsFollowing = !_profileViewIsFollowing;
        document.getElementById('profile-view-followers').textContent = data.followersCount ?? 0;
        _renderProfileFollowBtn(btn);
        document.getElementById('profile-view-error').style.display = 'none';
    } catch (err) {
        console.error(`❌ Erreur ${action}:`, err);
        const errEl = document.getElementById('profile-view-error');
        errEl.textContent = err.message || 'Erreur réseau';
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
    }
}

async function handleQuickFollow(userId, btn, card) {
    try {
        const token = localStorage.getItem('oifeel_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const res = await fetch(`${API}social/follow/${userId}`, {
            method: 'POST',
            credentials: 'include',
            headers
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
        } else {
            const data = await res.json().catch(() => ({}));
            console.error('❌ Erreur follow:', data.error || res.status);
            showFeedback('warning', 'not_logged_in');
        }
    } catch (err) {
        console.error('❌ Erreur follow:', err);
        showFeedback('error', 'network_error');
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
// ============================================================

// CONSENTEMENT CGU

// Avant : le bouton "refuser" redirigeait directement vers

// google.com sans explication, et rien ne mémorisait l'acceptation

// (le bandeau pouvait réapparaître à chaque chargement).

// Maintenant : l'acceptation est mémorisée localement, et le refus

// explique la conséquence avant de proposer de quitter oifeel.

// (vers la page d'accueil du site, pas vers un site tiers).

// ============================================================

const TOS_STORAGE_KEY = 'oifeel_tos_accepted_v1';

const tosMsg = document.getElementById('TOSmsg');

const tosStepInfo = document.getElementById('TOSmsg-step-info');

const tosStepDecline = document.getElementById('TOSmsg-step-decline');

const agreeTOSBtn = document.getElementById('agreeTOS');

const refTOSBtn = document.getElementById('refTOS');

const backToTOSBtn = document.getElementById('backToTOS');



function hasAcceptedTOS() {

    try {

        return localStorage.getItem(TOS_STORAGE_KEY) === 'true';

    } catch (e) {

        // stockage indisponible (navigation privée, etc.) : on

        // réaffiche le bandeau par sécurité plutôt que de bloquer

        return false;

    }

}



function showTOSIfNeeded() {

    if (!tosMsg || hasAcceptedTOS()) return;

    tosMsg.removeAttribute('hidden');

}



if (agreeTOSBtn && tosMsg) {

    agreeTOSBtn.addEventListener('click', () => {

        try {

            localStorage.setItem(TOS_STORAGE_KEY, 'true');

        } catch (e) {

            // si le stockage échoue, on laisse passer pour cette session

        }

        tosMsg.setAttribute('hidden', '');

    });

}



if (refTOSBtn && tosStepInfo && tosStepDecline) {

    refTOSBtn.addEventListener('click', () => {

        // Au lieu de rediriger immédiatement, on explique la

        // conséquence du refus et on laisse le choix final à

        // l'utilisateur.

        tosStepInfo.setAttribute('hidden', '');

        tosStepDecline.removeAttribute('hidden');

    });

}



if (backToTOSBtn && tosStepInfo && tosStepDecline) {

    backToTOSBtn.addEventListener('click', () => {

        tosStepDecline.setAttribute('hidden', '');

        tosStepInfo.removeAttribute('hidden');

    });

}



showTOSIfNeeded();
// ============================================================
// 2FA — panneau de gestion dans les réglages du compte
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const statusRow = document.getElementById('twoFactorStatusRow');
    const statusText = document.getElementById('twoFactorStatusText');
    const manageBtn = document.getElementById('twoFactorManageBtn');
    const panel = document.getElementById('twoFactorPanel');
    const methodChoice = document.getElementById('twoFactorMethodChoice');
    const closeBtn = document.getElementById('twoFactorClosePanel');

    if (!statusRow || !panel) return; // markup absent (page pas encore chargée avec ce bloc)

    const totpSetup = document.getElementById('twofaTotpSetup');
    const totpQr = document.getElementById('twofaTotpQr');
    const totpSecretEl = document.getElementById('twofaTotpSecret');
    const totpCode = document.getElementById('twofaTotpCode');
    const totpError = document.getElementById('twofaTotpError');

    const emailSetup = document.getElementById('twofaEmailSetup');
    const emailInput = document.getElementById('twofaEmailInput');
    const emailCodeStep = document.getElementById('twofaEmailCodeStep');
    const emailCode = document.getElementById('twofaEmailCode');
    const emailError = document.getElementById('twofaEmailError');

    const disableSetup = document.getElementById('twofaDisableSetup');
    const disablePassword = document.getElementById('twofaDisablePassword');
    const disableError = document.getElementById('twofaDisableError');

    function hideAllSteps() {
        [methodChoice, totpSetup, emailSetup, disableSetup].forEach(el => el && el.classList.add('hidden'));
    }

    async function refreshStatus() {
        try {
            const status = await get2FAStatus();
            if (status.enabled) {
                const labels = { totp: 'appli d\'authentification', email: `email (${status.email || ''})` };
                statusText.textContent = `activé — ${labels[status.method] || status.method}`;
                manageBtn.textContent = 'gérer';
            } else {
                statusText.textContent = 'désactivé — recommandé pour sécuriser ton compte';
                manageBtn.textContent = 'activer';
            }
            return status;
        } catch (e) {
            statusText.textContent = 'connecte-toi pour gérer le 2FA';
            return null;
        }
    }
    refreshStatus();
    document.addEventListener('userLoggedIn', refreshStatus);

    manageBtn.addEventListener('click', async () => {
        const opening = panel.classList.contains('hidden');
        panel.classList.toggle('hidden');
        if (opening) {
            const status = await refreshStatus();
            hideAllSteps();
            if (status && status.enabled) {
                disableSetup.classList.remove('hidden');
            } else {
                methodChoice.classList.remove('hidden');
            }
        }
    });

    if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

    // Choix de méthode
    panel.querySelectorAll('.twofa-method-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const method = btn.dataset.method;
            hideAllSteps();
            try {
                if (method === 'totp') {
                    const { secret, qrCode } = await startTotpSetup();
                    totpQr.src = qrCode;
                    totpSecretEl.textContent = secret;
                    totpCode.value = '';
                    totpError.style.display = 'none';
                    totpSetup.classList.remove('hidden');
                } else if (method === 'email') {
                    emailInput.value = '';
                    emailCodeStep.classList.add('hidden');
                    emailSetup.classList.remove('hidden');
                }
            } catch (err) {
                showFeedback('error', err.message || 'Erreur réseau');
                methodChoice.classList.remove('hidden');
            }
        });
    });

    // TOTP
    document.getElementById('twofaTotpConfirm')?.addEventListener('click', async () => {
        try {
            totpError.style.display = 'none';
            await verifyTotpSetup(totpCode.value.trim());
            hideAllSteps();
            panel.classList.add('hidden');
            refreshStatus();
        } catch (err) {
            totpError.textContent = err.message;
            totpError.style.display = 'block';
        }
    });
    document.getElementById('twofaTotpCancel')?.addEventListener('click', () => { hideAllSteps(); methodChoice.classList.remove('hidden'); });

    // Email
    document.getElementById('twofaEmailSend')?.addEventListener('click', async () => {
        try {
            emailError.style.display = 'none';
            await startEmail2FA(emailInput.value.trim());
            emailCodeStep.classList.remove('hidden');
        } catch (err) {
            emailError.textContent = err.message;
            emailError.style.display = 'block';
        }
    });
    document.getElementById('twofaEmailConfirm')?.addEventListener('click', async () => {
        try {
            emailError.style.display = 'none';
            await verifyEmail2FA(emailCode.value.trim());
            hideAllSteps();
            panel.classList.add('hidden');
            refreshStatus();
        } catch (err) {
            emailError.textContent = err.message;
            emailError.style.display = 'block';
        }
    });
    document.getElementById('twofaEmailCancel')?.addEventListener('click', () => { hideAllSteps(); methodChoice.classList.remove('hidden'); });

    // Désactivation
    document.getElementById('twofaDisableConfirm')?.addEventListener('click', async () => {
        try {
            disableError.style.display = 'none';
            await disable2FA(disablePassword.value);
            disablePassword.value = '';
            hideAllSteps();
            panel.classList.add('hidden');
            refreshStatus();
        } catch (err) {
            disableError.textContent = err.message;
            disableError.style.display = 'block';
        }
    });
    document.getElementById('twofaDisableCancel')?.addEventListener('click', () => panel.classList.add('hidden'));
});