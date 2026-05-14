const mongoose = require('mongoose');

const billingServiceSchema = new mongoose.Schema({
  serviceName: { type: String, required: true },
  billingType: {
    type: String,
    enum: ['fixed_monthly', 'per_claim_slab', 'fixed_onetime'],
    required: true
  },
  fixedAmount: { type: Number, default: 0 },
  claimLimit: { type: Number, default: 0 },
  overLimitBehavior: {
    type: String,
    enum: ['no_charge', 'per_claim', 'stop'],
    default: 'no_charge'
  },
  overLimitPerClaimAmount: { type: Number, default: 0 },
  slabRangeStart: { type: Number, default: 0 },
  slabRangeEnd: { type: Number, default: 50000 },
  slabBasePrice: { type: Number, default: 2000 },
  slabIncrementRange: { type: Number, default: 50000 },
  slabIncrementPrice: { type: Number, default: 500 },
  calculationBasis: {
    type: String,
    enum: ['hospital_final_bill', 'final_approval', 'none'],
    default: 'none'
  },
  isActive: { type: Boolean, default: true }
}, { _id: true });

const doctorSchema = new mongoose.Schema({
  name:           { type: String, required: true, trim: true },
  specialization: { type: String, default: '', trim: true },
  phone:          { type: String, default: '' },
  email:          { type: String, default: '' },
}, { _id: true });

const hospitalSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  contact: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  pincode: { type: String, default: '' },
  referenceBy: { type: String, default: '' },
  billingServices: [billingServiceSchema],
  doctors: [doctorSchema],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Hospital', hospitalSchema);
