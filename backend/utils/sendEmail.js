const nodemailer = require('nodemailer');

let cachedTransport;

// SMTP is "configured" only when we have a host and credentials. Without them
// we fall back to logging (see below) so the reset flow is testable locally.
function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (cachedTransport) return cachedTransport;
  const port = Number(process.env.SMTP_PORT) || 587;
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // Implicit TLS on 465; STARTTLS on 587. Overridable via SMTP_SECURE.
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return cachedTransport;
}

// Send a transactional email. Returns { delivered } — never throws for the
// dev-fallback path; a real SMTP failure will throw and should be handled by
// the caller (we deliberately don't leak that failure to the end user).
async function sendEmail({ to, subject, html, text }) {
  const from = process.env.EMAIL_FROM || 'ClaimOptiq <no-reply@claimoptiq.com>';

  if (!isSmtpConfigured()) {
    console.log('\n[email:dev-fallback] SMTP not configured — email NOT sent. Contents:');
    console.log(`  to:      ${to}`);
    console.log(`  from:    ${from}`);
    console.log(`  subject: ${subject}`);
    if (text) console.log(`  text:\n${text}`);
    console.log('');
    return { delivered: false, devFallback: true };
  }

  const info = await getTransport().sendMail({ from, to, subject, html, text });
  return { delivered: true, messageId: info.messageId };
}

module.exports = { sendEmail, isSmtpConfigured };
