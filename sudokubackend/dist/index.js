"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const socket_io_1 = __importDefault(require("socket.io"));
const http_1 = __importDefault(require("http"));
const cosmos_1 = require("@azure/cosmos");
const crypto_1 = __importDefault(require("crypto"));
const async_lock_1 = __importDefault(require("async-lock"));
const turnmode_1 = require("./src/turnmode");
const gameLogic_1 = require("./src/gameLogic");
const INFINITROOM = 'InfiniteRoom';
//部屋ごとの盤面情報保持
const gameInfos = {};
/**
 * 排他処理用。同時に処理が走ると困るものについて使用。答え提出処理など
 */
const lock = new async_lock_1.default();
async function main() {
    gameInfos[INFINITROOM] = generateStartGameInfoInfiniteMode();
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
        query: "select u.pk,u.id,u.passWord,u.rate,u.name from users u"
    };
    let usersCosmos;
    // Get items 
    try {
        //cosmosDBが使いにくいので都度問い合わせるのでなく、
        //ランキング情報全て取得しておいてメモリに持った情報を参照する。更新は都度更新しにいく
        const { resources } = await container.items.query(querySpec).fetchAll();
        console.log('cosmosDB Data:', resources);
        //配列のままだと使いにくいので、id(matchUserId)をキーにしたオブジェクトに
        usersCosmos = resources.reduce((acc, item) => {
            acc[item['id']] = item;
            return acc;
        }, {});
    }
    catch (error) {
        console.log(error);
        usersCosmos = {};
    }
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: true }));
    const PORT = process.env.PORT || 3000;
    //CROS対応
    app.use((req, res, next) => {
        next();
    });
    //一覧取得
    app.use('/', express_1.default.static('public'));
    let socketOpt = {};
    if (process.env.NODE_ENV === 'development') {
        socketOpt =
            {
                cors: {
                    origin: ["http://localhost:5173"]
                }
            };
    }
    else {
    }
    const server = http_1.default.createServer(app);
    const io = new socket_io_1.default.Server(server, socketOpt);
    /*connection(webSocket確立時)*/
    io.on('connection', function (socket) {
        const count = io.engine.clientsCount;
        io.emit('connectnum', count);
        //リセット。もしだれもいない部屋の盤面があれば消しておく//ただしInfiniteRoomを除く
        Object.keys(gameInfos).forEach(rmkey => {
            if (rmkey === INFINITROOM)
                return;
            const rmclients = io.sockets.adapter.rooms.get(rmkey);
            const rmNumClients = rmclients ? rmclients.size : 0;
            if (rmNumClients === 0) {
                //nagaimemo:削除処理は一定時間経過後に誰も入っていなければ消すような処理にする。
                //だれかが入ってきたらとかではなく、完全に非同期でチェックしても良いかもしれない
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
            const problemnum = (0, gameLogic_1.getRandomInt)(500);
            const startboard = gameLogic_1.problemlines[problemnum];
            const answer = gameLogic_1.answerlines[problemnum];
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
            socket.data.passWord = data['passWord'];
            socket.data.subUserId = data['subUserId'];
            socket.data.pubUserId = data['pubUserId'];
            socket.data.matchUserId = data['pubUserId'];
            console.log('gogame', data);
            if (!(socket.data.pubUserId in usersCosmos)) {
                usersCosmos[socket.data.pubUserId] = {
                    "pk": "A",
                    "id": socket.data.pubUserId,
                    "passWord": socket.data.passWord,
                    "name": data['name'].slice(0, 24),
                    "rate": 1500
                };
            }
            else if (socket.data.passWord === usersCosmos[socket.data.pubUserId]['passWord']) {
                //名前だけ更新
                usersCosmos[socket.data.pubUserId]['name'] = data['name'].slice(0, 24);
            }
            else if (socket.data.pubUserId === 'auto') {
                //autoという文字列も入れられると困るので……
                console.log('不正検知:', socket.data.pubUserId, socket.data.passWord);
                return;
            }
            else {
                //nagai pubUserIdは既に入っているのと同じものを持っているのに
                //passWordが一致しない場合……、それは他の人のpubUserIdに不正なパスワードで入るのと同じ
                console.log('不正検知:', socket.data.pubUserId, socket.data.passWord);
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
                const returnState = { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'], highOrLowHistory: gameInfos[roomId].users[socket.data.matchUserId].highOrLowHistory, remainingHighOrLowCount: gameInfos[roomId].users[socket.data.matchUserId].remainingHighOrLowCount };
                socket.emit('state', returnState);
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
                gameInfos[roomId] = (0, gameLogic_1.generateStartGameInfo)(cl0.data, cl1.data, 'SimpleMode');
                const returnState = { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'], highOrLowHistory: [], remainingHighOrLowCount: gameLogic_1.INI_REMAINING_HIGHORLOW };
                io.to(roomId).emit('state', returnState);
                const intervalid = setInterval(function () {
                    gameInfos[roomId]['startCountDown'] -= 1;
                    io.to(roomId).emit("startCountDown", gameInfos[roomId]['startCountDown']);
                    if (gameInfos[roomId]['startCountDown'] < 1) {
                        clearInterval(intervalid);
                    }
                }, 1000);
            }
        });
        (0, turnmode_1.gogameTurnMode)(io, socket, usersCosmos, gameInfos, lock, container);
        //待機ルームに入る用
        socket.on('gogameInfiniteMode', function (data) {
            socket.data.passWord = data['passWord'];
            socket.data.subUserId = data['subUserId'];
            socket.data.pubUserId = data['pubUserId'];
            socket.data.matchUserId = data['pubUserId'];
            console.log('gogame', data);
            if (!(socket.data.pubUserId in usersCosmos)) {
                usersCosmos[socket.data.pubUserId] = {
                    "pk": "A",
                    "id": socket.data.pubUserId,
                    "passWord": socket.data.passWord,
                    "name": data['name'].slice(0, 24),
                    "rate": 1500
                };
            }
            else if (socket.data.passWord === usersCosmos[socket.data.pubUserId]['passWord']) {
                //名前だけ更新
                usersCosmos[socket.data.pubUserId]['name'] = data['name'].slice(0, 24);
            }
            else if (socket.data.pubUserId === 'auto') {
                //autoという文字列も入れられると困るので……
                console.log('不正検知:', socket.data.pubUserId, socket.data.passWord);
                return;
            }
            else {
                console.log('不正検知:', socket.data.pubUserId, socket.data.passWord);
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
            socket.emit('match', INFINITROOM);
            const rclients = io.sockets.adapter.rooms.get(INFINITROOM);
            //同一ブラウザ同士の対決、もしく同一のpubUserId同士（不正に設定）の場合
            rclients?.forEach(cl => {
                const sk = io.sockets.sockets.get(cl);
                if (sk?.data.matchUserId && socket.data.pubUserId === sk?.data.matchUserId) {
                    socket.data.matchUserId = socket.data.subUserId;
                }
            });
            socket.join(INFINITROOM);
            gameInfos[INFINITROOM]['points'][socket.data.matchUserId] = 0; //参加時0ポイントで参加
            console.log('ルーム: InfiniteRoomに入っている人のIDのSet', rclients);
            console.log('待機ルームの人のIDのSet', rclients);
            console.log('InfiniteModeゲーム開始');
            //正常に部屋が立ったなら
            //ゲームに必要な情報を作成する
            //盤面の正解の情報,現在の盤面の状態
            //io.to(INFINITROOM).emit('state', { board: gameInfos[INFINITROOM]['board'], points: gameInfos[INFINITROOM]['points'] });
            (0, gameLogic_1.emitStateAllRoomMember)(INFINITROOM, io, gameInfos);
        });
        //ホバー
        socket.on('hover', function (data) {
            const returnData = data;
            returnData['matchUserId'] = socket.data.matchUserId;
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
        socket.on('submitInfiniteMode', function (submitInfo) {
            console.log('submitInfo: ', submitInfo);
            checkInfiniteMode(submitInfo, socket);
        });
        //クライアントから受けた数独提出その他情報
        socket.on('submitExt', function (submitExtInfo) {
            if (submitExtInfo.extType === 'HIGHORLOW') {
                highOrRowCheck(submitExtInfo, socket);
            }
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
     * @param data0 socketのdata
     * @param data1
     * @param
     * @returns
     */
    function generateStartGameInfoInfiniteMode() {
        const problemnum = (0, gameLogic_1.getRandomInt)(500);
        const startboard = gameLogic_1.problemlines[problemnum];
        const answer = gameLogic_1.answerlines[problemnum];
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
            answer: answer, points: {},
            logs: [], startCountDown: 6,
            idTableMatchPub: {},
            mode: 'InfiniteMode',
            users: {}
        };
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
            const endgame = checkSubimtBoardEmit(submitInfo, socket, rmid, io);
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
                    console.log('ゲーム終了 delete');
                    delete gameInfos[rmid];
                })();
            }
        });
    }
    /**
     * 提出された回答を判定して、全てのユーザーに結果送信
     * @param submitInfo
     * @param socket
     */
    function checkInfiniteMode(submitInfo, socket) {
        const rmid = INFINITROOM;
        lock.acquire(rmid, function () {
            const endgame = checkSubimtBoardEmit(submitInfo, socket, rmid, io);
            if (endgame === true) {
                console.log('ルーム:', rmid, 'のゲーム終了');
                setTimeout(() => {
                    gameInfos[rmid] = generateStartGameInfoInfiniteMode();
                    const rclients = io.sockets.adapter.rooms.get(INFINITROOM);
                    lock.acquire(rmid, () => {
                        rclients?.forEach(cl => {
                            const sk = io.sockets.sockets.get(cl);
                            if (sk?.data.matchUserId) {
                                gameInfos[rmid]['points'][sk.data.matchUserId] = 0; //初期化？
                            }
                        });
                    });
                }, 5000);
            }
        });
    }
    /**
 * 提出されたhighorlowを判定して、提出者に結果送信
 * @param submitInfo
 * @param socket
 */
    function highOrRowCheck(submitExtInfo, socket) {
        const rmid = submitExtInfo['roomId'];
        lock.acquire(rmid, function () {
            if (gameInfos[rmid]['startCountDown'] > 0) {
                console.log('カウントダウン中のため入力棄却');
                return;
            }
            if (!gameInfos[rmid]) {
                console.log('既にゲーム終了しているため棄却');
                return;
            }
            const cod = submitExtInfo['coordinate'];
            if (gameInfos[rmid]['board'][cod]['val'] !== '-') {
                console.log('既に値が判明しているため棄却');
                return;
            }
            const matchUserId = socket.data.matchUserId;
            if (gameInfos[rmid].users[matchUserId].remainingHighOrLowCount < 1) {
                console.log('High or Low使用回数を使い切ったため棄却');
                return;
            }
            const indx = parseInt(cod[0]) * 9 + parseInt(cod[1]);
            const highOrLow = parseInt(gameInfos[rmid]['answer'][indx]) >= 5 ? 'H' : 'L';
            gameInfos[rmid].users[matchUserId].highOrLowHistory.push({ coordinate: cod, highOrLow: highOrLow });
            gameInfos[rmid].users[matchUserId].remainingHighOrLowCount--;
            const eventData = { status: 'CheckHighOrLow', matchUserId: matchUserId, coordinate: cod };
            gameInfos[rmid]['logs'].push(eventData);
            io.to(rmid).emit('event', eventData);
            const returnState = { board: gameInfos[rmid]['board'], points: gameInfos[rmid]['points'], highOrLowHistory: gameInfos[rmid].users[matchUserId].highOrLowHistory, remainingHighOrLowCount: gameInfos[rmid].users[matchUserId].remainingHighOrLowCount };
            socket.emit('state', returnState);
        });
    }
}
main().catch(e => { console.log(e); });
/**
 * 対象の盤面に提出された回答チェック、配信、終了検知（Simple,Infiniteのみ。ターンモード以外）
 * @param submitInfo
 * @param socket
 * @param rmid
 * @param io
 * @returns {boolean} endgame ゲーム終了検知したらtrue
 */
function checkSubimtBoardEmit(submitInfo, socket, rmid, io) {
    if (gameInfos[rmid]['startCountDown'] > 0) {
        console.log('カウントダウン中のため入力棄却');
        return false;
    }
    if (!gameInfos[rmid]) {
        console.log('既にゲーム終了しているため棄却');
        return false;
    }
    const cod = submitInfo['coordinate'];
    if (gameInfos[rmid]['board'][cod]['val'] !== '-') {
        console.log('既に回答されているエリアのため棄却');
        return false;
    }
    const val = submitInfo['val'];
    const indx = parseInt(cod[0]) * 9 + parseInt(cod[1]);
    const matchUserId = socket.data.matchUserId;
    let eventData;
    if (gameInfos[rmid]['answer'][indx] === val) {
        //正解の場合
        console.log('正解');
        gameInfos[rmid]['board'][cod]['val'] = val;
        gameInfos[rmid]['board'][cod]['id'] = matchUserId;
        gameInfos[rmid]['points'][matchUserId] += parseInt(val);
        eventData = { status: 'Correct', matchUserId: matchUserId, val: val, coordinate: cod };
        gameInfos[rmid]['logs'].push(eventData);
    }
    else {
        console.log('不正解');
        //不正解の場合減点
        gameInfos[rmid]['points'][matchUserId] -= parseInt(val);
        eventData = { status: 'InCorrect', matchUserId: matchUserId, val: val, coordinate: cod };
        gameInfos[rmid]['logs'].push(eventData);
    }
    io.to(rmid).emit('event', eventData);
    (0, gameLogic_1.emitStateAllRoomMember)(rmid, io, gameInfos);
    // 終了検知
    let endgame = true;
    Object.keys(gameInfos[rmid]['board']).forEach(key => {
        if (gameInfos[rmid]['board'][key]['val'] === '-') {
            endgame = false;
        } //nagai foreachを途中でやめることはできないらしい……無駄すぎるがとりあえず
    });
    return endgame;
}
//# sourceMappingURL=index.js.map