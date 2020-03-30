const http = require('http')
const express = require('express')
const redis = require('redis')
const io = require('socket.io')
const bodyParser = require('body-parser')

const app = express()
const server = http.Server(app)
const socketServer = io(server)
let client

app.use(express.static('./'))
app.use(bodyParser())

socketServer.on('connection', (socket) => {
    socket.on('disconnect', () => {

    })
})

app.post('/games', (req, res) => {
    const id = req.body.id
    const game = req.body
    client.set(id, JSON.stringify(game), (err, reply) => {
        res.send(game)
    })
})

app.put('/games/:id', (req, res) => {
    const id = req.params.id
    const game = req.body
    client.set(id, JSON.stringify(game), (err, reply) => {
        socketServer.emit('update', game)
        res.send(game)
    })
})

app.get('/games/:id', (req, res) => {
    const id = req.params.id
    client.get(id, (err, obj) => {
        res.send(obj)
    })
})

app.get('/', (req, res) => {
})

const shutdown = () => {
    return new Promise((resolve, reject) => {
        server.close((err) => {
            if (err) {
                console.error(err)
                reject(err)
            }
            resolve()
        })
    })
}

const start = () => {
    return new Promise((resolve, reject) => {
        client = redis.createClient(process.env.REDIS_URL)
        server.listen(process.env.PORT, err => {
            if (err) {
                console.error(err)
                return reject(err)
            }
            console.log("node server listening on port " + process.env.PORT)
            return resolve()
        })
    })
}


process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

start()

module.exports = { start, shutdown }
