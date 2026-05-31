// scripts/messages.js
import { fetchWithAuth, getCurrentUser } from './auth.js';
import {
    ensureKeyPair,
    registerPublicKey,
    fetchPublicKey,
    getSharedKey,
    encryptMessage,
    decryptMessage,
    invalidatePubKeyCache
} from './crypto-e2e.js';

const API = 'https://moodshare-7dd7.onrender.com/api';
const MESSAGE_CACHE_KEY = 'moodshare_messages_cache';

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

let currentUserId = null;
let currentConversation = null;
let _myPrivateKey = null;
let _myPublicKeyB64 = null;
let unreadMessages = 0;
let _e2eReady = false; // true si les clés sont enregistrées sur le serveur
let _selectedStickerUrl = null;
let _stickerOverlay = null;
const TENOR_V1_KEY = 'LIVDSRZULELA';

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
            console.log('🔐 Clés E2E pres (clé déjà enregistrée)');
            _e2eReady = true;
            return;
        }

        // Pas encore enregistrée → tenter l'enregistrement
        console.log('🔐 Enregistrement de la clé E2E…');
        const ok = await registerPublicKey(publicKeyB64, 5);
        _e2eReady = ok;

        if (ok) {
            // Invalider le cache pour forcer re-fetch au prochain accès
            invalidatePubKeyCache(userId);
            console.log('🔐 Clés E2E pres (nouvelle clé enregistrée)');
        } else {
            console.warn('⚠️  E2E: clé non enregistrée — messages en clair');
            // Réessayer en arrière-plan dans 30s
            setTimeout(() => _retryE2ERegistration(userId, publicKeyB64), 30_000);
        }
    } catch (err) {
        console.error('❌ E2E init error:', err);
    }
}

async function _retryE2ERegistration(userId, publicKeyB64) {
    if (_e2eReady) return;
    console.log('🔁 E2E retry registration…');
    const ok = await registerPublicKey(publicKeyB64, 3);
    if (ok) {
        _e2eReady = true;
        invalidatePubKeyCache(userId);
        console.log('✅ E2E clé enregistrée après retry');
        // Mettre à jour le badge dans la conv ouverte
        if (currentConversation) _showE2EBadge(currentConversation.otherUserId);
    } else {
        setTimeout(() => _retryE2ERegistration(userId, publicKeyB64), 60_000);
    }
}

// ─── Init messages ────────────────────────────────────────────
async function initMessages() {
    const user = await getCurrentUser();
    if (!user) { console.log('⚠️ Messages require login'); return; }

    currentUserId = user.id;
    if (window._messagesInitialized) return;
    window._messagesInitialized = true;

    // Init E2E (non bloquant)
    _initE2E(currentUserId);

    // SSE pour messages temps réel
    try {
        const es = new EventSource(`${API}/stream`, { withCredentials: true });
        es.addEventListener('new_message', async (e) => {
            try {
                const data = JSON.parse(e.data);
                const { conversationId, message, participants } = data;
                if (!participants?.includes(currentUserId)) return;
                if (message.senderId === currentUserId) return;

                const decrypted = await _tryDecrypt(message, conversationId);
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
    createStickerPicker();
    injectStickerButton();
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
        <input type="text" id="user-search-input" placeholder="Rechercher un utilisateur..." autofocus />
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

function createStickerPicker() {
    if (document.getElementById('message-sticker-overlay')) return;

    _stickerOverlay = document.createElement('div');
    _stickerOverlay.id = 'message-sticker-overlay';
    _stickerOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:none;align-items:center;justify-content:center;padding:20px;z-index:10000;background:rgba(0,0,0,.5);';
    _stickerOverlay.innerHTML = `
        <div style="width:90%;max-height:90vh;background:#fff;border-radius:5px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.2);">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #eee;">
                <div>
                    <strong style="font-size:1rem;">Choisir un sticker</strong>
                    <div style="font-size:.9rem;color:#666;">Recherche Tenor GIF</div>
                </div>
                <button id="close-sticker-picker" style="border:none;background:none;font-size:1.5rem;line-height:1;cursor:pointer;">×</button>
            </div>
            <div style="padding:14px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <input id="sticker-search-input" type="text" placeholder="Rechercher un sticker..." style="flex:1;min-width:180px;padding:10px 12px;border:1px solid #ccc;border-radius:5px;outline:none;" />
                <button id="sticker-search-btn" style="padding:10px 16px;border:none;border-radius:5px;background:#2d8cff;color:#fff;cursor:pointer;">Rechercher</button>
            </div>
            <div id="sticker-results" style="padding:0 16px 16px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;"></div>
        </div>
    `;
    document.body.appendChild(_stickerOverlay);

    _stickerOverlay.addEventListener('click', (e) => {
        if (e.target === _stickerOverlay) {
            _stickerOverlay.style.display = 'none';
        }
    });

    document.getElementById('close-sticker-picker').addEventListener('click', () => {
        _stickerOverlay.style.display = 'none';
    });

    document.getElementById('sticker-search-btn').addEventListener('click', () => {
        const q = document.getElementById('sticker-search-input').value.trim();
        if (q) _searchStickers(q);
    });

    document.getElementById('sticker-search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const q = document.getElementById('sticker-search-input').value.trim();
            if (q) _searchStickers(q);
        }
    });
}

function injectStickerButton() {
    const wrapper = document.querySelector('.messages-input-wrap');
    if (!wrapper || document.getElementById('sticker-button')) return;

    const button = document.createElement('button');
    button.id = 'sticker-button';
    button.type = 'button';
    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sticker-icon lucide-sticker"><path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/><path d="M8 13h.01"/><path d="M16 13h.01"/><path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1"/></svg><h3>Sticker</h3>';
    button.title = 'Ajouter un sticker';
    button.style.cssText = 'display:flex;flex-direction:row;justify-content:space-evenly;align-items:center;margin-right:8px;padding:0 12px;border:none;border-radius:5px;background:#f3f4f6;color:#111;cursor:pointer;';

    button.addEventListener('click', () => {
        _stickerOverlay.style.display = 'flex';
        if (!document.getElementById('sticker-results').children.length) {
            _loadTrendingStickers();
        }
    });

    wrapper.insertBefore(button, wrapper.firstChild);

    const preview = document.createElement('div');
    preview.id = 'sticker-preview';
    preview.style.cssText = 'display:none;padding:8px 12px;margin-top:10px;border:1px solid #e2e8f0;border-radius:5px;background:#fafafa;max-width:260px;';
    wrapper.parentNode.insertBefore(preview, wrapper.nextSibling);
}

function _updateStickerPreview() {
    const preview = document.getElementById('sticker-preview');
    if (!preview) return;
    if (_selectedStickerUrl) {
        preview.style.display = 'flex';
        preview.style.alignItems = 'center';
        preview.style.justifyContent = 'space-between';
        preview.innerHTML = `
            <img src="${_selectedStickerUrl}" alt="Sticker" style="max-width:120px;max-height:96px;border-radius:5px;object-fit:contain;" />
            <button id="clear-sticker-btn" style="margin-left:10px;padding:6px 10px;border:none;border-radius:5px;background:#ef4444;color:#fff;cursor:pointer;">Supprimer</button>
        `;
        document.getElementById('clear-sticker-btn').addEventListener('click', () => {
            _selectedStickerUrl = null;
            _updateStickerPreview();
        });
    } else {
        preview.style.display = 'none';
        preview.innerHTML = '';
    }
}

async function _loadTrendingStickers() {
    const results = document.getElementById('sticker-results');
    if (!results) return;
    results.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:#666;">Chargement des stickers...</div>';
    try {
        const res = await fetch(`https://g.tenor.com/v1/trending?key=${TENOR_V1_KEY}&limit=24`);
        const data = await res.json();
        if (!data.results || !data.results.length) {
            results.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:#666;">Aucun sticker trouvé</div>';
            return;
        }
        _renderStickerResults(data.results);
    } catch (err) {
        console.error('❌ Chargement stickers échoué:', err);
        results.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:#666;">Erreur de chargement</div>';
    }
}

async function _searchStickers(query) {
    const results = document.getElementById('sticker-results');
    if (!results) return;
    results.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:#666;">Recherche...</div>';
    try {
        const res = await fetch(`https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${TENOR_V1_KEY}&limit=24`);
        const data = await res.json();
        if (!data.results || !data.results.length) {
            results.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:#666;">Aucun résultat</div>';
            return;
        }
        _renderStickerResults(data.results);
    } catch (err) {
        console.error('❌ Recherche stickers échouée:', err);
        results.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:#666;">Erreur de recherche</div>';
    }
}

function _renderStickerResults(items) {
    const results = document.getElementById('sticker-results');
    if (!results) return;
    results.innerHTML = '';
    items.forEach(item => {
        const media = item.media?.[0];
        const gifUrl = media?.gif?.url || media?.tinygif?.url || media?.mediumgif?.url;
        const thumbUrl = media?.nanogif?.url || media?.tinygif?.url || gifUrl;
        if (!gifUrl) return;
        const div = document.createElement('div');
        div.style.cssText = 'border-radius:5px;overflow:hidden;cursor:pointer;position:relative;';
        div.innerHTML = `<img src="${thumbUrl}" alt="Sticker" style="width:100%;height:100%;object-fit:cover;display:block;"/>`;
        div.addEventListener('click', () => {
            _selectedStickerUrl = gifUrl;
            _updateStickerPreview();
            _stickerOverlay.style.display = 'none';
        });
        results.appendChild(div);
    });
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
                <button class="btn-start-chat">Message</button>`;
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
                    const plain = await _tryDecrypt(lastMsg, convId);
                    preview = plain ? plain.substring(0, 60) : '🔒 Message chiffré';
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
    if (el) el.innerHTML = '<p class="empty">Tu n\'es pas connecté(e), connectez tu afin de discuter !</p>';
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
            const plain = await _tryDecrypt(msg, convId);
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
                empty.textContent = 'Message vide';
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
    _selectedStickerUrl = null;
    _updateStickerPreview();

    // Envoi au serveur (payload chiffré)
    fetch(`${API}/conversations/${otherUserId}/messages`, {
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
async function _tryDecrypt(msg, convId) {
    if (!msg.content || !msg.encrypted || !_myPrivateKey) return null;
    try {
        const theirKey = await fetchPublicKey(msg.senderId);
        if (!theirKey) return null;
        const aesKey = await getSharedKey(_myPrivateKey, theirKey, convId);
        return await decryptMessage(msg.content, aesKey);
    } catch {
        return null;
    }
}

// ─── Partage de post ──────────────────────────────────────────
window.sharePostInMessage = async function (postId, otherUserId) {
    if (!currentUserId) { alert('Connexion requise'); return; }
    try {
        const res = await fetch(`${API}/conversations/${otherUserId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ sharedPostId: postId })
        });
        if (res.ok) alert('Post partagé !');
    } catch (err) { console.error('Share error:', err); }
};