import { loadLanguage, t } from "./lang.js";
import { fetchWithAuth, getCurrentUser } from './auth.js';
import { initPermalinks, openPostModal } from './post-permalink.js';
import { initV2, attachV2ToPost } from './init.js';
import { getAnonymousFlag } from './creator-extras.js';
window.openPermalinkModal = openPostModal;


// Détection backend : local en dev, prod sinon
const API = "https://moodshare-7dd7.onrender.com/api";

async function checkMaintenanceMode() {
    try {
        const res = await fetch(`${API}/maintenance`, { cache: 'no-store' });
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

// --- Live updates via Server-Sent Events (SSE) ---
try {
    const streamUrl = `${API}/stream`;
    const es = new EventSource(streamUrl, { withCredentials: true });

    es.addEventListener('new_post', (e) => {
        try {
            const post = JSON.parse(e.data);
            // Avoid duplicates
            if (!document.querySelector(`.post[data-id="${post.id}"]`)) {
                displayMood(post);
            }
        } catch (err) { console.warn('Invalid new_post event', err); }
    });



    es.addEventListener('new_story', (e) => {
        try { const story = JSON.parse(e.data); addStoryToList(story); } catch (err) { console.warn('Invalid new_story event', err); }
    });

    es.addEventListener('stories_update', (e) => {
        try {
            const stories = JSON.parse(e.data);
            stories.forEach(s => addStoryToList(s)); // addStoryToList déduplique déjà
        } catch (err) { console.warn('Invalid stories_update event', err); }
    });

    // --- Notifications: Likes et Commentaires ---
    es.addEventListener('new_like', (e) => {
        try {
            const data = JSON.parse(e.data);
            showNotification('success', 'liked_post', { author: data.authorName || 'Quelqu\'un' });
        } catch (err) { console.warn('Invalid new_like event', err); }
    });

    es.addEventListener('new_comment', (e) => {
        try {
            const data = JSON.parse(e.data);
            showNotification('info', 'new_comment', { author: data.authorName || 'Quelqu\'un' });
        } catch (err) { console.warn('Invalid new_comment event', err); }
    });

    es.addEventListener('connected', (e) => { /* connected */ });
} catch (err) {
    console.warn('SSE not supported or failed to connect', err);
}

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

                // Tu peux réactiver après 5 minutes :
                setTimeout(() => {
                    moodInput.disabled = false;
                    securityStrike = 0;
                    localStorage.setItem("xss_strikes", "0");
                    showFeedback("info", "fb_xss_unblocked");
                }, 5 * 60 * 1000); // Ban de 5 minutes
            }
        }
    });

});

const nav = document.querySelector('nav');
const header = document.querySelector('header');
const profileheader = document.getElementById('accountheader');
const tabSections = document.querySelectorAll('section.tab');

// Chaque section scrollable doit déclencher l'effet de scroll du header
if (tabSections.length) {

    tabSections.forEach(section => {
        section.addEventListener('scroll', () => {
            const sortbar = document.getElementById('sort-bar');
            const sortbtn = document.querySelectorAll('#sort-bar .sort-btn');
            const currentScroll = section.scrollTop;
            if (currentScroll > 50) {
                header.classList.add('scrolled');
                profileheader.classList.add('scrolled');
                nav.classList.add('scrolled');
                sortbar.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
                profileheader.classList.remove('scrolled');
                nav.classList.remove('scrolled');
                sortbar.classList.remove('scrolled');
            }
        });
    });
}

profileheader.addEventListener("click", () => {
    document.getElementById("profilemenu").classList.toggle("show");
})

async function checkSiteVersion() {

    const siteVersion = document.getElementById("SiteVersion");
    const buildVersion = document.getElementById("BuildVersion");

    try {
        const res = await fetch('/app/version.json', {
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
        if (siteVersion) siteVersion.innerText = latest;
        if (buildVersion) buildVersion.innerText = latestBuild;


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

        console.log(`%c Version du site: ${latest} (${latestBuild})`, "color: blue; font-size: 16px;");
    } catch (error) {
        console.error('erreur lors de la vérification de la version du site:', error);
        showFeedback("error", "fb_error_verify_version");
        addInboxNotification("critical", "erreur lors de la vérification de la version du site", "Voir console.", "dangerous")            // Désactive le cache du navigateur et recharge la page proprement

    }
}

// scripts/app.js
const wall = document.getElementById("moodWall");
const modal = document.getElementById("postModal");
const submitBtn = document.getElementById("submitMood");

// Ajouter après les autres constantes
const ephemeralToggle = document.getElementById('ephemeralToggle');
const durationPicker = document.getElementById('durationPicker');
const durationInputs = document.querySelectorAll('#durationPicker input[type="number"]');
const msgDeleteTime = document.getElementById('msgdeletetime');

// ✅ Initialiser le durationPicker comme caché au démarrage
if (durationPicker) {
    durationPicker.style.display = 'none';
}

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
        stickerImg.alt = "Sticker";
        innerWrap.appendChild(stickerImg);
    }

    content.appendChild(innerWrap);

    // Expiration
    if (mood.ephemeral && mood.expiresAt) {
        moodcard.classList.add('ephemeral');

        const icon = document.createElement("svg");
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert-icon lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;

        const expiration = document.createElement("p");
        expiration.className = "expiration-date";
        expiration.textContent = "Message ephémère";


        const expirationDate = new Date(mood.expiresAt).toLocaleString("fr-FR", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });


        document.getElementById('msgdeletetime').textContent = "Message ephémère";
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
            const endpoint = isLiked ? `${API}/posts/${mood.id}/unlike` : `${API}/posts/${mood.id}/like`;
            const res = await fetch(endpoint, { method: 'POST', credentials: 'include' });
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

    const repostBtn = document.createElement('button');
    repostBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-repeat2-icon lucide-repeat-2"><path d="m2 9 3-3 3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/></svg>';
    repostBtn.title = 'Reposter';
    repostBtn.disabled = true;  // Disable initially
    actionBar.appendChild(repostBtn);

    // ---- Report button ----
    const reportBtn = document.createElement('button');
    reportBtn.className = 'reportbtn';
    reportBtn.title = 'Signaler ce post';
    reportBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';
    actionBar.appendChild(reportBtn);

    // const shareInMsg = document.createElement('button');
    // shareInMsg.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-share2-icon lucide-share-2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>';
    // shareInMsg.title = 'Partager dans un message';
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
    dateP.textContent = "Créé le " + createdDate;
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
            navigator.share({ title: 'O I FEEL', text: mood.text, url }).catch(() => { });
        } else {
            navigator.clipboard.writeText(url).then(() => showFeedback("success", "copied_link"));
        }
    });

    repostBtn.addEventListener('click', async () => {
        try {
            const res = await fetchWithAuth(`/posts/${mood.id}/repost`, { method: 'POST' });
            if (res.status === 201) {
                const newp = await res.json();
                showFeedback("success", "reposted");
            } else {
                const errData = await res.json().catch(() => ({}));
                console.error('❌ Repost error:', res.status, errData);
                showFeedback("error", "repost_failed");
            }
        } catch (err) {
            console.error('❌ Repost fetch error:', err);
            showFeedback("error", "repost_failed");
        }
    });
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
        const res = await fetch(`${API}/posts/${postId}/report`, {
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
        const res = await fetch(`${API}/posts`);
        if (user) {
            const res = await fetch(`${API}/users/${user.id}/posts`);
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


const previewMood = document.getElementById('previewMood');
const previewEmoji = document.getElementById('previewEmoji');
const previewText = document.getElementById('previewText');
const moodInput = document.getElementById('moodInput');
const moodColor = document.getElementById('moodColor');
const moodEmoji = document.querySelector('.moodEmoji');

// Fonction de mise à jour de l'aperçu
const textColorInput = document.getElementById('textColor');
let useManualTextColor = false;

textColorInput.addEventListener('input', () => {
    useManualTextColor = true;
    updatePreview();
});

function updatePreview() {
    const bgColor = moodColor.value;
    previewMood.style.background = bgColor;
    previewEmoji.textContent = moodEmoji.value;
    previewText.textContent = moodInput.value;

    if (useManualTextColor) {
        const color = textColorInput.value;
        previewText.style.color = color;
        previewEmoji.style.color = color;
    } else {
        const brightness = getBrightness(bgColor);
        const autoColor = brightness < 128 ? "#FFFFFF" : "#000000";
        previewText.style.color = autoColor;
        previewEmoji.style.color = autoColor;
    }
}


// Fonction utilitaire pour calculer la luminosité perçue
function getBrightness(hexColor) {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
}


// Mise à jour en direct sur chaque changement
moodInput.addEventListener('input', updatePreview);
moodColor.addEventListener('input', updatePreview);
moodEmoji.addEventListener('input', updatePreview);

// Mise à jour aussi après sélection d'un emoji
document.querySelector('emoji-picker').addEventListener('emoji-click', updatePreview);

// Initialisation à l'ouverture
updatePreview();


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
            console.log("tu es en ligne");
        } else {

            const offlineMood = {
                "text": "tu n'es pas connecté(e) à internet \n vérifie tes paramètres internet et réessaye !",
                "color": "#eb0000",
                "date": "01/01/2026",
                "emoji": "📵",
                "ephemeral": false,
                "expiresAt": null,
                "id": 404
            }
            displayMood(offlineMood)
            showFeedback("error", "tu n'es pas connecté/e à internet. vérifie ta connexion puis réessaye");
            console.log("tu es hors Ligne");
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
// BOUTON "PLUS OPTIONS" — Afficher/masquer les options avancées
// ============================================================
const moreOptionsBtn = document.getElementById('moreOptionsBtn');
const advancedOptions = document.getElementById('advancedOptions');

if (moreOptionsBtn && advancedOptions && blurOverlay) {
    moreOptionsBtn.addEventListener('click', () => {
        const isHidden = advancedOptions.hasAttribute('hidden');
        if (isHidden) {
            // Afficher les options avancées et le flou
            advancedOptions.removeAttribute('hidden');
            moreOptionsBtn.classList.add('active');
        } else {
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
const morePublishOptionsBtn = document.getElementById('publish-tools');
const advancedPublishOptions = document.getElementById('publishOptionsDiv');

function closeAdvancedPublishOptions() {
    if (advancedPublishOptions && morePublishOptionsBtn) {
        advancedPublishOptions.setAttribute('hidden', '');
        morePublishOptionsBtn.classList.remove('active');

    }
}
closeAdvancedPublishOptions();

if (morePublishOptionsBtn && advancedPublishOptions && blurOverlay) {
    morePublishOptionsBtn.addEventListener('click', () => {
        const isHidden = advancedPublishOptions.hasAttribute('hidden');
        if (isHidden) {
            // Afficher les options avancées et le flou
            advancedPublishOptions.removeAttribute('hidden');
            morePublishOptionsBtn.classList.add('active');
        } else {
            closeAdvancedPublishOptions();
        }
    });
}



// ============================================================
// DURATION PICKER — Afficher/masquer au toggle ephemeralToggle
// ============================================================
const _ephemeralToggle = document.getElementById('ephemeralToggle');
const _durationPicker = document.getElementById('durationPicker');

if (_ephemeralToggle && _durationPicker) {
    _ephemeralToggle.addEventListener('change', () => {
        if (_ephemeralToggle.checked) {
            _durationPicker.style.display = 'block';
        } else {
            _durationPicker.style.display = 'none';
        }
    });
}

const addStoryBtn = document.getElementById('addStoryBtn');
const storyModeToggle = document.getElementById('storyModeToggle');

if (addStoryBtn) {
    addStoryBtn.addEventListener('click', () => {
        // Active automatiquement le mode "Story"
        const createTabBtn = document.querySelector('#create');
        createTabBtn?.click();
        if (storyModeToggle) storyModeToggle.checked = true;
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
                showFeedback("error", "écris quelque chose !", "fb_write_something");
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

                const resStory = await fetch(`${API}/stories`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(storyData)
                });

                if (!resStory.ok) throw new Error(`HTTP ${resStory.status}`);

                const savedStory = await resStory.json();
                addStoryToList(savedStory);
                showFeedback("success", "story publiée !", "fb_story_posted");
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
                    anonymous: getAnonymousFlag()
                };
                window._v2SelectedGradient = null;
                document.querySelectorAll('.swatch').forEach(s => s.classList.remove('swatch--active'));

                const response = await fetch(`${API}/posts`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
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


console.log(`%c⚠ fais gaffe: ne rentre jamais de commande ici sans connaître son but ! toute tentative d'injection de commande entraînera le bannissement immédiat de ton compte.`, "color: orange; font-size: 25px; font-family: DM Sans");

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
        const res = await fetch(`${API}/stories`);
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
          <button class="sv-close-btn" aria-label="Fermer" style="color:${tc};">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="sv-body">
          <div class="sv-big-emoji" style="color:${tc};">${story.emoji || ''}</div>
          <p class="sv-text" style="color:${tc};">${story.text || ''}</p>
        </div>
        <button class="sv-nav sv-nav--prev" aria-label="Précédente" ${_storyIndex === 0 ? 'disabled' : ''}>
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button class="sv-nav sv-nav--next" aria-label="Suivante">
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
        _updatePreview();
    });
}

// Color presets
document.querySelectorAll('.create-color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        document.getElementById('moodColor').value = color;
        document.querySelectorAll('.create-color-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _updatePreview();
    });
});

// Custom color picker
const _customColor = document.getElementById('moodColor');
if (_customColor) {
    _customColor.addEventListener('change', () => {
        document.querySelectorAll('.create-color-preset').forEach(b => b.classList.remove('active'));
        _updatePreview();
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
        _updatePreview();
    });
}

if (_emojiPicker) {
    _emojiPicker.addEventListener('emoji-click', (e) => {
        _selectedEmoji = e.detail.unicode;
        document.querySelector('.moodEmoji').value = _selectedEmoji;
        _updatePreview();
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

// Clés API Tenor - v2 (Google Cloud) préférée, v1 en fallback
const TENOR_API_KEY = 'YOUR_TENOR_API_KEY_HERE'; // ⚠️ Remplace avec ta clé depuis https://tenor.com/developer/dashboard
const TENOR_V1_KEY = 'LIVDSRZULELA'; // Votre clé de l'exemple

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

async function _loadTrendingStickers() {
    try {
        _stickerResults.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text);opacity:.6;">Chargement des tendances...</div>';

        // Tenter v2 en premier
        const res = await fetch(`https://tenor.googleapis.com/v2/featured?key=${TENOR_API_KEY}&client_key=moodshare&limit=100&media_filter=gif`);

        if (!res.ok) throw new Error('V2 failed');

        const data = await res.json();
        _renderStickers(data.results, 'v2');
    } catch (err) {
        console.warn('⚠️ Tenor v2 failed, trying v1:', err);
        // Fallback v1
        try {
            const res = await fetch(`https://g.tenor.com/v1/trending?key=${TENOR_V1_KEY}&limit=100`);
            const data = await res.json();
            _renderStickers(data.results, 'v1');
        } catch (err2) {
            console.error('❌ Both Tenor APIs failed:', err2);
            _stickerResults.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text);opacity:.6;">Impossible de charger les stickers</div>';
        }
    }
}

async function _searchStickers(query) {
    try {
        _stickerResults.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text);opacity:.6;">Recherche...</div>';

        // Tenter v2 en premier
        const res = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&client_key=moodshare&limit=100&media_filter=gif`);

        if (!res.ok) throw new Error('V2 failed');

        const data = await res.json();

        if (!data.results || data.results.length === 0) {
            _stickerResults.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text);opacity:.6;">Aucun résultat</div>';
            return;
        }

        _renderStickers(data.results, 'v2');
    } catch (err) {
        console.warn('⚠️ Tenor v2 failed, trying v1:', err);
        // Fallback v1
        try {
            const res = await fetch(`https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${TENOR_V1_KEY}&limit=100`);
            const data = await res.json();

            if (!data.results || data.results.length === 0) {
                _stickerResults.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text);opacity:.6;">Aucun résultat</div>';
                return;
            }

            _renderStickers(data.results, 'v1');
        } catch (err2) {
            console.error('❌ Both Tenor APIs failed:', err2);
            _stickerResults.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text);opacity:.6;">Erreur de recherche</div>';
        }
    }
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
            _updatePreview();
            _stickerOverlay.style.display = 'none';
        });
        _stickerResults.appendChild(div);
    });
}

// Preview live
function _updatePreview() {
    const text = _moodInput.value || 'Ton message apparaîtra ici...';
    const bgColor = document.getElementById('moodColor').value;
    const previewCard = document.getElementById('previewMood');
    const previewEmoji = document.getElementById('previewEmoji');
    const previewText = document.getElementById('previewText');
    const previewSticker = document.getElementById('previewSticker');


    previewEmoji.textContent = _selectedEmoji;
    previewText.textContent = text;

    // Set background color
    if (previewCard) {
        previewCard.style.background = bgColor;
    }

    // Auto text color based on brightness
    const brightness = _getBrightness(bgColor);
    const textColor = brightness > 128 ? '#1a1a1a' : '#ffffff';
    previewText.style.color = textColor;
    previewEmoji.style.color = textColor;

    // Sticker
    if (_selectedStickerUrl) {
        previewSticker.src = _selectedStickerUrl;
        previewSticker.style.display = 'block';
    } else {
        previewSticker.style.display = 'none';
    }
}

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
        _durationPicker.style.display = _ephemeralToggle.checked ? 'block' : 'none';
    });
}

document.addEventListener(("focusout"), () => {
    document.title = "Revenez, tu nous manquez !";
});

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


// obtenir l'etat des boutons de gradient dans .bg-options
const gradientButtons = document.querySelectorAll('.bg-options button');
gradientButtons.forEach(btn => {
    btn.style.background = `linear-gradient(135deg, ${gradients()[btn.dataset.bg][0]}, ${gradients()[btn.dataset.bg][1]})`;
    btn.addEventListener('click', () => {
        const gradient = btn.dataset.bg;
        if (gradient && gradients()[gradient]) {
            const colors = gradients()[gradient];

            document.querySelector("body").style.background = `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
            window._v2SelectedGradient = `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
            document.querySelectorAll('.bg-option').forEach(s => s.classList.remove('swatch--active'));
            btn.classList.add('swatch--active');
        }
    });
});

// only for desktop : cacher la nav quand le curseur n'est pas proche
//check if the cursor is less than 10% of the left of the screen or on the nav
if (window.innerWidth > 768) {
    document.addEventListener('mousemove', (e) => {
        const nav = document.getElementById('nav');
        if (!nav) return;

        if (e.clientX < window.innerWidth * 0.1 || e.target.closest('#nav')) {
            // Curseur dans les 10% à gauche ou sur la nav : montrer
            nav.style.left = '0px';
            nav.style.opacity = '1';
        } else {
            // Curseur ailleurs : cacher
            nav.style.left = '-25px';
            nav.style.opacity = '0.3';
        }
    });
};