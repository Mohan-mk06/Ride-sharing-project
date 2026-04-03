const mongoose = require('mongoose');
const User = require('../models/User');

const socketManager = (io) => {
    io.on('connection', (socket) => {
        console.log('User Connected:', socket.id);
        let currentUserId = null;

        socket.on('join', async (userId) => {
            if (userId && mongoose.Types.ObjectId.isValid(userId)) {
                currentUserId = userId;
                socket.join(userId); // Join room named after userId
                
                try {
                    await User.findByIdAndUpdate(userId, { 
                        socketId: socket.id, 
                        isOnline: true 
                    });
                    console.log(`User joined room: ${userId}`);
                } catch (error) {
                    console.error('Error on join update:', error.message);
                }
            }
        });

        socket.on('updateLocation', async ({ lat, lng }) => {
            if (currentUserId) {
                try {
                    await User.findByIdAndUpdate(currentUserId, {
                        location: { type: 'Point', coordinates: [lng, lat] }
                    });
                    
                    // Broadcast to everyone for "nearby drivers" visualization
                    socket.broadcast.emit('driverLocationUpdated', {
                        driverId: currentUserId,
                        location: { lat, lng }
                    });
                } catch (error) {
                    console.error('Error updating location:', error.message);
                }
            }
        });

        socket.on('disconnect', async () => {
            console.log('User Disconnected:', socket.id);
            if (currentUserId) {
                try {
                    await User.findByIdAndUpdate(currentUserId, { 
                        isOnline: false, 
                        socketId: null 
                    });
                } catch (error) {
                    console.error('Error on disconnect update:', error.message);
                }
            }
        });
    });
};

module.exports = socketManager;
