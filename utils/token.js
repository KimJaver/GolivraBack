const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Hash SHA-256 du jeton opaque — stocké en base (`sessions.token_hash`). */
function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

module.exports = {
  generateToken,
  hashSessionToken,
};
