export function requireDurableUploadStorage(_req, res, next) {
  // Vercel and other production serverless filesystems are not durable. Keep
  // upload-backed business operations fail-closed until private object storage
  // is implemented; local development remains available for safe testing.
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    return res.status(503).json({
      code: 'DURABLE_UPLOAD_STORAGE_REQUIRED',
      error: 'Online file submissions are temporarily unavailable while secure storage is being configured.'
    });
  }
  return next();
}
