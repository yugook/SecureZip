# SecureZip

[![CodeQL](https://github.com/yugook/SecureZip/actions/workflows/codeql.yml/badge.svg)](https://github.com/yugook/SecureZip/actions/workflows/codeql.yml)
[![CI](https://github.com/yugook/SecureZip/actions/workflows/ci.yml/badge.svg)](https://github.com/yugook/SecureZip/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yugook.securezip?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=yugook.securezip)

**SecureZip** is a Visual Studio Code extension that lets you securely export your project as a clean ZIP archive.

> Stable export workflow with ignore tooling, auto-commit, and tagging.

## ✨ Features
- 📦 **Export to ZIP** – Create a ZIP of your project with one click.
- 🔐 **Encrypted ZIP** – Optionally protect the archive with an AES-256 password (WinZip AES).
- 🔄 **Optional Auto Commit** – Offer to commit tracked changes before export, with a toggle to include untracked files automatically.
- 🏷 **Auto Tagging** – Tag the repository with the export timestamp for traceability.
- 🧹 **Smart Ignore Support** – Respects `.gitignore` and project-specific `.securezipignore` to strip secrets and build artifacts.

## ⚙️ Auto Commit Stage Mode
SecureZip only offers the auto-commit step when it detects local changes. By default it stages tracked files via `git add --update`, matching the safe workflow shown in the warning dialog. If you prefer SecureZip to stage new files as well, switch the stage mode in your settings:

```json
{
  "secureZip.autoCommit.stageMode": "all"
}
```

- `tracked` (default) – Stage edits/deletions to tracked files only.
- `all` – Stage tracked and untracked files (`git add --all`).

## 🏷 Tagging Mode
SecureZip can tag exports for traceability. Choose the tagging behavior per export or set a default:

```json
{
  "secureZip.tagging.mode": "ask"
}
```

- `ask` (default) – Prompt to use the default tag, skip, or enter a custom tag.
- `always` – Always create the default export tag.
- `never` – Skip tagging entirely.

## 🔐 Encrypted ZIP

SecureZip can produce password-protected archives in addition to the regular
export. Two commands are available from the Command Palette and the SecureZip
view title bar:

- `SecureZip: Export Encrypted ZIP` (`securezip.exportEncrypted`) – encrypted
  variant of the single-root export.
- `SecureZip: Export Workspace Encrypted ZIP`
  (`securezip.exportWorkspaceEncrypted`) – encrypted variant of the multi-root
  workspace export.

When you run either command SecureZip prompts twice (password + confirmation).
Mismatched entries trigger a re-prompt; cancelling either prompt aborts the
export without writing any file. The archive uses **WinZip AES-256** (method
`99`) for entry encryption.

### Compatibility

WinZip AES-256 is widely supported by modern tools (7-Zip, Keka, WinRAR,
WinZip, macOS `unzip` 6.0+ with `-P`), but **the legacy "Compressed Folder"
viewer on Windows and older `unzip` builds cannot open these archives**.
Distribute encrypted archives only to recipients who have a compatible
extractor.

### What is and isn't protected

Encryption applies to **file contents only**. The following metadata is *not*
hidden by the format:

- File names, directory structure, and archive layout
- Per-entry sizes, timestamps, CRC values, and compression settings
- The fact that the archive is encrypted

If the names or structure of your files are themselves sensitive, encrypt the
archive again inside an outer container (e.g. a 7z archive with header
encryption) before sharing.

### Failure semantics and concurrency

- SecureZip writes the encrypted archive to a temporary `.partial` file in the
  output directory and renames it on success. If the write or rename fails the
  temporary file is removed and **any pre-existing ZIP at the destination is
  left untouched**.
- The Git steps (auto-commit / tag) run *before* the archive is written. If a
  ZIP failure occurs after auto-commit or tagging has already succeeded, **the
  resulting commit or tag remains in your repository** – review `git log` /
  `git tag` and revert manually if you need to roll the change back.
- A second export invocation while one is already running is rejected with a
  warning ("Export is already running"); concurrent runs cannot interleave.

## 🛡 Ignore Rules
SecureZip respects the following when selecting files to include:

- `.gitignore` – Acknowledged automatically.
- `.securezipignore` – Project rules to exclude and re-include files for export.
- Preview deduplication: the SecureZip view merges duplicates with priority
  `.securezipignore` > `.gitignore` > auto-excludes, hides comments/blank lines
  and unmatched entries, and shows suppressed sources in the tooltip (“Also
  excluded by …”).

`.securezipignore` syntax (gitignore-like subset):

- `# comment` and empty lines are ignored.
- `pattern` excludes matches.
- `!pattern` re-includes matches (overrides only `.securezipignore` excludes).
- `/path` is treated as workspace-root relative.
- `dir/` matches a directory (expanded to `dir/**`).

Examples:

```
# Exclude all build outputs
dist/

out/

# Exclude all env files, but allow the example
.env*

!.env.example

# Keep a specific file inside an excluded folder
!dist/manifest.json
```

## 🔧 Feature Flags
SecureZip supports lightweight feature flags with both build-time defaults and runtime overrides.

- Runtime setting (recommended for users):
  - `secureZip.flags.enableStatusBarButton` (default: true)
- Build-time defaults (for maintainers):
  - `esbuild.js` injects `__BUILD_FLAGS__` using `define`, allowing different defaults per build.
- Rollout helpers:
  - `src/flags.ts` provides utilities to compute deterministic buckets from `machineId` if gradual rollout is needed.

Example `settings.json` override:

```json
{
  "secureZip.flags.enableStatusBarButton": false
}
```

## 🚀 Use Cases
- Delivering project source code to clients without leaking secrets.
- Creating reproducible “release snapshots” of work-in-progress.
- Archiving a clean, tagged version of your repository for audit or compliance.

## 🧾 SBOM
- `npm run sbom` generates `dist/securezip-sbom.cdx.json` in CycloneDX format so the extension bundle always ships with a fresh dependency inventory.
- The SBOM step also runs automatically after `npm run package`; see `docs/sbom.md` for details and customization tips.

## 📖 Roadmap
- Multiple archive formats (`.tar.gz`, `.7z`)
- Custom exclude profiles (`audit`, `distribution`, etc.)
- 🗂 **Manifest File** – Embed an `__export_manifest.json` with commit ID, tag, and export metadata (future candidate)

## 📥 Download
- Install from the VS Code Marketplace: [yugook.securezip](https://marketplace.visualstudio.com/items?itemName=yugook.securezip)

## 🛠 Developer Resources
- [Contributing guide](CONTRIBUTING.md) – setup, coding standards, and PR checklist.
- [Testing guide](docs/testing.md) – how to run type checks, linters, unit, and integration tests.
- [Release process](docs/releasing.md) – preview/stable branching strategy and versioning rules.
- [Architecture overview](docs/architecture.md) – maps key modules and data flows.
- [Multi-root workspaces](docs/multi-root-workspaces.md) – target resolution and workspace ZIP behavior.
- [Localization guide](docs/localization.md) – adding translations for runtime and contribution strings.
- [SBOM instructions](docs/sbom.md) – details about `npm run sbom` and the bundled CycloneDX file.
- Packaging preflight: run `npm run package:verify` before tagging/release to catch VS Code engine mismatches for `vsce`.

## 📄 License
SecureZip is distributed under the [MIT License](LICENSE).

---

# SecureZip（日本語）

**SecureZip** は、プロジェクトを安全かつクリーンな ZIP アーカイブとしてエクスポートできる Visual Studio Code 拡張機能です。

> エクスポートの安定版フロー（ignore 対応、自動コミット、タグ付け）を提供します。

## ✨ 機能
- 📦 **Export to ZIP** – プロジェクトをワンクリックで ZIP アーカイブとしてエクスポートします。
- 🔐 **暗号化 ZIP** – AES-256（WinZip AES）でパスワード保護した ZIP を生成できます。
- 🔄 **Auto Commit（任意設定）** – エクスポート前に追跡済み変更をコミットするよう確認し、必要であれば未追跡ファイルも自動ステージできます。
- 🏷 **Auto Tagging** – エクスポート時刻を利用してリポジトリにタグを付けます。
- 🧹 **スマートな除外サポート** – `.gitignore` と `.securezipignore` を尊重し、機密情報やビルド成果物を除外します。

## ⚙️ Auto Commit ステージモード
SecureZip が未コミット変更を検出したときだけ自動コミットを提案します。既定では `git add --update`（追跡済みファイルのみ）を実行しますが、設定で未追跡ファイルも含めるように切り替えられます。

```json
{
  "secureZip.autoCommit.stageMode": "all"
}
```

- `tracked`（既定）– 追跡済みファイルの変更/削除のみをステージ。
- `all` – 追跡済み＋未追跡ファイルをステージ（`git add --all` 相当）。

## 🏷 タグ付けモード
SecureZip はエクスポート時の追跡性向上のため、タグ付けの挙動を選択できます。

```json
{
  "secureZip.tagging.mode": "ask"
}
```

- `ask`（既定）– 毎回、デフォルトタグ/スキップ/カスタムを選択します。
- `always` – 常にデフォルトタグを作成します。
- `never` – タグ付けを行いません。

## 🔐 暗号化 ZIP

SecureZip は通常エクスポートに加えて、パスワード保護付きの ZIP を生成できま
す。コマンドパレットおよび SecureZip ビューのタイトルバーから次の 2 つのコマ
ンドを利用できます。

- `SecureZip: Export Encrypted ZIP`（`securezip.exportEncrypted`） – 単一
  ルート向けの暗号化エクスポート。
- `SecureZip: Export Workspace Encrypted ZIP`
  （`securezip.exportWorkspaceEncrypted`） – マルチルートワークスペース向け
  の暗号化エクスポート。

実行するとパスワードと確認入力の 2 段階のプロンプトが表示されます。不一致の
場合は再入力を求め、いずれかをキャンセルすると **ファイルを書き出さずに中断**
します。エントリ暗号化には **WinZip AES-256（method `99`）** を使用します。

### 互換性

WinZip AES-256 は 7-Zip / Keka / WinRAR / WinZip / macOS `unzip` 6.0+
（`-P` オプション）など、現代的な解凍ツールで広くサポートされていますが、
**Windows 標準の「圧縮フォルダー」ビューや古い `unzip` は AES 形式の ZIP を開
けません**。配布先で対応ツールが利用できることを確認してから共有してくださ
い。

### 保護されない情報

暗号化の対象は **ファイル本文のみ** です。次のメタ情報は保護されません。

- ファイル名・ディレクトリ構造・アーカイブ全体のレイアウト
- 各エントリのサイズ、タイムスタンプ、CRC、圧縮設定
- アーカイブが暗号化されているという事実そのもの

ファイル名や構成自体が機密に該当する場合は、ヘッダ暗号化に対応した外側のコ
ンテナ（例: 7z のヘッダ暗号化）でさらに包んでから共有してください。

### 失敗時の挙動と排他制御

- 暗号化 ZIP は出力先ディレクトリ内の一時ファイル `.partial` に書き出してか
  ら、成功時に最終ファイル名へリネームします。書き込みやリネームが失敗した
  場合は一時ファイルを削除し、**出力先に既存 ZIP があればそれは上書きされ
  ず保全されます**。
- Git の自動コミット / タグ付けは ZIP 書き出しの **前** に実行されます。ZIP
  書き出し以降の段階で失敗した場合、**直前の自動コミットやタグはリポジトリ
  に残る** ことがあります。`git log` / `git tag` を確認し、必要に応じて手動
  でロールバックしてください。
- 別のエクスポートが既に実行中のときに再実行を試みると、警告
  （"Export is already running."）を表示して **2 回目の起動は破棄** されま
  す。同時実行は行われません。

## 🛡 無視ルール
SecureZip はアーカイブに含めるファイルを選ぶ際、次のルールを尊重します。

- `.gitignore` – 自動的に適用されます。
- `.securezipignore` – エクスポート専用に除外や再包含を指定するプロジェクトルールです。
- SecureZip ビューのプレビューでは、`.securezipignore` > `.gitignore` > 自動除外の優先順で同一パターンを1行にまとめ、コメント/空行や未マッチ行は表示しません（抑制された出典はツールチップに表示）。

`.securezipignore` の構文（gitignore 互換のサブセット）:

- `# comment` や空行は無視されます。
- `pattern` は一致した項目を除外します。
- `!pattern` は一致した項目を再包含します（`.securezipignore` の除外のみを上書き）。
- `/path` はワークスペースルートからの相対パスです。
- `dir/` はディレクトリに一致し、`dir/**` に展開されます。

例:

```
# ビルド成果物を除外
dist/

out/

# env ファイルを除外（例外あり）
.env*

!.env.example

# 除外ディレクトリ内の特定ファイルは残す
!dist/manifest.json
```

## 🔧 機能フラグ
SecureZip は、ビルド時のデフォルトと実行時の上書きを組み合わせた軽量な機能フラグをサポートしています。

- ランタイム設定（ユーザー向け）:
  - `secureZip.flags.enableStatusBarButton`（デフォルト: true）
- ビルド時デフォルト（メンテナー向け）:
  - `esbuild.js` が `define` で `__BUILD_FLAGS__` を注入し、ビルドごとに異なるデフォルトを設定できます。
- 段階的ロールアウト支援:
  - `src/flags.ts` は `machineId` から決定的なバケットを算出するユーティリティを提供します。

`settings.json` での上書き例:

```json
{
  "secureZip.flags.enableStatusBarButton": false
}
```

## 🚀 ユースケース
- クライアントへのソースコード提供時に機密情報流出を防ぐ。
- 進行中の作業を再現可能な「リリーススナップショット」として保存する。
- 監査・コンプライアンス対応でタグ付きのクリーンなリポジトリ状態をアーカイブする。

## 🧾 SBOM
- `npm run sbom` で CycloneDX 形式の `dist/securezip-sbom.cdx.json` を生成し、拡張が依存関係の一覧を同梱できるようにしました。
- `npm run package` 完了後にも SBOM が自動出力されます。詳しくは `docs/sbom.md` を参照してください。

## 📖 ロードマップ
- 複数アーカイブ形式（`.tar.gz`、`.7z` など）への対応
- `audit` や `distribution` などのカスタム除外プロファイル
- 🗂 **Manifest File** – コミット ID、タグ、エクスポート情報を含む `__export_manifest.json` の埋め込み（将来的な候補）

## 📥 ダウンロード
- VS Code Marketplace からインストール: [yugook.securezip](https://marketplace.visualstudio.com/items?itemName=yugook.securezip)

## 🛠 開発者向けリソース
- [コントリビュートガイド](CONTRIBUTING.md) – セットアップ、コーディング規約、PR チェックリスト。
- [テストガイド](docs/testing.md) – 型チェック、lint、ユニット/インテグレーションテストの実行方法。
- [リリース手順](docs/releasing.md) – プレビュー/安定版のブランチ戦略とバージョンルール。
- [アーキテクチャ概要](docs/architecture.md) – 主要モジュールとデータフローの説明。
- [マルチルートワークスペース](docs/multi-root-workspaces.md) – ターゲット解決と Workspace ZIP の挙動。
- [ローカライズガイド](docs/localization.md) – 実行時・コントリビューション文字列への翻訳追加手順。
- [SBOM 手順](docs/sbom.md) – `npm run sbom` の詳細と同梱される CycloneDX ファイルについて。
- パッケージ前チェック: タグ/リリース前に `npm run package:verify` を実行して、VS Code エンジンの不整合で `vsce` が失敗しないか確認してください。

## 📄 ライセンス
SecureZip は [MIT License](LICENSE) で配布しています。
