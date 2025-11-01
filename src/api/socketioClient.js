// Lightweight socket.io client singleton (loaded lazily)
// Dynamically imports socket.io-client only when first needed to avoid unnecessary bundle weight at startup.
let ioPromise = null;
export async function getSocketIO() {
  if (!ioPromise) {
    ioPromise = import('socket.io-client').then(mod => mod.io || mod.default || mod);
  }
  return ioPromise;
}
