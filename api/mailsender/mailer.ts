import nodemailer from 'nodemailer';

export async function sendOtpEmail(to: string, otp: string, type: 'verify' | 'reset') {
  const subject = type === 'verify' ? 'Verify your MailSender account' : 'Reset your MailSender password';
  const action  = type === 'verify' ? 'activate your account' : 'reset your password';
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:32px;background:#0f172a;color:#e2e8f0;border-radius:16px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
      <div style="width:36px;height:36px;background:#6366f1;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:#fff">M</div>
      <span style="font-size:20px;font-weight:700;color:#fff">MailSender</span>
    </div>
    <h2 style="color:#e2e8f0;font-size:18px;margin-bottom:8px">Your verification code</h2>
    <p style="color:#94a3b8;margin-bottom:24px;font-size:14px">Use this code to ${action}. Expires in 15 minutes.</p>
    <div style="background:#1e293b;border:2px solid #6366f1;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
      <div style="font-size:40px;font-weight:900;letter-spacing:10px;color:#6366f1;font-family:monospace">${otp}</div>
    </div>
    <p style="color:#64748b;font-size:12px">If you didn't request this, ignore this email. Do not share this code.</p>
  </div>`;

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.EMAIL_PORT || '465', 10);

  if (!user || !pass) {
    console.log(`[OTP] No email credentials set. Code for ${to}: ${otp} (type: ${type})`);
    throw new Error('EMAIL_USER or EMAIL_PASS not configured');
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,   // true for 465 (SSL), false for 587 (STARTTLS)
    auth: { user, pass },
    // SECURITY: certificate verification is ON by default — this connection
    // carries the OTP and the EMAIL_PASS credential, so accepting any cert made
    // it trivially MITM-able. If the configured OTP relay genuinely uses a
    // self-signed certificate (some IONOS setups do), set EMAIL_TLS_INSECURE=1.
    tls: { rejectUnauthorized: process.env.EMAIL_TLS_INSECURE !== '1' },
  });

  await transport.sendMail({
    from: `"MailSender" <${user}>`,
    to,
    subject,
    html,
  });
}

