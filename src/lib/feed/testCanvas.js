/** Contexte 2D enregistreur : mémorise chaque appel (méthodes) et chaque texte dessiné. */
export function recordingCtx() {
  const calls = [];
  const target = {};
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (prop === "calls") return calls;
      if (prop === "measureText") return (text) => ({ width: String(text).length * 12 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop() {} });
      if (prop in t) return t[prop];
      return (...args) => { calls.push({ op: String(prop), args }); };
    },
    set(t, prop, value) { t[prop] = value; return true; },
  });
  return ctx;
}

