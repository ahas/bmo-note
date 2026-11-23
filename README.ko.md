[English](README.md) | **한국어** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

# bmo-note

플랫폼의 편집 가능한 노트를 하나의 서비스로 제공합니다. 각 노트는 AFFiNE의 편집기인 BlockSuite 문서이며, 바이너리
Yjs 상태로 자체 메타데이터와 함께 유닛의 SQLite 저장소에 보관됩니다. 노트는 웹 콘솔의 사이드바에서 만들고, 편집하고,
다시 찾습니다. 노트를 보여 주는 콘솔 플러그인 번들은 이 저장소에 들여온 편집기로 빌드됩니다. `docs/design.md`는
이 서비스가 무엇인지, `docs/api.md`는 그 경계를, `docs/affine.md`는 AFFiNE에서 무엇을 살펴보았고 어떤 라이선스를
따르는지를 설명합니다. 이 저장소는 AFFiNE Community Edition의 포크이며, 이후 병합을 위해 `upstream`을 유지합니다.

## 테스트

`cargo test`(testbed를 통해 실행)는 크레이트의 단일 하네스 `tests/main.rs`를 임시 SQLite 파일과 루프백 포트 위에서
실행합니다. 다루는 내용은 다음과 같습니다. 각 계정의 노트를 쓰고, 읽고, 저장하고, 충돌시키고, 휴지통에 넣고,
복원하고, 영구 삭제하는 것(`notes.rs`), 노트 문서 곁에 놓이는 것(`beside.rs`)과 노트가 담는 이미지(`blobs.rs`),
링크와 멤버로 공유하는 노트(`sharing.rs`), 각 독자의 고정 항목과 열어 본 기록(`own.rs`), 검색(`search.rs`), 쓰기가
발행하는 스트림(`events.rs`), 서비스가 제공하는 콘솔 화면과, 들여온 릴리스에서 bmo-ui 자체의 읽기 방식으로 읽는
그 매니페스트(`console.rs`), 그리고 유닛 자체의 저장소 검사(`repository.rs`)입니다. 콘솔 번들의 검사는 `client/`
안의 `bun run check`로, 들여온 편집기를 복사하고, 설치하고, 데코레이터가 붙은 소스를 TypeScript 컴파일러로
트랜스파일한 뒤, 타입 검사와 테스트를 실행합니다(`docs/affine.md`, 「The client's build path to the vendored
editor」).

## 구성

| 폴더 | 내용 |
|---|---|
| `src/` | 서비스와 그 명령: 라우트, 노트 저장소, 이벤트 링, 콘솔 화면의 선언 |
| `client/` | 별도 프로젝트인 콘솔 플러그인 번들. `client/blocksuite/`(추적하지 않음)에는 빌드용 편집기 복사본이 들어갑니다 |
| `deploy/` | 서비스의 사용자 유닛 |
| `tests/` | 크레이트의 단일 테스트 하네스와 그것이 사용하는 대역들. 포크 업스트림의 엔드투엔드 테스트 폴더도 함께 있습니다 |
| `docs/` | 서비스가 무엇인지와 그 경계에 대한 기준 문서, AFFiNE 조사 기록, 그리고 포크 업스트림의 책과 블로그 콘텐츠 |
| `blocksuite/` | 포크한 BlockSuite 편집기(MIT). 클라이언트 빌드가 들여오는 소스입니다 |
| `packages/` | 포크한 AFFiNE 패키지: `frontend/`와 `common/` 아래의 MIT 프런트엔드(`common/native` 제외), 그리고 Enterprise 라이선스인 `backend/`와 `common/native`. 이 유닛은 후자를 빌드하지도, 재사용하려고 읽지도 않습니다 |
| `tools/`, `scripts/` | 포크 업스트림의 도구와 릴리스 스크립트. 이 유닛에서는 쓰지 않습니다 |
| `.github/`, `.cargo/`, `.codesandbox/`, `.devcontainer/`, `.docker/`, `.husky/`, `.render/` | 포크 업스트림의 설정과 CI 폴더. 이 유닛에서는 쓰지 않습니다 |

루트에는 Cargo 매니페스트와 lockfile, `testbed.toml`, `rustfmt.toml`, `settings.toml`(바이너리에 내장되는
기본값), `CLAUDE.md`, `PERSONAL-DATA.md`, 라이선스 파일, 그리고 포크 자체의 JavaScript 매니페스트와 tsconfig들이
있습니다.

## 명령

- `bmo-note serve`는 저장소를 열고 중지하라는 지시를 받을 때까지 라우트에 응답합니다.
- `bmo-note health`는 설정에 지정된 서비스가 준비 완료로 응답하면 0으로 끝납니다.
- `bmo-note console-reach`는 콘솔이 서비스에 접근하는 방법을 출력하며, 배포의 콘솔 점검에 쓰입니다.

설정은 바이너리에 내장된 `settings.toml`, 그다음 릴리스 옆에 있는 배포의 `settings.toml`과 `settings.local.toml`
(데이터 루트의 `env/note.toml`), 그다음 환경 변수 `BMO_NOTE_<TABLE>__<KEY>` 순서로 읽습니다(`docs/api.md`,
「Settings」).
