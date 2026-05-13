const mongoose = require('mongoose');

const claimStatusSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  label: { type: String, required: true, trim: true },
  color: { type: String, default: 'gray' }, // key: blue|green|red|yellow|purple|orange|gray|pink|indigo|teal
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  isSystem: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('ClaimStatus', claimStatusSchema);
