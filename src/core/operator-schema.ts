/**
 * What each Digdag / Treasure Data operator actually accepts.
 *
 * The inspector reads this to show a task's real settings instead of one fixed
 * set of fields. Every entry is transcribed from the official documentation —
 * see `doc` on each definition — so a key that is not documented is not here,
 * and the inspector falls back to a plain key/value row for it.
 */

export type OperatorFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'duration'
  | 'list'
  | 'map'
  | 'sql'
  | 'tasks'
  | 'json'

export interface OperatorField {
  key: string
  type: OperatorFieldType
  /** Japanese label shown next to the input. */
  label: string
  /** One sentence of help, shown under the input. */
  help?: string
  required?: boolean
  /** Fixed choices, when the docs name them. */
  options?: readonly string[]
}

export interface OperatorDefinition {
  operator: string
  /** What the operator does, in one sentence. */
  summary: string
  /** Official documentation for this operator. */
  doc?: string
  /** What the value on the operator key itself means, when it takes one. */
  valueLabel?: string
  valueType?: OperatorFieldType
  fields: readonly OperatorField[]
}

const DIGDAG = (name: string) => `https://docs.digdag.io/operators/${name}.html`
const TD = (name: string) =>
  `https://docs.treasure.ai/ja/products/customer-data-platform/data-workbench/workflows/operators/${name}`

/** Shared by every Treasure Data operator that talks to the API. */
const TD_ENDPOINT: readonly OperatorField[] = [
  { key: 'endpoint', type: 'string', label: 'API エンドポイント', help: '接続先のAPIエンドポイント（既定: api.treasuredata.com）。' },
  { key: 'use_ssl', type: 'boolean', label: 'SSLを使用', help: 'エンドポイントへの接続にHTTPSを使います（既定: true）。' },
]

/** Shared by the Treasure Data operators that submit a query job. */
const TD_JOB: readonly OperatorField[] = [
  { key: 'engine', type: 'string', label: 'クエリエンジン', help: 'クエリを実行するエンジン。', options: ['trino', 'presto', 'hive'] },
  { key: 'priority', type: 'number', label: '優先度', help: 'ジョブの優先度を -2（最低）〜2（最高）で指定します（既定: 0）。' },
  { key: 'job_retry', type: 'number', label: 'ジョブリトライ回数', help: 'ジョブ失敗時の自動リトライ回数（既定: 0）。' },
  { key: 'presto_pool_name', type: 'string', label: 'Presto リソースプール', help: 'engine が presto のときに使うリソースプール名。' },
  { key: 'hive_pool_name', type: 'string', label: 'Hive リソースプール', help: 'engine が hive のときに使うリソースプール名。' },
  { key: 'engine_version', type: 'string', label: 'エンジンバージョン', help: 'Hive / Presto のエンジンバージョン。' },
  { key: 'hive_engine_version', type: 'string', label: 'Hive バージョン', help: 'engine が hive のとき engine_version より優先されます。' },
]

/** Shared by the JDBC-style database operators (pg>, redshift>). */
const JDBC_CONNECTION: readonly OperatorField[] = [
  { key: 'host', type: 'string', label: 'ホスト', help: 'データベースのホスト名またはIPアドレス。' },
  { key: 'port', type: 'number', label: 'ポート', help: '接続するポート番号。' },
  { key: 'user', type: 'string', label: 'ユーザー', help: 'データベースに接続するユーザー名。' },
  { key: 'ssl', type: 'boolean', label: 'SSL接続', help: 'SSLを有効にして接続します（既定: false）。' },
  { key: 'schema', type: 'string', label: 'スキーマ', help: '既定のスキーマ名（既定: public）。' },
  { key: 'strict_transaction', type: 'boolean', label: '厳密トランザクション', help: '重複レコードを防ぐ厳密なトランザクションを使います（既定: true）。' },
  { key: 'status_table_schema', type: 'string', label: 'ステータス表スキーマ', help: 'ステータステーブルのスキーマ名（既定: schema と同じ）。' },
  { key: 'status_table', type: 'string', label: 'ステータス表名', help: 'ステータステーブル名の接頭辞（既定: __digdag_status）。' },
  { key: 'password_override', type: 'string', label: 'パスワードのシークレットキー', help: '既定以外のパスワードを保持するシークレットのキー名。' },
]

/** Shared by the Redshift COPY / UNLOAD operators. */
const REDSHIFT_CREDENTIALS: readonly OperatorField[] = [
  { key: 'temp_credentials', type: 'boolean', label: '一時認証情報', help: '一時的なセキュリティ認証情報を使います（既定: true）。' },
  { key: 'session_duration', type: 'number', label: 'セッション有効期間', help: '一時認証情報の有効期間（既定: 3時間）。' },
]

/**
 * Task keys Digdag accepts on any task, whatever the operator. Kept apart from
 * the operator fields so the inspector can group them under their own heading.
 */
export const COMMON_TASK_FIELDS: readonly OperatorField[] = [
  { key: '_export', type: 'map', label: '_export', help: 'このタスクと配下の子タスクに渡す変数。' },
  { key: '_parallel', type: 'json', label: '_parallel', help: '子タスクを並列実行します。true か {limit: N}。' },
  { key: '_background', type: 'boolean', label: '_background', help: '直前のタスクと並行して実行し、次のタスクをブロックします。' },
  { key: '_retry', type: 'json', label: '_retry', help: '失敗時のリトライ回数。{limit, interval, interval_type} も指定できます。' },
  { key: '_error', type: 'tasks', label: '_error', help: 'このタスクが失敗したときに実行するタスク。' },
  { key: '_check', type: 'tasks', label: '_check', help: 'このタスクが成功したあとに実行する確認タスク。' },
]

const DEFINITIONS: readonly OperatorDefinition[] = [
  // ---- Treasure Data -----------------------------------------------------
  {
    operator: 'td>',
    summary: 'Treasure Data でクエリを実行します。',
    doc: DIGDAG('td'),
    valueLabel: '実行する .sql ファイルのパス、またはクエリ本文',
    valueType: 'sql',
    fields: [
      { key: 'query', type: 'sql', label: 'クエリ', help: 'インラインで書くクエリ。`${...}` を埋め込めます。' },
      { key: 'database', type: 'string', label: 'データベース', help: 'クエリを実行するデータベース名。' },
      { key: 'create_table', type: 'string', label: 'CREATE TABLE', help: '結果から作り直すテーブル名。' },
      { key: 'insert_into', type: 'string', label: 'INSERT INTO', help: '結果を追記するテーブル名。' },
      ...TD_JOB,
      { key: 'download_file', type: 'string', label: 'CSV保存先', help: 'クエリ結果をローカルのCSVファイルに保存します。' },
      { key: 'store_last_results', type: 'boolean', label: '結果を変数に格納', help: '結果の先頭1行を ${td.last_results} に入れます（既定: false）。' },
      { key: 'preview', type: 'boolean', label: '結果プレビュー', help: 'クエリ結果の一部をログに表示します。' },
      { key: 'result_url', type: 'string', label: '結果の出力先URL', help: 'クエリ結果を外部URLへ出力します。' },
      { key: 'result_connection', type: 'string', label: '結果コネクション', help: '結果を外部システムへ書き出すコネクション名。' },
      { key: 'result_settings', type: 'map', label: 'コネクション設定', help: '結果コネクションへの追加設定。' },
      ...TD_ENDPOINT,
    ],
  },
  {
    operator: 'td_run>',
    summary: 'Treasure Data の保存済みクエリを実行します。',
    doc: DIGDAG('td_run'),
    valueLabel: '実行する保存済みクエリのIDまたは名前',
    fields: [
      { key: 'database', type: 'string', label: 'データベース', help: 'クエリを実行するデータベース名。' },
      { key: 'create_table', type: 'string', label: 'CREATE TABLE', help: '結果から作り直すテーブル名。' },
      { key: 'insert_into', type: 'string', label: 'INSERT INTO', help: '結果を追記するテーブル名。' },
      { key: 'session_time', type: 'string', label: 'セッション時刻', help: '保存済みクエリに渡すセッション時刻（例: 2016-01-01T01:01:01+00:00）。' },
      { key: 'download_file', type: 'string', label: 'CSV保存先', help: 'クエリ結果をローカルのCSVファイルに保存します。' },
      { key: 'store_last_results', type: 'boolean', label: '結果を変数に格納', help: '結果の先頭1行を ${td.last_results} に入れます（既定: false）。' },
      { key: 'preview', type: 'boolean', label: '結果プレビュー', help: 'クエリ結果の一部をログに表示します。' },
      ...TD_ENDPOINT,
    ],
  },
  {
    operator: 'td_ddl>',
    summary: 'Treasure Data のテーブルやデータベースを作成・削除・リネームします。',
    doc: DIGDAG('td_ddl'),
    fields: [
      { key: 'create_tables', type: 'list', label: 'テーブル作成', help: '無ければ作成します。' },
      { key: 'empty_tables', type: 'list', label: 'テーブル空作成', help: '既にあれば削除してから作成します。' },
      { key: 'drop_tables', type: 'list', label: 'テーブル削除', help: 'あれば削除します。' },
      { key: 'rename_tables', type: 'json', label: 'テーブル名変更', help: '{from:, to:} の配列。宛先が既にあれば上書きします。' },
      { key: 'create_databases', type: 'list', label: 'データベース作成', help: '無ければ作成します。' },
      { key: 'empty_databases', type: 'list', label: 'データベース空作成', help: '既にあれば削除してから作成します。' },
      { key: 'drop_databases', type: 'list', label: 'データベース削除', help: 'あれば削除します。' },
      { key: 'database', type: 'string', label: 'データベース', help: '操作対象のデータベース名。' },
      ...TD_ENDPOINT,
    ],
  },
  {
    operator: 'td_load>',
    summary: '外部のストレージやサービスから Treasure Data にデータを取り込みます。',
    doc: DIGDAG('td_load'),
    valueLabel: 'YAMLテンプレートのパス、または保存済みコネクタジョブのID',
    fields: [
      { key: 'database', type: 'string', label: '取込先データベース', help: 'データを取り込む先のデータベース名。', required: true },
      { key: 'table', type: 'string', label: '取込先テーブル', help: 'データを取り込む先のテーブル名。', required: true },
      ...TD_ENDPOINT,
    ],
  },
  {
    operator: 'td_for_each>',
    summary: 'クエリ結果の行ごとに子タスクを繰り返します。',
    doc: DIGDAG('td_for_each'),
    valueLabel: '実行する .sql ファイルのパス',
    valueType: 'sql',
    fields: [
      { key: '_do', type: 'tasks', label: '実行するタスク', help: '各行で実行する子タスク。${td.each.カラム名} で値を参照します。', required: true },
      { key: 'query', type: 'sql', label: 'クエリ', help: 'インラインで書くクエリ。' },
      { key: 'database', type: 'string', label: 'データベース', help: 'クエリを実行するデータベース名。' },
      ...TD_JOB,
      ...TD_ENDPOINT,
    ],
  },
  {
    operator: 'td_wait>',
    summary: 'クエリが true を返すまで定期的に実行して待ちます。',
    doc: DIGDAG('td_wait'),
    valueLabel: '判定に使う .sql ファイルのパス',
    valueType: 'sql',
    fields: [
      { key: 'database', type: 'string', label: 'データベース', help: 'クエリを実行するデータベース名。' },
      { key: 'interval', type: 'duration', label: '確認間隔', help: 'クエリを再実行する間隔（既定: 30s）。' },
      ...TD_JOB,
      ...TD_ENDPOINT,
    ],
  },
  {
    operator: 'td_wait_table>',
    summary: 'テーブルに指定件数のレコードが入るまで待ちます。',
    doc: DIGDAG('td_wait_table'),
    valueLabel: '監視対象のテーブル名',
    fields: [
      { key: 'rows', type: 'number', label: '待機件数', help: '待つレコード件数（既定: 0）。' },
      { key: 'database', type: 'string', label: 'データベース', help: '対象テーブルが属するデータベース名。' },
      { key: 'interval', type: 'duration', label: '確認間隔', help: 'テーブルを確認する間隔（既定: 30s）。' },
      ...TD_JOB,
      ...TD_ENDPOINT,
    ],
  },
  {
    operator: 'td_partial_delete>',
    summary: 'テーブルから指定した時間範囲のレコードを削除します（非推奨）。',
    doc: DIGDAG('td_partial_delete'),
    valueLabel: '削除対象のテーブル名',
    fields: [
      { key: 'database', type: 'string', label: 'データベース', help: '対象テーブルが属するデータベース名。', required: true },
      { key: 'from', type: 'string', label: '開始時刻', help: '削除範囲の開始（この時刻を含む）。UNIX時刻またはISO-8601。', required: true },
      { key: 'to', type: 'string', label: '終了時刻', help: '削除範囲の終了（この時刻を含まない）。UNIX時刻またはISO-8601。', required: true },
      ...TD_ENDPOINT,
    ],
  },
  {
    operator: 'td_table_export>',
    summary: 'Treasure Data のテーブルを Amazon S3 へ書き出します。',
    doc: DIGDAG('td_table_export'),
    fields: [
      { key: 'database', type: 'string', label: 'データベース', help: 'エクスポート元のデータベース名。', required: true },
      { key: 'table', type: 'string', label: 'テーブル', help: 'エクスポート対象のテーブル名。', required: true },
      { key: 'file_format', type: 'string', label: 'ファイル形式', help: '出力形式。', required: true, options: ['tsv.gz', 'jsonl.gz'] },
      { key: 'from', type: 'string', label: '開始時刻', help: '出力範囲の開始（この時刻を含む）。', required: true },
      { key: 'to', type: 'string', label: '終了時刻', help: '出力範囲の終了（この時刻を含まない）。', required: true },
      { key: 's3_bucket', type: 'string', label: 'S3バケット', help: '出力先のS3バケット名。', required: true },
      { key: 's3_path_prefix', type: 'string', label: 'S3パス接頭辞', help: '出力ファイル名の接頭辞。', required: true },
      ...TD_ENDPOINT,
    ],
  },
  {
    operator: 'td_result_export>',
    summary: '既存ジョブの結果を外部システムへ書き出します。',
    doc: DIGDAG('td_result_export'),
    fields: [
      { key: 'job_id', type: 'number', label: 'ジョブID', help: 'エクスポート対象のジョブID。${td.last_job_id} も使えます。', required: true },
      { key: 'result_connection', type: 'string', label: '結果コネクション', help: '結果を書き出す外部システムのコネクション名。', required: true },
      { key: 'result_settings', type: 'map', label: 'コネクション設定', help: 'コネクションへの追加設定（bucket、path など）。' },
    ],
  },

  // ---- Workflow control ---------------------------------------------------
  {
    operator: 'call>',
    summary: '別のワークフローを埋め込んで、完了まで待ちます。',
    doc: DIGDAG('call'),
    valueLabel: '呼び出すワークフロー定義ファイル（.dig）のパス',
    fields: [],
  },
  {
    operator: 'http_call>',
    summary: 'HTTP で取得した内容をワークフローとして実行します。',
    doc: DIGDAG('http_call'),
    valueLabel: 'ワークフローを取得するURI',
    fields: [
      { key: 'content_type_override', type: 'string', label: 'Content-Type の上書き', help: 'サーバーの Content-Type を上書きします。', options: ['application/x-yaml', 'application/json'] },
      { key: 'method', type: 'string', label: 'HTTPメソッド', help: 'リクエストのメソッド（既定: GET）。' },
      { key: 'content', type: 'json', label: 'リクエストボディ', help: '送信する内容。' },
      { key: 'content_format', type: 'string', label: 'ボディの形式', help: 'content のシリアライズ形式。', options: ['text', 'json', 'form'] },
      { key: 'content_type', type: 'string', label: 'Content-Type', help: '推測された Content-Type を上書きします。' },
      { key: 'headers', type: 'map', label: '追加ヘッダ', help: 'リクエストに付けるヘッダ。' },
      { key: 'retry', type: 'boolean', label: 'リトライ', help: '一時的なエラーで再試行します（GET などは既定 true）。' },
      { key: 'timeout', type: 'number', label: 'タイムアウト秒', help: 'HTTP操作のタイムアウト秒数（既定: 30）。' },
    ],
  },
  {
    operator: 'require>',
    summary: '別のワークフローの完了を要求します。',
    doc: DIGDAG('require'),
    valueLabel: '依存するワークフローの名前',
    fields: [
      { key: 'session_time', type: 'string', label: 'セッション時刻', help: '対象ワークフローのセッション時刻をタイムゾーン付きISO形式で指定します。' },
      { key: 'project_id', type: 'number', label: 'プロジェクトID', help: '他プロジェクトのワークフローをIDで指定します。' },
      { key: 'project_name', type: 'string', label: 'プロジェクト名', help: '他プロジェクトのワークフローを名前で指定します。' },
      { key: 'rerun_on', type: 'string', label: '再実行条件', help: '既にattemptがある場合の再実行条件（既定: none）。', options: ['none', 'failed', 'all'] },
      { key: 'ignore_failure', type: 'boolean', label: '失敗を無視', help: '依存先が失敗しても、このタスクは失敗扱いにしません。' },
      { key: 'params', type: 'map', label: '受け渡しパラメータ', help: '呼び出すワークフローに渡すパラメータ。' },
    ],
  },
  {
    operator: 'loop>',
    summary: '子タスクを指定回数繰り返します。',
    doc: DIGDAG('loop'),
    valueLabel: '繰り返す回数（0から始まる ${i} が渡ります）',
    valueType: 'number',
    fields: [
      { key: '_do', type: 'tasks', label: '実行するタスク', help: '繰り返し実行する子タスク。', required: true },
      { key: '_parallel', type: 'json', label: '並列実行', help: 'true で並列、{limit: N} で同時実行数を制限します。' },
    ],
  },
  {
    operator: 'for_each>',
    summary: '値の組み合わせごとに子タスクを繰り返します。',
    doc: DIGDAG('for_each'),
    valueLabel: 'ループさせる変数（key: [value, ...]）',
    valueType: 'map',
    fields: [
      { key: '_do', type: 'tasks', label: '実行するタスク', help: '各組み合わせで実行する子タスク。', required: true },
      { key: '_parallel', type: 'json', label: '並列実行', help: 'true で並列、{limit: N} で同時実行数を制限します。' },
    ],
  },
  {
    operator: 'for_range>',
    summary: '数値の範囲を分割し、区間ごとに子タスクを繰り返します。',
    doc: DIGDAG('for_range'),
    fields: [
      { key: 'from', type: 'number', label: '開始値', help: '範囲の開始となる数値。', required: true },
      { key: 'to', type: 'number', label: '終了値', help: '範囲の終了となる数値。', required: true },
      { key: 'slices', type: 'number', label: '分割数', help: '範囲を何分割するか。step との併用はエラーです。' },
      { key: 'step', type: 'number', label: '分割幅', help: '1区間あたりの幅。slices との併用はエラーです。' },
      { key: '_do', type: 'tasks', label: '実行するタスク', help: '各区間で実行する子タスク。${range.from} などが渡ります。', required: true },
      { key: '_parallel', type: 'json', label: '並列実行', help: 'true で並列、{limit: N} で同時実行数を制限します。' },
    ],
  },
  {
    operator: 'if>',
    summary: '条件によって実行する子タスクを切り替えます。',
    doc: DIGDAG('if'),
    valueLabel: 'true か false と評価される条件',
    fields: [
      { key: '_do', type: 'tasks', label: 'true のとき', help: '条件が true の場合に実行するタスク。' },
      { key: '_else_do', type: 'tasks', label: 'false のとき', help: '条件が false の場合に実行するタスク。' },
    ],
  },
  {
    operator: 'fail>',
    summary: '常に失敗してワークフローを失敗させます。',
    doc: DIGDAG('fail'),
    valueLabel: '失敗メッセージ（_error から ${error.message} で参照できます）',
    fields: [],
  },
  {
    operator: 'echo>',
    summary: 'メッセージをログに出力します。',
    doc: DIGDAG('echo'),
    valueLabel: '表示するメッセージ',
    fields: [],
  },
  {
    operator: 'wait>',
    summary: '指定した時間だけ待機します。',
    doc: DIGDAG('wait'),
    valueLabel: '待機する時間（例: 10s）',
    valueType: 'duration',
    fields: [
      { key: 'blocking', type: 'boolean', label: 'ブロッキング待機', help: 'agent をブロックしたまま待ち続けます（既定: false）。' },
      { key: 'poll_interval', type: 'duration', label: 'ポーリング間隔', help: 'ノンブロッキング時に経過を確認する間隔。' },
    ],
  },

  // ---- Scripting ----------------------------------------------------------
  {
    operator: 'py>',
    summary: 'Python のメソッドを実行します。',
    doc: DIGDAG('py'),
    valueLabel: '実行するメソッド名（[PACKAGE.CLASS.]METHOD）',
    fields: [
      { key: 'python', type: 'string', label: 'Python実行コマンド', help: '使う python のパスまたはコマンド（既定: python）。' },
    ],
  },
  {
    operator: 'rb>',
    summary: 'Ruby のメソッドを実行します。',
    doc: DIGDAG('rb'),
    valueLabel: '実行するメソッド名（[MODULE::CLASS.]METHOD）',
    fields: [
      { key: 'require', type: 'string', label: 'requireするファイル', help: 'メソッド実行前に require するファイル名。' },
      { key: 'ruby', type: 'string', label: 'Ruby実行コマンド', help: '使う ruby のパスまたはコマンド（既定: ruby）。' },
    ],
  },
  {
    operator: 'sh>',
    summary: 'シェルコマンドを実行します。',
    doc: DIGDAG('sh'),
    valueLabel: '実行するコマンドと引数',
    fields: [
      { key: 'shell', type: 'list', label: 'シェル', help: '/bin/sh の代わりに使うシェルとその引数。' },
    ],
  },
  {
    operator: 'embulk>',
    summary: 'Embulk でデータ転送を実行します（非推奨）。',
    doc: DIGDAG('embulk'),
    valueLabel: 'Embulk の設定ファイルのパス',
    fields: [],
  },

  // ---- Params -------------------------------------------------------------
  {
    operator: 'param_get>',
    summary: 'ParamServer から値を取得して store パラメータに入れます。',
    doc: DIGDAG('param_get'),
    fields: [],
  },
  {
    operator: 'param_set>',
    summary: '値を ParamServer に保存します（TTL 90日）。',
    doc: DIGDAG('param_set'),
    fields: [],
  },

  // ---- Network ------------------------------------------------------------
  {
    operator: 'mail>',
    summary: 'メールを送信します。',
    doc: DIGDAG('mail'),
    valueLabel: '本文テンプレートファイルのパス、または本文',
    fields: [
      { key: 'subject', type: 'string', label: '件名', help: 'メールの件名。', required: true },
      { key: 'to', type: 'list', label: '宛先', help: '宛先メールアドレスの一覧。', required: true },
      { key: 'from', type: 'string', label: '差出人', help: '差出人のメールアドレス。', required: true },
      { key: 'cc', type: 'list', label: 'CC', help: 'CCのメールアドレス一覧。' },
      { key: 'bcc', type: 'list', label: 'BCC', help: 'BCCのメールアドレス一覧。' },
      { key: 'html', type: 'boolean', label: 'HTMLメール', help: 'HTMLメールとして送ります（既定: false）。' },
      { key: 'attach_files', type: 'json', label: '添付ファイル', help: 'path / content_type / filename を持つ添付の一覧。' },
      { key: 'host', type: 'string', label: 'SMTPホスト', help: 'シークレットの設定を上書きします。' },
      { key: 'port', type: 'number', label: 'SMTPポート', help: 'シークレットの設定を上書きします。' },
      { key: 'username', type: 'string', label: 'SMTPユーザー', help: 'シークレットの設定を上書きします。' },
      { key: 'tls', type: 'boolean', label: 'TLS', help: 'TLSハンドシェイクを有効にします。' },
      { key: 'ssl', type: 'boolean', label: 'SSL', help: '旧来のSSL暗号化を有効にします。' },
      { key: 'debug', type: 'boolean', label: 'デバッグログ', help: 'デバッグログを表示します（既定: false）。' },
    ],
  },
  {
    operator: 'http>',
    summary: 'HTTPリクエストを送信します。',
    doc: DIGDAG('http'),
    valueLabel: 'リクエスト先のURI',
    fields: [
      { key: 'method', type: 'string', label: 'メソッド', help: 'HTTPメソッド（既定: GET）。' },
      { key: 'content', type: 'json', label: 'リクエストボディ', help: '送信する本文。' },
      { key: 'content_format', type: 'string', label: 'ボディの形式', help: '本文のシリアライズ形式。', options: ['text', 'json', 'form'] },
      { key: 'content_type', type: 'string', label: 'Content-Type', help: '推測された Content-Type を上書きします。' },
      { key: 'store_content', type: 'boolean', label: 'レスポンスを保存', help: 'レスポンス本文を保存します（既定: false）。' },
      { key: 'headers', type: 'map', label: '追加ヘッダー', help: 'リクエストに付けるヘッダー。' },
      { key: 'retry', type: 'boolean', label: 'リトライ', help: '一時的なエラーで再試行します。' },
      { key: 'timeout', type: 'number', label: 'タイムアウト（秒）', help: 'HTTP通信のタイムアウト秒数（既定: 30）。' },
    ],
  },

  // ---- Databases ----------------------------------------------------------
  {
    operator: 'pg>',
    summary: 'PostgreSQL でクエリやDDLを実行します。',
    doc: DIGDAG('pg'),
    valueLabel: '実行するクエリテンプレートファイルのパス',
    valueType: 'sql',
    fields: [
      { key: 'database', type: 'string', label: 'データベース名', help: '接続先のデータベース名。' },
      { key: 'create_table', type: 'string', label: 'CREATE TABLE', help: '結果から作り直すテーブル名。' },
      { key: 'insert_into', type: 'string', label: 'INSERT INTO', help: '結果を追記するテーブル名。' },
      { key: 'download_file', type: 'string', label: 'CSV保存先', help: 'クエリ結果を保存するローカルCSVファイル名。' },
      { key: 'store_last_results', type: 'string', label: '結果の保存', help: '結果を pg.last_results に保存します。', options: ['false', 'first', 'all'] },
      ...JDBC_CONNECTION,
    ],
  },
  {
    operator: 'databricks>',
    summary: 'Databricks でSQLを実行します（Treasure Data 拡張）。',
    doc: TD('databricks'),
    fields: [],
  },
  {
    operator: 'snowflake>',
    summary: 'Snowflake でSQLを実行します（Treasure Data 拡張）。',
    doc: TD('snowflake'),
    fields: [],
  },

  // ---- AWS ----------------------------------------------------------------
  {
    operator: 's3_wait>',
    summary: 'S3 にファイルが現れるまで待ちます。',
    doc: DIGDAG('s3_wait'),
    valueLabel: '待機するファイルのパス（BUCKET/KEY）',
    fields: [
      { key: 'region', type: 'string', label: 'リージョン', help: 'S3 にアクセスするAWSリージョン。' },
      { key: 'endpoint', type: 'string', label: 'エンドポイント', help: 'S3のエンドポイント。region 設定を上書きします。' },
      { key: 'bucket', type: 'string', label: 'バケット', help: '対象ファイルのS3バケット名。' },
      { key: 'key', type: 'string', label: 'キー', help: '対象ファイルのS3キー。' },
      { key: 'version_id', type: 'string', label: 'バージョンID', help: '確認対象とするオブジェクトのバージョン。' },
      { key: 'path_style_access', type: 'boolean', label: 'パススタイルアクセス', help: 'パススタイルと仮想ホスト形式を切り替えます。' },
      { key: 'timeout', type: 'duration', label: 'タイムアウト', help: '待機のタイムアウト時間。' },
      { key: 'continue_on_timeout', type: 'boolean', label: 'タイムアウト時に継続', help: 'タイムアウトしてもタスクを成功として終えます（既定: false）。' },
    ],
  },
  { operator: 's3_copy>', summary: 'S3 内でファイルをコピーします（Treasure Data 拡張）。', doc: TD('s3_copy'), fields: [] },
  { operator: 's3_delete>', summary: 'S3 のファイルを削除します（Treasure Data 拡張）。', doc: TD('s3_delete'), fields: [] },
  { operator: 's3_move>', summary: 'S3 内でファイルを移動します（Treasure Data 拡張）。', doc: TD('s3_move'), fields: [] },
  {
    operator: 'redshift>',
    summary: 'Amazon Redshift でクエリやDDLを実行します。',
    doc: DIGDAG('redshift'),
    valueLabel: '実行するSQLクエリファイルのパス',
    valueType: 'sql',
    fields: [
      { key: 'database', type: 'string', label: 'データベース名', help: '接続先のデータベース名。', required: true },
      { key: 'create_table', type: 'string', label: 'CREATE TABLE', help: '結果から作り直すテーブル名。' },
      { key: 'insert_into', type: 'string', label: 'INSERT INTO', help: '結果を追記するテーブル名。' },
      { key: 'download_file', type: 'string', label: 'CSV保存先', help: 'クエリ結果を保存するローカルCSVファイル名。' },
      { key: 'store_last_results', type: 'string', label: '結果の保存', help: '結果を redshift.last_results に保存します。', options: ['false', 'first', 'all'] },
      ...JDBC_CONNECTION,
      { key: 'connect_timeout', type: 'duration', label: '接続タイムアウト', help: 'ソケット接続のタイムアウト（既定: 30s）。' },
      { key: 'socket_timeout', type: 'duration', label: '読み取りタイムアウト', help: 'ソケット読み取りのタイムアウト（既定: 1800s）。' },
      { key: 'status_table_cleanup', type: 'duration', label: 'ステータス表の掃除間隔', help: 'ステータステーブルを掃除する間隔（既定: 24h）。' },
    ],
  },
  {
    operator: 'redshift_load>',
    summary: 'COPY 文で外部ストレージから Redshift にロードします。',
    doc: DIGDAG('redshift_load'),
    fields: [
      { key: 'database', type: 'string', label: 'データベース名', help: '接続先のデータベース名。', required: true },
      { key: 'table', type: 'string', label: 'ロード先テーブル', help: 'データをロードするテーブル名。', required: true },
      { key: 'from', type: 'string', label: 'ロード元URI', help: 'COPY 文の FROM に対応するURI。', required: true },
      ...JDBC_CONNECTION,
      { key: 'manifest', type: 'boolean', label: 'MANIFEST', help: 'COPY 文の MANIFEST。' },
      { key: 'encrypted', type: 'boolean', label: 'ENCRYPTED', help: 'COPY 文の ENCRYPTED。' },
      { key: 'readratio', type: 'number', label: 'READRATIO', help: 'COPY 文の READRATIO。' },
      { key: 'region', type: 'string', label: 'REGION', help: 'COPY 文の REGION。' },
      { key: 'csv', type: 'string', label: 'CSV', help: 'COPY 文の CSV。既定の引用符なら空文字を指定します。' },
      { key: 'delimiter', type: 'string', label: 'DELIMITER', help: 'COPY 文の DELIMITER。' },
      { key: 'json', type: 'string', label: 'JSON', help: 'COPY 文の JSON に対応するURI。' },
      { key: 'avro', type: 'string', label: 'AVRO', help: 'COPY 文の AVRO に対応するURI。' },
      { key: 'fixedwidth', type: 'string', label: 'FIXEDWIDTH', help: 'COPY 文の FIXEDWIDTH。' },
      { key: 'gzip', type: 'boolean', label: 'GZIP', help: 'COPY 文の GZIP。' },
      { key: 'bzip2', type: 'boolean', label: 'BZIP2', help: 'COPY 文の BZIP2。' },
      { key: 'lzop', type: 'boolean', label: 'LZOP', help: 'COPY 文の LZOP。' },
      { key: 'acceptanydate', type: 'boolean', label: 'ACCEPTANYDATE', help: 'COPY 文の ACCEPTANYDATE。' },
      { key: 'acceptinvchars', type: 'string', label: 'ACCEPTINVCHARS', help: 'COPY 文の ACCEPTINVCHARS。' },
      { key: 'blanksasnull', type: 'boolean', label: 'BLANKSASNULL', help: 'COPY 文の BLANKSASNULL。' },
      { key: 'dateformat', type: 'string', label: 'DATEFORMAT', help: 'COPY 文の DATEFORMAT。' },
      { key: 'emptyasnull', type: 'boolean', label: 'EMPTYASNULL', help: 'COPY 文の EMPTYASNULL。' },
      { key: 'encoding', type: 'string', label: 'ENCODING', help: 'COPY 文の ENCODING。' },
      { key: 'escape', type: 'boolean', label: 'ESCAPE', help: 'COPY 文の ESCAPE。' },
      { key: 'explicit_ids', type: 'boolean', label: 'EXPLICIT_IDS', help: 'COPY 文の EXPLICIT_IDS。' },
      { key: 'fillrecord', type: 'boolean', label: 'FILLRECORD', help: 'COPY 文の FILLRECORD。' },
      { key: 'ignoreblanklines', type: 'boolean', label: 'IGNOREBLANKLINES', help: 'COPY 文の IGNOREBLANKLINES。' },
      { key: 'ignoreheader', type: 'number', label: 'IGNOREHEADER', help: 'COPY 文の IGNOREHEADER（読み飛ばす行数）。' },
      { key: 'null_as', type: 'string', label: 'NULL AS', help: 'COPY 文の NULL AS。' },
      { key: 'removequotes', type: 'boolean', label: 'REMOVEQUOTES', help: 'COPY 文の REMOVEQUOTES。' },
      { key: 'roundec', type: 'boolean', label: 'ROUNDEC', help: 'COPY 文の ROUNDEC。' },
      { key: 'timeformat', type: 'string', label: 'TIMEFORMAT', help: 'COPY 文の TIMEFORMAT。' },
      { key: 'trimblanks', type: 'boolean', label: 'TRIMBLANKS', help: 'COPY 文の TRIMBLANKS。' },
      { key: 'truncatecolumns', type: 'boolean', label: 'TRUNCATECOLUMNS', help: 'COPY 文の TRUNCATECOLUMNS。' },
      { key: 'comprows', type: 'number', label: 'COMPROWS', help: 'COPY 文の COMPROWS。' },
      { key: 'compupdate', type: 'string', label: 'COMPUPDATE', help: 'COPY 文の COMPUPDATE。' },
      { key: 'maxerror', type: 'number', label: 'MAXERROR', help: 'COPY 文の MAXERROR（許容エラー数）。' },
      { key: 'noload', type: 'boolean', label: 'NOLOAD', help: 'COPY 文の NOLOAD。' },
      { key: 'statupdate', type: 'string', label: 'STATUPDATE', help: 'COPY 文の STATUPDATE。' },
      ...REDSHIFT_CREDENTIALS,
    ],
  },
  {
    operator: 'redshift_unload>',
    summary: 'UNLOAD 文で Redshift のデータを外部ストレージへ書き出します。',
    doc: DIGDAG('redshift_unload'),
    fields: [
      { key: 'database', type: 'string', label: 'データベース名', help: '接続先のデータベース名。', required: true },
      { key: 'query', type: 'sql', label: 'SELECTクエリ', help: '書き出す対象のSELECTクエリ。', required: true },
      { key: 'to', type: 'string', label: '出力先URI', help: 'UNLOAD 文の TO に対応するURI。', required: true },
      ...JDBC_CONNECTION,
      { key: 'manifest', type: 'boolean', label: 'MANIFEST', help: 'UNLOAD 文の MANIFEST。' },
      { key: 'encrypted', type: 'boolean', label: 'ENCRYPTED', help: 'UNLOAD 文の ENCRYPTED。' },
      { key: 'allowoverwrite', type: 'boolean', label: 'ALLOWOVERWRITE', help: 'UNLOAD 文の ALLOWOVERWRITE。' },
      { key: 'delimiter', type: 'string', label: 'DELIMITER', help: 'UNLOAD 文の DELIMITER。' },
      { key: 'fixedwidth', type: 'string', label: 'FIXEDWIDTH', help: 'UNLOAD 文の FIXEDWIDTH。' },
      { key: 'gzip', type: 'boolean', label: 'GZIP', help: 'UNLOAD 文の GZIP。' },
      { key: 'bzip2', type: 'boolean', label: 'BZIP2', help: 'UNLOAD 文の BZIP2。' },
      { key: 'null_as', type: 'string', label: 'NULL_AS', help: 'UNLOAD 文の NULL_AS。' },
      { key: 'escape', type: 'boolean', label: 'ESCAPE', help: 'UNLOAD 文の ESCAPE。' },
      { key: 'addquotes', type: 'boolean', label: 'ADDQUOTES', help: 'UNLOAD 文の ADDQUOTES。' },
      { key: 'parallel', type: 'string', label: 'PARALLEL', help: 'UNLOAD 文の PARALLEL。' },
      ...REDSHIFT_CREDENTIALS,
    ],
  },
  {
    operator: 'emr>',
    summary: 'Amazon EMR のクラスタ作成やステップ実行を行います。',
    doc: DIGDAG('emr'),
    fields: [
      { key: 'cluster', type: 'json', label: 'クラスタ', help: '既存クラスタのID、または新規作成するクラスタの設定。', required: true },
      { key: 'staging', type: 'string', label: 'ステージング先', help: 'ローカルファイルを置くS3フォルダのURI。' },
      { key: 'steps', type: 'json', label: 'ステップ', help: 'クラスタに投入するステップ（spark / hive / script / command など）。' },
      { key: 'action_on_failure', type: 'string', label: '失敗時の動作', help: 'ステップ失敗時の挙動。', options: ['TERMINATE_JOB_FLOW', 'TERMINATE_CLUSTER', 'CANCEL_AND_WAIT', 'CONTINUE'] },
      { key: 'emr.region', type: 'string', label: 'EMRリージョン', help: 'EMRに使うAWSリージョン。' },
      { key: 'emr.endpoint', type: 'string', label: 'EMRエンドポイント', help: 'AWS EMRのエンドポイント。' },
      { key: 's3.region', type: 'string', label: 'S3リージョン', help: 'ステージング用S3のAWSリージョン。' },
      { key: 's3.endpoint', type: 'string', label: 'S3エンドポイント', help: 'ステージング用S3のエンドポイント。' },
      { key: 'kms.region', type: 'string', label: 'KMSリージョン', help: '変数暗号化に使うKMSのAWSリージョン。' },
      { key: 'kms.endpoint', type: 'string', label: 'KMSエンドポイント', help: 'AWS KMSのエンドポイント。' },
    ],
  },

  // ---- Google Cloud -------------------------------------------------------
  {
    operator: 'gcs_wait>',
    summary: 'Google Cloud Storage にファイルが現れるまで待ちます。',
    doc: DIGDAG('gcs_wait'),
    valueLabel: '待機するファイルのパス（bucket/object または gs://）',
    fields: [
      { key: 'bucket', type: 'string', label: 'バケット', help: '対象ファイルのGCSバケット名。object と併用します。' },
      { key: 'object', type: 'string', label: 'オブジェクト', help: '対象ファイルのGCSパス。bucket と併用します。' },
    ],
  },
  {
    operator: 'bq>',
    summary: 'Google BigQuery でクエリを実行します。',
    doc: DIGDAG('bq'),
    valueLabel: '実行するクエリテンプレートファイルのパス',
    valueType: 'sql',
    fields: [
      { key: 'dataset', type: 'string', label: '既定データセット', help: 'クエリと destination_table で使う既定のデータセット。' },
      { key: 'destination_table', type: 'string', label: '結果格納テーブル', help: 'クエリ結果を格納するテーブル。$YYYYMMDD の日付パーティションも指定できます。' },
      { key: 'location', type: 'string', label: 'ロケーション', help: 'クエリジョブを実行するロケーション。' },
      { key: 'create_disposition', type: 'string', label: 'テーブル作成方針', help: '宛先テーブルを自動作成するか。', options: ['CREATE_IF_NEEDED', 'CREATE_NEVER'] },
      { key: 'write_disposition', type: 'string', label: '書き込み方針', help: '既存テーブルへの書き込み方法。', options: ['WRITE_TRUNCATE', 'WRITE_APPEND', 'WRITE_EMPTY'] },
      { key: 'priority', type: 'string', label: '優先度', help: 'クエリの優先度。', options: ['INTERACTIVE', 'BATCH'] },
      { key: 'use_query_cache', type: 'boolean', label: 'クエリキャッシュ', help: '結果キャッシュを使います（既定: true）。' },
      { key: 'allow_large_results', type: 'boolean', label: '大規模結果の許可', help: 'サイズ制限のない結果テーブルを許可します。destination_table と Legacy SQL が必要です。' },
      { key: 'flatten_results', type: 'boolean', label: '結果のフラット化', help: 'ネストや繰り返しを平坦化します（既定: true、Legacy SQL専用）。' },
      { key: 'use_legacy_sql', type: 'boolean', label: 'Legacy SQL', help: 'Legacy SQL を使います（既定: false）。' },
      { key: 'maximum_billing_tier', type: 'number', label: '課金ティア上限', help: 'このクエリの課金ティアの上限。' },
      { key: 'table_definitions', type: 'json', label: '外部テーブル定義', help: 'クエリから参照する外部データソースの定義。' },
      { key: 'user_defined_function_resources', type: 'list', label: 'UDFリソース', help: 'クエリで使うユーザー定義関数のリソース。' },
    ],
  },
  {
    operator: 'bq_ddl>',
    summary: 'BigQuery のデータセットやテーブルを作成・削除します。',
    doc: DIGDAG('bq_ddl'),
    fields: [
      { key: 'create_datasets', type: 'list', label: 'データセット作成', help: '新しいデータセットを作成します。' },
      { key: 'empty_datasets', type: 'list', label: 'データセット初期化', help: '既にあれば削除してから作成します。中のテーブルも消えます。' },
      { key: 'delete_datasets', type: 'list', label: 'データセット削除', help: 'あれば削除します。' },
      { key: 'create_tables', type: 'list', label: 'テーブル作成', help: '新しいテーブルを作成します。' },
      { key: 'empty_tables', type: 'list', label: 'テーブル初期化', help: '既にあれば削除してから作成します。' },
      { key: 'delete_tables', type: 'list', label: 'テーブル削除', help: 'あれば削除します。' },
    ],
  },
  {
    operator: 'bq_extract>',
    summary: 'BigQuery のテーブルを Google Cloud Storage へ書き出します。',
    doc: DIGDAG('bq_extract'),
    valueLabel: 'エクスポート対象のテーブル参照',
    fields: [
      { key: 'destination', type: 'list', label: '出力先URI', help: 'エクスポート先のGCS URI、またはその一覧。', required: true },
      { key: 'location', type: 'string', label: 'ロケーション', help: 'ジョブを実行するロケーション。テーブルと出力先も同じである必要があります。' },
      { key: 'print_header', type: 'boolean', label: 'ヘッダー出力', help: 'ヘッダー行を出力します（既定: true）。' },
      { key: 'field_delimiter', type: 'string', label: '区切り文字', help: '出力のフィールド区切り文字（既定: カンマ）。' },
      { key: 'destination_format', type: 'string', label: '出力フォーマット', help: '出力形式（既定: CSV）。', options: ['CSV', 'NEWLINE_DELIMITED_JSON', 'AVRO'] },
      { key: 'compression', type: 'string', label: '圧縮', help: 'エクスポートファイルの圧縮方式（既定: NONE）。', options: ['GZIP', 'NONE'] },
    ],
  },
  {
    operator: 'bq_load>',
    summary: 'Google Cloud Storage のファイルを BigQuery に取り込みます。',
    doc: DIGDAG('bq_load'),
    valueLabel: '取り込むGCSファイルのURI、またはその一覧',
    fields: [
      { key: 'destination_table', type: 'string', label: '取り込み先テーブル', help: 'データを格納するテーブル。$YYYYMMDD の日付パーティションも指定できます。', required: true },
      { key: 'dataset', type: 'string', label: 'データセット', help: '取り込み先テーブルを含むデータセット。' },
      { key: 'location', type: 'string', label: 'ロケーション', help: 'ジョブを実行するロケーション。' },
      { key: 'project', type: 'string', label: 'プロジェクト', help: 'テーブルが属する（または作成される）プロジェクト。' },
      { key: 'source_format', type: 'string', label: '入力フォーマット', help: '取り込むファイル形式（既定: CSV）。', options: ['CSV', 'NEWLINE_DELIMITED_JSON', 'AVRO', 'DATASTORE_BACKUP'] },
      { key: 'field_delimiter', type: 'string', label: '区切り文字', help: 'CSVのフィールド区切り文字（既定: カンマ）。' },
      { key: 'create_disposition', type: 'string', label: 'テーブル作成方針', help: '宛先テーブルを自動作成するか。', options: ['CREATE_IF_NEEDED', 'CREATE_NEVER'] },
      { key: 'write_disposition', type: 'string', label: '書き込み方針', help: '既存テーブルへの書き込み方法。', options: ['WRITE_TRUNCATE', 'WRITE_APPEND', 'WRITE_EMPTY'] },
      { key: 'skip_leading_rows', type: 'number', label: '先頭スキップ行数', help: 'CSVの先頭から読み飛ばす行数（既定: 0）。' },
      { key: 'encoding', type: 'string', label: '文字エンコーディング', help: '取り込むファイルの文字コード（既定: UTF-8）。', options: ['UTF-8', 'ISO-8859-1'] },
      { key: 'quote', type: 'string', label: '引用符', help: '取り込みデータの引用符文字（既定: ダブルクォート）。' },
      { key: 'max_bad_records', type: 'number', label: '許容不正レコード数', help: '失敗とする前に無視できる不正レコードの最大数（既定: 0）。' },
      { key: 'allow_quoted_newlines', type: 'boolean', label: '引用内改行の許可', help: 'CSVの引用符内に改行を含めることを許します（既定: false）。' },
      { key: 'allow_jagged_rows', type: 'boolean', label: '欠損列の許可', help: '末尾の任意列が欠けている行を許します（既定: false）。' },
      { key: 'ignore_unknown_values', type: 'boolean', label: '未知の値を無視', help: 'スキーマにない余分な値を無視します（既定: false）。' },
      { key: 'projection_fields', type: 'list', label: '射影フィールド', help: '読み込む Cloud Datastore のプロパティ。DATASTORE_BACKUP 形式が必要です。' },
      { key: 'autodetect', type: 'boolean', label: '自動検出', help: 'オプションとスキーマを自動推定します（既定: false）。' },
      { key: 'schema_update_options', type: 'list', label: 'スキーマ更新オプション', help: '自動的に許可するスキーマ変更。', options: ['ALLOW_FIELD_ADDITION', 'ALLOW_FIELD_RELAXATION'] },
      { key: 'schema', type: 'json', label: 'スキーマ', help: 'テーブルスキーマ。インラインのオブジェクト、またはJSON/YAMLファイルのパス。' },
    ],
  },
]

const BY_OPERATOR = new Map(DEFINITIONS.map((definition) => [definition.operator, definition]))

/** The documented definition for an operator, or undefined for an unknown one. */
export function operatorDefinition(operator: string | undefined): OperatorDefinition | undefined {
  return operator ? BY_OPERATOR.get(operator) : undefined
}

export function operatorFields(operator: string | undefined): readonly OperatorField[] {
  return operatorDefinition(operator)?.fields ?? []
}

/**
 * Keys the inspector renders with a purpose-built control, so everything else
 * in the task body can be listed as raw key/value instead of being hidden.
 */
export function handledTaskKeys(operator: string | undefined): Set<string> {
  const keys = new Set<string>()
  if (operator) keys.add(operator)
  for (const field of operatorFields(operator)) keys.add(field.key)
  for (const field of COMMON_TASK_FIELDS) keys.add(field.key)
  // A group's children are keys of the task map itself.
  return keys
}

/** Every operator this editor knows something about. */
export function knownOperators(): readonly string[] {
  return DEFINITIONS.map((definition) => definition.operator)
}
