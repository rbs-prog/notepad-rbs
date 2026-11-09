const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../sync.js');

const none = { pull: [], push: [], pushDelete: [], dropLocal: [], clearDeleted: [] };
const plan = (local, deleted, remote) => Sync.planSync({ local, deleted, remote });
const expectPlan = (got, extra) => assert.deepEqual(got, { ...none, ...extra });

// ---------- planSync ----------
test('planSync: remoto ausente + nota local => push', () => {
  expectPlan(plan([{ id: 'a', updated: 5 }], [], []), { push: ['a'] });
});
test('planSync: remoto ausente + lápide => clearDeleted', () => {
  expectPlan(plan([], [{ id: 'a', updated: 5 }], []), { clearDeleted: ['a'] });
});
test('planSync: remoto vivo mais novo que a nota local => pull', () => {
  expectPlan(plan([{ id: 'a', updated: 5 }], [], [{ id: 'a', updated: 9, deleted: false }]), { pull: ['a'] });
});
test('planSync: nota local mais nova que o remoto vivo => push', () => {
  expectPlan(plan([{ id: 'a', updated: 9 }], [], [{ id: 'a', updated: 5, deleted: false }]), { push: ['a'] });
});
test('planSync: updated igual não gera ação', () => {
  expectPlan(plan([{ id: 'a', updated: 5 }], [], [{ id: 'a', updated: 5, deleted: false }]), {});
});
test('planSync: remoto vivo + lápide mais nova ou igual => pushDelete e clearDeleted', () => {
  expectPlan(plan([], [{ id: 'a', updated: 9 }], [{ id: 'a', updated: 5, deleted: false }]), { pushDelete: ['a'], clearDeleted: ['a'] });
  expectPlan(plan([], [{ id: 'a', updated: 5 }], [{ id: 'a', updated: 5, deleted: false }]), { pushDelete: ['a'], clearDeleted: ['a'] });
});
test('planSync: lápide mais antiga que a edição remota traz a nota de volta', () => {
  expectPlan(plan([], [{ id: 'a', updated: 5 }], [{ id: 'a', updated: 9, deleted: false }]), { pull: ['a'], clearDeleted: ['a'] });
});
test('planSync: remoto vivo sem nota local nem lápide => pull', () => {
  expectPlan(plan([], [], [{ id: 'a', updated: 5, deleted: false }]), { pull: ['a'] });
});
test('planSync: remoto apagado + nota local mais nova => push (a nota volta)', () => {
  expectPlan(plan([{ id: 'a', updated: 9 }], [], [{ id: 'a', updated: 5, deleted: true }]), { push: ['a'] });
});
test('planSync: remoto apagado + nota local não mais nova => dropLocal', () => {
  expectPlan(plan([{ id: 'a', updated: 5 }], [], [{ id: 'a', updated: 5, deleted: true }]), { dropLocal: ['a'] });
  expectPlan(plan([{ id: 'a', updated: 3 }], [], [{ id: 'a', updated: 5, deleted: true }]), { dropLocal: ['a'] });
});
test('planSync: remoto apagado + lápide => clearDeleted', () => {
  expectPlan(plan([], [{ id: 'a', updated: 9 }], [{ id: 'a', updated: 5, deleted: true }]), { clearDeleted: ['a'] });
});
test('planSync: remoto apagado sem nota nem lápide => nada', () => {
  expectPlan(plan([], [], [{ id: 'a', updated: 5, deleted: true }]), {});
});
test('planSync: primeira entrada com remoto vazio sobe todas as notas locais', () => {
  const local = [{ id: 'c', updated: 1 }, { id: 'a', updated: 2 }, { id: 'b', updated: 3 }];
  expectPlan(plan(local, [], []), { push: ['a', 'b', 'c'] });
});

// ---------- isEmptyNote ----------
test('isEmptyNote: null, {} e nota sem conteúdo são vazias', () => {
  assert.equal(Sync.isEmptyNote(null), true);
  assert.equal(Sync.isEmptyNote({}), true);
  assert.equal(Sync.isEmptyNote({ boxes: [], strokes: [], pad: '' }), true);
});
test('isEmptyNote: caixas só com espaços e pad "<br>" são vazias', () => {
  assert.equal(Sync.isEmptyNote({ boxes: [{ text: '  \n ' }], strokes: [], pad: '<br>' }), true);
  assert.equal(Sync.isEmptyNote({ boxes: [], strokes: [], pad: '<div><br></div>&nbsp;' }), true);
});
test('isEmptyNote: traço, texto em caixa ou texto no pad tornam a nota não vazia', () => {
  assert.equal(Sync.isEmptyNote({ boxes: [], strokes: [{ id: 's' }], pad: '' }), false);
  assert.equal(Sync.isEmptyNote({ boxes: [{ text: 'oi' }], strokes: [], pad: '' }), false);
  assert.equal(Sync.isEmptyNote({ boxes: [], strokes: [], pad: '<div>texto</div>' }), false);
});

// ---------- cliente: autenticação ----------
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload = { sub: 'u1', email: 'eu@teste.com' }) => 'h.' + b64(payload) + '.s';
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
function setup(handler, now = 1000000) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : undefined });
    return handler(url, opts, calls.length);
  };
  const mem = {};
  const storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const client = Sync.createClient({ url: 'https://x.supabase.co', key: 'ANON', fetch, storage, now: () => now * 1000 });
  return { client, calls, mem, storage };
}
const seed = (storage, s) => storage.setItem('bn-sync', JSON.stringify(s));
const sess = (exp, extra = {}) => ({ access_token: 'AT', refresh_token: 'RT', expires_at: exp, user: { id: 'u1', email: 'eu@teste.com' }, ...extra });

test('sendMagicLink: envia e-mail e redirect_to para /auth/v1/otp', async () => {
  const { client, calls } = setup(() => resp(200, {}));
  await client.sendMagicLink('eu@teste.com', 'https://rbs-prog.github.io/notepad-rbs/');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /^https:\/\/x\.supabase\.co\/auth\/v1\/otp\?redirect_to=/);
  assert.ok(calls[0].url.includes(encodeURIComponent('https://rbs-prog.github.io/notepad-rbs/')));
  assert.equal(calls[0].body.email, 'eu@teste.com');
  assert.equal(calls[0].body.create_user, true);
  assert.equal(calls[0].headers.apikey, 'ANON');
});
test('sendMagicLink: erro do servidor vira Error com a mensagem recebida', async () => {
  const { client } = setup(() => resp(429, { msg: 'email rate limit exceeded' }));
  await assert.rejects(() => client.sendMagicLink('a@b.c', 'https://x/'), { message: 'email rate limit exceeded' });
});
test('consumeRedirect: hash com token grava a sessão e devolve cleanHash vazio', () => {
  const { client, storage } = setup(() => assert.fail('sem rede'), 1000000);
  const r = client.consumeRedirect('#access_token=' + jwt() + '&refresh_token=RT&expires_in=3600&token_type=bearer');
  assert.equal(r.cleanHash, '');
  assert.equal(r.session.refresh_token, 'RT');
  assert.equal(r.session.expires_at, 1000000 + 3600);
  assert.deepEqual(r.session.user, { id: 'u1', email: 'eu@teste.com' });
  assert.deepEqual(JSON.parse(storage.getItem('bn-sync')), r.session);
  assert.deepEqual(client.session(), r.session);
});
test('consumeRedirect: hash sem token devolve null e não grava nada', () => {
  const { client, mem } = setup(() => assert.fail('sem rede'));
  assert.equal(client.consumeRedirect(''), null);
  assert.equal(client.consumeRedirect('#foo=bar'), null);
  assert.equal(client.session(), null);
  assert.equal('bn-sync' in mem, false);
});
test('ensureFresh: sessão válida não chama a rede', async () => {
  const { client, calls, storage } = setup(() => assert.fail('sem rede'), 1000);
  seed(storage, sess(1000 + 600));
  const s = await client.ensureFresh();
  assert.equal(s.access_token, 'AT');
  assert.equal(calls.length, 0);
});
test('ensureFresh: sessão perto de vencer renova e grava a nova', async () => {
  const { client, calls, storage } = setup(() => resp(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }), 1000);
  seed(storage, sess(1000 + 30));
  const s = await client.ensureFresh();
  assert.match(calls[0].url, /\/auth\/v1\/token\?grant_type=refresh_token$/);
  assert.deepEqual(calls[0].body, { refresh_token: 'RT' });
  assert.equal(s.access_token, 'AT2');
  assert.equal(s.expires_at, 1000 + 3600);
  assert.deepEqual(s.user, { id: 'u1', email: 'eu@teste.com' });
  assert.equal(JSON.parse(storage.getItem('bn-sync')).refresh_token, 'RT2');
});
test('ensureFresh: refresh recusado (400) apaga a sessão e devolve null', async () => {
  const { client, storage } = setup(() => resp(400, { error: 'invalid_grant' }), 1000);
  seed(storage, sess(1000 + 10));
  assert.equal(await client.ensureFresh(), null);
  assert.equal(storage.getItem('bn-sync'), null);
});
test('ensureFresh: falha de rede mantém a sessão e lança', async () => {
  const { client, storage } = setup(() => { throw new TypeError('Failed to fetch'); }, 1000);
  const s = sess(1000 + 10); seed(storage, s);
  await assert.rejects(() => client.ensureFresh(), { message: 'Failed to fetch' });
  assert.deepEqual(JSON.parse(storage.getItem('bn-sync')), s);
});
test('ensureFresh: sem sessão devolve null sem rede', async () => {
  const { client, calls } = setup(() => assert.fail('sem rede'));
  assert.equal(await client.ensureFresh(), null);
  assert.equal(calls.length, 0);
});
test('signOut: apaga a sessão mesmo se o logout remoto falhar', async () => {
  const { client, storage } = setup(() => { throw new TypeError('offline'); }, 1000);
  seed(storage, sess(5000));
  client.signOut();
  assert.equal(client.session(), null);
  assert.equal(storage.getItem('bn-sync'), null);
  await new Promise(r => setTimeout(r, 0)); // a falha remota não pode estourar como rejeição não tratada
});

// ---------- cliente: notas na nuvem ----------
const NOW = 1000;
const withSession = handler => { const t = setup(handler, NOW); seed(t.storage, sess(NOW + 3600)); return t; };

test('listNotes: pede só id, updated e deleted, com a sessão do usuário', async () => {
  const rows = [{ id: 'a', updated: 1, deleted: false }];
  const { client, calls } = withSession(() => resp(200, rows));
  assert.deepEqual(await client.listNotes(), rows);
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/notes?select=id,updated,deleted');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.Authorization, 'Bearer AT');
  assert.equal(calls[0].headers.apikey, 'ANON');
});
test('listNotes: sem sessão lança "sem sessão" e não chama a rede', async () => {
  const { client, calls } = setup(() => assert.fail('sem rede'));
  await assert.rejects(() => client.listNotes(), { message: 'sem sessão' });
  assert.equal(calls.length, 0);
});
test('getNote: devolve a linha pedida por id', async () => {
  const row = { id: 'a b', title: 't', custom: false, updated: 2, deleted: false, data: { boxes: [] } };
  const { client, calls } = withSession(() => resp(200, [row]));
  assert.deepEqual(await client.getNote('a b'), row);
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/notes?id=eq.' + encodeURIComponent('a b') + '&select=*');
});
test('getNote: devolve null quando não há linha', async () => {
  const { client } = withSession(() => resp(200, []));
  assert.equal(await client.getNote('zzz'), null);
});
test('putNote: usa upsert por user_id,id e não envia user_id', async () => {
  const { client, calls } = withSession(() => resp(201, {}));
  const n = { id: 'a', title: 'Oi', custom: true, updated: 7, deleted: false, data: { boxes: [], strokes: [], pad: '' } };
  await client.putNote({ ...n, user_id: 'intruso' });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/notes?on_conflict=user_id,id');
  assert.equal(calls[0].headers.Prefer, 'resolution=merge-duplicates');
  assert.deepEqual(calls[0].body, n);
});
test('putNote: resposta 401 renova uma vez e tenta de novo', async () => {
  let rest = 0;
  const { client, calls } = withSession(url => {
    if (url.includes('/auth/v1/token')) return resp(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 });
    return ++rest === 1 ? resp(401, { message: 'JWT expired' }) : resp(201, {});
  });
  await client.putNote({ id: 'a', title: 't', custom: false, updated: 1, deleted: false, data: {} });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].headers.Authorization, 'Bearer AT2');
});
test('putNote: segundo 401 lança', async () => {
  const { client, calls } = withSession(url => url.includes('/auth/v1/token')
    ? resp(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 })
    : resp(401, { message: 'JWT expired' }));
  await assert.rejects(() => client.putNote({ id: 'a', title: 't', custom: false, updated: 1, deleted: false, data: {} }), { message: 'JWT expired' });
  assert.equal(calls.length, 3);
});
test('listNotes: erro de rede lança e não altera a sessão guardada', async () => {
  const { client, storage } = withSession(() => { throw new TypeError('Failed to fetch'); });
  const before = storage.getItem('bn-sync');
  await assert.rejects(() => client.listNotes(), { message: 'Failed to fetch' });
  assert.equal(storage.getItem('bn-sync'), before);
});
test('listNotes: erro 500 lança com a mensagem do servidor', async () => {
  const { client } = withSession(() => resp(500, { message: 'boom' }));
  await assert.rejects(() => client.listNotes(), { message: 'boom' });
});
test('putNote: nota grande (5 mil traços) vai inteira no corpo', async () => {
  const strokes = Array.from({ length: 5000 }, (_, i) => ({ id: 's' + i, pts: [[i, i], [i + 1, i + 1]] }));
  const { client, calls } = withSession(() => resp(201, {}));
  await client.putNote({ id: 'g', title: 'g', custom: false, updated: 1, deleted: false, data: { boxes: [], strokes, pad: '' } });
  assert.equal(calls[0].body.data.strokes.length, 5000);
});

// ---------- runSync: aplica o plano sem pisar no que o usuário digita ----------
const snapshot = o => JSON.parse(JSON.stringify(o));
function mkStore({ notes = {}, tombs = [], dirty = [], firstSync = false } = {}) {
  const s = { notes: snapshot(notes), tombsList: snapshot(tombs), dirty: new Set(dirty), firstSync };
  s.index = () => Object.entries(s.notes).map(([id, n]) => ({ id, ...n.meta }));
  s.get = id => (s.notes[id] ? s.notes[id].data : null);
  s.put = (id, data) => { (s.notes[id] = s.notes[id] || { meta: {} }).data = data; };
  s.upsertMeta = m => { const { id, ...meta } = m; (s.notes[id] = s.notes[id] || { data: null }).meta = meta; };
  s.del = id => { delete s.notes[id]; };
  s.tombs = () => s.tombsList;
  s.clearTombs = ids => { s.tombsList = s.tombsList.filter(t => !ids.includes(t.id)); };
  s.isDirty = id => s.dirty.has(id);
  return s;
}
function mkCloud(remoteRows = [], onGet) {
  const remote = new Map(remoteRows.map(r => [r.id, r]));
  const puts = [];
  return {
    remote, puts,
    listNotes: async () => [...remote.values()].map(({ id, updated, deleted }) => ({ id, updated, deleted })),
    getNote: async id => { if (onGet) onGet(id); return remote.get(id) || null; },
    putNote: async n => { puts.push(snapshot(n)); remote.set(n.id, snapshot(n)); }
  };
}
const note = (updated, text, extra = {}) => ({ meta: { title: text || 't', custom: false, updated, ...extra }, data: { boxes: text ? [{ id: 'b', text }] : [], strokes: [], pad: '' } });
const rrow = (id, updated, text, deleted = false) => ({ id, title: text || 't', custom: false, updated, deleted, data: { boxes: text ? [{ id: 'b', text }] : [], strokes: [], pad: '' } });

test('runSync: aparelho novo baixa a nota, não sobe a vazia e remove a vazia na primeira sincronização', async () => {
  const store = mkStore({ notes: { ph: note(10, '') }, firstSync: true });
  const cloud = mkCloud([rrow('rb', 50, 'remota')]);
  const r = await Sync.runSync({ cloud, store });
  assert.deepEqual(store.index().map(n => n.id), ['rb']);
  assert.equal(store.get('rb').boxes[0].text, 'remota');
  assert.equal(cloud.puts.length, 0);
  assert.deepEqual(r.applied.sort(), ['ph', 'rb']);
});
test('runSync: sobe nota local nova e propaga a exclusão com o momento da lápide', async () => {
  const store = mkStore({ notes: { n1: note(20, 'nova') }, tombs: [{ id: 'old', updated: 33 }] });
  const cloud = mkCloud([rrow('old', 5, 'velha')]);
  await Sync.runSync({ cloud, store });
  const byId = Object.fromEntries(cloud.puts.map(p => [p.id, p]));
  assert.equal(byId.n1.deleted, false);
  assert.equal(byId.n1.updated, 20);
  assert.equal(byId.old.deleted, true);
  assert.equal(byId.old.updated, 33);
  assert.deepEqual(store.tombsList, []);
});
test('runSync: edição feita durante o download não é sobrescrita pelo pull', async () => {
  const store = mkStore({ notes: { x: note(10, 'antigo') } });
  const cloud = mkCloud([rrow('x', 50, 'do outro aparelho')], id => { // o usuário digita enquanto getNote espera a rede
    store.put(id, { boxes: [{ id: 'b', text: 'digitei agora' }], strokes: [], pad: '' });
    store.upsertMeta({ id, title: 't', custom: false, updated: 60 });
  });
  const r = await Sync.runSync({ cloud, store });
  assert.equal(store.get('x').boxes[0].text, 'digitei agora');
  assert.deepEqual(r.skipped, ['x']);
  assert.deepEqual(r.applied, []);
});
test('runSync: nota com texto pendente de gravação (isDirty) não é sobrescrita pelo pull', async () => {
  const store = mkStore({ notes: { x: note(10, 'antigo') }, dirty: ['x'] });
  const cloud = mkCloud([rrow('x', 50, 'remoto')]);
  const r = await Sync.runSync({ cloud, store });
  assert.equal(store.get('x').boxes[0].text, 'antigo');
  assert.deepEqual(r.skipped, ['x']);
});
test('runSync: dropLocal também respeita edição em andamento', async () => {
  const store = mkStore({ notes: { x: note(10, 'antigo') }, dirty: ['x'] });
  const cloud = mkCloud([rrow('x', 50, '', true)]);
  const r = await Sync.runSync({ cloud, store });
  assert.ok(store.get('x'));
  assert.deepEqual(r.skipped, ['x']);
});
test('runSync: nota esvaziada que já existe na nuvem sobe vazia em vez de ser rebaixada', async () => {
  const store = mkStore({ notes: { x: note(90, '') } });
  const cloud = mkCloud([rrow('x', 50, 'texto antigo')]);
  const r = await Sync.runSync({ cloud, store });
  assert.equal(store.get('x').boxes.length, 0);
  assert.equal(cloud.puts.length, 1);
  assert.equal(cloud.puts[0].id, 'x');
  assert.deepEqual(r.applied, []);
});
test('runSync: nota vazia que nunca foi para a nuvem não sobe', async () => {
  const store = mkStore({ notes: { ph: note(10, '') }, firstSync: false });
  const cloud = mkCloud([]);
  await Sync.runSync({ cloud, store });
  assert.equal(cloud.puts.length, 0);
  assert.ok(store.get('ph'));
});
