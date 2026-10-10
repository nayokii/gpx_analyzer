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


/**
 * Contexte 2D qui journalise TOUT : appels de méthodes, affectations de propriétés (font, fillStyle…) et arrêts de
 * dégradé. Sert à prouver qu'un rendu est strictement identique d'une version du code à l'autre (empreinte du journal).
 */
export function loggingCtx() {
  const log = [];
  const ser = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
  const gradient = (kind, args) => {
    const g = { __gradient: kind, args, stops: [] };
    log.push(["gradient", kind, ...args.map(ser)]);
    return new Proxy(g, { get: (t, p) => (p === "addColorStop" ? (o, c) => { t.stops.push([o, c]); log.push(["stop", o, c]); } : t[p]) });
  };
  const target = {};
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (prop === "log") return log;
      if (prop === "measureText") return (text) => ({ width: String(text).length * 12 });
      if (prop === "createLinearGradient") return (...a) => gradient("linear", a);
      if (prop === "createRadialGradient") return (...a) => gradient("radial", a);
      if (prop in t) return t[prop];
      return (...args) => { log.push([String(prop), ...args.map(ser)]); };
    },
    set(t, prop, value) {
      log.push(["set", String(prop), value && value.__gradient ? `gradient:${JSON.stringify(value.stops)}` : ser(value)]);
      t[prop] = value;
      return true;
    },
  });
  return ctx;
}
