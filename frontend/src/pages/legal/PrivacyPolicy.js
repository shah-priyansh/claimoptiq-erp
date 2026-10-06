import React from 'react';
import { Link } from 'react-router-dom';

// TODO: replace with the actual registered address / phone number once available.
const COMPANY_NAME = 'First Care Consultancy';
const COMPANY_ADDRESS = 'Surat, Gujarat, India';
const CONTACT_EMAIL = 'support@claimoptiq.com';

const Section = ({ title, children }) => (
  <div className="mb-6">
    <h2 className="text-base font-bold text-gray-800 mb-2">{title}</h2>
    <div className="text-sm text-gray-600 leading-relaxed space-y-2">{children}</div>
  </div>
);

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen flex items-start justify-center p-6 bg-gray-50">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl font-bold text-white">C</span>
          </div>
          <h1 className="text-2xl font-bold text-primary-800">ClaimOptiq</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 sm:p-10">
          <h1 className="text-2xl font-bold text-gray-800 mb-1">Privacy Policy</h1>
          <p className="text-xs text-gray-400 mb-8">Last updated: 6 October 2026</p>

          <p className="text-sm text-gray-600 leading-relaxed mb-6">
            {COMPANY_NAME} ("{COMPANY_NAME}", "we", "us", or "our") operates ClaimOptiq, a claim and
            billing management platform used to administer medical insurance claims, invoices, and
            related records on behalf of hospitals, Third Party Administrators (TPAs), insurers, and
            references. This Privacy Policy explains how we collect, use, store, share, and protect
            personal data through ClaimOptiq, in accordance with the Information Technology Act, 2000,
            the Information Technology (Reasonable Security Practices and Procedures and Sensitive
            Personal Data or Information) Rules, 2011, and the Digital Personal Data Protection Act,
            2023 ("DPDP Act"), as applicable in India.
          </p>

          <Section title="1. Information We Collect">
            <p>We may collect and process the following categories of information through the platform:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Account information:</strong> name, email address, mobile number, role, and login credentials of users authorized by {COMPANY_NAME}, hospitals, or references.</li>
              <li><strong>Patient and claim information:</strong> patient name, admission and discharge details, diagnosis, treatment, insurance policy details, claim status, and supporting documents uploaded during the claim lifecycle.</li>
              <li><strong>Sensitive personal data:</strong> health and medical records, and bank account details used for settlements, invoicing, and reconciliation — collected only to the extent necessary to process claims and payments.</li>
              <li><strong>Billing and financial information:</strong> invoices, expenses, TDS, and payment records associated with hospitals, TPAs, insurers, and parties.</li>
              <li><strong>Technical information:</strong> login timestamps, IP address, and device/browser information collected automatically for security and audit purposes.</li>
            </ul>
          </Section>

          <Section title="2. How We Use Your Information">
            <ul className="list-disc pl-5 space-y-1">
              <li>To process, track, and settle insurance claims between hospitals, TPAs, insurers, and patients.</li>
              <li>To generate invoices, manage expenses, and maintain financial records.</li>
              <li>To authenticate users and enforce role-based access control within the platform.</li>
              <li>To communicate claim status, payment reminders, and account-related notifications.</li>
              <li>To comply with applicable legal, regulatory, tax, and audit requirements in India.</li>
              <li>To detect, investigate, and prevent fraud, unauthorized access, or misuse of the platform.</li>
            </ul>
          </Section>

          <Section title="3. Legal Basis and Consent">
            <p>
              We process personal data on the basis of consent provided by the data subject (or their
              lawful guardian/representative) at the time of claim admission or account creation, and
              where necessary, for the performance of a contract between {COMPANY_NAME}, hospitals,
              TPAs, and insurers, or to comply with a legal obligation under Indian law.
            </p>
          </Section>

          <Section title="4. Sharing and Disclosure of Information">
            <p>Information collected on ClaimOptiq may be shared with:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Hospitals, insurers, and TPAs directly involved in processing a specific claim.</li>
              <li>References and other authorized intermediaries, strictly to the extent needed to fulfil their role in the claim or billing process.</li>
              <li>Government or regulatory authorities, where required under law, court order, or lawful request.</li>
              <li>Service providers (such as hosting and email infrastructure providers) who process data solely on our behalf and under contractual confidentiality obligations.</li>
            </ul>
            <p>We do not sell personal data to third parties for marketing or any other purpose.</p>
          </Section>

          <Section title="5. Data Storage and Security">
            <p>
              Data is stored on secure, access-controlled servers. We implement reasonable security
              practices including encrypted transport (HTTPS), role-based access control, password
              hashing, and restricted administrative access, in line with the security standards
              prescribed under the IT Act, 2000 and applicable rules. However, no method of electronic
              storage or transmission is 100% secure, and we cannot guarantee absolute security.
            </p>
          </Section>

          <Section title="6. Data Retention">
            <p>
              Claim, billing, and financial records are retained for as long as necessary to fulfil the
              purposes described in this policy, and thereafter as required to comply with statutory
              retention periods under applicable Indian tax, insurance, and record-keeping laws.
            </p>
          </Section>

          <Section title="7. Your Rights">
            <p>Subject to applicable law, you may have the right to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Access and request a copy of the personal data we hold about you.</li>
              <li>Request correction of inaccurate or outdated personal data.</li>
              <li>Withdraw consent, where processing is based on consent, subject to legal and contractual limitations.</li>
              <li>Request erasure of personal data that is no longer necessary, subject to our legal retention obligations.</li>
              <li>Lodge a grievance regarding the handling of your personal data with our Grievance Officer below.</li>
            </ul>
          </Section>

          <Section title="8. Cookies and Local Storage">
            <p>
              ClaimOptiq uses essential session storage (such as authentication tokens) to keep you
              signed in and to secure your session. We do not use third-party advertising or tracking
              cookies.
            </p>
          </Section>

          <Section title="9. Children's Privacy">
            <p>
              ClaimOptiq is an internal business platform intended for use by authorized adult
              personnel of hospitals, TPAs, insurers, and {COMPANY_NAME}. It is not directed at, and we
              do not knowingly collect personal data directly from, children under 18 years of age
              (patient health records of minors may be processed only as part of a claim submitted by
              their lawful guardian).
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time to reflect changes in our practices
              or applicable law. The "Last updated" date at the top of this page indicates when this
              policy was last revised. Continued use of ClaimOptiq after an update constitutes
              acceptance of the revised policy.
            </p>
          </Section>

          <Section title="11. Grievance Officer / Contact Us">
            <p>
              If you have questions, concerns, or complaints regarding this Privacy Policy or the
              handling of your personal data, please contact:
            </p>
            <p>
              {COMPANY_NAME}<br />
              {COMPANY_ADDRESS}<br />
              Email: <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-600 hover:underline">{CONTACT_EMAIL}</a>
            </p>
          </Section>

          <Section title="12. Governing Law">
            <p>
              This Privacy Policy is governed by the laws of India. Any disputes arising out of or in
              connection with this policy shall be subject to the exclusive jurisdiction of the courts
              at Surat, Gujarat, India.
            </p>
          </Section>

          <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <Link to="/login" className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline">
              Back to Sign In
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          First Care Consultancy &copy; 2026. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
