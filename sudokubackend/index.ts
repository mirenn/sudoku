import express from 'express';
import socketio from 'socket.io';
import http from 'http'
import fs from 'fs'
import { CosmosClient } from "@azure/cosmos";
import crypto from 'crypto'
import AsyncLock from 'async-lock';

/**
 * 現在の数独魔法陣盤面情報（見えている盤面）
 */
interface Board {
    [coordinate: string]: {//座標。01~88まで。
        id: string,//当てた人のid 自動:auto,まだ:mada,プレイヤー:matchUserId
        val: string,//見えている値。数字の文字、まだ決まっていない値は-で表現
    }
}
/**
 * 部屋に入っている二人のポイントを入れるオブジェクト用
 */
interface Points {
    [matchUserId: string]: number
}
/** stateとして返す情報 */
interface ReturnState {
    board: Board,
    points: Points,
    highOrLowHistory: HighOrLowHistory[],
    remainingHighOrLowCount: number,
}

/**
 * 部屋ごとのゲーム情報を管理する
 */
interface GameInfo {
    board: Board,
    answer: string,//その部屋の魔法陣の正解情報
    points: Points,//['points']['それぞれのuserのid']ここに各点数が入っている。matchUserIdが最初からもてれるならこれでよかったが……、そうではなく初期化時どうしようもないので…空で宣言してからみたいな使い方になる
    startCountDown: number,//ゲーム開始時のカウントダウンの残り秒数。
    logs: EventData[],//提出された情報の正解、不正解などの操作情報ログ
    idTableMatchPub: { [matchUserId: string]: string },//matchUserIdとpubUserIdの対応。endgame時に使用
    mode: Mode,
    users: { [matchUserId: string]: { remainingHighOrLowCount: number, highOrLowHistory: HighOrLowHistory[] } },//ここにPointsもまとめてしまいたい……,元気があったらやる
    //以下turnmode時のみ存在。tsのエラーがめんどいのでany型に
    /** string[] ターンの順番、matchUserIdが入る。matchUserId0,'auto',matchUserId1,'auto'*/
    turnArray?: any,
    /** //number 誰のターンかを意味する、turnArrayのindex*/
    turnIndex?: any,
    /** boolean 回答提出されたときtrueになる、回答提出されていたなら次のautoでは盤面はめくられない。falseならめくる*/
    submitFlag?: any,
    /** boolean ゲーム終了時、もしくは誰も部屋にいないときtrueになり、trueならsetTimeout内の定期実行処理内で盤面情報削除処理実行*/
    turnModeGameEnd?: any,
    /**number ゲームを管理するカウントダウン */
    countdown?: any
}
interface HighOrLowHistory { coordinate: string, highOrLow: 'H' | 'L' }

/**
 * 部屋のIDがキーで、各部屋の情報を格納
 */
interface RoomDictionaryArray {
    [rooms: string]: GameInfo
}
type Mode = 'SimpleMode' | 'TurnMode' | 'InfiniteMode';
/**
 * go_gameゲームを開始したときにクライアントより送信されるデータ
 */
interface GoGameData {
    roomId: string,
    passWord: string,
    pubUserId: string,
    subUserId: string,//同じブラウザ同士の対戦用のid
    name: string,
}
/** 答え提出時のデータ。memo:roomIdはsocket.dataに持つようにすれば送らなくても良い実装にできる */
interface SubmitInfo { roomId: string, coordinate: string, val: string }
/** その他提出データ */
interface SubmitExtInfo { roomId: string, extType: ExtType, coordinate: string }
type ExtType = 'HIGHORLOW';

interface EventData { status: Status, matchUserId: string, val?: string, coordinate: string }
type Status = 'Correct' | 'InCorrect' | 'CheckHighOrLow';

/**
 * cosmosDBからとってきてメモリに保持する情報
 * idはpubUserId
 */
interface UsersCosmosDB { [id: string]: { pk: string, id: string, passWord: string, rate: number, name: string } }
interface SocketData { passWord: string, matchUserId: string, pubUserId: string }

//数独の問題と答えのセットを生成
const answertext = fs.readFileSync("./answer.txt");
const astxt = answertext.toString();
const answerlines = astxt.split('\n');
const problemtext = fs.readFileSync("./problem.txt", 'utf8');
const problemlines = problemtext.toString().split('\n');

const INFINITROOM = 'InfiniteRoom';
/** High or lowを使える残りの初期値 */
const INI_REMAINING_HIGHORLOW = 4;

const app: express.Express = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
const PORT = process.env.PORT || 3000;

//部屋ごとの盤面情報保持
const gameInfos: RoomDictionaryArray = {};

/**
 * 排他処理用。同時に処理が走ると困るものについて使用。答え提出処理など
 */
const lock = new AsyncLock();

async function main() {
    gameInfos[INFINITROOM] = generateStartGameInfoInfiniteMode();

    //AzureDB接続
    // Provide required connection from environment variables
    const key = String(process.env.COSMOS_KEY);
    const endpoint = String(process.env.COSMOS_ENDPOINT);
    // Set Database name and container name with unique timestamp
    const databaseName = `users`;
    const containerName = `products`;
    const partitionKeyPath = ["/pk"];//categoryId
    // Authenticate to Azure Cosmos DB
    const cosmosClient = new CosmosClient({ endpoint, key });
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
    let usersCosmos: UsersCosmosDB;
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
    } catch (error) {
        console.log(error);
        usersCosmos = {};
    }

    //CROS対応
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
        next();
    });

    //一覧取得
    app.use('/', express.static('public'));

    let socketOpt = {};
    if (process.env.NODE_ENV === 'development') {
        socketOpt =
        {
            cors: {
                origin: ["http://localhost:5173"]
            }
        };
    } else {

    }
    const server: http.Server = http.createServer(app);
    const io: socketio.Server = new socketio.Server(server, socketOpt);

    /*connection(webSocket確立時)*/
    io.on('connection', function (socket) {
        const count = io.engine.clientsCount;
        io.emit('connectnum', count);

        //リセット。もしだれもいない部屋の盤面があれば消しておく//ただしInfiniteRoomを除く
        Object.keys(gameInfos).forEach(rmkey => {
            if (rmkey === INFINITROOM) return;
            const rmclients = io.sockets.adapter.rooms.get(rmkey);
            const rmNumClients = rmclients ? rmclients.size : 0;
            if (rmNumClients === 0) {
                console.log('誰も入っていない部屋のため削除 ルーム:', rmkey);
                if (gameInfos[rmkey]['mode'] && gameInfos[rmkey]['mode'] === 'TurnMode') {
                    //turnmodeはsetTimeoutが非同期て動いているため、こっちで消したときに動いていると例外で死ぬため、消すのは
                    //setTimeoutに任せる
                    gameInfos[rmkey]['turnModeGameEnd'] = true;
                } else {
                    delete gameInfos[rmkey];
                }
            }
        });
        //ランキングを返す
        socket.on('requestranking', function () {
            const ranking: { id: string; rate: number, name: string }[] = Object.values(usersCosmos);
            socket.emit('ranking', ranking);
        });
        //一人用のゲームの盤面を返す
        socket.on('requestsingleplay', function () {
            const problemnum = getRandomInt(500);
            const startboard = problemlines[problemnum];
            const answer = answerlines[problemnum];

            const sboard: Board = {};
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
        socket.on('gogameSimpleMode', function (data: GoGameData) {
            let roomId = data['roomId'];
            socket.data.passWord = data['passWord'];
            socket.data.subUserId = data['subUserId'];
            socket.data.pubUserId = data['pubUserId'];
            socket.data.matchUserId = data['pubUserId'];
            console.log('gogame', data);

            if (!(socket.data.pubUserId in usersCosmos)) {
                usersCosmos[socket.data.pubUserId] = {
                    "pk": "A",//必要。pkとユニークキーがないとcosmosDBはindexが効かない。
                    "id": socket.data.pubUserId,//ユニークキー
                    "passWord": socket.data.passWord,
                    "name": data['name'].slice(0, 24),//不正に長い文字を投げられても制限する。
                    "rate": 1500
                };
            } else if (socket.data.passWord === usersCosmos[socket.data.pubUserId]['passWord']) {
                //名前だけ更新
                usersCosmos[socket.data.pubUserId]['name'] = data['name'].slice(0, 24);
            } else if (socket.data.pubUserId === 'auto') {
                //autoという文字列も入れられると困るので……
                console.log('不正検知:', socket.data.pubUserId, socket.data.passWord);
                return;
            } else {
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
                socket.leave('waitingroom_simple');//一応ちゃんと抜ける
                socket.leave('waitingroom_turn');
                socket.join(roomId);
                socket.emit('match', roomId);
                const returnState: ReturnState = { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'], highOrLowHistory: gameInfos[roomId].users[socket.data.matchUserId].highOrLowHistory, remainingHighOrLowCount: gameInfos[roomId].users[socket.data.matchUserId].remainingHighOrLowCount };
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
            roomId = crypto.randomUUID();

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

            if (cl0.data.pubUserId === cl1.data.pubUserId) {//同一ブラウザ同士の対決、もしく同一のpubUserId同士（不正に設定）の場合
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
            } else {
                console.log('SimpleModeゲーム開始');
                //正常に部屋が立ったなら
                //ゲームに必要な情報を作成する
                //盤面の正解の情報,現在の盤面の状態
                gameInfos[roomId] = generateStartGameInfo(cl0.data as SocketData, cl1.data as SocketData, 'SimpleMode');
                const returnState: ReturnState = { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'], highOrLowHistory: [], remainingHighOrLowCount: INI_REMAINING_HIGHORLOW };
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
        //待機ルームに入る用
        socket.on('gogameTurnMode', function (data: GoGameData) {
            let roomId = data['roomId'];
            socket.data.passWord = data['passWord'];
            socket.data.subUserId = data['subUserId'];
            socket.data.pubUserId = data['pubUserId'];
            socket.data.matchUserId = data['pubUserId'];
            console.log('gogameTurnMode', data);

            if (!(socket.data.pubUserId in usersCosmos)) {
                usersCosmos[socket.data.pubUserId] = {
                    "pk": "A",//必要。pkとユニークキーがないとcosmosDBはindexが効かない。
                    "id": socket.data.pubUserId,//ユニークキー
                    "passWord": socket.data.passWord,
                    "name": data['name'].slice(0, 24),//不正に長い文字を投げられても制限する。
                    "rate": 1500
                };
            } else if (socket.data.passWord === usersCosmos[socket.data.pubUserId]['passWord']) {
                //名前だけ更新
                usersCosmos[socket.data.pubUserId]['name'] = data['name'].slice(0, 24);
            } else if (socket.data.pubUserId === 'auto') {
                //autoという文字列も入れられると困るので……
                console.log('不正検知:', socket.data.pubUserId, socket.data.passWord);
                return;
            } else {
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
                socket.leave('waitingroom_simple');//一応ちゃんと抜ける
                socket.leave('waitingroom_turn');
                socket.join(roomId);
                const returnState: ReturnState = { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'], highOrLowHistory: gameInfos[roomId].users[socket.data.matchUserId].highOrLowHistory, remainingHighOrLowCount: gameInfos[roomId].users[socket.data.matchUserId].remainingHighOrLowCount };
                socket.emit('state', returnState);
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
            roomId = crypto.randomUUID();

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

            if (cl0.data.pubUserId === cl1.data.pubUserId) {//同一ブラウザ同士の対決、もしく同一のpubUserId同士（不正に設定）の場合
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
            gameInfos[roomId] = generateStartGameInfo(cl0.data as SocketData, cl1.data as SocketData, 'TurnMode');
            const returnState: ReturnState = { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'], highOrLowHistory: [], remainingHighOrLowCount: INI_REMAINING_HIGHORLOW };
            io.to(roomId).emit('state', returnState);

            let iterCnt = 0;
            //処理が長引く場合は１秒以上かかる。setIntervalは最悪処理が並行で走るのでsetTimeoutに
            setTimeout(function gameCountDownFunction() {
                lock.acquire(roomId, function (done) {
                    if (gameInfos[roomId]['turnModeGameEnd']) {
                        console.log('turnModeGameEnd delete');
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
                        return;//処理ここまで
                    }
                    //以降普通のゲーム
                    gameInfos[roomId]['countdown'] -= 1;
                    if (gameInfos[roomId]['countdown'] < 0) {//0より小さくなったら、次の人のターンに遷移するという一連の処理
                        if (gameInfos[roomId]['turnIndex'] === gameInfos[roomId]['turnArray']?.length - 1) {
                            //最後のインデックスになったら最初にする例：3->0
                            //turnindexは最初に変える
                            gameInfos[roomId]['turnIndex'] = 0;
                        } else {
                            gameInfos[roomId]['turnIndex']++;
                        }
                        if (gameInfos[roomId]['turnArray'][gameInfos[roomId]['turnIndex']] === 'auto') {
                            gameInfos[roomId]['countdown'] = 5;
                            if (gameInfos[roomId]['submitFlag']) {
                                //提出していたならautoでマスが開かれることはなし。
                                gameInfos[roomId]['submitFlag'] = false;
                                gameInfos[roomId]['countdown'] = 0;
                            } else {
                                //memo:前のプレイヤーのターンで答えが提出されていなかったなら、autoで一枚マスが開かれる
                                const keys = Object.keys(gameInfos[roomId]['board']).filter(key => gameInfos[roomId]['board'][key]['val'] === '-');
                                const randomKey = keys[Math.floor(Math.random() * keys.length)];
                                const indx = parseInt(randomKey[0]) * 9 + parseInt(randomKey[1]);
                                gameInfos[roomId]['board'][randomKey] = { id: 'auto', val: gameInfos[roomId]['answer'][indx] };
                                const eventData = { status: 'auto', matchUserId: 'auto', val: gameInfos[roomId]['answer'][indx], coordinate: randomKey };
                                io.to(roomId).emit("event", eventData);
                                //io.to(roomId).emit('state', { board: gameInfos[roomId]['board'], points: gameInfos[roomId]['points'] });
                                emitStateAllRoomMember(roomId, io);
                            }
                        } else {
                            gameInfos[roomId]['countdown'] = 10;
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
                            const ranking: { id: string; rate: number, passWord: string, name: string }[] = Object.values(usersCosmos);
                            io.to(roomId).emit('ranking', ranking);
                            try {
                                await container.items.upsert(usersCosmos[pUser0Id]);
                                await container.items.upsert(usersCosmos[pUser1Id]);
                            } catch (error) {
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
        //待機ルームに入る用
        socket.on('gogameInfiniteMode', function (data: GoGameData) {
            socket.data.passWord = data['passWord'];
            socket.data.subUserId = data['subUserId'];
            socket.data.pubUserId = data['pubUserId'];
            socket.data.matchUserId = data['pubUserId'];
            console.log('gogame', data);

            if (!(socket.data.pubUserId in usersCosmos)) {
                usersCosmos[socket.data.pubUserId] = {
                    "pk": "A",//必要。pkとユニークキーがないとcosmosDBはindexが効かない。
                    "id": socket.data.pubUserId,//ユニークキー
                    "passWord": socket.data.passWord,
                    "name": data['name'].slice(0, 24),//不正に長い文字を投げられても制限する。
                    "rate": 1500
                };
            } else if (socket.data.passWord === usersCosmos[socket.data.pubUserId]['passWord']) {
                //名前だけ更新
                usersCosmos[socket.data.pubUserId]['name'] = data['name'].slice(0, 24);
            } else if (socket.data.pubUserId === 'auto') {
                //autoという文字列も入れられると困るので……
                console.log('不正検知:', socket.data.pubUserId, socket.data.passWord);
                return;
            } else {
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
            gameInfos[INFINITROOM]['points'][socket.data.matchUserId] = 0;//参加時0ポイントで参加

            console.log('ルーム: InfiniteRoomに入っている人のIDのSet', rclients);
            console.log('待機ルームの人のIDのSet', rclients);

            console.log('InfiniteModeゲーム開始');
            //正常に部屋が立ったなら
            //ゲームに必要な情報を作成する
            //盤面の正解の情報,現在の盤面の状態
            //io.to(INFINITROOM).emit('state', { board: gameInfos[INFINITROOM]['board'], points: gameInfos[INFINITROOM]['points'] });
            emitStateAllRoomMember(INFINITROOM, io);
        });
        //ホバー
        socket.on('hover', function (data: { id: string }) {
            const returnData: any = data;
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
        socket.on('submitSimpleMode', function (submitInfo: SubmitInfo) {
            console.log('submitInfo: ', submitInfo);
            check(submitInfo, socket);
        });
        //クライアントから受けた数独提出答え受け取り用
        socket.on('submitTurnMode', function (submitInfo: SubmitInfo) {
            console.log('submitInfo: ', submitInfo);
            checkTurnModeAnswer(submitInfo, socket);
        });
        //クライアントから受けた数独提出答え受け取り用
        socket.on('submitInfiniteMode', function (submitInfo: SubmitInfo) {
            console.log('submitInfo: ', submitInfo);
            checkInfiniteMode(submitInfo, socket);
        });

        //クライアントから受けた数独提出その他情報
        socket.on('submitExt', function (submitExtInfo: SubmitExtInfo) {
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
     * 魔法陣の正解情報、現在の盤面など
     * simple turn兼用
     * @param data0 socketのdata
     * @param data1 
     * @param 
     * @returns 
     */
    function generateStartGameInfo(data0: SocketData, data1: SocketData, mode: Mode) {
        const problemnum = getRandomInt(500);
        const startboard = problemlines[problemnum];
        const answer = answerlines[problemnum];
        const asarray = answer.match(/.{9}/g);
        const askaigyo = asarray?.join('\n');
        console.log(askaigyo);//デバッグで自分で入力するとき用に魔法陣の答え出力

        const board: Board = {};
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
        const rtobj: GameInfo = {
            board: board,
            answer: answer, points: { [data0.matchUserId]: 0, [data1.matchUserId]: 0 },
            logs: [], startCountDown: 6,
            idTableMatchPub: { [data0.matchUserId]: data0.pubUserId, [data1.matchUserId]: data1.pubUserId },
            mode: mode,
            users: { [data0.matchUserId]: { remainingHighOrLowCount: INI_REMAINING_HIGHORLOW, highOrLowHistory: [] }, [data1.matchUserId]: { remainingHighOrLowCount: INI_REMAINING_HIGHORLOW, highOrLowHistory: [] } }
        };
        if (mode === 'TurnMode') {
            const data = [data0.matchUserId, data1.matchUserId];
            data.sort(() => Math.random() - 0.5);//ランダムに並び替える
            data.splice(1, 0, 'auto');
            data.push('auto');
            rtobj['turnArray'] = data;
            rtobj['turnIndex'] = 0;
            rtobj['countdown'] = 10;
        }
        return rtobj;
    }
    /**
     * 新しく作られた部屋のゲーム情報を生成する
     * @param data0 socketのdata
     * @param data1 
     * @param 
     * @returns 
     */
    function generateStartGameInfoInfiniteMode() {
        const problemnum = getRandomInt(500);
        const startboard = problemlines[problemnum];
        const answer = answerlines[problemnum];
        const asarray = answer.match(/.{9}/g);
        const askaigyo = asarray?.join('\n');
        console.log(askaigyo);//デバッグで自分で入力するとき用に魔法陣の答え出力

        const board: Board = {};
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
        const rtobj: GameInfo = {
            board: board,
            answer: answer, points: {},
            logs: [], startCountDown: 6,
            idTableMatchPub: {},
            mode: 'InfiniteMode',
            users: {}
        }
        return rtobj;
    }
    /**
     * 提出された回答を判定して、二人のユーザーに結果送信
     * @param submitInfo 
     * @param socket 
     */
    function check(submitInfo: SubmitInfo, socket: socketio.Socket) {
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
                    const ranking: { id: string; rate: number, passWord: string, name: string }[] = Object.values(usersCosmos);
                    io.to(rmid).emit('ranking', ranking);
                    try {
                        await container.items.upsert(usersCosmos[pUser0Id]);
                        await container.items.upsert(usersCosmos[pUser1Id]);
                    } catch (error) {
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
    function checkInfiniteMode(submitInfo: SubmitInfo, socket: socketio.Socket) {
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
                                gameInfos[rmid]['points'][sk.data.matchUserId] = 0;//初期化？
                            }
                        });
                    });
                }, 5000);
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
    function checkTurnModeAnswer(submitInfo: SubmitInfo, socket: socketio.Socket) {
        const rmid = submitInfo['roomId'];
        lock.acquire(rmid, function () {
            if (gameInfos[rmid]['startCountDown'] > 0) {
                console.log('カウントダウン中のため入力棄却');
                return;
            }
            if (!gameInfos[rmid]) {
                console.log('既にゲーム終了しているため棄却');
                return;
            }

            if (gameInfos[rmid]['turnArray'][gameInfos[rmid]['turnIndex']] === socket.data.matchUserId) {//提出者のターンなら
                const cod = submitInfo['coordinate'];
                const val: string = submitInfo['val'];
                const indx = parseInt(cod[0]) * 9 + parseInt(cod[1]);
                const matchUserId = socket.data.matchUserId;

                gameInfos[rmid]['submitFlag'] = true;

                let eventData;
                if (gameInfos[rmid]['answer'][indx] === val && gameInfos[rmid]['board'][cod]['val'] === '-'
                    && gameInfos[rmid]['countdown'] > -1) {//まだ値が入っていないものに対して
                    //正解の場合
                    console.log('正解');
                    gameInfos[rmid]['board'][cod]['val'] = val;
                    gameInfos[rmid]['board'][cod]['id'] = matchUserId;
                    gameInfos[rmid]['points'][matchUserId] += parseInt(val);
                    gameInfos[rmid]['countdown'] += 10;//正解したら+10秒
                    eventData = { status: 'Correct' as Status, matchUserId: matchUserId, val: val, coordinate: cod };
                    gameInfos[rmid]['logs'].push(eventData);
                } else if (gameInfos[rmid]['board'][cod]['val'] === '-') {
                    console.log('不正解');
                    //不正解の場合減点
                    gameInfos[rmid]['points'][matchUserId] -= parseInt(val);
                    gameInfos[rmid]['countdown'] = -1;
                    eventData = { status: 'InCorrect' as Status, matchUserId: matchUserId, val: val, coordinate: cod };
                    gameInfos[rmid]['logs'].push(eventData);
                }
                //const returnState: ReturnState = { board: gameInfos[rmid]['board'], points: gameInfos[rmid]['points'], highOrLowHistory: gameInfos[rmid].users[matchUserId].highOrLowHistory, remainingHighOrLowCount: gameInfos[rmid].users[matchUserId].remainingHighOrLowCount };
                io.to(rmid).emit('event', eventData);
                //io.to(rmid).emit('state', returnState);
                emitStateAllRoomMember(rmid, io);
            } else {
                //自分のターンではない
                console.log('対象のユーザーのターンでないため入力棄却');
            }
        });
    }
    /**
 * 提出されたhighorlowを判定して、提出者に結果送信
 * @param submitInfo 
 * @param socket 
 */
    function highOrRowCheck(submitExtInfo: SubmitExtInfo, socket: socketio.Socket) {
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

            const eventData: EventData = { status: 'CheckHighOrLow' as Status, matchUserId: matchUserId, coordinate: cod };
            gameInfos[rmid]['logs'].push(eventData);
            io.to(rmid).emit('event', eventData);

            const returnState: ReturnState = { board: gameInfos[rmid]['board'], points: gameInfos[rmid]['points'], highOrLowHistory: gameInfos[rmid].users[matchUserId].highOrLowHistory, remainingHighOrLowCount: gameInfos[rmid].users[matchUserId].remainingHighOrLowCount };
            socket.emit('state', returnState);
        });
    }
}
main().catch(e => { console.log(e); });

function getRandomInt(max: number) {
    return Math.floor(Math.random() * max);
}

/**
 * 対象の盤面に提出された回答チェック、配信、終了検知（Simple,Infiniteのみ。ターンモード以外）
 * @param submitInfo 
 * @param socket 
 * @param rmid 
 * @param io 
 * @returns {boolean} endgame ゲーム終了検知したらtrue 
 */
function checkSubimtBoardEmit(submitInfo: SubmitInfo, socket: socketio.Socket, rmid: string, io: socketio.Server) {
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
    const val: string = submitInfo['val'];
    const indx = parseInt(cod[0]) * 9 + parseInt(cod[1]);
    const matchUserId = socket.data.matchUserId;

    let eventData: EventData;
    if (gameInfos[rmid]['answer'][indx] === val) {
        //正解の場合
        console.log('正解');
        gameInfos[rmid]['board'][cod]['val'] = val;
        gameInfos[rmid]['board'][cod]['id'] = matchUserId;
        gameInfos[rmid]['points'][matchUserId] += parseInt(val);
        eventData = { status: 'Correct' as Status, matchUserId: matchUserId, val: val, coordinate: cod };
        gameInfos[rmid]['logs'].push(eventData);
    } else {
        console.log('不正解');
        //不正解の場合減点
        gameInfos[rmid]['points'][matchUserId] -= parseInt(val);
        eventData = { status: 'InCorrect' as Status, matchUserId: matchUserId, val: val, coordinate: cod };
        gameInfos[rmid]['logs'].push(eventData);
    }
    io.to(rmid).emit('event', eventData);
    emitStateAllRoomMember(rmid, io);

    // 終了検知
    let endgame = true;
    Object.keys(gameInfos[rmid]['board']).forEach(key => {
        if (gameInfos[rmid]['board'][key]['val'] === '-') {
            endgame = false;
        }//nagai foreachを途中でやめることはできないらしい……無駄すぎるがとりあえず
    });
    return endgame;
}
/** returnStateを対象のroom全員にbroadcastする。(他のユーザーが知ってはいけないデータをそれぞれに配りたいので、個別にデータを生成) */
function emitStateAllRoomMember(rmid: string, io: socketio.Server) {
    const rclients = io.sockets.adapter.rooms.get(rmid);
    rclients?.forEach(cl => {
        const sk = io.sockets.sockets.get(cl);
        if (sk?.data.matchUserId) {
            const returnState: ReturnState = { board: gameInfos[rmid]['board'], points: gameInfos[rmid]['points'], highOrLowHistory: gameInfos[rmid].users[sk.data.matchUserId].highOrLowHistory, remainingHighOrLowCount: gameInfos[rmid].users[sk.data.matchUserId].remainingHighOrLowCount };
            sk.emit('state', returnState);
        }
    });
}