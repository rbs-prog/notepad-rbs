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

// Uma rodada de sincronização. Faz toda a rede primeiro (downloads e envios) e só então aplica as mudanças
// locais, de uma vez e sem await, recusando as notas que o usuário mexeu no meio do caminho (ficam em `skipped`
// para a próxima rodada). store: index(), get(id), put(id, data), upsertMeta(meta), del(id) (apaga dados e índice),
// tombs(), clearTombs(ids), isDirty(id), firstSync. Devolve { applied: ids mudados localmente, skipped: ids adiados }.
Sync.runSync = async function runSync({ cloud, store }) {
  const remote = await cloud.listNotes();
  const remoteIds = new Set(remote.map(r => r.id));
  const snap = new Map(store.index().map(n => [n.id, n.updated]));
  // nota vazia só entra se já existe na nuvem (esvaziar uma nota sincronizada é uma edição, não um rascunho novo)
  const local = store.index().filter(n => remoteIds.has(n.id) || !Sync.isEmptyNote(store.get(n.id))).map(n => ({ id: n.id, updated: n.updated }));
  const p = Sync.planSync({ local, deleted: store.tombs(), remote });
  const fetched = new Map();
  for (const id of p.pull) { const r = await cloud.getNote(id); if (r && !r.deleted) fetched.set(id, r); }
  for (const id of p.push) {
    const m = store.index().find(n => n.id === id), d = store.get(id);
    if (m && d) await cloud.putNote({ id, title: m.title, custom: m.custom, updated: m.updated, deleted: false, data: d });
  }
  for (const id of p.pushDelete) {
    const t = store.tombs().find(x => x.id === id);
    await cloud.putNote({ id, title: '', custom: false, updated: t ? t.updated : Date.now(), deleted: true, data: {} });
  }
  // --- daqui até o fim não há await: o usuário não consegue digitar no meio ---
  const applied = [], skipped = [];
  const untouched = id => {
    if (store.isDirty(id)) return false;
    const m = store.index().find(n => n.id === id);
    return snap.has(id) ? !!m && m.updated === snap.get(id) : !m;
  };
  for (const [id, r] of fetched) {
    if (!untouched(id)) { skipped.push(id); continue; }
    store.put(id, r.data); store.upsertMeta({ id, title: r.title, custom: r.custom, updated: r.updated });
    applied.push(id);
  }
  for (const id of p.dropLocal) {
    if (!untouched(id)) { skipped.push(id); continue; }
    store.del(id); applied.push(id);
  }
  store.clearTombs(p.clearDeleted);
  // primeira sincronização num aparelho que recebeu notas: tira a nota vazia que o app cria sozinho
  if (store.firstSync && remote.some(r => !r.deleted)) {
    for (const n of store.index()) {
      if (!n.custom && Sync.isEmptyNote(store.get(n.id)) && !store.isDirty(n.id)) { store.del(n.id); applied.push(n.id); }
    }
  }
  return { applied, skipped };
};

// Cliente Supabase (Auth + PostgREST) sem supabase-js. fetch, storage e now são injetáveis para teste.
Sync.createClient = function createClient({ url, key, fetch: f, storage, now }) {
  const doFetch = f || ((...a) => fetch(...a));
  const clock = now || (() => Date.now());
  const SKEY = 'bn-sync';
  const nowS = () => Math.floor(clock() / 1000);
  const hdr = extra => ({ apikey: key, 'Content-Type': 'application/json', ...extra });
  const read = () => { try { return JSON.parse(storage.getItem(SKEY) || 'null'); } catch (e) { return null; } };
  const write = s => { try { storage.setItem(SKEY, JSON.stringify(s)); } catch (e) {} };
  const clear = () => { try { storage.removeItem(SKEY); } catch (e) {} };
  const errMsg = async r => {
    try { const j = await r.json(); return j.msg || j.error_description || j.message || j.error || ('Erro ' + r.status); }
    catch (e) { return 'Erro ' + r.status; }
  };
  const jwtUser = token => {
    try {
      const p = JSON.parse(b64urlDecode(token.split('.')[1]));
      return { id: p.sub, email: p.email };
    } catch (e) { return { id: '', email: '' }; }
  };
  const b64urlDecode = b => {
    b = b.replace(/-/g, '+').replace(/_/g, '/');
    const bin = typeof atob === 'function' ? atob(b + '==='.slice((b.length + 3) % 4)) : Buffer.from(b, 'base64').toString('binary');
    return decodeURIComponent(Array.from(bin, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  };
  async function refresh(s) {
    const r = await doFetch(url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: hdr(), body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    if (r.status >= 400 && r.status < 500) { clear(); return null; }
    if (!r.ok) throw new Error(await errMsg(r));
    const j = await r.json();
    const ns = { access_token: j.access_token, refresh_token: j.refresh_token || s.refresh_token, expires_at: nowS() + (Number(j.expires_in) || 3600), user: s.user };
    write(ns);
    return ns;
  }
  const client = {
    async sendMagicLink(email, redirectTo) {
      const r = await doFetch(url + '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirectTo), {
        method: 'POST', headers: hdr(), body: JSON.stringify({ email, create_user: true })
      });
      if (!r.ok) throw new Error(await errMsg(r));
    },
    consumeRedirect(hash) {
      const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
      const at = p.get('access_token'), rt = p.get('refresh_token');
      if (!at || !rt) return null;
      const session = { access_token: at, refresh_token: rt, expires_at: nowS() + (Number(p.get('expires_in')) || 3600), user: jwtUser(at) };
      write(session);
      return { session, cleanHash: '' };
    },
    session() { return read(); },
    async ensureFresh() {
      const s = read();
      if (!s) return null;
      if (s.expires_at - nowS() > 60) return s;
      return refresh(s);
    },
    // Chamada autenticada ao PostgREST; em 401 renova a sessão e tenta mais uma vez.
    async rest(path, opts = {}) {
      let s = await client.ensureFresh();
      if (!s) throw new Error('sem sessão');
      const go = () => doFetch(url + '/rest/v1/' + path, { ...opts, headers: hdr({ Authorization: 'Bearer ' + s.access_token, ...opts.headers }) });
      let r = await go();
      if (r.status === 401) {
        s = await refresh(s);
        if (!s) throw new Error('sem sessão');
        r = await go();
      }
      if (!r.ok) throw new Error(await errMsg(r));
      return r;
    },
    async listNotes() {
      return (await client.rest('notes?select=id,updated,deleted')).json();
    },
    async getNote(id) {
      const rows = await (await client.rest('notes?id=eq.' + encodeURIComponent(id) + '&select=*')).json();
      return rows[0] || null;
    },
    async putNote({ id, title, custom, updated, deleted, data }) {
      await client.rest('notes?on_conflict=user_id,id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ id, title, custom, updated, deleted, data })
      });
    },
    signOut() {
      const s = read();
      clear();
      if (!s) return;
      try {
        Promise.resolve(doFetch(url + '/auth/v1/logout', { method: 'POST', headers: hdr({ Authorization: 'Bearer ' + s.access_token }) })).catch(() => {});
      } catch (e) {}
    }
  };
  return client;
};

if (typeof module !== 'undefined') module.exports = Sync; else window.Sync = Sync;
