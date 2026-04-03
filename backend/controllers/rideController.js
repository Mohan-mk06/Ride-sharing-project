const Ride = require('../models/Ride');
const User = require('../models/User');

const rideController = {
    requestRide: async (req, res) => {
        try {
            const io = req.app.get("io");
            const { pickup, destination, fare } = req.body;
            const passenger = req.user;

            console.log("Incoming request:", req.body);
            console.log("User:", passenger);

            // ✅ CREATE RIDE
            const ride = new Ride({
                passengerId: passenger._id,
                passenger: {
                    name: passenger.name,
                    phone: passenger.phone
                },
                pickup,
                destination,
                fare: fare || 0,
                status: "pending"
            });

            await ride.save();

            console.log("Ride created:", ride);

            // ✅ FIND ONLINE DRIVERS
            const drivers = await User.find({
                role: "driver",
                isOnline: true
            });

            console.log("Available drivers:", drivers.length);

            // ✅ SEND TO EACH DRIVER (IMPORTANT)
            drivers.forEach((driver) => {
                if (driver._id) {
                    console.log("Sending to driver:", driver._id.toString());
                    io.to(driver._id.toString()).emit("newRideRequest", ride);
                }
            });

            res.json({ success: true, ride });

        } catch (err) {
            console.error("REQUEST RIDE ERROR:", err);
            res.status(500).json({ msg: "Server error" });
        }
    },

    acceptRide: async (req, res) => {
        try {
            const io = req.app.get("io");
            const { rideId } = req.body;
            console.log("Incoming rideId:", rideId);

            if (!rideId) {
                return res.status(400).json({ msg: "Ride ID required" });
            }

            const ride = await Ride.findById(rideId);

            if (!ride) {
                return res.status(404).json({ msg: "Ride not found" });
            }

            if (ride.status !== "pending") {
                return res.status(400).json({ msg: "Ride already handled" });
            }

            const driver = await User.findById(req.user.id);
            if (!driver || driver.availableSeats <= 0) {
                return res.status(400).json({ msg: "No more seats or driver not found" });
            }

            // ✅ Attach full driver info
            ride.driver = {
                id: driver._id,
                name: driver.name,
                phone: driver.phone
            };
            ride.driverId = driver._id;
            ride.status = "accepted";

            // Decrement driver seats
            driver.availableSeats -= 1;
            await driver.save();
            await ride.save();

            console.log("Ride accepted:", ride);

            // Notify passenger
            io.to(ride.passengerId.toString()).emit("rideAccepted", {
                driver: ride.driver,
                ride
            });

            res.json({ success: true, ride });

        } catch (err) {
            console.error("❌ ACCEPT RIDE ERROR:", err);
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
                    driver.availableSeats += 1;
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
    
    completeRide: async (req, res) => {
        const io = req.app.get("io");
        const { rideId } = req.body;
        const driverId = req.user.id;
        try {
            const ride = await Ride.findById(rideId);
            if (!ride) return res.status(404).json({ message: 'Ride not found' });
            
            ride.status = 'completed';
            await ride.save();

            // Reset driver
            const driver = await User.findById(driverId);
            driver.availableSeats += 1;
            // Trip complete, but driver stays online
            await driver.save();

            io.to(ride.passengerId.toString()).emit('rideCompleted', { rideId: ride._id });

            res.status(200).json({ message: 'Ride completed successfully', ride });
        } catch (error) {
            res.status(500).json({ message: 'Error completing ride', error: error.message });
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
            });

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
