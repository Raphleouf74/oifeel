// ═════════════════════════════════════════════════════════════
// O I FEEL — Script principal
// Animations, interactions et canvas
// ═════════════════════════════════════════════════════════════

// ───────────────────── AMBIENT BG CANVAS ───────────────────
class AmbientBackground {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.particleCount = 30;

        this.resize();
        this.init();
        this.animate();

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    init() {
        this.particles = [];
        for (let i = 0; i < this.particleCount; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2 + 1,
                opacity: Math.random() * 0.5 + 0.1
            });
        }
    }

    animate() {
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0) p.x = this.canvas.width;
            if (p.x > this.canvas.width) p.x = 0;
            if (p.y < 0) p.y = this.canvas.height;
            if (p.y > this.canvas.height) p.y = 0;

            this.ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            this.ctx.fill();
        });

        requestAnimationFrame(() => this.animate());
    }
}

// ───────────────────── SPHERE CANVAS ───────────────────
class SphereCanvas {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.rotation = 0;

        this.resize();
        this.animate();

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }

    animate() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const centerX = w / 2;
        const centerY = h / 2;
        const radius = Math.min(w, h) / 3;

        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, w, h);

        this.rotation += 0.002;

        // Gradient background
        const gradient = this.ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 1.5);
        gradient.addColorStop(0, 'rgba(100, 100, 255, 0.1)');
        gradient.addColorStop(1, 'rgba(255, 100, 150, 0.05)');
        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius * 1.5, 0, Math.PI * 2);
        this.ctx.fill();

        // Draw sphere with dots
        this.drawSphere(centerX, centerY, radius);

        requestAnimationFrame(() => this.animate());
    }

    drawSphere(cx, cy, r) {
        const dotCount = 80;

        for (let i = 0; i < dotCount; i++) {
            const angle1 = (i / dotCount) * Math.PI * 2 + this.rotation;
            const angle2 = (i / dotCount) * Math.PI + this.rotation * 0.7;

            const x = cx + Math.cos(angle1) * r * Math.sin(angle2);
            const y = cy + Math.sin(angle1) * r * Math.sin(angle2);
            const z = Math.cos(angle2);

            const opacity = (z + 1) / 2 * 0.7 + 0.2;
            const size = (z + 1) / 2 * 2 + 0.5;

            this.ctx.fillStyle = `rgba(255, 100, 150, ${opacity})`;
            this.ctx.beginPath();
            this.ctx.arc(x, y, size, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Draw sphere outline
        this.ctx.strokeStyle = 'rgba(100, 150, 255, 0.3)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.ctx.stroke();
    }
}

// ───────────────────── TUNNEL CANVAS ───────────────────
class TunnelCanvas {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.scrollProgress = 0;

        this.resize();
        this.animate();

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }

    setScrollProgress(progress) {
        this.scrollProgress = Math.max(0, Math.min(1, progress));
    }

    animate() {
        const w = this.canvas.width;
        const h = this.canvas.height;

        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, w, h);

        // Draw tunnel effect
        const centerX = w / 2;
        const centerY = h / 2;
        const rings = 20;

        for (let i = rings; i > 0; i--) {
            const progress = (i / rings - this.scrollProgress + 1) % 1;
            const radius = (progress * 150) + 10;
            const opacity = Math.sin(progress * Math.PI) * 0.5;

            if (radius > 0) {
                this.ctx.strokeStyle = `rgba(100, 150, 255, ${opacity * 0.4})`;
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                this.ctx.stroke();
            }
        }

        requestAnimationFrame(() => this.animate());
    }
}

// ───────────────────── SCROLL PROGRESS BAR ───────────────────
function initScrollProgressBar() {
    const progressBar = document.getElementById('scroll-progress-bar');
    const progressFill = document.getElementById('scroll-progress-fill');

    if (!progressBar) return;

    window.addEventListener('scroll', () => {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrolled = window.scrollY / docHeight;
        progressFill.style.width = (scrolled * 100) + '%';
    });
}

// ───────────────────── SCROLL EXPERIENCE ───────────────────
function initScrollExperience() {
    const scrollExpWrap = document.getElementById('scroll-exp-wrap');
    const steps = document.querySelectorAll('.exp-step');
    const dots = document.querySelectorAll('.sdot');
    const tunnel = new TunnelCanvas(document.getElementById('tunnel-canvas'));

    if (!scrollExpWrap) return;

    window.addEventListener('scroll', () => {
        const rect = scrollExpWrap.getBoundingClientRect();
        const viewportHeight = window.innerHeight;

        // Calculate progress (0 to 1) as user scrolls through this section
        const progress = 1 - (rect.top / viewportHeight);
        const clampedProgress = Math.max(0, Math.min(1, progress));

        tunnel.setScrollProgress(clampedProgress);

        // Update step visibility
        const stepIndex = Math.floor(clampedProgress * 2.0);
        steps.forEach((step, idx) => {
            step.classList.toggle('active', idx === stepIndex);
            const opacity = idx === stepIndex ? 1 : 0;
            step.style.opacity = opacity;
        });

        dots.forEach((dot, idx) => {
            dot.classList.toggle('active', idx === stepIndex);
        });
    });
}

// ───────────────────── SMOOTH SCROLL ANCHORS ───────────────────
function initSmoothScrollAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));

            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// ───────────────────── INTERSECTION OBSERVER (FADE-IN) ───────────────────
function initIntersectionObserver() {
    const options = {
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
    }, options);

    document.querySelectorAll('.feat-card, .news-card, .about-copy, .about-stats').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        observer.observe(el);
    });
}

// ───────────────────── HEADER SCROLL EFFECT ───────────────────
function initHeaderScrollEffect() {
    const header = document.getElementById('main-header');
    if (!header) return;
    header.style.opacity = 0;
    header.style.transform = 'translateY(-50px)';

    let lastScroll = 0;
    window.addEventListener('scroll', () => {
        const currentScroll = window.scrollY;

        if (currentScroll > 100) {
            header.style.opacity = 1;
            header.style.transform = 'translateY(0)';
            header.style.backgroundColor = 'rgba(17, 17, 17, 0.95)';
            header.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.3)';
        } else {
            header.style.opacity = 0;
            header.style.transform = 'translateY(-50px)';
            header.style.backgroundColor = 'rgba(45, 45, 45, 0.8)';
            header.style.boxShadow = 'none';
        }

        lastScroll = currentScroll;
    });
}

// ───────────────────── MARQUEE ANIMATION ───────────────────
function initMarquee() {
    const marqueeTrack = document.querySelector('.marquee-track');
    if (!marqueeTrack) return;

    let offset = 0;

    function animate() {
        offset += 1;
        if (offset > marqueeTrack.offsetWidth / 2) {
            offset = 0;
        }
        marqueeTrack.style.transform = `translateX(-${offset}px)`;
        requestAnimationFrame(animate);
    }
    animate();
}

// ───────────────────── BUTTON HOVER EFFECTS ───────────────────
function initButtonEffects() {
    document.querySelectorAll('.btn-primary, .btn-ghost').forEach(btn => {
        btn.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.05)';
        });
        btn.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
        });
    });
}

// ───────────────────── INIT ───────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Canvas animations
    const bgCanvas = document.getElementById('bg-canvas');
    const sphereCanvas = document.getElementById('sphere-canvas');

    if (bgCanvas) new AmbientBackground(bgCanvas);
    if (sphereCanvas) new SphereCanvas(sphereCanvas);

    // UI interactions
    initScrollProgressBar();
    initScrollExperience();
    initSmoothScrollAnchors();
    initIntersectionObserver();
    initHeaderScrollEffect();
    initMarquee();
    initButtonEffects();
});