const twilio = require('twilio');

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials are not configured');
  }

  return twilio(accountSid, authToken);
}

async function sendSms(to, body) {
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!from) {
    throw new Error('TWILIO_FROM_NUMBER is not configured');
  }

  const client = getTwilioClient();
  return client.messages.create({ to, from, body });
}

module.exports = {
  sendSms,
};
