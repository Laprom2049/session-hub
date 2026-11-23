'use strict';

const record = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const text = value => typeof value === 'string' && value.trim().length > 0;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function requireText(value, label) {
  if (!text(value)) throw new Error(`${label} must be a non-empty string`);
}

function requireName(name) {
  requireText(name, 'Folder name');
  if (name.trim().length > 120) throw new Error('Folder name must be at most 120 characters');
}

function initialState() {
  return { version: 1, folders: [], sessionFolders: {}, expanded: {} };
}

// The trash block keeps its collapse state in the same expanded map, so it survives reloads with the tree.
const EXPANDED_TRASH = 'trash';
const isExpansionKey = key => key === EXPANDED_TRASH || /^(folder|workspace):.+$/.test(key);

const ARCHIVE_VIEWS = ['inline', 'section', 'hidden'];
// Anything unreadable falls back to the historical behaviour instead of hiding sessions.
function normalizeArchiveView(value) {
  return ARCHIVE_VIEWS.includes(value) ? value : 'inline';
}

// Persistence boundary: invalid data is an error, never an instruction to reset storage.
function validateState(value) {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'expanded,folders,sessionFolders,version' ||
      value.version !== 1 || !Array.isArray(value.folders) ||
      !record(value.sessionFolders) || !record(value.expanded)) {
    throw new Error('Invalid or unsupported session-folder state');
  }
  const folders = new Map();
  for (const folder of value.folders) {
    if (!record(folder) || Object.keys(folder).sort().join(',') !== 'id,name,parentId,workspaceId' ||
        !text(folder.id) || !text(folder.workspaceId) || !text(folder.name) || folder.name.trim().length > 120 ||
        (folder.parentId !== null && !text(folder.parentId)) || folders.has(folder.id)) {
      throw new Error('Invalid or duplicate folder');
    }
    folders.set(folder.id, folder);
  }
  for (const folder of folders.values()) {
    const seen = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId !== null) {
      const parent = folders.get(parentId);
      if (!parent || parent.workspaceId !== folder.workspaceId || seen.has(parentId)) {
        throw new Error('Invalid folder parent, workspace, or cycle');
      }
      seen.add(parentId);
      parentId = parent.parentId;
    }
  }
  for (const [id, folderId] of Object.entries(value.sessionFolders)) {
    if (!text(id) || !text(folderId) || !folders.has(folderId)) {
      throw new Error('Invalid session-folder mapping');
    }
  }
  for (const [key, expanded] of Object.entries(value.expanded)) {
    if (!isExpansionKey(key) || typeof expanded !== 'boolean' ||
        (key.startsWith('folder:') && !folders.has(key.slice(7)))) {
      throw new Error('Invalid expansion entry');
    }
  }
  return value;
}

function getFolder(state, id) {
  requireText(id, 'Folder id');
  const folder = state.folders.find(folder => folder.id === id);
  if (!folder) throw new Error(`Unknown folder: ${id}`);
  return folder;
}

function createFolder(state, { id, workspaceId, parentId = null, name }) {
  requireText(id, 'Folder id');
  requireText(workspaceId, 'Workspace id');
  requireName(name);
  if (state.folders.some(folder => folder.id === id)) throw new Error(`Duplicate folder: ${id}`);
  if (parentId !== null && getFolder(state, parentId).workspaceId !== workspaceId) {
    throw new Error('Cannot create a folder across workspaces');
  }
  return { ...state, folders: [...state.folders, { id, workspaceId, parentId, name: name.trim() }] };
}

function renameFolder(state, id, name) {
  getFolder(state, id);
  requireName(name);
  return { ...state, folders: state.folders.map(folder => folder.id === id ? { ...folder, name: name.trim() } : folder) };
}

// Same rules as createFolder, but the caller picks the sibling slot so an import can preserve exported order.
function insertFolder(state, { id, workspaceId, parentId = null, name, beforeId = null }) {
  requireText(id, 'Folder id');
  requireText(workspaceId, 'Workspace id');
  requireName(name);
  if (state.folders.some(folder => folder.id === id)) throw new Error(`Duplicate folder: ${id}`);
  if (beforeId !== null) {
    const before = getFolder(state, beforeId);
    if (before.workspaceId !== workspaceId || before.parentId !== parentId) throw new Error('Cannot insert outside the target folder level');
  }
  if (parentId !== null && getFolder(state, parentId).workspaceId !== workspaceId) {
    throw new Error('Cannot create a folder across workspaces');
  }
  const folder = { id, workspaceId, parentId, name: name.trim() };
  const at = beforeId === null
    ? state.folders.reduce((last, item, index) => item.workspaceId === workspaceId && item.parentId === parentId ? index + 1 : last, state.folders.length)
    : state.folders.findIndex(item => item.id === beforeId);
  return { ...state, folders: [...state.folders.slice(0, at), folder, ...state.folders.slice(at)] };
}

// Siblings share a workspace as well as a parent: parentId null means "workspace root" once per workspace.
function siblingIds(state, folder) {
  return state.folders.filter(item => item.workspaceId === folder.workspaceId && item.parentId === folder.parentId).map(item => item.id);
}

function reorderSiblings(state, ids) {
  const positions = new Set(ids);
  const queue = ids.map(id => getFolder(state, id));
  let next = 0;
  return { ...state, folders: state.folders.map(folder => positions.has(folder.id) ? queue[next++] : folder) };
}

const folderName = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'variant' });
const SORT_MODES = ['first', 'up', 'down', 'last', 'name'];

// mode: first | up | down | last | name — only the folder's own siblings move; other levels keep their slots.
function sortSiblings(state, folderId, mode) {
  if (!SORT_MODES.includes(mode)) throw new Error(`Unknown folder sort mode: ${mode}`);
  const folder = getFolder(state, folderId);
  const ids = siblingIds(state, folder);
  const index = ids.indexOf(folderId);
  const without = ids.filter(id => id !== folderId);
  if (mode === 'name') {
    const sorted = [...ids].sort((left, right) => folderName.compare(getFolder(state, left).name, getFolder(state, right).name));
    return sorted.every((id, position) => id === ids[position]) ? state : reorderSiblings(state, sorted);
  }
  const target = mode === 'first' ? 0 : mode === 'up' ? index - 1 : mode === 'down' ? index + 1 : without.length;
  if (target < 0 || target > without.length) return state;
  const order = [...without.slice(0, target), folderId, ...without.slice(target)];
  return order.every((id, position) => id === ids[position]) ? state : reorderSiblings(state, order);
}

// Folders of one workspace in tree order with their nesting depth, for pickers that are not the tree itself.
function folderOutline(state, workspaceId) {
  const depth = new Map();
  const rows = [];
  const stack = state.folders.filter(folder => folder.workspaceId === workspaceId && folder.parentId === null).reverse();
  while (stack.length) {
    const folder = stack.pop();
    const level = depth.get(folder.parentId) ?? 0;
    depth.set(folder.id, level + 1);
    rows.push({ ...folder, depth: level });
    const nested = state.folders.filter(item => item.workspaceId === workspaceId && item.parentId === folder.id);
    for (let index = nested.length - 1; index >= 0; index--) stack.push(nested[index]);
  }
  return rows;
}

function setExpanded(state, key, expanded) {
  if (typeof key !== 'string' || !isExpansionKey(key) || typeof expanded !== 'boolean') {
    throw new Error('Invalid expansion entry');
  }
  if (key.startsWith('folder:')) getFolder(state, key.slice(7));
  return { ...state, expanded: { ...state.expanded, [key]: expanded } };
}

function subtreeIds(state, id) {
  getFolder(state, id);
  const children = new Map();
  for (const folder of state.folders) {
    if (!children.has(folder.parentId)) children.set(folder.parentId, []);
    children.get(folder.parentId).push(folder.id);
  }
  const result = new Set();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop();
    if (result.has(current)) continue;
    result.add(current);
    pending.push(...(children.get(current) || []));
  }
  return result;
}

function moveItems(state, items, target) {
  if (!record(target) || !Array.isArray(items)) throw new Error('Invalid move');
  requireText(target.workspaceId, 'Target workspace id');
  if (target.folderId !== null && getFolder(state, target.folderId).workspaceId !== target.workspaceId) {
    throw new Error('Cannot move across workspaces');
  }
  const folders = new Map(state.folders.map(folder => [folder.id, folder]));
  const selectedFolders = new Set();
  for (const item of items) {
    if (!record(item) || !['folder', 'session'].includes(item.kind)) throw new Error('Invalid move item');
    requireText(item.id, 'Item id');
    if (item.workspaceId !== target.workspaceId) throw new Error('Cannot move across workspaces');
    if (item.kind === 'folder') {
      if (getFolder(state, item.id).workspaceId !== target.workspaceId) throw new Error('Cannot move across workspaces');
      selectedFolders.add(item.id);
    } else {
      const current = own(state.sessionFolders, item.id) ? folders.get(state.sessionFolders[item.id]) : null;
      if (current && current.workspaceId !== target.workspaceId) throw new Error('Cannot move across workspaces');
    }
  }
  const hasSelectedAncestor = id => {
    while (id !== null && folders.has(id)) {
      if (selectedFolders.has(id)) return true;
      id = folders.get(id).parentId;
    }
    return false;
  };
  if (hasSelectedAncestor(target.folderId)) throw new Error('Cannot move a folder into itself or its descendant');
  const sessionFolders = { ...state.sessionFolders };
  for (const item of items) {
    if (item.kind !== 'session' || hasSelectedAncestor(own(sessionFolders, item.id) ? sessionFolders[item.id] : null)) continue;
    if (target.folderId === null) delete sessionFolders[item.id];
    else Object.defineProperty(sessionFolders, item.id, { value: target.folderId, enumerable: true, configurable: true, writable: true });
  }
  return {
    ...state,
    folders: state.folders.map(folder => selectedFolders.has(folder.id) && !hasSelectedAncestor(folder.parentId)
      ? { ...folder, parentId: target.folderId } : folder),
    sessionFolders,
  };
}

// Folder order is the order of state.folders among siblings. Moves items next to sibling folder refId (refId null: after
// the last root folder); dragged folders keep their relative order. Sessions just land in refId's parent.
function placeItems(state, items, { workspaceId, refId, after = true }) {
  const ref = refId === null ? null : getFolder(state, refId);
  if (ref && ref.workspaceId !== workspaceId) throw new Error('Cannot move across workspaces');
  const parentId = ref ? ref.parentId : null;
  const ids = new Set(items.filter(item => item.kind === 'folder').map(item => item.id));
  if (ids.has(refId)) return state;
  const next = moveItems(state, items, { workspaceId, folderId: parentId });
  const moved = next.folders.filter(folder => ids.has(folder.id) && folder.parentId === parentId);
  const rest = next.folders.filter(folder => !moved.includes(folder));
  const at = ref ? rest.findIndex(folder => folder.id === refId) + (after ? 1 : 0) : rest.length;
  return { ...next, folders: [...rest.slice(0, at), ...moved, ...rest.slice(at)] };
}

function deleteFolder(state, id) {
  const removed = subtreeIds(state, id);
  return {
    ...state,
    folders: state.folders.filter(folder => !removed.has(folder.id)),
    sessionFolders: Object.fromEntries(Object.entries(state.sessionFolders).filter(([, folderId]) => !removed.has(folderId))),
    expanded: Object.fromEntries(Object.entries(state.expanded).filter(([key]) => !removed.has(key.startsWith('folder:') ? key.slice(7) : null))),
  };
}

function folderSessionIds(state, id) {
  const folders = subtreeIds(state, id);
  return Object.entries(state.sessionFolders).filter(([, folderId]) => folders.has(folderId)).map(([sessionId]) => sessionId);
}

// only: when set, a filter view — just those sessions, the folders on their paths, all expanded.
function rowsForWorkspace(state, workspaceId, sessions, { archivedIds = [], pinnedIds = [], showArchived = false, only = null } = {}) {
  const archived = new Set(archivedIds);
  const pinned = new Set(pinnedIds.filter(id => !archived.has(id)));
  const folders = state.folders.filter(folder => folder.workspaceId === workspaceId);
  const folderIds = new Set(folders.map(folder => folder.id));
  const children = new Map();
  const add = (parentId, row) => {
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(row);
  };
  const visible = sessions.filter(session => (showArchived || !archived.has(session.id)) &&
    session.origin !== 'subagent' && !(session.blank && !(session.retainedBy?.mainView > 0)) && (!only || only.has(session.id)));
  const onPath = new Set();
  if (only) for (const session of visible) for (const folder of folderChain(state, session.id, workspaceId)) onPath.add(folder.id);
  for (const folder of folders) if (!only || onPath.has(folder.id)) add(folder.parentId, { ...folder, kind: 'folder' });
  const timestamp = session => typeof session.updatedAt === 'number' ? session.updatedAt : (Date.parse(session.updatedAt) || 0);
  visible.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || timestamp(b) - timestamp(a) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const session of visible) {
    const mapped = own(state.sessionFolders, session.id) ? state.sessionFolders[session.id] : null;
    const parentId = folderIds.has(mapped) ? mapped : null;
    add(parentId, { ...session, kind: 'session', workspaceId, parentId, archived: archived.has(session.id) });
  }
  const rows = [];
  const stack = (children.get(null) || []).map(row => ({ ...row, depth: 0 })).reverse();
  while (stack.length) {
    const row = stack.pop();
    rows.push(row);
    if (row.kind === 'folder' && (only || state.expanded[`folder:${row.id}`] !== false)) {
      const nested = children.get(row.id) || [];
      for (let index = nested.length - 1; index >= 0; index--) stack.push({ ...nested[index], depth: row.depth + 1 });
    }
  }
  return rows;
}

// The archive section is a flat list under each workspace, newest first; folder placement is only a hint there.
function archivedSessionRows(state, workspaceId, sessions, { archivedIds = [] } = {}) {
  const archived = new Set(archivedIds);
  const folderIds = new Set(state.folders.filter(folder => folder.workspaceId === workspaceId).map(folder => folder.id));
  const timestamp = session => typeof session.updatedAt === 'number' ? session.updatedAt : (Date.parse(session.updatedAt) || 0);
  return sessions.filter(session => session && archived.has(session.id) && session.origin !== 'subagent' &&
      !(session.blank && !(session.retainedBy?.mainView > 0)))
    .map(session => {
      const mapped = own(state.sessionFolders, session.id) ? state.sessionFolders[session.id] : null;
      return { ...session, kind: 'session', workspaceId, parentId: null, depth: 0, archived: true,
        folderId: folderIds.has(mapped) ? mapped : null };
    })
    .sort((a, b) => timestamp(b) - timestamp(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Folder rows are never paged; each sibling session list has its own five-row watermark.
function pageRows(rows, limits = {}, attention = () => false) {
  const buckets = new Map();
  for (const row of rows) if (row.kind === 'session') {
    const key = row.parentId === null ? 'root' : 'folder:' + row.parentId;
    if (!buckets.has(key)) buckets.set(key, { total: 0, required: 5 });
    const bucket = buckets.get(key);
    if (!row.blank) {
      bucket.total++;
      if (bucket.total <= 50 && attention(row)) bucket.required = Math.max(bucket.required, bucket.total);
    }
    bucket.last = row;
  }
  const result = [];
  for (const row of rows) {
    if (row.kind !== 'session') { result.push(row); continue; }
    const key = row.parentId === null ? 'root' : 'folder:' + row.parentId;
    const bucket = buckets.get(key), limit = Math.max(limits[key] || 5, bucket.required);
    bucket.seen = (bucket.seen || 0) + (row.blank ? 0 : 1);
    if (row.blank || bucket.seen <= limit) result.push(row);
    if (row === bucket.last && bucket.total > 5) result.push({
      kind: 'overflow', id: key, workspaceId: row.workspaceId, depth: row.depth,
      hidden: Math.max(0, bucket.total - limit), limit,
    });
  }
  return result;
}

function selectItems(selection, anchor, key, visibleKeys, { ctrl = false, shift = false } = {}) {
  if (!/^(folder|session):.+$/.test(key) || !visibleKeys.includes(key)) throw new Error('Invalid or invisible selection key');
  if (shift && visibleKeys.includes(anchor)) {
    const start = visibleKeys.indexOf(anchor);
    const end = visibleKeys.indexOf(key);
    const range = visibleKeys.slice(Math.min(start, end), Math.max(start, end) + 1);
    return { selection: ctrl ? [...new Set([...selection, ...range])] : range, anchor };
  }
  if (ctrl) {
    return { selection: selection.includes(key) ? selection.filter(item => item !== key) : [...new Set([...selection, key])], anchor: key };
  }
  return { selection: [key], anchor: key };
}

function sessionActivity(session, statuses, sessions) {
  const status = statuses.get(session.id);
  const runningChildren = sessions.projectionsBySession?.[session.id]?.values.subagentCatalog?.filter(child =>
    (statuses.get(child.id)?.running ?? sessions.byId[child.id]?.running) === true).length || 0;
  return { runningChildren, state: status?.pendingInteraction ? 'pending'
    : (status?.running ?? session.running) || runningChildren ? 'running' : status?.completionUnread ? 'unread' : 'idle' };
}

// Folders holding a session inside its workspace, innermost first.
function folderChain(state, id, workspaceId) {
  const folderById = new Map(state.folders.map(folder => [folder.id, folder]));
  const chain = [];
  for (let folder = folderById.get(state.sessionFolders[id]); folder?.workspaceId === workspaceId; folder = folderById.get(folder.parentId)) chain.push(folder);
  return chain;
}

// Aggregate actual membership, not the expanded/paginated row projection. Sessions outside every
// workspace form the '' (ungrouped) workspace, matching the tree; the total covers all workspaces.
// ids lists the non-idle sessions behind each count so the summary can jump to them.
function treeActivity(state, workspaces, sessions, statuses) {
  const empty = () => ({ pending: 0, running: 0, unread: 0, idle: 0, total: 0, ids: { pending: [], running: [], unread: [] } });
  const result = { folders: new Map(state.folders.map(folder => [folder.id, empty()])), workspaces: new Map(), total: empty() };
  const archived = new Set(workspaces.archivedSessionIds);
  const seen = new Set();
  for (const { workspaceId, sessionIds } of [...workspaces.items, { workspaceId: '', sessionIds: sessions.ids || [] }]) {
    const workspace = empty();
    result.workspaces.set(workspaceId, workspace);
    for (const id of sessionIds) {
      const session = sessions.byId[id];
      if (seen.has(id) || !session || session.blank || session.origin === 'subagent' || archived.has(id)) continue;
      seen.add(id);
      const activity = sessionActivity(session, statuses, sessions).state;
      const add = summary => { summary.total++; summary[activity]++; summary.ids[activity]?.push(id); };
      add(result.total); add(workspace);
      for (const folder of folderChain(state, id, workspaceId)) add(result.folders.get(folder.id));
    }
  }
  return result;
}

// Session tags live in their own storage key: { version: 1, tags: [{ id, name, color, once }], sessions: { sessionId: [tagId] } }.
// once: the tag clears itself the next time its session is opened.
function validateTags(value) {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.tags) || !record(value.sessions)) throw new Error('Invalid session-tag state');
  const ids = new Set();
  for (const tag of value.tags) {
    if (!record(tag) || !text(tag.id) || ids.has(tag.id) || !text(tag.name) || tag.name.trim().length > 40 ||
        !/^#[0-9a-f]{6}$/i.test(tag.color) || typeof tag.once !== 'boolean') throw new Error('Invalid or duplicate tag');
    ids.add(tag.id);
  }
  for (const [id, list] of Object.entries(value.sessions)) {
    if (!text(id) || !Array.isArray(list) || !list.length || new Set(list).size !== list.length || list.some(tagId => !ids.has(tagId))) {
      throw new Error('Invalid session-tag mapping');
    }
  }
  return value;
}

function saveTag(state, { id, name, color, once }) {
  requireText(id, 'Tag id');
  requireText(name, 'Tag name');
  if (name.trim().length > 40) throw new Error('Tag name must be at most 40 characters');
  if (state.tags.some(tag => tag.id !== id && tag.name.toLowerCase() === name.trim().toLowerCase())) throw new Error(`Duplicate tag: ${name.trim()}`);
  const tag = { id, name: name.trim(), color, once };
  const tags = state.tags.some(item => item.id === id) ? state.tags.map(item => item.id === id ? tag : item) : [...state.tags, tag];
  return validateTags({ ...state, tags });
}

// Rewrites each session's tag list; sessions left without tags are dropped from the mapping.
function mapSessionTags(state, sessionIds, transform) {
  const sessions = { ...state.sessions };
  for (const id of sessionIds) {
    const list = transform(sessions[id] || []);
    if (list.length) sessions[id] = list; else delete sessions[id];
  }
  return { ...state, sessions };
}

function deleteTag(state, id) {
  return mapSessionTags({ ...state, tags: state.tags.filter(tag => tag.id !== id) }, Object.keys(state.sessions), list => list.filter(tagId => tagId !== id));
}

function setSessionTag(state, sessionIds, tagId, on) {
  if (!state.tags.some(tag => tag.id === tagId)) throw new Error(`Unknown tag: ${tagId}`);
  return mapSessionTags(state, sessionIds, list => on ? [...new Set([...list, tagId])] : list.filter(id => id !== tagId));
}

function clearOnceTags(state, sessionId) {
  const once = new Set(state.tags.filter(tag => tag.once).map(tag => tag.id));
  const list = state.sessions[sessionId] || [];
  return list.some(id => once.has(id)) ? mapSessionTags(state, [sessionId], ids => ids.filter(id => !once.has(id))) : state;
}

// Trash lives in its own key: { version: 1, entries: [{ sessionId, workspaceId, folderId, at }] }, newest first.
// folderId is the folder the session was in, so restoring can put it back; null means the workspace root.
const TRASH_LIMIT = 500;

function initialTrash() {
  return { version: 1, entries: [] };
}

function validateTrash(value) {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'entries,version' || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error('Invalid trash state');
  }
  const seen = new Set();
  for (const entry of value.entries) {
    if (!record(entry) || Object.keys(entry).sort().join(',') !== 'at,folderId,sessionId,workspaceId' ||
        !text(entry.sessionId) || seen.has(entry.sessionId) || typeof entry.workspaceId !== 'string' ||
        (entry.folderId !== null && !text(entry.folderId)) || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) {
      throw new Error('Invalid or duplicate trash entry');
    }
    seen.add(entry.sessionId);
  }
  return value;
}

function addTrash(state, { sessionId, workspaceId = '', folderId = null, at = Date.now() }) {
  const entry = { sessionId: text(sessionId) ? sessionId : '', workspaceId, folderId, at };
  validateTrash({ version: 1, entries: [entry] });
  const entries = [entry, ...state.entries.filter(item => item.sessionId !== sessionId)].slice(0, TRASH_LIMIT);
  return validateTrash({ version: 1, entries });
}

function removeTrash(state, sessionId) {
  if (!state.entries.some(entry => entry.sessionId === sessionId)) return state;
  return { ...state, entries: state.entries.filter(entry => entry.sessionId !== sessionId) };
}

function clearTrash() {
  return initialTrash();
}

function findTrash(state, sessionId) {
  return state.entries.find(entry => entry.sessionId === sessionId) || null;
}

// Restoring is a pure pair of updates: drop the record and point the session back at its folder when it still exists.
function restoreTrash(tree, trash, sessionId) {
  const entry = findTrash(trash, sessionId);
  if (!entry) throw new Error(`Unknown trash entry: ${sessionId}`);
  const folderExists = entry.folderId !== null && tree.folders.some(folder => folder.id === entry.folderId);
  const sessionFolders = { ...tree.sessionFolders };
  if (folderExists) sessionFolders[sessionId] = entry.folderId;
  else delete sessionFolders[sessionId];
  return { state: { ...tree, sessionFolders }, trash: removeTrash(trash, sessionId), folderId: folderExists ? entry.folderId : null };
}

// Export/import: one JSON document holding folders, tags, trash and colors. Import merges, never replaces.
const EXPORT_SCHEMA = 'dsh-session-hub/v1';
let importSequence = 0;
const importId = prefix => prefix + '-import-' + Date.now().toString(36) + '-' + (++importSequence).toString(36);
const TAG_COLOR = /^#[0-9a-f]{6}$/i;

function exportData({ tree, tags, trash, colors }, { exportedAt = Date.now() } = {}) {
  const state = validateState(tree);
  return {
    schema: EXPORT_SCHEMA,
    exportedAt,
    folders: {
      version: 1,
      folders: state.folders.map(folder => ({ ...folder })),
      sessionFolders: { ...state.sessionFolders },
      expanded: { ...state.expanded },
    },
    tags: { version: 1, tags: validateTags(tags).tags.map(tag => ({ ...tag })), sessions: { ...tags.sessions } },
    trash: { version: 1, entries: validateTrash(trash).entries.map(entry => ({ ...entry })) },
    colors: (colors || []).map(color => TAG_COLOR.test(color || '') ? String(color).toLowerCase() : null),
  };
}

// makeId is injectable so the merge order and generated ids are deterministic in tests.
function importData(local, payload, { makeId = importId } = {}) {
  if (!record(payload) || payload.schema !== EXPORT_SCHEMA || !record(payload.folders)) throw new Error('Invalid import data');
  const remote = payload.folders;
  validateState({ version: 1, folders: remote.folders, sessionFolders: remote.sessionFolders ?? {},
    expanded: remote.expanded ?? {} });
  const summary = { folders: 0, tags: 0, sessions: 0, trash: 0, skipped: 0 };
  let tree = local.tree;
  const localById = new Map(tree.folders.map(folder => [folder.id, folder]));
  const idMap = new Map();
  // Remote ids are matched on name+parent+workspace; a taken id with different content gets a fresh one.
  // Parents resolve before their children, so an exported array whose order is arbitrary still imports intact.
  const sameDefinition = (localFolder, parentId, name) => localFolder.parentId === parentId && localFolder.name === name;
  let pending = [...remote.folders];
  const added = [];
  while (pending.length) {
    const resolved = pending.filter(folder => folder.parentId === null || idMap.has(folder.parentId));
    if (!resolved.length) throw new Error('Invalid import data: unresolved folder parent');
    for (const folder of resolved) {
      const parentId = folder.parentId === null ? null : idMap.get(folder.parentId);
      const localFolder = localById.get(folder.id);
      if (localFolder && sameDefinition(localFolder, parentId, folder.name)) {
        idMap.set(folder.id, folder.id);
        summary.skipped++;
      } else {
        const id = localFolder ? makeId('folder') : folder.id;
        idMap.set(folder.id, id);
        added.push({ id, workspaceId: folder.workspaceId, parentId, name: folder.name });
        summary.folders++;
      }
    }
    pending = pending.filter(folder => !resolved.includes(folder));
  }
  for (const folder of added) tree = insertFolder(tree, { ...folder, beforeId: null });
  // Session placements: keep local assignments, only fill in sessions that are not mapped yet.
  for (const [sessionId, folderId] of Object.entries(remote.sessionFolders || {})) {
    const mapped = idMap.get(folderId);
    if (!mapped) { summary.skipped++; continue; }
    if (own(tree.sessionFolders, sessionId)) { summary.skipped++; continue; }
    tree = { ...tree, sessionFolders: { ...tree.sessionFolders, [sessionId]: mapped } };
    summary.sessions++;
  }
  const expanded = { ...tree.expanded };
  for (const [key, open] of Object.entries(remote.expanded || {})) {
    if (typeof open !== 'boolean' || own(expanded, key)) continue;
    if (key.startsWith('folder:') && idMap.has(key.slice(7))) expanded['folder:' + idMap.get(key.slice(7))] = open;
    else if (key.startsWith('workspace:') || key === EXPANDED_TRASH) expanded[key] = open;
  }
  tree = { ...tree, expanded };
  // Tags merge by name; a remote id already used locally is regenerated and remapped for assignments.
  let tags = local.tags;
  const byName = new Map(tags.tags.map(tag => [tag.name.trim().toLowerCase(), tag.id]));
  const tagMap = new Map();
  const remoteTags = Array.isArray(payload.tags?.tags) ? payload.tags.tags : [];
  for (const tag of remoteTags) {
    if (!record(tag) || !text(tag.name)) { summary.skipped++; continue; }
    const name = tag.name.trim().slice(0, 40).trim();
    if (!name) { summary.skipped++; continue; }
    const found = byName.get(name.toLowerCase());
    if (found) { if (text(tag.id)) tagMap.set(tag.id, found); summary.skipped++; continue; }
    const id = text(tag.id) && !tags.tags.some(item => item.id === tag.id) ? tag.id : makeId('tag');
    tags = { ...tags, tags: [...tags.tags, { id, name, color: TAG_COLOR.test(tag.color || '') ? String(tag.color).toLowerCase() : '#6366f1', once: tag.once === true }] };
    byName.set(name.toLowerCase(), id);
    if (text(tag.id)) tagMap.set(tag.id, id);
    summary.tags++;
  }
  const sessions = { ...tags.sessions };
  for (const [sessionId, list] of Object.entries(payload.tags?.sessions || {})) {
    if (!text(sessionId) || !Array.isArray(list)) continue;
    const mapped = [...new Set(list.map(id => tagMap.get(id)).filter(Boolean))];
    if (!mapped.length) continue;
    sessions[sessionId] = [...new Set([...(sessions[sessionId] || []), ...mapped])];
  }
  tags = validateTags({ ...tags, sessions });
  let trash = local.trash;
  for (const entry of Array.isArray(payload.trash?.entries) ? payload.trash.entries : []) {
    if (!record(entry) || !text(entry.sessionId) || findTrash(trash, entry.sessionId)) { summary.skipped++; continue; }
    const folderId = text(entry.folderId) ? idMap.get(entry.folderId) ?? entry.folderId : null;
    const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : Date.now();
    const workspaceId = typeof entry.workspaceId === 'string' ? entry.workspaceId : '';
    trash = addTrash(trash, { sessionId: entry.sessionId, workspaceId, folderId, at });
    summary.trash++;
  }
  const colors = local.colors.map((color, index) => color ?? (TAG_COLOR.test(payload.colors?.[index] || '') ? String(payload.colors[index]).toLowerCase() : null));
  return { tree, tags, trash, colors, summary };
}

module.exports = {
  initialState, validateState, createFolder, renameFolder, insertFolder, setExpanded, moveItems, placeItems,
  sortSiblings, folderOutline, deleteFolder, folderSessionIds, rowsForWorkspace, archivedSessionRows, pageRows,
  selectItems, sessionActivity, treeActivity, folderChain,
  validateTags, saveTag, deleteTag, setSessionTag, clearOnceTags,
  EXPANDED_TRASH, ARCHIVE_VIEWS, normalizeArchiveView,
  initialTrash, validateTrash, addTrash, removeTrash, clearTrash, findTrash, restoreTrash,
  EXPORT_SCHEMA, exportData, importData,
};
