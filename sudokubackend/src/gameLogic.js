"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRandomInt = exports.emitStateAllRoomMember = exports.generateStartGameInfo = exports.INI_REMAINING_HIGHORLOW = exports.problemlines = exports.answerlines = void 0;
const fs_1 = __importDefault(require("fs"));
//数独の問題と答えのセットを生成
const answertext = fs_1.default.readFileSync("./answer.txt");
const astxt = answertext.toString();
exports.answerlines = astxt.split('\n');
const problemtext = fs_1.default.readFileSync("./problem.txt", 'utf8');
exports.problemlines = problemtext.toString().split('\n');
/** High or lowを使える残りの初期値 */
exports.INI_REMAINING_HIGHORLOW = 4;
/**
 * 新しく作られた部屋のゲーム情報を生成する
 * 魔法陣の正解情報、現在の盤面など
 * simple turn兼用
 * @param data0 socketのdata
 * @param data1
 * @param
 * @returns
 */
function generateStartGameInfo(data0, data1, mode) {
    const problemnum = getRandomInt(500);
    const startboard = exports.problemlines[problemnum];
    const answer = exports.answerlines[problemnum];
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
        idTableMatchPub: { [data0.matchUserId]: data0.pubUserId, [data1.matchUserId]: data1.pubUserId },
        mode: mode,
        users: { [data0.matchUserId]: { remainingHighOrLowCount: exports.INI_REMAINING_HIGHORLOW, highOrLowHistory: [] }, [data1.matchUserId]: { remainingHighOrLowCount: exports.INI_REMAINING_HIGHORLOW, highOrLowHistory: [] } }
    };
    if (mode === 'TurnMode') {
        const data = [data0.matchUserId, data1.matchUserId];
        data.sort(() => Math.random() - 0.5); //ランダムに並び替える
        data.splice(1, 0, 'auto');
        data.push('auto');
        rtobj['turnArray'] = data;
        rtobj['turnIndex'] = 0;
        rtobj['countdown'] = 10;
    }
    return rtobj;
}
exports.generateStartGameInfo = generateStartGameInfo;
/** returnStateを対象のroom全員にbroadcastする。(他のユーザーが知ってはいけないデータをそれぞれに配りたいので、個別にデータを生成) */
function emitStateAllRoomMember(rmid, io, gameInfos) {
    const rclients = io.sockets.adapter.rooms.get(rmid);
    rclients?.forEach(cl => {
        const sk = io.sockets.sockets.get(cl);
        if (sk?.data.matchUserId) {
            const returnState = { board: gameInfos[rmid]['board'], points: gameInfos[rmid]['points'], highOrLowHistory: gameInfos[rmid].users[sk.data.matchUserId].highOrLowHistory, remainingHighOrLowCount: gameInfos[rmid].users[sk.data.matchUserId].remainingHighOrLowCount };
            sk.emit('state', returnState);
        }
    });
}
exports.emitStateAllRoomMember = emitStateAllRoomMember;
/**
 * 0からmax-1までの整数をランダムに返す
 * @param max
 * @returns
 */
function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}
exports.getRandomInt = getRandomInt;
//# sourceMappingURL=gameLogic.js.map