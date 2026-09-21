// Statistiques agrégées : aucune IP, aucun identifiant et aucun cookie.
module.exports = function createAnalytics({ mongoose, app, isAdminRequest }) {
  const schema = new mongoose.Schema({
    day: { type: String, required: true, unique: true },
    events: { type: Map, of: Number, default: {} },
    sources: { type: Map, of: Number, default: {} }
  }, { versionKey: false });
  const DailyAnalytics = mongoose.models.DailyAnalytics || mongoose.model('DailyAnalytics', schema);
  const allowedEvents = new Set(['visit', 'guest', 'signup', 'post', 'share', 'install']);
  const allowedSources = new Set(['direct', 'tiktok', 'discord', 'instagram', 'share', 'other']);
  const day = () => new Date().toISOString().slice(0, 10);

  async function track(event, source = 'direct') {
    if (!allowedEvents.has(event)) return;
    const safeSource = allowedSources.has(source) ? source : 'other';
    await DailyAnalytics.findOneAndUpdate(
      { day: day() },
      { $inc: { [`events.${event}`]: 1, [`sources.${safeSource}`]: 1 } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => {});
  }

  app.post('/api/analytics/event', async (req, res) => {
    const { event, source } = req.body || {};
    if (!allowedEvents.has(event)) return res.status(400).json({ error: 'Événement invalide' });
    await track(event, source);
    res.status(204).end();
  });
  app.get('/api/admin/analytics', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé' });
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const rows = await DailyAnalytics.find().sort({ day: -1 }).limit(days).lean();
    res.json({ days: rows.reverse() });
  });
  return { track };
};
