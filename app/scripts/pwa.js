// pwa.js — installation de l'app (PWA), notifications push et réglages associés.
//
// Rien ne s'active tout seul : la permission de notifier n'est JAMAIS demandée au
// chargement. On la propose après le premier post (moment où l'app a apporté quelque
// chose) et dans réglages > notifications.
import { API_BASE, authHeaders } from './config.js';
import { track } from './analytics.js';

const ua = navigator.userAgent || '';
export const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let deferredInstall = null;
let swReg = null;
let notify = () => { };
let publicKeyCache; // undefined = pas encore demandé, null = push désactivé côté serveur

// ─── service worker + installation ───────────────────────────

export function initPwa(opts = {}) {
    if (opts.notify) notify = opts.notify;

    if ('serviceWorker' in navigator) {
        const register = () => navigator.serviceWorker.register('/sw.js')
            .then((reg) => { swReg = reg; })
            .catch((err) => console.warn('Service worker :', err));
        if (document.readyState === 'complete') register();
        else window.addEventListener('load', register, { once: true });

        // clic sur une notification alors que l'app est déjà ouverte
        navigator.serviceWorker.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'open-url') openUrl(e.data.url);
        });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstall = e;
        refreshNotificationSettings();
    });
    window.addEventListener('appinstalled', () => {
        deferredInstall = null;
        track('pwa_installed');
        refreshNotificationSettings();
    });

    // lien du type /#create (rappel du soir) : ouvre l'onglet correspondant
    window.addEventListener('load', () => setTimeout(() => openUrl(location.href), 900), { once: true });

    initNotificationSettings();
}

function openUrl(raw) {
    try {
        const u = new URL(raw, location.origin);
        if (u.origin !== location.origin) return;
        if (u.hash.startsWith('#post-')) {
            if (location.hash !== u.hash) location.hash = u.hash;
        } else if (u.hash === '#create') {
            document.querySelector('nav a#create')?.click();
        }
    } catch (_) { }
}

export async function promptInstall() {
    if (!deferredInstall) return false;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferredInstall = null;
    refreshNotificationSettings();
    return outcome === 'accepted';
}

// ─── push : état et actions ──────────────────────────────────

export function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
// Sur iPhone/iPad, le push Web ne marche que pour une app ajoutée à l'écran d'accueil.
export function needsInstallFirst() { return isIOS && !isStandalone(); }

async function getPublicKey() {
    if (publicKeyCache !== undefined) return publicKeyCache;
    try {
        const res = await fetch(`${API_BASE}/api/push/public-key`);
        const data = await res.json();
        publicKeyCache = data && data.enabled ? data.publicKey : null;
    } catch (_) { publicKeyCache = null; }
    return publicKeyCache;
}

async function getRegistration() {
    return swReg || navigator.serviceWorker.ready;
}

function urlB64ToUint8Array(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function api(path, method = 'GET', body) {
    const res = await fetch(`${API_BASE}/api/${path}`, {
        method,
        headers: authHeaders(body ? { 'Content-Type': 'application/json' } : {}),
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json().catch(() => ({}));
}

export async function getPushEnv() {
    const supported = pushSupported();
    const serverEnabled = supported ? !!(await getPublicKey()) : false;
    let subscribedHere = false;
    if (supported && serverEnabled) {
        try {
            const reg = await getRegistration();
            subscribedHere = !!(await reg.pushManager.getSubscription());
        } catch (_) { }
    }
    return {
        supported,
        serverEnabled,
        permission: supported ? Notification.permission : 'denied',
        subscribedHere,
        needsInstall: needsInstallFirst(),
        loggedIn: !!localStorage.getItem('oifeel_token')
    };
}

export async function enablePush({ dailyReminder = false } = {}) {
    if (!pushSupported()) throw new Error('unsupported');
    if (!localStorage.getItem('oifeel_token')) throw new Error('not_logged_in');
    const key = await getPublicKey();
    if (!key) throw new Error('server_disabled');

    track('push_prompt_shown');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { track('push_denied'); throw new Error('denied'); }

    const reg = await getRegistration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });

    await api('push/subscribe', 'POST', { subscription: sub.toJSON(), dailyReminder });
    track('push_enabled');
    return true;
}

export async function disablePush() {
    const reg = await getRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => { });
        await api('push/unsubscribe', 'POST', { endpoint }).catch(() => { });
    }
}

export const getPushStatus = () => api('push/status');
export const updatePushPrefs = (patch) => api('push/preferences', 'PATCH', patch);
export const sendTestPush = () => api('push/test', 'POST', {});

// À appeler après chaque post publié : évite le rappel du soir à quelqu'un qui a déjà posté.
export function notifyPosted() {
    if (!localStorage.getItem('oifeel_token')) return;
    api('push/posted', 'POST', {}).catch(() => { });
}

// ─── proposition après un post ───────────────────────────────

const DISMISS_KEY = 'oifeel_push_prompt_dismissed_at';
const DISMISS_DAYS = 14;

export async function maybeAskPushAfterPost() {
    try {
        if (!pushSupported() || needsInstallFirst()) return;
        if (Notification.permission !== 'default') return;
        if (!localStorage.getItem('oifeel_token')) return;
        const last = Number(localStorage.getItem(DISMISS_KEY) || 0);
        if (Date.now() - last < DISMISS_DAYS * 86400000) return;
        if (document.getElementById('pushBanner')) return;
        if (!(await getPublicKey())) return;
        setTimeout(showPushBanner, 1800);
    } catch (_) { /* jamais bloquant */ }
}

function showPushBanner() {
    if (document.getElementById('pushBanner')) return;
    const el = document.createElement('div');
    el.id = 'pushBanner';
    el.className = 'pwa-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'activer les notifications');
    el.innerHTML = `
        <div class="pwa-banner-text">
            <strong>un rappel le soir ?</strong>
            <span>un petit message pour poser ton humeur du jour. tu peux l'arrêter quand tu veux.</span>
        </div>
        <div class="pwa-banner-actions">
            <button type="button" class="pwa-btn pwa-btn--primary" data-yes>oui, activer</button>
            <button type="button" class="pwa-btn" data-no>plus tard</button>
        </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('shown'));

    const hide = () => { el.classList.remove('shown'); setTimeout(() => el.remove(), 250); };
    el.querySelector('[data-no]').addEventListener('click', () => {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
        hide();
    });
    el.querySelector('[data-yes]').addEventListener('click', async () => {
        hide();
        try {
            await enablePush({ dailyReminder: true });
            notify('success', 'notifications activées — rappel chaque soir à 19h');
        } catch (err) {
            if (err.message === 'denied') {
                localStorage.setItem(DISMISS_KEY, String(Date.now()));
                notify('info', 'pas de souci, tu pourras les activer dans réglages > notifications');
            } else {
                notify('error', 'impossible d\'activer les notifications pour le moment');
            }
        }
    });
}

// ─── réglages > notifications ────────────────────────────────

const $id = (id) => document.getElementById(id);
let settingsBound = false;

function setMsg(text, kind) {
    const el = $id('pushMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'account-msg' + (kind ? ` ${kind}` : '');
}

function show(id, visible) { const el = $id(id); if (el) el.hidden = !visible; }

export async function refreshNotificationSettings() {
    if (!$id('account-tab-notifications')) return;

    // installation
    const standalone = isStandalone();
    show('pwaInstallBlock', !standalone && (!!deferredInstall || isIOS));
    show('pwaInstallBtn', !!deferredInstall && !standalone);
    show('pwaIosHint', isIOS && !standalone);

    const env = await getPushEnv();
    const note = $id('pushNote');
    const setNote = (t) => { if (note) { note.textContent = t; note.hidden = !t; } };

    show('pushEnableBtn', false);
    show('pushControls', false);

    if (!env.supported) return setNote('ce navigateur ne gère pas les notifications.');
    if (!env.serverEnabled) return setNote('les notifications ne sont pas encore disponibles.');
    if (env.needsInstall) return setNote('sur iPhone, ajoute d\'abord oifeel. à l\'écran d\'accueil pour recevoir des notifications.');
    if (!env.loggedIn) return setNote('connecte-toi (ou continue en invité) pour activer les notifications.');
    if (env.permission === 'denied') return setNote('les notifications sont bloquées : autorise-les dans les réglages du site de ton navigateur.');

    setNote('');
    if (!env.subscribedHere) { show('pushEnableBtn', true); return; }

    show('pushControls', true);
    try {
        const s = await getPushStatus();
        const social = $id('pushSocialToggle');
        const daily = $id('pushDailyToggle');
        if (social) social.checked = s.social !== false;
        if (daily) daily.checked = s.dailyReminder === true;
    } catch (_) { /* on garde l'état affiché */ }
}

function initNotificationSettings() {
    if (settingsBound || !$id('account-tab-notifications')) return;
    settingsBound = true;

    document.querySelector('.account-tab[data-tab="notifications"]')
        ?.addEventListener('click', () => { setMsg(''); refreshNotificationSettings(); });

    $id('pushEnableBtn')?.addEventListener('click', async () => {
        setMsg('');
        try {
            await enablePush({ dailyReminder: false });
            setMsg('notifications activées ✓', 'success');
        } catch (err) {
            setMsg(err.message === 'denied' ? 'permission refusée par le navigateur.' : 'activation impossible pour le moment.', 'error');
        }
        refreshNotificationSettings();
    });

    $id('pushDisableBtn')?.addEventListener('click', async () => {
        setMsg('');
        await disablePush().catch(() => { });
        setMsg('notifications désactivées sur cet appareil.', 'success');
        refreshNotificationSettings();
    });

    $id('pushTestBtn')?.addEventListener('click', async () => {
        setMsg('');
        try {
            const r = await sendTestPush();
            setMsg(r.sent ? 'notification envoyée — regarde ton écran !' : 'aucun appareil abonné.', r.sent ? 'success' : 'error');
        } catch (_) { setMsg('envoi impossible (réessaie dans 30 secondes).', 'error'); }
    });

    $id('pushSocialToggle')?.addEventListener('change', (e) =>
        updatePushPrefs({ social: e.target.checked }).catch(() => setMsg('modification impossible.', 'error')));
    $id('pushDailyToggle')?.addEventListener('change', (e) =>
        updatePushPrefs({ dailyReminder: e.target.checked }).catch(() => setMsg('modification impossible.', 'error')));

    $id('pwaInstallBtn')?.addEventListener('click', () => promptInstall());
}
