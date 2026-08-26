# oifeel. 🫧

**Moins d'algorithmes toxiques. Plus d'authenticité.**

oifeel. est un réseau social axé sur l'humeur du moment : un feed d'"états" éphémères ou permanents, des stories qui disparaissent après 24h, une messagerie privée chiffrée de bout en bout, et une expérience pensée pour être légère, rapide et disponible en 5 langues.

<p align="center">
  <img src="https://img.shields.io/badge/status-en%20développement-orange" alt="status">
  <img src="https://img.shields.io/badge/i18n-5%20langues-blueviolet" alt="i18n">
  <img src="https://img.shields.io/badge/node-express-green" alt="node">
  <img src="https://img.shields.io/badge/db-mongodb-brightgreen" alt="mongodb">
  <img src="https://img.shields.io/badge/license-tous%20droits%20réservés-lightgrey" alt="license">
</p>

---

## Sommaire

- [oifeel. 🫧](#oifeel-)
  - [Sommaire](#sommaire)
  - [À propos](#à-propos)
  - [Fonctionnalités](#fonctionnalités)
    - [🎭 Publications \& humeurs](#-publications--humeurs)
    - [📖 Stories](#-stories)
    - [🏠 Feed \& découverte](#-feed--découverte)
    - [👤 Comptes \& profils](#-comptes--profils)
    - [💬 Messagerie privée](#-messagerie-privée)
    - [🔔 Notifications](#-notifications)
    - [🌍 Réseau social](#-réseau-social)
    - [🤖 Génération de contenu par IA](#-génération-de-contenu-par-ia)
    - [⚙️ Personnalisation \& accessibilité](#️-personnalisation--accessibilité)
    - [🛡️ Modération \& administration](#️-modération--administration)
    - [🎨 Landing page publique](#-landing-page-publique)
  - [Stack technique](#stack-technique)
  - [Structure du projet](#structure-du-projet)
  - [Internationalisation](#internationalisation)
  - [Centre d'aide \& documentation intégrée](#centre-daide--documentation-intégrée)
  - [Installation](#installation)
  - [Sécurité](#sécurité)
  - [Roadmap](#roadmap)
  - [Licence](#licence)

---

## À propos

oifeel. permet à chacun de partager ce qu'il ressent, sous forme de texte, d'image ou de couleur/dégradé, avec ou sans musique associée. L'application met l'accent sur l'expression du moment plutôt que sur la performance sociale (pas de likes affichés publiquement de façon obsessionnelle, contenus éphémères, feed chronologique par défaut).

## Fonctionnalités

### 🎭 Publications & humeurs
- Création de posts textuels avec choix de **couleur / dégradé de fond** et aperçu en temps réel avant publication
- Association d'un **extrait musical** à un post (recherche & prévisualisation)
- **Posts éphémères** : durée de vie personnalisable (jusqu'à 5 ans, en années/mois/jours/heures/minutes/secondes) avant disparition automatique
- Brouillons sauvegardés automatiquement (autosave) pour ne rien perdre en cas de fermeture accidentelle
- Mentions (`@utilisateur`) avec recherche live dans l'éditeur
- Mode « focus » d'écriture
- Détection et blocage des tentatives d'injection de script (anti-XSS) dans les publications, avec système d'avertissement/bannissement temporaire en cas de récidive

### 📖 Stories
- Publication de stories visibles 24h, affichées en bulles en haut du feed
- Visionneuse dédiée avec navigation entre stories

### 🏠 Feed & découverte
- Fil d'actualité avec tri (récent, popularité, etc.) et **scroll infini**
- Bascule rapide entre **posts** et **stories**
- Mise en avant du **post du jour**
- Suggestions de comptes à suivre
- Compteur de vues par publication
- Réactions, likes, commentaires (avec cache local et synchronisation), reposts, signalement de contenu, partage avec lien copiable

### 👤 Comptes & profils
- Inscription / connexion classique, **mode invité**, et **connexion via Google (OAuth2)**
- **Double authentification (2FA)** par TOTP (application d'authentification) ou par email
- Gestion du profil : avatar, bio, couleur d'accent, police
- Export de ses propres données (RGPD-friendly) et suppression de compte
- Changement d'email / mot de passe sécurisé

### 💬 Messagerie privée
- Conversations privées avec **chiffrement de bout en bout (E2E)** basé sur des paires de clés publiques/privées générées côté client
- Historique limité aux 50 derniers messages par sécurité/confidentialité
- Badge de chiffrement actif par conversation

### 🔔 Notifications
- Notifications en temps réel (flux SSE) : likes, commentaires, nouveaux abonnés, réponses
- Centre de notifications avec badge de compteur non lus
- Notifications push (enregistrement de token appareil)

### 🌍 Réseau social
- Abonnements / désabonnements, followers & suivis
- Favoris sur les publications
- Feed personnalisé basé sur les comptes suivis
- Visualisation du profil public d'un utilisateur

### 🤖 Génération de contenu par IA
- Proposition de contenu généré par IA à partir d'une idée, dans les options avancées de création
- Suivi de quota (nombre de générations restantes par semaine)

### ⚙️ Personnalisation & accessibilité
- Thème clair / sombre
- Réglage de la taille de police
- Réglage du contraste de la page
- Lecture de la page (accessibilité)
- **Mode performance** (auto-détection, forçage bas-de-gamme, désactivé) pour adapter les animations aux appareils moins puissants
- Sélecteur de langue avec recherche

### 🛡️ Modération & administration
- Panneau d'administration : gestion des utilisateurs (bannissement, suppression), des publications (épinglage, suppression), des signalements
- Consultation d'IP associées aux comptes/posts à des fins de modération
- Mode maintenance activable, avec écran dédié côté utilisateurs
- Redémarrage d'urgence du service
- Envoi d'emails et d'annonces globales aux utilisateurs depuis l'admin

### 🎨 Landing page publique
- Page d'accueil animée : fond ambiant en particules (canvas), sphère 3D-like animée, effet tunnel synchronisé au scroll, marquee, barre de progression de scroll, apparitions au scroll (Intersection Observer)

## Stack technique

| Côté         | Technologies                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend**  | Node.js, Express, MongoDB (Mongoose), express-session + connect-mongo, Helmet, express-rate-limit, JWT, OTPLib (2FA TOTP), QRCode, node-cron, Google Auth Library (OAuth2) |
| **Frontend** | HTML / CSS / JavaScript vanilla (pas de framework), Canvas 2D pour les animations, IndexedDB pour le stockage local (clés E2E, cache)                                      |
| **i18n**     | Fichiers JSON par langue, chargés dynamiquement via un manifest                                                                                                            |

## Structure du projet

```
.
├── index.html          # Landing page publique
├── script.js            # Animations & interactions de la landing page
├── app.js                # Cœur logique de l'application (feed, posts, stories, messagerie, comptes...)
├── help-system.js        # Système d'aide contextuelle intégré (voir ci-dessous)
├── server.cjs             # Serveur Express (API REST, auth, admin, temps réel)
├── manifest.json          # Registre des langues disponibles
└── lang/
    ├── fr.json
    ├── en.json
    ├── es.json
    ├── de.json
    └── it.json
```

## Internationalisation

oifeel. est disponible en **5 langues** : 🇫🇷 Français, 🇬🇧 English, 🇪🇸 Español, 🇩🇪 Deutsch, 🇮🇹 Italiano.

Le fichier `manifest.json` référence chaque langue disponible (code, nom, drapeau, fichier associé). Chaque fichier de langue est un dictionnaire clé → texte, chargé dynamiquement au runtime et mis en cache dans `window.__translations__`. Ajouter une langue revient à créer un nouveau fichier `xx.json` sur le même modèle et à l'enregistrer dans le manifest.

## Centre d'aide & documentation intégrée

L'application embarque son propre système d'aide contextuelle (`help-system.js`, exposé via `window.OifeelHelp`), conçu pour être **non intrusif** et réutiliser les patterns déjà existants dans l'app (overlays, `localStorage`, système i18n) :

| Composant              | Rôle                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QuickHelpPrompt**    | Bandeau discret « besoin d'aide ? » affiché au bon moment                                                                                                                                                     |
| **QuickStartGuide**    | Guide rapide en 3-4 étapes (navigation, compte, feed, interactions) pour les nouveaux venus                                                                                                                   |
| **AdvancedOnboarding** | Onboarding avancé, présenté juste après la création d'un compte (profil, abonnements, publications/stories, messagerie, notifications, fonctionnalités avancées)                                              |
| **HelpCenter**         | Mini-documentation consultable dans l'app : recherche par mot-clé, articles classés par catégories (*fonctionnalités* / *compte*), avec liens vers des ressources externes (ex. politique de confidentialité) |
| **HelpTooltip**        | Petites bulles contextuelles `[?]` qui expliquent une fonctionnalité précise directement au survol                                                                                                            |

Ce module ne collecte aucune donnée personnelle supplémentaire : seuls quelques compteurs de comportement UX (clics répétés, ouvertures/fermetures répétées d'un panneau) vivent en mémoire le temps de la session, pour détecter automatiquement quand un utilisateur semble perdu et lui proposer de l'aide au bon moment.

Les articles du centre d'aide couvrent notamment : publications, stories, messagerie, notifications, profil, paramètres, confidentialité, sécurité (2FA), génération IA et posts éphémères — le tout traduit dans les 5 langues de l'app via les mêmes fichiers `lang/*.json` (clés `help_*`).

> 💡 C'est cette documentation embarquée qui sert de base à la section [Fonctionnalités](#fonctionnalités) de ce README.

## Installation

```bash
# cloner le dépôt
git clone https://github.com/<votre-org>/oifeel.git
cd oifeel

# installer les dépendances backend
npm install

# configurer l'environnement (voir .env.example)
cp .env.example .env

# lancer le serveur
node server.cjs
```

Variables d'environnement principales à renseigner : connexion MongoDB, secret de session, clés JWT, identifiants OAuth Google, clé API pour la génération IA.

## Sécurité

- Sessions stockées en base via `connect-mongo`, en-têtes durcis via `helmet`
- Limitation de débit (`express-rate-limit`) sur les endpoints sensibles
- Authentification à deux facteurs (TOTP ou email)
- Messagerie chiffrée de bout en bout
- Filtrage anti-XSS sur le contenu publié, avec système de bannissement temporaire progressif
- Export et suppression de compte disponibles pour l'utilisateur (conformité RGPD)

## Roadmap

- [ ] Application mobile native
- [ ] Extension du système de génération IA (images, suggestions de style)
- [ ] Statistiques de compte pour les utilisateurs
- [ ] Nouvelles langues

## Licence

Tous droits réservés — © oifeel. 2025-2026. Toute reproduction, totale ou partielle, est strictement interdite sans autorisation.