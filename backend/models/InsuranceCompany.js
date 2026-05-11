const mongoose = require('mongoose');

const insuranceCompanySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('InsuranceCompany', insuranceCompanySchema);
