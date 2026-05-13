const mongoose = require('mongoose');

const claimDocumentTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, trim: true, default: '' },
  isRequired: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  isSystem: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('ClaimDocumentType', claimDocumentTypeSchema);
