# 全局 Bug 修复 Spec

## Why
经过全面代码审查，发现项目中存在多处安全漏洞、数据完整性问题、崩溃风险和逻辑错误。这些 Bug 涵盖前端页面、后端 API、工具函数、测试用例和配置文件，需要系统性修复。

## What Changes
- 修复分享密码哈希完全失效的安全漏洞（share-token.js 属性名不匹配）
- 修复文件夹重命名/WebDAV 移动时丢失 Content-Type 和自定义元数据的问题
- 修复 telegra.ph URL 双斜杠拼写错误
- 修复 snap.html 中 JSON.parse 无 try/catch 导致文件传输卡死
- 修复 snap.html 同名文件追踪失败（data-fileId 已设置但从未使用）
- 修复 admin.html 中 r.text() 误用导致元数据损坏为字符串
- 修复 admin.html 中 row.name 未 URL 编码导致 API 路径破坏
- 修复 netdisk.html 中 data-path 未 HTML 转义导致 XSS 风险
- 修复 telemetryData 中间件 finally 块崩溃风险
- 修复 upload.js 中间件函数直接调用方式错误
- 修复 delete.js 删除不存在文件返回误导性成功响应
- 修复 download.js 手动设置 Transfer-Encoding: chunked
- 修复 netdisk.html 401 跳转死循环
- 修复 netdisk.html 存储选择器显隐控制冲突
- 修复 share.html 文本预览插入位置错误
- 修复 snap.html copyShareLink 依赖已废弃的 window.event
- 修复 package.json 中 start:r2 / start:netdisk 的 --binding 语法错误
- 修复 mocha 未递归加载 test/netdisk/ 子目录测试
- 修复 file-proxy.test.js 断言了错误的双斜杠 URL（假阳性）
- 修复 netdisk.html 表格电子表格检测中的死代码
- 修复 netdisk.html 站点名拼接冗余
- 修复 index.html 缩略图 onerror 未释放 ObjectURL
- 修复 index.html 后台链接路径不一致（/admin.html vs /admin）
- 修复 share.html 视频预览扩展名与 iconClass 不一致

## Impact
- Affected code: functions/utils/share-token.js, functions/netdisk/api/rename.js, functions/netdisk/api/delete.js, functions/netdisk/api/download.js, functions/storage/telegram.js, functions/utils/middleware.js, functions/upload.js, functions/webdav/[[path]].js, functions/api/share/access.js, netdisk.html, index.html, share.html, snap.html, admin.html, package.json, test/file-proxy.test.js

## ADDED Requirements

### Requirement: 安全分享密码保护
分享链接设置密码时，系统 SHALL 正确对密码进行 SHA-256 哈希后存储，访问时 SHALL 正确验证密码哈希。

#### Scenario: 设置密码的分享需要密码访问
- **WHEN** 用户创建带密码的分享链接
- **THEN** 密码被正确哈希存储在分享元数据中
- **WHEN** 其他用户访问该分享时输入错误密码
- **THEN** 返回 401 未授权

### Requirement: 文件夹移动保留元数据
文件夹重命名或 WebDAV MOVE/COPY 时，系统 SHALL 保留每个文件的 Content-Type 和自定义元数据。

#### Scenario: 重命名包含图片的文件夹
- **WHEN** 用户重命名一个包含 image/png 文件的文件夹
- **THEN** 移动后的文件仍保持 Content-Type: image/png

### Requirement: 删除不存在文件返回 404
删除不存在的文件时，系统 SHALL 返回 404 而非成功响应。

#### Scenario: 删除不存在的文件
- **WHEN** 用户请求删除路径 nonexistent.txt（不存在）
- **THEN** 返回 404 Not Found

## MODIFIED Requirements

### Requirement: P2P 文件传输健壮性
P2P 文件传输 SHALL 能正确处理同名文件和非 JSON 消息，不崩溃。
- DataChannel onmessage 中的 JSON.parse 必须有 try/catch
- 文件进度追踪必须使用唯一 ID 而非文件名匹配

### Requirement: 后台管理 API 调用
后台管理页面的 API 调用 SHALL 正确解析 JSON 响应并对路径参数进行 URL 编码。

### Requirement: 网盘文件列表安全性
文件列表中的 data-path 属性 SHALL 经过 HTML 转义以防止 XSS。

### Requirement: Telegraph URL 格式
Telegraph 文件 URL SHALL 使用单斜杠格式 `https://telegra.ph/file/{fileId}`。

### Requirement: 测试配置
mocha SHALL 递归加载 test/ 目录下所有 .test.js 文件，但不加载非测试脚本。

## REMOVED Requirements

### Requirement: 回收站功能
**Reason**: 用户已要求移除回收站功能，相关文件已删除。
**Migration**: 已完成，删除操作改为直接物理删除。
