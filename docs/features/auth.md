# 임직원 인증 및 최초 인사 등록

## 확정된 사용자 흐름

카카오·Google·네이버 인증만 제공한다. 최초 인증 성공 후 사원명과 담당 부서를 입력한다. 일반 부서 선택과 직접 입력을 지원한다. 회사 소속은 별도 클랜 가입·초대 수락으로 결정한다. 미인증 상태는 접속 화면, 프로필 미완성 상태는 인사 등록 화면으로 안내한다.

현재 Vue 인증은 로컬 시연이며 실제 제공자와 연결하지 않는다. 동의·취소·실패·완료를 미리 체험한다. mock 시점 전환이나 모의 인증 완료 버튼은 실제 인증 구현에서 접근 권한을 부여하는 근거로 사용하지 않는다.

## Claude의 후속 구현 요구

제공자별 공식 문서의 지원 기능을 확인해 Authorization Code 흐름을 구현한다. 서버가 code 교환과 사용자 식별을 수행하고 제공자+불변 subject의 복합 유일키로 계정을 식별한다. 같은 이메일만으로 다른 제공자의 계정을 자동 병합하지 않는다.

state의 세션 바인딩·1회 소비·만료와 redirect URI allowlist를 적용한다. 제공자가 지원하는 경우 PKCE S256을 사용하고 OIDC 사용 시 nonce, 서명, issuer, audience, exp 검증을 수행한다. provider 응답에서 가져온 role이나 UI 입력을 회사 대표 권한으로 신뢰하지 않는다.

사용자는 JWT 인증 구현을 Claude에게 맡겼다. 제안은 짧은 수명의 access JWT와 회전·폐기 가능한 refresh session이다. 구체적인 수명과 보관 방식은 인증 구현 시 기록한다. 브라우저 인증은 HttpOnly/Secure/SameSite 쿠키를 기본 설계로 검토하고 CSRF·Origin 검증을 함께 적용한다. JWT 서명 알고리즘 allowlist와 서명·발급자·대상·만료를 서버에서 검사한다. 로그아웃 시 refresh session 폐기와 기존 access token의 남은 유효시간 정책을 명확히 정한다.

## 공격 대응과 UI

- 로그인 시도와 초대·채팅·게임·구매에 서버 요청 제한을 적용한다. AI 자동화 요청에도 동일한 권한·속도·입력 검증을 적용한다.
- 모든 REST·소켓 요청에서 인증, 프로필 완료, 자원 접근 권한을 검사한다. 버튼 숨김은 접근 제어의 근거가 아니다.
- 사용자 입력은 텍스트로 렌더링한다. 수식 입력은 허용된 게임 함수만 처리하고 eval이나 임의 코드 실행을 허용하지 않는다.
- 클라이언트 번들에 OAuth secret, JWT 서명키, DB·Redis 자격증명을 넣지 않는다.
- 동의 항목은 최소화하고 실제 요청 scope와 UI 설명을 일치시킨다. 현재 목업 동의 문구는 법적 약관 확정본이 아니다.
- 취소·실패·만료·재인증·권한 없음·요청 제한 상태를 제공한다. 오류에는 내부 스택·토큰·개인정보를 노출하지 않는다.

## 검증

위조·만료·재사용 state, 잘못된 provider/redirect, 변조 JWT, 폐기 refresh token, 권한 없는 소켓 구독, 타인 초대 수락, 프로필 미완료 접근을 테스트한다. 실제 제공자 자격증명이 없으면 모의 테스트와 실연동 미검증을 구분한다.

참고 기준은 OWASP OAuth2 및 Authentication Cheat Sheet이며 구현 시 각 제공자의 최신 공식 문서와 대조한다.

- https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

## 이메일·비밀번호 계정 (P1 구현, 2026-11-09)

사용자 요청으로 **이메일·비밀번호 가입/로그인**을 추가했다. 위 "카카오·Google·네이버만 제공" 문장과 달라지는 결정이다. 소셜 로그인은 별도 `external_identities`로 계속 연결할 수 있다. 같은 이메일로 소셜 계정과 자동 병합하지 않는 원칙은 유지한다. 비밀번호 재설정·이메일 인증·소셜 연동은 미구현이다.

## 보안 정책 (구현 기준)

| 항목 | 정책 | 위치 |
|---|---|---|
| 비밀번호 저장 | argon2id(Node 내장 `crypto.argon2`), m=19MiB·t=2·p=1, 16B salt, PHC 문자열. 파라미터가 바뀌면 다음 로그인에서 재해시. NFC 정규화 | `auth/password.ts`, `auth.policy.ts` |
| 비밀번호 규칙 | 10–128자, 구성 규칙 강제 없음, 공백만 불가 | `auth.policy.ts` |
| 이메일 | trim+소문자 정규화 후 UNIQUE | `auth.dto.ts` |
| Access token | JWT HS256, `typ: at+jwt`, iss/aud/exp/iat/sub/sid. 기본 10분(`ACCESS_TOKEN_TTL_SEC`). 서명키 `JWT_ACCESS_SECRET`(≥32자, env 주입) | `auth/token.service.ts` |
| Access 보관(브라우저) | **메모리 변수만**(localStorage·sessionStorage 금지). 새로고침 시 refresh로 재발급 | P4 프론트 |
| Refresh token | 256bit 무작위, DB에는 SHA-256만 저장. **HttpOnly** 쿠키 `oy_rt`(Secure 환경에서는 `__Secure-oy_rt`), `SameSite=Strict`, `Path=/api/v1/auth`. 본문으로는 내보내지 않음 | `auth.controller.ts` |
| 회전 | refresh 1회 사용 시 새 토큰을 발급하고 이전 토큰은 `ROTATED`. 유휴 만료 14일(`REFRESH_TOKEN_TTL_SEC`), 절대 만료 30일(`SESSION_ABSOLUTE_TTL_SEC`)은 회전으로 늘어나지 않음 | `auth.service.ts` |
| 재사용 탐지 | 이미 회전된 토큰이 오거나 같은 토큰이 동시에 회전되면 family 전체를 `REUSE_DETECTED`로 폐기 → 모든 관련 기기 재로그인 | 〃 |
| 로그아웃 | `logout`: 현재 family 폐기(멱등). `logout-all`: 사용자 전체. 남은 access token은 만료(최대 10분)까지 유효(stateless). 즉시 차단이 필요한 경로(WebSocket 연결 등)는 `isSessionFamilyActive`로 확인 | 〃 |
| CSRF | 쿠키 사용 엔드포인트(signup/login/refresh/logout/logout-all)는 `Origin`이 `WEB_ORIGIN`과 정확히 같아야 함(누락도 거부) + SameSite=Strict. 그 외 API는 Bearer 헤더 인증이라 CSRF 대상 아님 | `auth.guard.ts` `OriginGuard` |
| 요청 제한 | IP당 로그인 30/10분, 이메일당 로그인 실패 5/15분(성공 시 초기화), IP당 가입 10/시간, IP당 refresh 60/분. Redis 장애 시 **거부(503)** | `auth.policy.ts`, `redis/rate-limit.service.ts` |
| 계정 존재 비노출 | 없는 계정·틀린 비밀번호 모두 `INVALID_CREDENTIALS`, 없는 계정도 더미 해시 검증으로 시간 균일화. 단, 가입 시 `EMAIL_TAKEN`은 노출됨(이메일 인증 도입 시 재검토) | 〃 |
| 오류 응답 | `{error:{code,message,requestId,details?}}`. 프레임워크 원문 메시지·스택 비노출 | `common/http-exception.filter.ts` |
| 로그 | 경로·상태·requestId만. 본문·쿠키·토큰·쿼리 미기록 | `common/request-log.ts` |
| 운영 강제 | production에서 `COOKIE_SECURE=false`·플레이스홀더 비밀값이면 시작 거부. 프록시 뒤에서는 `TRUST_PROXY=true`(IP 기준 제한 정확도) | `config/env.ts` |

오류 코드: `AUTH_REQUIRED`, `TOKEN_EXPIRED`, `TOKEN_INVALID`(401, `WWW-Authenticate` 포함), `INVALID_CREDENTIALS`, `REFRESH_TOKEN_MISSING|INVALID|REUSED`, `SESSION_EXPIRED|REVOKED`(401), `ORIGIN_REJECTED`(403), `EMAIL_TAKEN`(409), `VALIDATION_FAILED`·`MALFORMED_REQUEST`(400), `PAYLOAD_TOO_LARGE`(413), `RATE_LIMITED`(429, `Retry-After`), `SERVICE_UNAVAILABLE`(503).

### 프론트(P4) 연동 규칙

- 앱 시작 시 `POST /auth/refresh`로 access token을 받는다(401이면 로그인 화면). 401 `TOKEN_EXPIRED`를 받으면 refresh 1회 후 원요청을 재시도한다.
- 탭 여러 개가 같은 refresh 쿠키를 동시에 회전하면 재사용으로 탐지되어 로그아웃된다. `navigator.locks.request('oy-refresh')`로 탭 간 refresh를 직렬화하고, 탭 안에서도 단일 진행(single-flight)으로 처리한다.
- 개발 시 Vite proxy로 `/api`를 3000번에 연결해 **동일 출처**를 유지한다(쿠키 SameSite=Strict, Path 범위).

### WebSocket 인증 구조 (P3에서 사용)

handshake `auth: { token: <access> }` → `TokenService.verifyAccess()`(HTTP 가드와 동일한 검증) → `AuthService.isSessionFamilyActive(sid)` → 연결 허용. access 만료 시각에 서버가 연결을 끊거나 클라이언트가 재인증 이벤트로 새 토큰을 보낸다(P3에서 확정). Origin 검사는 Socket.IO `allowRequest`에서 `WEB_ORIGIN`과 비교한다.
