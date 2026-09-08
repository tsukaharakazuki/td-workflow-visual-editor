# Treasure Workflow Visual Editor

Treasure Workflow の構成を、ブラウザだけで確認するための client-only ビジュアルエディターです。ローカルで用意した Workflow プロジェクトの ZIP を読み込み、`.dig`、SQL、マニフェスト、任意の canonical schema sidecar を使って、タスクの流れ・演算子・テーブル lineage を確認します。

Treasure Data へ接続するバックエンドはこのアプリにはありません。Workflow の取得やテーブル定義の確認が必要な場合は、手元の `tdx` または Treasure AI Studio で読み取り専用に準備し、秘密情報を除いた ZIP をブラウザへ渡してください。

## ユーザー要件（5つ）

1. **Task Flow tabs** — 「タスクの流れ」ではタスク構造だけを、「タスク＋データの流れ」ではタスクとデータの流れを同じ画面で可視化します。従来の「テーブルリネージ」ではテーブル間のデータリネージだけを表示できます。
2. **SQL + Schema I/O** — `td>` が参照する SQL の `FROM` / `JOIN` と出力設定を解析し、canonical schema sidecar と組み合わせて入力・出力テーブルとカラムを表示します。
3. **Data Lineage** — ソースから中間テーブル、出力テーブルまでの流れをタスクに接続して追跡し、不確実な推定は confidence として明示します。
4. **Visual Editing** — Operator パレットからドラッグ＆ドロップまたはクリックで Task を追加し、初期表示を絞りつつ Show more から Workflow operators 全43種を選択できます。Task Tree で並べ替え、ゴミ箱へドロップして削除できます。Undo / Redo と `.dig` / SQL ソース編集も備えます。
5. **Full Project ZIP** — 未変更のバイナリを含む全ファイルを保持し、編集済み Workflow Project 一式を ZIP でダウンロードできます。

ブラウザから Treasure Data へは接続しません。実行・push・通知は行わず、TD API キーや行データを持ち込まないローカルファースト設計です。

## プライバシーアーキテクチャ

```text
tdx / Treasure AI Studio（ユーザーの環境）
  └─ 読み取り専用で Workflow と table metadata を取得
       └─ secret・keys・logs・row data を除外して ZIP 化
            └─ ブラウザのファイル選択
                 └─ React アプリが端末内で解析・表示
```

- アプリは静的ファイルとして配信され、Workflow ZIP をアプリのサーバーへアップロードしません。
- TD の API キー、`keys/`、`.env`、credential、token、webhook、秘密鍵は ZIP に含めません。アプリが認証を受け取る設計でもありません。
- canonical schema は名前・型などのメタデータだけを対象にし、行、サンプル値、クエリ結果を含めません。仕様は [`docs/SCHEMA_FORMAT.md`](./docs/SCHEMA_FORMAT.md) を参照してください。
- `tdx wf run` / `tdx workflow run` / `tdx wf push` / `tdx workflow push` は、この準備・閲覧フローでは実行しません。
- 配布前の ZIP 作成には [`scripts/package-workflow.mjs`](./scripts/package-workflow.mjs) を使えます。スクリプト自身は TD や `tdx` を呼び出さず、ローカルファイルだけを読み取ります。

## ZIP の準備

- [Treasure AI Studio 用のコピー＆ペーストプロンプト](./docs/TREASURE_AI_STUDIO.md)
- [手元の `td wf download` / `tdx wf pull` 手順](./docs/TOOLBELT.md)
- [canonical schema format](./docs/SCHEMA_FORMAT.md)
- [サンプル Workflow プロジェクト](./public/examples/sample-project/)

ローカルで取得済みのフォルダを、canonical schema 付きでパッケージする例です。

```sh
node scripts/package-workflow.mjs \
  --input ./workflow-project \
  --schema ./workflow-project/schemas/workflow-inspector.schema.json \
  --output ./workflow-project.zip
```

schema がない場合は `--schema` を省略できます。パッケージャーは `.env*`、keys・secrets・credentials、ログ、秘密鍵、代表的な行データ形式を除外します。除外内容を確認してから ZIP をアップロードしてください。

## ローカル開発

Node.js 22 以降を推奨します。

```sh
npm ci
npm run dev
```

開発サーバーが表示する URL をブラウザで開きます。型チェック込みの本番ビルドとローカルプレビューは次のコマンドです。

```sh
npm run build
npm run preview
```

lint を実行する場合:

```sh
npm run lint
```

## サンプル

`public/examples/sample-project/` には、実在の企業・顧客・認証情報・webhook・行データを含まない合成 fixture があります。`main.dig`、CTE と JOIN を含む SQL、`manifest.yml`、安全な `tdx.json`、`tasks/finalize.dig`、canonical schema sidecar を使って、Workflow Visual Editor の読み取りケースを確認できます。

## GitHub Pages への公開

このリポジトリには、`main` への push または手動実行で `npm ci` → `npm run build` → `dist` の Pages artifact 配布を行う [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) があります。公開する場合は、次の手順を実施してください。

1. GitHub リポジトリの **Settings → Pages** を開き、Source を **GitHub Actions** に設定します。
2. 変更を `main` ブランチへ push するか、Actions の **Deploy to GitHub Pages** を **Run workflow** で手動開始します。
3. Actions の build と deploy が成功したことを確認します。
4. GitHub が表示する Pages URL を、利用者へ案内します。

この README は公開手順を説明するものであり、現時点でサイトが公開済みであることを示すものではありません。
