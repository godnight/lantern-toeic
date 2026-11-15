/**
 * Cloud synchronization is not ready for product data. The native identity
 * lifecycle, legacy writers/migration and server guarantees must be completed
 * before this entry point may open a database or perform network requests.
 */
export function createPageCloudSync(): never {
  throw new Error('Cloud synchronization is not available');
}
