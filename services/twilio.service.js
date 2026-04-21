const twilio = require('twilio');

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Identifiants Twilio non configurés');
  }

  return twilio(accountSid, authToken);
}

async function sendSms(to, body) {
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!from) {
    throw new Error('TWILIO_FROM_NUMBER n’est pas configuré');
  }

  const client = getTwilioClient();
  return client.messages.create({ to, from, body });
}

module.exports = {
  sendSms,
};
