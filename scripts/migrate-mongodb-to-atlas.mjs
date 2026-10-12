import { createHash } from 'node:crypto';
import { setServers } from 'node:dns';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import mongodb from 'mongodb';

const { BSON, MongoClient, ObjectId } = mongodb;
const { EJSON } = BSON;

const MIGRATION_ENV_PATH = path.resolve('.env.migration.local');
let migrationEnvironment;
try {
  migrationEnvironment = dotenv.parse(readFileSync(MIGRATION_ENV_PATH));
} catch (error) {
  if (error?.code === 'ENOENT') {
    throw new Error('Missing private migration configuration file: .env.migration.local');
  }
  throw error;
}

// Connection values intentionally come only from the ignored migration file.
// Application .env values and inherited connection variables are not fallbacks.
const DATABASE_NAME = migrationEnvironment.MIGRATION_DB_NAME || 'bmprinting';
const EXECUTE = process.argv.includes('--execute');
const REPORT_ARG = process.argv.find(arg => arg.startsWith('--report='));
const REPORT_PATH = path.resolve(REPORT_ARG?.slice('--report='.length) || 'artifacts/mongodb-atlas-migration-report.json');
const REQUIRED_COLLECTIONS = [
  'users', 'employees', 'products', 'orders', 'productions', 'inventories',
  'stockmovements', 'notifications', 'orderfiles', 'contactmessages', 'auditlogs'
];
const SENSITIVE_URI_PATTERN = /mongodb(?:\+srv)?:\/\/[^\s]+/gi;

function fail(message) {
  throw new Error(message);
}

function cleanError(error) {
  return String(error?.message || error).replace(SENSITIVE_URI_PATTERN, '[redacted MongoDB URI]');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function fingerprint(document) {
  const canonical = stable(EJSON.serialize(document, { relaxed: false }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function printableId(value) {
  if (value instanceof ObjectId) return value.toHexString();
  return String(value);
}

function relevantIndex(index) {
  const allowed = ['name', 'unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression', 'collation', 'hidden', 'wildcardProjection'];
  return {
    key: stable(index.key),
    options: Object.fromEntries(allowed.filter(key => index[key] !== undefined).map(key => [key, stable(index[key])]))
  };
}

function indexDefinitionSignature(index, includeName = false) {
  const definition = relevantIndex(index);
  if (!includeName) delete definition.options.name;
  // Compound-index field order is semantically significant, so represent the
  // key as ordered entries while canonicalizing only the option values.
  return JSON.stringify({ key: Object.entries(definition.key), options: stable(definition.options) });
}

async function collectionNames(db) {
  return (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(item => item.name)
    .filter(name => !name.startsWith('system.'))
    .sort();
}

async function compareCollection(localDb, atlasDb, name) {
  const localCollection = localDb.collection(name);
  const atlasCollection = atlasDb.collection(name);
  const [localDocuments, atlasDocuments, localIndexes, atlasIndexes] = await Promise.all([
    localCollection.find({}).toArray(),
    atlasCollection.find({}).toArray(),
    localCollection.listIndexes().toArray().catch(error => error.codeName === 'NamespaceNotFound' ? [] : Promise.reject(error)),
    atlasCollection.listIndexes().toArray().catch(error => error.codeName === 'NamespaceNotFound' ? [] : Promise.reject(error))
  ]);

  const atlasById = new Map(atlasDocuments.map(document => [printableId(document._id), document]));
  const missingDocuments = [];
  const matchingIds = [];
  const conflictingIds = [];
  for (const document of localDocuments) {
    const id = printableId(document._id);
    const atlasDocument = atlasById.get(id);
    if (!atlasDocument) missingDocuments.push(document);
    else if (fingerprint(document) === fingerprint(atlasDocument)) matchingIds.push(id);
    else conflictingIds.push(id);
  }

  const localIds = new Set(localDocuments.map(document => printableId(document._id)));
  const atlasOnlyIds = atlasDocuments.map(document => printableId(document._id)).filter(id => !localIds.has(id));
  const atlasSignatures = new Set(atlasIndexes.filter(index => index.name !== '_id_').map(index => indexDefinitionSignature(index)));
  const atlasByName = new Map(atlasIndexes.map(index => [index.name, index]));
  const missingIndexes = [];
  const conflictingIndexes = [];
  for (const index of localIndexes.filter(item => item.name !== '_id_')) {
    if (atlasSignatures.has(indexDefinitionSignature(index))) continue;
    const sameName = atlasByName.get(index.name);
    if (sameName && indexDefinitionSignature(sameName, true) !== indexDefinitionSignature(index, true)) {
      conflictingIndexes.push({ name: index.name, local: relevantIndex(index), atlas: relevantIndex(sameName) });
    } else {
      missingIndexes.push(index);
    }
  }

  // Detect an Atlas document with a different _id but the same value covered
  // by a local unique index. Such a row would make an upsert fail and may be a
  // partially migrated/conflicting business record, so never write past it.
  const uniqueKeyConflicts = [];
  for (const index of localIndexes.filter(item => item.name !== '_id_' && item.unique)) {
    for (const document of missingDocuments) {
      const entries = Object.keys(index.key).map(field => [field, document[field]]);
      if (entries.some(([, value]) => value === undefined)) continue;
      if (index.sparse && entries.some(([, value]) => value === null || value === '')) continue;
      const keyFilter = Object.fromEntries(entries);
      const filter = index.partialFilterExpression ? { $and: [keyFilter, index.partialFilterExpression] } : keyFilter;
      const collision = await atlasCollection.findOne(filter, { projection: { _id: 1 } });
      if (collision && printableId(collision._id) !== printableId(document._id)) {
        uniqueKeyConflicts.push({ index: index.name, localId: printableId(document._id), atlasId: printableId(collision._id) });
      }
    }
  }

  return {
    name,
    localCount: localDocuments.length,
    atlasCount: atlasDocuments.length,
    matchingCount: matchingIds.length,
    missingDocuments,
    missingIds: missingDocuments.map(document => printableId(document._id)),
    conflictingIds,
    atlasOnlyIds,
    missingIndexes,
    conflictingIndexes,
    uniqueKeyConflicts,
    localIndexes: localIndexes.map(relevantIndex),
    atlasIndexes: atlasIndexes.map(relevantIndex)
  };
}

async function duplicateValues(db, collection, field, filter = {}) {
  return db.collection(collection).aggregate([
    { $match: filter }, { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }, { $limit: 20 }
  ]).toArray();
}

async function validateRelationships(db) {
  const errors = [];
  const warnings = [];
  const uniqueChecks = [
    ['users', 'id', {}], ['users', 'email', {}], ['employees', 'email', {}],
    ['employees', 'supabaseUserId', { supabaseUserId: { $nin: [null, ''] } }],
    ['products', 'id', {}], ['orders', 'orderId', {}],
    ['productions', 'jobOrderId', { phase3: true }], ['productions', 'orderId', { phase3: true }],
    ['contactmessages', 'id', {}], ['notifications', 'eventKey', {}]
  ];
  for (const [collection, field, filter] of uniqueChecks) {
    const duplicates = await duplicateValues(db, collection, field, filter);
    if (duplicates.length) errors.push(`${collection}.${field} contains duplicate values.`);
  }

  const [adminCount, activeEmployees, activeLinkedEmployees, activeProducts] = await Promise.all([
    db.collection('users').countDocuments({ role: 'admin', password: /^\$2[ab]\$/ }),
    db.collection('employees').countDocuments({ active: true }),
    db.collection('employees').countDocuments({ active: true, supabaseUserId: { $type: 'string', $ne: '' } }),
    db.collection('products').countDocuments({ active: true })
  ]);
  if (adminCount < 1) errors.push('No legacy Admin with a bcrypt password hash exists.');
  if (activeEmployees !== 7 || activeLinkedEmployees !== 7) errors.push(`Expected 7 active, Supabase-linked employees; found ${activeEmployees} active and ${activeLinkedEmployees} linked.`);
  if (activeProducts !== 7) errors.push(`Expected 7 active products; found ${activeProducts}.`);

  const checks = [
    ['productions', 'orderId', 'orders', 'orderId', { orderId: { $type: 'string', $ne: '' } }],
    ['orderfiles', 'orderId', 'orders', 'orderId', { orderId: { $type: 'string', $ne: '' } }],
    ['stockmovements', 'inventoryId', 'inventories', '_id', { inventoryId: { $exists: true } }]
  ];
  for (const [from, localField, to, foreignField, match] of checks) {
    const broken = await db.collection(from).aggregate([
      { $match: match },
      { $lookup: { from: to, localField, foreignField, as: '_migrationTarget' } },
      { $match: { _migrationTarget: { $size: 0 } } },
      { $project: { _id: 1 } }, { $limit: 20 }
    ]).toArray();
    if (broken.length) errors.push(`${from}.${localField} has ${broken.length}${broken.length === 20 ? '+' : ''} unresolved ${to}.${foreignField} references.`);
  }

  const brokenReservations = await db.collection('productions').aggregate([
    { $unwind: '$reservedMaterials' },
    { $lookup: { from: 'inventories', localField: 'reservedMaterials.inventoryId', foreignField: '_id', as: '_migrationTarget' } },
    { $match: { _migrationTarget: { $size: 0 } } }, { $limit: 20 }
  ]).toArray();
  if (brokenReservations.length) errors.push(`productions.reservedMaterials has ${brokenReservations.length}${brokenReservations.length === 20 ? '+' : ''} unresolved inventory references.`);

  const orderJobMismatches = await db.collection('orders').aggregate([
    { $match: { jobOrderId: { $type: 'string', $ne: '' } } },
    { $lookup: { from: 'productions', localField: 'jobOrderId', foreignField: 'jobOrderId', as: '_migrationTarget' } },
    { $match: { _migrationTarget: { $size: 0 } } }, { $limit: 20 }
  ]).toArray();
  if (orderJobMismatches.length) errors.push(`orders.jobOrderId has ${orderJobMismatches.length}${orderJobMismatches.length === 20 ? '+' : ''} unresolved production references.`);

  const notificationOrderWarnings = await db.collection('notifications').aggregate([
    { $match: { relatedOrderId: { $type: 'string', $ne: '' } } },
    { $lookup: { from: 'orders', localField: 'relatedOrderId', foreignField: 'orderId', as: '_migrationTarget' } },
    { $match: { _migrationTarget: { $size: 0 } } }, { $count: 'count' }
  ]).toArray();
  if (notificationOrderWarnings[0]?.count) warnings.push(`${notificationOrderWarnings[0].count} notification order references are historical or unresolved.`);
  return { errors, warnings, facts: { adminCount, activeEmployees, activeLinkedEmployees, activeProducts } };
}

async function ensureCollections(atlasDb, names) {
  const existing = new Set(await collectionNames(atlasDb));
  for (const name of names) if (!existing.has(name)) await atlasDb.createCollection(name);
}

async function executePlan(atlasDb, comparisons) {
  await ensureCollections(atlasDb, comparisons.map(item => item.name));
  const writes = [];
  for (const comparison of comparisons) {
    const collection = atlasDb.collection(comparison.name);
    let inserted = 0;
    if (comparison.missingDocuments.length) {
      const operations = comparison.missingDocuments.map(document => ({
        updateOne: {
          filter: { _id: document._id },
          update: { $setOnInsert: Object.fromEntries(Object.entries(document).filter(([key]) => key !== '_id')) },
          upsert: true
        }
      }));
      const result = await collection.bulkWrite(operations, { ordered: true });
      inserted = result.upsertedCount;
    }
    const createdIndexes = [];
    for (const index of comparison.missingIndexes) {
      const { key, options } = relevantIndex(index);
      await collection.createIndex(key, options);
      createdIndexes.push(options.name || JSON.stringify(key));
    }
    writes.push({ collection: comparison.name, inserted, createdIndexes });
  }
  return writes;
}

async function main() {
  const localUri = migrationEnvironment.LOCAL_MONGODB_URI;
  const atlasUri = migrationEnvironment.ATLAS_MONGODB_URI;
  if (!localUri || !atlasUri) fail('Fill LOCAL_MONGODB_URI and ATLAS_MONGODB_URI in the private .env.migration.local file.');
  if (!/^mongodb:\/\//i.test(localUri)) fail('LOCAL_MONGODB_URI must be a standard local mongodb:// URI.');
  if (!/^mongodb\+srv:\/\//i.test(atlasUri)) fail('ATLAS_MONGODB_URI must be an Atlas mongodb+srv:// URI.');
  if (localUri === atlasUri) fail('Local and Atlas connection strings must be different.');
  if (EXECUTE && process.env.MIGRATION_WRITE_APPROVAL !== 'COPY_MISSING_ONLY') {
    fail('Write mode requires MIGRATION_WRITE_APPROVAL=COPY_MISSING_ONLY after the dry-run report is approved.');
  }

  // Windows may expose a loopback DNS resolver that rejects Atlas SRV/TXT
  // lookups. This override is scoped to this short-lived migration process;
  // it does not alter Windows DNS or the running BM Printing backend.
  setServers(['1.1.1.1', '8.8.8.8']);

  const localClient = new MongoClient(localUri, { serverSelectionTimeoutMS: 10000 });
  const atlasClient = new MongoClient(atlasUri, { serverSelectionTimeoutMS: 15000, maxPoolSize: 5 });
  const startedAt = new Date().toISOString();
  try {
    await Promise.all([localClient.connect(), atlasClient.connect()]);
    const localDb = localClient.db(DATABASE_NAME);
    const atlasDb = atlasClient.db(DATABASE_NAME);
    const [localInfo, atlasInfo, localCollections, atlasCollections] = await Promise.all([
      localDb.admin().serverInfo(), atlasDb.admin().serverInfo(), collectionNames(localDb), collectionNames(atlasDb)
    ]);
    const missingRequiredLocal = REQUIRED_COLLECTIONS.filter(name => !localCollections.includes(name));
    if (missingRequiredLocal.length) fail(`Local database is missing required collections: ${missingRequiredLocal.join(', ')}`);

    const comparisons = [];
    for (const name of localCollections) comparisons.push(await compareCollection(localDb, atlasDb, name));
    const conflicts = comparisons.flatMap(item => [
      ...item.conflictingIds.map(id => `${item.name}._id=${id}`),
      ...item.conflictingIndexes.map(index => `${item.name}.index=${index.name}`),
      ...item.uniqueKeyConflicts.map(conflict => `${item.name}.uniqueIndex=${conflict.index}`)
    ]);
    const localRelationships = await validateRelationships(localDb);
    const blockers = [...localRelationships.errors];
    if (conflicts.length) blockers.push(`${conflicts.length} Atlas records/indexes conflict with local data.`);
    if (atlasInfo.versionArray?.[0] > localInfo.versionArray?.[0]) blockers.push('Atlas major version is unexpectedly newer than local MongoDB.');

    let writes = [];
    if (EXECUTE) {
      if (blockers.length) fail(`Migration blocked: ${blockers.join(' ')}`);
      writes = await executePlan(atlasDb, comparisons);
    }

    const postComparisons = [];
    if (EXECUTE) for (const name of localCollections) postComparisons.push(await compareCollection(localDb, atlasDb, name));
    const effective = EXECUTE ? postComparisons : comparisons;
    const atlasRelationships = EXECUTE ? await validateRelationships(atlasDb) : null;
    if (EXECUTE) {
      const remaining = postComparisons.reduce((sum, item) => sum + item.missingIds.length + item.conflictingIds.length + item.uniqueKeyConflicts.length + item.missingIndexes.length + item.conflictingIndexes.length, 0);
      if (remaining) blockers.push(`Post-write verification found ${remaining} remaining document or index differences.`);
      blockers.push(...atlasRelationships.errors.map(error => `Atlas relationship validation: ${error}`));
    }
    const report = {
      generatedAt: new Date().toISOString(), startedAt, mode: EXECUTE ? 'execute' : 'dry-run', database: DATABASE_NAME,
      servers: { localVersion: localInfo.version, atlasVersion: atlasInfo.version },
      collections: {
        required: REQUIRED_COLLECTIONS,
        local: localCollections,
        atlasBefore: atlasCollections,
        missingRequiredInAtlasBefore: REQUIRED_COLLECTIONS.filter(name => !atlasCollections.includes(name))
      },
      comparison: effective.map(item => ({
        collection: item.name, localCount: item.localCount, atlasCount: item.atlasCount,
        matchingCount: item.matchingCount, missingCount: item.missingIds.length,
        missingIds: item.missingIds, conflictingIds: item.conflictingIds, atlasOnlyIds: item.atlasOnlyIds,
        missingIndexes: item.missingIndexes.map(relevantIndex), conflictingIndexes: item.conflictingIndexes,
        uniqueKeyConflicts: item.uniqueKeyConflicts,
        localIndexes: item.localIndexes, atlasIndexes: item.atlasIndexes
      })),
      relationships: { local: localRelationships, atlasAfter: atlasRelationships }, blockers, writes,
      safeToExecute: !blockers.length,
      totals: {
        local: comparisons.reduce((sum, item) => sum + item.localCount, 0),
        atlasBefore: comparisons.reduce((sum, item) => sum + item.atlasCount, 0),
        matchingBefore: comparisons.reduce((sum, item) => sum + item.matchingCount, 0),
        missingBefore: comparisons.reduce((sum, item) => sum + item.missingIds.length, 0),
        conflictsBefore: comparisons.reduce((sum, item) => sum + item.conflictingIds.length + item.uniqueKeyConflicts.length + item.conflictingIndexes.length, 0)
      }
    };
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

    console.log(`MongoDB migration ${report.mode} complete (no credentials printed).`);
    console.log(`Local ${localInfo.version} -> Atlas ${atlasInfo.version}; database: ${DATABASE_NAME}`);
    console.log(`Documents: local=${report.totals.local}, Atlas before=${report.totals.atlasBefore}, matching=${report.totals.matchingBefore}, missing=${report.totals.missingBefore}, conflicts=${report.totals.conflictsBefore}`);
    for (const item of report.comparison) console.log(`- ${item.collection}: local=${item.localCount}, atlas=${item.atlasCount}, matching=${item.matchingCount}, missing=${item.missingCount}, conflicts=${item.conflictingIds.length + item.uniqueKeyConflicts.length}, missingIndexes=${item.missingIndexes.length}, indexConflicts=${item.conflictingIndexes.length}`);
    for (const warning of localRelationships.warnings) console.warn(`Warning: ${warning}`);
    if (blockers.length) {
      for (const blocker of blockers) console.error(`BLOCKER: ${blocker}`);
      process.exitCode = 2;
    } else if (!EXECUTE) {
      console.log('DRY RUN ONLY: no database writes were performed. Review the report and obtain approval before --execute.');
    }
    console.log(`Report: ${REPORT_PATH}`);
  } finally {
    await Promise.allSettled([localClient.close(), atlasClient.close()]);
  }
}

main().catch(error => {
  console.error(`Migration failed: ${cleanError(error)}`);
  process.exitCode = 1;
});
