# REST v1

기본 경로 `/api/v1`. JSON, 세션 쿠키, 쓰기는 Origin 검증. 성공 응답은 `{data: ...}`, 실패는 `{error:{code,message,requestId,details?}}`. 일반 상태 코드는 400(형식), 401(세션), 403(권한), 404(리소스), 409(경쟁·충돌), 429(요청 제한). 날짜는 ISO 8601 UTC. 목록은 opaque cursor를 사용한다. 방 ID와 초대 코드는 별도 값이다.

| 메서드·경로 | 입력 | 성공 data |
|---|---|---|
| GET /auth/:provider/start | provider는 kakao/google/naver allowlist | 인증 제공자로 redirect |
| GET /auth/:provider/callback | provider별 code/state 또는 error | 서버 검증 후 허용된 앱 경로로 redirect 및 세션 설정 |
| POST /auth/refresh | refresh 쿠키 | 새 인증 쿠키 |
| POST /auth/logout | 인증 쿠키 | 세션 폐기 |
| PUT /me/profile | {nickname,departmentLabel} | 프로필 및 완료 여부 |
| GET /me | — | user |
| GET /rooms | cursor?,limit? | {items:[{id,name,capacity,count}],nextCursor} |
| POST /rooms | {name,capacity,visibility} | 201 RoomSnapshot + inviteCode |
| POST /rooms/:id/join | {inviteCode?} | RoomSnapshot |
| POST /rooms/:id/leave | — | {left:true} |
| GET /rooms/:id | — | RoomSnapshot |
| GET /matches/:id | — | MatchSnapshot |
| GET /rooms/:id/messages | beforeSeq? 또는 afterSeq?, limit? | {items:[Message],hasMore} |
| POST /companies | {name} | 201 {id,name} |
| POST /companies/:id/departments | {name} | 201 {id,name,companyId} |
| POST /companies/:id/invites | {targetUserId} | 201 {id,expiresAt} |
| POST /invites/:id/accept | — | membership |
| PATCH /companies/:id/members/:userId | {departmentId? 또는 role?} | membership |
| POST /companies/:id/transfer | {targetUserId} | {ownerId} |
| DELETE /companies/:id/members/me | — | {left:true} |
| GET /me/wallet | — | {balance} |
| GET /shop/items | cursor?,limit? | {items:[{sku,name,price}],nextCursor} |
| POST /shop/orders | Idempotency-Key 헤더 + {sku,expectedPrice} | {orderId,sku,charged,balance} |
| GET /me/inventory | cursor?,limit? | {items:[{sku}],nextCursor} |
| GET /me/titles | — | {items:[{id,name}],equippedTitleId,grade} |
| PUT /me/title | {titleId 또는 null} | {equippedTitleId} |
| GET /me/office | — | {revision,layout,avatar} |
| PUT /me/office | {revision,layout,avatar} | 새 {revision,layout,avatar} |

RoomSnapshot, MatchSnapshot, Message는 소켓 명세와 공유한다. 방의 세부 상태·메시지·매치는 멤버만 조회한다. 메시지는 오름차순이며 beforeSeq는 경계 직전 페이지, afterSeq는 경계 직후 페이지다. 구매 예시 요청은 `{"sku":"plant-01","expectedPrice":40}`, 잔액 부족 응답 코드는 INSUFFICIENT_FUNDS(409)다. 사무실 버전 충돌은 STALE_VERSION(409)이다.


## 후속 계약 초안

회사 조회 GET /companies?q=&cursor=, 랭킹 GET /companies/ranking, 가입 신청 POST /companies/:id/requests, 대표 승인·반려 POST /companies/:id/requests/:requestId/decision {accept}, 내 초대 GET /me/invites, 회사 초대 거절 POST /invites/:id/decline을 추가한다.

게임 초대는 POST /rooms/:id/invites {targetUserId}, GET /me/room-invites, POST /room-invites/:id/accept 또는 /decline으로 구분한다. 정원 변경 PATCH /rooms/:id {capacity}는 WAITING 상태의 PL만 허용한다. 인증 취소는 안전한 앱 경로로 이동하고 code/token을 URL에 남기지 않는다.

경로와 응답 스키마 상세는 해당 기능 구현 직전에 확정한다. 이번 인프라 작업에서는 health 경로만 구현한다.


## 구현됨 (P1 인증, 2026-11-09)

| 메서드·경로 | 인증 | 입력 | 성공 |
|---|---|---|---|
| POST /auth/signup | Origin | {email,password} | 201 {accessToken,tokenType,expiresIn,user} + refresh 쿠키 |
| POST /auth/login | Origin | {email,password} | 200 동일 |
| POST /auth/refresh | Origin + refresh 쿠키 | — | 200 동일(쿠키 회전) |
| POST /auth/logout | Origin + 쿠키(선택) | — | 204, 쿠키 삭제 |
| POST /auth/logout-all | Origin + Bearer | — | 200 {revokedSessions} |
| GET /me | Bearer | — | user |
| PUT /me/profile | Bearer | {nickname 1–24, departmentLabel 1–30} | user |

user = {id,email,nickname,departmentLabel,profileCompleted,createdAt}. health(`/health/live`, `/health/ready`)는 `/api/v1` 접두사 없이 공개. 정책·오류 코드는 features/auth.md "보안 정책". 소셜 provider 경로는 아직 미구현.


## 구현됨 (게임방·게임·소셜·테스트 모드, 2026-11-09)

전체 스키마와 예시는 실행 중인 서버의 **Swagger UI `/docs`**(OpenAPI JSON `/docs/json`)가 기준이다. 이 표는 요약이다.

| 메서드·경로 | 요약 |
|---|---|
| GET /auth/providers | 소셜 공급자 활성 여부 |
| GET /auth/:provider/start · /callback | 브라우저 리다이렉트 흐름(google·kakao·naver). 결과는 `WEB_APP_URL?auth=success\|error&reason=` |
| GET /rooms | WAITING 방 목록 {items:[{id,name,capacity,count,turnTimeLimitSec,ownerNickname,isTest}]} |
| POST /rooms | {name,capacity 2–6,turnTimeLimitSec 10/15/30/60} → 201 RoomSnapshot |
| GET /rooms/:id | RoomSnapshot(참여자만) |
| PATCH /rooms/:id | 방장·WAITING: {capacity?,turnTimeLimitSec?} |
| POST /rooms/:id/join · /leave · /ready {ready} · /start | 입장·퇴장(위임/닫힘/진행 중 AWAY)·준비·시작(중복 시작 시 기존 게임 반환) |
| GET /matches/:id | MatchSnapshot |
| POST /matches/:id/commands | {commandId,expectedVersion,type:ROLL\|HOLD\|SCORE,held?,category?} |
| POST /matches/:id/mode | {mode:AUTO\|MANUAL} |
| /dev/* | TEST_MODE 전용(운영에서는 경로 없음): status·accounts·login·rooms·bots·members·ready-all·force-start·matches/:id/finish·reset |

RoomSnapshot(구현): {id,name,status,capacity,turnTimeLimitSec,ownerId,isTest,matchId,members:[{userId,nickname,departmentLabel,rankLabel,ready,isOwner,isBot,online,joinedAt}],start:{canStart,blockers[],minPlayers}}.
MatchSnapshot(구현): 위 초안에 turnTimeLimitSec, serverTime, maxRolls, totalRounds, previews, players[].{isBot,seat,playMode,upper,bonus}를 더했다. 그 외 초안 경로(초대·회사·상점·칭호·사무실·메시지)는 미구현이다.

추가(2026-11-09): GET rooms/current, POST rooms/:id/join {code?}, POST·DELETE rooms/:id/bots, POST rooms/:id/invites, GET·POST rooms/:id/messages, GET users/search, GET me/room-invites, POST room-invites/:id/accept·decline. 목록 항목에 status·isPrivate·botsAllowed. 요약은 docs/development-status.md §4.

추가(2026-11-09, 환경 설정): `GET /me/preferences` → {uiMode EXCEL|CMD, uiScale SMALL|NORMAL|LARGE, effectSpeed FAST|NORMAL|SLOW, reducedMotion, diceAnimation, turnNotification, soundEnabled, soundVolume 0–100, ribbonCollapsed, saved, updatedAt}(저장 전에는 기본값과 saved=false). `PATCH /me/preferences`는 위 항목의 부분 수정이며 알 수 없는 키·범위 밖 값은 400 VALIDATION_FAILED. 본인만 조회·수정할 수 있다(경로에 사용자 ID 없음). 정책: features/settings.md.
