# sudoku
数独バトル

![SudokuOnline](./sampleimage.png "画像サンプル")

## ディレクトリ構成
以下に記載されていない詳細はソースを読んでください……
### sudokubackend
サーバーサイド
* npm run devで、origin: ["http://localhost:5173"]（後述するフロントエンド側でviteの開発サーバーを使った場合）からの通信も受け入れる状態で起動する。PORTを環境変数で指定してなければ<http://localhost:3000>で起動しているはず。
* npm run start：起動
* npm run build：ビルド。生成されたindex.jsにnode index.jsとするとサーバー起動。
* ただし、起動にはAzure CosmosDBが必要で、DBの作成及び接続情報を実行環境の環境変数に持たせる必要あり。
* サーバー<http://localhost:3000>にアクセスしたとき、sudokubackend/distディレクトリの内容を公開しております。これはsudokufrontendのビルドしたものを入れるようにしてあります。

## sudokufrontend
フロントエンド
* npm run dev：viteのHMRのサーバー<http://localhost:5173>が立つ。コードを編集すると変更内容がすぐに反映されて、開発に便利。sudokubackendをnpm run devで動かしながら、これを動かす。
* npm run build：ビルド。ビルド先はsudokubackend/distディレクトリ。

