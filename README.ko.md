[English](README.md) | **한국어** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

# bmo-note

플랫폼의 편집 가능한 노트를 하나의 서비스로 제공합니다. 각 노트는 Nuxt UI 편집기의 서식 있는 문서이며, TipTap JSON으로
자체 메타데이터와 함께 유닛의 SQLite 저장소에 보관됩니다. 노트는 웹 콘솔의 사이드바에서 만들고, 편집하고, 다시 찾습니다.
`[[` 또는 `@`로 노트끼리 링크하고, 노트를 링크한 노트가 그 아래에 표시되며, 단어에 의견을 남기고, 노트에 대해 Agent에게
묻거나 의논할 수 있습니다. 노트를 보여 주는 콘솔 플러그인 번들도 이 저장소에서 빌드됩니다. `docs/design.md`는 이 서비스가
무엇인지, `docs/api.md`는 그 경계를 설명합니다.

## 테스트

`cargo test`(testbed를 통해 실행)는 크레이트의 유일한 하네스 `tests/main.rs`를 임시 SQLite 파일과 루프백 포트 위에서
실행합니다. 대상은 다음과 같습니다. 계정별 노트의 쓰기, 읽기, 저장, 충돌, 휴지통 이동, 복원, 완전 삭제(`notes.rs`),
서비스가 문서에서 읽는 내용(`document.rs`), 노트 문서 곁에 있는 것 — 문서가 말하는 내용, 링크, 아이콘, 사본
(`beside.rs`) — 과 노트가 가진 이미지(`blobs.rs`), 의견 스레드(`comments.rs`), 링크와 멤버로 공유한 노트
(`sharing.rs`), 계정별 폴더와 그 안의 노트 위치(`folders.rs`), 각 사용자의 북마크와 최근 연 기록(`own.rs`), 검색(`search.rs`), 쓰기가 발행하는 스트림
(`events.rs`), 서비스가 제공하는 콘솔 화면과 들여온 릴리스에서 bmo-ui 자체 읽기로 읽는 매니페스트(`console.rs`),
그리고 유닛 자체의 저장소 검사(`repository.rs`)입니다. 콘솔 번들의 검사는 `client/` 안의 `bun run check`로,
설치, 타입 검사, 번들 빌드, 단위 테스트를 실행합니다. `client/tests/browser/`의 브라우저 테스트는 스위트의 브라우저
레인에서 실행됩니다.

## 구성

| 폴더 | 내용 |
|---|---|
| `src/` | 서비스와 명령: 라우트, 노트 저장소, 문서 읽기, 의견, 이벤트 링, 콘솔 화면 선언 |
| `client/` | 독립된 프로젝트인 콘솔 플러그인 번들 |
| `deploy/` | 서비스의 사용자 유닛과 배포가 게시하는 앱 선언 |
| `scripts/` | 선언물과 함께 생성되는, 이 앱을 컴퓨터에서 제거하는 절차 |
| `tests/` | 크레이트의 유일한 테스트 하네스와 그 하네스가 쓰는 대역 |
| `docs/` | 서비스가 무엇인지와 그 경계를 정한 기준 문서 |

루트에는 Cargo 매니페스트와 잠금 파일, `bmo-app.toml`(단 하나의 선언; `testbed.toml`, `install.toml`, `deploy/`의 유닛과 `scripts/remove.sh`는 여기서 생성된다), `rustfmt.toml`, `settings.toml`(바이너리에 내장된 기본값),
`CLAUDE.md`, `PERSONAL-DATA.md`, 라이선스가 있습니다.

## 명령

- `bmo-note serve`는 저장소를 열고 중지될 때까지 라우트에 응답합니다.
- `bmo-note health`는 설정이 가리키는 서비스가 준비되었다고 응답하면 0으로 끝납니다.
- `bmo-note console-reach`는 배포의 콘솔 점검을 위해 콘솔이 서비스에 닿는 방법을 출력합니다.

설정은 바이너리에 내장된 `settings.toml`, 이어서 릴리스 곁의 배포 `settings.toml`과 `settings.local.toml`(데이터
루트의 `env/note.toml`), 마지막으로 환경의 `BMO_NOTE_<TABLE>__<KEY>` 순서로 읽습니다(`docs/api.md`, 「Settings」).

## 라이선스

`LICENSE`에 적힌 대로 MIT입니다.
