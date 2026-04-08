const Ride = require('../models/Ride');
const User = require('../models/User');

const rideController = {
    requestRide: async (req, res) => {
        try {
            const io = req.app.get("io");
            const { pickup, destination, fare, passengers } = req.body;
            const passenger = req.user;

            console.log("Incoming request:", req.body);
            console.log("User:", passenger);

            // ✅ CREATE RIDE
            const requestedPassengers = passengers || 1;
            const ride = new Ride({
                passengerId: passenger._id,
                passenger: {
                    name: passenger.name,
                    phone: passenger.phone
                },
                pickup,
                destination,
                fare: fare || 0,
                passengers: requestedPassengers,
                status: "pending"
            });

            await ride.save();

            console.log("Ride created:", ride);

            // ✅ FIND ONLINE DRIVERS
            const drivers = await User.find({
                role: "driver",
                isOnline: true,
                availableSeats: { $gte: requestedPassengers }
            });

            console.log("Available drivers:", drivers.length);

                // ✅ SEND TO EACH DRIVER (IMPORTANT)
            drivers.forEach((driver) => {
                if (driver.socketId) {
                    console.log(`🚀 Emitting to driver ${driver.name} | Socket: ${driver.socketId}`);
                    io.to(driver.socketId).emit("new-ride", ride);
                } else if (driver._id) {
                    // Fallback to room if socketId is not set
                    console.log("🚀 Emitting to room:", driver._id.toString());
                    io.to(driver._id.toString()).emit("new-ride", ride);
                }
            });

            res.json({ success: true, ride });

        } catch (err) {
            console.error("REQUEST RIDE ERROR:", err);
            res.status(500).json({ msg: "Server error" });
        }
    },


    rejectRide: async (req, res) => {
        const io = req.app.get("io");
        const { rideId } = req.body;
        try {
            const ride = await Ride.findById(rideId);
            if (!ride) return res.status(404).json({ message: 'Ride not found' });

            ride.status = 'rejected';
            await ride.save();

            io.to(ride.passengerId.toString()).emit('rideRejected', { rideId: ride._id });

            res.status(200).json({ message: 'Ride rejected' });
        } catch (error) {
            console.error('Reject failed:', error);
            res.status(500).json({ message: 'Reject failed', error: error.message });
        }
    },

    startRide: async (req, res) => {
        const io = req.app.get("io");
        const { rideId } = req.body;
        try {
            const ride = await Ride.findById(rideId);
            if (!ride) return res.status(404).json({ message: 'Ride not found' });

            ride.status = 'ongoing';
            await ride.save();

            io.to(ride.passengerId.toString()).emit('rideStatusUpdated', { rideId: ride._id, status: 'ongoing' });

            res.status(200).json({ message: 'Ride started', ride });
        } catch (error) {
            console.error('Start trip error:', error);
            res.status(500).json({ message: 'Failed to start trip', error: error.message });
        }
    },

    updateRideStatus: async (req, res) => {
        const io = req.app.get("io");
        const { rideId, status } = req.body;
        try {
            const ride = await Ride.findById(rideId);
            if (!ride) return res.status(404).json({ message: 'Ride not found' });

            ride.status = status;
            await ride.save();

            if (status === 'completed') {
                const driver = await User.findById(ride.driverId);
                if (driver) {
                    driver.currentPassengers -= ride.passengers;
                    driver.availableSeats += ride.passengers;
                    if (driver.currentPassengers < 0) driver.currentPassengers = 0;
                    await driver.save();
                }
                io.to(ride.passengerId.toString()).emit('rideCompleted', { 
                    rideId: ride._id,
                    ride: ride
                });
            } else {
                io.to(ride.passengerId.toString()).emit('rideStatusUpdated', { rideId: ride._id, status });
            }

            res.status(200).json({ message: `Ride status updated to ${status}` });
        } catch (error) {
            res.status(500).json({ message: 'Error updating ride status', error: error.message });
        }
    },

    getNearbyDrivers: async (req, res) => {
        try {
            const drivers = await User.find({
                role: "driver",
                isOnline: true,
                availableSeats: { $gt: 0 }
            });

            res.json(drivers);
        } catch (error) {
            console.error("NEARBY ERROR:", error);
            res.status(500).json({ msg: "Error fetching drivers" });
        }
    },
    
    
    goOnline: async (req, res) => {
        try {
            const { location, destination, availableSeats } = req.body;

            await User.findByIdAndUpdate(req.user.id, {
                isOnline: true,
                location: {
                    type: "Point",
                    coordinates: [location.lng, location.lat]
                },
                destination: destination
                    ? {
                        type: "Point",
                        coordinates: [destination.lng, destination.lat]
                      }
                    : undefined,
                availableSeats: availableSeats || 4
            }, { returnDocument: "after" });

            res.json({ success: true });

        } catch (error) {
            console.error("ONLINE ERROR:", error);
            res.status(500).json({ msg: "Failed to go online" });
        }
    },

    goOffline: async (req, res) => {
        const driverId = req.user.id;

        try {
            await User.findByIdAndUpdate(driverId, { isOnline: false });
            res.status(200).json({ message: 'You are now offline' });
        } catch (error) {
            res.status(500).json({ message: 'Failed to go offline', error: error.message });
        }
    }
};

module.exports = rideController;
