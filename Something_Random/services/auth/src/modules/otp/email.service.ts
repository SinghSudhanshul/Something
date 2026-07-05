/**
 * Auth Service — Email Service
 *
 * Production: AWS SES v3
 * Development: Nodemailer with Ethereal test accounts (auto-created on startup)
 *
 * NEVER logs OTP values — only confirmation that email was sent.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../../config.js';

let transporter: Transporter | null = null;
let sesClient: SESClient | null = null;

async function getDevTransporter(): Promise<Transporter> {
  if (transporter !== null) {return transporter;}

  const testAccount = await nodemailer.createTestAccount();
  transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  console.info(`[Email] Dev transport ready — Ethereal user: ${testAccount.user}`);
  return transporter;
}

function getSesClient(): SESClient {
  if (sesClient !== null) {return sesClient;}
  sesClient = new SESClient({ region: config.AWS_REGION });
  return sesClient;
}

function buildOtpEmailHtml(otp: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NEXUS Verification Code</title>
</head>
<body style="margin:0;padding:0;background-color:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f8f9fa;padding:40px 0">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);padding:48px 40px">
          <tr>
            <td style="text-align:center;padding-bottom:32px">
              <h1 style="margin:0;font-size:28px;font-weight:700;color:#0f172a;letter-spacing:-0.5px">NEXUS</h1>
              <p style="margin:4px 0 0;font-size:13px;color:#94a3b8">Campus Super-App</p>
            </td>
          </tr>
          <tr>
            <td style="text-align:center;padding-bottom:32px">
              <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.5">Your verification code is:</p>
              <div style="display:inline-block;background-color:#f1f5f9;border-radius:8px;padding:16px 32px;letter-spacing:8px;font-size:32px;font-weight:700;color:#0f172a;font-family:'Courier New',monospace">${otp}</div>
            </td>
          </tr>
          <tr>
            <td style="text-align:center;padding-bottom:16px">
              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.5">This code expires in <strong>10 minutes</strong>.</p>
              <p style="margin:8px 0 0;font-size:13px;color:#94a3b8">If you didn't request this code, you can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="text-align:center;border-top:1px solid #e2e8f0;padding-top:24px">
              <p style="margin:0;font-size:12px;color:#cbd5e1">nexus.app — Built for Indian campuses</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendOtpEmail(
  to: string,
  otp: string,
): Promise<void> {
  const subject = `Your NEXUS verification code: ${otp}`;
  const html = buildOtpEmailHtml(otp);
  const text = `Your NEXUS verification code is: ${otp}\n\nThis code expires in 10 minutes.\nIf you didn't request this, ignore this email.`;

  if (config.NODE_ENV === 'development' || config.NODE_ENV === 'test') {
    const transport = await getDevTransporter();
    const info = await transport.sendMail({
      from: '"NEXUS" <no-reply@nexus.app>',
      to,
      subject,
      text,
      html,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.info(`[Email] OTP sent to ${to} — Preview: ${String(previewUrl)}`);
    return;
  }

  // Production: AWS SES
  const client = getSesClient();
  await client.send(
    new SendEmailCommand({
      Source: config.AWS_SES_FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: html },
          Text: { Data: text },
        },
      },
    }),
  );
}
