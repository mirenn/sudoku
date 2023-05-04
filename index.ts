import express from 'express';
import socketio from 'socket.io';
import http, {IncomingMessage, ServerResponse} from 'http'

const app: express.Express = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
const PORT =  7000;

//CROS対応（というか完全無防備：本番環境ではだめ絶対）
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    // res.header("Access-Control-Allow-Origin", "*");
    // res.header("Access-Control-Allow-Methods", "*")
    // res.header("Access-Control-Allow-Headers", "*");
    next();
})

// app.listen(PORT, () => {
//     console.log("Start on port 7000.")
// })

type User = {
    id: number
    name: string
    email: string
};

const users: User[] = [
    { id: 1, name: "User1", email: "user1@test.local" },
    { id: 2, name: "User2", email: "user2@test.local" },
    { id: 3, name: "User3", email: "user3@test.local" }
]

//一覧取得
// app.get('/', express.static('public'));
// ディレクトリでindex.htmlをリク・レス
app.get('/', (req, res) => {
    res.sendFile(__dirname  + '/public/index.html');
  });

//一覧取得
app.get('/users', (req: express.Request, res: express.Response) => {
    res.send(JSON.stringify(users))
})

const server: http.Server = http.createServer(app);

const io: socketio.Server = new socketio.Server(server);
io.on('connection',function(socket){
    socket.on('message',function(msg){
        console.log('message: ' + msg);
        io.emit('message', msg);
    });
});

server.listen(PORT, function(){
    console.log('server listening. Port:' + PORT);
});