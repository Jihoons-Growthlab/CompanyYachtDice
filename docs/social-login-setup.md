# 소셜 로그인 설정 (Google · 카카오 · 네이버)

서버 구현: `apps/server/src/oauth/`. 흐름·보안 정책: `features/auth.md`. **실제 공급자 연동은 자격 증명이 없어 아직 검증하지 않았다.** 자동 테스트는 가짜 공급자 서버로 서버 쪽 검증 로직(state·PKCE·ID 토큰·취소·오류)만 확인한다.

## 1. 공통

| 항목 | 값 |
|---|---|
| Redirect URI | `{OAUTH_REDIRECT_BASE_URL}/api/v1/auth/{google\|kakao\|naver}/callback` |
| 개발 예 | `http://localhost:5173/api/v1/auth/google/callback` (Vite 프록시 → API) |
| 운영 예 | `https://<도메인>/api/v1/auth/google/callback` (HTTPS 필수) |
| 로그인 후 이동 | `WEB_APP_URL`(기본 `WEB_ORIGIN`) + `?auth=success` 또는 `?auth=error&reason=…` |
| 비밀값 위치 | `apps/server/.env`(git 제외) 또는 운영 Secrets Manager/SSM. **코드·문서·채팅에 붙여 넣지 않는다** |

- `OAUTH_REDIRECT_BASE_URL`과 `WEB_APP_URL`은 브라우저가 실제로 여는 웹 주소와 같아야 한다. 그래야 쿠키가 같은 출처에 저장된다. Vite가 5173이 아닌 포트(예: 5189)로 떴다면 두 값을 그 주소로 바꾸고, 콘솔의 Redirect URI도 같은 값으로 맞춘다.
- 값이 비어 있는 공급자는 비활성이다. 로그인 화면 버튼에는 "설정 필요"가 표시된다(`GET /api/v1/auth/providers`).
- 설정 후 `npm run dev`를 다시 시작한다(env는 시작할 때 읽음).

## 2. Google (OpenID Connect)

1. Google Cloud Console → 프로젝트 생성 → **OAuth 동의 화면** 설정. 개발 중에는 테스트 사용자를 등록한다.
2. **사용자 인증 정보 → OAuth 클라이언트 ID** → 유형 *웹 애플리케이션* → **승인된 리디렉션 URI**에 위 Redirect URI를 등록한다.
3. `.env`에 다음을 넣는다.
   ```
   GOOGLE_CLIENT_ID=<클라이언트 ID>
   GOOGLE_CLIENT_SECRET=<클라이언트 보안 비밀번호>
   ```
- 요청 scope는 `openid` 하나뿐이다(식별자 sub만 사용, 이메일·프로필 미요청).
- 서버 검증 항목: PKCE S256, nonce, ID 토큰 서명(Google JWKS), `iss`(accounts.google.com), `aud`(클라이언트 ID), `exp`.
- 공식 문서: https://developers.google.com/identity/openid-connect/openid-connect

## 3. 카카오

1. Kakao Developers → 내 애플리케이션 → 앱 생성.
2. **앱 키 → REST API 키**를 `KAKAO_CLIENT_ID`로 쓴다.
3. **카카오 로그인 → 활성화 ON** → **Redirect URI**에 위 주소를 등록한다.
4. (선택) **보안 → Client Secret** 활성화 시 `KAKAO_CLIENT_SECRET`에 넣는다. 활성화했다면 반드시 넣어야 한다.
5. 동의 항목은 추가하지 않아도 된다. 회원번호(id)만 사용한다.
   ```
   KAKAO_CLIENT_ID=<REST API 키>
   KAKAO_CLIENT_SECRET=<선택>
   ```
- 사용자 정보는 `GET https://kapi.kakao.com/v2/user/me`의 `id`를 쓴다.
- 서버는 PKCE(S256) 파라미터를 함께 보낸다. **카카오의 PKCE 지원 여부는 공식 문서로 확인이 필요하다(미검증).** 지원하지 않으면 무시되는 파라미터라 동작에는 영향이 없어야 하지만, 실연동 시 확인한다.
- 공식 문서: https://developers.kakao.com/docs/latest/ko/kakaologin/rest-api

## 4. 네이버

1. NAVER Developers → Application 등록 → 사용 API **네이버 로그인**.
2. 제공 정보는 콘솔이 요구하는 최소 항목만 선택한다. 서버는 `id`만 사용한다.
3. 로그인 오픈 API 서비스 환경 → **PC 웹** → 서비스 URL과 **Callback URL**(위 Redirect URI)을 등록한다.
4. Client ID와 Client Secret을 `.env`에 넣는다.
   ```
   NAVER_CLIENT_ID=<Client ID>
   NAVER_CLIENT_SECRET=<Client Secret>
   ```
- 네이버 로그인은 PKCE를 지원하지 않는다. state 1회 소비와 브라우저 바인딩 쿠키로 보호한다.
- 개발 중 앱 상태에서는 등록한 테스트 ID만 로그인할 수 있다(콘솔 → 멤버관리).
- 공식 문서: https://developers.naver.com/docs/login/devguide/devguide.md

## 5. 확인 순서 (실제 자격 증명 입력 후)

1. `curl -s localhost:3000/api/v1/auth/providers`에서 해당 공급자가 `enabled:true`인지 확인한다.
2. 웹 로그인 화면에서 버튼 클릭 → 공급자 동의 → 웹으로 돌아오는지 확인한다. 최초 로그인은 인사 등록, 기존 회원은 로비로 간다.
3. 공급자 화면에서 **취소**하면 로그인 화면에 "인증을 취소했습니다"가 표시되는지 확인한다.
4. 같은 계정으로 다시 로그인하면 같은 사용자(인사 정보 유지)인지 확인한다.

| reason | 의미 |
|---|---|
| CANCELLED | 사용자가 공급자 화면에서 취소 |
| STATE_INVALID | state 만료(10분)·재사용·다른 브라우저 |
| PROVIDER_ERROR | 토큰 교환·ID 토큰 검증·사용자 정보 조회 실패(서버 로그에 상세, 비밀값 제외) |
| NOT_CONFIGURED | Client ID 등 미설정 |
| RATE_LIMITED / SERVICE_UNAVAILABLE | 요청 과다 / Redis 장애 |
