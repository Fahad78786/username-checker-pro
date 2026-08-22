const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  points: { type: Number, default: 0 },
  isBlocked: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  country: { type: String, default: 'Unknown' },
  countryCode: { type: String, default: '' },
  ip: { type: String, default: '' },
  totalChecked: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
