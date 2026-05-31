
// assets/js/auth.js
// Détection simple : en dev (localhost/127.0.0.1 ou 127.0.0.1) on utilise le backend local,
// sinon on utilise l'URL de production (Render)
const API_BASE = "https://moodshare-7dd7.onrender.com";
const API = API_BASE + '/api/';


export function getToken() {
  return localStorage.getItem('moodshare_token');
}

export function setToken(t) {
  localStorage.setItem('moodshare_token', t);
}

export function clearToken() {
  localStorage.removeItem('moodshare_token');
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
      console.log('User is banned:', errorData);
    }
    throw new Error(txt || 'Login failed');
  }
  const data = await res.json();
  // server may return an access token in body and a user object
  if (data && data.token) setToken(data.token);
  return data.user || data;
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
  if (userName) userName.textContent = 'UserName';
  if (userNameProfile) userNameProfile.textContent = 'USERNAME';
  if (userIDspan) userIDspan.textContent = 'Connectez tu';
  if (accountAvatar) accountAvatar.alt = '';
  saveProfileLocal({});
  // Hide ban screen if shown
  const banOverlay = document.getElementById('ban-overlay');
  if (banOverlay) banOverlay.classList.add('hidden');
}

function showBanScreen(banData) {
  console.log('🚫 Affichage écran de ban:', banData);
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

  function showModal(register = false) {
    isRegister = register;
    authTitle.textContent = register ? "Inscription" : 'Connexion';
    if (authModalForm) authModalForm.classList.add('shown');
    if (authModal) authModal.style.display = 'block';
    // focus username
    setTimeout(() => usernameInput && usernameInput.focus(), 100);
  }
  function hideModal() {
    if (authModalForm) authModalForm.classList.remove('shown');
    if (authModal) authModal.style.display = 'none';
    usernameInput && (usernameInput.value = '');
    passwordInput && (passwordInput.value = '');
  }

  if (openLogin) openLogin.addEventListener('click', () => showModal(false));
  if (openRegister) openRegister.addEventListener('click', () => showModal(true));
  cancelBtn.addEventListener('click', hideModal);
  if (authForm) authForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      if (isRegister) {
        const user = await registerUser(usernameInput.value, passwordInput.value);
        const uname = (user && (user.displayName || user.display_name || user.username)) || usernameInput.value || 'UserName';
        userName.textContent = uname;
        userNameProfile.textContent = uname;
        userIDspan.textContent = user.id;
        saveProfileLocal({ displayName: uname });
      } else {
        const user = await loginUser(usernameInput.value, passwordInput.value);
        const uname = (user && (user.displayName || user.display_name || user.username)) || usernameInput.value || 'UserName';
        userName.textContent = uname;
        userNameProfile.textContent = uname;
        userIDspan.textContent = user.id;
        saveProfileLocal({ displayName: uname });
      }
      hideModal();
      if (openLogin) openLogin.classList.add('hidden');
      if (openRegister) openRegister.classList.add('hidden');
      if (guestBtn) guestBtn.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.remove('hidden');
      if (accountHeader) accountHeader.classList.remove('hidden');
      // 🔥 Émettre événement de connexion
      document.dispatchEvent(new CustomEvent('userLoggedIn'));
    } catch (err) {
      alert(err.message);
    }
  });

  if (guestBtn) guestBtn.addEventListener('click', async () => {
    try {
      const user = await loginGuest();
      const uname = (user && (user.displayName || user.display_name || user.username)) || 'Invité';
      userName.textContent = uname;
      userNameProfile.textContent = uname;
      userIDspan.textContent = user.id;
      saveProfileLocal({ displayName: uname });
      if (openLogin) openLogin.classList.add('hidden');
      if (openRegister) openRegister.classList.add('hidden');
      if (guestBtn) guestBtn.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.remove('hidden');
      if (accountHeader) accountHeader.classList.remove('hidden');
      // 🔥 Émettre événement de connexion
      document.dispatchEvent(new CustomEvent('userLoggedIn'));
      hideModal();
    } catch (err) {
      alert(err.message || 'Guest login failed');
    }
  });

  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    await logout();
    // clear UI
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (openLogin) openLogin.classList.remove('hidden');
    if (openRegister) openRegister.classList.remove('hidden');
    if (guestBtn) guestBtn.classList.remove('hidden');
    // restore stored profile name or default
    const saved = loadProfileLocal();
    userName.textContent = saved && saved.displayName ? saved.displayName : 'UserName';
    userNameProfile.textContent = saved && saved.displayName ? saved.displayName : 'UserName';
    userIDspan.textContent = saved && saved.id ? saved.id : 'Connectez tu';
  });

  // Small helpers to persist simple profile prefs locally
  function saveProfileLocal(data) {
    try {
      const cur = JSON.parse(localStorage.getItem('moodshare_profile') || '{}');
      const next = { ...cur, ...data };
      localStorage.setItem('moodshare_profile', JSON.stringify(next));
      applyProfileToUI(next);
    } catch (e) { /* ignore */ }
  }
  function loadProfileLocal() {
    try { return JSON.parse(localStorage.getItem('moodshare_profile') || '{}'); } catch (e) { return {}; }
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
      const uname = (user && (user.displayName || user.display_name || user.username)) || localProfile.displayName || 'UserName';
      // userName.textContent = uname;
      saveProfileLocal({ displayName: uname });
      if (openLogin) openLogin.classList.add('hidden');
      if (openRegister) openRegister.classList.add('hidden');
      if (guestBtn) guestBtn.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.remove('hidden');
      if (accountHeader) accountHeader.classList.remove('hidden');
    } else {
      if (logoutBtn) logoutBtn.classList.add('hidden');
      if (openLogin) openLogin.classList.remove('hidden');
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
        <label>Nom d'affichage<br><input id="profileDisplayName" placeholder="Votre pseudo" /></label>
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
        alert('Profil enregistré');
      });
    } catch (e) { console.error('profile inject error', e); }
  }

  injectProfileSettings();
});
// Expose logout globally for ban screen
window.logout = logout;