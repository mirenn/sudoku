import express from 'express';
import socketio from 'socket.io';
import http, { IncomingMessage, ServerResponse } from 'http'
import fs from 'fs'
import { CosmosClient } from "@azure/cosmos";
//現在の開示されている盤面情報オブジェクト:キーは座標。保持している情報は、id:socketid、もしくはどちらでもないなら'auto'。そのマスの見えている数字
//誰が開いたかはこちらではsocketIDの情報として持たせる。
interface board {
    [coordinate: string]: {//座標
        id: string,//当てた人のid 自動:auto,まだ:mada,プレイヤー:userId
        val: string,//見えている値
    }
}
interface points {
    [matchUserId: string]: number
}
//どの部屋の盤面か
interface roomDictionaryArray {
    // (文字型のキー):  string
    [rooms: string]: {
        board: board,
        answer: string,
        points: points,//['points']['それぞれのuserのid']ここに各点数が入っている。userIdが最初からもてれるならこれでよかったが……、そうではなく初期化時どうしようもないので…空で宣言してからみたいな使い方になる
        countdown: number,
        logs: object[],
        isSelfPlay: boolean,
        eachState: { [matchUserId: string]: { board: board, points: points } }//['それぞれのuserのid']ここに各userに配信するデータが入っている
    }
}

let answertext = fs.readFileSync("./answer.txt");
let astxt = answertext.toString();
let answerlines = astxt.split('\n');
let problemtext = fs.readFileSync("./problem.txt", 'utf8');
let problemlines = problemtext.toString().split('\n');

const app: express.Express = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
const PORT = process.env.PORT || 3000;

// Provide required connection from environment variables
const key = String(process.env.COSMOS_KEY);
const endpoint = String(process.env.COSMOS_ENDPOINT);
// Set Database name and container name with unique timestamp
const databaseName = `users`;
const containerName = `products`;
const partitionKeyPath = ["/categoryId"];


//どんどん溜まっていく一方なので定期的に削除したい。
//その実装はめちゃくちゃナイーブでとりあえず良く
let boards: roomDictionaryArray = {};

async function main() {
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

    //CROS対応
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
        next();
    });

    let roomNumber = 0;

    //一覧取得
    //app.get('/', express.static('public'));
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

        io.to('waitingroom').emit('connectnum', count);

        //リセット。もしだれもいない部屋の盤面があれば消しておく
        Object.keys(boards).forEach(rmkey => {
            const rmclients = io.sockets.adapter.rooms.get(rmkey);
            const rmNumClients = rmclients ? rmclients.size : 0;
            console.log('nagai rmkey', rmkey, rmNumClients);
            if (rmNumClients === 0) {
                delete boards[rmkey];
            }
        });
        //待機ルームに入る用
        socket.on('gogame', function (data) {
            const roomId = data['roomId'];
            socket.data.userId = data['userId'];
            socket.data.subUserId = data['subUserId'];
            socket.data.matchUserId = data['userId'];
            console.log('gogame', data, 'nagai', socket.data.userId);
            // (async () => {
            //     const querySpec = {
            //         query: "select userId,name,rate from users where users.userId=@userId",
            //         parameters: [
            //             {
            //                 name: "@userId",
            //                 value: socket.data.userId
            //             }
            //         ]
            //     };
            //     // Get items 
            //     const { resources } = await container.items.query(querySpec).fetchAll();
            //     for (const item of resources) {
            //         //結果は一つだけ
            //         console.log(`${item.usrId}: ${item.name}, ${item.rate}`);
            //     }
            //     if(resources.length === 0){
            //         //初めてなのでデータを挿入する。
            //         //nagai koko 画面側でuseridを入れれる箇所を作る、go_gameのdataにnameを含める
            //     }
            //     //nagai ユーザーに取得、もしくは生成したレートを返す
            // })();
            //試合後などに再戦する場合、
            //もともと入っていた部屋全てから抜ける
            const rooms = Array.from(socket.rooms);
            rooms.forEach(rm => {
                if (rm !== socket.id) {
                    socket.leave(rm);
                }
            });

            //console.log('nagai roomId', roomId, 'boards', boards);
            //まず最初に中断した部屋がないか確認する
            if (roomId && roomId in boards) {
                //中断した部屋がまだ残っている場合、そこに参加する。
                socket.leave('waitingroom');
                socket.join(roomId);
                socket.emit('match', roomId);
                socket.emit("state", boards[roomId]['eachState'][socket.data.matchUserId]);
            } else {
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
                    //nagai:誰でも入れるので、roomIdは推測不能な文字列にして予防予定
                    const roomId = 'room' + String(roomNumber);
                    roomNumber = roomNumber + 1;//次はroom1になるように。

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

                        if (cl0.data.userId === cl1.data.userId) {//同一ブラウザ同士の対決の場合
                            cl0.data.matchUserId = cl0.data.subUserId;
                            cl1.data.matchUserId = cl1.data.subUserId;
                        }

                        const rclients = io.sockets.adapter.rooms.get(roomId);
                        console.log(roomId, 'ルームに入っている人のIDのSet', rclients);
                        console.log('待機ルームの人のIDのSet', clients);
                        const rnumClients = clients ? clients.size : 0;
                        if (rnumClients > 2) {
                            //もし同じ部屋に二人以上入ってしまっていたら解散（そんなことがあるか分からないが）
                            cl0.leave(roomId);
                            cl1.leave(roomId);
                            cl0.join('waitingroom');
                            cl1.join('waitingroom');
                            console.log('解散', roomId, 'ルームの人のIDのセット', rclients);
                            console.log('解散', '待機ルームの人のIDのセット', clients);
                        } else {
                            console.log('ゲーム開始');
                            //正常に部屋が立ったなら
                            //ゲームに必要な情報を作成する
                            //盤面の正解の情報,現在の盤面の状態
                            boards[roomId] = generateStartBoard(cl0.data.matchUserId, cl1.data.matchUserId);
                            const state = (({ board, points }) => { return { board, points } })(boards[roomId]);
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

    function generateStartBoard(userId1: string, userId2: string) {
        let problemnum = getRandomInt(500);
        let startboard = problemlines[problemnum];
        let answer = answerlines[problemnum];
        const asarray = answer.match(/.{9}/g);
        const askakigyo = asarray?.join('\n');
        console.log(askakigyo);
        //console.log(answer);

        const board: board = {};
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

    // 正解判定
    // nagai適当なguidで提出されても通してしまうので、意図的に相手の点数を下げることはできてしまう
    function check(submitInfo: { userId: string, roomId: string, coordinate: string, val: string }, socket: socketio.Socket) {
        let subinfo = submitInfo;
        //let usid = subinfo['userId'];//送られてきたuserIdを使用するとまずいので
        const usid = socket.data.matchUserId;
        let rmid = subinfo['roomId'];
        let cod = subinfo['coordinate'];
        let val: string = subinfo['val'];
        let indx = parseInt(cod[0]) * 9 + parseInt(cod[1]);
        // if (!(usid in boards[rmid]['points'])) {//nagai初期化時に作るようにしたのでこれは不要なはず
        //     boards[rmid]['points'][usid] = 0;
        // }
        if (boards[rmid]['countdown'] > 0) {
            console.log('カウントダウン中のため入力棄却');
        }

        //deepcopyでないはずなのでこの時点で代入しておいてよいはず
        const state = (({ board, points }) => { return { board, points } })(boards[rmid]);

        if (boards[rmid]['answer'][indx] === val && boards[rmid]['board'][cod]['val'] === '-') {//まだ値が入っていないものに対して
            //正解の場合
            console.log('nagai 正解');
            boards[rmid]['board'][cod]['val'] = val;
            boards[rmid]['board'][cod]['id'] = usid;
            boards[rmid]['points'][usid] += parseInt(val);
            const event = { status: 'correct', userId: usid, val: val, coordinate: cod };
            boards[rmid]['logs'].push(event);
            Object.keys(boards[rmid]['eachState']).forEach(uid => {//uidは自分か相手か
                //console.log(boards[rmid]['eachState']);
                //console.log('nagaikakuninn', uid);
                boards[rmid]['eachState'][uid]['board'][cod]['val'] = val;
                if (uid === socket.data.matchUserId) {
                    //自分の方のデータを更新する場合
                    boards[rmid]['eachState'][uid]['board'][cod]['id'] = uid;
                    boards[rmid]['eachState'][uid]['points'][uid] += parseInt(val);
                } else {
                    //相手の方のデータを更新する場合(相手にとって、敵は自分……)
                    boards[rmid]['eachState'][uid]['board'][cod]['id'] = 'opponentguid';
                    boards[rmid]['eachState'][uid]['points']['opponentguid'] += parseInt(val);
                }
            });
            const rmClients = io.sockets.adapter.rooms.get(rmid);
            rmClients?.forEach(rmsocketid => {
                const sock = io.sockets.sockets.get(rmsocketid);
                if (sock?.data.matchUserId === usid) {
                    //回答提出者である自分に送る場合
                    io.to(rmsocketid).emit('event', { status: 'correct', userId: usid, val: val, coordinate: cod });
                    io.to(rmsocketid).emit("state", boards[rmid]['eachState'][sock?.data.matchUserId]);
                } else {
                    //相手に送る場合
                    io.to(rmsocketid).emit('event', { status: 'correct', userId: 'opponentguid', val: val, coordinate: cod })
                    io.to(rmsocketid).emit("state", boards[rmid]['eachState'][sock?.data.matchUserId]);
                }
            });

            //io.to(rmid).emit("event", event);
            //io.to(rmid).emit("state", state);
        } else if (boards[rmid]['board'][cod]['val'] === '-') {
            console.log('nagai 不正解');
            //不正解の場合減点
            boards[rmid]['points'][usid] -= parseInt(val);
            const event = { status: 'incorrect', userId: usid, val: val, coordinate: cod };
            boards[rmid]['logs'].push(event);

            Object.keys(boards[rmid]['eachState']).forEach(uid => {//uidは自分か相手かのuserId
                if (uid === socket.data.matchUserId) {
                    //自分の方のデータを更新する場合
                    boards[rmid]['eachState'][uid]['points'][uid] -= parseInt(val);
                } else {
                    //相手の方のデータを更新する場合(相手にとって、敵は自分……)
                    boards[rmid]['eachState'][uid]['points']['opponentguid'] -= parseInt(val);
                }
            });
            const rmClients = io.sockets.adapter.rooms.get(rmid);
            rmClients?.forEach(rmsocketid => {
                const sock = io.sockets.sockets.get(rmsocketid);
                if (sock?.data.matchUserId === usid) {
                    //回答提出者である自分に送る場合
                    io.to(rmsocketid).emit('event', { status: 'incorrect', userId: usid, val: val, coordinate: cod });
                    io.to(rmsocketid).emit("state", boards[rmid]['eachState'][sock?.data.matchUserId]);
                } else {
                    //相手に送る場合
                    io.to(rmsocketid).emit('event', { status: 'incorrect', userId: 'opponentguid', val: val, coordinate: cod })
                    io.to(rmsocketid).emit("state", boards[rmid]['eachState'][sock?.data.matchUserId]);
                }
            });
            // io.to(rmid).emit("event", event);
            // io.to(rmid).emit("state", state);
        }

        // 終了検知
        let endgame = true;
        //console.log('nagai 最終確認', boards[rmid]['board']);
        Object.keys(boards[rmid]['board']).forEach(key => {
            if (boards[rmid]['board'][key]['val'] === '-') {
                endgame = false;
            }//nagai foreachを途中でやめることはできないらしい……無駄すぎるがとりあえず
        });
        if (endgame === true) {
            //面倒なのでとりあえず画面側でstateから判定してもらう
            //終了したなら配列から盤面を消してしまう（終了通知なども必要）
            delete boards[rmid];
        }
    }

    function getRandomInt(max: number) {
        return Math.floor(Math.random() * max);
    }



}
main().catch(e => { console.log(e); });



