export const API_JSON_BODY_LIMIT = '15mb';

export function handleJsonBodyError(error, _req, res, next) {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.', code: 'REQUEST_BODY_TOO_LARGE' });
  }
  return next(error);
}
