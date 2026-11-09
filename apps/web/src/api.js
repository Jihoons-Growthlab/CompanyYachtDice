// 서버 API·실시간 연결. 보안 규칙: docs/features/auth.md "보안 정책"
// - access token 은 이 모듈의 메모리 변수에만 둔다(localStorage·sessionStorage 금지).
// - refresh token 은 HttpOnly 쿠키라 JS 가 읽지 않는다. 재발급은 탭 간 navigator.locks + 탭 내 single-flight 로 직렬화.
import { io } from 'socket.io-client'

const BASE = '/api/v1'
let accessToken = null
let refreshing = null

export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message ?? '요청을 처리하지 못했습니다.')
    this.status = status
    this.code = error?.code ?? 'NETWORK_ERROR'
    this.details = error?.details
  }
}

async function raw(method, path, body, token = accessToken) {
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: '서버에 연결할 수 없습니다.' })
  }
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, json?.error)
  return json?.data ?? null
}

/** 인증 요청: access 만료(401 TOKEN_EXPIRED 등)면 refresh 1회 후 재시도 */
export async function api(method, path, body) {
  try {
    return await raw(method, path, body)
  } catch (err) {
    if (err.status !== 401 || !['TOKEN_EXPIRED', 'TOKEN_INVALID', 'AUTH_REQUIRED'].includes(err.code)) throw err
    if (!(await refresh())) throw err
    return raw(method, path, body)
  }
}

/** refresh 쿠키로 access token 재발급. 실패하면 null(로그인 필요) */
export function refresh() {
  refreshing ??= (async () => {
    const run = async () => {
      try {
        const data = await raw('POST', '/auth/refresh', undefined, null)
        accessToken = data.accessToken
        return data.user
      } catch {
        accessToken = null
        return null
      }
    }
    try {
      return navigator.locks ? await navigator.locks.request('oy-refresh', run) : await run()
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function login(kind, payload) {
  const data = await raw('POST', kind === 'signup' ? '/auth/signup' : '/auth/login', payload, null)
  accessToken = data.accessToken
  return data.user
}

/** 테스트 계정 간편 로그인 — 개발 빌드 전용(운영 빌드에서는 null 로 치환되어 코드가 제거됨) */
export const devLogin = import.meta.env.DEV
  ? async (slot) => {
      const data = await raw('POST', '/dev/login', { slot }, null)
      accessToken = data.accessToken
      return data.user
    }
  : null

export async function logout() {
  try {
    await raw('POST', '/auth/logout', undefined, null)
  } finally {
    accessToken = null
    socket?.close()
    socket = null
  }
}

export const getToken = () => accessToken

/** 개발 테스트 모드 여부: 개발 빌드에서만 확인. 운영 빌드에서는 import.meta.env.DEV=false 로 코드가 제거된다. */
export async function devStatus() {
  if (!import.meta.env.DEV) return null
  try {
    return await raw('GET', '/dev/status', undefined, null)
  } catch {
    return null
  }
}

// ───────── 실시간 ─────────
let socket = null

/**
 * Socket.IO 연결. handlers: { status, room, match, messages(roomId, list), chat(message), lobby(), invite(invite) }
 * 재연결 시 subscribeRooms 를 다시 구독해 최신 스냅샷을 받는다(누락 이벤트 복구).
 */
export function connectRealtime(handlers, subscribeRooms) {
  socket?.close()
  socket = io({
    path: '/socket.io',
    transports: ['websocket'],
    auth: (cb) => cb({ token: accessToken }),
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  })
  socket.on('connect', async () => {
    handlers.status('connected')
    for (const roomId of subscribeRooms()) {
      const ack = await emit('room:subscribe', { roomId })
      if (ack.ok) {
        handlers.room(ack.data.room)
        if (ack.data.match) handlers.match(ack.data.match)
        handlers.messages?.(roomId, ack.data.messages ?? [])
      }
    }
  })
  socket.on('disconnect', () => handlers.status('disconnected'))
  socket.io.on('reconnect_attempt', () => handlers.status('reconnecting'))
  socket.on('connect_error', async (err) => {
    handlers.status('reconnecting')
    // access token 만료·무효 → refresh 후 재시도(socket.io 가 자동 재연결)
    if (['TOKEN_EXPIRED', 'TOKEN_INVALID', 'AUTH_REQUIRED', 'SESSION_REVOKED'].includes(err.message)) {
      if (!(await refresh())) handlers.status('auth-required')
    }
  })
  socket.on('room:state', handlers.room)
  socket.on('match:state', handlers.match)
  socket.on('chat:message', (m) => handlers.chat?.(m))
  socket.on('lobby:changed', () => handlers.lobby?.())
  socket.on('invite:received', (i) => handlers.invite?.(i))
  socket.on('invite:updated', (i) => handlers.invite?.(i))
  return socket
}

export function emit(event, body) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: { code: 'NOT_CONNECTED', message: '실시간 연결이 끊겼습니다.' } })
    socket.timeout(5000).emit(event, body, (err, ack) => resolve(err ? { ok: false, error: { code: 'TIMEOUT', message: '응답이 없습니다. 다시 시도해 주세요.' } } : ack))
  })
}

export const newCommandId = () => crypto.randomUUID()
export const wsConnected = () => !!socket?.connected
