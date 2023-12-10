
import { SubmitInfo, Status,GoGameData, UsersCosmosDB, ReturnState, RoomDictionaryArray, SocketData } from './utils/types';
import socketio from 'socket.io'; // Import the Socket type from 'socket.io'
import crypto from 'crypto'; // Import the crypto module for generating random UUIDs
import { emitStateAllRoomMember, generateStartGameInfo, INI_REMAINING_HIGHORLOW } from './gameLogic';
import AsyncLock from 'async-lock';
import { Container } from "@azure/cosmos";

/**
 * TurnModeのゲームを開始する。ただし、テストしていない。このモードは現在使わないのでindex.tsから分離させた。
 * @param io 
 * @param socket 
 * @param usersCosmos 
 * @param gameInfos 
 * @param lock 
 * @param container 
 */
export const gogameTurnMode = (io: socketio.Server, socket: socketio.Socket, usersCosmos: UsersCosmosDB, gameInfos: RoomDictionaryArray, lock: AsyncLock, container: Container) => {
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
                            emitStateAllRoomMember(roomId, io, gameInfos);
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
    //クライアントから受けた数独提出答え受け取り用
    socket.on('submitTurnMode', function (submitInfo: SubmitInfo) {
        console.log('submitInfo: ', submitInfo);
        checkTurnModeAnswer(submitInfo, socket);
    });

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
                emitStateAllRoomMember(rmid, io, gameInfos);
            } else {
                //自分のターンではない
                console.log('対象のユーザーのターンでないため入力棄却');
            }
        });
    }
}
