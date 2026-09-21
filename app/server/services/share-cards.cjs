const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

try { GlobalFonts.registerFromPath(path.join(__dirname, '../../fonts/Fredoka-VariableFont_wdth,wght.ttf'), 'Fredoka'); } catch (_) {}
const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeColor = value => /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : '#9d7bc1';
function lines(ctx, text, maxWidth) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' '); let line = ''; const output = [];
  for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (ctx.measureText(candidate).width > maxWidth && line) { output.push(line); line = word; } else line = candidate; }
  if (line) output.push(line); return output.slice(0, 4);
}
module.exports = function createShareCards({ app, PostModel }) {
  async function findVisible(id) {
    const post = await PostModel.findById(String(id)).lean();
    if (!post || (post.expiresAt && new Date(post.expiresAt) <= new Date())) return null;
    return post;
  }
  app.get('/p/:id/card.png', async (req, res) => {
    const post = await findVisible(req.params.id); if (!post) return res.status(404).end();
    const canvas = createCanvas(1200, 630), ctx = canvas.getContext('2d');
    const bg = safeColor(post.color); ctx.fillStyle = bg; ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.arc(1120, 80, 240, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 36px Fredoka, sans-serif'; ctx.fillText('oifeel.', 70, 84);
    if (post.emoji) { ctx.font = '94px sans-serif'; ctx.fillText(String(post.emoji).slice(0, 8), 70, 220); }
    ctx.font = '600 52px Fredoka, sans-serif'; let y = post.emoji ? 300 : 230;
    lines(ctx, post.text, 1030).forEach(line => { ctx.fillText(line, 70, y); y += 66; });
    ctx.globalAlpha = .78; ctx.font = '400 25px Fredoka, sans-serif'; ctx.fillText(post.anonymous ? 'Anonyme' : (post.userName || 'oifeel.'), 70, 570);
    ctx.textAlign = 'right'; ctx.fillText('oifeel.app', 1130, 570);
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }).send(canvas.toBuffer('image/png'));
  });
  app.get('/p/:id', async (req, res) => {
    const post = await findVisible(req.params.id); if (!post) return res.status(404).type('text').send('Post introuvable');
    const origin = `${req.protocol}://${req.get('host')}`; const url = `${origin}/p/${encodeURIComponent(post._id || post.id)}`;
    const title = post.anonymous ? 'Un post sur oifeel.' : `${escape(post.userName)} sur oifeel.`;
    const description = escape(String(post.text || '').slice(0, 180));
    res.set('X-Robots-Tag', 'noindex, nofollow').type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>${title}</title><meta name="description" content="${description}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:image" content="${url}/card.png"><meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=/#post-${encodeURIComponent(post._id || post.id)}"></head><body><a href="/#post-${encodeURIComponent(post._id || post.id)}">ouvrir le post</a></body></html>`);
  });
};
