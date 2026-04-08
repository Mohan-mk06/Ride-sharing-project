const mongoose = require('mongoose');
const User = require('../models/User');
const Ride = require('../models/Ride');

const socketManager = (io) => {
    io.on('connection', (socket) => {
        console.log('✅ Connected:', socket.id);
        let currentUserId = null;

        // Helper to emit to a user's consistent room
        const emitToUser = (userId, event, data) => {
            if (userId) {
                const room = userId.toString();
                console.log(`📡 [${new Date().toLocaleTimeString()}] Emitting ${event} to room: ${room}`);
                io.to(room).emit(event, data);
            }
        };

        socket.on('register', async (data) => {
            const userId = typeof data === 'object' ? data.userId : data;
            const availableSeats = typeof data === 'object' ? data.availableSeats : null;

            if (userId && mongoose.Types.ObjectId.isValid(userId)) {
                // Prevent multiple room joins for the same user on this socket
                if (currentUserId !== userId.toString()) {
                    currentUserId = userId.toString();
                    socket.join(currentUserId);
                    console.log(`👤 User joining room: ${currentUserId}`);
                }
                
                try {
                    const updateData = {
                        socketId: socket.id,
                        isOnline: true
                    };
                    
                    if (availableSeats !== null) {
                        updateData.availableSeats = availableSeats;
                    }

                    const user = await User.findByIdAndUpdate(userId, updateData, { new: true });
                    
                    if (user) {
                        console.log(`🔥 Registered: ${user.name} | Online: ${user.isOnline} | Seats: ${user.availableSeats}`);
                    }
                } catch (error) {
                    console.error('Error on register update:', error.message);
                }
            }
        });

        socket.on('recover-state', async (callback) => {
            if (!currentUserId) return callback({ status: 'error', message: 'Not registered' });
            
            try {
                // Find any active ride for this user (as passenger or driver)
                const activeRide = await Ride.findOne({
                    $or: [{ passengerId: currentUserId }, { driverId: currentUserId }],
                    status: { $in: ['pending', 'accepted', 'ongoing'] }
                }).populate('driverId passengerId');

                if (activeRide) {
                    callback({ status: 'success', ride: activeRide });
                } else {
                    callback({ status: 'success', ride: null });
                }
            } catch (err) {
                callback({ status: 'error', message: err.message });
            }
        });

        socket.on('updateLocation', async ({ lat, lng }) => {
            if (currentUserId) {
                try {
                    await User.findByIdAndUpdate(currentUserId, {
                        location: { type: 'Point', coordinates: [lng, lat] }
                    });
                    
                    socket.broadcast.emit('driverLocationUpdated', {
                        driverId: currentUserId,
                        location: { lat, lng }
                    });
                } catch (error) {
                    console.error('Error updating location:', error.message);
                }
            }
        });

        // 🔥 LIVE DRIVER TRACKING (SIMULATION)
        socket.on("driverLocationUpdate", ({ passengerId, coords }) => {
            console.log(`📡 [Simulation] Forwarding location to passenger ${passengerId}`);
            if (passengerId) {
                const room = passengerId.toString();
                io.to(room).emit("driverLocationUpdate", { coords });
            }
        });

        socket.on("acceptRide", async ({ rideId, driverId }, callback) => {
            console.log(`🚖 [${new Date().toLocaleTimeString()}] Accept request: Ride ${rideId} by Driver ${driverId}`);
            try {
                // 1. Validation & Idempotency
                const ride = await Ride.findById(rideId);
                if (!ride) {
                    if (callback) callback({ status: 'error', message: 'Ride not found' });
                    return socket.emit("ride-error", "Ride not found");
                }
                
                // Prevent duplicate acceptance
                if (ride.status !== "pending") {
                    console.log(`⚠️ Ride ${rideId} already processed (Status: ${ride.status})`);
                    if (callback) callback({ status: 'error', message: 'Ride already taken or processed' });
                    return socket.emit("ride-error", "Ride already taken or processed");
                }
                
                // Re-fetch driver to get the latest availableSeats from DB
                const driver = await User.findById(driverId);
                if (!driver) {
                    if (callback) callback({ status: 'error', message: 'Driver not found' });
                    return socket.emit("ride-error", "Driver not found");
                }
                
                const availableSeats = driver.availableSeats;
                if (availableSeats < ride.passengers) {
                    console.log(`⚠️ Driver ${driver.name} has insufficient seats: ${availableSeats} < ${ride.passengers}`);
                    if (callback) callback({ status: 'error', message: 'Not enough seats' });
                    return socket.emit("ride-error", "Not enough seats available");
                }
                
                // 2. Atomic Updates
                // Re-check status inside the update block if possible (using findOneAndUpdate with status filter)
                const updatedRide = await Ride.findOneAndUpdate(
                    { _id: rideId, status: "pending" },
                    { 
                        driverId: driverId,
                        driver: {
                            id: driver._id,
                            name: driver.name,
                            phone: driver.phone,
                            location: driver.location
                        },
                        status: "accepted"
                    },
                    { returnDocument: 'after' } // 🔥 FIXED DEPRECATION
                );

                if (!updatedRide) {
                    console.log(`⚠️ Ride ${rideId} was accepted by another driver concurrently`);
                    if (callback) callback({ status: 'error', message: 'Ride already taken' });
                    return socket.emit("ride-error", "Ride already taken");
                }
                
                // Update driver capacity
                driver.currentPassengers += ride.passengers;
                driver.availableSeats -= ride.passengers; 
                await driver.save();
                
                // 3. Notifications (Room-based)
                const payload = {
                    ride: updatedRide,
                    driver: {
                        _id: driver._id,
                        id: driver._id, // Keep both for safety
                        name: driver.name,
                        phone: driver.phone,
                        location: driver.location
                    }
                };

                // 4. Send to passenger room
                emitToUser(ride.passengerId, "rideAccepted", payload);
                
                // 5. 🔥 SEND BACK TO DRIVER (CRITICAL FIX)
                socket.emit("rideAccepted", {
                    rideId: updatedRide._id,
                    ride: updatedRide,
                    driver: payload.driver
                });
                
                // ACK back to driver callback
                if (callback) callback({ status: 'success', ride: updatedRide });

                console.log("✅ Ride accepted and emitted to both sides");
            } catch (err) {
                console.error("❌ Accept error:", err);
                if (callback) callback({ status: 'error', message: 'Server error' });
                socket.emit("rideError", "Failed to accept ride");
            }
        });

        socket.on("rejectRide", async ({ rideId }, callback) => {
            console.log(`❌ [${new Date().toLocaleTimeString()}] Reject request: Ride ${rideId}`);
            try {
                const ride = await Ride.findById(rideId);
                if (!ride) {
                    if (callback) callback({ status: 'error', message: 'Ride not found' });
                    return;
                }

                if (ride.status === 'pending') {
                    ride.status = 'rejected';
                    await ride.save();
                }

                emitToUser(ride.passengerId, "rideRejected", { rideId: ride._id });

                if (callback) callback({ status: 'success' });
                console.log(`✅ [${new Date().toLocaleTimeString()}] Ride ${rideId} rejected`);
            } catch (err) {
                console.error("reject-ride error:", err);
                if (callback) callback({ status: 'error', message: 'Server error' });
            }
        });

        socket.on("completeRide", async ({ rideId }, callback) => {
            console.log(`🏁 [${new Date().toLocaleTimeString()}] Complete request: Ride ${rideId}`);
            try {
                const ride = await Ride.findById(rideId);
                if (!ride) return;
                
                if (ride.status === 'completed') {
                    if (callback) callback({ status: 'success', message: 'Already completed' });
                    return;
                }

                const driver = await User.findById(ride.driverId);
                if (driver) {
                    driver.currentPassengers -= ride.passengers;
                    driver.availableSeats += ride.passengers;
                    if (driver.currentPassengers < 0) driver.currentPassengers = 0;
                    await driver.save();
                    
                    // 🔥 CRITICAL: Ensure driver is marked online and available for next ride
                    await User.findByIdAndUpdate(ride.driverId, {
                        isOnline: true,
                        currentPassengers: 0
                    });
                }
                
                ride.status = "completed";
                await ride.save();

                emitToUser(ride.passengerId, "rideCompleted", { rideId: ride._id, ride });
                
                if (callback) callback({ status: 'success' });
                console.log(`✅ Ride ${rideId} completed`);
            } catch (err) {
                console.error("completeRide error:", err);
                if (callback) callback({ status: 'error', message: 'Server error' });
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
