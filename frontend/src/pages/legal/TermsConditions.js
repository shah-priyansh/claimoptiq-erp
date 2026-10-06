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

const TermsConditions = () => {
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
          <h1 className="text-2xl font-bold text-gray-800 mb-1">Terms &amp; Conditions</h1>
          <p className="text-xs text-gray-400 mb-8">Last updated: 6 October 2026</p>

          <p className="text-sm text-gray-600 leading-relaxed mb-6">
            {`These Terms & Conditions ("Terms") govern access to and use of ClaimOptiq (the "Platform"), a claim and billing management system owned and operated by ${COMPANY_NAME} ("${COMPANY_NAME}", "we", "us", or "our"). By logging into or using the Platform, you ("User") agree to be bound by these Terms. If you do not agree, you must not access or use the Platform. These Terms are governed by the laws of India.`}
          </p>

          <Section title="1. Eligibility and Account Access">
            <ul className="list-disc pl-5 space-y-1">
              <li>Access to the Platform is restricted to personnel authorized by {COMPANY_NAME} and its affiliated hospitals, Third Party Administrators (TPAs), insurers, and references.</li>
              <li>Accounts and login credentials are provided by an administrator and are issued to you individually; they must not be shared with or transferred to any other person.</li>
              <li>You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account.</li>
              <li>You must notify {COMPANY_NAME} immediately of any unauthorized use of your account or any other breach of security.</li>
            </ul>
          </Section>

          <Section title="2. Use of the Platform">
            <ul className="list-disc pl-5 space-y-1">
              <li>The Platform is to be used solely for legitimate business purposes relating to claim administration, billing, invoicing, and related record-keeping on behalf of {COMPANY_NAME} and its partners.</li>
              <li>You agree to enter accurate, complete, and truthful information, including patient, claim, and financial data, and to promptly correct any errors upon discovery.</li>
              <li>You must not use the Platform to upload unlawful, fraudulent, defamatory, or infringing content, or to misrepresent claim, billing, or patient information.</li>
              <li>You must not attempt to gain unauthorized access to any part of the Platform, other accounts, or data that your role is not permitted to access under the applicable role-based access controls.</li>
              <li>You must not reverse engineer, decompile, scrape, or otherwise attempt to extract the source code or underlying data structures of the Platform.</li>
            </ul>
          </Section>

          <Section title="3. Role-Based Access and Data Responsibility">
            <p>
              The Platform enforces role-based permissions so that users only access data relevant to
              their function (e.g., claims, invoices, reports). You are responsible for data you
              create, upload, or modify under your account, and must ensure that any patient or
              financial data you handle is accurate and used strictly for the purpose for which it was
              collected.
            </p>
          </Section>

          <Section title="4. Intellectual Property">
            <p>
              The Platform, including its software, design, workflows, trademarks, and underlying
              technology, is the property of {COMPANY_NAME} and its licensors and is protected under
              applicable Indian intellectual property laws, including the Copyright Act, 1957 and the
              Trade Marks Act, 1999. Nothing in these Terms grants you any ownership rights in the
              Platform; you are granted only a limited, non-exclusive, non-transferable right to access
              and use it for its intended business purpose during the term of your authorization.
            </p>
          </Section>

          <Section title="5. Data Ownership and Confidentiality">
            <p>
              Claim, patient, and financial records entered into the Platform remain the property of
              {` ${COMPANY_NAME}`} and the respective hospitals, TPAs, or insurers to whom the records
              relate. Users must treat all patient and financial information as confidential and must
              not disclose it outside the scope of their authorized role, except as required by law.
            </p>
          </Section>

          <Section title="6. Availability and Modifications">
            <p>
              We strive to keep the Platform available and operational but do not guarantee
              uninterrupted, error-free, or continuous access. We may modify, suspend, or discontinue
              any feature of the Platform, or perform scheduled or emergency maintenance, at any time
              without prior notice.
            </p>
          </Section>

          <Section title="7. Disclaimer of Warranties">
            <p>
              The Platform is provided on an "as is" and "as available" basis. To the fullest extent
              permitted under Indian law, {COMPANY_NAME} disclaims all warranties, express or implied,
              including but not limited to warranties of merchantability, fitness for a particular
              purpose, and non-infringement, in relation to the Platform.
            </p>
          </Section>

          <Section title="8. Limitation of Liability">
            <p>
              To the extent permitted by applicable law, {COMPANY_NAME} shall not be liable for any
              indirect, incidental, special, or consequential damages arising from or related to the
              use of, or inability to use, the Platform, including but not limited to loss of data,
              revenue, or business opportunity, except where such liability arises from our gross
              negligence or wilful misconduct.
            </p>
          </Section>

          <Section title="9. Indemnification">
            <p>
              You agree to indemnify and hold {COMPANY_NAME} harmless from any claims, losses, or
              damages, including reasonable legal fees, arising out of your misuse of the Platform,
              breach of these Terms, or violation of any applicable law.
            </p>
          </Section>

          <Section title="10. Suspension and Termination">
            <p>
              We may suspend or terminate your access to the Platform at any time, with or without
              notice, if we reasonably believe you have violated these Terms, misused patient or
              financial data, or if your relationship with {COMPANY_NAME}, the hospital, TPA, insurer,
              or reference you represent comes to an end.
            </p>
          </Section>

          <Section title="11. Changes to These Terms">
            <p>
              We may revise these Terms from time to time. The "Last updated" date at the top of this
              page reflects the most recent revision. Continued use of the Platform after changes are
              posted constitutes acceptance of the revised Terms.
            </p>
          </Section>

          <Section title="12. Governing Law and Dispute Resolution">
            <p>
              These Terms are governed by and construed in accordance with the laws of India. Any
              dispute arising out of or in connection with these Terms shall first be attempted to be
              resolved amicably, and failing that, shall be subject to arbitration under the
              Arbitration and Conciliation Act, 1996, with the seat of arbitration at Surat, Gujarat.
              Subject to the foregoing, the courts at Surat, Gujarat, India shall have exclusive
              jurisdiction.
            </p>
          </Section>

          <Section title="13. Contact Us">
            <p>For any questions regarding these Terms, please contact:</p>
            <p>
              {COMPANY_NAME}<br />
              {COMPANY_ADDRESS}<br />
              Email: <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-600 hover:underline">{CONTACT_EMAIL}</a>
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

export default TermsConditions;
