import express from 'express';
import socketio from 'socket.io';
import http from 'http'
import fs from 'fs'
import { CosmosClient } from "@azure/cosmos";
import crypto from 'crypto'

/**
 * 現在の数独魔法陣盤面情報（見えている盤面）
 */
interface board {
    [coordinate: string]: {//座標
        id: string,//当てた人のid 自動:auto,まだ:mada,プレイヤー:userId
        val: string,//見えている値
    }
}
/**
 * 部屋に入っている二人のポイントを入れるオブジェクト用
 */
interface points {
    [matchUserId: string]: number
}
/**
 * 部屋ごとのゲーム情報を管理する
 */
interface gameInfo {
    board: board,
    answer: string,//その部屋の魔法陣の正解情報
    points: points,//['points']['それぞれのuserのid']ここに各点数が入っている。userIdが最初からもてれるならこれでよかったが……、そうではなく初期化時どうしようもないので…空で宣言してからみたいな使い方になる
    countdown: number,//ゲーム開始時のカウントダウンの残り秒数。
    logs: object[],//提出された情報の正解、不正解などの操作情報ログ
    idTable: { [userId: string]: string },//userIdとmatchUserIdの対応……使わずにsocket.dataのmatchUserIdを参照するのが基本。
    idTableMatchPub: { [matchUserId: string]: string },//matchUserIdとpubUserIdの対応。endgame時に使用
    mode: mode,
    whichTurnUserId?: string//TurnMode時のみ存在するプロパティ
}
/**
 * 部屋
 */
interface roomDictionaryArray {
    // (文字型のキー):  string
    [rooms: string]: gameInfo
}
type mode = 'SimpleMode' | 'TurnMode';
/**
 * go_gameゲームを開始したときにクライアントより送信されるデータ
 */
interface gogamedata {
    roomId: string,
    userId: string,
    pubUserId: string,
    subUserId: string,//同じブラウザ同士の対戦用のid
    name: string,
    mode: mode
}
/**
 * cosmosDBからとってきてメモリに保持する情報
 * idはpubUserId
 */
interface usersCosmosDB { [id: string]: { pk: string, id: string, rate: number, name: string } }
interface socketData { userId: string, matchUserId: string, pubUserId: string }

//数独の問題と答えのセットを生成
const answertext = fs.readFileSync("./answer.txt");
const astxt = answertext.toString();
const answerlines = astxt.split('\n');
const problemtext = fs.readFileSync("./problem.txt", 'utf8');
const problemlines = problemtext.toString().split('\n');

const app: express.Express = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
const PORT = process.env.PORT || 3000;

//部屋ごとの盤面情報保持
const boards: roomDictionaryArray = {};

async function main() {
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
    //データが何一つないときは以下ソースでINSERT
    // const items = [
    //     {
    //         "pk": "A",
    //         "id": '838c8664-f99c-4d03-a90b-3935944005c4',
    //         "name": 'nagainame',
    //         "rate": 1500
    //     }];
    // Create all items
    // for (const item of items) {
    //     const { resource } = await container.items.create(item);
    //     console.log(resource, ' inserted');
    // }
    console.log(`${container.id} container ready`);
    const querySpec = {
        query: "select u.pk,u.id,u.rate,u.name from users u"
    };
    let usersCosmos: usersCosmosDB;
    // Get items 
    try {
        //cosmosDBが使いにくいので都度問い合わせるのでなく、
        //ランキング情報全て取得しておいてメモリに持った情報を参照する。更新は都度更新しにいく
        const { resources } = await container.items.query(querySpec).fetchAll();
        console.log('cosmosDB Data:', resources);
        //配列のままだと使いにくいので、id(userID)をキーにしたオブジェクトに
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
    // ディレクトリでindex.htmlをリク・レス
    // app.get('/', (req, res) => {
    //     res.sendFile(__dirname  + '/public/index.html');
    //   });

    const server: http.Server = http.createServer(app);
    const io: socketio.Server = new socketio.Server(server);

    /*connection(webSocket確立時)*/
    io.on('connection', function (socket) {
        const count = io.engine.clientsCount;
        // may or may not be similar to the count of Socket instances in the main namespace, depending on your usage
        //const count2 = io.of("/").sockets.size;

        io.emit('connectnum', count);

        //リセット。もしだれもいない部屋の盤面があれば消しておく
        Object.keys(boards).forEach(rmkey => {
            const rmclients = io.sockets.adapter.rooms.get(rmkey);
            const rmNumClients = rmclients ? rmclients.size : 0;
            if (rmNumClients === 0) {
                console.log('誰も入っていない部屋のため削除 ルーム:', rmkey);
                delete boards[rmkey];
            }
        });
        //ランキングを返す
        socket.on('requestranking', function () {
            const ranking: { id: string; rate: number, name: string }[] = Object.values(usersCosmos);
            socket.emit('ranking', ranking);
        });
        //
        socket.on('requestsingleplay', function () {
            const problemnum = getRandomInt(500);
            const startboard = problemlines[problemnum];
            const answer = answerlines[problemnum];

            const sboard: board = {};
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
        socket.on('gogame', function (data: gogamedata) {
            const roomId = data['roomId'];
            socket.data.userId = data['userId'];
            socket.data.subUserId = data['subUserId'];
            socket.data.pubUserId = data['pubUserId'];
            socket.data.matchUserId = data['pubUserId'];
            console.log('gogame', data);

            if (!(socket.data.pubUserId in usersCosmos)) {
                usersCosmos[socket.data.pubUserId] = {
                    "pk": "A",//必要。pkとユニークキーがないとcosmosDBはindexが効かない。
                    "id": socket.data.pubUserId,//ユニークキー
                    "name": data['name'].slice(0, 24),//不正に長い文字を投げられても制限する。
                    "rate": 1500
                };
            } else {
                //名前だけ更新
                usersCosmos[socket.data.pubUserId]['name'] = data['name'].slice(0, 24);
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
            if (roomId && roomId in boards) {
                //中断した部屋がまだ残っている場合、そこに参加する。
                socket.leave('waitingroom_simple');//一応ちゃんと抜ける
                socket.leave('waitingroom_turn');
                socket.join(roomId);
                socket.emit('match', roomId);
                socket.emit("state", { board: boards[roomId]['board'], points: boards[roomId]['points'] });
            } else {
                if (data['mode'] === 'SimpleMode') {//SimpleModeでゲーム開始した場合
                    //中断した部屋がなく開始の場合
                    socket.join('waitingroom_simple');
                    const clients = io.sockets.adapter.rooms.get('waitingroom_simple');
                    console.log('simplemode待機ルームの人のIDのセット', clients);
                    //to get the number of clients in this room
                    const numClients = clients ? clients.size : 0;

                    if (numClients > 1 && clients) {
                        //nagaiもし同時にたくさん人きたら誰か同時に入ってしまいそうなので
                        //判定処理は入れる、その部屋に入っている人の数を取得する
                        const clientsArr = Array.from(clients);
                        //idさえ分かれば誰でも入れるので、roomIdは推測不能な文字列に
                        const roomId = crypto.randomUUID();

                        const cl0 = io.sockets.sockets.get(clientsArr[0]);
                        const cl1 = io.sockets.sockets.get(clientsArr[1]);
                        if (cl0 && cl1) {
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
                                boards[roomId] = generateStartBoard(cl0.data as socketData, cl1.data as socketData, data['mode']);
                                io.to(roomId).emit("state", { board: boards[roomId]['board'], points: boards[roomId]['points'] });
                                const intervalid = setInterval(function () {
                                    boards[roomId]['countdown'] -= 1;
                                    io.to(roomId).emit("countdown", boards[roomId]['countdown']);
                                    if (boards[roomId]['countdown'] < 1) {
                                        clearInterval(intervalid);
                                    }
                                }, 1000);
                            }
                        }
                    }
                } else if (data['mode'] === 'TurnMode') {//TurnModeでゲーム開始した場合
                    //中断した部屋がなく開始の場合
                    socket.join('waitingroom_turn');
                    const clients = io.sockets.adapter.rooms.get('waitingroom_turn');
                    console.log('turnmode待機ルームの人のIDのセット', clients);
                    //to get the number of clients in this room
                    const numClients = clients ? clients.size : 0;

                    if (numClients > 1 && clients) {
                        //nagaiもし同時にたくさん人きたら誰か同時に入ってしまいそうなので
                        //判定処理は入れる、その部屋に入っている人の数を取得する
                        const clientsArr = Array.from(clients);
                        //idさえ分かれば誰でも入れるので、roomIdは推測不能な文字列に
                        const roomId = crypto.randomUUID();

                        const cl0 = io.sockets.sockets.get(clientsArr[0]);
                        const cl1 = io.sockets.sockets.get(clientsArr[1]);
                        if (cl0 && cl1) {
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
                            } else {
                                console.log('TurnModeゲーム開始');
                                //正常に部屋が立ったなら
                                //ゲームに必要な情報を作成する
                                //盤面の正解の情報,現在の盤面の状態
                                boards[roomId] = generateStartBoard(cl0.data as socketData, cl1.data as socketData, data['mode']);
                                io.to(roomId).emit("state", { board: boards[roomId]['board'], points: boards[roomId]['points'] });

                                //この後無限にカウントダウンが始まるようにする必要がある
                                const intervalid = setInterval(function () {
                                    boards[roomId]['countdown'] -= 1;
                                    io.to(roomId).emit("countdown", boards[roomId]['countdown']);
                                    if (boards[roomId]['countdown'] < 1) {
                                        clearInterval(intervalid);
                                        //nagai clearIntervalをするのはゲームが終了したとき…(or 1000カウントくらいに到達したら止める)
                                        //ここの処理でendgameを判定してclearintervalするか、intervalidをtableに入れてendgameの処理がされたときにclearとするか？
                                        //ここシームレスに処理を進めたくない。user1=>判定、どれもsubmitされなかったならランダムに一枚開く（不正解でも開かない）、=>プレイヤー交代
                                        //とする。……でも結局ここはずっと回し続ければいいだけかな
                                        //setintervalは処理が重いならそれぞれ同時に動いてしまうのでその点かなり注意して設計したい
                                    }
                                }, 1000);
                            }
                        }
                    }
                }
            }
        });

        //クライアントから受けた数独提出答え受け取り用
        socket.on('submit', function (submitInfo) {
            console.log('submitInfo: ', submitInfo);
            check(submitInfo, socket);
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
    function generateStartBoard(data0: socketData, data1: socketData, mode: mode) {
        const problemnum = getRandomInt(500);
        const startboard = problemlines[problemnum];
        const answer = answerlines[problemnum];
        const asarray = answer.match(/.{9}/g);
        const askaigyo = asarray?.join('\n');
        console.log(askaigyo);//デバッグで自分で入力するとき用に魔法陣の答え出力

        const board: board = {};
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
        const rtobj: gameInfo = {
            board: board,
            answer: answer, points: { [data0.matchUserId]: 0, [data1.matchUserId]: 0 },
            logs: [], countdown: 6,
            idTable: { [data0.userId]: data0.matchUserId, [data1.userId]: data1.matchUserId },
            idTableMatchPub: { [data0.matchUserId]: data0.pubUserId, [data1.matchUserId]: data1.pubUserId },
            mode: mode
        };
        // if (mode === 'TurnMode') {
        //     const index = getRandomInt(2);
        //     const users = [mUserId1, mUserId2];
        //     rtobj['whichTurnUserId'] = users[index];
        // }
        return rtobj;
    }

    /**
     * 提出された回答を判定して、二人のユーザーに結果送信
     * @param submitInfo 
     * @param socket 
     */
    function check(submitInfo: { roomId: string, coordinate: string, val: string }, socket: socketio.Socket) {
        const rmid = submitInfo['roomId'];
        if (boards[rmid]['countdown'] > 0) {
            console.log('カウントダウン中のため入力棄却');
        }
        const cod = submitInfo['coordinate'];
        const val: string = submitInfo['val'];
        const indx = parseInt(cod[0]) * 9 + parseInt(cod[1]);
        const matchUserId = socket.data.matchUserId;

        let eventData;
        if (boards[rmid]['answer'][indx] === val && boards[rmid]['board'][cod]['val'] === '-') {//まだ値が入っていないものに対して
            //正解の場合
            console.log('正解');
            boards[rmid]['board'][cod]['val'] = val;
            boards[rmid]['board'][cod]['id'] = matchUserId;
            boards[rmid]['points'][matchUserId] += parseInt(val);
            eventData = { status: 'correct', matchUserId: matchUserId, val: val, coordinate: cod };
            boards[rmid]['logs'].push(eventData);
        } else if (boards[rmid]['board'][cod]['val'] === '-') {
            console.log('不正解');
            //不正解の場合減点
            boards[rmid]['points'][matchUserId] -= parseInt(val);
            eventData = { status: 'incorrect', matchUserId: matchUserId, val: val, coordinate: cod };
            boards[rmid]['logs'].push(eventData);
        }
        io.to(rmid).emit('event', eventData);
        io.to(rmid).emit("state", { board: boards[rmid]['board'], points: boards[rmid]['points'] });

        // 終了検知
        let endgame = true;
        Object.keys(boards[rmid]['board']).forEach(key => {
            if (boards[rmid]['board'][key]['val'] === '-') {
                endgame = false;
            }//nagai foreachを途中でやめることはできないらしい……無駄すぎるがとりあえず
        });
        if (endgame === true) {
            console.log('ルーム:', rmid, 'のゲーム終了');
            //面倒なのでとりあえず画面側でstateから判定してもらう
            //終了したなら配列から盤面を消してしまう
            //終了通知はなく、クライアントは盤面から判定している
            (async () => {
                //非同期でレートを更新する。
                //部屋に入っている二人のユーザーに対してメモリに持っているCosmosのオブジェクトを更新、CosmosDBを更新
                const mUserIds = Object.keys(boards[rmid]['idTableMatchPub']);
                const pUser0Id = boards[rmid]['idTableMatchPub'][mUserIds[0]];
                const pUser1Id = boards[rmid]['idTableMatchPub'][mUserIds[1]];

                const diffrate = boards[rmid]['points'][mUserIds[0]] - boards[rmid]['points'][mUserIds[1]];
                usersCosmos[pUser0Id]['rate'] += diffrate;
                usersCosmos[pUser1Id]['rate'] -= diffrate;
                const ranking: { id: string; rate: number, name: string }[] = Object.values(usersCosmos);
                io.to(rmid).emit('ranking', ranking);
                try {
                    await container.items.upsert(usersCosmos[pUser0Id]);
                    await container.items.upsert(usersCosmos[pUser1Id]);
                } catch (error) {
                    console.error(error);
                }
                delete boards[rmid];
            })();
        }
    }
    function getRandomInt(max: number) {
        return Math.floor(Math.random() * max);
    }

}
main().catch(e => { console.log(e); });
