import { jsonResponse, isEmptyBinding } from '../../utils/http.js';

// 快传信令 API —— 基于 KV 的 WebRTC 信令交换
//
// 房间数据存储在 KV key "snap:{code}" 的 metadata 中：
//   { status, offer, answer, callerIce: [], calleeIce: [], createdAt }
// TTL: 300 秒（5 分钟），超时自动清理。
//
// 接口：
//   POST /api/snap              创建房间（提交 offer）
//   GET  /api/snap/:code        获取房间状态（offer / answer / ICE）
//   POST /api/snap/:code        更新房间（提交 answer 或 ICE candidate）
//   DELETE /api/snap/:code      销毁房间

const SNAP_KEY_PREFIX = 'snap:';
const ROOM_TTL = 300; // 5 分钟
const CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnopqrstuvwxyz23456789';
const MAX_ICE_PER_SIDE = 50;

function generateRoomCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

function snapKey(code) {
  return SNAP_KEY_PREFIX + code;
}

async function getRoom(env, code) {
  if (!env.img_url) return null;
  const record = await env.img_url.getWithMetadata(snapKey(code));
  return record?.metadata || null;
}

async function putRoom(env, code, metadata) {
  await env.img_url.put(snapKey(code), '', {
    metadata,
    expirationTtl: ROOM_TTL,
  });
}

async function deleteRoom(env, code) {
  try {
    await env.img_url.delete(snapKey(code));
  } catch {}
}

// ---- POST /api/snap : 创建房间 ----
export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // POST /api/snap/:code : 更新房间（提交 answer 或 ICE）
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const roomCode = pathSegments[pathSegments.length - 1];

  if (roomCode && roomCode !== 'snap') {
    return await updateRoom(context, roomCode);
  }

  // POST /api/snap : 创建新房间
  if (isEmptyBinding(env.img_url)) {
    return jsonResponse({ error: 'KV storage not configured. 快传功能需要 KV 绑定。' }, { status: 500 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.offer) {
    return jsonResponse({ error: 'Missing "offer" field' }, { status: 400 });
  }

  // 生成唯一房间码（重试防碰撞）
  let code = '';
  for (let i = 0; i < 10; i++) {
    const candidate = generateRoomCode();
    const existing = await getRoom(env, candidate);
    if (!existing) {
      code = candidate;
      break;
    }
  }
  if (!code) {
    return jsonResponse({ error: 'Failed to allocate room code' }, { status: 500 });
  }

  const metadata = {
    status: 'waiting',
    offer: String(body.offer),
    answer: '',
    callerIce: [],
    calleeIce: [],
    createdAt: Math.floor(Date.now() / 1000),
  };

  await putRoom(env, code, metadata);

  return jsonResponse({
    code,
    status: 'waiting',
    ttl: ROOM_TTL,
  });
}

// ---- GET /api/snap/:code : 获取房间状态 ----
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const roomCode = pathSegments[pathSegments.length - 1];

  if (!roomCode || roomCode === 'snap') {
    return jsonResponse({ error: 'Missing room code' }, { status: 400 });
  }

  const room = await getRoom(env, roomCode);
  if (!room) {
    return jsonResponse({ error: 'Room not found or expired', code: roomCode }, { status: 404 });
  }

  const sinceParam = url.searchParams.get('since');
  const since = sinceParam ? parseInt(sinceParam, 10) || 0 : 0;

  // 返回房间状态和 ICE 候选（支持增量轮询）
  return jsonResponse({
    code: roomCode,
    status: room.status,
    offer: room.offer || '',
    answer: room.answer || '',
    callerIce: room.callerIce || [],
    calleeIce: room.calleeIce || [],
    createdAt: room.createdAt,
  });
}

// ---- POST /api/snap/:code : 更新房间 ----
async function updateRoom(context, roomCode) {
  const { request, env } = context;

  const room = await getRoom(env, roomCode);
  if (!room) {
    return jsonResponse({ error: 'Room not found or expired' }, { status: 404 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // 提交 answer
  if (body.answer) {
    room.answer = String(body.answer);
    room.status = 'answered';
  }

  // 提交 ICE candidate
  if (body.ice && body.side) {
    const candidate = typeof body.ice === 'string' ? body.ice : JSON.stringify(body.ice);
    if (body.side === 'caller' && room.callerIce.length < MAX_ICE_PER_SIDE) {
      room.callerIce.push(candidate);
    } else if (body.side === 'callee' && room.calleeIce.length < MAX_ICE_PER_SIDE) {
      room.calleeIce.push(candidate);
    }
  }

  await putRoom(env, roomCode, room);

  return jsonResponse({ ok: true, status: room.status });
}

// ---- DELETE /api/snap/:code : 销毁房间 ----
export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const roomCode = pathSegments[pathSegments.length - 1];

  if (!roomCode || roomCode === 'snap') {
    return jsonResponse({ error: 'Missing room code' }, { status: 400 });
  }

  await deleteRoom(env, roomCode);
  return jsonResponse({ ok: true });
}
