# 아키텍처

Vue 3 + Vite + TypeScript → 동일 출처 HTTP/Socket.IO → NestJS → PostgreSQL + Redis. ORM은 Prisma를 사용한다. Unity WebGL은 Vue가 별도 로드한다. 초기 배포는 단일 API 인스턴스로 운영한다.

| 경계 | 책임 |
|---|---|
| Web | 시트·접근성·로컬 선택, ACK와 재구독, 서버 상태 렌더링 |
| NestJS | Sessions, Rooms, Matches, Chat, Organizations, Economy, Office 모듈 |
| Shared | 카테고리와 점수 함수, 상태 전이, 직렬화 타입. I/O 및 환경 의존성 없음 |
| PostgreSQL | 영속 상태, 유니크 제약, 트랜잭션, 상태 버전과 정산 근거 |
| Redis | 만료 인증 상태, 요청 제한, 접속 상태와 재생성 가능한 캐시 |

인증은 카카오·Google·네이버를 사용하며 최초 인증 후 사원명과 담당 부서를 등록한다. JWT와 refresh session의 구체적인 구현은 Claude가 담당한다. 인증 상세는 docs/features/auth.md, 지금 진행할 인프라 범위는 docs/tasks/INFRA-001.md와 docs/infrastructure.md에 있다. 인증·게임·초대·구매 권한은 서버가 매 요청마다 검사한다.

게임 변경은 매치 잠금 → 권한·버전·기한 검사 → 상태 전이 → 명령 영수증 저장 → 커밋 → 브로드캐스트 순이다. DB 장애 시 성공 ACK 없이 응답한다. 프로세스가 커밋 후 종료되면 클라이언트 재구독과 스냅샷으로 복구한다. 기한 작업은 서버 시작 시 미처리 매치를 DB에서 복구하고 주기적으로 확인한다. 다중 인스턴스가 필요해지면 Socket.IO 어댑터, 세션 라우팅, 기한 워커와 발행 신뢰성을 별도 검증한다.

로그에는 requestId, roomId, matchId, 오류 코드, 처리 시간을 남긴다. 쿠키와 메시지 본문은 기록에서 제외한다. 보안·스키마 마이그레이션·백업 복원은 공개 배포 전 점검한다.
