/**
 * Client Supabase simulé pour les tests unitaires de src/lib/cloud/ — imite
 * le comportement observable de `.auth.*`, `.from("activities")...` et
 * `.storage.from(bucket)...` d'un VRAI projet Supabase, y compris :
 *  - la Row Level Security (une session ne voit/modifie jamais que ses
 *    propres lignes, quel que soit le filtre demandé) ;
 *  - `user_id` forcé à l'utilisateur de la session courante, jamais à une
 *    valeur fournie par l'appelant (simule `default auth.uid()` + policy
 *    `with check` — voir supabase/schema.sql) ;
 *  - la contrainte UNIQUE (user_id, file_hash) ;
 *  - l'isolation par préfixe de chemin pour Storage.
 *
 * IMPORTANT (voir docs/CLOUD_ARCHITECTURE.md, section "Tests") : ceci est une
 * SIMULATION en mémoire, pas une preuve que les policies SQL réelles
 * (supabase/schema.sql) se comportent ainsi sur un vrai Postgres. Elle sert à
 * tester la LOGIQUE de src/lib/cloud/ (activities.js, files.js, sync.js)
 * indépendamment d'un vrai projet Supabase — la vérification de l'isolation
 * multi-utilisateur RÉELLE reste une étape manuelle décrite dans
 * supabase/schema.sql (section 4) et docs/CLOUD_ARCHITECTURE.md.
 */

export function createFakeSupabaseBackend() {
  const users = new Map(); // email -> {id, email, password}
  const activitiesTable = [];
  const storageObjects = new Map(); // path -> {content, contentType}
  let authListeners = [];
  let sessionUser = null;
  let idCounter = 0;

  function nextId(prefix) {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
  }

  function notifyAuth(event) {
    // Signature réelle de Supabase : (event, session) — session.user, jamais
    // l'utilisateur directement (voir auth.js: onAuthStateChange).
    const session = sessionUser ? { user: sessionUser } : null;
    for (const cb of authListeners) cb(event, session);
  }

  function matchesFilters(row, filters) {
    return Object.entries(filters).every(([k, v]) => row[k] === v);
  }

  function makeActivitiesBuilder() {
    let mode = "select";
    let insertRow = null;
    const filters = {};
    let wantSingle = false;
    let wantMaybeSingle = false;

    async function execute() {
      if (mode === "insert") {
        if (!sessionUser) return { data: null, error: { message: "new row violates row-level security policy", code: "42501" } };
        const dup = activitiesTable.find((r) => r.user_id === sessionUser.id && r.file_hash === insertRow.file_hash);
        if (dup) return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        const now = new Date().toISOString();
        const saved = {
          id: nextId("activity"),
          user_id: sessionUser.id, // JAMAIS insertRow.user_id -- simule `default auth.uid()` (voir schema.sql)
          local_id: insertRow.local_id ?? null,
          name: insertRow.name ?? null,
          source_type: insertRow.source_type,
          source_file_name: insertRow.source_file_name ?? null,
          source_format: insertRow.source_format,
          file_hash: insertRow.file_hash,
          started_at: insertRow.started_at ?? null,
          distance: insertRow.distance ?? null,
          duration: insertRow.duration ?? null,
          moving_time: insertRow.moving_time ?? null,
          elevation_gain: insertRow.elevation_gain ?? null,
          elevation_loss: insertRow.elevation_loss ?? null,
          avg_speed: insertRow.avg_speed ?? null,
          avg_power: insertRow.avg_power ?? null,
          avg_cadence: insertRow.avg_cadence ?? null,
          flags: insertRow.flags ?? null,
          created_at: now,
          updated_at: now,
        };
        activitiesTable.push(saved);
        return { data: saved, error: null };
      }

      if (mode === "delete") {
        if (!sessionUser) return { data: null, error: { message: "not authenticated" } };
        for (let i = activitiesTable.length - 1; i >= 0; i--) {
          if (activitiesTable[i].user_id === sessionUser.id && matchesFilters(activitiesTable[i], filters)) {
            activitiesTable.splice(i, 1);
          }
        }
        return { data: null, error: null };
      }

      // select — RLS : uniquement les lignes de la session courante, jamais celles d'un autre utilisateur
      const ownRows = sessionUser ? activitiesTable.filter((r) => r.user_id === sessionUser.id) : [];
      let rows = ownRows.filter((r) => matchesFilters(r, filters));
      rows = [...rows].sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));

      if (wantSingle) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "no rows returned" } };
      if (wantMaybeSingle) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }

    const builder = {
      select() {
        return builder;
      },
      insert(row) {
        mode = "insert";
        insertRow = row;
        return builder;
      },
      delete() {
        mode = "delete";
        return builder;
      },
      eq(col, val) {
        filters[col] = val;
        return builder;
      },
      order() {
        return builder;
      },
      single() {
        wantSingle = true;
        return execute();
      },
      maybeSingle() {
        wantMaybeSingle = true;
        return execute();
      },
      then(resolve, reject) {
        execute().then(resolve, reject);
      },
    };
    return builder;
  }

  const auth = {
    async signUp({ email, password }) {
      if (users.has(email)) return { data: { user: null }, error: { message: "User already registered" } };
      const user = { id: nextId("user"), email };
      users.set(email, { ...user, password });
      sessionUser = user;
      notifyAuth();
      return { data: { user }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const record = users.get(email);
      if (!record || record.password !== password) {
        return { data: { user: null }, error: { message: "Invalid login credentials" } };
      }
      sessionUser = { id: record.id, email: record.email };
      notifyAuth();
      return { data: { user: sessionUser }, error: null };
    },
    async signOut() {
      sessionUser = null;
      notifyAuth();
      return { error: null };
    },
    async getSession() {
      return { data: { session: sessionUser ? { user: sessionUser } : null }, error: null };
    },
    onAuthStateChange(cb) {
      authListeners.push(cb);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              authListeners = authListeners.filter((x) => x !== cb);
            },
          },
        },
      };
    },
  };

  const client = {
    auth,
    from(table) {
      if (table !== "activities") throw new Error(`fakeSupabase: table inattendue "${table}"`);
      return makeActivitiesBuilder();
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, content, opts = {}) {
            if (!sessionUser) return { data: null, error: { message: "not authenticated" } };
            if (!path.startsWith(`${sessionUser.id}/`)) {
              return { data: null, error: { message: "new row violates row-level security policy" } };
            }
            if (!opts.upsert && storageObjects.has(`${bucket}/${path}`)) {
              return { data: null, error: { message: "The resource already exists" } };
            }
            storageObjects.set(`${bucket}/${path}`, { content, contentType: opts.contentType });
            return { data: { path }, error: null };
          },
          async download(path) {
            if (!sessionUser) return { data: null, error: { message: "not authenticated" } };
            if (!path.startsWith(`${sessionUser.id}/`)) return { data: null, error: { message: "Object not found" } };
            const obj = storageObjects.get(`${bucket}/${path}`);
            if (!obj) return { data: null, error: { message: "Object not found" } };
            return {
              data: {
                text: async () => (typeof obj.content === "string" ? obj.content : new TextDecoder().decode(obj.content)),
                arrayBuffer: async () =>
                  typeof obj.content === "string" ? new TextEncoder().encode(obj.content).buffer : obj.content,
              },
              error: null,
            };
          },
          async remove(paths) {
            if (!sessionUser) return { data: null, error: { message: "not authenticated" } };
            for (const p of paths) {
              if (!p.startsWith(`${sessionUser.id}/`)) return { data: null, error: { message: "Object not found" } };
              storageObjects.delete(`${bucket}/${p}`);
            }
            return { data: {}, error: null };
          },
        };
      },
    },
  };

  return {
    client,
    /** Crée un compte ET bascule la session dessus (raccourci de test). */
    async signUpAndLogin(email, password = "password123") {
      const { data, error } = await auth.signUp({ email, password });
      if (error) throw new Error(error.message);
      return data.user;
    },
    /** Bascule la session "courante" sans repasser par signIn (raccourci de test). */
    setSessionUser(user) {
      sessionUser = user;
      notifyAuth();
    },
    _debug: { users, activitiesTable, storageObjects },
  };
}
