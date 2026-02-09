const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 10MB
});

app.use(express.static(__dirname));

const users = {}; // socket.id -> { name, avatar }
let messages = []; // Global chat history

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Join
    socket.on('join', ({ name, avatar }) => {
        users[socket.id] = { name, avatar };
        io.emit('update_users', Object.values(users));

        // Send history 
        socket.emit('history', messages.slice(-50));
    });

    // Chat Message
    socket.on('chat_message', (msg) => {
        // msg: { user, avatar, content, type, time, room }

        if (msg.room === 'global') {
            messages.push(msg);
            if (messages.length > 200) messages.shift();
            io.emit('chat_message', msg);
        } else {
            // Private message: msg.room = "User1_User2"
            // Identify recipient
            const participants = msg.room.split('_');
            const recipientName = participants.find(p => p !== msg.user);

            if (recipientName) {
                const recipientSocketId = Object.keys(users).find(id => users[id].name === recipientName);
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('chat_message', msg);
                }
            }
            // Send back to sender so they see it too
            socket.emit('chat_message', msg);
        }
    });

    // Typing
    socket.on('typing', ({ room, user }) => {
        if (room === 'global') {
            socket.broadcast.emit('typing', { room, user });
        } else {
            const participants = room.split('_');
            const recipientName = participants.find(p => p !== user);
            const recipientSocketId = Object.keys(users).find(id => users[id].name === recipientName);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('typing', { room, user });
            }
        }
    });

    // Call Signals (WebRTC)
    socket.on('call_signal', (data) => {
        // data: { type, target, payload, room }
        const targetSocketId = Object.keys(users).find(id => users[id].name === data.target);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_signal', {
                type: data.type,
                sender: users[socket.id].name,
                payload: data.payload,
                room: data.room
            });
        }
    });


    // Delete Message
    socket.on('delete_message', (data) => {
        console.log("Server received delete_message request:", data);
        if (data.room === 'global') {
            const initialCount = messages.length;
            messages = messages.filter(m => (m.room + "_" + m.time + "_" + m.user) !== data.messageId);
            console.log(`Global deletion: ${initialCount} -> ${messages.length} messages.`);
            io.emit('delete_message', data);
        } else {
            const participants = data.room.split('_');
            const recipientName = participants.find(p => p !== data.user);
            const recipientSocketId = Object.keys(users).find(id => users[id].name === recipientName);
            if (recipientSocketId) {
                console.log("Forwarding private deletion to:", recipientName);
                io.to(recipientSocketId).emit('delete_message', data);
            }
            socket.emit('delete_message', data);
        }
    });

    // Clear Global Chat
    socket.on('clear_chat', () => {
        console.log("Server clearing global message history.");
        messages = [];
        io.emit('clear_chat');
    });

    // Disconnect
    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('update_users', Object.values(users));
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
