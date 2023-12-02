/**
 * 現在の数独魔法陣盤面情報（見えている盤面）
 */
export interface Board {
    [coordinate: string]: {//座標。01~88まで。
        id: string,//当てた人のid 自動:auto,まだ:mada,プレイヤー:matchUserId
        val: string,//見えている値。数字の文字、まだ決まっていない値は-で表現
    }
}

/**
 * 部屋に入っている二人のポイントを入れるオブジェクト用
 */
export interface Points {
    [matchUserId: string]: number
}
/** stateとして返す情報 */
export interface ReturnState {
    board: Board,
    points: Points,
    highOrLowHistory: HighOrLowHistory[],
    remainingHighOrLowCount: number,
}

/**
 * 部屋ごとのゲーム情報を管理する
 */
export interface GameInfo {
    board: Board,
    answer: string,//その部屋の魔法陣の正解情報
    points: Points,//['points']['それぞれのuserのid']ここに各点数が入っている。matchUserIdが最初からもてれるならこれでよかったが……、そうではなく初期化時どうしようもないので…空で宣言してからみたいな使い方になる
    startCountDown: number,//ゲーム開始時のカウントダウンの残り秒数。
    logs: EventData[],//提出された情報の正解、不正解などの操作情報ログ
    idTableMatchPub: { [matchUserId: string]: string },//matchUserIdとpubUserIdの対応。endgame時に使用
    mode: Mode,
    users: { [matchUserId: string]: { remainingHighOrLowCount: number, highOrLowHistory: HighOrLowHistory[] } },//ここにPointsもまとめてしまいたい……,元気があったらやる
    //以下turnmode時のみ存在。tsのエラーがめんどいのでany型に
    /** string[] ターンの順番、matchUserIdが入る。matchUserId0,'auto',matchUserId1,'auto'*/
    turnArray?: any,
    /** //number 誰のターンかを意味する、turnArrayのindex*/
    turnIndex?: any,
    /** boolean 回答提出されたときtrueになる、回答提出されていたなら次のautoでは盤面はめくられない。falseならめくる*/
    submitFlag?: any,
    /** boolean ゲーム終了時、もしくは誰も部屋にいないときtrueになり、trueならsetTimeout内の定期実行処理内で盤面情報削除処理実行*/
    turnModeGameEnd?: any,
    /**number ゲームを管理するカウントダウン */
    countdown?: any
}
export interface HighOrLowHistory { coordinate: string, highOrLow: 'H' | 'L' }

/**
 * 部屋のIDがキーで、各部屋の情報を格納
 */
export interface RoomDictionaryArray {
    [rooms: string]: GameInfo
}
export type Mode = 'SimpleMode' | 'TurnMode' | 'InfiniteMode';
/**
 * go_gameゲームを開始したときにクライアントより送信されるデータ
 */
export interface GoGameData {
    roomId: string,
    passWord: string,
    pubUserId: string,
    subUserId: string,//同じブラウザ同士の対戦用のid
    name: string,
}
/** 答え提出時のデータ。memo:roomIdはsocket.dataに持つようにすれば送らなくても良い実装にできる */
export interface SubmitInfo { roomId: string, coordinate: string, val: string }
/** その他提出データ */
export interface SubmitExtInfo { roomId: string, extType: ExtType, coordinate: string }
export type ExtType = 'HIGHORLOW';

export interface EventData { status: Status, matchUserId: string, val?: string, coordinate: string }
export type Status = 'Correct' | 'InCorrect' | 'CheckHighOrLow';
/**
 * cosmosDBからとってきてメモリに保持する情報
 * idはpubUserId
 */
export interface UsersCosmosDB { [id: string]: { pk: string, id: string, passWord: string, rate: number, name: string } }

export interface SocketData { passWord: string, matchUserId: string, pubUserId: string }
