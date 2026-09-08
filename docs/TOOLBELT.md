# 手元の tdx で ZIP を準備する

Treasure AI Studio を使わず、手元で Workflow を取得してブラウザへアップロードする場合の手順です。ここで作る ZIP は、ブラウザ版の client-only Workflow Visual Editor にローカルファイルとして渡します。

## 1. Workflow プロジェクトを取得する

利用環境に合わせて、次のいずれかを使います。

```sh
# Treasure Workflow の既存プロジェクトをローカルへダウンロード（legacy CLI）
# 現在の作業ディレクトリへプロジェクトを取得
td wf download <workflow-project>

# tdx CLI のプロジェクト同期を使う場合（第2引数で保存先を指定）
tdx wf pull <workflow-project> ./workflow-project
```

`td wf download` と `tdx wf pull` の引数やプロファイル指定は、インストール済み CLI のバージョンに合わせてください。どちらも取得だけに使い、`run` や `push` は実行しません。

## 2. （任意）テーブルのメタデータを収集する

スキーマ sidecar を付けると、SQL の参照元とカラムの対応をより正確に確認できます。Workflow の SQL から source table を拾い、行データを取得せず、各テーブルの定義だけを JSON で保存します。

```sh
tdx describe <database>.<table> --json > /tmp/table-schema.json
```

上記の出力をそのまま sidecar にするのではなく、`docs/SCHEMA_FORMAT.md` の `td-workflow-lineage-schema` / version `1` に合わせて、`databases[].tables[].columns[]` へ必要なメタデータだけを転記してください。サンプル値、行、クエリ結果、接続情報、認証情報は削除します。複数テーブルをまとめる場合も同じ階層に統合します。

sidecar の推奨パスは次のとおりです。

```text
workflow-project/
├── main.dig
├── queries/
└── schemas/
    └── workflow-inspector.schema.json
```

## 3. ローカルで ZIP を作る

このリポジトリのパッケージャーはローカルのフォルダを読むだけで、TD API や tdx を呼び出しません。

```sh
node scripts/package-workflow.mjs \
  --input ./workflow-project \
  --schema ./workflow-project/schemas/workflow-inspector.schema.json \
  --output ./workflow-project.zip
```

sidecar を用意できない場合は `--schema` を省略できます。

```sh
node scripts/package-workflow.mjs \
  --input ./workflow-project \
  --output ./workflow-project-no-schema.zip
```

スクリプトは入力フォルダ内の Workflow ソースを ZIP のルートへ格納し、指定された sidecar は `schemas/workflow-inspector.schema.json` として格納します。`--output` は入力フォルダの外に置いてください。

## 4. アップロード前チェック

- ZIP に `.dig`、SQL、設定・マニフェストが含まれている。
- sidecar を作った場合、`schemas/workflow-inspector.schema.json` が含まれている。
- `keys/`、`.env`、秘密鍵、認証情報、`secrets/`、`logs/`、ログが含まれていない。
- CSV/TSV/JSONL/NDJSON/Parquet などの行データやクエリ結果が含まれていない。
- `tdx wf run`、`tdx workflow run`、`tdx wf push`、`tdx workflow push` を実行していない。
- ZIP をブラウザにアップロードする前に、必要最小限のソースだけになっている。

## no-schema fallback

sidecar を収集できない場合でも、Workflow ファイルだけでアップロードできます。Inspector は SQL、Digdag の演算子、明示的なテーブル名・エイリアスから推定できる範囲を表示します。データベースのカラム型や完全なテーブル定義は不明扱いになるため、後から安全なメタデータだけを収集し、`--schema` 付きで再パッケージしてください。

ローカルの tdx 認証情報は、ZIP の外に置いたままにしてください。ブラウザ版へ渡すものは Workflow ソースと、秘密情報を含まない canonical schema だけです。
