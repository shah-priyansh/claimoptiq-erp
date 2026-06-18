const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const prisma = require('./config/prisma');

const app = express();

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'https://claimoptiq-erp.vercel.app',
    /\.vercel\.app$/
  ],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/hospitals', require('./routes/hospitalRoutes'));
app.use('/api/insurance', require('./routes/insuranceRoutes'));
app.use('/api/tpa', require('./routes/tpaRoutes'));
app.use('/api/billing-service-names', require('./routes/billingServiceNameRoutes'));
app.use('/api/references', require('./routes/referenceRoutes'));
app.use('/api/invoices', require('./routes/invoiceRoutes'));
app.use('/api/tds-rates', require('./routes/tdsRateRoutes'));
app.use('/api/expense-categories', require('./routes/expenseCategoryRoutes'));
app.use('/api/expenses', require('./routes/expenseRoutes'));
app.use('/api/cash-bank', require('./routes/cashBankRoutes'));
app.use('/api/account-entries', require('./routes/accountEntryRoutes'));
app.use('/api/reports', require('./routes/reportsRoutes'));
app.use('/api/claims', require('./routes/claimRoutes'));
app.use('/api/roles', require('./routes/roleRoutes'));
app.use('/api/claim-statuses', require('./routes/claimStatusRoutes'));
app.use('/api/claim-document-types', require('./routes/claimDocumentTypeRoutes'));
app.use('/api/document-submissions', require('./routes/documentSubmissionRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/staff', require('./routes/staffRoutes'));
app.use('/api/settings', require('./routes/siteSettingRoutes'));
app.use('/api/bank-accounts', require('./routes/bankAccountRoutes'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'ClaimOptiq API is running' });
});


app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `File "${err.field || 'upload'}" exceeds the 50MB size limit`
      : err.message;
    return res.status(status).json({ message, code: err.code });
  }
  res.status(500).json({ message: 'Something went wrong', error: err.message });
});

const PORT = process.env.PORT || 5001;

async function main() {
  await prisma.$connect();
  console.log('PostgreSQL connected via Prisma');
  app.listen(PORT, () => {
    console.log(`ClaimOptiq Server running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
