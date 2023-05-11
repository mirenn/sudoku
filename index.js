"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const socket_io_1 = __importDefault(require("socket.io"));
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
let answertext = fs_1.default.readFileSync("./answer.txt");
let astxt = answertext.toString();
let answerlines = astxt.split('\n');
let problemtext = fs_1.default.readFileSync("./problem.txt", 'utf8');
let problemlines = problemtext.toString().split('\n');
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;
//どんどん溜まっていく一方なので定期的に削除したい。
//その実装はめちゃくちゃナイーブでとりあえず良く
let boards = {};
//CROS対応
app.use((req, res, next) => {
    next();
});
// app.listen(PORT, () => {
//     console.log("Start on port 7000.")
// })
let roomNumber = 0;
//一覧取得
//app.get('/', express.static('public'));
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
    io.to('waitingroom').emit('connectnum', count);
    //リセット。もしだれもいない部屋の盤面があれば消しておく
    Object.keys(boards).forEach(rmkey => {
        let rmclients = io.sockets.adapter.rooms.get(rmkey);
        const rmNumClients = rmclients ? rmclients.size : 0;
        console.log('nagai rmkey', rmkey, rmNumClients);
        if (rmNumClients === 0) {
            delete boards[rmkey];
        }
    });
    //クライアントから受けた数独提出答え受け取り用
    socket.on('submit', function (submitInfo) {
        console.log('submitInfo: ' + submitInfo);
        check(submitInfo);
    });
    socket.on('myselect', function (data) {
        //自分が選択しているところの座標を相手にだけ送る
        //相手のsocketidに送る。
        const rooms = Array.from(socket.rooms);
        let roomid = '';
        rooms.forEach(rm => {
            if (rm !== socket.id) {
                roomid = rm;
            }
        });
        //相手にだけ送りたいときはbroadcastでできるらしいので実装変更
        // const rclients = io.sockets.adapter.rooms.get(roomid);
        // if (rclients) {
        //     const rclarray = Array.from(rclients);
        //     rclarray.forEach(rcl => {
        //         if (rcl !== socket.id) {
        //             io.to(rcl).emit('opponentSelect', data);
        //         }
        //     });
        // }
        socket.broadcast.to(roomid).emit('opponentSelect', data);
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
    //待機ルームに入る用
    socket.on('gogame', function () {
        console.log('gogame');
        //試合後などに再戦する場合、
        //もともと入っていた部屋全てから抜ける
        const rooms = Array.from(socket.rooms);
        let roomid = '';
        rooms.forEach(rm => {
            if (rm !== socket.id) {
                socket.leave(rm);
            }
        });
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
            roomNumber = roomNumber + 1; //次はroom1になるように。
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
                }
                else {
                    console.log('ゲーム開始');
                    //正常に部屋が立ったなら
                    //ゲームに必要な情報を作成する
                    //盤面の正解の情報,現在の盤面の状態
                    boards[roomId] = generateStartBoard();
                    const state = (({ board, points }) => { return { board, points }; })(boards[roomId]);
                    io.to(roomId).emit("state", JSON.stringify(state));
                    const intervalid = setInterval(function () {
                        boards[roomId]['countdown'] -= 1;
                        io.to(roomId).emit("countdown", boards[roomId]['countdown']);
                        if (boards[roomId]['countdown'] < 1) {
                            clearInterval(intervalid);
                        }
                    }, 1000);
                }
                //参考:所属する部屋を取得できる
                //ただし、自分自身のIDも部屋として取得されるのでそちらは無視する
                //console.log('socket.roomsだよ', socket.rooms);
            }
        }
    });
});
server.listen(PORT, function () {
    console.log('server listening. Port:' + PORT);
});
function generateStartBoard() {
    let problemnum = getRandomInt(500);
    let startboard = problemlines[problemnum];
    let answer = answerlines[problemnum];
    const asarray = answer.match(/.{9}/g);
    const askakigyo = asarray === null || asarray === void 0 ? void 0 : asarray.join('\n');
    console.log(askakigyo);
    //console.log(answer);
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
    return { board: board, answer: answer, points: {}, logs: [], countdown: 6 };
}
// 正解判定
function check(submitInfo) {
    let subinfo = JSON.parse(submitInfo); //jsonparseは結構重い処理らしい
    let usid = subinfo['userid'];
    let rmid = subinfo['roomid'];
    let cod = subinfo['coordinate'];
    let val = subinfo['val'];
    let indx = parseInt(cod[0]) * 9 + parseInt(cod[1]);
    if (!(usid in boards[rmid]['points'])) {
        boards[rmid]['points'][usid] = 0;
    }
    if (boards[rmid]['countdown'] > 0) {
        console.log('カウントダウン中のため入力棄却');
    }
    //deepcopyでないはずなのでこの時点で代入しておいてよいはず
    const state = (({ board, points }) => { return { board, points }; })(boards[rmid]);
    if (boards[rmid]['answer'][indx] == val && boards[rmid]['board'][cod]['val'] === '-') {
        //まだ値が入っていないものに対してだけ
        console.log('nagai 正解');
        // 正解の場合 boards情報更新
        boards[rmid]['board'][cod]['val'] = val;
        boards[rmid]['board'][cod]['id'] = usid;
        boards[rmid]['points'][usid] += parseInt(val);
        const event = { status: 'correct', userid: usid, val: val, coordinate: cod };
        boards[rmid]['logs'].push(event);
        io.to(rmid).emit("event", JSON.stringify(event));
        io.to(rmid).emit("state", JSON.stringify(state));
    }
    else if (boards[rmid]['board'][cod]['val'] === '-') {
        console.log('nagai 不正解');
        //不正解の場合減点
        boards[rmid]['points'][usid] -= parseInt(val);
        const event = { status: 'incorrect', userid: usid, val: val, coordinate: cod };
        boards[rmid]['logs'].push(event);
        io.to(rmid).emit("event", JSON.stringify(event));
        io.to(rmid).emit("state", JSON.stringify(state));
    }
    // 終了検知//これは少し遅いがとはいえたかが81なので
    let endgame = true;
    //console.log('nagai 最終確認', boards[rmid]['board']);
    Object.keys(boards[rmid]['board']).forEach(key => {
        if (boards[rmid]['board'][key]['val'] === '-') {
            endgame = false;
        } //nagai foreachを途中でやめることはできないらしい……無駄すぎるがとりあえず
    });
    if (endgame === true) {
        //面倒なのでとりあえず画面側でstateから判定してもらう
        //終了したなら配列から盤面を消してしまう（終了通知なども必要）
        delete boards[rmid];
    }
}
function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}
