// 极简的「假云数据库」，只实现云函数用到的那几个方法，用来在 node 里测云函数的读写逻辑。
function createMockDb() {
  const colls = {};
  const get = (n) => { if (!colls[n]) colls[n] = new Map(); return colls[n]; };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const applyPatch = (doc, patch) => {
    Object.keys(patch).forEach((k) => {
      const v = patch[k];
      doc[k] = v && v.__set !== undefined ? clone(v.__set) : clone(v);
    });
  };
  const matches = (doc, where) => Object.keys(where).every((k) => doc[k] === where[k]);
  const db = {
    stats: { adds: 0, updates: 0 },
    command: { set: (v) => ({ __set: v }) },
    dump: (n) => Array.from(get(n).values()).map(clone),
    collection(name) {
      const c = get(name);
      return {
        async add({ data }) {
          if (c.has(data._id)) throw new Error('duplicate _id');
          c.set(data._id, clone(data)); db.stats.adds++;
          return { _id: data._id };
        },
        doc(id) {
          return {
            async get() { if (!c.has(id)) throw new Error('document does not exist'); return { data: clone(c.get(id)) }; },
            async update({ data }) { if (!c.has(id)) throw new Error('document does not exist'); applyPatch(c.get(id), data); db.stats.updates++; return { stats: { updated: 1 } }; },
            async set({ data }) { c.set(id, Object.assign({ _id: id }, clone(data))); return {}; },
            async remove() { if (!c.has(id)) throw new Error('document does not exist'); c.delete(id); return {}; },
          };
        },
        where(where) {
          let skip = 0; let limit = 20;
          const q = {
            skip(n) { skip = n; return q; },
            limit(n) { limit = n; return q; },
            async get() { return { data: Array.from(c.values()).filter((d) => matches(d, where)).slice(skip, skip + limit).map(clone) }; },
            async remove() { let n = 0; Array.from(c.entries()).forEach(([k, d]) => { if (matches(d, where)) { c.delete(k); n++; } }); return { stats: { removed: n } }; },
          };
          return q;
        },
      };
    },
  };
  return db;
}
module.exports = { createMockDb };
