// Isolated Node rendering test: no D1/R2 bindings or hosted identity.
// Cloudflare APIs are not exercised by this fixture.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return {
    url: 'data:text/javascript,export const env = Object.freeze({});',
    shortCircuit: true,
  };
  return nextResolve(specifier, context);
}
