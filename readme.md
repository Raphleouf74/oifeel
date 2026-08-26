# oifeel.

**moins d'algorithmes toxiques. plus d'authenticité.**

oifeel. est un réseau social axé sur l'humeur du moment : un feed d'"états" éphémères ou permanents, des stories qui disparaissent après 24h, une messagerie privée chiffrée de bout en bout, et une expérience pensée pour être légère, rapide et disponible en 5 langues.

<p align="center">
  <img src="https://img.shields.io/badge/status-en%20développement-orange" alt="status">
  <img src="https://img.shields.io/badge/i18n-5%20langues-blueviolet" alt="i18n">
  <img src="https://img.shields.io/badge/node-express-green" alt="node">
  <img src="https://img.shields.io/badge/db-mongodb-brightgreen" alt="mongodb">
  <img src="https://img.shields.io/badge/license-tous%20droits%20réservés-lightgrey" alt="license">
</p>

---

## sommaire

- [oifeel.](#oifeel)
  - [sommaire](#sommaire)
  - [À propos](#à-propos)
  - [fonctionnalités](#fonctionnalités)
    - [🎭 publications \& humeurs](#-publications--humeurs)
    - [📖 stories](#-stories)
    - [🏠 feed \& découverte](#-feed--découverte)
    - [👤 comptes \& profils](#-comptes--profils)
    - [💬 messagerie privée](#-messagerie-privée)
    - [🔔 notifications](#-notifications)
    - [🌍 réseau social](#-réseau-social)
    - [🤖 génération de contenu par ia](#-génération-de-contenu-par-ia)
    - [⚙️ personnalisation \& accessibilité](#️-personnalisation--accessibilité)
    - [🛡️ modération \& administration](#️-modération--administration)
    - [🎨 landing page publique](#-landing-page-publique)
  - [stack technique](#stack-technique)
  - [internationalisation](#internationalisation)
  - [aide](#aide)
      - [publications](#publications)
      - [stories](#stories)
      - [messages ephemeres](#messages-éphèmères)
      - [messagerie](#messagerie)
      - [génération par IA](#génération-par-ia)
      - [notifications](#notifications)
      - [profil](#profil)
      - [parametres](#parametres)
      - [confidentialité](#confidentialite)
      - [sécurité du compte](#securité-du-compte)
  - [sécurité](#sécurité)
  - [licence](#licence)

---

## À propos

oifeel. permet à chacun de partager ce qu'il ressent, sous forme de texte, d'image ou de couleur/dégradé, avec ou sans musique. oifeel. met l'accent sur l'expression du moment plutôt que sur la performance sociale (contenus éphémères, feed chronologique par défaut, pas d'algorithme oppressan).

## fonctionnalités

### 🎭 publications & humeurs
- création de posts textuels avec choix de **couleur / dégradé de fond** et aperçu en temps réel avant publication
- association d'un **extrait musical** à un post (recherche & prévisualisation)
- **posts éphémères** : durée de vie personnalisable (jusqu'à 5 ans, en années/mois/jours/heures/minutes/secondes) avant disparition automatique
- brouillons sauvegardés automatiquement (autosave) pour ne rien perdre en cas de fermeture accidentelle
- mentions (`@utilisateur`) avec recherche live dans l'éditeur
- mode « focus » d'écriture
- détection et blocage des tentatives d'injection de script (anti-xss) dans les publications, avec système d'avertissement/bannissement temporaire en cas de récidive

### 📖 stories
- publication de stories visibles 24h, affichées en bulles en haut du feed
- visionneuse dédiée avec navigation entre stories

### 🏠 feed & découverte
- fil d'actualité avec tri (récent, popularité, etc.) et **scroll infini**
- bascule rapide entre **posts** et **stories**
- mise en avant du **post du jour**
- suggestions de comptes à suivre
- compteur de vues par publication
- réactions, likes, commentaires (avec cache local et synchronisation), reposts, signalement de contenu, partage avec lien copiable

### 👤 comptes & profils
- inscription / connexion classique, **mode invité**, et **connexion via google (oauth2)**
- **double authentification (2fa)** par totp (application d'authentification) ou par email
- gestion du profil : avatar, bio, couleur d'accent, police
- export de ses propres données (rgpd-friendly) et suppression de compte
- changement d'email / mot de passe sécurisé

### 💬 messagerie privée
- conversations privées avec **chiffrement de bout en bout (e2e)** basé sur des paires de clés publiques/privées générées côté client
- historique limité aux 50 derniers messages par sécurité/confidentialité
- badge de chiffrement actif par conversation

### 🔔 notifications
- notifications en temps réel (flux sse) : likes, commentaires, nouveaux abonnés, réponses
- centre de notifications avec badge de compteur non lus
- notifications push (enregistrement de token appareil)

### 🌍 réseau social
- abonnements / désabonnements, followers & suivis
- favoris sur les publications
- feed personnalisé basé sur les comptes suivis
- visualisation du profil public d'un utilisateur

### 🤖 génération de contenu par ia
- proposition de contenu généré par ia à partir d'une idée, dans les options avancées de création
- suivi de quota (nombre de générations restantes par semaine)

### ⚙️ personnalisation & accessibilité
- thème clair / sombre
- réglage de la taille de police
- réglage du contraste de la page
- lecture de la page (accessibilité)
- **mode performance** (auto-détection, forçage bas-de-gamme, désactivé) pour adapter les animations aux appareils moins puissants
- sélecteur de langue avec recherche

### 🛡️ modération & administration
- panneau d'administration : gestion des utilisateurs (bannissement, suppression), des publications (épinglage, suppression), des signalements
- consultation d'ip associées aux comptes/posts à des fins de modération
- mode maintenance activable, avec écran dédié côté utilisateurs
- redémarrage d'urgence du service
- envoi d'emails et d'annonces globales aux utilisateurs depuis l'admin

### 🎨 landing page publique
- page d'accueil animée : fond ambiant en particules (canvas), sphère 3d-like animée, effet tunnel synchronisé au scroll, marquee, barre de progression de scroll, apparitions au scroll (intersection observer)

## stack technique

| côté         | technologies                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **backend**  | node.js, express, mongodb (mongoose), express-session + connect-mongo, helmet, express-rate-limit, jwt, otplib (2fa totp), qrcode, node-cron, google auth library (oauth2) |
| **frontend** | html / css / javascript vanilla (pas de framework), canvas 2d pour les animations, indexeddb pour le stockage local (clés e2e, cache)                                      |
| **i18n**     | fichiers json par langue, chargés dynamiquement via un manifest                                                                                                            |


## internationalisation

oifeel. est disponible en **5 langues** : 🇫🇷 français, 🇬🇧 english, 🇪🇸 español, 🇩🇪 deutsch, 🇮🇹 italiano.

le fichier `manifest.json` référence chaque langue disponible (code, nom, drapeau, fichier associé). chaque fichier de langue est un dictionnaire clé → texte, chargé dynamiquement au runtime et mis en cache dans `window.__translations__`. ajouter une langue revient à créer un nouveau fichier `xx.json` sur le même modèle et à l'enregistrer dans le manifest.

## aide



## publications
publie un texte, une image ou une humeur sur ton fil. tout le monde peut réagir et commenter.
            
            
## stories
les stories sont visibles 24h puis disparaissent automatiquement. utilise le sélecteur en haut du fil pour les voir.
            
## messages éphèmères
ces publications restent disponibles pendant une durée que tu choisis, avant de disparaître automatiquement pour tout le monde.

## messagerie
discute en privé avec d’autres membres depuis l’onglet messages

## génération par ia
crée une proposition de contenu à partir de ton idée, dans l’écran de création (options avancées). limité à quelques générations par semaine.

## notifications
retrouve les likes, commentaires, nouveaux abonnés et réponses dans l’onglet notifications.

## profil
personnalise ton avatar, ta bio, ta couleur d’accent et ta police depuis l’onglet « plus ».
 
## parametres
gère la langue, l’affichage des posts IA et la personnalisation de ton compte.

## confidentialite
consulte la politique de confidentialité pour savoir quelles données sont utilisées. https://oifeel.netlify.app/app/legal/privacy_policy

## securité du compte
active la double authentification (A2F) et gère ton mot de passe depuis la gestion du compte.


## sécurité

- sessions stockées en base via `connect-mongo`, en-têtes durcis via `helmet`
- limitation de débit (`express-rate-limit`) sur les endpoints sensibles
- authentification à deux facteurs (totp ou email)
- messagerie chiffrée de bout en bout
- filtrage anti-xss sur le contenu publié, avec système de bannissement temporaire progressif
- export et suppression de compte disponibles pour l'utilisateur (conformité rgpd)

## licence

tous droits réservés — © oifeel. 2025-2026. toute reproduction, totale ou partielle, est strictement interdite sans autorisation.
