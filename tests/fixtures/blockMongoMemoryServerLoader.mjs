export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'mongodb-memory-server') {
    throw new Error('mongodb-memory-server must not resolve during production backend module loading.');
  }
  return nextResolve(specifier, context);
}
