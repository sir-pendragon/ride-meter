@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem インストール不要版のNode.js(node-v*-win-x64 フォルダ)がこのフォルダにあれば、それを使う
for /d %%d in ("%~dp0node-v*-win-x64") do set "PATH=%%d;%PATH%"
echo ===== 通行規制の中継を公開します =====
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。Claude の案内どおり、Node.js(zip版)をこのフォルダに展開してから、もう一度このファイルを開いてください。
  pause
  exit /b 1
)
echo [1/2] Cloudflare にログインします。ブラウザが開いたら「Allow」を押してください。
call npx wrangler login
if errorlevel 1 (
  echo ログインに失敗しました。画面の文言を Claude に貼り付けて教えてください。
  pause
  exit /b 1
)
echo.
echo [2/2] 中継を公開します。初回だけ workers.dev の名前を聞かれます(好きな英数字・小文字・ハイフン)。
call npx wrangler deploy
echo.
echo 表示された https://....workers.dev のURLをコピーして、Claude に教えてください。
pause
