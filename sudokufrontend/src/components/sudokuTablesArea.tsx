import { socketio } from '../socket';

/**
 * 数独魔法陣と数独回答パネル
 * @param param0 
 * @returns 
 */
export function SudokuTablesArea({ playState, setPlayState, myClickId, setMyClickId ,selectNumGlayOut, singlePlayFlag, gameMode, startCountDown, roomId}) {
    return (
        <div className="col-md-6 mb-4" style={{ position: "relative" }}>
            <SudokuTable playState={playState} myClickId={myClickId} handleKeyDown={handleKeyDown} setMyClickId={setMyClickId} ></SudokuTable>
            <table className='select'>
                <tbody>
                    <tr>
                        <SelectNumButton id="1" selectNumGlayOut={selectNumGlayOut} playState={playState} setPlayState={setPlayState} ></SelectNumButton>
                        <SelectNumButton id="2" selectNumGlayOut={selectNumGlayOut} playState={playState} setPlayState={setPlayState} ></SelectNumButton>
                        <SelectNumButton id="3" selectNumGlayOut={selectNumGlayOut} playState={playState} setPlayState={setPlayState} ></SelectNumButton>
                        <SelectNumButton id="4" selectNumGlayOut={selectNumGlayOut} playState={playState} setPlayState={setPlayState} ></SelectNumButton>
                        <SelectNumButton id="5" selectNumGlayOut={selectNumGlayOut} playState={playState} setPlayState={setPlayState} ></SelectNumButton>
                        <SelectNumButton id="6" selectNumGlayOut={selectNumGlayOut} playState={playState} setPlayState={setPlayState} ></SelectNumButton>
                        <SelectNumButton id="7" selectNumGlayOut={selectNumGlayOut} playState={playState} setPlayState={setPlayState} ></SelectNumButton>
                        <SelectNumButton id="8" selectNumGlayOut={selectNumGlayOut} playState={playState} setPlayState={setPlayState} ></SelectNumButton>
                        <SelectNumButton id="9" selectNumGlayOut={selectNumGlayOut} playState={playState} setPlayState={setPlayState} ></SelectNumButton>
                    </tr>
                </tbody>
            </table>
        </div>);
    function SelectNumButton({ id, selectNumGlayOut, playState, setPlayState }) {
        let dispNumCnt = 0;
        if (playState['board']) {
            Object.keys(playState['board']).forEach(key => {
                if (playState['board'][key]['val'] === id) {
                    dispNumCnt++;
                }
            })
        }

        return (
            <td id={id} className={"numbutton" + ((selectNumGlayOut || dispNumCnt > 8) ? " glayout" : "") + (dispNumCnt < 9 ? " selectNumHover" : "")} onClick={() => {
                if (dispNumCnt < 9) handleSelectNumClick(id, playState, setPlayState)
            }}>{id}</td>
        );
    }
    function SudokuTable({ playState, myClickId, handleKeyDown, setMyClickId }) {
        const tableList: JSX.Element[] = [];
        for (let row = 0; row < 9; row++) {
            const rowList: JSX.Element[] = [];
            for (let col = 0; col < 9; col++) {
                const key = row.toString() + col.toString();
                rowList.push(<SudokuTd id={key} key={key} myClickId={myClickId} setMyClickId={setMyClickId} playState={playState}></SudokuTd>)
            }
            tableList.push(<tr key={row}>{rowList}</tr>);
        }
        return (
            <table id="sudoku" className="sudoku" onKeyDown={handleKeyDown} tabIndex={0}>
                <tbody>
                    {tableList}
                </tbody>
            </table>
        );
    }
    function SudokuTd({ id, playState, myClickId, setMyClickId }) {
        return (
            <td id={id} className={"clickenable" + (myClickId === id ? " myClick" : "")
                + (playState['board']?.[id]?.['showCross'] ? " cross" : "")
                + (playState['board']?.[id]?.['opoClick'] ? " opoClick" : "")
                + (playState['board']?.[id]?.['opoHover'] ? " opoHover" : "")
                + (playState['board']?.[id]?.['own'] ? " own" : "")
                + (playState['board']?.[id]?.['opponent'] ? " opponent" : "")
                + (playState['board']?.[id]?.['showHutoiBorder'] ? " hutoiborder" : "")}
                onMouseEnter={() => {
                    socketio.emit("hover", { id: id });
                }}
                onMouseLeave={() => { socketio.emit('hover', { id: '' }) }}
                onClick={() => {
                    handleSudokuClick(id, id === myClickId, setMyClickId);
                }} >{playState['board']?.[id]?.['val']}</td>
        );
    }
    /**
* 数独テーブル上でキーボードを押したときの操作。
* @param e 
*/
    function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
        const key = e.code;
        console.log(key);
        e.preventDefault();//画面のスクロールを止めるため

        if (key === 'ArrowUp') {
            let rowNum = Number(myClickId[0]);
            if (rowNum > 0) {
                rowNum--;
            }
            const newMyClickId = rowNum.toString() + myClickId[1];
            setMyClickId(newMyClickId);
        }

        if (key === 'ArrowDown') {
            let rowNum = Number(myClickId[0]);
            if (rowNum < 8) {
                rowNum++;
            }
            const newMyClickId = rowNum.toString() + myClickId[1];
            setMyClickId(newMyClickId);
        }

        if (key === 'ArrowLeft') {
            let colNum = Number(myClickId[1]);
            if (colNum > 0) {
                colNum--;
            }
            const newMyClickId = myClickId[0] + colNum.toString();
            setMyClickId(newMyClickId);
        }

        if (key === 'ArrowRight') {
            let colNum = Number(myClickId[1]);
            if (colNum < 8) {
                colNum++;
            }
            const newMyClickId = myClickId[0] + colNum.toString();
            setMyClickId(newMyClickId);
        }
        if (key === 'Numpad0' || key === 'Numpad1' || key === 'Numpad2' || key === 'Numpad3' || key === 'Numpad4' || key === 'Numpad5' || key === 'Numpad6' || key === 'Numpad7' || key === 'Numpad8' || key === 'Numpad9' || key === 'Digit0' || key === 'Digit1' || key === 'Digit2' || key === 'Digit3' || key === 'Digit4' || key === 'Digit5' || key === 'Digit6' || key === 'Digit7' || key === 'Digit8' || key === 'Digit9') {
            // 数字キーボードのいずれかのキーが押されたときの処理
            handleSelectNumClick(key[-1], playState, setPlayState);
        }
    }

    /**
 * 問題パネルのマスが押された時の処理 myClickクラスを一か所につける ただし、つけているところをクリックしたら消せる 
 * @returns 
 */
    function handleSudokuClick(id, id_onazi, setMyClickId) {
        if (id_onazi) {
            setMyClickId('');
        } else {
            setMyClickId(id);
        }
        socketio.emit("myselect", id);
    }

    /** 数字選択のマスを押した時の処理及び数字キーボードを押したときの処理 */
    function handleSelectNumClick(clickNum, playState, setPlayState) {
        if (singlePlayFlag) {
            const sudokuTableMyClickTarget = document.getElementsByClassName("myClick");
            if (sudokuTableMyClickTarget.length === 0) { return; }//数独の盤面で選択対象がない場合
            const sudokuTableMyClickId = sudokuTableMyClickTarget[0].id;
            if (!isNaN(playState['board'][sudokuTableMyClickId]['val'])) { return; }//数字が既に入っている場合
            const row = Number(sudokuTableMyClickId[0]);
            const col = Number(sudokuTableMyClickId[1]);

            const newPlayState = { ...playState };
            const answerNum = playState['answer'][row * 9 + col];

            if (clickNum === answerNum) {
                //正解の場合
                newPlayState['board'][sudokuTableMyClickId]['val'] = answerNum;
                setPlayState(newPlayState);
                localStorage.setItem('singlePlayState', JSON.stringify(newPlayState));
            } else {
                //不正解の場合
                newPlayState['board'][sudokuTableMyClickId]['showCross'] = true;
                setPlayState(newPlayState);
                setTimeout(function () {
                    // setPlayStateに関数を渡して、前回の値を取得して更新する
                    setPlayState((prevPlayState) => {
                        // 前回の値をコピーする
                        const updatedPlayState = { ...prevPlayState };
                        // showCrossをfalseにする
                        updatedPlayState['board'][sudokuTableMyClickId]['showCross'] = false;
                        // 更新した値を返す
                        return updatedPlayState;
                    });
                }, 1000);
            }

            let singleEndGame = true;
            Object.keys(newPlayState['board']).forEach(key => {
                if (newPlayState['board'][key]['val'] === '-') {
                    singleEndGame = false;
                }
            });
            if (singleEndGame) {
                socketio.emit('requestsingleplay');
            }
        } else if (gameMode === 'TurnMode') {
            if (startCountDown > 0) return;//カウントダウン中に押してもすぐ終了
            const sudokuTableMyClickTarget = document.getElementsByClassName("myClick");
            if (sudokuTableMyClickTarget.length === 0) { return; }//数独の盤面で選択対象がない場合
            const sudokuTableMyClickId = sudokuTableMyClickTarget[0].id;
            if (!isNaN(playState['board'][sudokuTableMyClickId]['val'])) { return; }//1~9の数字が既に入っている場合

            const submitInfo = {
                roomId: roomId,
                coordinate: sudokuTableMyClickId,
                val: clickNum
            };
            console.log('nagai submitInfo', submitInfo);
            socketio.emit('submitTurnMode', submitInfo);
        }
        else if (gameMode === 'SimpleMode') {
            //SinmpleMode
            if (startCountDown > 0) return;//カウントダウン中に押してもすぐ終了
            const sudokuTableMyClickTarget = document.getElementsByClassName("myClick");
            if (sudokuTableMyClickTarget.length === 0) { return; }//数独の盤面で選択対象がない場合
            const sudokuTableMyClickId = sudokuTableMyClickTarget[0].id;
            if (!isNaN(playState['board'][sudokuTableMyClickId]['val'])) { return; }//1~9の数字が既に入っている場合

            const submitInfo = {
                roomId: roomId,
                coordinate: sudokuTableMyClickId,
                val: clickNum
            };
            console.log('nagai submitInfo', submitInfo);
            socketio.emit('submitSimpleMode', submitInfo);
        } else if (gameMode === 'InfiniteMode') {
            const sudokuTableMyClickTarget = document.getElementsByClassName("myClick");
            if (sudokuTableMyClickTarget.length === 0) { return; }//数独の盤面で選択対象がない場合
            const sudokuTableMyClickId = sudokuTableMyClickTarget[0].id;
            if (!isNaN(playState['board'][sudokuTableMyClickId]['val'])) { return; }//1~9の数字が既に入っている場合

            const submitInfo = {
                roomId: roomId,
                coordinate: sudokuTableMyClickId,
                val: clickNum
            };
            console.log('nagai submitInfo', submitInfo);
            socketio.emit('submitInfiniteMode', submitInfo);
        }
    }
}