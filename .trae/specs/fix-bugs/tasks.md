# Tasks

- [x] Task 1: 修复后端安全与数据完整性 Bug
  - [x] SubTask 1.1: 修复 share-token.js 中 createShareMetadata 的 passwordHash 属性名不匹配（接收 `password` 但调用方传 `passwordHash`），导致所有加密分享无密码保护
  - [x] SubTask 1.2: 修复 rename.js 文件夹移动时使用 listAllObjects 返回的 obj.httpMetadata（始终为 undefined），改用 src.httpMetadata（来自 env.img_r2.get）
  - [x] SubTask 1.3: 修复 webdav/[[path]].js 中 MOVE/COPY 文件夹时同样使用 obj.httpMetadata 而非 src.httpMetadata 的问题
  - [x] SubTask 1.4: 修复 telegram.js 第 52 行 telegra.ph URL 双斜杠 `//file/` → `/file/`
  - [x] SubTask 1.5: 修复 middleware.js telemetryData 的 finally 块中 `context.data.transaction` 可能为 undefined 导致 TypeError，加空值检查
  - [x] SubTask 1.6: 修复 upload.js 中直接调用 errorHandling/telemetryData 中间件函数的问题（返回值被忽略、context.next() 行为不可预期），改为在 upload.js 中添加内联错误处理并移除直接调用

- [x] Task 2: 修复后端 API 行为 Bug
  - [x] SubTask 2.1: 修复 delete.js 删除不存在的文件时返回误导性成功响应，应检查文件/文件夹是否存在并返回 404
  - [x] SubTask 2.2: 修复 download.js 手动设置 `Transfer-Encoding: chunked`（应由运行时自动处理），删除该 header
  - [x] SubTask 2.3: 修复 access.js 第 286 行分享文件夹 ZIP 下载文件名硬编码为 `share.zip`，改为使用实际文件夹名

- [x] Task 3: 修复 snap.html P2P 文件传输 Bug
  - [x] SubTask 3.1: 在 DataChannel onmessage 的 JSON.parse 外层添加 try/catch，防止单条畸形消息导致文件传输永久卡死
  - [x] SubTask 3.2: 修复同名文件追踪失败：所有文件状态更新函数（updateFileProgress、updateFileComplete、offerDownload）改用 data-fileId 而非 fname 文本匹配
  - [x] SubTask 3.3: 修复 copyShareLink 依赖已废弃的 window.event，改为通过 onclick 参数接收 event 对象
  - [x] SubTask 3.4: 修复 disconnected 状态被直接当作 error 处理，改为仅显示警告并保留连接，仅 failed 状态标记为 error

- [x] Task 4: 修复 admin.html 后台管理 Bug
  - [x] SubTask 4.1: 修复 doWhite/doBlock/doDelete 中使用 r.text() 读取 JSON 响应导致元数据被存为字符串，改为 r.json()
  - [x] SubTask 4.2: 修复 doWhite/doBlock/doDelete 中 row.name 未 URL 编码，对 URL 路径参数添加 encodeURIComponent
  - [x] SubTask 4.3: 修复 mp4 检测使用 indexOf('.mp4') > 0 的误判，改为检查文件扩展名

- [x] Task 5: 修复 netdisk.html 网盘前端 Bug
  - [x] SubTask 5.1: 修复 renderTable 中 data-path 属性未经过 escapeHtml 处理导致 XSS 风险，对所有 data-path 和 data-ct 属性值添加 escapeHtml
  - [x] SubTask 5.2: 修复 401 跳转死循环（跳转到 /netdisk 即当前页面），改为不跳转仅显示错误提示
  - [x] SubTask 5.3: 修复存储选择器显隐控制冲突：loadList() 用 style.display 而 fetch config 用 hidden 属性，统一为 style.display 控制
  - [x] SubTask 5.4: 修复 isPreviewable 中电子表格检测的冗余死代码 `['xlsx','ods','csv'].includes(ext) && ext !== 'csv'`
  - [x] SubTask 5.5: 修复站点名拼接冗余：`cfg.siteName || '网盘') + ' · 网盘'` 导致未配置时显示"网盘 · 网盘"

- [x] Task 6: 修复 index.html 和 share.html 前端 Bug
  - [x] SubTask 6.1: 修复 index.html 缩略图 onerror 未调用 URL.revokeObjectURL 导致内存泄漏
  - [x] SubTask 6.2: 修复 index.html 后台链接使用 /admin.html 而非 /admin（与其他页面不一致）
  - [x] SubTask 6.3: 修复 share.html 文本文件预览插入位置错误（被插入到 #body 最前面而非预览区域），修复 .preview-box 查找逻辑
  - [x] SubTask 6.4: 修复 share.html 视频预览扩展名列表缺少 mkv/ts/3gp，与 iconClass 不一致

- [x] Task 7: 修复配置和测试 Bug
  - [x] SubTask 7.1: 修复 package.json 中 start:r2 和 start:netdisk 的 --binding 语法错误（多个绑定应分别使用 --binding 而非空格分隔在一个 --binding 后）
  - [x] SubTask 7.2: 修复 mocha 不递归加载 test/netdisk/ 子目录测试，将 test 脚本改为 `mocha "test/**/*.test.js"` 以匹配子目录测试同时排除 e2e 脚本
  - [x] SubTask 7.3: 修复 file-proxy.test.js 中断言了错误的双斜杠 telegra.ph URL（`//file/`），更新为单斜杠 `/file/`
  - [x] SubTask 7.4: 运行全部测试验证所有修复

# Task Dependencies
- Task 7 (SubTask 7.3) 依赖 Task 1 (SubTask 1.4) — 测试断言需与源码修复保持一致
- Task 7 (SubTask 7.4) 依赖所有其他 Task 完成
- 其余 Task 之间无强依赖，可并行执行
