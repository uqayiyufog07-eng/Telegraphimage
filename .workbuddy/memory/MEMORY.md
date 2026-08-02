# Telegraphimage 项目长期备忘

## 项目概况
- 基于 Cloudflare Pages + Pages Functions 的文件平台：图床（Telegram/R2 存储）、网盘（R2）、WebRTC 快传、局域网传输（LocalSend 兼容）
- 仓库：https://github.com/uqayiyufog07-eng/Telegraphimage （origin 已配置）
- 设计风格：Neubrutalism（assets/theme.css 设计令牌：粗黑边 3px、硬阴影、波普色 --c-yellow/--c-teal/--c-coral 等），新页面须复用该主题
- 路由：静态 HTML 自动映射无扩展名 URL（imgbed.html→/imgbed）；/netdisk、/snap 有 functions 包装

## 页面地图（2026-08-02 重构后）
- `/` 产品落地页（三核心功能卡片 + 特性 + 更多工具）
- `/imgbed` 图床上传（原 index 首页）
- `/netdisk` 网盘（需 img_r2）
- `/snap` WebRTC P2P 快传
- `/localsend` 局域网传输（LocalSend 协议 v2）
- `/admin` 管理后台（BASIC_USER/BASIC_PASS 鉴权）

## 关键约定
- `/api/config` 下发站点配置（siteName/netdiskEnabled/showAdminEntry/storage 等），各页面据此隐藏入口
- `/api/lan/relay` 局域网中继：仅私有网段目标，防开放代理；云端部署时不可达内网属预期降级
- 测试：`npm test`（mocha 单测）、`npm run test:e2e`（首页+上传，需 wrangler --binding SITE_NAME="E2E Test Host" STORAGE_PROVIDER=r2）、`npm run test:e2e:lan`（局域网收发）
- wrangler 不读 shell 环境变量，绑定必须走 --binding 参数
