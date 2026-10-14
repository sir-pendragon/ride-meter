# PR作成内容（権限制限で未作成）

対象: `main` ← `codex/route-v57-production-readiness`

タイトル: route-v57: 4モード探索と公開前の標高・景観・API制限を統合

[GitHubのPR作成画面](https://github.com/sir-pendragon/ride-meter/compare/main...codex/route-v57-production-readiness?expand=1)

ドラフトとして作成し、マージ・公開は承認待ちにする。

## 本文

route-v57の4モード探索をmainへ提案し、景観の満点への張り付き、構造物の位置ずれ、API無応答時の待機と過剰な再送を修正します。引継ぎ元296c527まで統合済みです。

景観は距離とルート長で正規化する連続評価。橋・トンネルは形状を両方向で1m以内と確認した範囲だけ補正し、位置不明時の比例配分と範囲外の1画素拡張を使いません。Overpassの予備サーバーを整理し、取得は最大30秒、峠探索は20秒予算を共有します。Valhallaは自動再送せず、実際の/routeを基本1回＋追加最大3回に制限し、識別ヘッダーを本番オリジンで検証しました。SW更新で他アプリ・APIキャッシュを維持します。

検証: Node 19＋Python 2の全21ファイル、Playwright E2E全25ファイル成功（模擬API）。実API診断は5場面すべて成功、Valhalla 24回（route 12/12、trace_attributes 9/9、locate 3/3）、Overpass 3回、約49.2秒、例外0件。峠データ取得は実APIでタイムアウトしましたが基本ルートを返せています。景観Vは同じ実データで旧評価の両候補1.0から0.682/0.584へ分かれました。標高補正は構造物外の変更0件。独立した路面標高との照合、Valhalla回数・実時間の削減は未確認です。

公開判断: No-Go（運用確認待ち）。Pages公開元フォルダーの確認、Valhalla Discussionsへの連絡（原稿準備済み）、ユーザーのマージ・公開承認が残ります。main・Pages設定・本番は変更せず、自動マージ・定期Actionsは追加していません。

詳しい証跡・残件・復旧方法: docs/route-v57-handoff-report.md
未送信の運営連絡案: docs/valhalla-usage-notice-draft.md

