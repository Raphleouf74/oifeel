// ============================================================
// help-system.js — Système d'aide contextuelle non intrusif
//
// Intégré à oifeel. sans dépendance nouvelle, en réutilisant :
//  - le pattern d'overlay existant (classList.add('open') + body
//    overflow hidden, fermeture via clic extérieur / Escape)
//  - localStorage comme mécanisme de persistance (déjà utilisé pour
//    le token, le profil, les préférences IA...)
//  - le système i18n existant : les textes ci-dessous servent de
//    valeur par défaut sur des éléments data-i18n, donc si un jour
//    des clés de traduction sont ajoutées dans /app/lang/*.json,
//    elles prendront automatiquement le dessus.
//
// Composants exposés (window.OifeelHelp) :
//  - QuickHelpPrompt      : bandeau discret "besoin d'aide ?"
//  - QuickStartGuide      : guide rapide (3-4 étapes), pour tous
//  - AdvancedOnboarding   : onboarding avancé après création de compte
//  - HelpCenter           : documentation (recherche + articles)
//  - HelpTooltip          : petites bulles [?] contextuelles
//
// Ce module ne collecte aucune donnée personnelle supplémentaire :
// seuls quelques compteurs de comportements UX (nombre de clics
// répétés, ouvertures/fermetures répétées...) vivent en mémoire et
// sont réinitialisés à chaque session.
// ============================================================

(function () {
    'use strict';

    // ------------------------------------------------------------
    // Utilitaires génériques
    // ------------------------------------------------------------

    const STORAGE_KEY = 'oifeel_help_state';
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ------------------------------------------------------------
    // Petite animation de glisse entre deux "pages" (étapes du guide,
    // slides de l'onboarding, liste ↔ article du centre d'aide).
    // Principe : on fait glisser le contenu actuel vers la gauche en
    // s'estompant, on remplace le contenu, puis on le fait glisser
    // depuis la droite. Respecte prefers-reduced-motion (bascule
    // instantanée dans ce cas, comme le reste de l'app).
    // ------------------------------------------------------------
    function slideSwap(container, updateFn, direction) {
        if (!container) { updateFn(); return; }
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) { updateFn(); return; }

        container.style.setProperty('--oh-slide-dir', direction === -1 ? -1 : 1);
        container.classList.remove('oh-slide-enter');
        container.classList.add('oh-slide-exit');

        window.setTimeout(() => {
            updateFn();
            container.classList.remove('oh-slide-exit');
            container.classList.add('oh-slide-enter-prep');
            // force reflow pour repartir proprement de l'état "prep"
            void container.offsetWidth;
            container.classList.remove('oh-slide-enter-prep');
            container.classList.add('oh-slide-enter');
            window.setTimeout(() => container.classList.remove('oh-slide-enter'), 220);
        }, 160);
    }

    function t(key, fallback) {
        // Réutilise le cache de traductions déjà rempli par loadLanguage()
        // dans app.js (window.__translations__). Si absent, on retombe
        // sur le texte français par défaut.
        try {
            const dict = window.__translations__;
            if (dict && dict[key]) return dict[key];
        } catch (e) { /* ignore */ }
        return fallback;
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function saveState(patch) {
        try {
            const cur = loadState();
            const next = Object.assign({}, cur, patch);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        } catch (e) {
            return loadState();
        }
    }

    let helpState = loadState();

    // ------------------------------------------------------------
    // Mini shim analytics — réutilise un système existant s'il y en
    // a un (window.analytics / gtag / plausible), sinon ne fait rien
    // de plus qu'un log discret. On n'introduit pas de nouvelle
    // infrastructure d'analytics.
    // ------------------------------------------------------------
    function trackEvent(name, data) {
        try {
            if (window.analytics && typeof window.analytics.track === 'function') {
                window.analytics.track(name, data || {});
            } else if (typeof window.gtag === 'function') {
                window.gtag('event', name, data || {});
            } else if (typeof window.plausible === 'function') {
                window.plausible(name, { props: data || {} });
            } else if (window.location && /localhost|127\.0\.0\.1/.test(window.location.hostname)) {
                console.debug('[help-analytics]', name, data || {});
            }
        } catch (e) { /* ne jamais casser l'app pour un event */ }
    }

    // ------------------------------------------------------------
    // Détection de signaux de confusion
    //
    // Principe : plusieurs signaux simples et pondérés, avec fenêtre
    // glissante. Aucun signal seul (y compris rester longtemps sur un
    // post) ne déclenche l'aide : il faut une combinaison de signaux.
    // ------------------------------------------------------------
    const SignalEngine = (function () {
        const WINDOW_MS = 20000; // fenêtre glissante de 20s pour les signaux "rafale"
        const THRESHOLD = 3; // score cumulé nécessaire pour déclencher l'aide
        let score = 0;
        let events = []; // { t, weight }
        let navToggleTimestamps = [];
        let sameTargetClicks = new Map(); // clé élément -> timestamps
        let recentZones = []; // zones visitées récemment (nav)
        let idleTimer = null;
        let lastActivity = Date.now();
        let onThresholdReached = null;

        function prune() {
            const now = Date.now();
            events = events.filter(e => now - e.t < WINDOW_MS);
            score = events.reduce((s, e) => s + e.weight, 0);
        }

        function addSignal(weight, label) {
            if (isSuppressed()) return;
            events.push({ t: Date.now(), weight });
            prune();
            if (score >= THRESHOLD) {
                fire(label);
            }
        }

        function isSuppressed() {
            // Une fois affiché (ou fermé) durant la session, on ne
            // ré-évalue plus les signaux pour éviter d'être intrusif.
            return sessionStorage.getItem('oifeel_help_prompt_shown_session') === '1';
        }

        function fire(reason) {
            score = 0;
            events = [];
            if (typeof onThresholdReached === 'function') {
                onThresholdReached(reason);
            }
        }

        function trackNavToggle() {
            const now = Date.now();
            navToggleTimestamps.push(now);
            navToggleTimestamps = navToggleTimestamps.filter(ts => now - ts < WINDOW_MS);
            // 3 ouvertures/fermetures répétées de la nav en moins de 20s
            if (navToggleTimestamps.length >= 3) {
                addSignal(2, 'nav_toggle_repeated');
                navToggleTimestamps = [];
            }
        }

        function keyForTarget(el) {
            if (!el) return null;
            return el.id || el.className || el.tagName;
        }

        function trackClick(e) {
            lastActivity = Date.now();
            const target = e.target.closest('button, a, .link, [role="button"]');
            if (!target) return;

            // Ignore les clics dans les composants du help-system lui-même
            if (target.closest('.oh-overlay, .help-prompt, .oh-tooltip')) return;

            const key = keyForTarget(target);
            if (!key) return;
            const now = Date.now();
            const list = (sameTargetClicks.get(key) || []).filter(ts => now - ts < WINDOW_MS);
            list.push(now);
            sameTargetClicks.set(key, list);

            // Clics répétés (3+) sur le même élément sans navigation entre-temps
            if (list.length >= 3) {
                addSignal(2, 'repeated_clicks_no_result');
                sameTargetClicks.set(key, []);
            }

            // Interactions avec des zones différentes de l'interface,
            // signe d'exploration/recherche plutôt que d'usage normal
            const zone = target.closest('#nav, #home, #create, #messages, #inbox, #more');
            if (zone) {
                recentZones.push({ id: zone.id, t: now });
                recentZones = recentZones.filter(z => now - z.t < WINDOW_MS);
                const distinctZones = new Set(recentZones.map(z => z.id));
                if (distinctZones.size >= 4) {
                    addSignal(1, 'multi_zone_hopping');
                    recentZones = [];
                }
            }
        }

        // Ouverture/fermeture répétée d'un même élément (ex: overlay de
        // compte, panneau de commentaires...) via MutationObserver léger
        function watchToggle(selector, className) {
            const toggleTimestamps = [];
            document.addEventListener('click', (e) => {
                const el = document.querySelector(selector);
                if (!el) return;
                if (!el.contains(e.target) && e.target !== el) return;
            });
            const target = document.querySelector(selector);
            if (!target) return;
            const observer = new MutationObserver(() => {
                const now = Date.now();
                toggleTimestamps.push(now);
                while (toggleTimestamps.length && now - toggleTimestamps[0] > WINDOW_MS) {
                    toggleTimestamps.shift();
                }
                if (toggleTimestamps.length >= 3) {
                    addSignal(2, 'open_close_repeated');
                    toggleTimestamps.length = 0;
                }
            });
            observer.observe(target, { attributes: true, attributeFilter: ['class'] });
        }

        function resetIdle() {
            lastActivity = Date.now();
        }

        function startIdleWatch() {
            // L'absence d'interaction seule ne déclenche jamais rien : elle
            // ne fait qu'ajouter un signal faible, qui doit se combiner à
            // au moins un autre signal pour franchir le seuil.
            ['click', 'scroll', 'keydown', 'touchstart'].forEach(evt => {
                document.addEventListener(evt, resetIdle, { passive: true });
            });
            setInterval(() => {
                const idleFor = Date.now() - lastActivity;
                if (idleFor > 45000 && idleFor < 60000) {
                    addSignal(1, 'idle_after_activity');
                }
            }, 15000);
        }

        function init(cb) {
            onThresholdReached = cb;
            document.addEventListener('click', trackClick, true);
            watchToggle('#nav', 'shown');
            watchToggle('#accountOverlay', 'open');
            startIdleWatch();
        }

        return { init, trackNavToggle, addSignal };
    })();

    // ------------------------------------------------------------
    // QuickHelpPrompt — bandeau discret en bas d'écran
    // ------------------------------------------------------------
    const QuickHelpPrompt = (function () {
        function shouldOffer() {
            if (helpState.helpPromptDismissed) {
                // Ne pas réafficher avant 7 jours après une fermeture explicite
                const days = (Date.now() - (helpState.helpPromptDismissedAt || 0)) / 86400000;
                if (days < 7) return false;
            }
            if (helpState.quickGuideCompleted) return false;
            if (sessionStorage.getItem('oifeel_help_prompt_shown_session') === '1') return false;
            return true;
        }

        function show() {
            if (!shouldOffer()) return;
            const el = document.getElementById('helpPrompt');
            if (!el) return;
            el.classList.remove('hidden');
            requestAnimationFrame(() => el.classList.add('shown'));
            sessionStorage.setItem('oifeel_help_prompt_shown_session', '1');
            trackEvent('help_prompt_shown');
        }

        function hide(persist) {
            const el = document.getElementById('helpPrompt');
            if (el) {
                el.classList.remove('shown');
                setTimeout(() => el.classList.add('hidden'), prefersReducedMotion ? 0 : 250);
            }
            if (persist) {
                helpState = saveState({ helpPromptDismissed: true, helpPromptDismissedAt: Date.now() });
                trackEvent('help_prompt_dismissed');
            }
        }

        function init() {
            document.getElementById('helpPromptClose')?.addEventListener('click', () => hide(true));
            document.getElementById('helpPromptShow')?.addEventListener('click', () => {
                trackEvent('help_prompt_clicked');
                hide(false);
                QuickStartGuide.open('help_prompt');
            });
        }

        return { show, hide, init };
    })();

    // ------------------------------------------------------------
    // QuickStartGuide — guide rapide, 4 étapes, pour tout le monde
    // ------------------------------------------------------------
    const QuickStartGuide = (function () {
        const steps = [
            {
                icon: '🧭',
                titleKey: 'guide_step_nav_title', title: 'la navigation',
                textKey: 'guide_step_nav_text', text: "appuie sur le logo en haut de l'écran pour ouvrir le menu principal et changer d'onglet."
            },
            {
                icon: '👤',
                titleKey: 'guide_step_account_title', title: 'ton compte',
                textKey: 'guide_step_account_text', text: "ton compte te donne accès à tes fonctionnalités personnelles, à la messagerie et à d'autres fonctionnalités avancées."
            },
            {
                icon: '🔄',
                titleKey: 'guide_step_feed_title', title: 'posts & stories',
                textKey: 'guide_step_feed_text', text: 'utilise ce sélecteur en haut du fil pour passer des publications aux stories.'
            },
            {
                icon: '💬',
                titleKey: 'guide_step_interact_title', title: 'interagir',
                textKey: 'guide_step_interact_text', text: 'découvre les publications, réagis et participe à la communauté.'
            }
        ];

        let index = 0;
        let openedFrom = null;

        function render() {
            const container = document.getElementById('quickGuideSteps');
            const dots = document.getElementById('quickGuideDots');
            const nextBtn = document.getElementById('quickGuideNext');
            if (!container) return;

            const step = steps[index];
            container.innerHTML = `
                <div class="oh-step-icon" aria-hidden="true">${step.icon}</div>
                <h3 class="oh-step-title">${t(step.titleKey, step.title)}</h3>
                <p class="oh-step-text">${t(step.textKey, step.text)}</p>
            `;

            if (dots) {
                dots.innerHTML = steps.map((_, i) =>
                    `<span class="oh-dot${i === index ? ' oh-dot--active' : ''}"></span>`
                ).join('');
            }

            if (nextBtn) {
                nextBtn.textContent = index === steps.length - 1
                    ? t('guide_finish', 'terminer')
                    : t('guide_next', 'suivant');
            }
        }

        function open(from) {
            openedFrom = from || 'menu';
            index = 0;
            const overlay = document.getElementById('quickGuideOverlay');
            if (!overlay) return;
            overlay.classList.add('open');
            document.body.style.overflow = 'hidden';
            render();
            trackEvent('quick_guide_opened', { from: openedFrom });
            const closeBtn = document.getElementById('quickGuideClose');
            closeBtn && closeBtn.focus();
        }

        function close(reason) {
            const overlay = document.getElementById('quickGuideOverlay');
            if (overlay) {
                overlay.classList.remove('open');
                document.body.style.overflow = '';
            }
            if (reason === 'completed') {
                helpState = saveState({ quickGuideCompleted: true });
                trackEvent('quick_guide_completed', { from: openedFrom });
            } else if (reason === 'skipped') {
                helpState = saveState({ quickGuideSkipped: true });
                trackEvent('quick_guide_skipped', { from: openedFrom, step: index });
            }
        }

        function next() {
            if (index < steps.length - 1) {
                index += 1;
                slideSwap(document.getElementById('quickGuideSteps'), render);
            } else {
                close('completed');
            }
        }

        function init() {
            document.getElementById('quickGuideNext')?.addEventListener('click', next);
            document.getElementById('quickGuideSkip')?.addEventListener('click', () => close('skipped'));
            document.getElementById('quickGuideClose')?.addEventListener('click', () => close('skipped'));
            const overlay = document.getElementById('quickGuideOverlay');
            overlay?.addEventListener('click', (e) => {
                if (e.target === overlay) close('skipped');
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) close('skipped');
            });
        }

        return { open, close, init };
    })();

    // ------------------------------------------------------------
    // AdvancedOnboarding — après création volontaire d'un compte
    // ------------------------------------------------------------
    const AdvancedOnboarding = (function () {
        const slides = [
            { icon: '🪪', titleKey: 'onboarding_slide_profile_title', title: 'ton profil', textKey: 'onboarding_slide_profile_text', text: 'personnalise ton avatar, ta bio et le style de ton compte depuis l’onglet « plus ».' },
            { icon: '➕', titleKey: 'onboarding_slide_follow_title', title: 'des personnes à suivre', textKey: 'onboarding_slide_follow_text', text: 'suis des comptes pour voir leurs publications apparaître dans ton fil.' },
            { icon: '🖼️', titleKey: 'onboarding_slide_posts_title', title: 'publications & stories', textKey: 'onboarding_slide_posts_text', text: 'publie des posts qui restent, ou des stories qui disparaissent après 24h.' },
            { icon: '✉️', titleKey: 'onboarding_slide_messaging_title', title: 'la messagerie', textKey: 'onboarding_slide_messaging_text', text: 'discute en privé avec d’autres membres depuis l’onglet messages.' },
            { icon: '🔔', titleKey: 'onboarding_slide_notifications_title', title: 'les notifications', textKey: 'onboarding_slide_notifications_text', text: 'retrouve les likes, commentaires et nouveaux abonnés dans l’onglet notifications.' },
            { icon: '✨', titleKey: 'onboarding_slide_advanced_title', title: 'fonctionnalités avancées', textKey: 'onboarding_slide_advanced_text', text: 'posts éphémères, génération de contenu par IA... repérables par une petite icône [?] qui explique chaque fonctionnalité.' },
            { icon: '⚠️', titleKey: 'onboarding_slide_required_reload_title', title: 'actualisation de la page nécéssaire', textKey: 'onboarding_slide_required_reload_text', text: 'pour permettre une expérience encore meilleure et pour une bonne synchronisation de vos données, le rechargement de la page est obligatoire. cliquez sur \'terminer\' pour continuer'}
        ];

        let index = 0;

        function render() {
            const container = document.getElementById('advOnbSteps');
            const dots = document.getElementById('advOnbDots');
            const nextBtn = document.getElementById('advOnbNext');
            if (!container) return;
            const s = slides[index];
            container.innerHTML = `
                <div class="oh-step-icon" aria-hidden="true">${s.icon}</div>
                <h3 class="oh-step-title">${t(s.titleKey, s.title)}</h3>
                <p class="oh-step-text">${t(s.textKey, s.text)}</p>
            `;
            if (dots) {
                dots.innerHTML = slides.map((_, i) =>
                    `<span class="oh-dot${i === index ? ' oh-dot--active' : ''}"></span>`
                ).join('');
            }
            if (nextBtn) {
                nextBtn.textContent = index === slides.length - 1
                    ? t('onboarding_finish', 'terminer')
                    : t('guide_next', 'suivant');
            }
        }

        function open() {
            index = 0;
            const overlay = document.getElementById('advOnbOverlay');
            if (!overlay) return;
            overlay.classList.add('open');
            document.body.style.overflow = 'hidden';
            render();
            trackEvent('advanced_onboarding_opened');
        }

        function close(reason) {
            const overlay = document.getElementById('advOnbOverlay');
            if (overlay) {
                overlay.classList.remove('open');
                document.body.style.overflow = '';
            }
            if (reason === 'completed') {
                helpState = saveState({ advancedOnboardingCompleted: true });
                trackEvent('advanced_onboarding_completed');
            } else if (reason === 'skipped') {
                helpState = saveState({ advancedOnboardingSkipped: true });
                trackEvent('advanced_onboarding_skipped', { step: index });
            }
        }

        function next() {
            if (index < slides.length - 1) {
                index += 1;
                slideSwap(document.getElementById('advOnbSteps'), render);
            } else {
                close('completed');
                window.location.reload();
            }
        }

        function maybeOpenAfterSignup() {
            // Ne jamais bloquer : on laisse toujours passer, jamais
            // forcé, jamais plusieurs écrans avant de pouvoir utiliser
            // son compte (le "Passer" est toujours visible).
            if (helpState.advancedOnboardingCompleted || helpState.advancedOnboardingSkipped) return;
            setTimeout(() => open(), 400);
        }

        function init() {
            document.getElementById('advOnbNext')?.addEventListener('click', next);
            document.getElementById('advOnbSkip')?.addEventListener('click', () => close('skipped'));
            document.getElementById('advOnbClose')?.addEventListener('click', () => close('skipped'));
            const overlay = document.getElementById('advOnbOverlay');
            overlay?.addEventListener('click', (e) => {
                if (e.target === overlay) close('skipped');
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) close('skipped');
            });
        }

        return { open, close, init, maybeOpenAfterSignup };
    })();

    // ------------------------------------------------------------
    // HelpCenter — documentation courte, recherchable
    // ------------------------------------------------------------
    const HelpCenter = (function () {
        const articles = [
            { id: 'publications', cat: 'fonctionnalités', titleKey: 'help_article_publications_title', title: 'publications', textKey: 'help_article_publications_text', text: 'publie un texte, une image ou une humeur sur ton fil. tout le monde peut réagir et commenter.' },
            { id: 'stories', cat: 'fonctionnalités', titleKey: 'help_article_stories_title', title: 'stories', textKey: 'help_article_stories_text', text: 'les stories sont visibles 24h puis disparaissent automatiquement. utilise le sélecteur en haut du fil pour les voir.' },
            { id: 'ephemeral', cat: 'fonctionnalités', titleKey: 'help_ephemeral_title', title: 'posts éphémères', textKey: 'help_ephemeral_text', text: 'ces publications restent disponibles pendant une durée que tu choisis, avant de disparaître automatiquement pour tout le monde.' },
            { id: 'messagerie', cat: 'fonctionnalités', titleKey: 'help_article_messagerie_title', title: 'messagerie', textKey: 'help_article_messagerie_text', text: 'discute en privé avec d’autres membres depuis l’onglet messages, en bas de l’écran.' },
            { id: 'ia', cat: 'fonctionnalités', titleKey: 'help_ai_title', title: 'génération IA', textKey: 'help_ai_text', text: 'crée une proposition de contenu à partir de ton idée, dans l’écran de création (options avancées). limité à quelques générations par semaine.' },
            { id: 'notifications', cat: 'fonctionnalités', titleKey: 'help_article_notifications_title', title: 'notifications', textKey: 'help_article_notifications_text', text: 'retrouve les likes, commentaires, nouveaux abonnés et réponses dans l’onglet notifications.' },
            { id: 'profil', cat: 'compte', titleKey: 'help_article_profil_title', title: 'profil', textKey: 'help_article_profil_text', text: 'personnalise ton avatar, ta bio, ta couleur d’accent et ta police depuis l’onglet « plus ».' },
            { id: 'parametres', cat: 'compte', titleKey: 'help_article_parametres_title', title: 'paramètres', textKey: 'help_article_parametres_text', text: 'gère la langue, l’affichage des posts IA et la personnalisation de ton compte.' },
            { id: 'confidentialite', cat: 'compte', titleKey: 'help_article_confidentialite_title', title: 'confidentialité', textKey: 'help_article_confidentialite_text', text: 'consulte la politique de confidentialité pour savoir quelles données sont utilisées.', link: '/app/Legal/PRIVACY_POLICY.html', linkTextKey: 'help_article_confidentialite_link', linkText: 'lire la politique de confidentialité' },
            { id: 'securite', cat: 'compte', titleKey: 'help_article_securite_title', title: 'sécurité', textKey: 'help_article_securite_text', text: 'active la double authentification (A2F) et gère ton mot de passe depuis la gestion du compte.' }
        ];

        function articleTitle(a) { return t(a.titleKey, a.title); }
        function articleText(a) { return t(a.textKey, a.text); }

        function categoryLabel(cat) {
            return cat === 'compte'
                ? t('help_center_cat_account', 'compte')
                : t('help_center_cat_features', 'fonctionnalités');
        }

        function renderList(filter) {
            const body = document.getElementById('helpCenterBody');
            if (!body) return;
            const q = (filter || '').trim().toLowerCase();
            const filtered = articles.filter(a =>
                !q || articleTitle(a).toLowerCase().includes(q) || articleText(a).toLowerCase().includes(q)
            );
            const cats = ['fonctionnalités', 'compte'];
            let html = '';
            cats.forEach(cat => {
                const items = filtered.filter(a => a.cat === cat);
                if (!items.length) return;
                html += `<div class="oh-hc-cat"><h3>${categoryLabel(cat)}</h3><ul class="oh-hc-list">`;
                items.forEach(a => {
                    html += `<li><button type="button" class="oh-hc-item" data-article="${a.id}">${articleTitle(a)}</button></li>`;
                });
                html += '</ul></div>';
            });
            if (!html) {
                html = `<p class="oh-hc-empty">${t('help_center_empty', 'aucun résultat pour « {query} ».').replace('{query}', escapeHtml(filter))}</p>`;
            }
            body.innerHTML = html;
            body.querySelectorAll('.oh-hc-item').forEach(btn => {
                btn.addEventListener('click', () => slideSwap(body, () => openArticle(btn.dataset.article), 1));
            });
        }

        function escapeHtml(s) {
            const div = document.createElement('div');
            div.textContent = s || '';
            return div.innerHTML;
        }

        function openArticle(id) {
            const article = articles.find(a => a.id === id);
            const body = document.getElementById('helpCenterBody');
            if (!article || !body) return;
            const linkText = article.link ? t(article.linkTextKey, article.linkText) : '';
            body.innerHTML = `
                <button type="button" class="oh-hc-back" id="helpCenterBack">&larr; ${t('help_center_back', 'retour')}</button>
                <h3 class="oh-hc-article-title">${articleTitle(article)}</h3>
                <p class="oh-hc-article-text">${articleText(article)}</p>
                ${article.link ? `<a class="oh-hc-more" href="${article.link}" target="_blank" rel="noopener">${linkText} →</a>` : ''}
            `;
            document.getElementById('helpCenterBack')?.addEventListener('click', () => slideSwap(body, () => renderList(''), -1));
            trackEvent('documentation_article_opened', { article: id });
        }

        function open(articleId) {
            const overlay = document.getElementById('helpCenterOverlay');
            if (!overlay) return;
            overlay.classList.add('open');
            overlay.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            const search = document.getElementById('helpCenterSearch');
            if (search) {
                search.value = '';
                search.placeholder = t('help_center_search', "rechercher dans l'aide");
            }
            if (articleId) {
                openArticle(articleId);
            } else {
                renderList('');
            }
            trackEvent('documentation_opened', { article: articleId || null });
        }

        function close() {
            const overlay = document.getElementById('helpCenterOverlay');
            if (overlay) {
                overlay.classList.remove('open');
                overlay.classList.add('hidden');
                document.body.style.overflow = '';
            }
        }

        function init() {
            document.getElementById('helpCenterClose')?.addEventListener('click', close);
            document.getElementById('helpCenterSearch')?.addEventListener('input', (e) => renderList(e.target.value));
            const overlay = document.getElementById('helpCenterOverlay');
            overlay?.addEventListener('click', (e) => {
                if (e.target === overlay) close();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) close();
            });
        }

        return { open, close, init, openArticle };
    })();

    // ------------------------------------------------------------
    // HelpTooltip — petites bulles [?] contextuelles (niveau 1 & 2)
    // ------------------------------------------------------------
    const HelpTooltip = (function () {
        let openPopover = null;

        function closeOpen() {
            if (openPopover) {
                openPopover.remove();
                openPopover = null;
            }
        }

        function attach(triggerEl, opts) {
            if (!triggerEl || triggerEl.dataset.ohBound) return;
            triggerEl.dataset.ohBound = '1';
            triggerEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (openPopover && openPopover.dataset.for === opts.id) {
                    closeOpen();
                    return;
                }
                closeOpen();
                const pop = document.createElement('div');
                pop.className = 'oh-tooltip';
                pop.dataset.for = opts.id;
                pop.setAttribute('role', 'dialog');
                pop.setAttribute('aria-label', opts.title);
                pop.innerHTML = `
                    <p class="oh-tooltip-title">${opts.title}</p>
                    <p class="oh-tooltip-text">${opts.text}</p>
                    <button type="button" class="oh-tooltip-more">${t('help_learn_more', 'en savoir plus')} →</button>
                `;
                document.body.appendChild(pop);
                positionNear(pop, triggerEl);
                pop.querySelector('.oh-tooltip-more').addEventListener('click', () => {
                    closeOpen();
                    HelpCenter.open(opts.articleId || null);
                });
                openPopover = pop;
                document.addEventListener('click', onOutsideClick, { once: true, capture: true });
            });
        }

        function onOutsideClick(e) {
            // Les clics sur un déclencheur [?] sont entièrement gérés par
            // son propre écouteur (ouverture/fermeture en bascule) : on ne
            // doit pas fermer la bulle ici, sinon le second clic la
            // referme puis la rouvre aussitôt (voir attach()).
            if (e.target.closest('.oh-help-icon')) return;
            if (openPopover && !openPopover.contains(e.target)) closeOpen();
        }

        function positionNear(pop, triggerEl) {
            const rect = triggerEl.getBoundingClientRect();
            const popRect = pop.getBoundingClientRect();
            let top = rect.bottom + 8 + window.scrollY;
            let left = rect.left + window.scrollX;
            const maxLeft = window.innerWidth - popRect.width - 12;
            if (left > maxLeft) left = Math.max(12, maxLeft);
            if (rect.bottom + popRect.height + 16 > window.innerHeight) {
                top = rect.top + window.scrollY - popRect.height - 8;
            }
            pop.style.top = `${Math.max(8, top)}px`;
            pop.style.left = `${Math.max(8, left)}px`;
        }

        function createTrigger(labelForA11y) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'oh-help-icon';
            btn.setAttribute('aria-label', labelForA11y);
            btn.textContent = '?';
            return btn;
        }

        function initDefaults() {
            // Génération IA — niveau 1/2
            const aiBtn = document.getElementById('ai-generate');
            if (aiBtn && aiBtn.parentElement && !document.getElementById('aiHelpTrigger')) {
                const trigger = createTrigger('à propos de la génération IA');
                trigger.id = 'aiHelpTrigger';
                aiBtn.insertAdjacentElement('afterend', trigger);
                attach(trigger, {
                    id: 'ia',
                    title: t('help_ai_title', 'génération IA'),
                    text: t('help_ai_text', 'crée une proposition de contenu à partir de ton idée.'),
                    articleId: 'ia'
                });
            }

            // Message éphémère — niveau 1/2
            const ephemeralToggle = document.getElementById('ephemeralToggle');
            const ephemeralLabel = ephemeralToggle ? ephemeralToggle.closest('.create-toggle') : null;
            if (ephemeralLabel && !document.getElementById('ephemeralHelpTrigger')) {
                const trigger = createTrigger('à propos des posts éphémères');
                trigger.id = 'ephemeralHelpTrigger';
                trigger.classList.add('oh-help-icon--inline');
                ephemeralLabel.insertAdjacentElement('afterend', trigger);
                attach(trigger, {
                    id: 'ephemeral',
                    title: t('help_ephemeral_title', 'posts éphémères'),
                    text: t('help_ephemeral_text', 'ces publications restent disponibles pendant une durée définie avant de disparaître automatiquement.'),
                    articleId: 'ephemeral'
                });
            }
        }

        return { attach, createTrigger, initDefaults };
    })();

   
    // ------------------------------------------------------------
    // Câblage des entrées de menu ("plus" → aide / découvrir l'app)
    // ------------------------------------------------------------
    function wireMenuEntries() {
        document.getElementById('openHelpCenterBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            HelpCenter.open();
        });
        document.getElementById('openQuickGuideBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            QuickStartGuide.open('help_center');
        });
        document.getElementById('replayOnboardingBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            const isLoggedIn = !!localStorage.getItem('oifeel_token');
            if (isLoggedIn) {
                AdvancedOnboarding.open();
            } else {
                QuickStartGuide.open('menu');
            }
        });
    }

    // ------------------------------------------------------------
    // Init
    // ------------------------------------------------------------
    function init() {
        QuickHelpPrompt.init();
        QuickStartGuide.init();
        AdvancedOnboarding.init();
        HelpCenter.init();
        wireMenuEntries();
        HelpTooltip.initDefaults();

        SignalEngine.init(() => QuickHelpPrompt.show());

        // Exposé pour app.js (déclenché après une inscription réussie)
        window.OifeelHelp = {
            onAccountCreated: () => AdvancedOnboarding.maybeOpenAfterSignup(),
            openQuickGuide: (from) => QuickStartGuide.open(from),
            openAdvancedOnboarding: () => AdvancedOnboarding.open(),
            openHelpCenter: (articleId) => HelpCenter.open(articleId),
            refreshTooltips: () => HelpTooltip.initDefaults()
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();