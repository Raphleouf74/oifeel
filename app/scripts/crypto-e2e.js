// ============================================================
// crypto-e2e.js — Chiffrement de bout en bout (E2EE)
// Algorithme : ECDH P-256 + HKDF + AES-GCM 256-bit
// Clés privées stockées uniquement dans IndexedDB (jamais transmises).
// Clés publiques sur le serveur, ciphertext uniquement en base.
// v2 — retry, cache, fallback robuste
// ============================================================

const API = 'https://moodshare-7dd7.onrender.com/api';
const DB_NAME = 'moodshare_e2e';
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

    console.log('🔑 Nouvelle paire E2E générée pour', userId);
    return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, publicKeyB64: _jwkToB64(publicKeyJwk) };
}

// ─── Enregistrement de la clé publique (avec retry) ─────────

/**
 * Enregistre la clé publique sur le serveur.
 * Retente jusqu'à 5 fois avec délai croissant.
 */
export async function registerPublicKey(publicKeyB64, maxRetries = 5) {
    const token = localStorage.getItem('moodshare_token');
    if (!token) {
        console.warn('⚠️  E2E: pas de token, clé non enregistrée');
        return false;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(`${API}/users/public-key`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include',
                body: JSON.stringify({ publicKey: publicKeyB64 })
            });

            if (res.ok) {
                console.log(`✅ Clé E2E enregistrée sur le serveur (tentative ${attempt})`);
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
    // 1. Cache mémoire
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
        const res = await fetch(`${API}/users/${userId}/public-key`, {
            credentials: 'include',
            cache: 'no-store'
        });

        if (!res.ok) {
            _pubKeyMemCache.set(userId, null);
            return null;
        }

        const data = await res.json();

        if (!data.publicKey) {
            // Pas encore de clé E2E pour cet utilisateur
            _pubKeyMemCache.set(userId, null);
            return null;
        }

        // Mettre en cache
        await _dbSet(`pubkey_${userId}`, { b64: data.publicKey, cachedAt: Date.now() });
        const key = await _importPublicKeyB64(data.publicKey);
        _pubKeyMemCache.set(userId, key);
        return key;

    } catch (err) {
        console.warn('⚠️  fetchPublicKey réseau:', err.message);
        _pubKeyMemCache.set(userId, null);
        return null;
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
            salt: new TextEncoder().encode('moodshare-e2e-v1'),
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