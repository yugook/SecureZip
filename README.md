# SecureZip

**SecureZip** is a Visual Studio Code extension that lets you securely export your project as a clean ZIP archive.  
Unlike simple “zipper” tools, SecureZip is designed for developers who need safe and reproducible distributions.

## ✨ Features
- 📦 **Export to ZIP** – Create a ZIP of your project with one click.
- 🔄 **Auto Commit (optional)** – Automatically commit untracked changes before export.
- 🏷 **Auto Tagging** – Tag the repository with the export date for easy traceability.
- 🧹 **Secure Clean** – Exclude sensitive and unnecessary files (e.g. `.git`, `.env`, SSH keys, logs).

## 🛡 Ignore Rules
SecureZip respects the following when selecting files to include:

- `.gitignore`: Automatically respected.
- `.securezipignore`: Project-specific rules to exclude and re-include files for export.

`.securezipignore` syntax (gitignore-like subset):

- `# comment` and empty lines are ignored.
- `pattern` excludes matches.
- `!pattern` re-includes matches (overrides only `.securezipignore` excludes; it does not bypass `.gitignore`).
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
  - Configure via Settings UI or `settings.json`.
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

## 📖 Roadmap
- Support for multiple archive formats (`.tar.gz`, `.7z`)
- Custom exclude profiles (`audit`, `distribution`, etc.)
- Optional password-protected archives
- 🗂 **Manifest File** – Embed an `__export_manifest.json` with commit ID, tag, and export metadata (future candidate)

---

# SecureZip（日本語）

**SecureZip** は、プロジェクトを安全かつクリーンな ZIP アーカイブとしてエクスポートできる Visual Studio Code 拡張機能です。  
単なる「zipper」ツールとは異なり、SecureZip は安全で再現性のある配布物を求める開発者向けに設計されています。

## ✨ 機能
- 📦 **Export to ZIP** – プロジェクトをワンクリックで ZIP アーカイブとしてエクスポートします。
- 🔄 **Auto Commit (optional)** – エクスポート前に未追跡の変更を自動コミットします（任意設定）。
- 🏷 **Auto Tagging** – エクスポート日でリポジトリにタグを付け、追跡しやすくします。
- 🧹 **Secure Clean** – `.git` や `.env`、SSH キー、ログなどの機密ファイルや不要なファイルを除外します。

## 🛡 無視ルール
SecureZip はアーカイブに含めるファイルを選ぶ際、次のルールを尊重します。

- `.gitignore`: 自動的に適用されます。
- `.securezipignore`: エクスポート時の除外や再包含を制御するプロジェクト固有のルールです。

`.securezipignore` の構文（gitignore 互換のサブセット）:

- `# comment` や空行は無視されます。
- `pattern` は一致したファイル・フォルダーを除外します。
- `!pattern` は一致した項目を再包含します（`.securezipignore` による除外のみを上書きし、`.gitignore` は無効化しません）。
- `/path` はワークスペースルートからの相対パスとして扱われます。
- `dir/` はディレクトリに一致し、`dir/**` に展開されます。

例:

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

## 🔧 機能フラグ
SecureZip は、ビルド時のデフォルトと実行時の上書きを組み合わせた軽量な機能フラグをサポートしています。

- ランタイム設定（ユーザー向け推奨）:
  - `secureZip.flags.enableStatusBarButton`（デフォルト: true）
  - 設定 UI または `settings.json` から構成できます。
- ビルド時デフォルト（メンテナー向け）:
  - `esbuild.js` が `define` を使って `__BUILD_FLAGS__` を注入し、ビルドごとに異なるデフォルトを設定できます。
- 段階的ロールアウト支援:
  - `src/flags.ts` は `machineId` から決定的なバケットを算出するユーティリティを提供します。

`settings.json` での上書き例:

```json
{
  "secureZip.flags.enableStatusBarButton": false
}
```

## 🚀 ユースケース
- 機密情報を漏らさずにクライアントへソースコードを提供する。
- 進行中の作業を再現可能な「リリーススナップショット」として保存する。
- 監査・コンプライアンス対応のため、タグ付きのクリーンなリポジトリ状態をアーカイブする。

## 📖 ロードマップ
- 複数のアーカイブ形式（`.tar.gz`、`.7z` など）への対応
- `audit` や `distribution` などのカスタム除外プロファイル
- パスワード保護付きアーカイブ（任意設定）
- 🗂 **Manifest File** – コミット ID、タグ、エクスポートメタデータを含む `__export_manifest.json` を埋め込む機能（将来的な候補）

---
