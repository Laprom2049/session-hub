# 合并方案：dsh-session-hub

## 目标与来源

把三套社区侧栏插件的**功能并集**落在一个插件里。底座是
[`@yuxhangz/dsh-session-manager`](https://github.com/XinAnzzZ/dsh-session-manager)（MIT，作者 XinAnzzZ）——
它的树、拖拽、多选、撤销、标签、活动计数已经最完整。本仓库是它的衍生分支，保留 LICENSE 与来源说明。

要补进来的功能（括号内是出处）：

| 功能 | 出处 | 状态 |
| --- | --- | --- |
| 嵌套文件夹、拖拽 + 多选批量、撤销、标签、活动计数、搜索、分页、键盘 | manager（现有） | 保留 |
| 回收站：会话移入回收站 / 恢复 / 清空 | keeper | 待实现 |
| 归档独立分区（与「混入原位置」「隐藏」三选一） | keeper | 待实现 |
| 导入 / 导出分组与标签数据（JSON） | groups | 待实现 |
| 右键分组 →「在此分组新建会话」 | groups | 待实现 |
| 分组排序：移到最前 / 上移 / 下移 / 移到最后 / 按名称排序 | groups、keeper | 待实现 |
| 会话右键 →「移入分组…」菜单（不用拖拽也能归类） | keeper | 待实现 |

## 硬约束

1. **只改前端三件套**：`model.cjs`、`storage.cjs`、`client-source.cjs`。`index.js` 与清单不动（改了要整机重启）。
2. 新数据一律走**新的存储键**，前缀必须是 `dsh.session-hub.`（host 路由的 KEY 正则已放行该前缀）。
   不要改 `dsh.session-hub.v1` 的既有结构——那是兼容边界，已有用户数据的校验一旦不认就整份失效。
3. CSS 类名一律 `dsmgr-` 前缀；`data-dsm-key` 是属性不受限。
4. 会话的归档 / 取消归档 / 置顶 / 打开 / 新建 / 重命名全部走 `ctx.uiWorkspace.*` 与 `ctx.sessions.*`，插件不自己改会话数据。
5. 错误不许静默：至少 `report(error)`，需要用户知道的用 `setMessage`。
6. 文案进 `dictionaries`（`zh` / `en` 两份），不要在 JSX 里写死中文。

## 数据设计

| 键 | 值 | 说明 |
| --- | --- | --- |
| `dsh.session-hub.trash` | `JSON: {version:1, entries:[{sessionId, workspaceId, folderId, at}]}` | `folderId` 可为 null；用于恢复回原分组 |
| `dsh.session-hub.archive-view` | `'inline' \| 'section' \| 'hidden'` | 默认 `inline`，与现有行为一致 |
| 导入导出 | 不落盘，走对话框 | 导出内容：`{schema:'dsh-session-hub/v1', exportedAt, folders:state, tags, trash, colors}` |

树模型（`model.cjs`）新增纯函数并补单测：

- `sortSiblings(state, folderId, mode)`：`mode ∈ {first, up, down, last, name}`；只在自己的兄弟间调整 `state.folders` 顺序；`name` 用 `localeCompare('zh-Hans-CN', {numeric:true})`。
- `insertFolder(state, {id, workspaceId, parentId, name, beforeId})` 或等价能力：导入时按顺序落位。

导入合并策略：分组按 `id` 去重，冲突的生成新 id 并把 `sessionFolders` 重映射；标签按 `name` 去重；冲突不覆盖本地，全部计入结果摘要（新增 X 个分组、Y 个标签、跳过 Z 项）。

## UI 落点

- **归档分区**：每个工作区列表底部一个可折叠 `已归档 (n)` 区块（`section` 模式）；`hidden` 不渲染；`inline` 保持现状。归档行沿用现有灰态行，恢复按钮复用 `ctx.uiWorkspace.unarchiveSession`。
- **回收站**：侧栏最底部一个 `回收站 (n)` 区块（跨工作区，折叠状态记忆在 `expanded`）。每行显示标题 + 工作区 + 移入时间，行尾两个按钮：恢复、移除记录。区块头一个「清空」。
  - 移入回收站 = 记录到 trash + `archiveSession`（会话不会真的消失，仍可在 DSH 归档里找回）。
  - 恢复 = 从 trash 删除记录 + `unarchiveSession` + 若有 `folderId` 则把 `sessionFolders` 指回去。
  - 移除记录 = 只删 trash 记录（**不删会话**，文案要写清楚）。
- **分组菜单**新增：`在此分组新建会话`、`移入分组…`（会话菜单）、`分组排序`（带 5 个 mode）。
- **导入 / 导出**：放在现有设置区（`settings.section`）里两个按钮，导出弹只读 textarea + 复制；导入弹 textarea + 「导入」按钮，成功后 `setMessage` 摘要。

## 验收

```powershell
node build.cjs
node --check client.js
node --check index.js
node --test test/*.test.cjs
```

- 现有 105 个测试必须全绿（其中 `bundle.test.cjs` 会校验 `client.js` 由当前源码生成，所以每次改源码都要重新 `node build.cjs`）。
- 新增至少：`test/model.test.cjs` 里 `sortSiblings` 的 5 种 mode；`test/trash.test.cjs`（trash 记录的增删、恢复回原分组）；`test/import-export.test.cjs`（导出结构与导入合并/去重/摘要）。
- 交付报告里写清楚：哪些行为只在单测里验证过、没有在 Desktop 里点过。
