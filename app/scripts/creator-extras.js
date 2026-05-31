// ============================================================
// creator-extras.js — Améliorations du créateur de posts
// • Palette de 12 dégradés prédéfinis
// • Sauvegarde automatique du brouillon
// • Mode focus (masquer tout sauf le créateur)
// • Post anonyme (checkbox)
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

function _init() {
    _injectColorPresets();
    _initDraftAutosave();
    _initFocusMode();
    _initMentions();
    _restoreDraft();
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
            // Appliquer le dégradé au preview et stocker dans un data attribute
            const previewCard = document.getElementById('previewCard') || document.getElementById('previewMood');
            if (previewCard) previewCard.style.background = preset.value;

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
            colorInput.dataset.gradient = draft.gradient;
            const preview = document.getElementById('previewCard') || document.getElementById('previewMood');
            if (preview) preview.style.background = draft.gradient;
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

// ─── 4. Post anonyme ────────────────────────────────────────
export function getAnonymousFlag() {
    return !!document.getElementById('anon-toggle')?.checked;
}



// ─── 5. @Mentions ───────────────────────────────────────────
const API = 'https://moodshare-7dd7.onrender.com/api';

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
        const res = await fetch(`${API}/users/search?q=${encodeURIComponent(query)}&limit=5`);
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