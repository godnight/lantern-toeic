// The owner installs the listener before any asynchronous startup work. The
// supplied signal must not be one Miniflare handles by forcing process.exit.
export function manageRunner({ enabled = false, start, events, onError } = {}) {
  if (enabled !== true) throw Error('runner disabled');
  if (typeof start !== 'function' || !events || typeof events.on !== 'function' || typeof events.off !== 'function' || typeof onError !== 'function') throw Error('invalid runner');
  let requested = false, stopping;
  const unhook = () => events.off('SIGUSR2', onSignal);
  const started = Promise.resolve().then(start).then(service => {
    if (!service || typeof service.close !== 'function') throw Error('invalid service');
    return service;
  });
  const stop = () => {
    requested = true;
    if (!stopping) stopping = started.then(service => service.close()).finally(unhook);
    return stopping;
  };
  const onSignal = () => { void stop().catch(onError); };
  events.on('SIGUSR2', onSignal);
  void started.catch(unhook);
  return Object.freeze({ started, stop, get requested() { return requested; } });
}
