# Treasure AI Studio で ZIP を準備する

Workflow Visual Editor は、ZIP に入っている `schemas/workflow-inspector.schema.json` sidecar からカラム情報を読みます。sidecar が無い ZIP でも図は描けますが、カラムは SQL から推定した名前（カードに「推定」と表示）になり、型も付きません。**実テーブルにアクセスできる環境で ZIP を作るなら、sidecar を必ず入れてください。**

以下のプロンプトを Treasure AI Studio にそのまま貼り付けて使えます。`<対象>` だけ置き換えてください。GitHub リポジトリの URL でも、Workflow 名でも、`console.treasuredata.com` の Workflow URL でも構いません。

```text
あなたは Treasure AI Studio の作業環境で、Treasure Workflow のローカル解析用パッケージを作成してください。

対象:
<対象>

目的:
対象の Treasure Workflow プロジェクトを読み取り、ブラウザ版の client-only Workflow Visual Editor にアップロードできる ZIP を返してください。ZIP には Workflow のソース一式と、テーブルのカラム情報をまとめた canonical schema sidecar を含めます。

## 手順

1. 対象を読み、Workflow プロジェクトの候補を確認してください。候補が複数ある場合は一覧表示し、どれを対象にするか私に選択してもらってください。選択前に push や実行をしないでください。

2. Treasure Data の認証は、Studio の実行環境に既に設定されているローカル認証だけを使ってください。認証情報を質問したり、ファイルに書いたり、ZIP に含めたり、チャットへ出力したりしないでください。

3. Workflow プロジェクトを読み取り専用で取得してください（`tdx wf pull` など）。

4. 取得した `.dig` と SQL を読み、**このワークフローが読み書きするテーブルを漏れなく列挙**してください。対象は次のすべてです。
   - SQL の `FROM` / `JOIN` が参照するテーブル（入力）
   - `create_table:` / `insert_into:` / `CREATE TABLE` / `INSERT INTO` の書き込み先（出力）
   - 中間テーブル・一時テーブルも含める
   テーブル名が `${...}` で組み立てられている場合は、`_export` や `config/params.yml`、`!include` された値、`for_each>` の展開値を追って**実際のテーブル名に解決**してください。解決できないものは、その旨をメモして次に進んでください。

5. 列挙した各テーブルのカラム情報を取得してください。行データは一切取得しません。

   まとめて取れるので、データベース単位で information schema を引くのが確実です。対象データベースごとに Presto で実行してください。

   ```sql
   SELECT table_name, column_name, data_type, ordinal_position
   FROM information_schema.columns
   WHERE table_schema = '<database>'
   ORDER BY table_name, ordinal_position
   ```

   これが使えない環境では、テーブルごとに `tdx describe <database>.<table> --json` を使ってください。

   取得するのはデータベース名・テーブル名・カラム名・型・並び順だけです。`SELECT *` でのサンプル取得、行数カウント、値の確認はしないでください。

6. `schemas/workflow-inspector.schema.json` を作成してください。形式は次のとおりです。`format` は文字列、`version` は**数値の 1**（文字列の "1" ではない）です。

   ```json
   {
     "format": "td-workflow-lineage-schema",
     "version": 1,
     "project": "<プロジェクト名>",
     "workflow": "<エントリポイントの .dig>",
     "databases": [
       {
         "name": "llm_tsi",
         "tables": [
           {
             "name": "tsi_ca_cart_drop_weblog",
             "kind": "derived",
             "columns": [
               { "name": "time", "type": "bigint" },
               { "name": "user_id_comp", "type": "varchar" }
             ]
           }
         ]
       }
     ]
   }
   ```

   - 手順4で列挙した**入力テーブルと出力テーブルの両方**を入れてください。入力だけでは足りません。
   - `kind` は `source` / `derived` / `temporary` のいずれか。判断できなければ省略して構いません。
   - カラムの並びは information schema の `ordinal_position` 順にしてください。
   - 行データ、サンプル値、クエリ結果、認証情報は入れないでください。

7. Workflow のソースファイル（`.dig`、SQL、`config/`、`manifest.yml` など）と `schemas/workflow-inspector.schema.json` を、ZIP のルートから読める形でまとめてください。

8. 次のものは必ず除外してください: `keys/`、`.env` と `.env.*`、認証情報、トークン、秘密鍵、証明書、webhook、`secrets/`、`logs/`、ログファイル、CSV/TSV/JSONL/NDJSON/Parquet などの行データ、クエリ結果、ローカルキャッシュ。

9. **ZIP を返す前に、次を自分で確認して結果を報告してください。**
   - `schemas/workflow-inspector.schema.json` が ZIP に入っている
   - `format` が `td-workflow-lineage-schema`、`version` が数値の `1`
   - `databases[].tables[].columns[]` が**1件以上**入っている。空配列のテーブルがあれば、そのテーブル名を報告する
   - 手順4で列挙したテーブルのうち、sidecar に入っていないものがあれば、テーブル名と理由を報告する
   - 行データ・秘密情報が含まれていない

   カラムが1件も取れていない場合は、ZIP を返さずに、何が失敗したか（権限、テーブル不在、information schema が引けない等）を報告してください。

10. ZIP ファイルを成果物として返してください。

## 安全制約

- `tdx wf run`、`tdx workflow run`、`tdx wf push`、`tdx workflow push` は絶対に実行しないでください。
- Workflow の実行、スケジュール開始、外部通知、Webhook 呼び出し、メール送信、Activation は行わないでください。
- 取得は読み取り専用の操作だけに限ってください。
- 対象リポジトリ、Workflow、テーブルの内容を変更しないでください。
- 認証情報を Studio のローカル実行環境の外へ出さないでください。
```

## 受け取った ZIP の確認ポイント

- `schemas/workflow-inspector.schema.json` が入っているか。
- `format` と `version` が正しく、`databases` → `tables` → `columns` の階層になっているか。
- 入力テーブルだけでなく、出力・中間テーブルも入っているか。
- 行データ・サンプル値・ログ・認証情報が含まれていないか。
- `run` や `push` を一度も実行していないか。

## sidecar が無い ZIP を読み込んだとき

TD Toolbelt で落とした Workflow ZIP など、sidecar が無い場合、エディタは SQL からカラムを推定して表示します。

- 書き込み先のテーブルは、そのタスクの SELECT リストがカラムになります（`SELECT *` の場合は `*` が先頭に入ります）。
- 読み込み元のテーブルは、SQL 中でそのテーブルに対して参照されているカラム名が入ります。
- 推定であることはカードの「推定」バッジで示され、型は付きません。

正確なカラムと型が必要なときは、この文書のプロンプトで sidecar 付きの ZIP を作ってください。
