import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Env } from './config/env.js';
import { AuthPolicy } from './auth/auth.policy.js';

/**
 * OpenAPI 3 문서(/docs, JSON: /docs/json). API_DOCS_ENABLED(기본: production 에서 꺼짐)로 제어.
 * 문서는 실제 등록된 컨트롤러·라우트에서 생성되므로 미구현 API 는 나타나지 않는다.
 */
export function setupApiDocs(app: INestApplication, env: Env) {
  const cookie = AuthPolicy.cookie.name(env.cookieSecure);
  const config = new DocumentBuilder()
    .setTitle('OfficeYacht API')
    .setVersion('1')
    .setDescription(
      [
        '컴퍼니 요트 다이스 백엔드. 성공 `{ data }`, 실패 `{ error: { code, message, requestId, details? } }`.',
        '',
        '**Swagger 에서 테스트하는 순서**',
        '1. `POST /api/v1/auth/signup` 또는 `/auth/login` → 응답의 `data.accessToken` 복사',
        '2. 오른쪽 위 **Authorize** → `access` 에 토큰 붙여넣기(앞에 Bearer 불필요)',
        '3. `GET /api/v1/me` 실행',
        '',
        `**Refresh token** 은 HttpOnly 쿠키(\`${cookie}\`, Path=${AuthPolicy.cookie.path}, SameSite=Strict)로만 오간다. ` +
          '같은 주소에서 연 Swagger UI 는 브라우저가 쿠키를 자동 저장·전송하므로 `POST /auth/refresh` 를 그대로 실행하면 된다. 스크립트로 토큰 값을 읽을 수는 없다.',
        '',
        '쿠키를 쓰는 경로(signup/login/refresh/logout)는 `Origin` 검사가 있다. 개발 환경은 http://localhost:* 를 허용한다.',
        '',
        '실시간 이벤트는 Socket.IO(`/socket.io`, handshake `auth.token`=access token) — 계약: docs/contracts/socket.md.',
        env.testMode ? '\n**TEST_MODE 활성**: `개발 테스트` 그룹의 `/dev/*` 경로 사용 가능(운영에서는 존재하지 않음).' : '',
        '',
        '조직(회사)·상점·채팅 서버 API 는 아직 구현되지 않아 이 문서에 없다.',
      ].join('\n'),
    )
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'POST /auth/login 응답의 accessToken' }, 'access')
    .addCookieAuth(cookie, { type: 'apiKey', in: 'cookie', name: cookie, description: 'HttpOnly refresh 쿠키 — 브라우저가 자동 전송(직접 입력 불필요)' }, 'refresh')
    .addTag('인증', '이메일·소셜 로그인, 토큰 재발급, 로그아웃')
    .addTag('회원', '내 정보·인사 등록')
    .addTag('게임방', '방 목록·생성·입장·준비·시작')
    .addTag('게임', '게임 상태·명령·오토 모드')
    .addTag('상태', '헬스 체크')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/json',
    customSiteTitle: 'OfficeYacht API',
    swaggerOptions: { persistAuthorization: true, withCredentials: true, tagsSorter: 'alpha', docExpansion: 'list' },
  });
}
