# SecureZip

[![CodeQL](https://github.com/yugook/SecureZip/actions/workflows/codeql.yml/badge.svg)](https://github.com/yugook/SecureZip/actions/workflows/codeql.yml)
[![CI](https://github.com/yugook/SecureZip/actions/workflows/ci.yml/badge.svg)](https://github.com/yugook/SecureZip/actions/workflows/ci.yml)
[![Publish Release](https://github.com/yugook/SecureZip/actions/workflows/release.yml/badge.svg)](https://github.com/yugook/SecureZip/actions/workflows/release.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yugook.securezip?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=yugook.securezip)

**SecureZip** is a Visual Studio Code extension that lets you securely export your project as a clean ZIP archive.

> Release 1.0.0 – stable export workflow with ignore tooling, auto-commit, and tagging.

## ✨ Features
- 📦 **Export to ZIP** – Create a ZIP of your project with one click.
- 🔄 **Optional Auto Commit** – Offer to commit tracked changes before export.
- 🏷 **Auto Tagging** – Tag the repository with the export timestamp for traceability.
- 🧹 **Smart Ignore Support** – Respects `.gitignore` and project-specific `.securezipignore` to strip secrets and build artifacts.

## 🛡 Ignore Rules
SecureZip respects the following when selecting files to include:

- `.gitignore` – Acknowledged automatically.
- `.securezipignore` – Project rules to exclude and re-include files for export.

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
- Password-protected archives
- 🗂 **Manifest File** – Embed an `__export_manifest.json` with commit ID, tag, and export metadata (future candidate)

## 📥 Download
- Install from the VS Code Marketplace: [yugook.securezip](https://marketplace.visualstudio.com/items?itemName=yugook.securezip)
- Latest `.vsix` packages: [GitHub Releases](https://github.com/yugook/SecureZip/releases/latest)

## 📄 License
SecureZip is distributed under the [MIT License](LICENSE).

---

# SecureZip（日本語）

**SecureZip** は、プロジェクトを安全かつクリーンな ZIP アーカイブとしてエクスポートできる Visual Studio Code 拡張機能です。

> リリース 1.0.0 – エクスポートの安定版フロー（ignore 対応、自動コミット、タグ付け）を提供します。

## ✨ 機能
- 📦 **Export to ZIP** – プロジェクトをワンクリックで ZIP アーカイブとしてエクスポートします。
- 🔄 **Auto Commit（任意設定）** – エクスポート前に追跡済み変更をコミットするよう確認します。
- 🏷 **Auto Tagging** – エクスポート時刻を利用してリポジトリにタグを付けます。
- 🧹 **スマートな除外サポート** – `.gitignore` と `.securezipignore` を尊重し、機密情報やビルド成果物を除外します。

## 🛡 無視ルール
SecureZip はアーカイブに含めるファイルを選ぶ際、次のルールを尊重します。

- `.gitignore` – 自動的に適用されます。
- `.securezipignore` – エクスポート専用に除外や再包含を指定するプロジェクトルールです。

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
- パスワード保護付きアーカイブ
- 🗂 **Manifest File** – コミット ID、タグ、エクスポート情報を含む `__export_manifest.json` の埋め込み（将来的な候補）

## 📥 ダウンロード
- VS Code Marketplace からインストール: [yugook.securezip](https://marketplace.visualstudio.com/items?itemName=yugook.securezip)
- 最新 `.vsix` パッケージ: [GitHub Releases](https://github.com/yugook/SecureZip/releases/latest)

## 📄 ライセンス
SecureZip は [MIT License](LICENSE) で配布しています。
