"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const socket_io_1 = __importDefault(require("socket.io"));
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const cosmos_1 = require("@azure/cosmos");
const crypto_1 = __importDefault(require("crypto"));
const async_lock_1 = __importDefault(require("async-lock"));
//数独の問題と答えのセットを生成
const answertext = fs_1.default.readFileSync("./answer.txt");
const astxt = answertext.toString();
const answerlines = astxt.split('\n');
const problemtext = fs_1.default.readFileSync("./problem.txt", 'utf8');
const problemlines = problemtext.toString().split('\n');
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;
//部屋ごとの盤面情報保持
const gameInfos = {};
/**
 * 非同期処理
 */
const lock = new async_lock_1.default();
async function main() {
    //AzureDB接続
    // Provide required connection from environment variables
    const key = String(process.env.COSMOS_KEY);
    const endpoint = String(process.env.COSMOS_ENDPOINT);
    // Set Database name and container name with unique timestamp
    const databaseName = `users`;
    const containerName = `products`;
    const partitionKeyPath = ["/pk"]; //categoryId
    // Authenticate to Azure Cosmos DB
    const cosmosClient = new cosmos_1.CosmosClient({ endpoint, key });
    const { database } = await cosmosClient.databases.createIfNotExists({ id: databaseName });
    console.log(`${database.id} database ready`);
    // Create container if it doesn't exist
    const { container } = await database.containers.createIfNotExists({
        id: containerName,
        partitionKey: {
            paths: partitionKeyPath
        }
    });
    console.log(`${container.id} container ready`);
    const querySpec = {
        query: "select u.pk,u.id,u.userId,u.rate,u.name from users u"
    };
    let usersCosmos;
    // Get items 
    try {
        //cosmosDBが使いにくいので都度問い合わせるのでなく、
        //ランキング情報全て取得しておいてメモリに持った情報を参照する。更新は都度更新しにいく
        const { resources } = await container.items.query(querySpec).fetchAll();
        console.log('cosmosDB Data:', resources);
        //配列のままだと使いにくいので、id(userId)をキーにしたオブジェクトに
        usersCosmos = resources.reduce((acc, item) => {
            acc[item['id']] = item;
            return acc;
        }, {});
    }
    catch (error) {
        console.log(error);
        usersCosmos = {};
    }
    //CROS対応
    app.use((req, res, next) => {
        next();
    });
    //一覧取得
    app.use('/', express_1.default.static('public'));
    const server = http_1.default.createServer(app);
    const io = new socket_io_1.default.Server(server);
    /*connection(webSocket確立時)*/
    io.on('connection', function (socket) {
        const count = io.engine.clientsCount;
        io.emit('connectnum', count);
        //リセット。もしだれもいない部屋の盤面があれば消しておく
        Object.keys(gameInfos).forEach(rmkey => {
            const rmclients = io.sockets.adapter.rooms.get(rmkey);
            const rmNumClients = rmclients ? rmclients.size : 0;
            if (rmNumClients === 0) {
                console.log('誰も入っていない部屋のため削除 ルーム:', rmkey);
                if (gameInfos[rmkey]['mode'] && gameInfos[rmkey]['mode'] === 'TurnMode') {
                    //turnmodeはsetTimeoutが非同期て動いているため、こっちで消したときに動いていると例外で死ぬため、消すのは
                    //setTimeoutに任せる
                    gameInfos[rmkey]['turnModeGameEnd'] = true;
                }
                else {
                    delete gameInfos[rmkey];
                }
            }
        });
        //ランキングを返す
        socket.on('requestranking', function () {
            const ranking = Object.values(usersCosmos);
            socket.emit('ranking', ranking);
        });
        //一人用のゲームの盤面を返す
        socket.on('requestsingleplay', function () {
            const problemnum = getRandomInt(500);
            const startboard = problemlines[problemnum];
            const answer = answerlines[problemnum];
            const sboard = {};
            // 通常のfor文で行う
            for (let i = 0; i < 81; i++) {
                const syou = Math.floor(i / 9);
                const mod = i % 9;
                const coord = String(syou) + String(mod);
                const inval = startboard[i];
                let inid = 'auto';
                if (inval === '-') {
                    inid = 'mada';
                }
                sboard[coord] = { id: inid, val: inval };
            }
            const singleObject = { 'board': sboard, 'answer': answer };
            socket.emit('singleplay', singleObject);
        });
        //待機ルームに入る用
        socket.on('gogameSimpleMode', function (data) {
            let roomId = data['roomId'];
            socket.data.userId = data['userId'];
            socket.data.subUserId = data['subUserId'];
            socket.data.pubUserId = data['pubUserId'];
            socket.data.matchUserId = data['pubUserId'];
            console.log('gogame', data);
            if (!(socket.data.pubUserId in usersCosmos)) {
                usersCosmos[socket.data.pubUserId] = {
                    "pk": "A",
                    "id": socket.data.pubUserId,
                    "userId": socket.data.userId,
                    "name": data['name'].slice(0, 24),
                    "rate": 1500
                };
            }
            else if (socket.data.userId === usersCosmos[socket.data.pubUserId]['userId']) {
                //名前だけ更新
                usersCosmos[socket.data.pubUserId]['name'] = data['name'].slice(0, 24);
            }
            else if (socket.data.pubUserId === 'auto') {
                //autoという文字列も入れられると困るので……
                console.log('不正検知:', socket.data.pubUserId, socket.data.userId);
                return;
            }
            else {
                //nagai pubUserIdは既に入っているのと同じものを持っているのに
                //userIdが一致しない場合……、それは他の人のpubUserIdに不正なパスワードで入るのと同じ
                console.log('不正検知:', socket.data.pubUserId, socket.data.userId);
                return;
            }
            //試合後などに再戦する場合、
            //もともと入っていた部屋全てから抜ける
            const rooms = Array.from(socket.rooms);
            rooms.forEach(rm => {
                if (rm !== socket.id) {
                    socket.leave(rm);
                }
            });
            //まず最初に中断した部屋がないか確認する
            if (roomId && roomId in gameInfos) {
                //中断した部屋がまだ残っている場合、そこに参加する。
                socket.leave('waitingroom_simple'); //一応ちゃんと抜ける
                socket.leave('waitingroom_turn');
                socket.join(roomId);
                socket.emit('match', roomId);
                socket.emit("state", { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'] });
                return;
            }
            //中断した部屋がなく開始の場合
            socket.join('waitingroom_simple');
            const clients = io.sockets.adapter.rooms.get('waitingroom_simple');
            console.log('simplemode待機ルームの人のIDのセット', clients);
            const numClients = clients ? clients.size : 0;
            if (!(numClients > 1 && clients)) {
                //人がいない場合は、ここでreturnして終了してしまい
                return;
            }
            //nagaiもし同時にたくさん人きたら誰か同時に入ってしまいそうなので
            //判定処理は入れる、その部屋に入っている人の数を取得する
            const clientsArr = Array.from(clients);
            //idさえ分かれば誰でも入れるので、roomIdは推測不能な文字列に
            roomId = crypto_1.default.randomUUID();
            const cl0 = io.sockets.sockets.get(clientsArr[0]);
            const cl1 = io.sockets.sockets.get(clientsArr[1]);
            if (!(cl0 && cl1)) {
                //もし取得できない場合があれば即終了
                return;
            }
            //待機ルームを抜けて対戦ルームに入る
            cl0.leave('waitingroom_simple');
            cl1.leave('waitingroom_simple');
            cl0.join(roomId);
            cl1.join(roomId);
            //マッチ
            cl0.emit('match', roomId);
            cl1.emit('match', roomId);
            if (cl0.data.pubUserId === cl1.data.pubUserId) { //同一ブラウザ同士の対決、もしく同一のpubUserId同士（不正に設定）の場合
                cl0.data.matchUserId = cl0.data.subUserId;
                cl1.data.matchUserId = cl1.data.subUserId;
            }
            const rclients = io.sockets.adapter.rooms.get(roomId);
            console.log('ルーム:', roomId, 'に入っている人のIDのSet', rclients);
            console.log('待機ルームの人のIDのSet', clients);
            const rnumClients = clients ? clients.size : 0;
            if (rnumClients > 2) {
                //もし同じ部屋に二人以上入ってしまっていたら解散（そんなことがあるか分からないが）
                cl0.leave(roomId);
                cl1.leave(roomId);
                cl0.join('waitingroom_simple');
                cl1.join('waitingroom_simple');
                console.log('解散 ルーム:', roomId, 'の人のIDのセット', rclients);
                console.log('解散', '待機ルームの人のIDのセット', clients);
            }
            else {
                console.log('SimpleModeゲーム開始');
                //正常に部屋が立ったなら
                //ゲームに必要な情報を作成する
                //盤面の正解の情報,現在の盤面の状態
                gameInfos[roomId] = generateStartGameInfo(cl0.data, cl1.data, data['mode']);
                io.to(roomId).emit("state", { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'] });
                const intervalid = setInterval(function () {
                    gameInfos[roomId]['startCountDown'] -= 1;
                    io.to(roomId).emit("startCountDown", gameInfos[roomId]['startCountDown']);
                    if (gameInfos[roomId]['startCountDown'] < 1) {
                        clearInterval(intervalid);
                    }
                }, 1000);
            }
        });
        //待機ルームに入る用
        socket.on('gogameTurnMode', function (data) {
            let roomId = data['roomId'];
            socket.data.userId = data['userId'];
            socket.data.subUserId = data['subUserId'];
            socket.data.pubUserId = data['pubUserId'];
            socket.data.matchUserId = data['pubUserId'];
            console.log('gogameTurnMode', data);
            if (!(socket.data.pubUserId in usersCosmos)) {
                usersCosmos[socket.data.pubUserId] = {
                    "pk": "A",
                    "id": socket.data.pubUserId,
                    "userId": socket.data.userId,
                    "name": data['name'].slice(0, 24),
                    "rate": 1500
                };
            }
            else if (socket.data.userId === usersCosmos[socket.data.pubUserId]['userId']) {
                //名前だけ更新
                usersCosmos[socket.data.pubUserId]['name'] = data['name'].slice(0, 24);
            }
            else if (socket.data.pubUserId === 'auto') {
                //autoという文字列も入れられると困るので……
                console.log('不正検知:', socket.data.pubUserId, socket.data.userId);
                return;
            }
            else {
                //nagai pubUserIdは既に入っているのと同じものを持っているのに
                //userIdが一致しない場合……、それは他の人のpubUserIdに不正なパスワードで入るのと同じ
                console.log('不正検知:', socket.data.pubUserId, socket.data.userId);
                return;
            }
            //試合後などに再戦する場合、
            //もともと入っていた部屋全てから抜ける
            const rooms = Array.from(socket.rooms);
            rooms.forEach(rm => {
                if (rm !== socket.id) {
                    socket.leave(rm);
                }
            });
            //まず最初に中断した部屋がないか確認する
            if (roomId && roomId in gameInfos) {
                //中断した部屋がまだ残っている場合、そこに参加する。
                socket.leave('waitingroom_simple'); //一応ちゃんと抜ける
                socket.leave('waitingroom_turn');
                socket.join(roomId);
                socket.emit('match', roomId);
                socket.emit("state", { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'] });
                return;
            }
            //中断した部屋がなく開始の場合
            socket.join('waitingroom_turn');
            const clients = io.sockets.adapter.rooms.get('waitingroom_turn');
            console.log('turnmode待機ルームの人のIDのセット', clients);
            //to get the number of clients in this room
            const numClients = clients ? clients.size : 0;
            if (!(numClients > 1 && clients)) {
                //人がいない場合は、ここでreturnして終了してしまい
                return;
            }
            //もし同時にたくさん人きたら誰か同時に入ってしまいそうなので
            //判定処理は入れる、その部屋に入っている人の数を取得する
            const clientsArr = Array.from(clients);
            //idさえ分かれば誰でも入れるので、roomIdは推測不能な文字列に
            roomId = crypto_1.default.randomUUID();
            const cl0 = io.sockets.sockets.get(clientsArr[0]);
            const cl1 = io.sockets.sockets.get(clientsArr[1]);
            if (!(cl0 && cl1)) {
                //もし取得できない場合があれば即終了
                return;
            }
            //待機ルームを抜けて対戦ルームに入る
            cl0.leave('waitingroom_turn');
            cl1.leave('waitingroom_turn');
            cl0.join(roomId);
            cl1.join(roomId);
            //マッチ
            cl0.emit('match', roomId);
            cl1.emit('match', roomId);
            if (cl0.data.pubUserId === cl1.data.pubUserId) { //同一ブラウザ同士の対決、もしく同一のpubUserId同士（不正に設定）の場合
                cl0.data.matchUserId = cl0.data.subUserId;
                cl1.data.matchUserId = cl1.data.subUserId;
            }
            const rclients = io.sockets.adapter.rooms.get(roomId);
            console.log('ルーム:', roomId, 'に入っている人のIDのSet', rclients);
            console.log('待機ルームの人のIDのSet', clients);
            const rnumClients = clients ? clients.size : 0;
            if (rnumClients > 2) {
                //もし同じ部屋に二人以上入ってしまっていたら解散（そんなことがあるか分からないが）
                cl0.leave(roomId);
                cl1.leave(roomId);
                cl0.join('waitingroom_turn');
                cl1.join('waitingroom_turn');
                console.log('解散 ルーム:', roomId, 'の人のIDのセット', rclients);
                console.log('解散', '待機ルームの人のIDのセット', clients);
                return;
            }
            console.log('TurnModeゲーム開始');
            //正常に部屋が立ったなら
            //ゲームに必要な情報を作成する
            //盤面の正解の情報,現在の盤面の状態
            gameInfos[roomId] = generateStartGameInfo(cl0.data, cl1.data, data['mode']);
            io.to(roomId).emit("state", { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'] });
            let iterCnt = 0;
            //処理が長引く場合は１秒以上かかる。setIntervalは最悪処理が並行で走るのでsetTimeoutに
            setTimeout(function gameCountDownFunction() {
                lock.acquire(roomId, function (done) {
                    if (gameInfos[roomId]['turnModeGameEnd']) {
                        delete gameInfos[roomId];
                        done(undefined, true);
                        return;
                    }
                    iterCnt++;
                    if (gameInfos[roomId]['startCountDown'] > 0) {
                        //初回のマッチ遷移後のカウントダウン
                        gameInfos[roomId]['startCountDown'] -= 1;
                        io.to(roomId).emit("startCountDown", gameInfos[roomId]['startCountDown']);
                        done(undefined, true);
                        return; //処理ここまで
                    }
                    //以降普通のゲーム
                    gameInfos[roomId]['countdown'] -= 1;
                    if (gameInfos[roomId]['countdown'] < 0) { //0より小さくなったら、次の人のターンに遷移するという一連の処理
                        if (gameInfos[roomId]['turnIndex'] === gameInfos[roomId]['turnArray']?.length - 1) {
                            //最後のインデックスになったら最初にする例：3->0
                            //turnindexは最初に変える
                            gameInfos[roomId]['turnIndex'] = 0;
                        }
                        else {
                            gameInfos[roomId]['turnIndex']++;
                        }
                        if (gameInfos[roomId]['turnArray'][gameInfos[roomId]['turnIndex']] === 'auto') {
                            gameInfos[roomId]['countdown'] = 5;
                            if (gameInfos[roomId]['submitFlag']) {
                                //提出していたならautoでマスが開かれることはなし。
                                gameInfos[roomId]['submitFlag'] = false;
                                gameInfos[roomId]['countdown'] = 0;
                            }
                            else {
                                //memo:前のプレイヤーのターンで答えが提出されていなかったなら、autoで一枚マスが開かれる
                                const keys = Object.keys(gameInfos[roomId]['board']).filter(key => gameInfos[roomId]['board'][key]['val'] === '-');
                                const randomKey = keys[Math.floor(Math.random() * keys.length)];
                                const indx = parseInt(randomKey[0]) * 9 + parseInt(randomKey[1]);
                                gameInfos[roomId]['board'][randomKey] = { id: 'auto', val: gameInfos[roomId]['answer'][indx] };
                                const eventData = { status: 'auto', matchUserId: 'auto', val: gameInfos[roomId]['answer'][indx], coordinate: randomKey };
                                io.to(roomId).emit("event", eventData);
                                io.to(roomId).emit("state", { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'] });
                            }
                        }
                        else {
                            gameInfos[roomId]['countdown'] = 5;
                        }
                    }
                    io.to(roomId).emit("turnCount", { countdown: gameInfos[roomId]['countdown'], turnUserId: gameInfos[roomId]['turnArray'][gameInfos[roomId]['turnIndex']] });
                    // 終了検知
                    let endgame = true;
                    Object.keys(gameInfos[roomId]['board']).forEach(key => {
                        if (gameInfos[roomId]['board'][key]['val'] === '-') {
                            endgame = false;
                        }
                    });
                    if (endgame === true) {
                        console.log('ルーム:', roomId, 'のゲーム終了');
                        (async () => {
                            //非同期でレートを更新する。
                            //部屋に入っている二人のユーザーに対してメモリに持っているCosmosのオブジェクトを更新、CosmosDBを更新
                            const mUserIds = Object.keys(gameInfos[roomId]['idTableMatchPub']);
                            const pUser0Id = gameInfos[roomId]['idTableMatchPub'][mUserIds[0]];
                            const pUser1Id = gameInfos[roomId]['idTableMatchPub'][mUserIds[1]];
                            const diffrate = gameInfos[roomId]['points'][mUserIds[0]] - gameInfos[roomId]['points'][mUserIds[1]];
                            usersCosmos[pUser0Id]['rate'] += diffrate;
                            usersCosmos[pUser1Id]['rate'] -= diffrate;
                            const ranking = Object.values(usersCosmos);
                            io.to(roomId).emit('ranking', ranking);
                            try {
                                await container.items.upsert(usersCosmos[pUser0Id]);
                                await container.items.upsert(usersCosmos[pUser1Id]);
                            }
                            catch (error) {
                                console.error(error);
                            }
                            delete gameInfos[roomId];
                        })();
                        //処理終了
                        done(undefined, false);
                        return;
                    }
                    if (iterCnt > 1000) {
                        //1000回超えるようなことがあればそれは普通ありえないので
                        //強制的にストップ
                        done(undefined, false);
                        return;
                    }
                    done(undefined, true);
                }).then(function (res) {
                    if (res !== true) {
                        return;
                    }
                    // ロック内で呼び出していたと挙動がおかしかった気がするため。ロック解除されてから次を呼ぶ
                    setTimeout(gameCountDownFunction, 1000);
                }).catch((err) => {
                    console.log('nagai 確認err', err);
                });
            }, 1000);
        });
        //ホバー
        socket.on('hover', function (data) {
            const rooms = Array.from(socket.rooms);
            let roomId = '';
            rooms.forEach(rm => {
                if (rm !== socket.id) {
                    roomId = rm;
                }
            });
            //相手にだけ送るbroadcast
            socket.broadcast.to(roomId).emit('hoverServer', data);
        });
        //クライアントから受けた数独提出答え受け取り用
        socket.on('submitSimpleMode', function (submitInfo) {
            console.log('submitInfo: ', submitInfo);
            check(submitInfo, socket);
        });
        //クライアントから受けた数独提出答え受け取り用
        socket.on('submitTurnModeAnswer', function (submitInfo) {
            console.log('submitInfo: ', submitInfo);
            checkTurnModeAnswer(submitInfo, socket);
        });
        socket.on('myselect', function (data) {
            //自分が選択しているところの座標を相手にだけ送る
            //相手のsocketidに送る。
            const rooms = Array.from(socket.rooms);
            let roomId = '';
            rooms.forEach(rm => {
                if (rm !== socket.id) {
                    roomId = rm;
                }
            });
            //相手にだけ送るbroadcast
            socket.broadcast.to(roomId).emit('opponentSelect', data);
        });
        //テスト クライアントチャット機能用
        socket.on('message', function (msg) {
            console.log('message: ' + msg);
            //参考:所属する部屋を取得できる
            //ただし、自分自身のIDも部屋として取得されるのでそちらは無視する
            const rooms = Array.from(socket.rooms);
            rooms.forEach(rm => {
                if (rm !== socket.id) {
                    io.to(rm).emit('message', msg);
                }
            });
            //io.emit('message', msg);//ブロードキャスト
        });
    });
    server.listen(PORT, function () {
        console.log('server listening. Port:' + PORT);
    });
    /**
     * 新しく作られた部屋のゲーム情報を生成する
     * 魔法陣の正解情報、現在の盤面など
     * @param data0 socketのdata
     * @param data1
     * @param
     * @returns
     */
    function generateStartGameInfo(data0, data1, mode) {
        const problemnum = getRandomInt(500);
        const startboard = problemlines[problemnum];
        const answer = answerlines[problemnum];
        const asarray = answer.match(/.{9}/g);
        const askaigyo = asarray?.join('\n');
        console.log(askaigyo); //デバッグで自分で入力するとき用に魔法陣の答え出力
        const board = {};
        // 通常のfor文で行う
        for (let i = 0; i < 81; i++) {
            const syou = Math.floor(i / 9);
            const mod = i % 9;
            const coord = String(syou) + String(mod);
            const inval = startboard[i];
            let inid = 'auto';
            if (inval === '-') {
                inid = 'mada';
            }
            board[coord] = { id: inid, val: inval };
        }
        const rtobj = {
            board: board,
            answer: answer, points: { [data0.matchUserId]: 0, [data1.matchUserId]: 0 },
            logs: [], startCountDown: 6,
            idTable: { [data0.userId]: data0.matchUserId, [data1.userId]: data1.matchUserId },
            idTableMatchPub: { [data0.matchUserId]: data0.pubUserId, [data1.matchUserId]: data1.pubUserId },
            mode: mode
        };
        if (mode === 'TurnMode') {
            const data = [data0.matchUserId, data1.matchUserId];
            data.sort(() => Math.random() - 0.5); //ランダムに並び替える
            data.splice(1, 0, 'auto');
            data.push('auto');
            rtobj['turnArray'] = data;
            rtobj['turnIndex'] = 0;
            rtobj['countdown'] = 15;
        }
        return rtobj;
    }
    /**
     * 提出された回答を判定して、二人のユーザーに結果送信
     * @param submitInfo
     * @param socket
     */
    function check(submitInfo, socket) {
        const rmid = submitInfo['roomId'];
        lock.acquire(rmid, function () {
            if (gameInfos[rmid]['startCountDown'] > 0) {
                console.log('カウントダウン中のため入力棄却');
                return;
            }
            const cod = submitInfo['coordinate'];
            const val = submitInfo['val'];
            const indx = parseInt(cod[0]) * 9 + parseInt(cod[1]);
            const matchUserId = socket.data.matchUserId;
            let eventData;
            if (gameInfos[rmid]['answer'][indx] === val && gameInfos[rmid]['board'][cod]['val'] === '-') { //まだ値が入っていないものに対して
                //正解の場合
                console.log('正解');
                gameInfos[rmid]['board'][cod]['val'] = val;
                gameInfos[rmid]['board'][cod]['id'] = matchUserId;
                gameInfos[rmid]['points'][matchUserId] += parseInt(val);
                eventData = { status: 'correct', matchUserId: matchUserId, val: val, coordinate: cod };
                gameInfos[rmid]['logs'].push(eventData);
            }
            else if (gameInfos[rmid]['board'][cod]['val'] === '-') {
                console.log('不正解');
                //不正解の場合減点
                gameInfos[rmid]['points'][matchUserId] -= parseInt(val);
                eventData = { status: 'incorrect', matchUserId: matchUserId, val: val, coordinate: cod };
                gameInfos[rmid]['logs'].push(eventData);
            }
            io.to(rmid).emit('event', eventData);
            io.to(rmid).emit("state", { board: gameInfos[rmid]['board'], points: gameInfos[rmid]['points'] });
            // 終了検知
            let endgame = true;
            Object.keys(gameInfos[rmid]['board']).forEach(key => {
                if (gameInfos[rmid]['board'][key]['val'] === '-') {
                    endgame = false;
                } //nagai foreachを途中でやめることはできないらしい……無駄すぎるがとりあえず
            });
            if (endgame === true) {
                console.log('ルーム:', rmid, 'のゲーム終了');
                //面倒なのでとりあえず画面側でstateから判定してもらう
                //終了したなら配列から盤面を消してしまう
                //終了通知はなく、クライアントは盤面から判定している
                (async () => {
                    //非同期でレートを更新する。
                    //部屋に入っている二人のユーザーに対してメモリに持っているCosmosのオブジェクトを更新、CosmosDBを更新
                    const mUserIds = Object.keys(gameInfos[rmid]['idTableMatchPub']);
                    const pUser0Id = gameInfos[rmid]['idTableMatchPub'][mUserIds[0]];
                    const pUser1Id = gameInfos[rmid]['idTableMatchPub'][mUserIds[1]];
                    const diffrate = gameInfos[rmid]['points'][mUserIds[0]] - gameInfos[rmid]['points'][mUserIds[1]];
                    usersCosmos[pUser0Id]['rate'] += diffrate;
                    usersCosmos[pUser1Id]['rate'] -= diffrate;
                    const ranking = Object.values(usersCosmos);
                    io.to(rmid).emit('ranking', ranking);
                    try {
                        await container.items.upsert(usersCosmos[pUser0Id]);
                        await container.items.upsert(usersCosmos[pUser1Id]);
                    }
                    catch (error) {
                        console.error(error);
                    }
                    delete gameInfos[rmid];
                })();
            }
        });
    }
    /**
 * 提出された回答を判定して、二人のユーザーに結果送信
 * TurnMode用
 * roomIdでロックを取得した
 * @param submitInfo
 * @param socket
 */
    function checkTurnModeAnswer(submitInfo, socket) {
        const rmid = submitInfo['roomId'];
        lock.acquire(rmid, function () {
            if (gameInfos[rmid]['startCountDown'] > 0) {
                console.log('カウントダウン中のため入力棄却');
                return;
            }
            if (gameInfos[rmid]['turnArray'][gameInfos[rmid]['turnIndex']] === socket.data.matchUserId) {
                const cod = submitInfo['coordinate'];
                const val = submitInfo['val'];
                const indx = parseInt(cod[0]) * 9 + parseInt(cod[1]);
                const matchUserId = socket.data.matchUserId;
                gameInfos[rmid]['submitFlag'] = true;
                let eventData;
                if (gameInfos[rmid]['answer'][indx] === val && gameInfos[rmid]['board'][cod]['val'] === '-'
                    && gameInfos[rmid]['countdown'] > -1) { //まだ値が入っていないものに対して
                    //正解の場合
                    console.log('正解');
                    gameInfos[rmid]['board'][cod]['val'] = val;
                    gameInfos[rmid]['board'][cod]['id'] = matchUserId;
                    gameInfos[rmid]['points'][matchUserId] += parseInt(val);
                    gameInfos[rmid]['countdown'] += 10; //正解したら+10秒
                    eventData = { status: 'correct', matchUserId: matchUserId, val: val, coordinate: cod };
                    gameInfos[rmid]['logs'].push(eventData);
                }
                else if (gameInfos[rmid]['board'][cod]['val'] === '-') {
                    console.log('不正解');
                    //不正解の場合減点
                    gameInfos[rmid]['points'][matchUserId] -= parseInt(val);
                    gameInfos[rmid]['countdown'] = -1;
                    eventData = { status: 'incorrect', matchUserId: matchUserId, val: val, coordinate: cod };
                    gameInfos[rmid]['logs'].push(eventData);
                }
                io.to(rmid).emit('event', eventData);
                io.to(rmid).emit("state", { board: gameInfos[rmid]['board'], points: gameInfos[rmid]['points'] });
            }
            else {
                //自分のターンではない
                console.log('対象のユーザーのターンでないため入力棄却');
            }
        });
    }
}
main().catch(e => { console.log(e); });
function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}
