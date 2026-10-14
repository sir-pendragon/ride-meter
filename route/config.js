// 公開設定(任意)。このファイルは公開リポジトリに置かれ、誰でも読めます。
// 端末のブラウザデータが消えても使えるよう、ここに書いた値は「端末に値が無いときの予備」として使われます。
// 端末側に値があるときは、端末側が優先されます。
//
// gmapsKey: Googleマップ(ブラウザ用)のAPIキー。入れる前に、Google Cloudコンソールで必ず次を設定してください。
//   - アプリケーションの制限: ウェブサイト(HTTPリファラー) = https://sir-pendragon.github.io/*
//   - APIの制限: Maps JavaScript API(+ Geocoding API を使う場合のみ)
//   - 予算アラート、または1日あたりの上限(クォータ)
// relayUrl: 中継(Cloudflare Worker)のURL。取得先は公式サイトだけに固定されています。
//   Geminiのキーを中継に設定する場合は、中継側で回数制限を足してから使ってください。
window.RT_CONFIG = { gmapsKey: 'AIzaSyB8uREokpOgsqmJvePp7IZpGjgZjy93XNI', relayUrl: 'https://ride-meter-closure-relay.nana-fumi-sugiura.workers.dev' };
