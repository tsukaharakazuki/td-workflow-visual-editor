# Treasure AI Studio で ZIP を準備する

以下のプロンプトを Treasure AI Studio にそのまま貼り付けて使えます。`<GitHub リポジトリ URL>` だけ、対象リポジトリの URL に置き換えてください。

```text
あなたは Treasure AI Studio の作業環境で、Treasure Workflow のローカル解析用パッケージを作成してください。

対象 GitHub リポジトリ:
<GitHub リポジトリ URL>

目的:
このリポジトリにある Treasure Workflow プロジェクトを読み取り、ブラウザ版の client-only Workflow Visual Editor にアップロードできる ZIP を返してください。GitHub の内容を直接ブラウザへ送るのではなく、Studio の作業領域で一時的に取得・整理してから ZIP にしてください。

手順:
1. リポジトリを読み、Workflow プロジェクトの候補を確認してください。
2. 候補を一覧表示し、対象にする Workflow プロジェクトを私に選択してもらってください。選択前に勝手に push や実行をしないでください。
3. 選択後、Treasure Data の認証は Studio の実行環境に既に設定されているローカル tdx 認証だけを使ってください。認証情報を質問したり、ファイルに書いたり、GitHub や ZIP に含めたり、チャットへ出力したりしないでください。
4. 選択したプロジェクトを読み取り専用で取得するため、Studio 内で `tdx wf pull` を実行してください。利用可能な場合は対象 Workflow プロジェクトを明示してください。
5. Workflow が参照する source table を特定し、各テーブルについて `tdx describe <database>.<table> --json` を実行してください。取得するのはデータベース名、テーブル名、カラム名、型などのメタデータだけです。行データ、サンプル値、クエリ結果は取得・保存しないでください。
6. `schemas/workflow-inspector.schema.json` を作成し、`format` を `td-workflow-lineage-schema`、`version` を数値の `1` としてください。`databases[].tables[].columns[]` に source table のメタデータをまとめ、秘密情報を入れないでください。リポジトリに同じ契約の既存 sidecar があれば、内容を確認して必要なメタデータだけ更新してください。
7. Workflow のソースファイル（`.dig`、SQL、設定・マニフェストなど）と canonical schema sidecar を ZIP のルートから読める形でまとめてください。
8. 次のものは必ず除外してください: `keys/`、`.env` と `.env.*`、認証情報、トークン、秘密鍵、証明書、webhook、`secrets/`、`logs/`、ログファイル、CSV/TSV/JSONL/NDJSON/Parquet などの行データ、クエリ結果、ローカルキャッシュ。
9. ZIP の中身のファイル一覧を表示し、除外したパスがないこと、canonical schema が契約どおりであること、行データと秘密情報がないことを確認してください。
10. ZIP ファイルを成果物として返してください。返却後、ブラウザ版 Workflow Visual Editor にアップロードできるようにしてください。

安全制約:
- `tdx wf run`、`tdx workflow run`、`tdx wf push`、`tdx workflow push` は絶対に実行しないでください。
- Workflow の実行、スケジュール開始、外部通知、Webhook 呼び出し、メール送信、Activation は行わないでください。
- `tdx wf pull` と `tdx describe <database>.<table> --json` は読み取り専用の取得にだけ使ってください。
- GitHub リポジトリ、Workflow、テーブルの内容を変更しないでください。
- 認証情報は Studio のローカル実行環境の外へ出さないでください。
```

## Studio での確認ポイント

- 対象プロジェクトを選択してから取得すること。
- ZIP の中に `schemas/workflow-inspector.schema.json` があること。
- `format` と `version` が正しく、`databases` → `tables` → `columns` の階層になっていること。
- 行データ・サンプル値・ログ・認証情報が含まれていないこと。
- `run` や `push` を一度も実行していないこと。
