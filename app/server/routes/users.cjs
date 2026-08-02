const express = require("express");
const router = express.Router();
const UserModel = require('../models/User.cjs');


// GET /api/users/me
router.get("/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  try {
    const user = await UserModel.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ id: user._id, displayName: user.displayName });
  } catch (err) {
    console.error("Error /api/users/me", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/users/me  -> mise à jour du profil (persister en DB)
router.put("/me", express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const updates = req.body || {};

  try {
    const user = await UserModel.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (updates.displayName) user.displayName = updates.displayName;
    await user.save();

    res.json({ id: user._id, displayName: user.displayName});
  } catch (err) {
    console.error("Error update /api/users/me", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get('/recommended', async (req, res) => {
  try {
    const users = await UserModel.find({ isGuest: false }).limit(6);
    res.json(users.map(u => ({ id: u._id, displayName: u.displayName})));
  } catch (err) {
    console.error("Error /users/recommended", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await UserModel.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Not found' });
    res.json({ id: user._id, displayName: user.displayName });
  } catch (err) {
    console.error("Error /users/:id", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  try {
    const users = await UserModel.find({
      isGuest: false,
      $or: [
        { displayName: { $regex: q, $options: 'i' } }
      ]
    }).limit(10);
    res.json(users.map(u => ({ id: u._id, displayName: u.displayName })));
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id/public-key
router.get('/:id/public-key', async (req, res) => {
  try {
    const user = await UserModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ publicKey: user.publicKey });
  } catch (err) {
    console.error("Error /api/users/:id/public-key", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
