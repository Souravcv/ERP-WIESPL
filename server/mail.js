// The automatic thank-you email to a client after the website enquiry form. Off until the admin sets it up in Settings;
// the enquiry is already saved when this runs, so a failed email is reported to sales and never fails the enquiry.
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { db, getSettings, audit, DATA_DIR } from './db.js';
import { notify } from './notify.js';

export const MAIL_FILES = path.join(DATA_DIR, 'email-attachments');
const SYSTEM_USER = { name: 'Website form', role: 'admin' };
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export const mailFiles = () => { try { return fs.readdirSync(MAIL_FILES).sort(); } catch { return []; } };

// What still stops the email going out; empty when it is ready.
export function mailProblems(s = getSettings()) {
  const out = [];
  if (!s.web_mail_host) out.push('the mail server');
  if (!EMAIL.test(s.web_mail_from || '')) out.push('the From address');
  if (/\[Surname\]|X{4,}/i.test(s.web_mail_body || '')) out.push('the signature (name, mobile and email in the email text)');
  return out;
}

const escapeHtml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fill = (t, v) => String(t || '').replace(/\{\{(\w+)\}\}/g, (m, k) => v[k] ?? '');

async function deliver(to, values, s = getSettings()) {
  const files = mailFiles();
  // without files, the sentences that say a copy is attached would not be true
  let text = fill(s.web_mail_body, values);
  if (!files.length) text = text.replace(/[^.\n]*\battached\b[^.\n]*\.\s?/gi, '');
  const html = text.split(/\n\s*\n/).map(p => `<p style="margin:0 0 12px">${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  const port = Number(s.web_mail_port) || 587;
  const mailer = nodemailer.createTransport({ host: s.web_mail_host, port, secure: port === 465, connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 60000,
    ...(s.web_mail_user ? { auth: { user: s.web_mail_user, pass: s.web_mail_pass || '' } } : {}) });
  await mailer.sendMail({
    from: { name: s.company_short || 'WIESPL', address: s.web_mail_from }, to, subject: fill(s.web_mail_subject, values), text,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#15202f">${html}</div>`,
    ...(EMAIL.test(s.web_mail_bcc || '') ? { bcc: s.web_mail_bcc } : {}),
    attachments: files.map(filename => ({ filename, path: path.join(MAIL_FILES, filename) })),
  });
}

export async function sendTestMail(to) {
  if (!EMAIL.test(to || '')) throw new Error('Enter a valid email address for the test');
  const missing = mailProblems();
  if (missing.length) throw new Error(`Set up first: ${missing.join(', ')}`);
  await deliver(to, { name: 'Dr. Test', hospital: 'Test Hospital', enquiry_no: 'TEST', drawings: ' and drawings' });
}

// Writes the outcome on the enquiry, so sales can see whether the client got it.
export async function sendEnquiryMail(enquiry, d) {
  const s = getSettings();
  if (s.web_mail_on !== 'Yes' || !EMAIL.test(d.email || '')) return;
  const note = line => { db.prepare("UPDATE enquiries SET web_summary = COALESCE(web_summary, '') || ? WHERE id = ?").run(`\n${line}`, enquiry.id); audit(SYSTEM_USER.name, 'enquiries', enquiry.id, 'email', line); };
  const failed = reason => {
    note(`Automatic email NOT sent to ${d.email}: ${reason}`);
    notify({ fn: 'notify_enquiry', kind: 'enquiries', title: `⚠ Email to client not sent: ${enquiry.enquiry_no}`, body: `${d.name} · ${d.email}: ${reason}`, link: `#/view/enquiries/${enquiry.id}` }, SYSTEM_USER);
  };
  const missing = mailProblems(s);
  if (missing.length) { failed(`set up ${missing.join(', ')} in Settings`); return; }
  try {
    await deliver(d.email, { name: d.name, hospital: d.hospital || '', enquiry_no: enquiry.enquiry_no || '', drawings: d.has_drawing ? ' and drawings' : '' }, s);
    note(`Automatic email sent to ${d.email}`);
  } catch (e) {
    console.error('Enquiry email failed:', e.message);
    failed(String(e.message).slice(0, 200));
  }
}
