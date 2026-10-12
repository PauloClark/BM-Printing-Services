const safeToken = value => {
  const token = String(value || '').trim();
  return /^[a-z0-9_.-]{1,80}$/i.test(token) ? token : undefined;
};

const detailsFrom = error => ({
  name: safeToken(error?.name),
  code: safeToken(error?.code),
  codeName: safeToken(error?.codeName),
  syscall: safeToken(error?.syscall)
});

function nestedErrors(error) {
  const nested = [error, error?.cause, error?.reason];
  const servers = error?.reason?.servers;
  if (servers && typeof servers.values === 'function') {
    for (const server of servers.values()) nested.push(server?.error, server?.lastUpdateTimeError);
  }
  return nested.filter(Boolean);
}

export function classifyMongoError(error) {
  const errors = nestedErrors(error);
  const fields = errors.map(detailsFrom);
  const names = fields.map(item => item.name || '').join(' ');
  const codes = fields.flatMap(item => [item.code, item.codeName]).filter(Boolean);
  const syscalls = fields.map(item => item.syscall || '');

  if (codes.includes('13') || codes.some(code => /Unauthorized|Authorization/i.test(code))) return 'authorization';
  if (codes.includes('18') || codes.some(code => /Authentication|AuthFailed/i.test(code))) return 'authentication';
  if (codes.some(code => /^(ENOTFOUND|EAI_AGAIN|ENODATA|ESERVFAIL|ETIME)$/i.test(code)) ||
      syscalls.some(call => /^query(Srv|Txt)$/i.test(call))) return 'dns';
  if (codes.some(code => /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_VERIFY|DEPTH_ZERO)/i.test(code)) || /TLS|SSL/i.test(names)) return 'tls';
  if (codes.some(code => /^(ETIMEDOUT|ESOCKETTIMEDOUT)$/i.test(code)) || /Timeout/i.test(names)) return 'timeout';
  if (codes.some(code => /^(ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENETDOWN)$/i.test(code)) || /NetworkError/i.test(names)) return 'network';
  if (/ServerSelectionError/i.test(names)) return 'server-selection';
  if (/ParseError|InvalidArgument|InvalidScheme/i.test(names)) return 'configuration';
  return 'unknown';
}

export function mongoEnvironmentSummary(environment = process.env) {
  const uri = String(environment.MONGODB_URI || '');
  const maxPoolSize = Number(environment.MONGODB_MAX_POOL_SIZE || 10);
  const selectionTimeoutMs = Number(environment.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000);
  return {
    production: environment.NODE_ENV === 'production',
    vercel: Boolean(environment.VERCEL),
    uriPresent: Boolean(uri),
    uriScheme: uri.startsWith('mongodb+srv://') ? 'mongodb+srv' : uri.startsWith('mongodb://') ? 'mongodb' : uri ? 'invalid' : 'missing',
    databaseName: safeToken(environment.MONGODB_DB_NAME) || 'not-configured',
    maxPoolSize: Number.isInteger(maxPoolSize) && maxPoolSize > 0 ? maxPoolSize : 'invalid',
    serverSelectionTimeoutMs: Number.isFinite(selectionTimeoutMs) && selectionTimeoutMs > 0 ? selectionTimeoutMs : 'invalid'
  };
}

export function sanitizedMongoError(error) {
  const errors = nestedErrors(error);
  const causes = errors.slice(1).map(detailsFrom)
    .filter(item => Object.values(item).some(Boolean))
    .filter((item, index, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(item)) === index)
    .slice(0, 5);
  const topologyType = safeToken(error?.reason?.type);
  return {
    category: classifyMongoError(error),
    ...detailsFrom(error),
    ...(topologyType ? { topologyType } : {}),
    ...(causes.length ? { causes } : {})
  };
}

export function logMongoStartupFailure(error, logger = console.error) {
  logger('[MongoDB] startup failure', JSON.stringify({
    environment: mongoEnvironmentSummary(),
    error: sanitizedMongoError(error)
  }));
}

export function logMongoOperationFailure(operation, error, logger = console.error) {
  logger('[MongoDB] operation failure', JSON.stringify({
    operation: safeToken(operation) || 'unknown',
    error: sanitizedMongoError(error)
  }));
}
