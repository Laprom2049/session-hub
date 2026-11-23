# 来源与致谢

本插件是三个社区侧栏插件的**功能合并版**，代码底座取自第一项，其余两项的功能按 MIT 许可重写移植，未复制其代码。

| 项目 | 作者 | 许可 | 本仓库用到什么 |
| --- | --- | --- | --- |
| [dsh-session-manager](https://github.com/XinAnzzZ/dsh-session-manager) | XinAnzzZ | MIT | **代码底座**：`model.cjs` / `storage.cjs` / `client-source.cjs` / `build.cjs` / `index.js`，含文件夹树、多选拖拽、撤销、标签、分页、活动计数、搜索、键盘导航 |
| [dsh-session-groups](https://github.com/westformula1/dsh-session-groups) | westformula1 | MIT | 功能参照：分组导入 / 导出、分组排序（移到最前 / 上移 / 下移 / 移到最后 / 按名称）、在分组内新建会话 |
| [dsh-session-keeper](https://github.com/wsnmm3/dsh-session-keeper) | wsnmm3 | MIT | 功能参照：归档独立分区、会话回收站（移入 / 恢复 / 清空）、会话「移入分组」菜单 |

## 与参照实现的差异

- **回收站不做磁盘搬移**。`dsh-session-keeper` 会把会话日志目录 `rename` 到 `$DSH_HOME/trash/<批次>/`；本插件不改磁盘，只记一条回收站记录并调用 DSH 原生的 `archiveSession`，恢复时 `unarchiveSession` 并按记录把会话放回原分组。因此本插件的「永久移除」只删记录，**不会删除磁盘上的会话日志**。
- **导入是合并，不是整体替换**。`dsh-session-groups` 的导入会整份替换；本插件按 id / 名称去重后合并，冲突项跳过并在结果摘要里计数。
- **归档分区**按工作区渲染（每个工作区列表底部一个可折叠区块），并可在设置里切「混入原位置 / 独立分区 / 隐藏」。

原 `dsh-session-manager` 的 LICENSE 原样保留在仓库内。
