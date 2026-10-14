# 通行規制ページの中継(Cloudflare Workers 無料プラン)

ルート計算を押したときだけ、県の公式ページ(HTML)を取得して返す小さな中継です。定期取得はしません。
アプリ(github.io)から県のサイトを直接読めない(CORS)ための、読み取り専用の橋渡しです。

## できること / しないこと
- 取得先は `worker.js` の `ALLOWED_HOSTS`(登録した県の公式ドメイン)だけ。それ以外は取得しません。
- 呼び出せるのは `https://sir-pendragon.github.io` のページだけ(`ALLOWED_ORIGINS`)。
- 解析はしません(Workers無料プランは1リクエストのCPU時間が10msのため)。表の解析は `parse-tables.js` がアプリ側で行います。
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
