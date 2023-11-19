/* eslint-disable @typescript-eslint/no-explicit-any */
import { io, Socket } from "socket.io-client";

/**
* 現在の数独魔法陣盤面情報（見えている盤面）
*/
interface Board {
    [coordinate: string]: {//座標。01~88まで。
        id: string,//当てた人のid 自動:auto,まだ:mada,プレイヤー:matchUserId
        val: string,//見えている値。数字の文字、まだ決まっていない値は-で表現
    }
}
interface ServerToClientEvents {
    singleplay: (a: { 'board': Board, 'answer': string }) => void;
    connectnum: (b: number) => void;
    ranking: (c: { id: string; rate: number, name: string }[]) => void;
    match: (d: string) => void;
    startCountDown: (e: number) => void;
    message: (f: string) => void;
    opponentSelect: (g: string) => void;
    event: (eventData: any) => void;
    state: (data: any) => void;
    stateInfiniteMode: (data: any) => void;
    turnCount: (data: any) => void;
    hoverServer: (data: any) => void;
}

interface ClientToServerEvents {
    requestsingleplay: () => void;
    requestranking: () => void;
    message: (f: string) => void;
    submitExt: (a: { roomId: string | null, extType: string, coordinate: string }) => void;
    hover: (a: { id: string }) => void;
    gogameSimpleMode: (a: any) => void;
    gogameTurnMode: (a: any) => void;
    gogameInfiniteMode: (a: any) => void;
    myselect: (a: any) => void;
    submitTurnMode: (a: any) => void;
    submitSimpleMode: (a: any) => void;
    submitInfiniteMode: (a: any) => void;

}

export const socketio: Socket<ServerToClientEvents, ClientToServerEvents> = io();
