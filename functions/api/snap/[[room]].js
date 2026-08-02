import { jsonResponse, isEmptyBinding } from '../../utils/http.js';

// 快传信令 API —— 基于 KV 的 WebRTC 信令交换
//
// 存储设计（v2，修复 metadata 超限与竞态覆盖）：
//   snap:{code}            value: { status, offer, answer, createdAt }（JSON 存 value，
//                          避免 KV metadata 1024 字节上限 —— SDP 远超该限制）
//   snap:{code}:ice:caller value: [candidateJson, ...]（每侧独立 key，
//                          双方各写各的，杜绝 read-modify-write 互相覆盖）
//   snap:{code}:ice:callee value: 同上
// TTL: 300 秒（5 分钟），超时自动清理。
//
// 接口：
//   POST /api/snap              创建房间（提交 offer）
//   GET  /api/snap/:code        获取房间状态（offer / answer / ICE）
//   POST /api/snap/:code        更新房间（提交 answer 或 ICE candidate，支持批量数组）
//   DELETE /api/snap/:code      销毁房间（连同两侧 ICE key）

const SNAP_KEY_PREFIX = 'snap:';
const ROOM_TTL = 300; // 5 分钟
const CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnopqrstuvwxyz23456789';
const MAX_ICE_PER_SIDE = 50;
const MAX_SDP_LENGTH = 64 * 1024;   // SDP 正常 <10KB，留足余量防滥用
const MAX_ICE_BATCH = 20;           // 单次提交的 candidate 上限

function generateRoomCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

function roomKey(code) {
  return SNAP_KEY_PREFIX + code;
}

function iceKey(code, side) {
  return `${SNAP_KEY_PREFIX}${code}:ice:${side}`;
}

// 房间主体：value 存 JSON（25MB 上限，SDP 很安全）；metadata 只留小字段便于排查
async function getRoom(env, code) {
  if (!env.img_url) return null;
  const record = await env.img_url.getWithMetadata(roomKey(code), 'text');
  if (!record || record.value == null) return null;
  // 兼容 v1：早期版本把数据放在 metadata 里，value 为空串
  if (record.value === '') {
    return record.metadata && record.metadata.offer ? record.metadata : null;
  }
  try {
    return JSON.parse(record.value);
  } catch {
    return null;
  }
}

async function putRoom(env, code, room) {
  await env.img_url.put(roomKey(code), JSON.stringify(room), {
    metadata: { status: room.status, createdAt: room.createdAt },
    expirationTtl: ROOM_TTL,
  });
}

async function getIceList(env, code, side) {
  if (!env.img_url) return [];
  const raw = await env.img_url.get(iceKey(code, side), 'text');
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function appendIce(env, code, side, candidates) {
  const list = await getIceList(env, code, side);
  for (const c of candidates) {
    if (list.length >= MAX_ICE_PER_SIDE) break;
    list.push(c);
  }
  await env.img_url.put(iceKey(code, side), JSON.stringify(list), {
    expirationTtl: ROOM_TTL,
  });
}

async function deleteRoom(env, code) {
  const keys = [roomKey(code), iceKey(code, 'caller'), iceKey(code, 'callee')];
  await Promise.all(keys.map((k) => env.img_url.delete(k).catch(() => {})));
}

function validCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9]{6}$/.test(code);
}

// ---- POST /api/snap : 创建房间 ----
// ---- POST /api/snap/:code : 更新房间（提交 answer 或 ICE） ----
export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const pathSegments = url.pathname.split('/').filter(Boolean);
  const roomCode = pathSegments[pathSegments.length - 1];

  if (roomCode && roomCode !== 'snap') {
    return await updateRoom(context, roomCode);
  }

  if (isEmptyBinding(env.img_url)) {
    return jsonResponse({ error: 'KV storage not configured. 快传功能需要 KV 绑定。' }, { status: 500 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.offer || typeof body.offer !== 'string') {
    return jsonResponse({ error: 'Missing "offer" field' }, { status: 400 });
  }
  if (body.offer.length > MAX_SDP_LENGTH) {
    return jsonResponse({ error: 'Offer too large' }, { status: 413 });
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

  const room = {
    v: 2,
    status: 'waiting',
    offer: body.offer,
    answer: '',
    createdAt: Math.floor(Date.now() / 1000),
  };

  await putRoom(env, code, room);

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

  // v2 起 ICE 存独立 key；v1 老房间的 ICE 在 metadata 里
  let callerIce = room.callerIce || [];
  let calleeIce = room.calleeIce || [];
  if (room.v >= 2) {
    [callerIce, calleeIce] = await Promise.all([
      getIceList(env, roomCode, 'caller'),
      getIceList(env, roomCode, 'callee'),
    ]);
  }

  return jsonResponse({
    code: roomCode,
    status: room.status,
    offer: room.offer || '',
    answer: room.answer || '',
    callerIce,
    calleeIce,
    createdAt: room.createdAt,
  });
}

// ---- POST /api/snap/:code : 更新房间 ----
async function updateRoom(context, roomCode) {
  const { request, env } = context;

  if (!validCode(roomCode)) {
    return jsonResponse({ error: 'Invalid room code' }, { status: 400 });
  }

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

  let roomChanged = false;

  // 提交 answer
  if (body.answer && typeof body.answer === 'string') {
    if (body.answer.length > MAX_SDP_LENGTH) {
      return jsonResponse({ error: 'Answer too large' }, { status: 413 });
    }
    room.answer = body.answer;
    room.status = 'answered';
    roomChanged = true;
  }

  // 提交 ICE candidate（单个或批量数组）
  if (body.ice && body.side) {
    const side = body.side === 'caller' || body.side === 'callee' ? body.side : null;
    if (!side) {
      return jsonResponse({ error: 'Invalid side' }, { status: 400 });
    }
    const rawList = Array.isArray(body.ice) ? body.ice.slice(0, MAX_ICE_BATCH) : [body.ice];
    const candidates = rawList.map((c) => (typeof c === 'string' ? c : JSON.stringify(c)));
    await appendIce(env, roomCode, side, candidates);
  }

  if (roomChanged) {
    await putRoom(env, roomCode, room);
  }

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
