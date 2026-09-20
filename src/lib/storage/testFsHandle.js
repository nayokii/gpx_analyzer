/**
 * Faux FileSystemDirectoryHandle en mémoire, implémentant juste assez de
 * l'API réelle (getDirectoryHandle, getFileHandle, removeEntry, itération
 * async) pour tester activityStore.js sans navigateur.
 */
export class MemoryFileHandle {
  constructor(dir, name) {
    this.dir = dir;
    this.name = name;
    this.kind = "file";
  }
  async getFile() {
    const content = this.dir.files.has(this.name) ? this.dir.files.get(this.name) : "";
    return { name: this.name, text: async () => content };
  }
  async createWritable() {
    let buffer = "";
    const dir = this.dir;
    const name = this.name;
    return {
      write: async (chunk) => {
        buffer += chunk;
      },
      close: async () => {
        dir.files.set(name, buffer);
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
