const SOUNDS_PATH = '/app/assets/sounds/';
const ENABLED_STORAGE_KEY = 'oifeel_sfx_enabled';
const DEFAULT_SOUNDS = {
    click: 'deck_ui_default_activation.wav',
    hover: 'deck_ui_misc_10.wav',
    menu_open: 'deck_ui_side_menu_fly_in.wav',
    menu_close: 'deck_ui_side_menu_fly_out.wav',
    'show-menu': 'deck_ui_side_menu_fly_in.wav',
    'hide-menu': 'deck_ui_side_menu_fly_out.wav',
    'post-sent': 'deck_ui_launch_game.wav',
    error: 'confirmation_negative.wav',
    scroll: 'deck_ui_tile_scroll.wav',
    like: 'deck_ui_out_of_game_detail.wav',
    'remove-like': 'bumper_end.wav',
};
const INTERACTIVE_SELECTOR = 'button, a, [role="button"], input[type="button"], input[type="submit"]';

const audioPlayers = new Map();
let enabled = readEnabledPreference();

function readEnabledPreference() {
    try {
        return localStorage.getItem(ENABLED_STORAGE_KEY) !== 'false';
    } catch (error) {
        console.warn('Impossible de lire la préférence des sons', error);
        return true;
    }
}
// normal: volume=10
export function playSfx(filename, { volume = 0 } = {}) {
    if (!enabled) return;
    if (typeof filename !== 'string' || !/^[a-z0-9_-]+\.(wav|m4a)$/i.test(filename)) {
        console.warn('Nom de son invalide', filename);
        return;
    }

    let audio = audioPlayers.get(filename);
    if (!audio) {
        audio = new Audio(`${SOUNDS_PATH}${filename}`);
        audio.preload = 'auto';
        audioPlayers.set(filename, audio);
    }

    audio.volume = Math.max(0, Math.min(1, volume));
    audio.currentTime = 0;
    audio.play().catch((error) => {
        if (error.name !== 'NotAllowedError') {
            console.warn(`Impossible de jouer le son "${filename}"`, error);
        }
    });
}

export function setSfxEnabled(value) {
    enabled = Boolean(value);
    try {
        localStorage.setItem(ENABLED_STORAGE_KEY, String(enabled));
    } catch (error) {
        console.warn('Impossible d’enregistrer la préférence des sons', error);
    }
    return enabled;
}

export function playControlSfx(control, action) {
    if (!control || typeof control.getAttribute !== 'function' || typeof action !== 'string') {
        console.warn('Élément ou action invalide pour le son', { control, action });
        return;
    }

    const override = control.getAttribute(`data-sfx-${action}`);
    if (override?.toLowerCase() === 'none') return;

    const filename = override || control.getAttribute('data-sfx') || DEFAULT_SOUNDS[action];
    if (!filename) {
        console.warn(`Aucun son défini pour l’action "${action}"`);
        return;
    }
    if (filename.toLowerCase() !== 'none') playSfx(filename);
}

export function initSfx() {
    if (window.__oifeelSfxInitialized) return;
    window.__oifeelSfxInitialized = true;

    window.playSfx = playSfx;
    window.playControlSfx = playControlSfx;
    window.setSfxEnabled = setSfxEnabled;

    document.addEventListener('click', (event) => {
        const control = event.target.closest(INTERACTIVE_SELECTOR);
        if (control && !control.matches(':disabled, [aria-disabled="true"]')) {
            playControlSfx(control, 'click');
        }
    });

    document.addEventListener('pointerover', (event) => {
        if (event.pointerType === 'touch') return;
        const control = event.target.closest(INTERACTIVE_SELECTOR);
        if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
        if (event.relatedTarget && control.contains(event.relatedTarget)) return;
        playControlSfx(control, 'hover');
    });
}
