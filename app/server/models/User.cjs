const mongoose = require("mongoose");

// ============================================================
// USER SCHEMA pour MongoDB
// ============================================================
const userSchema = new mongoose.Schema({
  _id: { type: String, default: () => Date.now().toString() },
  displayName: { type: String, required: true },
  password: { type: String, required: true },
  isGuest: { type: Boolean, default: false },
  pushTokens: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now }
}, { _id: false });

const UserModel = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = UserModel;