import socketio from "socket.io";
import { Board, GameInfo, Mode, ReturnState, SocketData } from "./utils/types";
import fs from 'fs'

//数独の問題と答えのセットを生成
const answertext = fs.readFileSync("./answer.txt");
const astxt = answertext.toString();
export const answerlines = astxt.split('\n');
const problemtext = fs.readFileSync("./problem.txt", 'utf8');
export const problemlines = problemtext.toString().split('\n');

/** High or lowを使える残りの初期値 */
export const INI_REMAINING_HIGHORLOW = 4;

/**
 * 新しく作られた部屋のゲーム情報を生成する
 * 魔法陣の正解情報、現在の盤面など
 * simple turn兼用
 * @param data0 socketのdata
 * @param data1 
 * @param 
 * @returns 
 */
export function generateStartGameInfo(data0: SocketData, data1: SocketData, mode: Mode) {
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

/** returnStateを対象のroom全員にbroadcastする。(他のユーザーが知ってはいけないデータをそれぞれに配りたいので、個別にデータを生成) */
export function emitStateAllRoomMember(rmid: string, io: socketio.Server, gameInfos: { [key: string]: GameInfo }) {
    const rclients = io.sockets.adapter.rooms.get(rmid);
    rclients?.forEach(cl => {
        const sk = io.sockets.sockets.get(cl);
        if (sk?.data.matchUserId) {
            const returnState: ReturnState = { board: gameInfos[rmid]['board'], points: gameInfos[rmid]['points'], highOrLowHistory: gameInfos[rmid].users[sk.data.matchUserId].highOrLowHistory, remainingHighOrLowCount: gameInfos[rmid].users[sk.data.matchUserId].remainingHighOrLowCount };
            sk.emit('state', returnState);
        }
    });
}
/**
 * 0からmax-1までの整数をランダムに返す
 * @param max 
 * @returns 
 */
export function getRandomInt(max: number) {
    return Math.floor(Math.random() * max);
}