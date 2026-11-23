[English](README.md) | [한국어](README.ko.md) | **日本語** | [简体中文](README.zh-CN.md)

# bmo-note

プラットフォームの編集可能なノートを一つのサービスとして提供します。各ノートは AFFiNE のエディターである BlockSuite
のドキュメントで、バイナリの Yjs 状態として独自のメタデータとともにユニットの SQLite ストアに保存されます。ノートは
Web コンソールのサイドバーから作成・編集・検索します。ノートを表示するコンソールプラグインバンドルは、このリポジトリに
取り込んだエディターからビルドされます。`docs/design.md` はこのサービスが何であるか、`docs/api.md` はその境界、
`docs/affine.md` は AFFiNE の何を調べ、どのライセンスに従うかを記しています。このリポジトリは AFFiNE Community
Edition のフォークであり、今後のマージのために `upstream` を保持しています。

## テスト

`cargo test`(testbed 経由)は、クレートの唯一のハーネス `tests/main.rs` を一時的な SQLite ファイルとループバック
ポートの上で実行します。対象は次のとおりです。各アカウントのノートの書き込み、読み取り、保存、競合、ゴミ箱への移動、
復元、完全削除(`notes.rs`)、ノートのドキュメントに付随するもの(`beside.rs`)とノートが持つ画像(`blobs.rs`)、
リンクやメンバーで共有されるノート(`sharing.rs`)、各読者自身のピン留めと閲覧履歴(`own.rs`)、検索
(`search.rs`)、書き込みが発行するストリーム(`events.rs`)、サービスが提供するコンソール画面と、取り込んだリリース
上で bmo-ui 自身の読み取りを通して読むそのマニフェスト(`console.rs`)、そしてユニット自身のリポジトリ検査
(`repository.rs`)です。コンソールバンドルの検査は `client/` 内の `bun run check` で、取り込んだエディターを
コピーし、インストールし、デコレーター付きのソースを TypeScript コンパイラーでトランスパイルしてから、型検査と
テストを行います(`docs/affine.md`、「The client's build path to the vendored editor」)。

## 構成

| フォルダー | 内容 |
|---|---|
| `src/` | サービスとそのコマンド。ルート、ノートストア、イベントリング、コンソール画面の宣言 |
| `client/` | 独立したプロジェクトであるコンソールプラグインバンドル。`client/blocksuite/`(追跡対象外)にはビルド用のエディターのコピーが入ります |
| `deploy/` | サービスのユーザーユニット |
| `tests/` | クレートの唯一のテストハーネスと、それが使うスタンドイン。フォーク元アップストリームの E2E テストフォルダーも並んでいます |
| `docs/` | サービスが何であるかとその境界に関する正典ドキュメント、AFFiNE の調査記録、そしてフォーク元アップストリームのブックとブログのコンテンツ |
| `blocksuite/` | フォークした BlockSuite エディター(MIT)。クライアントのビルドが取り込むソースです |
| `packages/` | フォークした AFFiNE のパッケージ。`frontend/` と `common/` 配下の MIT のフロントエンド(`common/native` を除く)と、Enterprise ライセンスの `backend/` と `common/native`。このユニットは後者をビルドすることも、再利用のために読むこともありません |
| `tools/`、`scripts/` | フォーク元アップストリームのツールとリリーススクリプト。このユニットでは使いません |
| `.github/`、`.cargo/`、`.codesandbox/`、`.devcontainer/`、`.docker/`、`.husky/`、`.render/` | フォーク元アップストリームの設定と CI のフォルダー。このユニットでは使いません |

ルートには、Cargo のマニフェストとロックファイル、`testbed.toml`、`install.toml`、`rustfmt.toml`、`settings.toml`(バイナリに
組み込まれるデフォルト値)、`CLAUDE.md`、`PERSONAL-DATA.md`、ライセンスファイル、そしてフォーク自身の JavaScript
マニフェストと tsconfig 群があります。

## コマンド

- `bmo-note serve` はストアを開き、停止を指示されるまでルートに応答します。
- `bmo-note health` は、設定が指すサービスが準備完了と応答すれば 0 で終了します。
- `bmo-note console-reach` は、コンソールがサービスに到達する方法を出力します。デプロイのコンソール確認に使います。

設定は、バイナリに組み込まれた `settings.toml`、次にリリースの隣にあるデプロイの `settings.toml` と
`settings.local.toml`(データルートの `env/note.toml`)、最後に環境変数 `BMO_NOTE_<TABLE>__<KEY>` の順に読み込まれ
ます(`docs/api.md`、「Settings」)。
