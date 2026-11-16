// Email, sent through Cloudflare's own email sending — no outside service.
//
// It only works once it has been switched on: the Worker needs a `send_email`
// binding called SALES_MAIL and a MAIL_FROM address on a domain whose email is
// handled by Cloudflare. Until then this quietly does nothing and returns
// false, and requests simply wait in the admin.
import { EmailMessage } from 'cloudflare:email';

const TO = 'sales@armera.co.uk';

// Header values must be one line of plain characters. Anything else is
// stripped, so nothing a stranger types can add a header of its own.
const oneLine = s => String(s ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
const ascii = s => oneLine(s).replace(/[^\x20-\x7e]/g, '?');

// Body as base64, so any character survives and no line can be mistaken for a header.
function b64(textBody) {
  const bytes = new TextEncoder().encode(textBody);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/(.{76})/g, '$1\r\n');
}

export async function sendSwatchEmail(env, r) {
  if (!env.SALES_MAIL || !env.MAIL_FROM) return false;
  const from = ascii(env.MAIL_FROM);
  const lines = [
    `Swatch request #${r.id}`,
    '',
    'Colours:',
    ...r.swatches.map(s => `  - ${s.range}: ${s.name}${s.code ? ` (${s.code})` : ''}`),
    '',
    'Send to:',
    `  ${r.name}`,
    ...(r.company ? [`  ${r.company}`] : []),
    `  ${r.address1}`,
    ...(r.address2 ? [`  ${r.address2}`] : []),
    `  ${r.town}`,
    `  ${r.postcode}`,
    '',
    `Email: ${r.email}`,
    ...(r.phone ? [`Telephone: ${r.phone}`] : []),
    ...(r.notes ? ['', 'Note from the customer:', r.notes] : []),
    '',
    'This request is also listed in the website admin under Swatch requests.'
  ].map(oneLineKeepingText).join('\r\n');

  const replyTo = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/.test(r.email) ? ascii(r.email) : null;
  const raw = [
    `From: ARMERA website <${from}>`,
    `To: ${TO}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: Swatch request #${r.id} - ${ascii(r.name).slice(0, 80)}`,
    `Message-ID: <swatch-${r.id}-${Date.now()}@${from.split('@')[1]}>`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(lines)
  ].join('\r\n');

  await env.SALES_MAIL.send(new EmailMessage(from, TO, raw));
  return true;
}

// Body lines keep their own text but lose control characters.
function oneLineKeepingText(s) {
  return String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ');
}
