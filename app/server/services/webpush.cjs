const cron = require('node-cron');
const webpush = require('web-push');

module.exports = function createWebPush({ app, UserModel, requireAuth, mongoReady, createNotification }) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contact@oifeel.app', publicKey, privateKey);
  const configured = () => Boolean(publicKey && privateKey);
  const testCooldown = new Map();

  app.get('/api/push/public-key', (req, res) => res.json({ publicKey: publicKey || null }));
  app.get('/api/push/preferences', requireAuth, async (req, res) => {
    const user = await UserModel.findById(req.session.user.id).select('pushPreferences').lean();
    res.json(user?.pushPreferences || { activity: false, reminder: false });
  });
  app.put('/api/push/preferences', requireAuth, async (req, res) => {
    const activity = req.body?.activity === true;
    const reminder = req.body?.reminder === true;
    await UserModel.findByIdAndUpdate(req.session.user.id, { $set: { pushPreferences: { activity, reminder } } });
    res.json({ activity, reminder });
  });
  app.post('/api/push/subscribe', requireAuth, async (req, res) => {
    const subscription = req.body?.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return res.status(400).json({ error: 'Abonnement invalide' });
    await UserModel.findByIdAndUpdate(req.session.user.id, { $addToSet: { pushSubscriptions: subscription } });
    res.status(201).json({ ok: true });
  });
  app.delete('/api/push/subscribe', requireAuth, async (req, res) => {
    const endpoint = String(req.body?.endpoint || '');
    if (endpoint) await UserModel.findByIdAndUpdate(req.session.user.id, { $pull: { pushSubscriptions: { endpoint } } });
    res.json({ ok: true });
  });

  async function send(userId, notification, kind = 'activity') {
    if (!configured() || !mongoReady()) return false;
    const user = await UserModel.findById(userId).select('pushSubscriptions pushPreferences').lean();
    if (!user || !user.pushPreferences?.[kind] || !user.pushSubscriptions?.length) return false;
    const payload = JSON.stringify({ title: notification.title || 'oifeel.', body: notification.body || '', url: notification.data?.postId ? `/#post-${notification.data.postId}` : '/' });
    await Promise.all(user.pushSubscriptions.map(async subscription => {
      try { await webpush.sendNotification(subscription, payload, { TTL: 60 }); }
      catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) await UserModel.findByIdAndUpdate(userId, { $pull: { pushSubscriptions: { endpoint: subscription.endpoint } } });
      }
    }));
    return true;
  }
  app.post('/api/push/test', requireAuth, async (req, res) => {
    const id = String(req.session.user.id); const now = Date.now();
    if ((testCooldown.get(id) || 0) + 60000 > now) return res.status(429).json({ error: 'Attends une minute avant un nouvel essai.' });
    testCooldown.set(id, now);
    if (!configured()) return res.status(503).json({ error: 'Web Push non configuré sur le serveur.' });
    await send(id, { title: 'oifeel.', body: 'Les notifications sont bien activées.' });
    res.json({ ok: true });
  });
  cron.schedule('0 19 * * *', async () => {
    if (!configured() || !mongoReady()) return;
    const users = await UserModel.find({ 'pushPreferences.reminder': true, 'pushSubscriptions.0': { $exists: true } }).select('_id');
    await Promise.all(users.map(user => send(user._id, { title: 'Un peu de toi, ce soir ?', body: 'Partage ton humeur du jour avec oifeel.' }, 'reminder')));
  }, { timezone: 'Europe/Paris' });
  return { send, configured };
};
