// New servers explicitly report whether MongoDB is configured. Older servers
// returned only { products: [] }; that response represents the known legacy
// bootstrap state, not an intentional all-products deactivation.
export function catalogSource(apiPayload, legacyProducts) {
  const managed = Array.isArray(apiPayload?.products) ? apiPayload.products : null;
  if (!managed) return null;
  const explicitlyUnconfigured = apiPayload.catalogConfigured === false;
  const legacyEmptyResponse = apiPayload.catalogConfigured === undefined && managed.length === 0;
  return explicitlyUnconfigured || legacyEmptyResponse ? legacyProducts : managed;
}
