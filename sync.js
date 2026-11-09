// Sincronização de notas entre aparelhos (Supabase). Sem dependências.
// No navegador expõe window.Sync; no node (testes) faz module.exports.
const Sync = {};

// Decide o que subir e o que baixar. Vale a edição mais recente (updated maior).
// local: [{id, updated}] (só notas não vazias), deleted: lápides [{id, updated}], remote: [{id, updated, deleted}]
Sync.planSync = function planSync({ local, deleted, remote }) {
  const L = new Map(local.map(n => [n.id, n]));
  const T = new Map(deleted.map(n => [n.id, n]));
  const R = new Map(remote.map(n => [n.id, n]));
  const out = { pull: [], push: [], pushDelete: [], dropLocal: [], clearDeleted: [] };
  for (const id of new Set([...L.keys(), ...T.keys(), ...R.keys()])) {
    const l = L.get(id), t = T.get(id), r = R.get(id);
    if (!r) {
      if (l) out.push.push(id);
      else if (t) out.clearDeleted.push(id);
    } else if (!r.deleted) {
      if (l) {
        if (r.updated > l.updated) out.pull.push(id);
        else if (l.updated > r.updated) out.push.push(id);
      } else if (t) {
        if (t.updated >= r.updated) out.pushDelete.push(id);
        else out.pull.push(id);
        out.clearDeleted.push(id);
      } else out.pull.push(id);
    } else if (l) {
      if (l.updated > r.updated) out.push.push(id);
      else out.dropLocal.push(id);
    } else if (t) out.clearDeleted.push(id);
  }
  for (const k in out) out[k].sort();
  return out;
};

// Nota sem texto, sem traço e sem conteúdo no bloco notepad.
Sync.isEmptyNote = function isEmptyNote(data) {
  if (!data) return true;
  if ((data.strokes || []).length) return false;
  if ((data.boxes || []).some(b => String(b.text || '').trim())) return false;
  const pad = String(data.pad || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return !pad;
};

if (typeof module !== 'undefined') module.exports = Sync; else window.Sync = Sync;
