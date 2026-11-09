---
paths:
  - "apps/server/**"
---

# backend

- 먼저 `docs/architecture.md`를 읽는다.
- 인증된 사용자와 권한을 서버에서 검증하고 쓰기는 트랜잭션으로 처리한다.

## 현재 서버 상태 요약 (P1 인증 완료, 2026-11-09)

- 모든 라우트는 전역 `JwtAuthGuard`(Bearer 필수). 공개는 `@Public()`, 쿠키 사용 엔드포인트는 `@RequireOrigin()`. 사용자 주입은 `@CurrentUser()` → `{userId, sessionFamilyId}`.
- 오류는 `Errors.*`(`common/app-error.ts`)로 던진다. 입력은 zod + `parseInput()` → 400 `VALIDATION_FAILED`.
- 요청 제한은 `RateLimitService.consume(key, {limit, windowSec})`(Redis, 장애 시 503). 수치는 각 모듈 `*.policy.ts`에 둔다.
- 테스트: `npm test`(build → 테스트 DB `<db>_test` 준비 → `node --test` E2E). 새 모듈 테스트는 `test/*.test.mjs`, `startApp()`/`call()` 헬퍼 재사용. IP 제한 간섭은 `freshIp()`(X-Forwarded-For)로 피한다.
- 정책 문서: `docs/features/auth.md` "보안 정책". 엔드포인트: `docs/contracts/rest.md` "구현됨".

## 게임 서버 (2026-11-09)

- 방 변경은 `RoomsService.mutate`(방 행 FOR UPDATE), 게임 변경은 `MatchesService.mutate`(매치 행 FOR UPDATE + 영수증 + version) 안에서만 한다. 커밋 후 브로드캐스트와 타이머 재설정은 mutate가 처리한다.
- 규칙은 `packages/shared/engine.mjs`에만 둔다(서버·웹 공유). 서버는 `src/game/engine.ts`에서 다시 내보낸다. 정책 수치는 `game.policy.ts`.
- 순환 주입(forwardRef)은 `Ref<T>` 타입으로 감싼다(ESM TDZ 방지).
- 새 엔드포인트는 zod 스키마 + `ApiJsonBody`·`ApiData`·`ApiErrors`로 Swagger에 자동 반영한다.
- 테스트 모드 기능은 `src/dev/`에만 둔다(AppModule 조건부 등록). 운영 차단은 `test/modes.e2e`가 검증한다.
- `npm test`는 `tsc`로 빌드한다(`nest build`는 dist를 지워 실행 중인 dev 서버를 죽인다).
