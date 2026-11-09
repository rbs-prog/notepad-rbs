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
