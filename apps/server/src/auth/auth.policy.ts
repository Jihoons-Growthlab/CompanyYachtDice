/**
 * 인증 정책 값 모음. 명세에 확정되지 않은 수치는 여기서만 바꾼다(docs/features/auth.md "보안 정책").
 * 토큰 수명은 env(ACCESS_TOKEN_TTL_SEC 등)로 조정한다.
 */
export const AuthPolicy = {
  password: {
    minLength: 10, // OWASP: MFA 없으면 장문 권장 → 10자 하한(구성 규칙 강제 없음)
    maxLength: 128, // 해시 DoS 방지 상한
  },
  /** argon2id. OWASP 최소 권장(m=19MiB,t=2,p=1). 변경 시 다음 로그인에서 자동 재해시. */
  argon2: { memoryKiB: 19_456, passes: 2, parallelism: 1, tagLength: 32, saltLength: 16 },
  rateLimit: {
    /** IP 기준 로그인 시도 */
    loginPerIp: { limit: 30, windowSec: 10 * 60 },
    /** 이메일 기준 로그인 실패(성공 시 초기화) */
    loginFailuresPerEmail: { limit: 5, windowSec: 15 * 60 },
    signupPerIp: { limit: 10, windowSec: 60 * 60 },
    refreshPerIp: { limit: 60, windowSec: 60 },
  },
  cookie: {
    /** Secure 일 때 __Secure- 접두사(브라우저가 Secure 없이 설정 못 하게 강제) */
    name: (secure: boolean) => (secure ? '__Secure-oy_rt' : 'oy_rt'),
    /** refresh·logout 경로에만 전송되도록 범위 축소 */
    path: '/api/v1/auth',
    sameSite: 'strict' as const,
  },
  userAgentMaxLength: 256,
} as const;
