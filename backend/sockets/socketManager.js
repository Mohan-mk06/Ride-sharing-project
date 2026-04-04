const mongoose = require('mongoose');
const User = require('../models/User');

const socketManager = (io) => {
    io.on('connection', (socket) => {
        console.log('✅ Connected:', socket.id);
        let currentUserId = null;

        socket.on('register', async (data) => {
            const userId = typeof data === 'object' ? data.userId : data;
            
            if (userId && mongoose.Types.ObjectId.isValid(userId)) {
                currentUserId = userId;
                socket.join(userId); // Keep for backwards compatibility
                
                try {
                    const user = await User.findByIdAndUpdate(userId, {
                        socketId: socket.id,
                        isOnline: true
                    }, { returnDocument: "after" });
                    
                    if (user) {
                        console.log(`🔥 Registered user: ${user.name} | Socket: ${socket.id} | Online: ${user.isOnline}`);
                    }
                } catch (error) {
                    console.error('Error on register update:', error.message);
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
