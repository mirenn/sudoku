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
console.log('nagai userId', userId);

//部屋ID //途中で切断しても戻れるように
let roomId = localStorage.getItem('roomId');
//レート
let rate = localStorage.getItem('rate');

const input = document.getElementById('nick');
let ncname = localStorage.getItem('name');
console.log('nagai name', ncname);
if (ncname) {
    input.value = ncname;
}
input.addEventListener('input', (event) => {
    localStorage.setItem('name', event.target.value);
});

let ranking;

//同じブラウザ自分同士対戦用
const subUserId = self.crypto.randomUUID();

//state情報を一応持つ。
//ただし、意味は開始時点はnullであることを判定に使っているだけで保存した盤面情報は特に使用しない
let state = null;


//0でないと数独の答え提出処理は走らない
let countdown = 0;
//空の数独マスにイベント追加
render_empty_board();

var socketio = io();
//接続したらとりあえず状態を取る
socketio.on('connectnum', function (num) {
    $('#waiting_num').text('現在の総接続人数' + num);
});

socketio.emit('requestranking', userId);
socketio.on('ranking', function (data) {
    //$('#waiting_num').text('現在の総接続人数' + num);
    ranking = data;
    console.log('nagai ranking', ranking);
    ranking.sort((a, b) => b.rate - a.rate);
    const rankingTextarea = document.getElementById('ranking');
    let txt = '';
    ranking.forEach(({ name, rate, userId }, index) => {
        console.log('nagai windowuserid', window.userId);
        const rank = getRank(rate);
        if (userId === window.userId) {
            txt += `順位${index + 1}位 名前${name}(あなた) レート${rate} ランク${rank}\n`;
        } else {
            txt += `順位${index + 1}位 名前${name} レート${rate} ランク${rank}\n`;
        }
    });
    rankingTextarea.value = txt;
});
function getRank(rate) {
    if (rate < 1500) {
        return "アイアン";
    }
    else if (rate >= 1500 && rate < 1600) {
        return "ブロンズ";
    } else if (rate >= 1600 && rate < 1700) {
        return "シルバー";
    } else if (rate >= 1700 && rate < 1800) {
        return "ゴールド";
    } else {
        return "プラチナ";
    }
}

//マッチしたとき
socketio.on('match', function (rid) {
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
    $('#messages').append($('<li>').text(rid));
    roomId = rid;//nagai:roomIdは秘密にするもしくは推測不可能に。
    localStorage.setItem('roomId', roomId);
    document.getElementById('waiting_disp').style.display = 'none';
    document.getElementById('waiting_num').style.display = 'none';
});
//マッチ後のカウントダウン
socketio.on('countdown', function (num) {
    countdown = num;
    $('#disp2').text('マッチしました。あと' + String(num) + '秒で開始します。');
    if (num < 1) {
        $('#disp2').text('開始');
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
socketio.on('event', function (data) {
    //今は文字を画面に表示しているだけなので文字列で送ってくるだけで良い……。
    const eventData = data;
    const who = (eventData.userId === userId || eventData.userId === subUserId) ? 'あなた' : '相手';
    const zahyo = '行' + String(parseInt(eventData.coordinate[0]) + 1) + '列' + String(parseInt(eventData.coordinate[1]) + 1);
    const seigo = eventData.status === 'correct' ? '正解' : '不正解';
    const nyuuryoku = eventData.val;
    const log = seigo + ':' + who + ' 入力' + nyuuryoku + ' ' + zahyo;
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
    //checkPoint();
    scoreProcess(points, endgame);
});
//接続エラー時のイベントらしい
socketio.on("error", (error) => {
    // ...
    console.log('nagai error テスト確認');
});

// クリックされた要素を保持
let place;

let point_1;
let point_2;

// 空の数独魔法陣作成など
function render_empty_board() {
    console.log('renderemptyboard');
    let targets = document.getElementsByClassName("clickenable");
    for (let i = 0; i < targets.length; i++) {
        targets[i].addEventListener("click", (e) => {
            console.log("nagai click", e.target.textContent);
            mainClick(e);
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
    document.getElementById('waiting_disp').style.display = 'flex';
    document.getElementById('go_game').style.display = 'none';
    socketio.emit("gogame", { roomId: roomId, userId: userId, subUserId: subUserId, name: document.getElementById('nick').value });
}


// 問題パネルのマスが押された時の処理
// mainClickクラスを一か所につける
//ただし、つけているところをクリックしたら消せる
function mainClick(e) {
    let onazi = false;
    if (e.target.classList.contains('mainClick')) {
        //前回押したところが今回押したところと同じならば(今回押したところをすでにクリックしていたなら)
        onazi = true;
    }

    if (place != undefined) {//前のmainClickクラスを消す
        place.classList.remove('mainClick');
    }

    if (onazi) {
        socketio.emit("myselect", '');//座標取り消し
        return;
    }

    place = e.target;
    place.classList.add('mainClick');
    console.log('nagai targetmainclick', e.target.id);
    socketio.emit("myselect", e.target.id);
}

// 数字選択のマスが押された時の処理
function selectClick(e) {
    console.log('nagai select click');
    if (countdown > 0) return;//カウントダウン中に押してもすぐ終了
    if (document.getElementsByClassName("mainClick")[0] === undefined || document.getElementsByClassName("mainClick")[0].textContent != "-") { return; }
    let datas = document.getElementById("main").querySelectorAll("tr");
    for (let i = 0; i < datas.length; i++) {
        for (let j = 0; j < datas[i].querySelectorAll("td").length; j++) {
            if (datas[i].querySelectorAll("td")[j].classList.contains("mainClick")) {
                let cd = String(i) + String(j);
                //送信処理//答え送信
                let submitInfo = { roomId: roomId, coordinate: cd, val: e.target.textContent };
                console.log('nagai submitInfo', submitInfo);//nagai 連打対策はしておいた方がよさそう
                socketio.emit('submit', submitInfo);
            }
        }
    }
}

// htmlから点数判定。使わない予定
function checkPoint() {
    let mypoint = 0;
    let opopoint = 0;
    let mytargets = document.getElementsByClassName("own");
    for (let i = 0; i < mytargets.length; i++) {
        //console.log(targets[i].textContent);
        mypoint += parseInt(mytargets[i].textContent);
    }
    let opotargets = document.getElementsByClassName("opponent");
    for (let i = 0; i < opotargets.length; i++) {
        opopoint += parseInt(opotargets[i].textContent);
    }
    //console.log(mypoint,opopoint);
    document.getElementById("point_1").textContent = mypoint;
    document.getElementById("point_2").textContent = opopoint;
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
            document.getElementById('disp2').textContent = '勝利!!!!!';
        } else if (mypoint === opopoint) {
            document.getElementById('disp2').textContent = '引き分け!';
        } else {
            document.getElementById('disp2').textContent = '敗北';
        }
        //roomId初期化
        localStorage.removeItem('roomId');
        roomId = null;//nagai本当にこれで良いか？

        document.getElementById('go_game').style.display = 'block';
    }
}

// 正解判定
function check(i, j, value) {
    // 終了検知
    if (!questionCheck.flat().includes(0)) {
        document.getElementsByClassName("remove")[0].classList.remove("display-none");
    }

}

//消す処理
function remove() {
    let datas = document.getElementById("main").querySelectorAll("tr");
    for (let i = 0; i < datas.length; i++) {
        for (let j = 0; j < datas[i].querySelectorAll("td").length; j++) {
            if (question[i][j] != 0) {
                datas[i].querySelectorAll("td")[j].textContent = question[i][j];
                datas[i].querySelectorAll("td")[j].classList.add("clickdisable");
            } else {
                datas[i].querySelectorAll("td")[j].textContent = null;
                datas[i].querySelectorAll("td")[j].classList.add("clickenable");
            }
        }
    }
    document.getElementsByClassName("remove")[0].classList.add("display-none");
    // スコアの初期化
    point_1 = 0
    point_2 = 0

    document.getElementById("point_1").textContent = point_1;
    document.getElementById("point_2").textContent = point_2;

    questionCheck = question;
}
