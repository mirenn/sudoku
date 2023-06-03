//ユーザーIDを適当に発行する
//userIdは対戦ごとに毎回発行する。
//nagai：自分同士の対戦はできるように維持したい・・・
var userId = localStorage.getItem('userId');
//let userId = self.crypto.randomUUID();
if (!userId) {
    //httpsでしか使えないようなのでこけてたらそれをまず疑う
    userId = self.crypto.randomUUID();
    localStorage.setItem('userId', userId);
}

//部屋ID //途中で切断しても戻れるように
let roomId = localStorage.getItem('roomId');

const input = document.getElementById('nick');
let ncname = localStorage.getItem('name');
if (ncname) {
    input.value = ncname;
}
input.addEventListener('input', (event) => {
    localStorage.setItem('name', event.target.value);
});

let ranking;

//同じブラウザ自分同士対戦用
const subUserId = self.crypto.randomUUID();

/*state情報を一応持つ。
ただし、保存した盤面情報は特に使用しない
*/
let state = null;

/* global io */
var socketio = io();

//0でないと数独の答え提出処理は走らない
let countdown = 0;
//空の数独マスにイベント追加
render_empty_board();

/**
 * 一人用ゲームフラグ
 * Trueの場合、一人用数独を遊ぶ
 */
let singlePlayFlag = true;
let singlePlayState = JSON.parse(localStorage.getItem('singlePlayState'));
console.log('nagai singleplaystate', singlePlayState);
if (singlePlayState) {//保存されているものがあるのならそれを使用する
    //盤面終了していないか確認
    let s_endgame = true;
    Object.keys(singlePlayState['board']).forEach(key => {
        if (singlePlayState['board'][key]['val'] === '-') {
            s_endgame = false;
        }
    });
    if (s_endgame) {
        socketio.emit('requestsingleplay');
    } else {
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                let bkey = String(i) + String(j);
                document.getElementById(bkey).textContent = singlePlayState['board'][bkey].val;
            }
        }
    }
} else {
    for (let i = 0; i < 9; i++) {
        socketio.emit('requestsingleplay');
    }
}
//一人用の場合
socketio.on('singleplay', function (data) {
    console.log('nagai 一人用の場合のデータ', data);
    singlePlayState = data;
    localStorage.setItem('singlePlayState', JSON.stringify(singlePlayState));

    if (singlePlayFlag) {
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                let bkey = String(i) + String(j);
                document.getElementById(bkey).textContent = singlePlayState['board'][bkey].val;
            }
        }
    }
});

//接続したらとりあえず状態を取る
socketio.on('connectnum', function (num) {
    console.log('nagai num', num);
    document.getElementById('waiting_num').textContent = '現在の総接続人数' + num;
});

socketio.emit('requestranking', userId);
socketio.on('ranking', function (data) {
    ranking = data;
    console.log('nagai ranking', ranking);
    ranking.sort((a, b) => b.rate - a.rate);

    const rankingTable = document.getElementById('ranking');
    const mytbody = document.createElement("tbody");
    ranking.forEach(({ name, rate, userId }, index) => {
        const mytr = document.createElement("tr");
        const myth = document.createElement("th");
        const mytd1 = document.createElement("td");
        const mytd2 = document.createElement("td");
        const mytd3 = document.createElement("td");

        const rank = getRank(rate);
        myth.textContent = index + 1;
        mytd1.textContent = (userId === window.userId) ? name + '（あなた）' : name;
        mytd2.textContent = rate;
        mytd3.textContent = rank;

        mytr.appendChild(myth);
        mytr.appendChild(mytd1);
        mytr.appendChild(mytd2);
        mytr.appendChild(mytd3);
        mytbody.appendChild(mytr);
    });
    const oldtbody = rankingTable.getElementsByTagName("tbody")[0];
    if (oldtbody) {
        rankingTable.removeChild(oldtbody);
    }
    //rankingTable.replaceChild(mytbody, oldtbody);
    rankingTable.appendChild(mytbody);
});

function getRank(rate) {
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
    const opoele = document.getElementsByClassName('opponent');
    while (opoele.length) {
        opoele[0].classList.remove('opponent');
    }
    const ownele = document.getElementsByClassName('own');
    while (ownele.length) {
        ownele[0].classList.remove('own');
    }
    const opocliele = document.getElementsByClassName('opoClick');
    while (opocliele.length) {
        opocliele[0].classList.remove('opoClick');
    }
    //////
    roomId = rid;
    localStorage.setItem('roomId', roomId);
    //非表示
    document.getElementById('waiting_disp').classList.add('d-none');//対戦街接続中
    document.getElementById('waiting_num').classList.add('d-none');//現在の総接続人数
    //表示
    document.getElementById('dashboard').classList.remove('d-none');
    document.getElementById('disp2').classList.remove('d-none');

    //チャットクリア
    const list = document.getElementById("messages");
    while (list.firstChild) {
        list.removeChild(list.firstChild);
    }
});
//マッチ後のカウントダウン
socketio.on('countdown', function (num) {
    countdown = num;
    $('#disp2').text('マッチしました。あと' + String(num) + '秒で開始します。');
    if (num < 1) {
        $('#disp2').text('Start');
        $(".numbutton").removeClass("glayout");
    } else {
        $(".numbutton").addClass("glayout");
    }
});
//チャット送信
$('#message_form').submit(function () {
    socketio.emit('message', $('#input_msg').val());
    $('#input_msg').val('');
    return false;
});
//チャットメッセージ機能用
socketio.on('message', function (msg) {
    $('#messages').append($('<li>').text(msg));
});
//どこを選択しているか表示用
socketio.on('opponentSelect', function (data) {
    console.log('nagai opponentSelect', data);
    //すでにつけている分を消す。(これも自分のクリックした要素をplaceのような変数に持てば良いがとりあえず）
    let elements = document.getElementsByClassName('opoClick');
    for (let i = 0; i < elements.length; i++) {
        elements[i].classList.remove('opoClick');
    }
    if (data !== '') {
        document.getElementById(data).classList.add('opoClick');
    }
});
//ゲームのイベント
socketio.on('event', function (eventData) {
    if (eventData.status === 'incorrect') {
        //自分が不正解だった場合&& (eventData.userId === userId || eventData.userId === subUserId)
        // const image = document.getElementById("closeicon");
        // image.style.display = "block";
        // setTimeout(function () {
        //     image.style.display = "none";
        // }, 300);
        //不正解だった場合はバツ画像を表示。（なんの数字を入れたかは相手側のはログを見るしか無い……）
        document.getElementById(eventData.coordinate).classList.add('cross');
        setTimeout(function() {
            document.getElementById(eventData.coordinate).classList.remove('cross');
        }, 1000);
    }
    //今は文字を画面に表示しているだけなので文字列で送ってくるだけで良い……。
    const who = (eventData.userId === userId || eventData.userId === subUserId) ? '自分' : '相手';
    const zahyo = '行' + String(parseInt(eventData.coordinate[0]) + 1) + '列' + String(parseInt(eventData.coordinate[1]) + 1);
    const seigo = eventData.status === 'correct' ? '正解' : '不正解';
    const nyuuryoku = eventData.val;
    const log = seigo + ':' + who + ' ' + nyuuryoku + ' ' + zahyo;
    const txarea = document.getElementById('log');
    txarea.value += log + "\n";
    txarea.scrollTop = txarea.scrollHeight;
});
//全盤面の情報取得
//全盤面:どこのマスが誰に開けられているか
//プレイヤーの状態:お手付きに入っているかなど(これは後回し)
//現在見えている盤面と相違があるデータを取得した瞬間に色をつける
socketio.on("state", function (data) {
    //json形式（通信量的に無駄は多いし、json.parseなどは重いので余裕があったら変更する）
    state = data;
    //console.log('nagai state', state);

    let bData = state['board'];
    let points = state['points'];
    let endgame = true;

    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            let bkey = String(i) + String(j);
            //値に変更があった場合、値をセットする
            if (document.getElementById(bkey).textContent != bData[bkey].val) {
                document.getElementById(bkey).textContent = bData[bkey].val;
                if (bData[bkey].id === userId || bData[bkey].id === subUserId) {
                    //classをつける
                    document.getElementById(bkey).classList.add('own');
                } else if (bData[bkey].id !== 'auto' && bData[bkey].id !== 'mada') {
                    document.getElementById(bkey).classList.add('opponent');
                }
            }
            if (bData[bkey].val === '-') {
                endgame = false;
            }
        }
    }
    scoreProcess(points, endgame);
});
//接続エラー時のイベントらしい
socketio.on("error", (error) => {
    // ...
    console.log('nagai error テスト確認', error);
});

// クリックされた要素を保持
let place;

// 空の数独魔法陣作成など
function render_empty_board() {
    console.log('renderemptyboard');
    let targets = document.getElementsByClassName("clickenable");
    for (let i = 0; i < targets.length; i++) {
        targets[i].addEventListener("click", (e) => {
            console.log("nagai click", e.target.textContent);
            sudokuClick(e);
        }, false);
    }

    for (let i = 1; i < 10; i++) {
        let td = document.getElementById(String(i));
        td.onclick = selectClick;
    }
}

//ゲーム開始、待機画面に遷移
let button = document.getElementById('go_game');
button.onclick = goGameButtonClick;
function goGameButtonClick(e) {
    document.getElementById('waiting_disp').classList.remove('d-none');
    document.getElementById('name_button').classList.add('d-none');
    socketio.emit("gogame", { roomId: roomId, userId: userId, subUserId: subUserId, name: document.getElementById('nick').value });
}

// 問題パネルのマスが押された時の処理
// sudokuClickクラスを一か所につける
//ただし、つけているところをクリックしたら消せる
function sudokuClick(e) {
    let onazi = false;
    if (e.target.classList.contains('sudokuClick')) {
        //前回押したところが今回押したところと同じならば(今回押したところをすでにクリックしていたなら)
        onazi = true;
    }

    if (place != undefined) {//前のsudokuClickクラスを消す
        place.classList.remove('sudokuClick');
    }

    if (onazi) {
        socketio.emit("myselect", '');//座標取り消し
        return;
    }

    place = e.target;
    place.classList.add('sudokuClick');
    socketio.emit("myselect", e.target.id);
}

// 数字選択のマスが押された時の処理
function selectClick(e) {
    console.log('nagai select click');
    if (singlePlayFlag) {
        if (document.getElementsByClassName("sudokuClick")[0] === undefined || document.getElementsByClassName("sudokuClick")[0].textContent != "-") { return; }
        let datas = document.getElementById("sudoku").querySelectorAll("tr");
        //本当は二重ループ回す必要ない
        outer_loop: for (let i = 0; i < datas.length; i++) {
            for (let j = 0; j < datas[i].querySelectorAll("td").length; j++) {
                if (datas[i].querySelectorAll("td")[j].classList.contains("sudokuClick")) {
                    const id = String(i) + String(j);
                    if (e.target.textContent === singlePlayState['answer'][i * 9 + j]) {
                        //正解の場合
                        document.getElementById(id).textContent = e.target.textContent;
                        singlePlayState['board'][id]['val'] = e.target.textContent;
                        localStorage.setItem('singlePlayState', JSON.stringify(singlePlayState));
                    } else {
                        //不正解の場合
                        // const image = document.getElementById("closeicon");
                        // image.style.display = "block";
                        // setTimeout(function () {
                        //     image.style.display = "none";
                        // }, 300);
                        document.getElementById(id).classList.add('cross');
                        setTimeout(function() {
                            document.getElementById(id).classList.remove('cross');
                        }, 1000);
                    }
                    break outer_loop;
                }
            }
        }
        let s_endgame = true;
        Object.keys(singlePlayState['board']).forEach(key => {
            if (singlePlayState['board'][key]['val'] === '-') {
                s_endgame = false;
            }
        });
        if (s_endgame) {
            socketio.emit('requestsingleplay');
        }
    } else {
        if (countdown > 0) return;//カウントダウン中に押してもすぐ終了
        if (document.getElementsByClassName("sudokuClick")[0] === undefined || document.getElementsByClassName("sudokuClick")[0].textContent != "-") { return; }
        let datas = document.getElementById("sudoku").querySelectorAll("tr");
        //for文回さなくても選択しているマスはclassで分かるのでそのうち書き換える……
        outer_loop: for (let i = 0; i < datas.length; i++) {
            for (let j = 0; j < datas[i].querySelectorAll("td").length; j++) {
                if (datas[i].querySelectorAll("td")[j].classList.contains("sudokuClick")) {
                    let cd = String(i) + String(j);
                    //送信処理//答え送信
                    let submitInfo = { roomId: roomId, coordinate: cd, val: e.target.textContent };
                    console.log('nagai submitInfo', submitInfo);//nagai 連打対策はしておいた方がよさそう
                    socketio.emit('submit', submitInfo);
                    break outer_loop;
                }
            }
        }
    }

}

// 点数処理
function scoreProcess(points, endgame) {
    let mypoint = 0;
    let opopoint = 0;
    Object.keys(points).forEach(uid => {
        if (uid === userId || uid === subUserId) {
            mypoint = points[uid];
        } else {
            opopoint = points[uid];
        }
    });
    document.getElementById("point_1").textContent = mypoint;
    document.getElementById("point_2").textContent = opopoint;

    if (endgame) {
        const txarea = document.getElementById('log');
        txarea.value += 'ゲーム終了' + "\n";
        txarea.scrollTop = txarea.scrollHeight;
        if (mypoint > opopoint) {//nagai numberのはずなのでこの比較であっているはず
            document.getElementById('disp2').textContent = 'Win!!!';
        } else if (mypoint === opopoint) {
            document.getElementById('disp2').textContent = 'Draw!';
        } else {
            document.getElementById('disp2').textContent = 'Lose';
        }
        //roomId初期化
        localStorage.removeItem('roomId');
        roomId = null;//nagai本当にこれで良いか？

        document.getElementById('name_button').classList.remove('d-none');
    }
}
