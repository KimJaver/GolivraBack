function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === '');

  if (missing.length > 0) {
    throw createHttpError(400, `Missing required fields: ${missing.join(', ')}`);
  }
}

module.exports = {
  createHttpError,
  requireFields,
};
