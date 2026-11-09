# INFRA-001 · Claude Code 인프라 작업 지시

2026-11-09 중간 인수인계. 사용자는 Codex에서 Vue 목업을 계속 검토하며 Claude에는 인프라 구성을 맡긴다.

## 먼저 읽을 파일

1. CLAUDE.md
2. 이 파일
3. docs/infrastructure.md
4. docs/architecture.md
5. 인증 설계에 진입할 때 docs/features/auth.md

전체 docs를 일괄 읽는 대신 작업 단계에 필요한 파일만 연다.

## 목표

Mac Apple Silicon에서 PostgreSQL·Redis를 Docker Compose로 실행하고 NestJS API가 두 서비스의 연결과 상태를 확인하는 개발 기반을 완성한다. ORM은 기존 논의의 Prisma를 사용한다. DB와 Redis를 실제로 실행해 검증하고, 실행 불가 시 원인과 미검증 항목을 명시한다.

## 변경 범위

- apps/server/** — NestJS TypeScript 기반, 환경변수 검증, Prisma 연결, Redis 연결, 상태 확인 API, 종료 처리
- infra/** — Compose, 환경변수 예제, 인프라 실행 안내
- 루트 package.json 및 잠금 파일 — 필요할 때만 인프라·서버 실행 명령 추가
- .gitignore — 필요한 생성물·비밀정보 제외
- docs/infrastructure.md — 선택 버전, 실제 명령, 검증 결과
- docs/HANDOFF.md — 자신의 인프라 작업 결과만 추가

apps/web과 packages/shared는 Codex가 작업하는 영역이다. 인프라 구성 중 웹 코드, 웹 package.json 및 잠금 파일, 목업 기능과 공통 점수 규칙은 변경하지 않는다. 현재 웹은 독립 npm 프로젝트다. 이번 작업에서 전체 저장소를 workspace로 변환할 필요는 없다. 수정 전 파일을 다시 읽고 다른 작업의 변경을 보존한다.

## 수행 순서

1. 현재 Node/npm/Docker/Compose와 포트 사용 현황을 확인한다. 기존 컨테이너와 볼륨을 목록으로 확인하고 충돌 없는 프로젝트 이름을 정한다.
2. 공식 문서로 NestJS·Prisma·Node 호환성과 이미지의 arm64 지원을 확인하고 정확한 버전을 기록한다.
3. infra/compose.yml, infra/.env.example, 인프라 실행 안내를 만든다. 시작 시 필수 비밀번호 누락을 검출한다.
4. apps/server에 최소 실행 가능한 API를 만든다. Prisma 및 Redis 클라이언트의 초기화, timeout, 연결 해제, 시그널 종료를 구현한다.
5. /health/live와 /health/ready를 구현한다. 준비 상태는 PG 쿼리와 Redis ping을 제한 시간 내 확인하고 장애 시 503으로 응답한다.
6. Prisma 마이그레이션의 최소 실행 기반을 만든다. 검증용 모델은 서비스의 users/external_identities 초안을 우선 활용하고 임의 테스트 테이블을 제품 모델로 남기지 않는다. OAuth 로그인 자체는 후속 단계다.
7. 정상 실행, 서버 재시작, PG 영속성, Redis 만료, 의존성 장애·복구를 검증한다.
8. 실행 명령, 변경 파일, 통과·실패·미실행 항목, 다음 작업 하나를 보고한다.

## 범위 종료 조건

한 번의 Compose 명령으로 PG·Redis가 건강 상태가 되고, API 시작·종료와 두 health 경로가 확인되어야 한다. 새 빈 개발 DB에서 마이그레이션을 적용할 수 있어야 한다. 실행 안내를 따라 다른 개발자가 재현할 수 있어야 한다. 운영 배포·실제 OAuth 비밀키 발급·게임 서버 전체 구현은 별도 단계다.

기존 볼륨 삭제나 down -v를 자동 실행하지 않는다. 실서비스 계정 비밀키는 문서·대화·로그에 출력하지 않는다.
