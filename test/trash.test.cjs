'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../model.cjs');

// A two-folder tree in workspace w with one session filed in the nested folder.
function tree() {
  let state = model.initialState();
  state = model.createFolder(state, { id: 'a', workspaceId: 'w', name: 'Alpha' });
  state = model.createFolder(state, { id: 'b', workspaceId: 'w', parentId: 'a', name: 'Beta' });
  return model.moveItems(state, [{ kind: 'session', id: 's1', workspaceId: 'w' }], { workspaceId: 'w', folderId: 'b' });
}

test('trash entries are newest first, unique by session and validated before they are written', () => {
  let trash = model.initialTrash();
  assert.deepEqual(trash, { version: 1, entries: [] });
  trash = model.addTrash(trash, { sessionId: 's1', workspaceId: 'w', folderId: 'b', at: 10 });
  trash = model.addTrash(trash, { sessionId: 's2', workspaceId: '', folderId: null, at: 20 });
  assert.deepEqual(trash.entries.map(entry => entry.sessionId), ['s2', 's1']);
  // Re-trashing the same session replaces its record instead of duplicating it.
  trash = model.addTrash(trash, { sessionId: 's1', workspaceId: 'w', folderId: null, at: 30 });
  assert.deepEqual(trash.entries.map(entry => [entry.sessionId, entry.folderId, entry.at]), [['s1', null, 30], ['s2', null, 20]]);
  assert.equal(model.validateTrash(trash), trash);
  assert.throws(() => model.addTrash(trash, { sessionId: '', workspaceId: 'w' }), /Invalid or duplicate trash entry/);
  assert.throws(() => model.validateTrash({ version: 2, entries: [] }), /Invalid trash state/);
  assert.throws(() => model.validateTrash({ version: 1, entries: [{ sessionId: 's', workspaceId: 'w', folderId: 3, at: 1 }] }),
    /Invalid or duplicate trash entry/);
  assert.throws(() => model.validateTrash({ version: 1, entries: [{ sessionId: 's', workspaceId: 'w', folderId: null, at: 'x' }] }),
    /Invalid or duplicate trash entry/);
  const duplicated = { version: 1, entries: [{ sessionId: 's', workspaceId: 'w', folderId: null, at: 1 },
    { sessionId: 's', workspaceId: 'w', folderId: null, at: 2 }] };
  assert.throws(() => model.validateTrash(duplicated), /Invalid or duplicate trash entry/);
});

test('trash is bounded so a long-running profile cannot grow the record list without limit', () => {
  let trash = model.initialTrash();
  for (let index = 0; index < 520; index++) trash = model.addTrash(trash, { sessionId: 's' + index, workspaceId: 'w', at: index });
  assert.equal(trash.entries.length, 500);
  assert.equal(trash.entries[0].sessionId, 's519');
});

test('removing and clearing only touch records, never the session list', () => {
  let trash = model.addTrash(model.initialTrash(), { sessionId: 's1', workspaceId: 'w', folderId: 'b', at: 1 });
  trash = model.addTrash(trash, { sessionId: 's2', workspaceId: 'w', at: 2 });
  const removed = model.removeTrash(trash, 's1');
  assert.deepEqual(removed.entries.map(entry => entry.sessionId), ['s2']);
  assert.equal(model.findTrash(removed, 's1'), null);
  // Removing an unknown session is a no-op rather than an error: the UI can double-click safely.
  assert.equal(model.removeTrash(removed, 'missing'), removed);
  assert.deepEqual(model.clearTrash(), { version: 1, entries: [] });
});

test('restore drops the record and points the session back at its original folder', () => {
  const state = tree();
  let trash = model.addTrash(model.initialTrash(), { sessionId: 's1', workspaceId: 'w', folderId: 'b', at: 1 });
  const moved = { ...state, sessionFolders: {} }; // archived sessions keep their mapping; a stale one is tolerated either way.
  const restored = model.restoreTrash(moved, trash, 's1');
  assert.equal(restored.folderId, 'b');
  assert.equal(restored.state.sessionFolders.s1, 'b');
  assert.deepEqual(restored.trash.entries, []);
  // The original tree is untouched: restore is a pure pair of updates.
  assert.deepEqual(trash.entries.length, 1);
  assert.deepEqual(moved.sessionFolders, {});
});

test('restoring a session whose folder was deleted falls back to the workspace root', () => {
  const state = model.deleteFolder(tree(), 'b');
  const trash = model.addTrash(model.initialTrash(), { sessionId: 's1', workspaceId: 'w', folderId: 'b', at: 1 });
  const restored = model.restoreTrash({ ...state, sessionFolders: {} }, trash, 's1');
  assert.equal(restored.folderId, null);
  assert.equal(Object.prototype.hasOwnProperty.call(restored.state.sessionFolders, 's1'), false);
  assert.deepEqual(restored.trash.entries, []);
});

test('restoring an unknown record throws instead of silently clearing the trash', () => {
  const trash = model.initialTrash();
  assert.throws(() => model.restoreTrash(tree(), trash, 'missing'), /Unknown trash entry/);
});

test('the trash block collapse state is a legal expansion entry, other keys stay rejected', () => {
  let state = model.setExpanded(model.initialState(), model.EXPANDED_TRASH, false);
  assert.equal(state.expanded.trash, false);
  assert.equal(model.validateState(state), state);
  assert.throws(() => model.setExpanded(state, 'trashy', true), /Invalid expansion entry/);
  assert.throws(() => model.validateState({ ...state, expanded: { trashy: true } }), /Invalid expansion entry/);
  // A folder delete keeps the trash entry; only folder keys are pruned.
  const created = model.createFolder(state, { id: 'a', workspaceId: 'w', name: 'Alpha' });
  assert.equal(model.deleteFolder(created, 'a').expanded.trash, false);
});
