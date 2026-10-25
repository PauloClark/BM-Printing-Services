export const QA_DATABASE_NAME = 'bmprinting_qa';

export function validateQaMongoConfig(uri, dbName, expectedAddress) {
  if (!uri || dbName !== QA_DATABASE_NAME || !expectedAddress) {
    throw new Error('QA mode requires an explicit replica-set URI, expected address, and bmprinting_qa database name.');
  }
  let target;
  try { target = new URL(uri); } catch { throw new Error('QA MongoDB URI is invalid.'); }
  if (target.protocol !== 'mongodb:' || target.hostname !== '127.0.0.1' || target.host !== expectedAddress ||
      decodeURIComponent(target.pathname.slice(1)) !== QA_DATABASE_NAME || target.username || target.password) {
    throw new Error('QA MongoDB URI must target the launcher-owned loopback replica set and bmprinting_qa database.');
  }
  return true;
}

export function validateQaReplicaSetHello(hello, expectedAddress) {
  if (!hello?.setName || hello.setName !== 'bmprinting_qa_rs' || !hello.hosts?.includes(expectedAddress)) {
    throw new Error('QA MongoDB connection is not the verified disposable replica-set member.');
  }
  return true;
}
