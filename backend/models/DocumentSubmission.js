const mongoose = require('mongoose');
const { Schema } = mongoose;

const documentSubmissionSchema = new Schema({
  hospital:     { type: Schema.Types.ObjectId, ref: 'Hospital', required: true },
  patientName:  { type: String, required: true, trim: true },
  documentType: { type: Schema.Types.ObjectId, ref: 'ClaimDocumentType', required: true },
  file: {
    fileName:     { type: String, required: true },
    originalName: { type: String, required: true },
    filePath:     { type: String, required: true },
    fileType:     { type: String },
    fileSize:     { type: Number },
  },
  status:      { type: String, enum: ['pending', 'reviewed', 'claimed'], default: 'pending' },
  claim:       { type: Schema.Types.ObjectId, ref: 'Claim', default: null },
  notes:       { type: String, default: '' },
  uploadedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

documentSubmissionSchema.index({ hospital: 1, status: 1 });
documentSubmissionSchema.index({ patientName: 'text' });

module.exports = mongoose.model('DocumentSubmission', documentSubmissionSchema);
