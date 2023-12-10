"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turnmode_1 = require("./turnmode");
describe('gogameTurnMode', () => {
    let io;
    let socket;
    let usersCosmos;
    let gameInfos;
    let lock;
    let container;
    beforeEach(() => {
        socket = {
            id: 'socket1',
            rooms: new Set(['waitingroom_turn']),
            on: jest.fn(),
            emit: jest.fn(),
            join: jest.fn(),
            leave: jest.fn(),
            data: {}, // Add this line
        };
        io = {
            in: jest.fn().mockReturnThis(),
            emit: jest.fn(),
            sockets: {
                adapter: {
                    rooms: new Map([
                        ['waitingroom_turn', new Set(['socket1'])]
                    ])
                }
            },
        };
        usersCosmos = {};
        gameInfos = {};
        lock = {};
        container = {};
    });
    it('should join waiting room and emit state', () => {
        const roomId = 'room1';
        const data = {
            roomId,
            passWord: 'password',
            subUserId: 'subUserId',
            pubUserId: 'pubUserId',
            name: 'John Doe'
        };
        socket.on.mockImplementation((event, callback) => {
            if (event === 'gogameTurnMode') {
                callback(data);
            }
        });
        socket.rooms = new Set(['waitingroom_turn']);
        io.sockets.adapter.rooms = new Map([['waitingroom_turn', new Set(['socket1', 'socket2'])]]);
        io.sockets.sockets = new Map([
            ['socket1', { data: { pubUserId: 'user1' }, join: jest.fn(), leave: jest.fn() }],
            ['socket2', { data: { pubUserId: 'user2' }, join: jest.fn(), leave: jest.fn() }]
        ]);
        (0, turnmode_1.gogameTurnMode)(io, socket, usersCosmos, gameInfos, lock, container);
        expect(socket.join).toHaveBeenCalledWith('waitingroom_turn');
        expect(socket.emit).toHaveBeenCalledWith('state', expect.any(Object));
    });
    // Add more test cases here...
});
//# sourceMappingURL=turnmode.test.js.map