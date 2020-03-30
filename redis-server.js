const RedisServer = require('redis-server')
let server

const start = () => {
    return new Promise((resolve, reject) => {
        console.log('starting redis server')
        server = new RedisServer(6379)
        server.open((err) => {
            if (err) {
                console.error(err)
                return reject(err)
            }
            console.log("running redis server on port 6379")
            return resolve()
        })
    })
}

const shutdown = () => {
    return new Promise((resolve, reject) => {
        return server.close().then(resolve, reject)
    })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

start()

module.exports = { start, shutdown }
