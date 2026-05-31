/* ══════════════════════════════════════════════════════════════
   O I FEEL — Article Post Scripts
   ══════════════════════════════════════════════════════════════ */

// ────────────────────────────────── Scroll Progress Bar ──────────────────────────────────
function updateScrollProgress() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight; const scrolled = (scrollTop / docHeight) * 100;
    document.getElementById('scroll-progress-fill').style.width = scrolled + '%';
}

window.addEventListener('scroll', updateScrollProgress);

// ────────────────────────────────── Smooth Animations on Scroll ──────────────────────────────────
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observer all content sections for animation on scroll
document.querySelectorAll('.content-section, .hero-content, .hero-image').forEach(el => {
    observer.observe(el);
});

// ────────────────────────────────── Back Button Navigation ──────────────────────────────────
const navLogo = document.querySelector('.nav-logo');
if (navLogo) {
    navLogo.addEventListener('click', (e) => {
        e.preventDefault();
        window.history.back();
    });
}

// ────────────────────────────────── CTA Button Navigation ──────────────────────────────────
const ctaButton = document.querySelector('.cta-button a');
if (ctaButton) {
    ctaButton.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = e.target.href;
    });
}

// ────────────────────────────────── Header Scroll Shadow ──────────────────────────────────
const header = document.getElementById('article-header');

window.addEventListener('scroll', () => {
    if (window.scrollY > 0) {
        header.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.3)';
    } else {
        header.style.boxShadow = 'none';
    }
});

// ────────────────────────────────── Initialize ──────────────────────────────────
console.log('O I FEEL Article Post loaded successfully!');
