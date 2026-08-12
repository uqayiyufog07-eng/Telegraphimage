# 图床 API 接口文档（/api/imgbed）

本仓库图床（`/imgbed`）的完整后端接口说明。所有 `/api/imgbed/*` 接口均受**所有者鉴权**保护：需携带有效的 `wb_owner` 登录 Cookie（网页登录态）或 HTTP Basic 凭证（`BASIC_USER`/`BASIC_PASS`），未登录返回 `401`。

> 说明：`POST /upload` 是公开/上传保护入口，`POST /api/imgbed/upload` 是走所有者鉴权的统一入口，两者底层共用同一套上传核心逻辑，返回结构一致。

---

## 接口总览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/imgbed/upload` | 上传文件（`multipart/form-data`） |
| GET  | `/api/imgbed/list` | 分页列出图床文件（按存储方式筛选） |
| GET  | `/api/imgbed/get?id=xxx` | 查询单个文件完整元数据 |
| POST | `/api/imgbed/rename` | 重命名文件 |
| POST | `/api/imgbed/like` | 收藏 / 取消收藏切换 |
| POST | `/api/imgbed/delete` | 删除文件记录 |

---

## 1. 上传文件

```
POST /api/imgbed/upload
Content-Type: multipart/form-data
```

- 文件字段：`file`（必填）
- 可选字段：`provider`（`telegram` 或 `r2`，覆盖默认存储后端）
- 行为与 `POST /upload` 一致：内容去重（重复内容秒传）、短链接（开启 `ENABLE_SHORT_URLS` 时）、超大文件自动走 R2。

**成功响应（200）：**

```json
[{ "src": "/file/AbC123" }]
```

**去重命中响应（200）：**

```json
[{ "src": "/file/xxx", "deduplicated": true }]
```

**失败响应（4xx/5xx）：**

```json
{ "error": "No file uploaded" }
```

**curl 示例：**

```bash
curl -u owner:password -F "file=@/path/to/image.png" https://your.domain/api/imgbed/upload
```

---

## 2. 分页列出文件

```
GET /api/imgbed/list?limit=100&cursor=xxx&provider=telegram
```

| 参数 | 说明 |
|------|------|
| `limit` | 每页条数（默认最大 1000） |
| `cursor` | 分页游标（响应中返回） |
| `provider` | 按存储方式过滤：`telegram` / `r2` / 空（全部） |

**响应（200）：**

```json
{
  "items": [
    {
      "id": "abc123def.png",
      "fileName": "cat.png",
      "fileSize": 1234,
      "provider": "telegram",
      "timeStamp": 1700000000000,
      "shortId": "AbC123",
      "liked": false
    }
  ],
  "cursor": null,
  "list_complete": true,
  "total": 1
}
```

---

## 3. 查询单个文件

```
GET /api/imgbed/get?id=abc123def.png
```

**响应（200）：**

```json
{
  "id": "abc123def.png",
  "fileName": "cat.png",
  "fileSize": 1234,
  "provider": "telegram",
  "timeStamp": 1700000000000,
  "shortId": "AbC123",
  "liked": false,
  "ListType": "None",
  "Label": "None",
  "src": "/file/AbC123"
}
```

**错误：** 未提供 `id` 或文件不存在 → `404`。

---

## 4. 重命名

```
POST /api/imgbed/rename
Content-Type: application/json

{ "id": "abc123def.png", "fileName": "new-name.png" }
```

**响应（200）：**

```json
{ "ok": true, "id": "abc123def.png", "fileName": "new-name.png" }
```

**错误：** 缺 `id` / 缺 `fileName` → `400`；文件不存在 → `404`。

---

## 5. 收藏 / 取消收藏

```
POST /api/imgbed/like
Content-Type: application/json

{ "id": "abc123def.png" }
```

- 不传 `liked` 时：切换当前值（取反）。
- 传 `liked` 时：按给定值设置（如 `{ "id": "...", "liked": true }`）。

**响应（200）：**

```json
{ "ok": true, "id": "abc123def.png", "liked": true }
```

**错误：** 缺 `id` → `400`；文件不存在 → `404`。

---

## 6. 删除文件

```
POST /api/imgbed/delete
Content-Type: application/json

{ "id": "abc123def.png" }
```

清理 KV 元数据、关联的去重记录与短链接映射；R2 文件同时删除存储桶对象，Telegram 文件仅清理 KV 记录（Telegram API 不支持删除已发送的 `file_id`）。

**响应（200）：**

```json
{ "ok": true, "id": "abc123def.png" }
```

---

## 鉴权与存储

- **鉴权**：所有 `/api/imgbed/*` 由根中间件保护，需所有者登录（`wb_owner` Cookie 或 BASIC）。
- **存储后端**：`provider` 字段标识文件存储位置（`telegram` / `r2`）；旧文件无该字段时按 id 前缀推断（`r2-` → R2，否则 → Telegram）。

## 前端联动

`/imgbed` 页面历史面板调用 `list`（列表）、`delete`（删除）、`rename`（重命名）、`like`（收藏）接口，上传成功后自动刷新历史列表。