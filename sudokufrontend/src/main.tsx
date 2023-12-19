/* eslint-disable @typescript-eslint/no-explicit-any */
// Import our custom CSS
import './scss/styles.scss';
import { socketio } from './socket';
import { useEffect, useState, useRef } from "react";
import { SudokuTablesArea } from "./components/sudokuTablesArea"
import { Ranking } from "./components/ranking"

/**
* pubUserIDのログインパスワードのようなもの
*/
let passWord = localStorage.getItem('userId');//廃止予定
if (!passWord) {
    passWord = self.crypto.randomUUID();
    localStorage.setItem('userId', passWord);//廃止予定
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

const INFINITROOM = 'InfiniteRoom';

/**
 * simplemodeでは、0でないと数独の答え提出処理は走らない 
 * turnmodeでは、最初はそうだが後から違う
 */
let startCountDown = 0;

/**
 * gamemode
 */
let gameMode = '';

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
    singlePlayState = makeNewPlayState(singlePlayState);//データ移行期間中はここにこの値まだちゃんとセットされていないため
    Object.keys(singlePlayState['board']).forEach(key => {
        if (singlePlayState['board'][key]['val'] === '-') {
            singleEndGame = false;
        }
    });
    if (singleEndGame) {
        socketio.emit('requestsingleplay');
    }
} else {
    socketio.emit('requestsingleplay');
}
const getName = localStorage.getItem('name');
const getNickName = getName ? getName : "";

export function Main() {
    const [playState, setPlayState] = useState(singlePlayState);
    const [dashboardDnone, setDashBoardDnone] = useState(true);
    const [disp2Dnone, setDisp2Dnone] = useState(true);
    const [disp2TextContent, setDisp2TextContent] = useState("");
    /** @type {boolean} 対戦待ち接続中の表示非表示 */
    const [waitingDispDnone, setWaitingDispDnone] = useState(true);
    const [waitingNumText, setWaitingNumText] = useState("");
    const [waitingNumDnone, setWaitingNumDnone] = useState(false);
    const [logValue, setLogValue] = useState("");
    const logRef = useRef<HTMLTextAreaElement>(null);
    const [highLowNum, setHighLowNum] = useState(4);
    /** @type {boolean} 数独パネルをグレーアウトさせる */
    const [selectNumGlayOut, setSelectNumGlayOut] = useState(false);
    const [chatAreaValue, setChatAreaValue] = useState("");
    const chatAreaRef = useRef<HTMLTextAreaElement>(null);
    const [point1Text, setPoint1Text] = useState("");
    const [point2Text, setPoint2Text] = useState("");
    const [nameButtonDnone, setNameButtonDnone] = useState(false);
    const [inputMessage, setInputMessage] = useState("");
    const [myClickId, setMyClickId] = useState("");
    const [nickName, setNickName] = useState(getNickName);

    useEffect(() => {
        //一人用のゲーム盤面要求
        socketio.on('singleplay', SinglePlay);

        function ConnectNum(num) {
            console.log('nagai num', num);
            setWaitingNumText('現在の総接続人数' + num);
        }
        //接続したらとりあえず状態を取る
        socketio.on('connectnum', ConnectNum);

        function Match(rid) {
            singlePlayFlag = false;
            /////色をつけるクラスはずして初期化
            removeClass(playState, setPlayState);

            if (gameMode !== 'InfiniteMode') {
                roomId = rid;
                localStorage.setItem('roomId', roomId ? roomId : "");
                //表示
                setDashBoardDnone(false);
                setDisp2Dnone(false);
            } else {
                roomId = INFINITROOM;
                localStorage.setItem('roomId', roomId);
                //表示
                setDisp2Dnone(false);
            }
            //非表示
            setWaitingDispDnone(true);//対戦待ち接続中
            setWaitingNumDnone(true);//現在の総接続人数
            //チャットクリア
            setChatAreaValue("");
            //ログクリア
            setLogValue("");

            //HighOrLow初期値リセット（本当はサーバーから取ってきた値を入れるのだが面倒なので）
            setHighLowNum(4);
        }
        //マッチしたとき
        socketio.on('match', Match);
        function StartCountDown(num) {
            startCountDown = num;
            setDisp2TextContent('マッチしました。あと' + String(num) + '秒で開始します。');

            if (num < 1 && gameMode !== 'TurnMode') {
                setDisp2TextContent('Start');
                setSelectNumGlayOut(false);
            } else {
                //TurnModeではカウントダウン中ずっとグレイアウト
                setSelectNumGlayOut(true);
            }
        }
        //マッチ後のカウントダウン
        socketio.on('startCountDown', StartCountDown);

        function Message(msg) {
            console.log(msg);
            const charea = document.getElementById('chatarea') as HTMLInputElement;
            setChatAreaValue(chatAreaRef.current?.value + msg + "\n");
            charea.scrollTop = charea.scrollHeight;
            if (chatAreaRef.current) {//nagai書き方あっているか?
                chatAreaRef.current.scrollTop = charea.scrollHeight;
            }
        }
        //チャットメッセージ機能用
        socketio.on('message', Message);
        function OpponentSelect(data) {
            console.log('nagai opponentSelect', data);
            //すでにつけている分を消す。(これも自分のクリックした要素をplaceのような変数に持てば良いがとりあえず）
            const newPlayState = { ...playState };
            Object.keys(newPlayState['board']).forEach(key => {
                newPlayState['board'][key]['opoClick'] = false;
            });
            newPlayState['board'][data]['opoClick'] = true;
            setPlayState(newPlayState);
        }
        //どこを選択しているか表示用
        socketio.on('opponentSelect', OpponentSelect);

        function Event(eventData) {
            console.log('nagai', eventData);
            const newPlayState = { ...playState };

            if (eventData.status === 'InCorrect') {
                //不正解だった場合はバツ画像を表示。（なんの数字を入れたかは相手側のはログを見るしか無い……）
                newPlayState['board'][eventData.coordinate]['showCross'] = true;
                setPlayState(newPlayState);
                setTimeout(function () {
                    // setPlayStateに関数を渡して、前回の値を取得して更新する
                    setPlayState((prevPlayState) => {
                        // 前回の値をコピーする
                        const updatedPlayState = { ...prevPlayState };
                        // showCrossをfalseにする
                        updatedPlayState['board'][eventData.coordinate]['showCross'] = false;
                        // 更新した値を返す
                        return updatedPlayState;
                    });
                }, 1000);
            }
            if (eventData.status === 'auto' && gameMode === 'TurnMode') {//autoがそもそもturnmode限定
                //今は文字を画面に表示しているだけなので文字列で送ってくるだけで良い……。
                const zahyo = '行' + String(parseInt(eventData.coordinate[0]) + 1) + '列' + String(parseInt(eventData.coordinate[1]) + 1);
                const nyuuryoku = eventData.val;
                const newLogValue = logRef.current?.value + '自動展開' + ':' + zahyo + '：' + nyuuryoku + "\n";
                setLogValue(newLogValue);
                const txarea = document.getElementById('log') as HTMLInputElement;
                if (chatAreaRef.current) {
                    chatAreaRef.current.scrollTop = txarea.scrollHeight;
                }

                //autoで開かれた箇所の枠線は１秒間枠を太くする
                newPlayState['board'][eventData.coordinate]['showHutoiBorder'] = true;
                setPlayState(newPlayState);
                setTimeout(function () {
                    newPlayState['board'][eventData.coordinate]['showHutoiBorder'] = false;
                    setPlayState(newPlayState);
                }, 1000);

                setDisp2TextContent('自動展開' + ':' + zahyo + '：' + nyuuryoku);
                return;//autoなら処理ここまで
            }

            if (eventData.status === 'Correct' || eventData.status === 'InCorrect') {
                //今は文字を画面に表示しているだけなので文字列で送ってくるだけで良い……。
                const who = (eventData.matchUserId === pubUserId || eventData.matchUserId === subUserId) ? '自分' : '相手';
                const zahyo = '行' + String(parseInt(eventData.coordinate[0]) + 1) + '列' + String(parseInt(eventData.coordinate[1]) + 1);
                const seigo = eventData.status === 'Correct' ? '正解' : '不正解';
                const nyuuryoku = eventData.val;
                const txarea = document.getElementById('log') as HTMLInputElement;

                //nagaiよくわからないが前の値をlogValueから取ることはできない
                //const newLogValue = logValue + seigo + ':' + who + ' ' + zahyo + '：' + nyuuryoku + "\n"; 
                const newLogValue = logRef.current?.value + seigo + ':' + who + ' ' + zahyo + '：' + nyuuryoku + "\n";
                setLogValue(newLogValue);
                if (logRef.current) {
                    logRef.current.scrollTop = txarea.scrollHeight;
                }
            } else if (eventData.status === 'CheckHighOrLow') {
                const who = (eventData.matchUserId === pubUserId || eventData.matchUserId === subUserId) ? '自分' : '相手';
                const zahyo = '行' + String(parseInt(eventData.coordinate[0]) + 1) + '列' + String(parseInt(eventData.coordinate[1]) + 1);
                const type = 'HighOrLow'
                const txarea = document.getElementById('log') as HTMLInputElement;
                const newLogValue = logRef.current?.value + type + ':' + who + ' ' + zahyo + "\n";
                setLogValue(newLogValue);
                if (logRef.current) {
                    logRef.current.scrollTop = txarea.scrollHeight;
                }
            }
        }
        /**
         * {status: string,matchUserId: string,val: string,coordinate: string}
         */
        socketio.on('event', Event);

        function State(data) {
            const state = data;
            const points = state['points'];
            const newPlayState = { ...playState };
            let endgame = true;

            Object.keys(newPlayState['board']).forEach(key => {
                newPlayState['board'][key]['val'] = state['board'][key]['val'];
                newPlayState['board'][key]['id'] = state['board'][key]['id'];
                if (newPlayState['board'][key]['id'] === pubUserId || newPlayState['board'][key]['id'] === subUserId) {
                    //classをつける
                    newPlayState['board'][key]['own'] = true;
                } else if (newPlayState['board'][key]['id'] !== 'auto' && newPlayState['board'][key]['id'] !== 'mada') {
                    newPlayState['board'][key]['opponent'] = true;
                }
                if (newPlayState['board'][key]['val'] === '-') {
                    endgame = false;
                }
            });

            if (state['highOrLowHistory']) {
                const highOrLowHistory = state['highOrLowHistory'];
                highOrLowHistory.forEach((hol: { coordinate: string | number; highOrLow: any; }) => {
                    if (newPlayState['board'][hol.coordinate]['val'] === '-') {
                        newPlayState['board'][hol.coordinate]['val'] = hol.highOrLow;
                    }
                });
                setHighLowNum(data['remainingHighOrLowCount']);
            }

            setPlayState(newPlayState);

            scoreProcess(points, endgame, logValue, setPoint1Text, setPoint2Text, setLogValue, setDisp2TextContent, setNameButtonDnone);
        }
        //全盤面の情報取得
        //全盤面:どこのマスが誰に開けられているか
        //プレイヤーの状態:お手付きに入っているかなど(これは後回し)
        //現在見えている盤面と相違があるデータを取得した瞬間に色をつける
        //simpleとturn
        socketio.on('state', State);
        function StateInfiniteMode(data) {
            const state = data;

            let endgame = true;
            const newPlayState = { ...playState };

            Object.keys(newPlayState['board']).forEach(key => {
                if (state['board'][key]['val'] !== '-') {//変更後の値が-のときは別に良い（これはHかLのときに-で上書き防止）//nagaiいらないかも
                    newPlayState['board'][key]['val'] = state['board'][key]['val'];
                }
                newPlayState['board'][key]['id'] = state['board'][key]['id'];
                if (newPlayState['board'][key]['id'] === pubUserId || newPlayState['board'][key]['id'] === subUserId) {
                    //classをつける
                    newPlayState['board'][key]['own'] = true;
                } else if (newPlayState['board'][key]['id'] !== 'auto' && newPlayState['board'][key]['id'] !== 'mada') {
                    newPlayState['board'][key]['opponent'] = true;
                }
                if (newPlayState['board'][key]['val'] === '-') {
                    endgame = false;
                }
            });
            setPlayState(newPlayState);

            if (endgame) {
                removeClass(playState, setPlayState);
            }
        }
        socketio.on('stateInfiniteMode', StateInfiniteMode);
        //TurnMode用。ゲーム進行カウントダウン
        //nagai:ゲーム終了してもカウント進んでいたので修正する
        function TurnCount(data) {
            console.log('nagai data', data);
            if (data.turnUserId === pubUserId || data.turnUserId === subUserId) {
                setSelectNumGlayOut(false);
            } else {
                setSelectNumGlayOut(true);
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
            setDisp2TextContent(dispmessage);
        }
        socketio.on("turnCount", TurnCount);

        /** {matchUserIdのuuid : id} */
        const opoHover: any = {};
        /** { id: string, matchUserId: string} */
        function HoverServer(data) {
            const newPlayState = { ...playState };

            if (gameMode === 'InfiniteMode') {
                if (data.matchUserId in opoHover) {
                    newPlayState['board'][opoHover[data.matchUserId]]['opoHover'] = false;
                }
                opoHover[data.matchUserId] = data.id;
                if (data.id !== '') {
                    newPlayState['board'][data.id]['opoHover'] = true;
                }
            } else {
                Object.keys(newPlayState['board']).forEach(key => {
                    newPlayState['board'][key]['opoHover'] = false;
                });
                if (data.id !== '') {
                    newPlayState['board'][data.id]['opoHover'] = true;
                }
            }
            setPlayState(newPlayState);
        }
        socketio.on("hoverServer", HoverServer);

        function Connect_Error(error) {
            console.log('nagai error テスト確認', error);
            setDisp2TextContent('サーバーと通信ができなくなりました');
        }
        //接続エラー時のイベント
        socketio.on('connect_error', Connect_Error);
        function Connect() {
            setDisp2TextContent('接続');
        }
        socketio.on('connect', Connect);

        return () => {
            socketio.off('singleplay', SinglePlay);
            socketio.off('connectnum', ConnectNum);
            socketio.off('match', Match);
            socketio.off('startCountDown', StartCountDown);
            socketio.off("message", Message);
            socketio.off('opponentSelect', OpponentSelect);
            socketio.off('event', Event);
            socketio.off('state', State);
            socketio.off('stateInfiniteMode', StateInfiniteMode);
            socketio.off("turnCount", TurnCount);
            socketio.off("hoverServer", HoverServer);
            socketio.off('connect_error', Connect_Error);
            socketio.off('connect', Connect);
        };
    }, []);
    return (
        <>
            <h1 id="midasi">Sudoku Online</h1>
            <span id="waiting_num" className={"d-flex justify-content-center" + (waitingNumDnone ? " d-none" : "")}>{waitingNumText}</span>
            <div id="waiting_disp" className={"d-flex justify-content-center" + (waitingDispDnone ? " d-none" : "")}>
                <span id="waiting">対戦待ち接続中</span>
                <div className="loader"></div>
            </div>
            <span id="disp2" className={"d-flex justify-content-center mb-2" + (disp2Dnone ? " d-none" : "")}>{disp2TextContent}</span>
            <div id="name_button" className={"d-flex justify-content-center align-items-center mb-1" + (nameButtonDnone ? " d-none" : "")}>
                <div className="form-group">
                    <input type="text" className="form-control" id="nick" placeholder="Nickname" maxLength={24} value={nickName} onChange={handleChangeNickName} />
                </div>
                <div className="d-flex mx-3">
                    <button id="go_game" onClick={() => { handleGoGameButtonClick(setWaitingDispDnone, setNameButtonDnone) }} className="btn btn-primary rounded-pill" type="button">Play Online</button>
                </div>
                <div className="form-check">
                    <label className="form-check-label" htmlFor="SimpleMode">
                        Simple
                        <input className="form-check-input" type="radio" value="SimpleMode" name="modeRadio" id="SimpleMode" defaultChecked />
                    </label>
                </div>
                <div className="form-check">
                    <label className="form-check-label" htmlFor="InfiniteMode">
                        Infinite
                        <input className="form-check-input" type="radio" value="InfiniteMode" name="modeRadio" id="InfiniteMode" />
                    </label>
                </div>
            </div>
            <div className="row d-flex justify-content-center">
                <SudokuTablesArea playState={playState} setPlayState={setPlayState} myClickId={myClickId} setMyClickId={setMyClickId}
                    selectNumGlayOut={selectNumGlayOut} singlePlayFlag={singlePlayFlag} gameMode={gameMode} startCountDown={startCountDown} roomId={roomId} />
                <div id="dashboard" className={"card col-md-3 mb-4 box-shadow" + (dashboardDnone ? " d-none" : "")}>
                    <div className="card-body">
                        <div id="scoreboard" className="mb-4">
                            <div><span style={{ color: "#a3ffa3" }}>■</span>自分:
                                <span id="point_1">{point1Text}</span>
                            </div>
                            <div><span style={{ color: "#f5d1fb" }}>■</span>相手:
                                <span id="point_2">{point2Text}</span>
                            </div>
                        </div>
                        <textarea value={logValue} ref={logRef} className="form-control mb-2" placeholder="log" id="log" readOnly={true}></textarea>
                        <div id="chat" className="mb-4">
                            <textarea className="form-control" ref={chatAreaRef} value={chatAreaValue} placeholder="chat" id="chatarea" readOnly={true}></textarea>
                            <form id="message_form" action="#" >
                                <input id="input_msg" placeholder="message" value={inputMessage} onChange={(e) => {
                                    setInputMessage(e.target.value);
                                }} className="form-control mb-2" autoComplete="off" />
                                <button className="btn btn-primary" type="button" data-bs-toggle="tooltip" title="send message" onClick={() => {
                                    console.log('nagai onclick button');
                                    const element = document.getElementById('input_msg') as HTMLInputElement;
                                    socketio.emit('message', element.value);
                                    setInputMessage("");//入力フォームを空にする
                                }}>Send</button>
                            </form>
                        </div>
                        <button id="highLowButton" className="btn btn-primary" data-bs-toggle="tooltip" title="≥5 or <5"
                            onClick={() => {
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
                            }}>H or L<span className="badge bg-secondary">{highLowNum}</span></button>
                    </div>
                </div>
            </div>
            <Ranking pubUserId={pubUserId} />
        </>
    );

    function handleChangeNickName(e) {
        // inputタグの値を取得し、nickNameにセット
        setNickName(e.target.value);
        localStorage.setItem('name', (e.target as HTMLInputElement).value);
    }

    function SinglePlay(data) {
        singlePlayState = makeNewPlayState(data);
        console.log('nagai 一人用の場合のデータ', singlePlayState);
        localStorage.setItem('singlePlayState', JSON.stringify(singlePlayState));

        setPlayState(singlePlayState);
    }
}

socketio.emit('requestranking');

function handleGoGameButtonClick(setWaitingDispDnone, setNameButtonDnone) {
    const el: any = document.getElementsByName('modeRadio');
    const len = el.length;
    for (let i = 0; i < len; i++) {
        if (el.item(i).checked) {
            gameMode = el.item(i).value;
        }
    }
    setWaitingDispDnone(false);
    setNameButtonDnone(true);
    const element = document.getElementById('nick') as HTMLInputElement;
    if (gameMode === 'SimpleMode') {
        socketio.emit("gogameSimpleMode", { roomId: roomId, passWord: passWord, subUserId: subUserId, pubUserId: pubUserId, name: element?.value });
    } else if (gameMode === 'TurnMode') {
        socketio.emit("gogameTurnMode", { roomId: roomId, passWord: passWord, subUserId: subUserId, pubUserId: pubUserId, name: element?.value });
    } else if (gameMode === 'InfiniteMode') {
        socketio.emit("gogameInfiniteMode", { roomId: roomId, passWord: passWord, subUserId: subUserId, pubUserId: pubUserId, name: element?.value });
    }
}



/**点数処理 */
function scoreProcess(points: any, endgame: any, logValue, setPoint1Text, setPoint2Text, setLogValue, setDisp2TextContent, setNameButtonDnone) {
    let mypoint = 0;
    let opopoint = 0;
    Object.keys(points).forEach(muid => {
        if (muid === pubUserId || muid === subUserId) {
            mypoint = points[muid];
        } else {
            opopoint = points[muid];
        }
    });
    setPoint1Text(mypoint);
    setPoint2Text(opopoint)

    if (endgame) {
        setLogValue(logValue + 'ゲーム終了' + "\n");
        if (mypoint > opopoint) {//nagai numberのはずなのでこの比較であっているはず
            setDisp2TextContent('Win!!!');
        } else if (mypoint === opopoint) {
            setDisp2TextContent('Draw!');
        } else {
            setDisp2TextContent('Lose');
        }

        //roomId初期化
        localStorage.removeItem('roomId');
        roomId = null;//nagai本当にこれで良いか？

        setNameButtonDnone(false);
    }
}

/**色をつけるクラスはずして初期化 */
function removeClass(playState, setPlayState) {
    console.log('nagai removeclass', playState);
    const newPlayState = makeNewPlayState(playState);
    setPlayState(newPlayState);
}

/**
 * 状態管理に必要なプロパティを追加して生成
 * @param playState 
 * @returns 
 */
function makeNewPlayState(playState) {
    const newPlayState = { ...playState };

    Object.keys(newPlayState['board']).forEach(key => {
        newPlayState['board'][key]['showCross'] = false;
        newPlayState['board'][key]['opoClick'] = false;
        newPlayState['board'][key]['opoHover'] = false;
        newPlayState['board'][key]['own'] = false;
        newPlayState['board'][key]['opponent'] = false;
        newPlayState['board'][key]['showHutoiBorder'] = false;
    });
    return newPlayState;
}