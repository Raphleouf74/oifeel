// ======================
// CONSTANTS
// ======================
const API = "https://moodshare-7dd7.onrender.com/api";

// Token admin JWT stocké en mémoire (jamais dans localStorage)
let adminToken = null;

function adminHeaders() {
    return {
        "Content-Type": "application/json",
        ...(adminToken ? { "Authorization": `Bearer ${adminToken}` } : {}),
    };
}



// In-memory state
let allPosts = [];
let allReports = [];
let allStories = [];
let allUsers = [];

// ======================
// LOGIN
// ======================
document.getElementById("attemptlogin").addEventListener(("click"), () => attemptLogin());
async function attemptLogin() {
    const id = document.getElementById("login-id").value.trim();
    const pw = document.getElementById("login-password").value;
    const err = document.getElementById("login-error");

    err.classList.remove("show");

    // Le mot de passe n'est JAMAIS comparé côté client.
    // On envoie les credentials au backend qui valide et renvoie un token JWT.
    try {
        const res = await fetch(`${API}/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, password: pw }),
        });

        if (res.ok) {
            const data = await res.json();
            adminToken = data.token; // stocker le token en mémoire (pas localStorage)
            sessionStorage.setItem("ms_admin", "1");
            document.getElementById("login-screen").style.display = "none";
            document.getElementById("admin-screen").classList.add("show");
            loadAll();
        } else {
            err.classList.add("show");
        }
    } catch (e) {
        console.error('[ADMIN] Erreur de connexion:', e.message);
        err.classList.add("show");
    }
}

// Allow Enter key on login
document.addEventListener("keydown", (e) => {
    if (
        e.key === "Enter" &&
        document.getElementById("login-screen").style.display !== "none"
    ) {
        attemptLogin();
    }
});

function doLogout() {
    adminToken = null; // effacer le token JWT de la mémoire
    sessionStorage.removeItem("ms_admin");
    document.getElementById("admin-screen").classList.remove("show");
    document.getElementById("login-screen").style.display = "";
}

// ======================
// NAVIGATION
// ======================
function showPage(name) {
    document
        .querySelectorAll(".page")
        .forEach((p) => p.classList.remove("active"));
    document
        .querySelectorAll(".nav-item")
        .forEach((n) => n.classList.remove("active"));
    document.getElementById("page-" + name).classList.add("active");
    document
        .querySelector(`[data-page="${name}"]`)
        ?.classList.add("active");

    if (name === "posts") renderPosts();
    if (name === "reports") renderReports();
    if (name === "stories") renderStories();
    if (name === "create") bindCreatePreview();
    if (name === "pinned") loadPinned();
    if (name === "users") renderUsers();
    if (name === "settings") renderSettings();
    if (name === "analytics") loadAnalytics();
}

async function loadAnalytics() {
    const target = document.getElementById('analytics-content');
    if (!target) return;
    target.textContent = 'chargement…';
    try {
        const response = await fetch(`${API}/admin/analytics?days=30`, { headers: adminHeaders() });
        if (!response.ok) throw new Error();
        const { days } = await response.json();
        if (!days.length) { target.textContent = 'aucune donnée pour le moment.'; return; }
        target.innerHTML = `<table class="data-table"><thead><tr><th>Jour</th><th>Visites</th><th>Inscriptions</th><th>Posts</th><th>Partages</th></tr></thead><tbody>${days.map(row => `<tr><td>${row.day}</td><td>${row.events?.visit || 0}</td><td>${row.events?.signup || 0}</td><td>${row.events?.post || 0}</td><td>${row.events?.share || 0}</td></tr>`).join('')}</tbody></table>`;
    } catch (_) { target.textContent = 'statistiques indisponibles.'; }
}

// ======================
// DATA LOADING
// ======================
async function loadAll() {
    const sp = document.getElementById("refresh-spinner");
    if (sp) sp.style.display = "inline";

    try {
        const [pRes, sRes] = await Promise.all([
            fetch(`${API}/posts`),
            fetch(`${API}/stories`),
        ]);

        allPosts = await pRes.json();
        allStories = await sRes.json();

        // Reports: endpoint admin sécurisé
        try {
            const rRes = await fetch(`${API}/admin/reports`, {
                headers: adminHeaders(),
            });
            if (rRes.ok) allReports = await rRes.json();
        } catch (_) {
            /* SSE fallback */
        }

        // Users: endpoint admin sécurisé
        try {
            const uRes = await fetch(`${API}/admin/users`, {
                headers: adminHeaders(),
            });
            if (uRes.ok) allUsers = await uRes.json();
            else allUsers = [];
        } catch (_) {
            allUsers = [];
        }
    } catch (err) {
        toast("Erreur de connexion à l'API", "error");
    }

    if (sp) sp.style.display = "none";
    updateStats();
    renderDashRecent();
    renderUsers();
    renderPosts();
    renderReports();
    renderStories();
    await updateAdminMaintenanceBadge();
}

async function updateAdminMaintenanceBadge() {
    const indicator = document.getElementById('maintenance-indicator');
    if (!indicator) return;
    try {
        const res = await fetch(`${API}/admin/status`, {
            method: 'GET',
            headers: adminHeaders(),
        });
        if (!res.ok) throw new Error('Impossible de récupérer le statut admin');
        const status = await res.json();
        if (status.maintenance) {
            indicator.classList.remove('hidden');
            indicator.textContent = '⚠️ Maintenance activée';
        } else {
            indicator.classList.add('hidden');
        }
    } catch (err) {
        indicator.classList.add('hidden');
    }
}

// ======================
// STATS
// ======================
function updateStats() {
    document.getElementById("stat-posts").textContent = allPosts.length;
    document.getElementById("stat-stories").textContent = allStories.length;
    document.getElementById("stat-reports").textContent = allReports.length;
    document.getElementById("stat-ephemeral").textContent = allPosts.filter(
        (p) => p.ephemeral,
    ).length;

    const badge = document.getElementById("reports-badge");
    if (allReports.length > 0) {
        badge.textContent = allReports.length;
        badge.style.display = "inline-block";
    } else {
        badge.style.display = "none";
    }
}

// ======================
// DASHBOARD RECENT
// ======================
function renderDashRecent() {
    const el = document.getElementById("dash-recent");
    const recent = [...allPosts].slice(0, 15);

    if (!recent.length) {
        el.innerHTML = emptyState("Aucun post");
        return;
    }

    el.innerHTML = `
      <table id="post-table">
        <thead><tr>
          <th>Post</th>
          <th>Likes</th>
          <th>Date</th>
          <th>Type</th>
        </tr></thead>
        <tbody>
          ${recent.map((p) => postRow(p, true)).join("")}
        </tbody>
      </table>`;
    const postTable = document.getElementById('post-table');

}

// ======================
// POSTS TABLE
// ======================
function renderPosts() {
    const el = document.getElementById("posts-table");
    const q = (
        document.getElementById("post-search")?.value || ""
    ).toLowerCase();
    const posts = allPosts.filter(
        (p) =>
            !q || p.text?.toLowerCase().includes(q) || p.emoji?.includes(q),
    );

    const ct = document.getElementById("posts-count");
    if (ct)
        ct.textContent = `${posts.length} post${posts.length !== 1 ? "s" : ""}`;

    if (!posts.length) {
        el.innerHTML = emptyState("Aucun post trouvé");
        return;
    }

    el.innerHTML = `
      <table>
        <thead><tr>
          <th>Post</th>
          <th>Likes</th>
          <th>Date</th>
          <th>Type</th>
          <th>Actions</th>
        </tr></thead>
        <tbody>
          ${posts.map((p) => postRow(p, false)).join("")}
        </tbody>
      </table>`;
}

function filterPosts() {
    renderPosts();
}

function postRow(p, minimal) {
    const date = p.createdAt
        ? new Date(p.createdAt).toLocaleDateString("fr-FR")
        : "—";
    const type = p.ephemeral
        ? `<span class="chip chip-ephemeral">⏳ éphémère</span>`
        : `<span class="chip chip-normal">normal</span>`;

    const text = p.text || "";
    const actions = minimal
        ? ""
        : `
      <td>
        <div class="actions-row">
          <button class="btn btn-ghost btn-sm" onclick="openEdit('${p.id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="openDelete('${p.id}')">🗑️</button>
        </div>
      </td>`;

    return `
      <tr>
        <td>
          <div class="post-preview">
            <div class="post-color-dot" style="background:${p.color || "#ccc"}"></div>
            <span class="post-emoji-badge">${p.emoji || ""}</span>
            <span class="post-text-preview" title="${text}">${text || '<em style="color:var(--muted)">Sans texte</em>'}</span>
          </div>
        </td>
        <td><span class="like-badge">❤️ ${p.likes || 0}</span></td>
        <td><span class="date-muted">${date}</span></td>
        <td>${type}</td>
        ${actions}
      </tr>`;
}

// ======================
// REPORTS
// ======================
function renderReports() {
    const el = document.getElementById("reports-list");

    if (!allReports.length) {
        el.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">✅</div>
          <p>Aucun signalement pour le moment. Tout est calme !</p>
        </div>`;
        return;
    }

    el.innerHTML = allReports
        .map((r) => {
            const post = allPosts.find((p) => p.id == r.postId);
            const postText = post
                ? post.text || "[sans texte]"
                : "Post introuvable";
            const date = r.createdAt
                ? new Date(r.createdAt).toLocaleString("fr-FR")
                : "—";

            return `
        <div class="report-card" id="report-${r.id}">
          <div class="report-meta">
            <strong>🚨 Signalement #${r.id}</strong>
            <span>·</span>
            <span>par <strong>${r.reporter?.username || "inconnu"}</strong></span>
            <span>·</span>
            <span>${date}</span>
            ${r.commentId ? `<span class="chip chip-reported">commentaire</span>` : `<span class="chip chip-reported">post</span>`}
          </div>
          <div class="report-reason">
            <strong>Raison :</strong> ${r.reason || "Aucune raison fournie."}
          </div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">
            Post concerné : <em>"${postText.slice(0, 80)}${postText.length > 80 ? "…" : ""}"</em>
          </div>
          <div class="report-actions">
            <button class="btn btn-danger btn-sm" onclick="forceDeleteFromReport('${r.postId}', '${r.id}')">🗑️ Supprimer le post</button>
            <button class="btn btn-ghost btn-sm" onclick="dismissReport('${r.id}')">✅ Ignorer</button>
          </div>
        </div>`;
        })
        .join("");
}

async function dismissReport(rid) {
    try {
        await fetch(`${API}/admin/reports/${rid}`, {
            method: "DELETE",
            headers: adminHeaders(),
        });
    } catch (_) {
        /* si réseau down, on retire quand même localement */
    }

    allReports = allReports.filter((r) => r.id != rid);
    updateStats();
    renderReports();
    toast("Signalement supprimé ✅", "info");
}

async function forceDeleteFromReport(postId, reportId) {
    await deletePost(postId);
    dismissReport(reportId);
}

// ======================
// SETTINGS
// ======================
async function renderSettings() {
    const el = document.getElementById("settings-content");
    el.innerHTML = `<div class="loading-state">
        <div class="spinner"></div>
        <p>Chargement du statut serveur...</p>
    </div>`;

    try {
        const res = await fetch(`${API}/admin/status`, {
            method: "GET",
            headers: adminHeaders(),
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`[${res.status}] ${errData.error || errData.message || 'Erreur de requête'}`);
        }
        const status = await res.json();

        el.innerHTML = `
            <div class="settings-grid">
                <!-- MONGODB -->
                <div class="settings-card">
                    <div class="settings-card-title">🗄️ MongoDB</div>
                    <div class="settings-status">
                        <div class="status-row">
                            <span>Connexion</span>
                            <span class="status-badge ${status.mongodb.connected ? 'success' : 'danger'}">
                                ${status.mongodb.status}
                            </span>
                        </div>
                        <div class="status-row">
                            <span>Configuration</span>
                            <span class="status-text">${status.mongodb.uri}</span>
                        </div>
                    </div>
                </div>

                <!-- ENVIRONMENT -->
                <div class="settings-card">
                    <div class="settings-card-title">🌍 Environnement</div>
                    <div class="settings-status">
                        <div class="status-row">
                            <span>Plateforme</span>
                            <span class="status-text">${status.environment}</span>
                        </div>
                        <div class="status-row">
                            <span>Uptime</span>
                            <span class="status-text">${status.uptime}</span>
                        </div>
                        <div class="status-row">
                            <span>Node.js</span>
                            <span class="status-text">${status.node.version}</span>
                        </div>
                    </div>
                </div>

                <!-- MAINTENANCE MODE -->
                <div class="settings-card">
                    <div class="settings-card-title">🛠️ Mode maintenance</div>
                    <div class="settings-status">
                        <div class="status-row">
                            <span>État</span>
                            <span class="status-badge ${status.maintenance ? 'danger' : 'success'}">
                                ${status.maintenance ? '❌ Activé' : '✅ Désactivé'}
                            </span>
                        </div>
                        <div class="status-row" style="margin-top: 12px;">
                            <button class="btn ${status.maintenance ? 'btn-ghost' : 'btn-warn'}" onclick="setMaintenance(${!status.maintenance})">
                                ${status.maintenance ? 'Désactiver le mode maintenance' : 'Activer le mode maintenance'}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- DATABASE STATS -->
                <div class="settings-card">
                    <div class="settings-card-title">📊 Base de données</div>
                    <div class="settings-status">
                        <div class="status-row">
                            <span>Posts</span>
                            <span class="status-badge count">${status.database.posts}</span>
                        </div>
                        <div class="status-row">
                            <span>Stories</span>
                            <span class="status-badge count">${status.database.stories}</span>
                        </div>
                        <div class="status-row">
                            <span>Signalements</span>
                            <span class="status-badge count">${status.database.reports}</span>
                        </div>
                        <div class="status-row">
                            <span>Posts épinglés</span>
                            <span class="status-badge count">${status.database.pinned}</span>
                        </div>
                    </div>
                </div>

                <!-- MEMORY -->
                <div class="settings-card">
                    <div class="settings-card-title">🚀 Mémoire serveur</div>
                    <div class="settings-status">
                        <div class="status-row">
                            <span>Utilisée</span>
                            <span class="status-text">${status.node.memory.used}</span>
                        </div>
                        <div class="status-row">
                            <span>Allouée</span>
                            <span class="status-text">${status.node.memory.total}</span>
                        </div>
                    </div>
                </div>

                <!-- API CONFIG -->
                <div class="settings-card">
                    <div class="settings-card-title">🔐 API</div>
                    <div class="settings-status">
                        <div class="status-row">
                            <span>CORS</span>
                            <span class="status-badge success">✅ Activé</span>
                        </div>
                        <div class="status-row">
                            <span>Admin Secret</span>
                            <span class="status-badge ${status.api.adminSecretConfigured ? 'success' : 'danger'}">
                                ${status.api.adminSecretConfigured ? '✅ Configuré' : '❌ Manquant'}
                            </span>
                        </div>
                        <div class="status-row">
                            <span>Rate Limit</span>
                            <span class="status-text">${status.api.rateLimit}</span>
                        </div>
                    </div>
                </div>

                <!-- HEALTH CHECK -->
                <div class="settings-card">
                    <div class="settings-card-title">❤️ Santé du système</div>
                    <div class="settings-status">
                        <div class="status-row" style="margin-bottom: 12px;">
                            <span style="font-weight: 600;">Statut global</span>
                            <span class="status-badge success">✅ En ligne</span>
                        </div>
                        <div style="font-size: 11px; color: var(--muted); font-family: monospace;">
                            ${status.timestamp}
                        </div>
                    </div>
                </div>
            </div>

            <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); display: flex; gap: 12px; flex-wrap: wrap;">
                <button class="btn btn-ghost" onclick="renderSettings()">🔄 Actualiser</button>
                <button class="btn btn-danger" onclick="openEmergencyRestart()" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3);">🚨 Redémarrage d'urgence</button>
                <button class="btn btn-ghost" onclick="showPage('dashboard')">← Retour</button>
            </div>
        `;
    } catch (err) {
        el.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <p>Impossible de charger le statut serveur</p>
                <p style="font-size: 12px; color: var(--muted); margin-top: 8px;">${err.message}</p>
            </div>
            <div style="margin-top: 16px;">
                <button class="btn btn-ghost" onclick="renderSettings()">🔄 Réessayer</button>
            </div>
        `;
    }
}

async function setMaintenance(enabled) {
    try {
        const res = await fetch(`${API}/admin/maintenance`, {
            method: 'POST',
            headers: {
                ...adminHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(errData.error || errData.message || 'Erreur de requête');
        }

        toast(`Mode maintenance ${enabled ? 'activé' : 'désactivé'} ✅`, 'success');
        renderSettings();
    } catch (err) {
        toast(`Impossible de changer le mode maintenance : ${err.message}`, 'error');
    }
}

// ======================
// EMERGENCY RESTART
// ======================
function openEmergencyRestart() {
    document.getElementById("emergency-command").value = "";
    document.getElementById("emergency-error").style.display = "none";
    openModal("emergency-modal");
}

async function confirmEmergencyRestart() {
    const password = document.getElementById("emergency-password").value;
    const command = document.getElementById("emergency-command").value.trim();
    const errorEl = document.getElementById("emergency-error");

    // La commande doit être "RESTART_NOW" pour l'autoriser
    if (command !== "RESTART_NOW") {
        errorEl.textContent = "❌ Commande incorrecte (tapez RESTART_NOW)";
        errorEl.style.display = "block";
        return;
    }

    try {
        const res = await fetch(`${API}/admin/emergency-restart`, {
            method: "POST",
            headers: adminHeaders(),
        });

        if (res.ok) {
            const result = await res.json();
            toast("🚨 Redémarrage d'urgence effectué ✅", "success");
            closeModal("emergency-modal");

            // Recharger les données après un délai
            setTimeout(() => {
                loadAll();
                renderSettings();
            }, 1000);
        } else {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            const errorMsg = err.error || err.message || `Erreur ${res.status}`;
            errorEl.textContent = `❌ [${res.status}] ${errorMsg}`;
            errorEl.style.display = "block";
            console.error('[EMERGENCY] Erreur:', res.status, err);
            toast(`Erreur: ${errorMsg}`, "error");
        }
    } catch (err) {
        errorEl.textContent = `❌ Erreur réseau: ${err.message}`;
        errorEl.style.display = "block";
        console.error('[EMERGENCY] Erreur réseau:', err);
        toast("Erreur réseau lors du redémarrage", "error");
    }
}

// Permettre Enter pour confirmer
document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && document.getElementById("emergency-modal")?.classList.contains("show")) {
        const focusedEl = document.activeElement;
        if (focusedEl?.id === "emergency-command") {
            confirmEmergencyRestart();
        }
    }
});

// ======================
// STORIES
// ======================
function renderStories() {
    const el = document.getElementById("stories-table");
    if (!allStories.length) {
        el.innerHTML = emptyState("Aucune story active");
        return;
    }
    el.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead><tr>
            <th>Story</th>
            <th>Créée le</th>
            <th>Expire le</th>
          </tr></thead>
          <tbody>
            ${allStories
            .map((s) => {
                const created = s.createdAt
                    ? new Date(s.createdAt).toLocaleString("fr-FR")
                    : "—";
                const expires = s.expiresAt
                    ? new Date(s.expiresAt).toLocaleString("fr-FR")
                    : "Permanente";
                return `<tr>
                <td>
                  <div class="post-preview">
                    <div class="post-color-dot" style="background:${s.color || "#ccc"}"></div>
                    <span class="post-emoji-badge">${s.emoji || ""}</span>
                    <span class="post-text-preview">${s.text || ""}</span>
                  </div>
                </td>
                <td><span class="date-muted">${created}</span></td>
                <td><span class="date-muted ${s.expiresAt ? "warn" : ""}">${expires}</span></td>
              </tr>`;
            })
            .join("")}
          </tbody>
        </table>
      </div>`;
}

// ======================
// EDIT POST
// ======================
function openEdit(id) {
    const post = allPosts.find((p) => p.id == id);
    if (!post) return toast("Post introuvable", "error");

    document.getElementById("edit-post-id").value = id;
    document.getElementById("edit-text").value = post.text || "";
    document.getElementById("edit-emoji").value = post.emoji || "";
    document.getElementById("edit-color").value =
        post.color && post.color.startsWith("#") ? post.color : "#ffffff";
    document.getElementById("edit-textcolor").value =
        post.textColor && post.textColor.startsWith("#")
            ? post.textColor
            : "#000000";
    openModal("edit-modal");
}

async function saveEdit() {
    const id = document.getElementById("edit-post-id").value;
    const text = document.getElementById("edit-text").value.trim();
    const emoji = document.getElementById("edit-emoji").value.trim();
    const color = document.getElementById("edit-color").value;
    const textColor = document.getElementById("edit-textcolor").value;

    try {
        const res = await fetch(`${API}/admin/posts/${id}`, {
            method: "PUT",
            headers: adminHeaders(),
            body: JSON.stringify({ text, emoji, color, textColor }),
        });

        if (res.ok) {
            const updated = await res.json();
            const idx = allPosts.findIndex((p) => p.id == id);
            if (idx !== -1) allPosts[idx] = { ...allPosts[idx], ...updated };
            toast("Post modifié avec succès ✏️", "success");
            closeModal("edit-modal");
            renderPosts();
            renderDashRecent();
        } else {
            const err = await res.json().catch(() => ({}));
            toast(`Erreur : ${err.error || res.status}`, "error");
        }
    } catch (err) {
        toast("Erreur réseau lors de la modification", "error");
    }
}

// ======================
// DELETE POST
// ======================
function openDelete(id) {
    document.getElementById("delete-post-id").value = id;
    openModal("delete-modal");
}

async function confirmDelete() {
    const id = document.getElementById("delete-post-id").value;
    await deletePost(id);
    closeModal("delete-modal");
}

async function deletePost(id) {
    try {
        const res = await fetch(`${API}/admin/posts/${id}`, {
            method: "DELETE",
            headers: adminHeaders(),
        });

        if (res.ok) {
            allPosts = allPosts.filter((p) => p.id != id);
            toast("Post supprimé définitivement 🗑️", "success");
        } else {
            const err = await res.json().catch(() => ({}));
            toast(`Erreur suppression : ${err.error || res.status}`, "error");
            return; // ne pas retirer localement si le serveur a refusé
        }
    } catch (_) {
        toast("Erreur réseau — suppression impossible", "error");
        return;
    }

    updateStats();
    renderPosts();
    renderDashRecent();
}

// ======================
// CREATE POST
// ======================
function bindCreatePreview() {
    const text = document.getElementById("create-text");
    const emoji = document.getElementById("create-emoji");
    const color = document.getElementById("create-color");
    const tc = document.getElementById("create-textcolor");

    const update = () => {
        const bubble = document.getElementById("create-preview");
        bubble.style.background = color.value;
        bubble.style.color = tc.value;
        document.getElementById("prev-emoji").textContent =
            emoji.value || "😊";
        document.getElementById("prev-text").textContent =
            text.value || "Texte du post…";
    };

    text.addEventListener("input", update);
    emoji.addEventListener("input", update);
    color.addEventListener("input", update);
    tc.addEventListener("input", update);
    update();
}

async function adminCreatePost() {
    const text = document.getElementById("create-text").value.trim();
    const emoji = document.getElementById("create-emoji").value.trim();
    const color = document.getElementById("create-color").value;
    const textColor = document.getElementById("create-textcolor").value;

    if (!text && !emoji)
        return toast("Le post ne peut pas être vide", "error");

    // Body strict — on n'envoie que les champs remplis pour eviter
    // que le serveur rejette a cause d'un emoji vide ou undefined
    const body = {
        color,
        textColor,
        ephemeral: false,
        likes: 0,
    };
    if (text) body.text = text;
    if (emoji) body.emoji = emoji;

    try {
        const res = await fetch(`${API}/posts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
        });

        if (res.ok) {
            const newPost = await res.json();
            allPosts.unshift(newPost);
            toast("Post publié! ✅", "success");
            document.getElementById("create-text").value = "";
            document.getElementById("create-emoji").value = "";
            showPage("posts");
            updateStats();
            renderDashRecent();
        } else {
            const errData = await res.json().catch(() => ({}));
            toast(
                "Erreur publication : " + (errData.error || res.status),
                "error",
            );
        }
    } catch (err) {
        toast("Erreur réseau : " + err.message, "error");
    }
}

// ======================
// MODAL HELPERS
// ======================
function openModal(id) {
    document.getElementById(id).classList.add("show");
}
function closeModal(id) {
    document.getElementById(id).classList.remove("show");
}

document.querySelectorAll(".modal-overlay").forEach((o) => {
    o.addEventListener("click", (e) => {
        if (e.target === o) o.classList.remove("show");
    });
});

// ======================
// TOAST
// ======================
function toast(msg, type = "info") {
    const c = document.getElementById("toast-container");
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.innerHTML = `<div class="toast-dot"></div><span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => {
        t.style.opacity = "0";
        t.style.transform = "translateX(20px)";
        t.style.transition = "all .3s";
        setTimeout(() => t.remove(), 300);
    }, 3500);
}

// ======================
// EMPTY STATE
// ======================
function emptyState(msg) {
    return `<div class="empty-state"><div class="empty-state-icon">📭</div><p>${msg}</p></div>`;
}

// ======================
// SSE: listen for reports in real time
// ======================
const es = new EventSource(`${API}/stream`);
es.addEventListener("report", (e) => {
    try {
        const report = JSON.parse(e.data);
        if (!allReports.find((r) => r.id === report.id)) {
            allReports.unshift(report);
            updateStats();
            renderReports();
            toast("🚨 Nouveau signalement reçu!", "error");
        }
    } catch (_) { }
});

// ======================
// SESSION RESTORE
// ======================
// Note: adminToken est en mémoire (perdu au rechargement de page).
// Si la page est rechargée, l'admin doit se reconnecter — c'est voulu pour la sécurité.
// On efface donc le flag sessionStorage pour forcer le re-login.
sessionStorage.removeItem("ms_admin");

// ======================
// PINNED POSTS (ANNONCES)
// ======================
let allPinned = [];

async function loadPinned() {
    try {
        const res = await fetch(`${API}/admin/posts/pinned`, {
            headers: adminHeaders(),
        });
        if (res.ok) allPinned = await res.json();
    } catch (_) { }
    renderPinned();
}

function renderPinned() {
    const el = document.getElementById("pinned-list");
    if (!el) return;
    if (!allPinned.length) {
        el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p>Aucune annonce épinglée. Crée ta première annonce!</p></div>`;
        return;
    }
    el.innerHTML = allPinned
        .map(
            (p) => `
      <div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--warn);border-radius:12px;padding:18px 20px;margin-bottom:12px;animation:fadeUp .2s ease both;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:14px;height:14px;border-radius:4px;background:${p.color || "#f59e0b"};flex-shrink:0;"></div>
            <span style="font-size:20px;">${p.emoji || "📢"}</span>
            <div>
              <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--warn);margin-bottom:2px;">${p.pinnedLabel || "Annonce"}</div>
              <div style="font-size:13px;font-weight:600;max-width:380px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.text || ""}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
            <span style="font-size:11px;color:var(--muted);">${p.createdAt ? new Date(p.createdAt).toLocaleDateString("fr-FR") : "—"}</span>
            <button class="btn btn-danger btn-sm" onclick="deletePinnedPost('${p.id}')">🗑️ Retirer</button>
          </div>
        </div>
      </div>`,
        )
        .join("");
}

function openPinnedModal() {
    document.getElementById("pinned-text").value = "";
    document.getElementById("pinned-emoji").value = "";
    document.getElementById("pinned-color").value = "#f59e0b";
    document.getElementById("pinned-textcolor").value = "#000000";
    document.getElementById("pinned-label").value = "📢 Annonce";
    updatePinnedPreview();
    openModal("pinned-modal");
    [
        "pinned-text",
        "pinned-emoji",
        "pinned-color",
        "pinned-textcolor",
        "pinned-label",
    ].forEach((id) => {
        const el = document.getElementById(id);
        el.oninput = el.onchange = updatePinnedPreview;
    });
}

function updatePinnedPreview() {
    const preview = document.getElementById("pinned-preview");
    const color = document.getElementById("pinned-color").value;
    const tc = document.getElementById("pinned-textcolor").value;
    preview.style.background = color;
    preview.style.color = tc;
    document.getElementById("pinned-prev-label").textContent =
        document.getElementById("pinned-label").value;
    document.getElementById("pinned-prev-emoji").textContent =
        document.getElementById("pinned-emoji").value || "📢";
    document.getElementById("pinned-prev-text").textContent =
        document.getElementById("pinned-text").value || "Texte de l'annonce…";
}

async function createPinnedPost() {
    const text = document.getElementById("pinned-text").value.trim();
    const emoji = document.getElementById("pinned-emoji").value.trim();
    const color = document.getElementById("pinned-color").value;
    const textColor = document.getElementById("pinned-textcolor").value;
    const pinnedLabel = document.getElementById("pinned-label").value;
    if (!text && !emoji)
        return toast("L'annonce ne peut pas être vide", "error");
    try {
        const res = await fetch(`${API}/admin/posts/pinned`, {
            method: "POST",
            headers: adminHeaders(),
            body: JSON.stringify({
                text,
                emoji,
                color,
                textColor,
                pinnedLabel,
            }),
        });
        if (res.ok) {
            const p = await res.json();
            allPinned.unshift(p);
            allPosts.unshift(p);
            closeModal("pinned-modal");
            renderPinned();
            updateStats();
            toast("📌 Annonce épinglée!", "success");
        } else {
            const err = await res.json().catch(() => ({}));
            toast("Erreur : " + (err.error || res.status), "error");
        }
    } catch (e) {
        toast("Erreur réseau : " + e.message, "error");
    }
}

async function deletePinnedPost(id) {
    try {
        const res = await fetch(`${API}/admin/posts/pinned/${id}`, {
            method: "DELETE",
            headers: adminHeaders(),
        });
        if (res.ok) {
            allPinned = allPinned.filter((p) => p.id !== id);
            allPosts = allPosts.filter((p) => p.id !== id);
            renderPinned();
            updateStats();
            toast("Annonce retirée 🗑️", "info");
        } else {
            const err = await res.json().catch(() => ({}));
            toast("Erreur : " + (err.error || res.status), "error");
        }
    } catch (e) {
        toast("Erreur réseau", "error");
    }
}

// ======================
// Liste des users
// ======================
function renderUsers() {
    const el = document.getElementById("users-table");
    if (!el) return;

    if (!Array.isArray(allUsers) || allUsers.length === 0) {
        el.innerHTML = emptyState("Aucun utilisateur trouvé");
        return;
    }

    el.innerHTML = `
      <div class="table-wrapper">
        <table>
            <thead><tr>
                <th>Utilisateur</th>
                <th>Email / Notifs</th>
                <th>Statut</th>
                <th>Actions</th>
            </tr></thead>
            <tbody>
                ${allUsers
            .map((u) => {
                const name = u.displayName || u.username || "Utilisateur";
                const verifBadge = u.verified ? '<span class="chip" style="background:#4c9eff22;color:#4c9eff;">✓ certifié</span>' : '';


                const avatar = u.avatar || name.charAt(0).toUpperCase();
                const badge = u.isGuest ? '<span class="chip chip-ephemeral">Invité</span>' : '';
                let status = '';
                if (u.permanentlyBanned) {
                    status = '<span class="chip chip-danger">Banni définitivement</span>';
                } else if (u.bannedUntil && new Date(u.bannedUntil) > new Date()) {
                    const remaining = new Date(u.bannedUntil) - new Date();
                    const hours = Math.floor(remaining / (1000 * 60 * 60));
                    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
                    status = `<span class="chip chip-warning">Banni (${hours}h ${minutes}m restantes)</span>`;
                } else if (u.bannedUntil && new Date(u.bannedUntil) <= new Date()) {
                    status = '<span class="chip chip-success">Ban expiré</span>';
                }

                const emailCell = u.email
                    ? `<div style="font-size:12px;">${u.email}</div><div style="font-size:10px;color:var(--muted);margin-top:2px;">${u.hasEmailConsent ? '✅ Notifs activées' : '⚠️ Notifs désactivées'}</div>`
                    : `<span style="font-size:11px;color:var(--muted);">Pas d'email</span>`;

                const emailBtn = (u.email && u.hasEmailConsent)
                    ? `<button class="btn btn-ghost btn-sm" onclick="openSendEmailModal('${u.id}', '${name.replace(/'/g, "\\'")}', '${(u.email || '').replace(/'/g, "\\'")}', '${(u.avatar || '').replace(/'/g, "\\'")}')">📧 Email</button>`
                    : '';
                const ipBtn = `<button class="btn btn-ghost btn-sm" onclick="showUserIp('${u.id}')">🔍 IP</button>`;

                const bannedActions = `<button class="btn btn-success btn-sm" onclick="unbanUser('${u.id}')">✅ Débannir</button>`;
                const normalActions = `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">🗑️ Supprimer</button>
                     <button class="btn btn-danger btn-sm" onclick="banUser('${u.id}')">⏱️ Bannir temp.</button>
                     <button class="btn btn-danger btn-sm" onclick="permaBanUser('${u.id}')">🚫 Bannir déf.</button>`;
                const isBanned = u.permanentlyBanned || (u.bannedUntil && new Date(u.bannedUntil) > new Date());
                const actionBtns = (isBanned ? bannedActions : normalActions) + ' ' + emailBtn + ' ' + ipBtn;

                return `
                        <tr>
                            <td>
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <div style="width:32px;height:32px;border-radius:50%;background:#6b7280;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;">
                                        ${avatar}
                                    </div>
                                    <div>
                                        <div>${name} ${verifBadge}</div>
                                        <div style="font-size:12px;color:var(--muted);">${u.id}</div>
                                    </div>
                                </div>
                            </td>
                            <td>${emailCell}</td>
                            <td>${badge} ${status}</td>
                            <td><div class="actions-row">${actionBtns}</div></td>
                        </tr>
                    `;
            })
            .join("")}
            </tbody>
        </table>
      </div>
    `;
}


async function deleteUser(id) {
    if (!confirm("Êtes-tu sûr de vouloir supprimer cet utilisateur ? Cette action est irréversible.")) {
        return;
    }
    try {
        const res = await fetch(`${API}/admin/users/${id}`, {
            method: "DELETE",
            headers: adminHeaders(),
        });
        if (res.ok) {
            allUsers = allUsers.filter(u => u.id !== id);
            toast("Utilisateur supprimé 🗑️", "success");
            renderUsers();
        }
        else {
            const err = await res.json().catch(() => ({}));
            toast("Erreur : " + (err.error || res.status), "error");
        }
    } catch (e) {
        toast("Erreur réseau", "error");
    }
}

async function banUser(id) {
    const duration = prompt("Durée du ban en minutes (ex: 60 pour 1 heure) :");
    if (!duration || isNaN(duration) || duration <= 0) {
        toast("Durée invalide", "error");
        return;
    }
    const reason = prompt("Raison du ban :") || "Ban temporaire";

    try {
        const res = await fetch(`${API}/admin/users/${id}/ban`, {
            method: "PUT",
            headers: adminHeaders(),
            body: JSON.stringify({ duration: parseInt(duration), reason })
        });
        if (res.ok) {
            toast(`Utilisateur banni pour ${duration} minutes`, "success");
            renderUsers();
        } else {
            const err = await res.json().catch(() => ({}));
            toast("Erreur : " + (err.error || res.status), "error");
        }
    } catch (e) {
        toast("Erreur réseau", "error");
    }
}

async function permaBanUser(id) {
    const reason = prompt("Raison du ban définitif :") || "Ban définitif";
    if (!confirm("Êtes-tu sûr de vouloir bannir définitivement cet utilisateur ?")) {
        return;
    }

    try {
        const res = await fetch(`${API}/admin/users/${id}/ban`, {
            method: "PUT",
            headers: adminHeaders(),
            body: JSON.stringify({ permanent: true, reason })
        });
        if (res.ok) {
            toast("Utilisateur banni définitivement", "success");
            renderUsers();
        } else {
            const err = await res.json().catch(() => ({}));
            toast("Erreur : " + (err.error || res.status), "error");
        }
    } catch (e) {
        toast("Erreur réseau", "error");
    }
}

async function unbanUser(id) {
    try {
        const res = await fetch(`${API}/admin/users/${id}/unban`, {
            method: "PUT",
            headers: adminHeaders(),
        });
        if (res.ok) {
            toast("Utilisateur débanni", "success");
            loadAll();
        } else {
            const err = await res.json().catch(() => ({}));
            toast("Erreur : " + (err.error || res.status), "error");
        }
    } catch (e) {
        toast("Erreur réseau", "error");
    }
}



// ======================
// IP des utilisateurs
// ======================
async function showUserIp(userId) {
    try {
        const res = await fetch(`${API}/admin/users/${userId}/ip`, {
            headers: adminHeaders(),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return toast('Erreur: ' + (err.error || res.status), 'error');
        }
        const data = await res.json();
        let ipText, ipSub;
        if (data.ip) {
            const date = data.loggedAt ? new Date(data.loggedAt).toLocaleString('fr-FR') : '—';
            ipText = data.ip;
            ipSub = `Dernière connexion : ${date}`;
        } else if (data.expired) {
            ipText = 'Données expirées';
            ipSub = 'Données utilisateur éxpirées, connexion de l\'utilisateur requise pour récupérer l\'IP';
        } else {
            ipText = 'Aucune IP enregistrée';
            ipSub = 'Utilisateur non connecté. L\'utilisateur doit se connecter pour que l\'IP soit enregistrée. Il ne s\'est jamais connecté depuis la dernière mise à jour de sécurité.';
        }
        // Afficher dans une mini modale/toast enrichi
        toast(`🔍 ${ipText} — ${ipSub}`, data.ip ? 'info' : 'warn');
    } catch (e) {
        toast('Erreur réseau', 'error');
    }
}

// ======================
// Catégories d'annonces (masse + individuel)
// ======================
const CATEGORY_META = {
    // Annonces de masse
    feature: { label: 'nouvelle fonctionnalité.', emoji: '🚀', chip: 'chip-ephemeral' },
    maintenance: { label: 'maintenance.', emoji: '🛠️', chip: 'chip-warning' },
    update: { label: 'mise à jour.', emoji: '🔄', chip: 'chip-success' },
    info: { label: 'information générale.', emoji: '📢', chip: 'chip-normal' },
    // Emails individuels
    ban: { label: 'bannissement.', emoji: '🚫', chip: 'chip-danger' },
    post_removed: { label: 'post retiré.', emoji: '🗑️', chip: 'chip-warning' },
    message: { label: 'message.', emoji: '💬', chip: 'chip-ephemeral' },
    other: { label: 'autre.', emoji: 'ℹ️', chip: 'chip-normal' }
};

function updateCategoryPreview(selectId, previewId) {
    const select = document.getElementById(selectId);
    const preview = document.getElementById(previewId);
    if (!select || !preview) return;
    const meta = CATEGORY_META[select.value];
    if (!meta) { preview.innerHTML = ''; return; }
    preview.innerHTML = `<span class="chip ${meta.chip}">${meta.emoji} ${meta.label}</span>`;
}

function openMassEmailModal() {
    document.getElementById('mail-subject').value = '';
    document.getElementById('mail-message').value = '';
    document.getElementById('mail-category').value = 'feature';
    document.getElementById('mass-email-error').style.display = 'none';
    updateCategoryPreview('mail-category', 'mail-category-preview');
    openModal('mass-email-modal');
}



function openSendEmailModal(userId, userName, userEmail, userAvatar) {
    _emailTargetId = userId;
    document.getElementById('email-modal-name').textContent = userName;
    document.getElementById('email-modal-addr').textContent = userEmail || '';
    const av = document.getElementById('email-modal-avatar');
    av.textContent = userAvatar && userAvatar.length <= 4 ? userAvatar : (userName.charAt(0).toUpperCase() || '?');
    document.getElementById('email-modal-subject').value = '';
    document.getElementById('email-modal-message').value = '';
    document.getElementById('email-modal-category').value = 'message';
    document.getElementById('email-modal-error').style.display = 'none';
    updateCategoryPreview('email-modal-category', 'email-modal-category-preview');
    openModal('send-email-modal');
}

async function confirmSendEmail() {
    if (!_emailTargetId) return;
    const subject = document.getElementById('email-modal-subject').value.trim();
    const message = document.getElementById('email-modal-message').value.trim();
    const category = document.getElementById('email-modal-category').value;
    const errEl = document.getElementById('email-modal-error');
    const btn = document.getElementById('send-email-btn');
    errEl.style.display = 'none';

    if (!subject || !message) {
        errEl.textContent = 'Sujet et message sont requis.';
        errEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Envoi…';

    try {
        const res = await fetch(`${API}/admin/send-email`, {
            method: 'POST',
            headers: adminHeaders(),
            body: JSON.stringify({ userId: _emailTargetId, subject, message, category })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('send-email-modal');
            toast(`📧 Email envoyé à ${data.displayName} (${data.sentTo})`, 'success');
        } else {
            errEl.textContent = data.error || 'Erreur lors de l\'envoi';
            errEl.style.display = 'block';
        }
    } catch (e) {
        errEl.textContent = 'Erreur réseau : ' + e.message;
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = '📧 Envoyer';
    }
}

// Patch showPage to handle pinned page
const _origShowPage = showPage;
showPage = function (name) {
    _origShowPage(name);
    if (name === "pinned") loadPinned();
};
async function sendAnnouncementEmail() {
    const subject = document.getElementById('mail-subject').value.trim();
    const message = document.getElementById('mail-message').value.trim();
    const category = document.getElementById('mail-category').value;
    const errEl = document.getElementById('mass-email-error');
    const btn = document.getElementById('mass-email-btn');
    errEl.style.display = 'none';

    if (!subject || !message) {
        errEl.textContent = 'Sujet et message sont requis.';
        errEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Envoi…';

    try {
        const res = await fetch(`${API}/admin/send-announcement`, {
            method: 'POST',
            headers: adminHeaders(),
            body: JSON.stringify({ subject, message, category })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('mass-email-modal');
            document.getElementById('mail-subject').value = '';
            document.getElementById('mail-message').value = '';
            toast(`📧 Email envoyé à ${data.sent} utilisateur${data.sent !== 1 ? 's' : ''}`, 'success');
        } else {
            errEl.textContent = data.error || 'Erreur lors de l\'envoi';
            errEl.style.display = 'block';
        }
    } catch (e) {
        errEl.textContent = 'Erreur réseau : ' + e.message;
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = '📧 Envoyer';
    }
}
function verifiedBadge(isVerified) {
    if (!isVerified) return '';
    return `<svg class="verified-badge" width="19" height="19" viewBox="0 0 24 24" fill="#4c9eff" xmlns="http://www.w3.org/2000/svg" title="compte certifié">
        <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="#4c9eff"/>
    </svg>`;
}
/* =========================================================
   ANALYTICS ADMIN
   ========================================================= */

let analyticsDays = 30;

async function loadAnalytics(days = analyticsDays) {
    analyticsDays = Number(days) || 30;

    const container = document.getElementById('analytics-content');
    if (!container) return;

    container.innerHTML = `
        <div class="analytics-loading">
            Chargement des statistiques…
        </div>
    `;

    try {
        const response = await fetch(`/api/admin/analytics?days=${analyticsDays}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        renderAnalytics(data);
    } catch (err) {
        console.error('Erreur analytics:', err);

        container.innerHTML = `
            <div class="table-wrapper">
                <div style="
                    padding: 30px;
                    text-align: center;
                    color: var(--danger, #ef4444);
                ">
                    Impossible de charger les statistiques.
                </div>
            </div>
        `;
    }
}


function renderAnalytics(data) {
    const container = document.getElementById('analytics-content');
    if (!container) return;

    const summary = data.summary || {};
    const journey = data.journey || [];
    const sources = data.sources || [];

    const visits = Number(summary.visits || 0);
    const posts = Number(summary.posts || 0);
    const sharedVisits = Number(summary.sharedVisits || 0);

    const postsPercentage = visits > 0
        ? ((posts / visits) * 100).toFixed(1)
        : '0.0';

    container.innerHTML = `
        <div class="analytics-toolbar">
            <div></div>

            <div style="display:flex; gap:8px; align-items:center;">
                <select
                    id="analytics-period"
                    class="analytics-select"
                    onchange="loadAnalytics(this.value)"
                >
                    <option value="7" ${analyticsDays === 7 ? 'selected' : ''}>
                        7 jours
                    </option>
                    <option value="30" ${analyticsDays === 30 ? 'selected' : ''}>
                        30 jours
                    </option>
                    <option value="90" ${analyticsDays === 90 ? 'selected' : ''}>
                        90 jours
                    </option>
                </select>

                <button
                    class="btn btn-ghost"
                    onclick="loadAnalytics()"
                >
                    Actualiser
                </button>
            </div>
        </div>

        <!-- =========================
             SUMMARY CARDS
        ========================== -->

        <div class="analytics-stat-grid">

            <div class="analytics-stat-card">
                <div class="analytics-stat-label">
                    VISITES
                </div>

                <div class="analytics-stat-value cyan">
                    ${formatAnalyticsNumber(visits)}
                </div>
            </div>

            <div class="analytics-stat-card">
                <div class="analytics-stat-label">
                    POSTS PUBLIÉS
                </div>

                <div class="analytics-stat-value green">
                    ${formatAnalyticsNumber(posts)}
                </div>
            </div>

            <div class="analytics-stat-card">
                <div class="analytics-stat-label">
                    VISITES → POST
                </div>

                <div class="analytics-stat-value orange">
                    ${postsPercentage} %
                </div>
            </div>

            <div class="analytics-stat-card">
                <div class="analytics-stat-label">
                    VISITES VIA UN LIEN PARTAGÉ
                </div>

                <div class="analytics-stat-value white">
                    ${formatAnalyticsNumber(sharedVisits)}
                </div>
            </div>

        </div>


        <!-- =========================
             JOURNEY
        ========================== -->

        <div class="analytics-box">

            <div class="analytics-box-title">
                Parcours (${analyticsDays} derniers jours)
            </div>

            <div class="analytics-table-wrapper">

                <table class="analytics-table">

                    <thead>
                        <tr>
                            <th>ÉTAPE</th>
                            <th>TOTAL</th>
                            <th>% DES VISITES</th>
                        </tr>
                    </thead>

                    <tbody>

                        ${renderAnalyticsJourney(
        'Visites (sessions)',
        summary.visits
    )}

                        ${renderAnalyticsJourney(
        'Connexions en invité',
        summary.guestLogins,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Inscriptions',
        summary.registrations,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Connexions',
        summary.logins,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Posts publiés',
        summary.posts,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Stories publiées',
        summary.stories,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Feuille de partage ouverte',
        summary.shareSheetOpens,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Partages via le système',
        summary.shares,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Images enregistrées',
        summary.savedImages,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Liens copiés',
        summary.copiedLinks,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Installations de l’app',
        summary.appInstalls,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Demandes de notifications',
        summary.notificationRequests,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Notifications activées',
        summary.notificationEnabled,
        visits
    )}

                        ${renderAnalyticsJourney(
        'Notifications refusées',
        summary.notificationRefused,
        visits
    )}

                    </tbody>

                </table>

            </div>
        </div>


        <!-- =========================
             SOURCES
        ========================== -->

        <div class="analytics-box">

            <div class="analytics-box-title">
                D'où viennent les visites
            </div>

            <div class="analytics-table-wrapper">

                <table class="analytics-table">

                    <thead>
                        <tr>
                            <th>CANAL</th>
                            <th>VISITES</th>
                            <th>PART</th>
                        </tr>
                    </thead>

                    <tbody>

                        ${sources.length
            ? sources.map(source => `
                                    <tr>
                                        <td>${escapeAnalyticsHtml(source.name)}</td>
                                        <td>${formatAnalyticsNumber(source.visits)}</td>
                                        <td>
                                            ${visits > 0
                    ? ((source.visits / visits) * 100).toFixed(1)
                    : '0.0'
                } %
                                        </td>
                                    </tr>
                                `).join('')
            : `
                                    <tr>
                                        <td colspan="3" style="text-align:center; opacity:.5;">
                                            Aucune donnée
                                        </td>
                                    </tr>
                                `
        }

                    </tbody>

                </table>

            </div>

            <div class="analytics-help">
                Astuce : utilise <code>?utm_source=tiktok</code>,
                <code>?utm_source=discord</code>, etc. dans tes liens pour
                savoir quel canal fonctionne.
            </div>

        </div>


        <!-- =========================
             DAILY
        ========================== -->

        <div class="analytics-box">

            <div class="analytics-box-title">
                Jour par jour
            </div>

            <div class="analytics-table-wrapper">

                <table class="analytics-table">

                    <thead>
                        <tr>
                            <th>DATE</th>
                            <th>VISITES</th>
                            <th>INVITÉS + INSCRITS</th>
                            <th>POSTS</th>
                            <th>PARTAGES</th>
                        </tr>
                    </thead>

                    <tbody>

                        ${journey.length
            ? journey.map(day => `
                                    <tr>
                                        <td>${escapeAnalyticsHtml(day.date)}</td>

                                        <td>
                                            ${formatAnalyticsNumber(day.visits)}
                                        </td>

                                        <td>
                                            ${formatAnalyticsNumber(
                Number(day.guestLogins || 0) +
                Number(day.registrations || 0)
            )}
                                        </td>

                                        <td>
                                            ${formatAnalyticsNumber(day.posts)}
                                        </td>

                                        <td>
                                            ${formatAnalyticsNumber(day.shares)}
                                        </td>
                                    </tr>
                                `).join('')
            : `
                                    <tr>
                                        <td colspan="5" style="text-align:center; opacity:.5;">
                                            Aucune donnée
                                        </td>
                                    </tr>
                                `
        }

                    </tbody>

                </table>

            </div>
        </div>
    `;

    injectAnalyticsStyles();
}


/* =========================================================
   HELPERS
   ========================================================= */

function renderAnalyticsJourney(label, value, total = null) {
    const number = Number(value || 0);

    let percentage = '0.0';

    if (total !== null && Number(total) > 0) {
        percentage = ((number / Number(total)) * 100).toFixed(1);
    }

    return `
        <tr>
            <td>${escapeAnalyticsHtml(label)}</td>
            <td>${formatAnalyticsNumber(number)}</td>
            <td>${percentage} %</td>
        </tr>
    `;
}


function formatAnalyticsNumber(value) {
    return Number(value || 0).toLocaleString('fr-FR');
}


function escapeAnalyticsHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


/* =========================================================
   CSS DE LA PAGE
   ========================================================= */

function injectAnalyticsStyles() {
    if (document.getElementById('analytics-styles')) return;

    const style = document.createElement('style');
    style.id = 'analytics-styles';

    style.textContent = `

        .analytics-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 18px;
        }

        .analytics-select {
            background: var(--surface2);
            border: 1px solid var(--border);
            color: var(--text);
            border-radius: 8px;
            padding: 9px 12px;
            outline: none;
        }

        .analytics-stat-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 24px;
        }

        .analytics-stat-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 18px;
            min-height: 92px;
        }

        .analytics-stat-label {
            color: var(--muted);
            font-size: 10px;
            letter-spacing: .08em;
            text-transform: uppercase;
            margin-bottom: 10px;
        }

        .analytics-stat-value {
            font-size: 26px;
            font-weight: 700;
            line-height: 1;
        }

        .analytics-stat-value.cyan {
            color: #00cfeb;
        }

        .analytics-stat-value.green {
            color: #22c55e;
        }

        .analytics-stat-value.orange {
            color: #f59e0b;
        }

        .analytics-stat-value.white {
            color: #e5e7eb;
        }

        .analytics-box {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 11px;
            overflow: hidden;
            margin-bottom: 14px;
        }

        .analytics-box-title {
            padding: 15px;
            font-size: 13px;
            font-weight: 700;
            border-bottom: 1px solid var(--border);
        }

        .analytics-table-wrapper {
            width: 100%;
            overflow-x: auto;
        }

        .analytics-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        }

        .analytics-table th {
            background: rgba(255,255,255,.025);
            color: var(--muted);
            font-size: 9px;
            letter-spacing: .08em;
            text-align: left;
            padding: 10px 14px;
            font-weight: 500;
        }

        .analytics-table th:not(:first-child),
        .analytics-table td:not(:first-child) {
            text-align: right;
        }

        .analytics-table td {
            padding: 10px 14px;
            border-top: 1px solid var(--border);
            color: var(--text);
        }

        .analytics-table td:last-child {
            color: var(--muted);
        }

        .analytics-help {
            padding: 11px 14px;
            font-size: 10px;
            color: var(--muted);
            border-top: 1px solid var(--border);
        }

        .analytics-help code {
            color: var(--text);
            font-family: monospace;
        }

        .analytics-loading {
            padding: 50px;
            text-align: center;
            color: var(--muted);
        }

        @media (max-width: 900px) {
            .analytics-stat-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        @media (max-width: 550px) {
            .analytics-stat-grid {
                grid-template-columns: 1fr;
            }
        }
    `;

    document.head.appendChild(style);
}


/* =========================================================
   TRACKING CÔTÉ CLIENT
   ========================================================= */

const OIFEEL_ANALYTICS_SESSION_KEY = 'oifeel_analytics_session';


function getAnalyticsSessionId() {
    let id = localStorage.getItem(OIFEEL_ANALYTICS_SESSION_KEY);

    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(OIFEEL_ANALYTICS_SESSION_KEY, id);
    }

    return id;
}


function getAnalyticsSource() {
    const params = new URLSearchParams(window.location.search);

    return (
        params.get('utm_source') ||
        params.get('source') ||
        'direct'
    ).toLowerCase();
}


function trackAnalytics(event, extra = {}) {
    const payload = {
        event,
        sessionId: getAnalyticsSessionId(),
        source: getAnalyticsSource(),
        path: window.location.pathname,
        ...extra
    };

    fetch('/api/analytics/track', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify(payload)
    }).catch(() => { });
}


/* Une visite par session */
function trackAnalyticsVisit() {
    const key = 'oifeel_analytics_visit_sent';

    if (sessionStorage.getItem(key)) return;

    sessionStorage.setItem(key, '1');

    trackAnalytics('visit');
}


/* Exposer pour le reste de l'app */
window.trackAnalytics = trackAnalytics;
window.trackAnalyticsVisit = trackAnalyticsVisit;
window.loadAnalytics = loadAnalytics;
window.renderAnalytics = renderAnalytics;


/* L'admin lui-même ne doit normalement pas gonfler les visites */