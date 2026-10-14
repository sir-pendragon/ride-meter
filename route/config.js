// 公開設定(任意)。このファイルは公開リポジトリに置かれ、誰でも読めます。
// 端末のブラウザデータが消えても使えるよう、ここに書いた値は「端末に値が無いときの予備」として使われます。
// 端末側に値があるときは、端末側が優先されます。
//
// gmapsKey: Googleマップ(ブラウザ用)のAPIキー。入れる前に、Google Cloudコンソールで必ず次を設定してください。
//   - アプリケーションの制限: ウェブサイト(HTTPリファラー) = https://sir-pendragon.github.io/*
//   - APIの制限: Maps JavaScript API(+ Geocoding API を使う場合のみ)
//   - 予算アラート、または1日あたりの上限(クォータ)
// relayUrl: ここには書かないでください。中継のURLが公開されると、誰でもこの中継(Geminiの呼び出しを含む)を使えてしまいます。
//   中継のURLは、各端末の「⚙ 設定」→「中継」に入力します(端末内に保存されます)。
window.RT_CONFIG = { gmapsKey: 'AIzaSyB8uREokpOgsqmJvePp7IZpGjgZjy93XNI', relayUrl: '' };
