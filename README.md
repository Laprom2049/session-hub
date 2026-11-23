# 会话整理 · dsh-session-hub

> 给 DeepSeek Harness 侧栏加一层「文件夹 + 标签 + 归档 + 回收站」的显示层，不改动任何会话文件。

## 简介

DSH 原生侧栏按工作区平铺会话，项目一多就难找。本插件在侧栏上叠加可嵌套的文件夹树、标签筛选、置顶、归档分区和回收站，并提供导入导出。

所有操作只写 `$DSH_HOME/session-hub/storage.json`：会话本身、工作区成员关系、DSH 安装目录都不会被修改。关掉插件就回到原生列表，数据保留。

本插件是三个社区侧栏插件的功能合并版（来源与授权见 [NOTICE.md](NOTICE.md)）：
[dsh-session-manager](https://github.com/XinAnzzZ/dsh-session-manager)（代码底座）+
[dsh-session-groups](https://github.com/westformula1/dsh-session-groups) +
[dsh-session-keeper](https://github.com/wsnmm3/dsh-session-keeper)。

## 功能

- **文件夹树**：每个工作区独立维护任意层级；单击展开/折叠，双击或 F2 重命名，右键开菜单。
- **拖动**：会话或文件夹拖到文件夹/工作区行；Ctrl/Cmd 点选、Shift 范围选可批量拖动；同一工作区内移动。
- **排序**：右键文件夹 → 分组排序 → 移到最前 / 上移 / 下移 / 移到最后 / 按名称排序。
- **在此分组新建会话**：右键文件夹直接建会话，建完就归入该组。
- **移入分组…**：不想拖拽时，右键会话从菜单里挑目标文件夹。
- **置顶**：置顶在所在文件夹内生效。
- **标签**：会话可打多个标签，行上显示色点，顶栏按标签筛选；支持一次性标签。
- **归档**：设置里三选一——混入原位置 / 独立归档分区 / 隐藏；独立分区在每个工作区底部，可折叠。
- **回收站**：会话「移入回收站」后归档并留一条记录；可从回收站恢复（放回原文件夹）或移除记录。清空只清记录，**不删磁盘会话**。
- **导入 / 导出**：导出文件夹树 + 标签 + 回收站 + 配色为一份 JSON；导入按 id / 名称去重后合并，结果有摘要。
- **其它**：分页（每组默认 5 条）、搜索（标题 / 工作区 / 正文）、活动计数、键盘导航、移动撤销（最多 30 步）。

## 安装

本地源码目录是**链接安装**，启用期间不要移动或删除它：

```powershell
dsh plugin --profile web add "<插件源码目录>"
```

也可以在 Desktop 的「插件 → 安装第三方插件」里选择该目录。

- 只改前端（`model.cjs` / `storage.cjs` / `client-source.cjs`）：`node build.cjs` 后约 1 秒热重载。
- 改 host（`index.js`）或清单：完全退出 Desktop（含托盘）再启动。

## 用法

### 第一次使用

1. 安装并启用插件，侧栏出现文件夹树。
2. 用「新建文件夹」入口建立文件夹，可多层嵌套。
3. 把会话拖进文件夹；批量移动时先用 Ctrl/Cmd 点选或 Shift 连选。
4. 双击文件夹或按 F2 重命名；右键菜单里还有排序、在此新建会话、移入文件夹等操作。

### 常见操作

| 想做什么 | 怎么做 |
| --- | --- |
| 整理会话 | 直接拖拽，或右键会话 →「移入文件夹…」 |
| 批量移动 | Ctrl/Cmd 点选、Shift 连选后一起拖 |
| 调整文件夹顺序 | 右键文件夹 → 分组排序 |
| 给会话分类 | 右键会话 →「标签…」，顶栏按标签筛选 |
| 收起不用的会话 | 右键 → 移入回收站，或改用归档分区 |
| 换归档呈现方式 | 设置里选「混入原位置 / 独立归档分区 / 隐藏」 |
| 备份或换机 | 设置里导出 JSON；在新机器导入（按 id / 名称去重合并） |
| 快速找会话 | Ctrl+Cmd+K 搜索标题 / 工作区 / 正文 |
| 撤销拖错 | Ctrl/Cmd+Z，最多 30 步 |

## 数据

全部存在 host 端 `$DSH_HOME/session-hub/storage.json`，同一台机器上的所有壳共用一份：

| 键 | 内容 |
| --- | --- |
| `dsh.session-hub.v1` | 文件夹树、会话→文件夹映射、展开状态 |
| `dsh.session-hub.tags` | 标签定义与映射 |
| `dsh.session-hub.trash` | 回收站记录 |
| `dsh.session-hub.archive-view` | 归档呈现模式 |
| `dsh.session-hub.folder-colors` | 文件夹图标颜色 |

## 开发

```powershell
node build.cjs
node --check client.js
node --check index.js
node --test test/*.test.cjs
```

`client.js` 是生成文件，不要手改。改源码必须重新 build，`test/bundle.test.cjs` 会校验产物与源码一致。

## 限制

- 文件夹只是侧栏显示层，**不能跨工作区移动会话**。
- 「永久移除」只删回收站记录，不删磁盘日志；真要清日志请用 DSH 自己的归档/清理流程。
- 归档分区不分页，归档很多时列表会偏长。
- 导入不是事务：树先写、标签后写，标签键写入失败会留下半应用状态（文件夹已导入、标签未导入）。

## 来源与许可

MIT。代码底座来自 [dsh-session-manager](https://github.com/XinAnzzZ/dsh-session-manager)（Copyright (c) 2026 XinAnzzZ），其 LICENSE 原样保留；另两个项目的功能按 MIT 许可重写移植，未复制代码。详见 [NOTICE.md](NOTICE.md)。
