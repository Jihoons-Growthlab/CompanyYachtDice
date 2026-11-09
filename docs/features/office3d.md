# Unity WebGL 아바타와 개인 사무실

후속 단계에서 Vue가 인벤토리·2D 대체 화면·저장 UI를 유지하고 Unity가 아바타와 방을 렌더링한다. 기본 아바타와 카탈로그 보유 의상 슬롯을 조합한다. 개인 사무실은 정수 격자, 아이템별 배치 한도, 90도 회전, 점유 충돌 규칙을 적용한다. 첫 버전은 개인 편집만 지원한다.

동일 출처 iframe 브리지에 `{v:1,type,requestId,payload}`를 사용한다. 양측이 origin과 source를 확인한다. Unity → Vue: READY, LAYOUT_CHANGED, LOAD_FAILED. Vue → Unity: INIT(배치·아바타·보유 목록), SAVE_RESULT. 세션 쿠키와 토큰은 브리지에 싣지 않는다. Vue가 REST로 저장하고 서버가 보유권, 슬롯, 좌표, 배치 상한, revision을 검증한다. 충돌 시 최신 상태를 읽어 다시 편집한다.

웹 게임 첫 화면과 3D 번들은 분리한다. 사무실 진입 시 지연 로딩하고 실패 시 2D 보유 목록과 다시 시도 버튼을 표시한다. 검증: 저장·재로드, 미보유 아이템, 충돌 및 범위 초과, 다른 탭 버전 충돌, Safari/Chrome에서 초기화 및 대체 화면.
