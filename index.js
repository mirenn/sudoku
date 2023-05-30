"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
//数独の問題と答えのセットを生成
let answertext = fs_1.default.readFileSync("./answer.txt");
let astxt = answertext.toString();
let answerlines = astxt.split('\n');
let problemtext = fs_1.default.readFileSync("./problem.txt", 'utf8');
let problemlines = problemtext.toString().split('\n');
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;
//部屋ごとの盤面情報保持
let boards = {};
function main() {
    return __awaiter(this, void 0, void 0, function* () {
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
        const { database } = yield cosmosClient.databases.createIfNotExists({ id: databaseName });
        console.log(`${database.id} database ready`);
        // Create container if it doesn't exist
        const { container } = yield database.containers.createIfNotExists({
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
        // Get items 
        try {
            //cosmosDBが使いにくいので都度問い合わせるのでなく、
            //ランキング情報全て取得しておいてメモリに持った情報を参照する。更新は都度更新しにいく
            let { resources } = yield container.items.query(querySpec).fetchAll();
            console.log('cosmosDB Data:', resources);
            //配列のままだと使いにくいので、id(userID)をキーにしたオブジェクトに
            var usersCosmos = resources.reduce((acc, item) => {
                acc[item['id']] = item;
                return acc;
            }, {});
        }
        catch (error) {
            console.log(error);
            var usersCosmos = {};
        }
        //CROS対応
        app.use((req, res, next) => {
            next();
        });
        //一覧取得
        app.use('/', express_1.default.static('public'));
        // ディレクトリでindex.htmlをリク・レス
        // app.get('/', (req, res) => {
        //     res.sendFile(__dirname  + '/public/index.html');
        //   });
        const server = http_1.default.createServer(app);
        const io = new socket_io_1.default.Server(server);
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
            socket.on('requestranking', function (usid) {
                //socket.dataにまだusid入っていなくても良いように引数にusid
                const ranking = Object.values(usersCosmos);
                const rk = ranking.map(value => {
                    if (value.id === usid) {
                        return { userId: value.id, rate: value.rate, name: value.name };
                    }
                    else {
                        return { userId: 'othersid', rate: value.rate, name: value.name };
                    }
                });
                socket.emit('ranking', rk);
            });
            //
            socket.on('requestsingleplay', function () {
                const problemnum = getRandomInt(500);
                const startboard = problemlines[problemnum];
                const answer = answerlines[problemnum];
                let sboard = {};
                // 通常のfor文で行う
                for (var i = 0; i < 81; i++) {
                    let syou = Math.floor(i / 9);
                    let mod = i % 9;
                    let coord = String(syou) + String(mod);
                    let inval = startboard[i];
                    let inid = 'auto';
                    if (inval === '-') {
                        inid = 'mada';
                    }
                    sboard[coord] = { id: inid, val: inval };
                }
                let singleObject = { 'board': sboard, 'answer': answer };
                socket.emit('singleplay', singleObject);
            });
            //待機ルームに入る用
            socket.on('gogame', function (data) {
                const roomId = data['roomId'];
                socket.data.userId = data['userId'];
                socket.data.subUserId = data['subUserId'];
                socket.data.matchUserId = data['userId'];
                console.log('gogame', data);
                if (!(socket.data.userId in usersCosmos)) {
                    usersCosmos[socket.data.userId] = {
                        "pk": "A",
                        "id": socket.data.userId,
                        "name": data['name'].substr(0, 24),
                        "rate": 1500
                    };
                }
                else {
                    //名前だけ更新
                    usersCosmos[socket.data.userId]['name'] = data['name'].substr(0, 24);
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
                    socket.leave('waitingroom');
                    socket.join(roomId);
                    socket.emit('match', roomId);
                    socket.emit("state", boards[roomId]['eachState'][socket.data.matchUserId]);
                }
                else {
                    //中断した部屋がなく開始の場合
                    socket.join('waitingroom');
                    const clients = io.sockets.adapter.rooms.get('waitingroom');
                    console.log('待機ルームの人のIDのセット', clients);
                    //to get the number of clients in this room
                    const numClients = clients ? clients.size : 0;
                    if (numClients > 1 && clients) {
                        //nagaiもし同時にたくさん人きたら誰か同時に入ってしまいそうなので
                        //判定処理は入れる、その部屋に入っている人の数を取得する
                        const clientsArr = Array.from(clients);
                        //idさえ分かれば誰でも入れるので、roomIdは推測不能な文字列に
                        const roomId = crypto_1.default.randomUUID();
                        const cl0 = io.sockets.sockets.get(clientsArr[0]);
                        const cl1 = io.sockets.sockets.get(clientsArr[1]);
                        if (cl0 && cl1) {
                            //待機ルームを抜けて対戦ルームに入る
                            cl0.leave('waitingroom');
                            cl1.leave('waitingroom');
                            cl0.join(roomId);
                            cl1.join(roomId);
                            //マッチ
                            //io.to(clientsArr[0]).emit('match', roomId);
                            //io.to(clientsArr[1]).emit('match', roomId);
                            cl0.emit('match', roomId);
                            cl1.emit('match', roomId);
                            if (cl0.data.userId === cl1.data.userId) { //同一ブラウザ同士の対決の場合
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
                                cl0.join('waitingroom');
                                cl1.join('waitingroom');
                                console.log('解散 ルーム:', roomId, 'の人のIDのセット', rclients);
                                console.log('解散', '待機ルームの人のIDのセット', clients);
                            }
                            else {
                                console.log('ゲーム開始');
                                //正常に部屋が立ったなら
                                //ゲームに必要な情報を作成する
                                //盤面の正解の情報,現在の盤面の状態
                                boards[roomId] = generateStartBoard(cl0.data.matchUserId, cl1.data.matchUserId);
                                const state = (({ board, points }) => { return { board, points }; })(boards[roomId]);
                                io.to(roomId).emit("state", state);
                                socket.data.readBoard = structuredClone(state['board']);
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
                //相手にだけ送りたいときはbroadcastでできるらしいので実装変更
                // const rclients = io.sockets.adapter.rooms.get(roomId);
                // if (rclients) {
                //     const rclarray = Array.from(rclients);
                //     rclarray.forEach(rcl => {
                //         if (rcl !== socket.id) {
                //             io.to(rcl).emit('opponentSelect', data);
                //         }
                //     });
                // }
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
         * @param userId1
         * @param userId2
         * @returns
         */
        function generateStartBoard(userId1, userId2) {
            let problemnum = getRandomInt(500);
            let startboard = problemlines[problemnum];
            let answer = answerlines[problemnum];
            const asarray = answer.match(/.{9}/g);
            const askaigyo = asarray === null || asarray === void 0 ? void 0 : asarray.join('\n');
            console.log(askaigyo); //デバッグで自分で入力するとき用に魔法陣の答え出力
            const board = {};
            // 通常のfor文で行う
            for (var i = 0; i < 81; i++) {
                let syou = Math.floor(i / 9);
                let mod = i % 9;
                let coord = String(syou) + String(mod);
                let inval = startboard[i];
                let inid = 'auto';
                if (inval === '-') {
                    inid = 'mada';
                }
                board[coord] = { id: inid, val: inval };
            }
            //console.log('nagai start board', board);
            //nagai isSelfPlay
            return {
                board: board, answer: answer, points: { [userId1]: 0, [userId2]: 0 },
                logs: [], countdown: 6, isSelfPlay: true,
                eachState: {
                    [userId1]: { board: structuredClone(board), points: { [userId1]: 0, opponentguid: 0 } },
                    [userId2]: { board: structuredClone(board), points: { opponentguid: 0, [userId2]: 0 } }
                }
            };
        }
        /**
         * 提出された回答を判定して、二人のユーザーに結果送信
         * @param submitInfo
         * @param socket
         */
        function check(submitInfo, socket) {
            let subinfo = submitInfo;
            //let usid = subinfo['userId'];//送られてきたuserIdを使用するとまずいので
            const usid = socket.data.matchUserId;
            let rmid = subinfo['roomId'];
            let cod = subinfo['coordinate'];
            let val = subinfo['val'];
            let indx = parseInt(cod[0]) * 9 + parseInt(cod[1]);
            // if (!(usid in boards[rmid]['points'])) {//nagai初期化時に作るようにしたのでこれは不要なはず
            //     boards[rmid]['points'][usid] = 0;
            // }
            if (boards[rmid]['countdown'] > 0) {
                console.log('カウントダウン中のため入力棄却');
            }
            //deepcopyでないはずなのでこの時点で代入しておいてよいはず
            const state = (({ board, points }) => { return { board, points }; })(boards[rmid]);
            if (boards[rmid]['answer'][indx] === val && boards[rmid]['board'][cod]['val'] === '-') { //まだ値が入っていないものに対して
                //正解の場合
                console.log('正解');
                boards[rmid]['board'][cod]['val'] = val;
                boards[rmid]['board'][cod]['id'] = usid;
                boards[rmid]['points'][usid] += parseInt(val);
                const event = { status: 'correct', userId: usid, val: val, coordinate: cod };
                boards[rmid]['logs'].push(event);
                Object.keys(boards[rmid]['eachState']).forEach(uid => {
                    //console.log(boards[rmid]['eachState']);
                    //console.log('nagaikakuninn', uid);
                    boards[rmid]['eachState'][uid]['board'][cod]['val'] = val;
                    if (uid === socket.data.matchUserId) {
                        //自分の方のデータを更新する場合
                        boards[rmid]['eachState'][uid]['board'][cod]['id'] = uid;
                        boards[rmid]['eachState'][uid]['points'][uid] += parseInt(val);
                    }
                    else {
                        //相手の方のデータを更新する場合(相手にとって、敵は自分……)
                        boards[rmid]['eachState'][uid]['board'][cod]['id'] = 'opponentguid';
                        boards[rmid]['eachState'][uid]['points']['opponentguid'] += parseInt(val);
                    }
                });
                const rmClients = io.sockets.adapter.rooms.get(rmid);
                rmClients === null || rmClients === void 0 ? void 0 : rmClients.forEach(rmsocketid => {
                    const sock = io.sockets.sockets.get(rmsocketid);
                    if ((sock === null || sock === void 0 ? void 0 : sock.data.matchUserId) === usid) {
                        //回答提出者である自分に送る場合
                        io.to(rmsocketid).emit('event', { status: 'correct', userId: usid, val: val, coordinate: cod });
                        io.to(rmsocketid).emit("state", boards[rmid]['eachState'][sock === null || sock === void 0 ? void 0 : sock.data.matchUserId]);
                    }
                    else {
                        //相手に送る場合
                        io.to(rmsocketid).emit('event', { status: 'correct', userId: 'opponentguid', val: val, coordinate: cod });
                        io.to(rmsocketid).emit("state", boards[rmid]['eachState'][sock === null || sock === void 0 ? void 0 : sock.data.matchUserId]);
                    }
                });
                //io.to(rmid).emit("event", event);
                //io.to(rmid).emit("state", state);
            }
            else if (boards[rmid]['board'][cod]['val'] === '-') {
                console.log('不正解');
                //不正解の場合減点
                boards[rmid]['points'][usid] -= parseInt(val);
                const event = { status: 'incorrect', userId: usid, val: val, coordinate: cod };
                boards[rmid]['logs'].push(event);
                Object.keys(boards[rmid]['eachState']).forEach(uid => {
                    if (uid === socket.data.matchUserId) {
                        //自分の方のデータを更新する場合
                        boards[rmid]['eachState'][uid]['points'][uid] -= parseInt(val);
                    }
                    else {
                        //相手の方のデータを更新する場合(相手にとって、敵は自分……)
                        boards[rmid]['eachState'][uid]['points']['opponentguid'] -= parseInt(val);
                    }
                });
                const rmClients = io.sockets.adapter.rooms.get(rmid);
                rmClients === null || rmClients === void 0 ? void 0 : rmClients.forEach(rmsocketid => {
                    const sock = io.sockets.sockets.get(rmsocketid);
                    if ((sock === null || sock === void 0 ? void 0 : sock.data.matchUserId) === usid) {
                        //回答提出者である自分に送る場合
                        io.to(rmsocketid).emit('event', { status: 'incorrect', userId: usid, val: val, coordinate: cod });
                        io.to(rmsocketid).emit("state", boards[rmid]['eachState'][sock === null || sock === void 0 ? void 0 : sock.data.matchUserId]);
                    }
                    else {
                        //相手に送る場合
                        io.to(rmsocketid).emit('event', { status: 'incorrect', userId: 'opponentguid', val: val, coordinate: cod });
                        io.to(rmsocketid).emit("state", boards[rmid]['eachState'][sock === null || sock === void 0 ? void 0 : sock.data.matchUserId]);
                    }
                });
                // io.to(rmid).emit("event", event);
                // io.to(rmid).emit("state", state);
            }
            // 終了検知
            let endgame = true;
            Object.keys(boards[rmid]['board']).forEach(key => {
                if (boards[rmid]['board'][key]['val'] === '-') {
                    endgame = false;
                } //nagai foreachを途中でやめることはできないらしい……無駄すぎるがとりあえず
            });
            if (endgame === true) {
                console.log('ルーム:', rmid, 'のゲーム終了');
                //面倒なのでとりあえず画面側でstateから判定してもらう
                //終了したなら配列から盤面を消してしまう（終了通知なども必要）
                (() => __awaiter(this, void 0, void 0, function* () {
                    //非同期でレートを更新する。
                    //部屋に入っている二人のユーザーに対してメモリに持っているCosmosのオブジェクトを更新、CosmosDBを更新
                    const matchUserIDs = Object.keys(boards[rmid]['points']);
                    const user1Id = matchUserIDs[0];
                    const user2Id = matchUserIDs[1];
                    console.log('nagai', user1Id, user2Id);
                    const rmClients = io.sockets.adapter.rooms.get(rmid);
                    rmClients === null || rmClients === void 0 ? void 0 : rmClients.forEach(rmsocketid => {
                        const sock = io.sockets.sockets.get(rmsocketid);
                        console.log('nagai sock id', sock === null || sock === void 0 ? void 0 : sock.data.userId);
                        if ((sock === null || sock === void 0 ? void 0 : sock.data.userId) === user1Id) {
                            const diffrate = boards[rmid]['points'][user1Id] - boards[rmid]['points'][user2Id];
                            usersCosmos[user1Id]['rate'] += diffrate;
                            const ranking = Object.values(usersCosmos);
                            const rk = ranking.map(value => {
                                if (value.id === user1Id) {
                                    return { userId: value.id, rate: value.rate, name: value.name };
                                }
                                else {
                                    return { userId: 'othersId', rate: value.rate, name: value.name };
                                }
                            });
                            sock.emit('ranking', rk);
                        }
                        else if ((sock === null || sock === void 0 ? void 0 : sock.data.userId) === user2Id) {
                            const diffrate = boards[rmid]['points'][user2Id] - boards[rmid]['points'][user1Id];
                            usersCosmos[user2Id]['rate'] += diffrate;
                            const ranking = Object.values(usersCosmos);
                            const rk = ranking.map(value => {
                                if (value.id === user2Id) {
                                    return { userId: value.id, rate: value.rate, name: value.name };
                                }
                                else {
                                    return { userId: 'othersId', rate: value.rate, name: value.name };
                                }
                            });
                            sock.emit('ranking', rk);
                        }
                    });
                    try {
                        yield container.items.upsert(usersCosmos[user1Id]);
                        yield container.items.upsert(usersCosmos[user2Id]);
                    }
                    catch (error) {
                        console.error(error);
                    }
                    delete boards[rmid];
                }))();
            }
        }
        function getRandomInt(max) {
            return Math.floor(Math.random() * max);
        }
    });
}
main().catch(e => { console.log(e); });
