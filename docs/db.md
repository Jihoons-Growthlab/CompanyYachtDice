# PostgreSQL 모델 초안

UUID 기본키, 시간은 timestamptz UTC. 내부 버전·채팅 순번·코인은 정수이며 JSON에는 안전 정수 범위 내 숫자로 내보낸다.

| 테이블 | 주요 필드와 제약 |
|---|---|
| users / external_identities / sessions | users(nickname, department_label, profile_completed_at); external_identities(user_id, provider, subject), UNIQUE(provider,subject); sessions(user_id, refresh_token_hash UNIQUE, expires_at, revoked_at, family_id) |
| rooms / room_members | rooms(owner_id, status, capacity CHECK 2–4, invite_code UNIQUE); members(room_id,user_id) PK, ready, joined_at |
| matches / match_players | matches(room_id,ruleset,status,version,turn_user_id,round,deadline_at,dice,held,roll_count); match_players(match_id,user_id) PK, UNIQUE(match_id,seat), rank,total,had_auto_turn |
| scores | PK(match_id,user_id,category), points ≥ 0; 점수 미확정은 행 부재 |
| match_commands | PK(match_id,user_id,command_id), request_hash, result_json |
| chat_messages | UNIQUE(room_id,seq), UNIQUE(room_id,user_id,client_message_id), body, created_at; (room_id,seq) 인덱스 |
| companies / departments | departments(company_id,id) UNIQUE, 이름은 회사 안에서 유일 |
| memberships / invites | memberships.user_id UNIQUE, 역할, 선택적 회사 내부 department_id 복합 FK; invites(target_user_id,expires_at,used_at) |
| wallets / ledger | wallets(user_id PK,balance CHECK balance>=0); ledger(user_id,source_key) UNIQUE, signed_delta, created_at |
| catalog / orders / inventory | catalog(sku UNIQUE, price CHECK price>0,active); orders(user_id,idempotency_key) UNIQUE, request_hash, price; inventory(user_id,sku) PK |
| titles / user_titles | user_titles(user_id,title_id) PK, equipped; 장착 true에 user_id 부분 UNIQUE |
| office_layouts | user_id PK, revision, layout JSONB, avatar JSONB, updated_at |

방마다 진행 중인 매치는 부분 UNIQUE로 하나만 허용한다. 채팅 순번은 방별 카운터를 같은 트랜잭션에서 증가시킨다. 보상 source_key는 match:<id>, 초기 지급은 signup, 주문은 order:<id>. 지갑의 합계가 원장 합계와 일치하는지 검증한다. DB 변경은 마이그레이션 파일과 초기 테스트 데이터로 관리한다.


## 중간 추가 모델

- company_join_requests — company_id, user_id, status, created_at, decided_at. 회사·사용자별 PENDING 중복 방지.
- room_invites — room_id, inviter_id, target_user_id, status, expires_at, responded_at. 대상 사용자 권한 및 대기실 정원 재검사.
- 회사 초대와 게임방 초대는 별도 도메인으로 저장한다. 회사 가입 신청과 게임 준비 상태도 구분한다.
- users.department_label은 개인 담당 부서다. 회사의 departments는 추후 확장 모델이므로 최초 인사 등록에 회사 가입 FK를 강제하지 않는다.
- Redis 데이터 모델은 docs/infrastructure.md에 있으며 영속 모델의 대체 저장소로 사용하지 않는다.

전체 테이블은 제품 설계 초안이다. INFRA-001에서 모든 도메인 테이블을 한 번에 구현할 필요는 없다.


## 구현됨 (마이그레이션 기준)

- `users`, `external_identities` (INFRA-001)
- `local_credentials` — user_id PK/FK CASCADE, email UNIQUE(정규화), password_hash(argon2id PHC), password_updated_at (P1)
- `sessions` — refresh token 1개=1행: family_id, refresh_token_hash CHAR(64) UNIQUE, expires_at, absolute_expires_at, revoked_at, revoke_reason(ROTATED/LOGOUT/LOGOUT_ALL/REUSE_DETECTED/EXPIRED), replaced_by_id, user_agent. IP는 저장하지 않음. 만료 행 정리 작업은 미구현
- `users.kind` — HUMAN·DEV(테스트 계정)·BOT(가상 플레이어). 테스트 데이터 초기화 대상 구분
- `rooms` — name, status(WAITING/PLAYING/CLOSED), capacity CHECK 2–6, turn_time_limit_sec CHECK 3–60(일반 허용값 10/15/30/60은 앱 정책), owner_id, is_test
- `room_members` — PK(room_id,user_id), ready, joined_at
- `matches` — state JSONB(엔진 상태, 원본), version, turn_time_limit_sec(시작 시 고정), turn_deadline_at, status. **방별 ACTIVE 1개 부분 UNIQUE**
- `match_players` — PK(match_id,user_id), UNIQUE(match_id,seat), play_mode(MANUAL/AUTO/AWAY), consecutive_timeouts, auto_turns, total, rank
- `match_commands` — PK(match_id,user_id,command_id), request_hash, result_version (중복 명령 방지)
- 초안과 다른 점: 진행 중 점수는 정규화 `scores` 테이블이 아니라 `matches.state` JSONB에 둔다(행 잠금 1회로 일관성 확보). 결과 집계는 `match_players`. 랭킹·보상 도입 시 정규화를 재검토한다.
- `rooms` 추가 컬럼: is_private + join_code(CHECK: 비공개면 코드 필수), bots_allowed, chat_seq(채팅 순번 카운터)
- `room_invites` — room_id, inviter_id, target_user_id, status(PENDING/ACCEPTED/DECLINED/EXPIRED/CANCELLED), expires_at, responded_at. **(room,target) PENDING 부분 UNIQUE**
- `chat_messages` — UNIQUE(room_id,seq), UNIQUE(room_id,user_id,client_message_id), kind(TEXT/SYSTEM), sender_nickname·sender_rank 스냅샷, body ≤1200(앱은 300자), 30일 후 삭제
