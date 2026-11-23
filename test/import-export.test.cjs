'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../model.cjs');

const tags = () => ({ version: 1, tags: [{ id: 'todo', name: 'TODO', color: '#6366f1', once: false }], sessions: {} });

function tree() {
  let state = model.initialState();
  state = model.createFolder(state, { id: 'a', workspaceId: 'w', name: 'Alpha' });
  state = model.createFolder(state, { id: 'b', workspaceId: 'w', parentId: 'a', name: 'Beta' });
  return model.moveItems(state, [{ kind: 'session', id: 's1', workspaceId: 'w' }], { workspaceId: 'w', folderId: 'b' });
}

const exported = () => model.exportData({
  tree: tree(),
  tags: { ...tags(), sessions: { s1: ['todo'] } },
  trash: model.addTrash(model.initialTrash(), { sessionId: 's9', workspaceId: 'w', folderId: 'b', at: 7 }),
  colors: ['#8b5cf6', null, '#123456'],
}, { exportedAt: 1234 });

// Deterministic ids so the merge result is readable in assertions.
const ids = () => { let n = 0; return prefix => prefix + '-new' + (++n); };

test('export carries the documented envelope and nothing else', () => {
  const payload = exported();
  assert.deepEqual(Object.keys(payload), ['schema', 'exportedAt', 'folders', 'tags', 'trash', 'colors']);
  assert.equal(payload.schema, model.EXPORT_SCHEMA);
  assert.equal(payload.exportedAt, 1234);
  assert.deepEqual(payload.folders.folders.map(folder => [folder.id, folder.parentId]), [['a', null], ['b', 'a']]);
  assert.deepEqual(payload.folders.sessionFolders, { s1: 'b' });
  assert.deepEqual(payload.tags.tags.map(tag => [tag.id, tag.once]), [['todo', false]]);
  assert.deepEqual(payload.tags.sessions, { s1: ['todo'] });
  assert.deepEqual(payload.trash.entries.map(entry => entry.sessionId), ['s9']);
  assert.deepEqual(payload.colors, ['#8b5cf6', null, '#123456']);
  // The payload survives a JSON round trip unchanged, which is what the textarea does.
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
  // Invalid local data is refused rather than exported as a broken file.
  assert.throws(() => model.exportData({ tree: { version: 2 }, tags: tags(), trash: model.initialTrash(), colors: [] }), /Invalid or unsupported/);
});

test('import into an empty profile restores folders, mappings, tags, trash and colors', () => {
  const result = model.importData({ tree: model.initialState(), tags: { version: 1, tags: [], sessions: {} },
    trash: model.initialTrash(), colors: [null, null, null] }, JSON.parse(JSON.stringify(exported())), { makeId: ids() });
  assert.deepEqual(result.summary, { folders: 2, tags: 1, sessions: 1, trash: 1, skipped: 0 });
  assert.deepEqual(result.tree.folders.map(folder => [folder.id, folder.parentId]), [['a', null], ['b', 'a']]);
  assert.deepEqual(result.tree.sessionFolders, { s1: 'b' });
  assert.deepEqual(result.tags.tags.map(tag => tag.name), ['TODO']);
  assert.deepEqual(result.tags.sessions, { s1: [result.tags.tags[0].id] });
  assert.deepEqual(result.trash.entries.map(entry => entry.sessionId), ['s9']);
  assert.deepEqual(result.colors, ['#8b5cf6', null, '#123456']);
  assert.deepEqual(model.validateState(result.tree).folders.length, 2);
  assert.equal(model.validateTags(result.tags), result.tags);
  assert.equal(model.validateTrash(result.trash), result.trash);
});

test('import is idempotent: re-importing the same file adds nothing and reports what it skipped', () => {
  const first = model.importData({ tree: model.initialState(), tags: { version: 1, tags: [], sessions: {} },
    trash: model.initialTrash(), colors: [null, null, null] }, JSON.parse(JSON.stringify(exported())), { makeId: ids() });
  const again = model.importData(first, JSON.parse(JSON.stringify(exported())), { makeId: ids() });
  // Two folders, one session mapping, one tag and one trash record were all already present.
  assert.deepEqual(again.summary, { folders: 0, tags: 0, sessions: 0, trash: 0, skipped: 5 });
  assert.deepEqual(again.tree.folders.map(folder => folder.id), first.tree.folders.map(folder => folder.id));
  assert.deepEqual(again.tags.tags.map(tag => tag.id), first.tags.tags.map(tag => tag.id));
  assert.equal(again.trash.entries.length, 1);
});

test('an id collision with different content gets a fresh id and remaps child folders and sessions', () => {
  let local = model.initialState();
  local = model.createFolder(local, { id: 'a', workspaceId: 'w', name: 'Local Alpha' });
  const result = model.importData({ tree: local, tags: { version: 1, tags: [], sessions: {} },
    trash: model.initialTrash(), colors: [] }, JSON.parse(JSON.stringify(exported())), { makeId: ids() });
  assert.deepEqual(result.summary, { folders: 2, tags: 1, sessions: 1, trash: 1, skipped: 0 });
  // Only the id that actually collides is regenerated; the child keeps its free id but follows the new parent.
  assert.deepEqual(result.tree.folders.map(folder => [folder.id, folder.parentId, folder.name]), [
    ['a', null, 'Local Alpha'], ['folder-new1', null, 'Alpha'], ['b', 'folder-new1', 'Beta'],
  ]);
  // The session follows the remapped folder, not the local folder that happens to share the remote id.
  assert.equal(result.tree.sessionFolders.s1, 'b');
  // A coarser tag name collision keeps the local tag and points assignments at it.
  const tagged = model.importData({ tree: local, tags: { ...tags(), sessions: {} }, trash: model.initialTrash(), colors: [] },
    JSON.parse(JSON.stringify(exported())), { makeId: ids() });
  assert.equal(tagged.summary.tags, 0);
  assert.deepEqual(tagged.tags.sessions, { s1: ['todo'] });
});

test('import never overwrites a local session mapping, local trash record or local color', () => {
  let local = model.initialState();
  local = model.createFolder(local, { id: 'a', workspaceId: 'w', name: 'Alpha' });
  local = model.createFolder(local, { id: 'b', workspaceId: 'w', parentId: 'a', name: 'Beta' });
  local = model.createFolder(local, { id: 'mine', workspaceId: 'w', name: 'Mine' });
  local = model.moveItems(local, [{ kind: 'session', id: 's1', workspaceId: 'w' }], { workspaceId: 'w', folderId: 'mine' });
  const result = model.importData({
    tree: local, tags: { ...tags(), sessions: {} },
    trash: model.addTrash(model.initialTrash(), { sessionId: 's9', workspaceId: 'w', folderId: null, at: 1 }),
    colors: [null, '#abcdef', null],
  }, JSON.parse(JSON.stringify(exported())), { makeId: ids() });
  assert.equal(result.tree.sessionFolders.s1, 'mine');
  assert.equal(result.trash.entries.length, 1);
  assert.equal(result.trash.entries[0].at, 1);
  assert.deepEqual(result.colors, ['#8b5cf6', '#abcdef', '#123456']);
  assert.equal(result.summary.sessions, 0);
  assert.equal(result.summary.trash, 0);
});

test('import rejects payloads that are not this schema or carry a broken tree', () => {
  const base = { tree: model.initialState(), tags: { version: 1, tags: [], sessions: {} }, trash: model.initialTrash(), colors: [] };
  assert.throws(() => model.importData(base, null), /Invalid import data/);
  assert.throws(() => model.importData(base, { schema: 'dsh-session-tree', folders: {} }), /Invalid import data/);
  assert.throws(() => model.importData(base, { schema: model.EXPORT_SCHEMA, folders: { folders: [{ id: 'a' }] } }), /Invalid/);
  // A child whose parent never appears cannot be placed; the file is refused instead of half-imported.
  const orphan = { schema: model.EXPORT_SCHEMA, folders: { version: 1, sessionFolders: {}, expanded: {},
    folders: [{ id: 'x', workspaceId: 'w', parentId: 'missing', name: 'X' }] } };
  assert.throws(() => model.importData(base, orphan), /Invalid folder parent/);
  // Folders may appear in any order in the file; children still land under their parent.
  const shuffled = { schema: model.EXPORT_SCHEMA, folders: { version: 1, sessionFolders: {}, expanded: {},
    folders: [{ id: 'b', workspaceId: 'w', parentId: 'a', name: 'Beta' }, { id: 'a', workspaceId: 'w', parentId: null, name: 'Alpha' }] } };
  const ordered = model.importData(base, shuffled, { makeId: ids() });
  assert.deepEqual(ordered.tree.folders.map(folder => [folder.id, folder.parentId]), [['a', null], ['b', 'a']]);
});

test('malformed tags and trash entries are skipped and counted, valid ones still import', () => {
  const payload = {
    schema: model.EXPORT_SCHEMA,
    folders: { version: 1, folders: [], sessionFolders: {}, expanded: {} },
    tags: { version: 1, tags: [{ id: 'ok', name: 'Fine', color: '#22c55e', once: true }, { id: 'bad' }, null], sessions: {} },
    trash: { version: 1, entries: [{ sessionId: 'gone', workspaceId: 'w', folderId: null, at: 3 }, { sessionId: '' }] },
    colors: ['nope', '#ABCDEF', 7],
  };
  const result = model.importData({ tree: model.initialState(), tags: { version: 1, tags: [], sessions: {} },
    trash: model.initialTrash(), colors: [null, null, null] }, payload, { makeId: ids() });
  assert.deepEqual(result.tags.tags.map(tag => [tag.name, tag.once]), [['Fine', true]]);
  assert.deepEqual(result.trash.entries.map(entry => entry.sessionId), ['gone']);
  assert.deepEqual(result.colors, [null, '#abcdef', null]);
  assert.equal(result.summary.tags, 1);
  assert.equal(result.summary.trash, 1);
  assert.equal(result.summary.skipped, 3);
});
