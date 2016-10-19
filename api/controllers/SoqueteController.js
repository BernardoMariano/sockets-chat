'use strict'
/**
 * SoqueteController
 *
 * @description :: Server-side logic for managing soquetes
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

const _ = require('lodash')


const App = {
    messages: [],
    rooms: {},
    newMessage: (name, body) => {
        const message = {
            sender: name,
            time: getTime(),
            body: body
        }
        App.messages.push(message)
        return message
    }
}

let expireExternalAction = null

const broadcastExternalAction = (room, name, action) => {
    let actionText = ''
    switch (action) {
        case 'typing':
            actionText = `${ name } está digitando...`
            break
        default:
            actionText = `${ name } está agindo...`
    }
    sails.sockets.broadcast(room, 'externalAction', actionText)
    if (expireExternalAction != null) {
        clearTimeout(expireExternalAction)
    }
    expireExternalAction = setTimeout(function() {
        expireExternalAction = null
        sails.sockets.broadcast(room, 'externalAction', '')
    }, 1000)
}

const broadcastRoomsList = () => {
    const rooms = _.toArray(App.rooms)
    sails.sockets.broadcast('system', 'room', rooms)
}

const getTime = _ => {
    const now = new Date()
    const hour = now.getHours()
    const mins = now.getMinutes()
    return `${ hour }:${ mins }`
}

sails.config.session.users = {}

sails.config.sockets.afterDisconnect = (session, socket, cb) => {
    const userSocket = sails.config.session.users[socket.id]
    if (!userSocket) return cb()
    const roomName = userSocket.room
    const message = App.newMessage('system', `${ userSocket.name } saiu da sala!`)
    sails.sockets.broadcast(roomName, 'message', message)
    sails.sockets.leave(socket, userSocket.room)
    delete sails.config.session.users[socket.id]
    const room = App.rooms[roomName]
    if (room) {
        const roomUserIndex = room.users.indexOf(userSocket.id)
        App.rooms[roomName].users.splice(roomUserIndex, 1)
        broadcastRoomsList()
    }
    return cb()
}

const commands = {
    '/kick': (senderSocket, targetName) => {
        // params => name
        // find sails.config.session.users { name: params }
        const targetSocket = getSocketByName(targetName)
        if (!targetSocket) return
        targetSocket = targetSocket.socket
        const message = App.newMessage('system', `${ targetName } foi removido da sala por ${ senderSocket.name }!`)
        sails.sockets.leave(targetSocket, senderSocket.room)
        const roomName = userSocket.room
        sails.sockets.broadcast(roomName, 'message', message)
        delete sails.config.session.users[targetSocket.id]
        const roomUserIndex = App.rooms[roomName].users.indexOf(userSocket.id)
        App.rooms[roomName].users.splice(roomUserIndex, 1)
        broadcastRoomsList()
    }
}

const isInSession = socketObj => {
    const socket = sails.config.session.users[socketObj.id]
    return socket && socket.socket.id === socketObj.id
}

const getSocketByName = name => {
    return _.find(sails.config.session.users, { name })
}

const getRoomByName = name => {
    return _.find(App.rooms, { name })
}


module.exports = {
    init: (req, res) => {
        const name = req.param('name')
        if (req.isSocket && name !== 'system' && !getSocketByName(name)) {
            sails.config.session.users[req.socket.id] = {
                socket: req.socket,
                name  : name
            }
            sails.sockets.join(req, 'system')
        } else {
            res.send('nope')
        }
    },
    message: (req, res) => {
        const name = req.param('name')
        const body = req.param('body')
        if (req.isSocket && isInSession(req.socket)) {
            if (body.startsWith('/')) {
                const command = body.split(' ')[0]
                const params  = body.split(' ')[1]
                commands[command] && commands[command](req.socket, params)
            } else {
                const room = sails.config.session.users[req.socket.id].room
                const message = App.newMessage(name, body)
                sails.sockets.broadcast(room, 'message', message)
            }
        }
    },
    enterRoom: (req, res) => {
        const roomName = req.param('roomName')
        if (req.isSocket) {
            const userSocket = sails.config.session.users[req.socket.id]
            userSocket.room = roomName
            sails.sockets.join(req, roomName)
            const message = App.newMessage('system', `${ userSocket.name } entrou na sala!`)
            sails.sockets.broadcast(roomName, 'message', message)
            App.rooms[roomName].users.push(userSocket.id)
            broadcastRoomsList()
        }
    },
    leaveRoom: (req, res) => {
        const roomName = req.param('roomName')
        if (req.isSocket) {
            const userSocket = sails.config.session.users[req.socket.id]
            sails.sockets.leave(req, roomName)
            delete userSocket.room
            const message = App.newMessage('system', `${ userSocket.name } saiu da sala!`)
            sails.sockets.broadcast(roomName, 'message', message)
            const roomUserIndex = App.rooms[roomName].users.indexOf(userSocket.id)
            App.rooms[roomName].users.splice(roomUserIndex, 1)
            broadcastRoomsList()
        }
    },
    createRoom: (req, res) => {
        const roomName = req.param('roomName')
        if (req.isSocket && !getRoomByName(roomName)) {
            App.rooms[roomName] = {
                name: roomName,
                createdAt: getTime(),
                users: []
            }
            broadcastRoomsList()
        }
    },
    listRoom: (req, res) => {
        if (req.isSocket) {
            broadcastRoomsList()
        }
    },
    externalAction: (req, res) => {
        if (req.isSocket) {
            const userSocket = sails.config.session.users[req.socket.id]
            const name = userSocket.name
            const room = userSocket.room
            const action = req.param('action')
            broadcastExternalAction(room, name, action)
        }
    }
}

