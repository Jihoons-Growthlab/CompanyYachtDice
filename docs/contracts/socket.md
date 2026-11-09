# Socket.IO 계약 v1

기본 네임스페이스, 인증 쿠키와 Origin 검사. ACK는 `{ok:true,data}` 또는 `{ok:false,error:{code,message,details?}}`. 방 및 매치 권한은 명령마다 확인한다.

| 클라이언트 → 서버 | 본문 | 성공 ACK |
|---|---|---|
| room:subscribe | {roomId} | {room,match 또는 null} |
| room:unsubscribe | {roomId} | {roomId} |
| room:ready | {roomId,ready} | RoomSnapshot |
| room:start | {roomId} | MatchSnapshot |
| match:roll | {matchId,commandId,expectedVersion} | MatchSnapshot |
| match:hold | 위 필드 + {held:[boolean × 5]} | MatchSnapshot |
| match:score | 위 필드 + {category} | MatchSnapshot |
| chat:send | {roomId,clientMessageId,text} | Message |

서버 → 클라이언트는 `room:state`(RoomSnapshot), `match:state`(MatchSnapshot), `chat:message`(Message)를 커밋 후 해당 방에 보낸다.

- RoomSnapshot: {id,name,status,capacity,ownerId,members:[{userId,nickname,ready}],matchId|null}. room:start 재시도는 이미 시작된 해당 매치를 반환한다.
- MatchSnapshot: {id,roomId,ruleset,status,version,round,turnUserId,deadlineAt,dice,held,rollCount,players:[{userId,nickname,scores,total,rank}]}. 첫 굴림 전 dice=[]이며 점수 맵에는 12개 키와 null/정수가 들어간다. 종료 시 turnUserId와 deadlineAt은 null이다.
- Message: {id,roomId,seq,userId,nickname,text,createdAt,clientMessageId}.

예시 `match:score {"matchId":"…","commandId":"…","expectedVersion":8,"category":"fullHouse"}`. 클라이언트는 전송 전 UUID를 만들고 응답 타임아웃 시 동일 명령을 재전송한다. 서버는 기존 영수증을 버전 검사 전에 확인하며, 다른 본문에 키를 재사용하면 IDEMPOTENCY_CONFLICT를 반환한다. 버전 불일치 시 STALE_VERSION과 현재 버전을 반환한다. NOT_YOUR_TURN, TURN_EXPIRED, ROLL_LIMIT, ALL_HELD, CATEGORY_FILLED는 각각 화면에 표시한다.

클라이언트는 구독 응답을 받는 동안 이벤트를 버퍼링하고 높은 매치 버전만 적용한다. 재연결·탭 복귀·ACK 오류 시 다시 구독하거나 REST 스냅샷을 읽는다. 메시지는 seq로 누락을 확인하고 REST로 보충한다. room:state는 전체 스냅샷이며 재접속 시 구독 응답으로 새로 맞춘다.


## 구현 상태 (2026-11-09)

구현된 이벤트: room:subscribe/unsubscribe/ready/start, match:roll/hold/score, match:mode {matchId,mode}, 서버 → room:state·match:state. **chat:send·chat:message는 미구현이다.**
- 인증: handshake `auth.token`에 access JWT를 넣는다. 서명·만료·세션(family) 유효성을 검사하고, 실패하면 `connect_error`의 message가 오류 코드가 된다(AUTH_REQUIRED·TOKEN_INVALID·SESSION_REVOKED). access 만료 시각에 서버가 연결을 끊는다 → 클라이언트는 refresh 후 재연결한다.
- Origin은 HTTP와 같은 허용 목록으로 검사한다(development는 http://localhost:* 허용).
- 명령 처리 경로는 REST `POST /matches/:id/commands`와 동일하다. room:subscribe ACK는 {room, match|null}을 돌려주며, 재접속 복구에 쓴다.
- 접속 상태(online)는 단일 인스턴스 메모리에 둔다. 다중 인스턴스 전환 시 Redis adapter와 presence 키가 필요하다.
- 2026-11-09 추가: chat:send / chat:message, lobby:changed, invite:received·invite:updated(개인 채널), room:subscribe ACK에 messages. 전체 목록은 docs/development-status.md §3.
- 2026-11-09 추가: match:briefed {matchId}(시작 안내 확인). MatchSnapshot에 phase(BRIEFING/PLAYING/FINISHED)·briefingDeadlineAt·players[].briefed.
