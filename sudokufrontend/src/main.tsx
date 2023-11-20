/* eslint-disable @typescript-eslint/no-explicit-any */
// Import our custom CSS
//import { emitKeypressEvents } from 'readline';
import './scss/styles.scss';
import { socketio } from './socket';
import { useEffect, useState } from "react";

/**
* 他人にばれてはいけないユーザーID
* pubUserIDのログインパスワードのようなもの
*/
let passWord = localStorage.getItem('userId');
if (!passWord) {
    passWord = self.crypto.randomUUID();
    localStorage.setItem('userId', passWord);
    localStorage.setItem('passWord', passWord);//移行中。userIdではなくこちらで置き換える予定。userIdはいらない
} else {
    localStorage.setItem('passWord', passWord);//移行中
}
/**
 * 公開用ユーザーID
 * サーバーから返却される盤面情報のユーザー識別子/ランキングのユーザー識別子に使用。
 * ゲーム開始時最初にpassWordとpubUserIdを提出、
 * 返却される情報はpubUserIdを用いたものになる。
 */
let pubUserId = localStorage.getItem('pubUserId');
if (!pubUserId) {
    pubUserId = self.crypto.randomUUID();
    localStorage.setItem('pubUserId', pubUserId);
}
/**自分で同ブラウザ同士対戦用 pubUserIdの代わりに使用される */
const subUserId = self.crypto.randomUUID();

//部屋ID //途中で切断しても戻れるように
let roomId = localStorage.getItem('roomId');

const input = document.getElementById('nick') as HTMLInputElement;
const ncname = localStorage.getItem('name');
if (ncname) {
    input.value = ncname;
}
input.addEventListener('input', (event) => {
    localStorage.setItem('name', (event.target as HTMLInputElement).value);
});
const INFINITROOM = 'InfiniteRoom';

//let ranking;

/*state情報を一応持つ。
ただし、保存した盤面情報を別のところで用いることはしていない
*/
let state;

/**
 * simplemodeでは、0でないと数独の答え提出処理は走らない 
 * turnmodeでは、最初はそうだが後から違う
 */
let startCountDown = 0;

/**
 * gamemode
 */
let gameMode = '';

//空の数独マスにイベント追加
renderEmptyBoard();

/**
 * 一人用ゲームフラグ
 * Trueの場合、一人用数独を遊ぶ
 */
let singlePlayFlag = true;
let singlePlayState = JSON.parse(localStorage.getItem('singlePlayState') ?? '{}');

console.log('nagai singleplaystate', singlePlayState);
if (singlePlayState.board !== undefined) {//保存されているものがあるのならそれを使用する
    //盤面終了していないか確認
    let singleEndGame = true;
    Object.keys(singlePlayState['board']).forEach(key => {
        if (singlePlayState['board'][key]['val'] === '-') {
            singleEndGame = false;
        }
    });
    if (singleEndGame) {
        socketio.emit('requestsingleplay');
    } else {
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                const bkey = String(i) + String(j);
                const element = document.getElementById(bkey);
                if (element !== null) {
                    element.textContent = singlePlayState['board'][bkey].val;
                } else {
                    // nullの場合の処理
                }
            }
        }
    }
} else {
    for (let i = 0; i < 9; i++) {
        socketio.emit('requestsingleplay');
    }
}
//一人用のゲーム盤面要求
socketio.on('singleplay', function (data) {
    console.log('nagai 一人用の場合のデータ', data);
    singlePlayState = data;
    localStorage.setItem('singlePlayState', JSON.stringify(singlePlayState));

    if (singlePlayFlag) {
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                const bkey = String(i) + String(j);
                const element = document.getElementById(bkey);
                if (element !== null) {
                    element.textContent = singlePlayState['board'][bkey].val;
                } else {
                    // nullの場合の処理
                }
            }
        }
    }
});

//接続したらとりあえず状態を取る
socketio.on('connectnum', function (num) {
    console.log('nagai num', num);
    const element = document.getElementById('waiting_num');
    if (element !== null) {
        element.textContent = '現在の総接続人数' + num;
    } else {
        // nullの場合の処理
    }
});

socketio.emit('requestranking');

export function Ranking() {
    const [rdata, setRdata] = useState([]);
    useEffect(() => {
        function onRankingEvent(rankingData) {
            console.log('nagai ranking', rankingData);
            rankingData.sort((a, b) => b.rate - a.rate);
            setRdata(rankingData);
        }
        socketio.on('ranking', onRankingEvent);

        return () => {
            socketio.off('ranking', onRankingEvent);
        };
    }, []);

    const list: JSX.Element[] = [];
    rdata.forEach(({ name, rate, id }, index) => {
        const rank = getRank(rate);
        const ranknum = String(index) + 1;
        const dispname = (id === pubUserId) ? name + '（あなた）' : name;

        list.push(
            <tr>
                <th>{ranknum}</th>
                <td>{dispname}</td>
                <td>{rate}</td>
                <td>{rank}</td>
            </tr>
        );
    });


    return (
        <div className="row d-flex justify-content-center">
            <div className="col-md-6">
                <div className="form-group">
                    <table id="ranking" className="table table-bordered caption-top table-hover ">
                        <caption>ranking</caption>
                        <thead>
                            <tr>
                                <th scope="col">#</th>
                                <th scope="col">name</th>
                                <th scope="col">rate</th>
                                <th scope="col">rank</th>
                            </tr>
                            {list}
                        </thead>
                    </table>
                </div>
            </div>
        </div>);
}

// socketio.on('ranking', function (data) {
//     ranking = data;
//     console.log('nagai ranking', ranking);
//     ranking.sort((a, b) => b.rate - a.rate);

//     const rankingTable = document.getElementById('ranking');
//     const mytbody = document.createElement("tbody");
//     ranking.forEach(({ name, rate, id }, index) => {
//         const mytr = document.createElement("tr");
//         const myth = document.createElement("th");
//         const mytd1 = document.createElement("td");
//         const mytd2 = document.createElement("td");
//         const mytd3 = document.createElement("td");

//         const rank = getRank(rate);
//         myth.textContent = String(index) + 1;
//         mytd1.textContent = (id === pubUserId) ? name + '（あなた）' : name;
//         mytd2.textContent = String(rate);
//         mytd3.textContent = rank;

//         mytr.appendChild(myth);
//         mytr.appendChild(mytd1);
//         mytr.appendChild(mytd2);
//         mytr.appendChild(mytd3);
//         mytbody.appendChild(mytr);
//     });
//     if (rankingTable !== null) {
//         const oldtbody = rankingTable.getElementsByTagName("tbody")[0];
//         if (oldtbody) {
//             rankingTable.removeChild(oldtbody);
//         }
//         rankingTable.appendChild(mytbody);
//     }
// });

function getRank(rate: number) {
    if (rate < 1500) {
        return "Iron";
    }
    else if (rate >= 1500 && rate < 1600) {
        return "Bronze";
    } else if (rate >= 1600 && rate < 1700) {
        return "Silver";
    } else if (rate >= 1700 && rate < 1800) {
        return "Gold";
    } else if (rate >= 1800 && rate < 1900) {
        return "Platinum";
    }
    else if (rate >= 1900 && rate < 2000) {
        return "Diamond";
    }
    else if (rate >= 2000 && rate < 2100) {
        return "Master";
    }
    else if (rate >= 2100 && rate < 2200) {
        return "Grandmaster";
    } else {
        //本当は上位100名のみ
        return "Challenger";
    }
}

//マッチしたとき
socketio.on('match', function (rid) {
    singlePlayFlag = false;
    state = null;//初期化
    /////色をつけるクラスはずして初期化
    removeClass();

    if (gameMode !== 'InfiniteMode') {
        roomId = rid;
        localStorage.setItem('roomId', roomId);
        //表示
        document.getElementById('dashboard')?.classList.remove('d-none');
        document.getElementById('disp2')?.classList.remove('d-none');
    } else {
        roomId = INFINITROOM;
        localStorage.setItem('roomId', roomId);
        //表示
        //document.getElementById('dashboard').classList.remove('d-none');
        document.getElementById('disp2')?.classList.remove('d-none');
    }
    //非表示
    document.getElementById('waiting_disp')?.classList.add('d-none');//対戦待ち接続中
    document.getElementById('waiting_num')?.classList.add('d-none');//現在の総接続人数
    //チャットクリア
    const charea = document.getElementById("chatarea") as HTMLInputElement;
    if (charea !== null) {
        charea.value = '';
    }
    //HighOrLow初期値リセット（本当はサーバーから取ってきた値を入れるのだが面倒なので）
    const element = document.querySelector('#highLowButton .badge') as HTMLInputElement;
    if (element !== null) {
        element.textContent = '4';
    }

});
//マッチ後のカウントダウン
socketio.on('startCountDown', function (num) {
    startCountDown = num;
    //$('#disp2').text('マッチしました。あと' + String(num) + '秒で開始します。');
    const element = document.getElementById('disp2');
    if (element !== null) {
        element.textContent = 'マッチしました。あと' + String(num) + '秒で開始します。';
    }

    if (num < 1 && gameMode !== 'TurnMode') {
        //$('#disp2').text('Start');
        if (element !== null) {
            element.textContent = 'Start';
        }
        const elements = document.getElementsByClassName('numbutton');
        for (let i = 0; i < elements.length; i++) {
            elements[i].classList.remove("glayout");
        }
    } else {
        //TurnModeではカウントダウン中ずっとグレイアウト
        const elements = document.getElementsByClassName('numbutton');
        for (let i = 0; i < elements.length; i++) {
            elements[i].classList.add("glayout");
        }
    }
});
//チャット送信
// $('#message_form').submit(function () {
//     socketio.emit('message', $('#input_msg').val());
//     $('#input_msg').val('');
//     return false;
// });
document.getElementById('message_form')?.addEventListener("click", function () {
    const element = document.getElementById('input_msg') as HTMLInputElement;
    socketio.emit('message', element.value);
});

//チャットメッセージ機能用
socketio.on('message', function (msg) {
    const charea = document.getElementById('chatarea') as HTMLInputElement;
    charea.value += msg + "\n";
    charea.scrollTop = charea.scrollHeight;
});

document.getElementById("highLowButton")?.addEventListener("click", function () {
    if (startCountDown > 0) return;//カウントダウン中に押しても棄却
    if (document.getElementsByClassName("myClick")[0] === undefined || document.getElementsByClassName("myClick")[0].textContent !== "-") { return; }
    const element = document.querySelector('#highLowButton .badge');
    if (element !== null && element.textContent !== null && parseInt(element.textContent) < 1) { return; }
    if (document.getElementsByClassName('myClick').length > 0) {
        const submitExtInfo = {
            roomId: roomId,
            extType: 'HIGHORLOW',
            coordinate: document.getElementsByClassName('myClick')[0].id,
        };
        console.log('nagai submitExtInfo', submitExtInfo);
        socketio.emit('submitExt', submitExtInfo);
    }
});

//どこを選択しているか表示用
socketio.on('opponentSelect', function (data) {
    console.log('nagai opponentSelect', data);
    //すでにつけている分を消す。(これも自分のクリックした要素をplaceのような変数に持てば良いがとりあえず）
    const elements = document.getElementsByClassName('opoClick');
    for (let i = 0; i < elements.length; i++) {
        elements[i].classList.remove('opoClick');
    }
    if (data !== '') {
        document.getElementById(data)?.classList.add('opoClick');
    }
});
/**
 * {status: string,matchUserId: string,val: string,coordinate: string}
 */
socketio.on('event', function (eventData) {
    if (eventData.status === 'InCorrect') {
        //自分が不正解だった場合&& (eventData.matchUserId === pubUserId || eventData.matchUserId === subUserId)
        // const image = document.getElementById("closeicon");
        // image.style.display = "block";
        // setTimeout(function () {
        //     image.style.display = "none";
        // }, 300);
        //不正解だった場合はバツ画像を表示。（なんの数字を入れたかは相手側のはログを見るしか無い……）
        document.getElementById(eventData.coordinate)?.classList.add('cross');
        setTimeout(function () {
            document.getElementById(eventData.coordinate)?.classList.remove('cross');
        }, 1000);
    }
    if (eventData.status === 'auto' && gameMode === 'TurnMode') {//autoがそもそもturnmode限定
        //今は文字を画面に表示しているだけなので文字列で送ってくるだけで良い……。
        const zahyo = '行' + String(parseInt(eventData.coordinate[0]) + 1) + '列' + String(parseInt(eventData.coordinate[1]) + 1);
        const nyuuryoku = eventData.val;
        const log = '自動展開' + ':' + zahyo + '：' + nyuuryoku;
        const txarea = document.getElementById('log') as HTMLInputElement;
        if (txarea !== null) {
            txarea.value += log + "\n";
            txarea.scrollTop = txarea.scrollHeight;
        }

        //autoで開かれた箇所の枠線は１秒間枠を太くする
        document.getElementById(eventData.coordinate)?.classList.add('hutoiborder');
        setTimeout(function () {
            document.getElementById(eventData.coordinate)?.classList.remove('hutoiborder');
        }, 1000);

        const disp2ele = document.getElementById('disp2');
        if (disp2ele !== null) {
            disp2ele.textContent = '自動展開' + ':' + zahyo + '：' + nyuuryoku;
        }
        return;//autoなら処理ここまで
    }

    if (eventData.status === 'Correct' || eventData.status === 'InCorrect') {
        //今は文字を画面に表示しているだけなので文字列で送ってくるだけで良い……。
        const who = (eventData.matchUserId === pubUserId || eventData.matchUserId === subUserId) ? '自分' : '相手';
        const zahyo = '行' + String(parseInt(eventData.coordinate[0]) + 1) + '列' + String(parseInt(eventData.coordinate[1]) + 1);
        const seigo = eventData.status === 'Correct' ? '正解' : '不正解';
        const nyuuryoku = eventData.val;
        const log = seigo + ':' + who + ' ' + zahyo + '：' + nyuuryoku;
        const txarea = document.getElementById('log') as HTMLInputElement;
        if (txarea !== null) {
            txarea.value += log + "\n";
            txarea.scrollTop = txarea.scrollHeight;
        }
    } else if (eventData.status === 'CheckHighOrLow') {
        const who = (eventData.matchUserId === pubUserId || eventData.matchUserId === subUserId) ? '自分' : '相手';
        const zahyo = '行' + String(parseInt(eventData.coordinate[0]) + 1) + '列' + String(parseInt(eventData.coordinate[1]) + 1);
        const type = 'HighOrLow'
        const log = type + ':' + who + ' ' + zahyo;
        const txarea = document.getElementById('log') as HTMLInputElement;
        if (txarea !== null) {
            txarea.value += log + "\n";
            txarea.scrollTop = txarea.scrollHeight;
        }
    }

});
//全盤面の情報取得
//全盤面:どこのマスが誰に開けられているか
//プレイヤーの状態:お手付きに入っているかなど(これは後回し)
//現在見えている盤面と相違があるデータを取得した瞬間に色をつける
//simpleとturn
socketio.on('state', function (data) {
    state = data;

    const bData = state['board'];
    const points = state['points'];

    if (state['highOrLowHistory']) {
        const highOrLowHistory = state['highOrLowHistory'];
        highOrLowHistory.forEach((hol: { coordinate: string | number; highOrLow: any; }) => {
            if (bData[hol.coordinate].val === '-') {
                bData[hol.coordinate].val = hol.highOrLow;
            }
        });
        const element = document.querySelector('#highLowButton .badge');
        if (element !== null) {
            element.textContent = data['remainingHighOrLowCount'];
        }
    }

    let endgame = true;

    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            const bkey = String(i) + String(j);
            const element = document.getElementById(bkey);
            //値に変更があった場合、値をセットする
            if (element !== null && element.textContent !== bData[bkey].val) {
                element.textContent = bData[bkey].val;
                if (bData[bkey].id === pubUserId || bData[bkey].id === subUserId) {
                    //classをつける
                    element.classList.add('own');
                } else if (bData[bkey].id !== 'auto' && bData[bkey].id !== 'mada') {
                    element.classList.add('opponent');
                }
            }
            if (bData[bkey].val === '-') {
                endgame = false;
            }
        }
    }
    scoreProcess(points, endgame);
});

socketio.on('stateInfiniteMode', function (data) {
    state = data;

    const bData = state['board'];
    //const points = state['points'];
    let endgame = true;

    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            const bkey = String(i) + String(j);
            const element = document.getElementById(bkey);
            //値に変更があった場合、値をセットする
            if (element !== null && element.textContent !== bData[bkey].val && bData[bkey].val !== '-') {//変更後の値が-のときは別に良い（これはHかLのときに-で上書き防止）
                element.textContent = bData[bkey].val;
                if (bData[bkey].id === pubUserId || bData[bkey].id === subUserId) {
                    //classをつける
                    element?.classList.add('own');
                } else if (bData[bkey].id !== 'auto' && bData[bkey].id !== 'mada') {
                    element?.classList.add('opponent');
                }
            }
            if (bData[bkey].val === '-') {
                endgame = false;
            }
        }
    }
    if (endgame) {
        removeClass();
    }
});
//TurnMode用。ゲーム進行カウントダウン
//nagai:ゲーム終了してもカウント進んでいたので修正する
socketio.on("turnCount", (data) => {
    console.log('nagai data', data);
    if (data.turnUserId === pubUserId || data.turnUserId === subUserId) {
        const elements = document.getElementsByClassName('numbutton');
        for (let i = 0; i < elements.length; i++) {
            elements[i].classList.remove("glayout");
        }
    } else {
        const elements = document.getElementsByClassName('numbutton');
        for (let i = 0; i < elements.length; i++) {
            elements[i].classList.add("glayout");
        }
    }
    if (startCountDown > 0) {
        return;
    }

    let who;
    if (data.turnUserId === pubUserId || data.turnUserId === subUserId) {
        who = '自分のターン';
    } else if (data.turnUserId === 'auto') {
        who = 'オート';
    } else {
        who = '相手のターン'
    }
    const dispmessage = who + '残り秒数' + data.countdown;
    const element = document.getElementById('disp2');
    if (element !== null) {
        element.textContent = dispmessage;
    }
});
/** {matchUserIdのuuid : id} */
const opoHover: any = {};
/** { id: string, matchUserId: string} */
socketio.on("hoverServer", function (data) {
    if (gameMode === 'InfiniteMode') {
        if (data.matchUserId in opoHover) {
            const el = document.getElementById(opoHover[data.matchUserId]);
            if (el) {
                el.classList.remove('opohover');
            }
        }
        opoHover[data.matchUserId] = data.id;
        if (data.id !== '') {
            const dataidEle = document.getElementById(data.id);
            dataidEle?.classList.add('opohover');
        }
    } else {
        const elements = document.querySelectorAll('.opohover');
        elements.forEach(element => {
            element.classList.remove('opohover');
        });
        if (data.id !== '') {
            const dataidEle = document.getElementById(data.id);
            dataidEle?.classList.add('opohover');
        }
    }
});

//接続エラー時のイベント
socketio.on('connect_error', (error) => {
    console.log('nagai error テスト確認', error);
    const element = document.getElementById('disp2');
    if (element !== null) {
        element.textContent = 'サーバーと通信ができなくなりました';
    }
});

// クリックされた要素を保持
let place: any;

// 空の数独魔法陣作成など
function renderEmptyBoard() {
    console.log('renderemptyboard');

    const tds = document.querySelectorAll('#sudoku tr td');
    tds.forEach(td => {
        td.addEventListener('mouseover', (e: any) => {
            if (e.target !== null && e.target.id !== null) {
                socketio.emit("hover", { id: e.target.id });
            }
        });
        td.addEventListener("click", (e) => {
            sudokuClick(e);
        }, false);
    });
    const element = document.querySelector('#sudoku');
    element?.addEventListener('mouseleave', function () {
        socketio.emit('hover', { id: '' });
    });

    for (let i = 1; i < 10; i++) {
        const td = document.getElementById(String(i));
        if (td !== null) {
            td.onclick = selectClick;
        }
    }
}

//ゲーム開始、待機画面に遷移
const button = document.getElementById('go_game');
if (button !== null) {
    button.onclick = goGameButtonClick;
}
function goGameButtonClick() {
    const el: any = document.getElementsByName('modeRadio');
    const len = el.length;
    for (let i = 0; i < len; i++) {
        if (el.item(i).checked) {
            gameMode = el.item(i).value;
        }
    }
    document.getElementById('waiting_disp')?.classList.remove('d-none');
    document.getElementById('name_button')?.classList.add('d-none');
    const element = document.getElementById('nick') as HTMLInputElement;
    if (gameMode === 'SimpleMode') {
        socketio.emit("gogameSimpleMode", { roomId: roomId, passWord: passWord, subUserId: subUserId, pubUserId: pubUserId, name: element?.value });
    } else if (gameMode === 'TurnMode') {
        socketio.emit("gogameTurnMode", { roomId: roomId, passWord: passWord, subUserId: subUserId, pubUserId: pubUserId, name: element?.value });
    } else if (gameMode === 'InfiniteMode') {
        socketio.emit("gogameInfiniteMode", { roomId: roomId, passWord: passWord, subUserId: subUserId, pubUserId: pubUserId, name: element?.value });
    }
}

/**
 * 問題パネルのマスが押された時の処理 myClickクラスを一か所につける ただし、つけているところをクリックしたら消せる
 * @param {*} e 
 * @returns 
 */
function sudokuClick(e: any) {
    let onazi = false;
    if (e.target.classList.contains('myClick')) {
        //前回押したところが今回押したところと同じならば(今回押したところをすでにクリックしていたなら)
        onazi = true;
    }

    if (place != undefined) {//前のmyClickクラスを消す
        place.classList.remove('myClick');
    }

    if (onazi) {
        socketio.emit("myselect", '');//座標取り消し
        return;
    }

    place = e.target;
    place.classList.add('myClick');
    socketio.emit("myselect", e.target.id);
}

/** 数字選択のマスを押した時の処理 */
function selectClick(e: any) {
    console.log('nagai select click');
    if (singlePlayFlag) {
        const element = document.getElementsByClassName("myClick")[0];
        if (document.getElementsByClassName("myClick")[0] === undefined || element.textContent !== null &&
            /^[1-9]+$/.test(element.textContent)) { return; }//1~9の数字が既に入っている場合
        const datas = document.getElementById("sudoku")?.querySelectorAll("tr");
        //本当は二重ループ回す必要ない
        if (datas !== undefined) {
            outer_loop: for (let i = 0; i < datas.length; i++) {
                for (let j = 0; j < datas[i].querySelectorAll("td").length; j++) {
                    if (datas[i].querySelectorAll("td")[j].classList.contains("myClick")) {
                        const id = String(i) + String(j);
                        if (e.target.textContent === singlePlayState['answer'][i * 9 + j]) {
                            //正解の場合
                            const idEle = document.getElementById(id);
                            if (idEle !== null) {
                                idEle.textContent = e.target.textContent;
                            }
                            singlePlayState['board'][id]['val'] = e.target.textContent;
                            localStorage.setItem('singlePlayState', JSON.stringify(singlePlayState));
                        } else {
                            //不正解の場合
                            // const image = document.getElementById("closeicon");
                            // image.style.display = "block";
                            // setTimeout(function () {
                            //     image.style.display = "none";
                            // }, 300);
                            const idEle = document.getElementById(id);

                            idEle?.classList.add('cross');
                            setTimeout(function () {
                                idEle?.classList.remove('cross');
                            }, 1000);
                        }
                        break outer_loop;
                    }
                }
            }
        }

        let singleEndGame = true;
        Object.keys(singlePlayState['board']).forEach(key => {
            if (singlePlayState['board'][key]['val'] === '-') {
                singleEndGame = false;
            }
        });
        if (singleEndGame) {
            socketio.emit('requestsingleplay');
        }
    } else if (gameMode === 'TurnMode') {
        if (startCountDown > 0) return;//カウントダウン中に押してもすぐ終了
        const element = document.getElementsByClassName("myClick")[0];
        if (document.getElementsByClassName("myClick")[0] === undefined || element.textContent !== null && /^[1-9]+$/.test(element.textContent)) { return; }//1-9でないときすぐ終了

        if (document.getElementsByClassName('myClick').length > 0) {
            const submitInfo = {
                roomId: roomId,
                coordinate: document.getElementsByClassName('myClick')[0].id,
                val: e.target.textContent
            };
            console.log('nagai submitInfo', submitInfo);
            socketio.emit('submitTurnMode', submitInfo);
        }
    }
    else if (gameMode === 'SimpleMode') {
        //SinmpleMode
        if (startCountDown > 0) return;//カウントダウン中に押してもすぐ終了
        const element = document.getElementsByClassName("myClick")[0];

        if (document.getElementsByClassName("myClick")[0] === undefined || element.textContent !== null && /^[1-9]+$/.test(element.textContent)) { return; }
        if (document.getElementsByClassName('myClick').length > 0) {
            const submitInfo = {
                roomId: roomId,
                coordinate: document.getElementsByClassName('myClick')[0].id,
                val: e.target.textContent
            };
            console.log('nagai submitInfo', submitInfo);
            socketio.emit('submitSimpleMode', submitInfo);
        }
    } else if (gameMode === 'InfiniteMode') {
        const element = document.getElementsByClassName("myClick")[0];

        if (document.getElementsByClassName("myClick")[0] === undefined || element.textContent !== null && /^[1-9]+$/.test(element.textContent)) { return; }
        if (document.getElementsByClassName('myClick').length > 0) {
            const submitInfo = {
                roomId: roomId,
                coordinate: document.getElementsByClassName('myClick')[0].id,
                val: e.target.textContent
            };
            console.log('nagai submitInfo', submitInfo);
            socketio.emit('submitInfiniteMode', submitInfo);
        }
    }
}

/**点数処理 */
function scoreProcess(points: any, endgame: any) {
    let mypoint = 0;
    let opopoint = 0;
    Object.keys(points).forEach(muid => {
        if (muid === pubUserId || muid === subUserId) {
            mypoint = points[muid];
        } else {
            opopoint = points[muid];
        }
    });
    const p1ele = document.getElementById("point_1");
    if (p1ele !== null) {
        p1ele.textContent = String(mypoint);
    }

    const p2ele = document.getElementById("point_2");
    if (p2ele !== null) {
        p2ele.textContent = String(opopoint);
    }

    if (endgame) {
        const txarea = document.getElementById('log') as HTMLInputElement;
        if (txarea !== null) {
            txarea.value += 'ゲーム終了' + "\n";
            txarea.scrollTop = txarea.scrollHeight;
        }
        const disp2Ele = document.getElementById('disp2');
        if (disp2Ele !== null) {

            if (mypoint > opopoint) {//nagai numberのはずなのでこの比較であっているはず
                disp2Ele.textContent = 'Win!!!';
            } else if (mypoint === opopoint) {
                disp2Ele.textContent = 'Draw!';
            } else {
                disp2Ele.textContent = 'Lose';
            }
        }

        //roomId初期化
        localStorage.removeItem('roomId');
        roomId = null;//nagai本当にこれで良いか？

        document.getElementById('name_button')?.classList.remove('d-none');
    }
}

/**色をつけるクラスはずして初期化 */
function removeClass() {
    /////色をつけるクラスはずして初期化
    const opoele = document.getElementsByClassName('opponent');
    while (opoele.length) {
        opoele[0].classList.remove('opponent');
    }
    const opohv = document.getElementsByClassName('opohover');
    while (opohv.length) {
        opohv[0].classList.remove('opohover');
    }
    const ownele = document.getElementsByClassName('own');
    while (ownele.length) {
        ownele[0].classList.remove('own');
    }
    const opocliele = document.getElementsByClassName('opoClick');
    while (opocliele.length) {
        opocliele[0].classList.remove('opoClick');
    }
}