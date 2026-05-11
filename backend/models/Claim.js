const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  fileName: { type: String, required: true },
  originalName: { type: String, required: true },
  filePath: { type: String, required: true },
  fileType: { type: String },
  fileSize: { type: Number },
  category: {
    type: String,
    enum: ['admit', 'discharge', 'bill', 'settlement_proof', 'pod', 'other'],
    default: 'other'
  },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: true });

const claimSchema = new mongoose.Schema({
  // Auto-generated
  srNo: { type: Number },
  monthClaimNo: { type: Number },
  claimGenerateDate: { type: Date, default: Date.now },

  // Status tracking
  status: {
    type: String,
    enum: ['admitted', 'discharged', 'file_received', 'submitted', 'settled', 'rejected'],
    default: 'admitted'
  },

  // Patient Admit
  hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  month: { type: Date, required: true },
  patientName: { type: String, required: true, trim: true },
  patientMobile: { type: String, default: '' },
  doctorName: { type: String, default: '' },
  claimType: {
    type: String,
    enum: ['cashless', 'reimbursement', 'grievance'],
    required: true
  },
  insuranceCompany: { type: mongoose.Schema.Types.ObjectId, ref: 'InsuranceCompany' },
  tpa: { type: mongoose.Schema.Types.ObjectId, ref: 'TPA', default: null },
  policyNo: { type: String, default: '' },
  clientId: { type: String, default: '' },
  ccnNo: { type: String, default: '' },
  dateOfAdmit: { type: Date, required: true },
  dateOfDischarge: { type: Date, default: null },

  // Discharge
  hospitalFinalBill: { type: Number, default: 0 },
  mouDiscount: { type: Number, default: 0 },
  deduction: { type: Number, default: 0 },
  finalApprovalAmount: { type: Number, default: 0 },
  finalApprovalDate: { type: Date, default: null },

  // File Receive & Submit
  fileReceivedDate: { type: Date, default: null },
  submitMode: {
    type: String,
    enum: ['online', 'offline', 'both', ''],
    default: ''
  },
  courierSubmitDate: { type: Date, default: null },
  onlineSubmitDate: { type: Date, default: null },
  courierCompanyName: { type: String, default: '' },
  podNumber: { type: String, default: '' },

  // Payment Settlement
  settlementAmount: { type: Number, default: 0 },
  settlementAmountDeduction: { type: Number, default: 0 },
  mouDiscountOnSettlement: { type: Number, default: 0 },
  tds: { type: Number, default: 0 },
  bankTransferAmount: { type: Number, default: 0 },
  settlementDate: { type: Date, default: null },
  neftNo: { type: String, default: '' },

  // Misc
  filePrice: { type: Number, default: 0 },
  remarks: { type: String, default: '' },
  rejectedReason: { type: String, default: '' },

  // Documents
  documents: [documentSchema],

  // Tracking
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Auto-generate srNo
claimSchema.pre('save', async function () {
  if (this.isNew) {
    const lastClaim = await this.constructor.findOne().sort({ srNo: -1 });
    this.srNo = lastClaim ? lastClaim.srNo + 1 : 1;

    // Month claim number
    const startOfMonth = new Date(this.month.getFullYear(), this.month.getMonth(), 1);
    const endOfMonth = new Date(this.month.getFullYear(), this.month.getMonth() + 1, 0);
    const monthCount = await this.constructor.countDocuments({
      month: { $gte: startOfMonth, $lte: endOfMonth }
    });
    this.monthClaimNo = monthCount + 1;
  }
});

claimSchema.index({ hospital: 1, status: 1 });
claimSchema.index({ patientName: 'text', policyNo: 'text', ccnNo: 'text' });
claimSchema.index({ month: 1 });

module.exports = mongoose.model('Claim', claimSchema);
