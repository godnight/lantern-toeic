/* Load before the page router. Only registered ordinary-Practice UI entries are owned. */
(function () {
  if (window.__lanternPracticeHistory) return;
  var live = new Map(), retired = new Map(), pending = null;
  function key(state) { try { return JSON.stringify(state) ?? null; } catch (_) { return null; } }
  function matches(target, state) {
    return target && target.href === location.href && target.stateKey !== null && target.stateKey === key(state);
  }
  window.addEventListener('popstate', function (event) {
    if (pending) {
      var closing = pending; pending = null;
      if (Date.now() <= closing.until && matches(closing.target, event.state)) { event.stopImmediatePropagation(); return; }
    }
    var entries = Array.from(live.values()), entry = entries[entries.length - 1];
    if (!entry || !matches(entry.target, event.state)) return;
    event.stopImmediatePropagation(); entry.onPop(event);
  });
  window.__lanternPracticeHistory = {
    version: 1,
    claim: function (id, field, target, onPop) { retired.delete(id); live.set(id, {field:field,target:target,onPop:onPop,ownedKey:null}); },
    own: function (id, state) { var entry = live.get(id); if (entry) entry.ownedKey = key(state); },
    release: function (id) {
      var entry = live.get(id); if (entry) { retired.set(id, {field:entry.field,target:entry.target,ownedKey:entry.ownedKey}); live.delete(id); }
      if (retired.size > 8) retired.delete(retired.keys().next().value);
    },
    previous: function (id, field, state) { var old = retired.get(id); return old && old.field === field && old.ownedKey !== null && old.ownedKey === key(state) ? old.target : null; },
    consume: function (target) { pending = {target:target,until:Date.now()+1000}; }
  };
})();
