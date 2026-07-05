import { config as env } from '../../config.js';
import { logger } from '../../index.js';

export async function sendSMSOTP(phone: string, otp: string): Promise<void> {
  if (env.NODE_ENV !== 'production' || !env.MSG91_API_KEY) {
    logger.info(`[DEV SMS OTP]: Sent to ${phone}: ${otp}`);
    return;
  }

  try {
    const response = await fetch('https://api.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: env.MSG91_API_KEY,
      },
      body: JSON.stringify({
        template_id: env.MSG91_OTP_TEMPLATE_ID,
        mobile: phone.replace('+', ''), // MSG91 usually expects numbers without +
        authkey: env.MSG91_API_KEY,
        otp,
      }),
    });

    const data = await response.json();
    if (data.type === 'error') {
      throw new Error(`MSG91 Error: ${data.message}`);
    }

    logger.info(`OTP sent to ${phone} via MSG91`);
  } catch (error) {
    logger.error({ err: error, phone }, 'Failed to send SMS OTP via MSG91');
    throw error;
  }
}
