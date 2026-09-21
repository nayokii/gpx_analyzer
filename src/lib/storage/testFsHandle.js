/**
 * Faux FileSystemDirectoryHandle en mémoire, implémentant juste assez de
 * l'API réelle (getDirectoryHandle, getFileHandle, removeEntry, itération
 * async) pour tester activityStore.js sans navigateur.
 */

// `instanceof ArrayBuffer` échoue silencieusement quand l'objet vient d'une
// autre réalité JS que celle du test (ex. Buffer.buffer lu via `fs` sous
// l'environnement jsdom de vitest) : ArrayBuffer y désigne un constructeur
// différent. On détecte donc un ArrayBuffer par son tag interne, comme le
// fait `Array.isArray`/`ArrayBuffer.isView` en natif.
function isArrayBufferLike(value) {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

export class MemoryFileHandle {
  constructor(dir, name) {
    this.dir = dir;
    this.name = name;
    this.kind = "file";
  }
  async getFile() {
    const content = this.dir.files.has(this.name) ? this.dir.files.get(this.name) : "";
    const isBinary = isArrayBufferLike(content) || ArrayBuffer.isView(content);
    return {
      name: this.name,
      text: async () => (isBinary ? new TextDecoder().decode(content) : content),
      arrayBuffer: async () => {
        if (isArrayBufferLike(content)) return content;
        if (ArrayBuffer.isView(content)) return content.buffer;
        return new TextEncoder().encode(content).buffer;
      },
    };
  }
  async createWritable() {
    const chunks = [];
    const dir = this.dir;
    const name = this.name;
    return {
      write: async (chunk) => {
        chunks.push(chunk);
      },
      close: async () => {
        if (chunks.every((c) => typeof c === "string")) {
          dir.files.set(name, chunks.join(""));
          return;
        }
        // Contenu binaire (ArrayBuffer/TypedArray) : concatène en un seul buffer.
        const parts = chunks.map((c) => (isArrayBufferLike(c) ? new Uint8Array(c) : ArrayBuffer.isView(c) ? c : new Uint8Array()));
        const total = parts.reduce((n, p) => n + p.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const p of parts) {
          merged.set(p, offset);
          offset += p.length;
        }
        dir.files.set(name, merged.buffer);
      },
    };
  }
}

export class MemoryDirectoryHandle {
  constructor(name = "") {
    this.name = name;
    this.kind = "directory";
    this.files = new Map();
    this.dirs = new Map();
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.dirs.has(name)) {
      if (!create) throw new Error("NotFoundError");
      this.dirs.set(name, new MemoryDirectoryHandle(name));
    }
    return this.dirs.get(name);
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) throw new Error("NotFoundError");
      this.files.set(name, "");
    }
    return new MemoryFileHandle(this, name);
  }
  async removeEntry(name) {
    if (!this.files.delete(name)) throw new Error("NotFoundError");
  }
  async *[Symbol.asyncIterator]() {
    for (const name of this.files.keys()) {
      yield [name, new MemoryFileHandle(this, name)];
    }
  }
}
