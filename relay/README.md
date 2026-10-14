# 通行規制ページの中継(Cloudflare Workers 無料プラン)

ルート計算を押したときだけ、県の公式ページ(HTML)を取得して返す小さな中継です。定期取得はしません。
アプリ(github.io)から県のサイトを直接読めない(CORS)ための、読み取り専用の橋渡しです。

## できること / しないこと
- 取得先は `worker.js` の `ALLOWED_HOSTS`(登録した県の公式ドメイン)だけ。それ以外は取得しません。
- 呼び出せるのは `https://sir-pendragon.github.io` のページだけ(`ALLOWED_ORIGINS`)。
- 解析はしません(Workers無料プランは1リクエストのCPU時間が10msのため)。表の解析は `route/parse-tables.js` がアプリ側で行います。
- 返す内容: 取得元のそのままのデータ + 取得時刻(`X-Fetched-At`)+ 取得元の更新日(`X-Upstream-Last-Modified`、あれば)。

## 無料枠(公式ドキュメントで確認した値)
- 1日 100,000 リクエスト(UTC 0時にリセット)/ CPU 10ms / 1リクエストの外部取得は50回まで

## デプロイ手順(あなたの操作が必要です)
1. https://dash.cloudflare.com/ で無料アカウントを作成(私は代行できません)。
2. PCで `npm i -g wrangler` を実行し、`wrangler login`。
3. このフォルダ(`relay/`)で `wrangler deploy`。表示された `https://ride-meter-closure-relay.<あなたの名前>.workers.dev` のURLを私に教えてください。
4. 私がアプリ側にそのURLを設定します(公開版への統合は、あなたの承認後)。

## テスト(ローカル)
`node` でモックしたテストを実施済み(許可ドメイン/他ドメイン/http/別オリジン/POST/不正URL)。

## 追加: 山梨県の取得と、Geminiによる二重チェック(任意)

- 2026-10-14: Cloudflareの「ビルド」でこのリポジトリ(main、ルート `relay`)に接続しました。以後は main への push で中継が自動デプロイされます(手で貼り替えると次のpushで上書きされます)。
- 許可ドメインに松本市・安曇野市・伊那市・甲府市(`www.city.matsumoto.nagano.jp` `www.city.azumino.nagano.jp` `www.inacity.jp` `www.city.kofu.yamanashi.jp`)を追加しました。mainへのpushで自動デプロイされます。
- 許可ドメインに `www.pref.kanagawa.jp`(神奈川県 県営林道)を追加しました。mainへのpushで自動デプロイされます。
- 許可ドメインに `www.pref.tochigi.lg.jp`(栃木県 矢板森林管理事務所)を追加しました。**中継のコード(worker.js)を貼り替えて Deploy し直してください。**
- 許可ドメインに `www.pref.yamanashi.jp` を追加しました。**中継のコード(worker.js)を貼り替えて Deploy し直してください。**
- Geminiの二重チェックを使う場合:
  1. Google AI Studio で APIキーを作る(請求先を登録していないプロジェクトで。無料枠のみで動かすため)。
  2. Cloudflare の Worker → 設定 → 変数とシークレット → 「シークレット」として `GEMINI_API_KEY` を追加(キーは画面に直接入力。チャットやGitHubには貼らない)。
  3. アプリの「通行規制の自動取得」欄で「Geminiで二重チェックする」にチェック。
- モデルは既定で `gemini-3.8-flash`。変える場合は `GEMINI_MODEL` を変数として追加。
- `/ai` は固定のプロンプトで本文の抽出だけを行います(任意の質問は送れません)。本文は4万文字まで。
- 無料枠では入力が製品改善に使われます(公式ページの記載)。送るのは公開されている公式ページの本文だけです。
