
const userModel = require('../models/User.cjs');
const { hashPassword, comparePassword } = require('../services/hash.cjs');
const jwtService = require('../services/jwt.cjs');

exports.register = async (req, res) => {
  const { username, password, avatar, bio } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'username and password required' });

  const existing = await userModel.getByUsername(username);
  if (existing) return res.status(409).json({ message: 'username exists' });

  const passwordHash = await hashPassword(password);
  const user = await userModel.create({ username, passwordHash, avatar, bio, recommendedScore: 0 });
  const token = jwtService.sign({ id: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio } });
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'username and password required' });

  const user = await userModel.getByUsername(username);
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

  const token = jwtService.sign({ id: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio } });
};

exports.guest = async (req, res) => {
  // create a short lived guest user and return token
  const username = `guest_${Date.now().toString(36).slice(-6)}`;
  const user = await userModel.create({ username, isGuest: true, recommendedScore: 0 });
  const token = jwtService.sign({ id: user.id, username: user.username }, '1h');
  res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio } });
};

exports.me = async (req, res) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  const u = await userModel.getById(req.user.id);
  if (!u) return res.status(404).json({ message: 'User not found' });
  res.json({ id: u.id, username: u.username, avatar: u.avatar, bio: u.bio, settings: u.settings });

};