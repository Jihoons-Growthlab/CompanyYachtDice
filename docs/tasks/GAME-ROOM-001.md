# GAME-ROOM-001 · 게임 방 기능 개선 분석·설계 (승인 대기)

2026-11-09, Claude. 범위: ROOM-001, GAME-001, CHAT-001, CHAT-002, COMPANY-001, DICE-001.
**이 문서는 설계까지만 다룬다. 사용자 승인 전에는 기능 코드와 Prisma 스키마를 바꾸지 않는다.** 파일 위치는 `docs/codemap.md`에 있다.

## 0. 전제: 현재 구현 상태

- 서버에는 health만 있다. 인증·방·매치·소켓·채팅 서버는 아직 없다(phases P1–P3 미착수).
- 게임은 `apps/web/src/App.vue`의 로컬 상태로만 돈다. 주사위는 `Math.random`, 상대는 봇, 타이머는 없다.
- `packages/shared`에는 점수 함수만 있다. 턴 상태 전이와 RNG 주입은 없다.
- 그래서 "서버 검증"이 필요한 요구(ROOM-001, GAME-001, CHAT-002 권한, COMPANY-001)는 **P1 순수 엔진 → P2 방·매치 서버가 먼저 있어야** 구현할 수 있다. 목업 UI는 먼저 만들 수 있다.

## 1. 기능별 상태와 개선 방향

| ID | 현재 | 재사용할 것 | 개선 방향 |
|---|---|---|---|
| ROOM-001 턴 제한시간 | 없음. `yacht.md`는 "턴 기한 60초"로 고정 | `EvaluationRoom.vue`의 정원 select(PL만 변경, `:disabled="!leader"`) 패턴 | 방 설정 `turnTimeLimitSec ∈ {10,15,30,60}`. 대기실(WAITING)에서 PL만 변경, 세그먼트 버튼. **시작 시 매치에 복사**해 진행 중 변경의 영향을 막는다. 서버가 `deadline_at = turn_start + limit`을 계산 |
| GAME-001 수동/오토 | 봇 로직이 `App.vue` `record()` 안에 섞여 있음(굴림 없이 최고점 칸 선택). `yacht.md`에 기한 초과 자동 처리 초안 있음 | `scoresFor`, 기존 기한 초과 규칙 초안 | 자동 플레이 전략을 **순수 함수**(`packages/shared/autoplay.mjs`: `chooseHold`, `chooseCategory`, RNG 주입)로 분리한다. 서버는 오토 턴도 일반 명령과 같은 경로(잠금→검증→전이→영수증→커밋→브로드캐스트)로 실행한다. 자리 비움 판정과 복귀는 서버의 `PlayModePolicy`로 분리한다(§4) |
| CHAT-001 메신저 UI | `<aside>` "검토 의견", 작성자 "나" 고정, 높이 제한 없음 | `chat.md` 계약(seq, clientMessageId, 300자, 텍스트 렌더링) | `RoomChat.vue`로 분리. 말풍선(내 메시지 오른쪽), `닉네임 · 직급 · 시각` 헤더, 패널 내부 스크롤(`overflow-y:auto`, 고정 높이), 맨 아래에 있을 때만 자동 스크롤하고 아니면 "새 메시지" 표시. `Message` DTO에 `senderRank` 추가 |
| CHAT-002 직급 이모지 | 없음. 직급 데이터 없음(헤더 "사원" 문자열) | `organization.md` 직급 = 완주 횟수 기반 표시용(사원/주임/대리 초안) | 마스터 `ranks`, `emojis`, `emoji_rank_permissions`. 메시지 `kind=EMOJI`. 송신 시 서버가 직급 권한을 검사하고 일반 채팅과 같은 rate limit을 적용한다. 렌더링은 채팅 리스트 안에서만 한다. 초기 샘플은 CSS keyframe 애니메이션(파일 없음)이고, 이후 `asset_url`(S3) |
| COMPANY-001 회사 능력 | `CompanyDirectory.vue` `stages`(스타트업·중소·중견·대기업, 승격 비용)만 있고 능력은 없음 | 기업 단계 개념 | `company_tiers` 마스터에서 `tier_abilities`를 거쳐 `abilities`로 연결. 효과는 `effect_type` + `params JSONB`. 매치 시작 시 플레이어별 능력을 **스냅샷**한다. `match_ability_uses` UNIQUE로 게임당 1회를 강제한다. 효과 구현은 엔진 밖의 핸들러 레지스트리(§3) |
| DICE-001 굴림 애니메이션 | 숫자만 즉시 바뀜 | `.dice` 스타일, `aria-pressed` 보관 | `DiceTray.vue`/`Die.vue`: 서버(또는 목업 RNG) 최종값을 먼저 받고 **표시만** 회전→흔들림→정지(CSS `@keyframes`, ~600ms)한다. 보관 주사위는 애니메이션하지 않는다. `prefers-reduced-motion`이면 즉시 표시한다. 판정·점수 미리보기는 최종값 기준이고, 애니메이션 중에는 입력 UI만 잠근다 |

## 2. 데이터 설계

원칙: 영속 진실은 PG, 만료 가능·재생성 가능 데이터는 Redis, 매치별 기한 타이머는 프로세스 메모리(재시작 시 `deadline_at`에서 복구).

### 2.1 PostgreSQL (db.md 초안에 추가·변경할 항목)

| 테이블 | 필드·제약 | 비고 |
|---|---|---|
| `rooms` (+) | `turn_time_limit_sec SMALLINT NOT NULL CHECK (IN (10,15,30,60))` | 기본값 미정(Q1) |
| `matches` (+) | `turn_time_limit_sec` 스냅샷 | 진행 중 방 설정 변경과 분리 |
| `match_players` (+) | `play_mode ENUM(MANUAL, AUTO, AWAY)`, `play_mode_changed_at`, `auto_turns INT`, `ability_id NULL`, `ability_version NULL` | `had_auto_turn`(economy)과의 관계는 Q6 |
| `ranks` | `id, code UNIQUE, label, sort_order UNIQUE, min_completed_matches, active` | 시드: 사원·주임·대리(+부장 등 Q8) |
| `users` (+) | 직급은 완주 수로 계산하거나 `rank_id` 캐시 | 계산 시점·캐시 여부 Q9 |
| `emojis` | `id, code UNIQUE, name, render_type ENUM(CSS, SPRITE, LOTTIE, WEBP), asset_url NULL, duration_ms, sort_order, active, version` | 관리자 등록 대상 |
| `emoji_rank_permissions` | PK(`emoji_id`,`rank_id`) | "이상 직급" 규칙이면 `emojis.min_rank_order` 하나로 단순화할 수 있음(Q10) |
| `chat_messages` (+) | `kind ENUM(TEXT, EMOJI)`, `emoji_id NULL FK`, `sender_rank_id` 스냅샷, CHECK(TEXT→body NOT NULL / EMOJI→emoji_id NOT NULL) | 보존 30일 초안 유지 |
| `company_tiers` | `id, code UNIQUE, name, sort_order, 승격 조건 필드(Q12)` | 목업 `stages` 이관 |
| `companies` (+) | `tier_id FK` | |
| `abilities` | `id, code UNIQUE, name, description, effect_type, trigger_phase ENUM(BEFORE_ROLL, AFTER_ROLL, BEFORE_SCORE), params JSONB, version, active` | 수치는 `params`에 둔다. 코드에 고정하지 않는다 |
| `tier_abilities` | PK(`tier_id`,`ability_id`) | 등급당 1개인지 여러 개 중 선택인지 Q13 |
| `match_ability_uses` | `match_id, user_id, ability_id, round, command_id, effect_result JSONB, used_at`, **UNIQUE(match_id,user_id)** | 게임당 1회를 DB가 보장 |

### 2.2 Redis

| 키(prefix `oy:`) | 용도 | TTL |
|---|---|---|
| `presence:{matchId}:{userId}` | 소켓 heartbeat → 자리 비움 판정 입력 | 짧게(정책 Q4) |
| `cache:emojis:v{n}`, `cache:abilities:v{n}` | 마스터 캐시. 관리자 변경 시 버전 증가로 무효화 | 명시 TTL |
| `rl:chat:{userId}` | 채팅·이모지 공통 10초 5건 | 10s |

매치 상태(주사위·보관·점수)는 Redis에만 두지 않는다(`infrastructure.md`). 다중 인스턴스 전까지는 기한 타이머를 메모리에서 관리한다.

## 3. 서버·엔진 구조

```
packages/shared/
  scoring.mjs            (기존, 재사용)
  engine.mjs             턴 상태 전이: roll/hold/score/advance, rng 주입, 결과 검증 (P1)
  autoplay.mjs           자동 플레이 전략(순수): chooseHold(state, rng), chooseCategory(state)
  abilities/registry.mjs effect_type → { validate(state, params, args), apply(state, params, args, rng) }
apps/server/src/
  rooms/      설정 변경(turnTimeLimitSec, capacity), 준비, 시작(스냅샷)
  matches/    명령 처리 파이프라인, DeadlineScheduler(메모리 + DB 복구), PlayModePolicy
  chat/       TEXT/EMOJI 송신, 권한(직급), rate limit, 페이지 조회
  catalog/    ranks, emojis, company_tiers, abilities 조회·캐시 (관리자 CRUD는 확장 단계)
```

- 엔진은 능력을 모른다. `match:ability` 명령이 오면 서버가 스냅샷된 능력·미사용 여부·`trigger_phase`·턴 소유를 검사하고, 레지스트리 핸들러로 새 상태를 만든 뒤 엔진 불변식(주사위 1–6, 굴림 ≤ 한도 등)을 재검증한다. 새 효과는 핸들러 1개와 `abilities` 행 1개로 추가한다.
- 오토 턴은 서버가 생성한 `commandId`로 일반 명령과 같은 영수증을 남겨 재현할 수 있게 한다.
- 소켓 계약 추가 초안(구현 직전 확정): `room:settings {roomId, turnTimeLimitSec}`, `match:mode {matchId, mode:'AUTO'|'MANUAL'}`, `match:ability {matchId, commandId, expectedVersion, abilityCode, args}`, `chat:send`에 `{kind:'EMOJI', emojiCode}` 변형. MatchSnapshot에는 `turnTimeLimitSec, players[].playMode, players[].ability{code,used}`를 추가한다.

## 4. 분리해 둘 정책 지점

| 인터페이스 | 입력 | 출력 | 기본 구현(교체 가능) |
|---|---|---|---|
| `PlayModePolicy.onTurnTimeout(player)` | 연속 시간 초과 수, presence | 이번 턴 처리 방식, 모드 전환 여부 | 미정(Q3, Q5) |
| `PlayModePolicy.onPresenceLost/onInput` | heartbeat 상실·사용자 입력 | AWAY 전환·MANUAL 복귀 | 미정(Q4) |
| `RankResolver.rankOf(user)` | 완주 수 등 | rank | `organization.md` 초안 |
| `AbilityHandler` | state, params, args | 새 state | effect_type별 |

## 5. 수정 대상 파일

| 영역 | 파일 | 변경 |
|---|---|---|
| web | `src/App.vue` | 게임 블록에서 주사위·채팅을 컴포넌트로 추출하고, 봇 로직을 `autoplay.mjs` 호출로 바꾸고, 턴 타이머 표시 추가 |
| web | `src/components/EvaluationRoom.vue` | 턴 제한시간 세그먼트(PL만 조작). `start` emit에 설정 포함 |
| web | 신규 `DiceTray.vue`, `RoomChat.vue`, `EmojiPicker.vue` | DICE-001, CHAT-001/002 |
| web | `src/components/CompanyDirectory.vue` | `stages`를 등급 데이터로 표시하고 능력 설명 미리보기 |
| web | `src/style.css` | 주사위 keyframes, 메신저, 세그먼트 |
| shared | `engine.mjs`, `autoplay.mjs`, `abilities/registry.mjs` + 테스트 | P1 |
| server | `prisma/schema.prisma` + 마이그레이션 | §2.1 |
| server | 신규 `rooms/`, `matches/`, `chat/`, `catalog/` 모듈, Socket.IO 게이트웨이 | P2–P4 |
| docs | `features/yacht.md`(60초 고정 → 방 설정), `lobby.md`, `chat.md`, `organization.md`, `db.md`, `contracts/socket.md`·`rest.md` | 승인된 정책만 반영 |

## 6. 단계별 구현 계획

**MVP**
1. **UI-only (목업)**: DICE-001 애니메이션, CHAT-001 메신저 UI, ROOM-001 세그먼트, 수동/오토 토글. 서버 없이 확인할 수 있다. ※ `apps/web`은 Codex 영역이라 담당자를 조율해야 한다.
2. **P1 엔진**: `engine.mjs` + `autoplay.mjs`(RNG 주입, 결정적 테스트). 목업 봇을 이 전략으로 교체한다.
3. **P2 방·매치 서버**: 세션(인증 1단계 또는 개발용 임시 세션, Q15) → rooms(+turnTimeLimitSec) → matches 명령 파이프라인 → DeadlineScheduler → 오토 모드(사용자 선택 AUTO만 먼저).
4. **P3 채팅**: 텍스트 영속화 + ranks 시드 + emojis 샘플(CSS) + 권한 검사.

**확장**
5. AWAY 자동 전환과 복귀(정책 확정 후).
6. COMPANY-001: company_tiers, abilities, 스냅샷, `match:ability`, 핸들러(규칙 확정 후 1–2종).
7. 관리자 기능: 이모지·애니메이션 파일 업로드(S3), 능력·등급 CRUD, 캐시 버전 무효화.
8. 다중 인스턴스: Socket.IO Redis adapter, 기한 워커 단일화.

## 7. 미확정 정책 (구현 전 결정 필요)

| # | 항목 | 비고 |
|---|---|---|
| Q1 | 턴 제한시간 기본값 | `yacht.md`는 60초 |
| Q2 | 게임 중 제한시간 변경 허용 여부 | 설계는 WAITING에서만 변경하고 시작 시 스냅샷 |
| Q3 | 수동 모드 시간 초과 처리 | `yacht.md` 초안(1회 굴림 + 최고점 칸)이 있으나 요청상 미확정. 기존 초안을 유지할지 결정 |
| Q4 | 자리 비움 판정 기준 | 연속 시간 초과 N회 / 연결 끊김 X초 / 둘 다 |
| Q5 | 수동 복귀 방법 | 버튼 / 아무 입력 / 다음 턴부터 |
| Q6 | 오토 턴의 보상 제외 범위 | economy는 "자동 확정 1회라도 있으면 보상 제외". 자발적 AUTO도 제외할지 |
| Q7 | 오토 모드 진행 속도 | 즉시 / 연출용 지연(애니메이션 포함) |
| Q8 | 직급 체계 | 초안은 사원·주임·대리. 예시 "부장 갑질"에는 부장 이상이 필요 |
| Q9 | 직급 기준 | 개인 완주 수(현재 초안)인지 회사 내 직책인지. 메시지에는 송신 시점 직급을 스냅샷할지 |
| Q10 | 이모지 권한 방식 | "해당 직급 이상"인지 직급별 개별 목록인지 |
| Q11 | 이모지 애니메이션 포맷 | CSS / 스프라이트 / Lottie / WebP. 파일 크기 제한 |
| Q12 | 회사 등급 승격 조건 | 목업은 매출·비용. 정식 지표 미정 |
| Q13 | 능력 구성 | 등급당 고정 1개인지 선택. 대기업이 하위 등급 능력을 상속하는지 |
| Q14 | 능력 적용 범위 | 회사 미소속자는 능력 없음? 같은 회사 2명이 한 방에 있으면? 랭킹·보상 경기에 허용? |
| Q15 | P2 착수 시 인증 | 실제 OAuth 1단계를 먼저 할지, 개발용 세션으로 매치 서버를 먼저 할지 |
| Q16 | 애니메이션이 제한시간을 소모하는지 | 10초 제한에서 약 0.6초 연출 |
| Q17 | `apps/web`·`packages/shared` 작업 주체 | Codex 영역. UI 단계를 Claude가 할지 |

### 7.1 적용 현황 (2026-11-09, 확정 아님 — 정책 값만 반영)

| # | 현재 적용 | 위치 |
|---|---|---|
| Q1 | 1–5분, 기본 3분(2026-11-09 사용자 결정) | `game.policy.ts` |
| Q2 | WAITING에서만 변경, 시작 시 매치에 고정 | rooms·matches |
| Q3 | 기존 초안(1회 굴림 + 최고점 칸) | `matches.service` `autoFinishTurn` |
| Q4 | 연속 2회 시간 초과 → AWAY(연결 끊김만으로는 전환하지 않음) | `GamePolicy.timeoutsBeforeAway` |
| Q5 | 직접 명령 또는 "오토 해제" 시 즉시 MANUAL | `GamePolicy.returnToManualOnInput` |
| Q6 | `auto_turns`만 기록(보상 미구현) | match_players |
| Q7 | 턴 첫 동작 1.8초 + 한 걸음 1.1초(`AUTO_TURN_START_DELAY_MS`·`AUTO_STEP_DELAY_MS`) | env |
| Q8·Q9 | 미정. 완주 수 계산값(사원/주임/대리) 표시만 | `rankLabel` |
| Q15 | 이메일·소셜 인증 구현 후 매치 서버 진행 | — |
| Q17 | 사용자 요청으로 Claude가 apps/web 대기실·게임·로그인 연동 | — |
| 최대 인원 | 2–6 통일 | `RoomPolicy`, DB CHECK |

## 8. 기존 코드·문서에 주는 영향

- `features/yacht.md`의 "60초 기한"이 방 설정으로 바뀐다(Q1 결정 후 수정).
- `organization.md`의 "직급은 권한을 부여하지 않는다"는 원칙과 이모지 직급 제한이 어긋나지 않는지 확인해야 한다. 이모지 제한은 표시용 혜택이라 권한(PL·대표)과는 별개로 본다.
- 회사 능력은 승패에 영향을 준다. 공정성 문제로 랭킹·보상(economy) 규칙과 함께 결정해야 한다.
- `App.vue` 게임 블록을 분리하면 Codex의 목업 수정과 충돌할 수 있다. 작업 순서를 맞춰야 한다.
- 소켓 계약 v1(`contracts/socket.md`)에 필드·이벤트가 추가된다. 추가만 하는 하위 호환 변경으로 유지한다.
