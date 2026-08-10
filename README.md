# 老钱303的云上空间

私有化单用户云上空间，基于 Cloudflare Pages 部署。包含图床、网盘、WebDAV、快传、局域网传输等功能，仅所有者可用。

## 功能

- **图床**：拖拽/粘贴批量上传，支持 URL/Markdown/BBCode/HTML 格式复制；图床历史面板可查看、删除、复制链接，按存储方式（Telegram/R2）筛选
- **网盘**：基于 Cloudflare R2 的文件管理，支持文件夹、预览、分享链接
- **WebDAV**：标准 WebDAV 协议接入，可挂载为本地磁盘
- **快传**：基于 WebRTC 的点对点文件传输
- **局域网传输**：局域网设备发现与文件中继
- **分享链接**：`/file/:id`、`/share/:token` 保持公开访问，可分享给他人

## 鉴权方式

全站采用**单一密码登录**（HMAC 签名 Cookie，无状态，不依赖 KV 会话存储）：

- 未登录时所有页面（除公开白名单外）跳转到 `/auth` 登录页
- 登录后写入 `wb_owner` 签名 Cookie
- 分享链接 `/file/:id`、`/share/:token` 保持公开

## 环境变量

### 必需（图床存储）

| 变量 | 说明 |
|------|------|
| `TG_Bot_Token` | Telegram Bot Token |
| `TG_Chat_ID` | Telegram 频道 ID（Bot 需为管理员） |

或使用 R2 存储（二选一）：

| 变量 | 说明 |
|------|------|
| `STORAGE_PROVIDER` | 设为 `r2` |
| `img_r2` | R2 存储桶绑定 |

### 鉴权

| 变量 | 说明 |
|------|------|
| `OWNER_PASSWORD` | 所有者登录密码（优先使用） |
| `BASIC_PASS` | 回退密码（未设 OWNER_PASSWORD 时使用） |
| `BASIC_USER` | API/WebDAV Basic Auth 用户名 |
| `WEBDAV_USER` / `WEBDAV_PASS` | WebDAV 专用凭证（未设时回退 BASIC_USER/PASS） |

### 可选

| 变量 | 说明 |
|------|------|
| `ENABLE_SHORT_URLS` | `true` 启用短链接 |
| `SHORT_URL_LENGTH` | 短链接长度（4-16，默认 6） |
| `SITE_NAME` | 站点名称 |
| `SITE_TITLE` | 浏览器标签标题 |
| `SITE_BACKGROUND` | 背景图片 URL |
| `ALLOWED_REFERERS` | 防盗链白名单（逗号分隔域名） |
| `MODERATION_PROVIDER` | 图片审核：`cloudflare-ai`/`moderatecontent`/`none` |
| `disable_telemetry` | `true` 禁用遥测 |

### 绑定

| 类型 | 变量名 | 说明 |
|------|--------|------|
| KV | `img_url` | 文件元数据、短链接、去重记录 |
| R2 | `img_r2` | R2 存储（网盘和 R2 图床需要） |
| Workers AI | `AI` | 图片审核（cloudflare-ai provider） |

## API

### 图床历史

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/imgbed/list` | 列出图床文件（支持 `?provider=r2\|telegram`、`?cursor=` 分页） |
| POST | `/api/imgbed/delete` | 删除文件（body: `{"id":"..."}`），清理 KV + R2 + 去重 + 短链接 |

### 鉴权

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录（body: `{"password":"..."}`） |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 查询登录状态 |

### 上传

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/upload` | 上传文件（multipart/form-data，字段名 `file`） |

## 本地开发

```bash
npm install
npm test       # 运行单元测试
npm start      # 启动本地开发服务器（wrangler pages dev）
```

## 部署

1. Fork 本仓库
2. 在 Cloudflare Pages 中连接 Git 仓库
3. 构建命令留空，构建输出目录设为 `/`
4. 配置环境变量和绑定
5. 部署完成后访问域名，输入密码登录

> 推送代码到 GitHub 后 Cloudflare Pages 会自动触发部署。
