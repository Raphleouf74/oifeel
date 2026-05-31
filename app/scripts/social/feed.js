// scripts/social/feed.js
document.addEventListener("DOMContentLoaded", async () => {
    const storiesList = document.querySelector('.stories-list');
    if (!storiesList) return console.warn("❌ stories-list introuvable");

    try {
        const res = await fetch('https://moodshare-7dd7.onrender.com/api/stories');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const stories = await res.json();

        // purge DOM puis ajout
        storiesList.querySelectorAll('.story:not(.add-story)').forEach(s => s.remove());
        stories.forEach(addStoryToList);
    } catch (err) {
        console.error("❌ Erreur chargement stories:", err);
    }

    function addStoryToList(story) {
        const storyDiv = document.createElement('div');
        storyDiv.className = 'story';

        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'story-emoji';
        emojiSpan.textContent = story.emoji || '📸';

        const textSpan = document.createElement('span');
        textSpan.className = 'sr-only'; // si tu veux garder le texte pour l'accessibilité
        textSpan.textContent = story.text || '';

        storyDiv.appendChild(emojiSpan);
        storyDiv.appendChild(textSpan);

        storiesList.appendChild(storyDiv);

        storyDiv.addEventListener('click', () => openStoryViewer(story));
    }

    function openStoryViewer(story) {
        const viewer = document.createElement('div');
        viewer.className = 'story-viewer';

        const content = document.createElement('div');
        content.className = 'story-content';
        content.style.background = story.color || '#111';

        const emojiEl = document.createElement('span');
        emojiEl.style.fontSize = '3rem';
        emojiEl.textContent = story.emoji || '';

        const p = document.createElement('p');
        p.textContent = story.text || '';

        content.appendChild(emojiEl);
        content.appendChild(p);
        viewer.appendChild(content);

        // close on click anywhere or after timeout
        viewer.addEventListener('click', () => viewer.remove());
        document.body.appendChild(viewer);
        setTimeout(() => {
            if (viewer.parentNode) viewer.remove();
        }, 4000);
    }
});


// === Gestion des likes ===
// Empêcher plusieurs likes par session
// LIKE / DISLIKE (toggle avec mémoire locale)
document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".likebtn");
    if (!btn) return;

    const post = btn.closest(".post");
    if (!post) return console.error("❌ post element not found for like button");

    const postId = post.dataset && post.dataset.id;
    if (!postId) return console.error("❌ post id missing");

    const likeCount = post.querySelector(".like-count");
    if (!likeCount) return console.error("❌ like-count element not found");

    // Récupération des likes déjà faits
    let likedPosts = JSON.parse(localStorage.getItem("likedPosts") || "[]");

    const alreadyLiked = likedPosts.includes(postId);

    try {
        // --- DISLIKE ---
        if (alreadyLiked) {
            const res = await fetch(`https://moodshare-7dd7.onrender.com/api/posts/${postId}/unlike`, {
                method: "POST"
            });

            if (!res.ok) throw new Error("Erreur serveur");

            likeCount.textContent = String(Math.max(0, parseInt(likeCount.textContent || "0") - 1));
            btn.classList.remove("liked");

            // Retirer de localStorage
            likedPosts = likedPosts.filter(id => id !== postId);
            localStorage.setItem("likedPosts", JSON.stringify(likedPosts));
            return;
        }

        // --- LIKE ---
        const res = await fetch(`https://moodshare-7dd7.onrender.com/api/posts/${postId}/like`, {
            method: "POST"
        });

        if (!res.ok) throw new Error("Erreur serveur");

        likeCount.textContent = String(parseInt(likeCount.textContent || "0") + 1);

        btn.classList.add("liked");
        btn.style.animation = "likePop 0.3s ease";

        // Sauvegarde locale
        likedPosts.push(postId);
        localStorage.setItem("likedPosts", JSON.stringify(likedPosts));

    } catch (err) {
        if (typeof showFeedback === 'function') showFeedback("error", "Impossible de mettre à jour le like.");
        console.error(err);
    }
});


async function likePost(postId, likeBtn) {
    try {
        const response = await fetch(`/api/posts/${postId}/like`, {
            method: 'POST'
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const updated = await response.json();
        const countSpan = likeBtn.querySelector('.like-count');
        if (countSpan) countSpan.textContent = String(updated.likes || 0);

        likeBtn.classList.add('liked');
    } catch (error) {
        console.error('❌ Erreur like:', error);
    }
}