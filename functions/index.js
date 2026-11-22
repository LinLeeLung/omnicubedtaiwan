const { initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const nodemailer = require('nodemailer');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');

initializeApp();

const db = getFirestore();
const notificationAddress = 'linlilung@gmail.com';
const gmailAppPassword = defineSecret('GMAIL_APP_PASSWORD');
const allowedProducts = new Set([
  'Aqua-Jaw Carry Vise *pair*',
  'Stealth Grip',
  'Pro Dolly HD2',
  'Pro-Cart AT2',
  'S3 Table HD',
  "Sink Hole Saver Auto v6 (7')",
  'Nano Stealth Seamer Auto',
  'Pro Stealth Seamer Manual',
]);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

exports.sendInquiryNotification = onDocumentCreated(
  {
    document: 'inquiries/{inquiryId}',
    region: 'asia-east1',
    secrets: [gmailAppPassword],
  },
  async (event) => {
    const inquiry = event.data && event.data.data();
    if (!inquiry) return;

    const inquiryRef = db.collection('inquiries').doc(event.params.inquiryId);
    const claimed = await db.runTransaction(async (transaction) => {
      const currentInquiry = await transaction.get(inquiryRef);
      if (
        !currentInquiry.exists
        || currentInquiry.get('notificationStatus') === 'sent'
        || currentInquiry.get('notificationStatus') === 'sending'
      ) {
        return false;
      }

      transaction.update(inquiryRef, {
        notificationStatus: 'sending',
        notificationAttemptedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!claimed) return;

    const product = allowedProducts.has(inquiry.product) ? inquiry.product : '未指定產品';
    const details = [
      `姓名：${inquiry.name}`,
      `公司：${inquiry.company || '未提供'}`,
      `Email：${inquiry.email}`,
      `電話：${inquiry.phone || '未提供'}`,
      `產品：${product}`,
      '',
      '需求說明：',
      inquiry.message,
    ];
    const text = details.join('\n');
    const html = `<h2>Omni Cubed Taiwan 新詢價</h2><pre>${escapeHtml(text)}</pre>`;

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: notificationAddress,
        pass: gmailAppPassword.value().replace(/\s/g, ''),
      },
    });

    try {
      await transporter.sendMail({
        from: `Omni Cubed Taiwan <${notificationAddress}>`,
        to: notificationAddress,
        replyTo: inquiry.email,
        subject: `Omni Cubed Taiwan 新詢價：${product}`,
        text,
        html,
      });
      await inquiryRef.update({
        notificationStatus: 'sent',
        notificationSentAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error(`Unable to send inquiry notification for ${event.params.inquiryId}.`, error);
      await inquiryRef.update({ notificationStatus: 'failed' });
      throw error;
    }
  },
);
