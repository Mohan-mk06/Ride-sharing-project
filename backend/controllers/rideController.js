const Ride = require('../models/Ride');
const User = require('../models/User');

const rideController = {
    requestRide: async (req, res, io) => {
        const { pickup, destination, fare } = req.body;
        const passengerId = req.user.id;

        try {
            // Find nearby online drivers within 5km with available seats
            const nearbyDrivers = await User.find({
                role: 'driver',
                isOnline: true,
                availableSeats: { $gt: 0 },
                location: {
                    $near: {
                        $geometry: { type: 'Point', coordinates: [pickup.lng, pickup.lat] },
                        $maxDistance: 5000 // 5km radius for MVP
                    }
                }
            });

            // Filter drivers by direction (Destination similarity)
            const getDistance = (c1, c2) => {
                if (!c1 || !c2) return 999;
                const dx = c1[0] - c2[0];
                const dy = c1[1] - c2[1];
                return Math.sqrt(dx * dx + dy * dy);
            };

            const filteredDrivers = nearbyDrivers.filter(driver => {
                if (!driver.destination || !driver.destination.coordinates) return false;
                const dist = getDistance(driver.destination.coordinates, [destination.lng, destination.lat]);
                return dist < 0.03; // Approx 3km tolerance
            });

            if (filteredDrivers.length === 0) {
                return res.status(404).json({ message: 'No drivers heading in your direction found' });
            }

            const ride = new Ride({
                passengerId,
                pickup: { type: 'Point', coordinates: [pickup.lng, pickup.lat] },
                destination: { type: 'Point', coordinates: [destination.lng, destination.lat] },
                fare,
                status: 'pending'
            });

            await ride.save();

            // Emit to each filtered driver room
            filteredDrivers.forEach(driver => {
                io.to(driver._id.toString()).emit('newRideRequest', {
                    rideId: ride._id,
                    passenger: { id: passengerId, name: req.user.name },
                    pickup,
                    destination,
                    fare
                });
            });

            res.status(201).json({ message: 'Ride request sent', rideId: ride._id });
        } catch (error) {
            console.error('Ride request error:', error);
            res.status(500).json({ message: 'Ride request failed', error: error.message });
        }
    },

    acceptRide: async (req, res, io) => {
        const { rideId } = req.body;
        const driverId = req.user.id;

        try {
            const ride = await Ride.findById(rideId);
            if (!ride || ride.status !== 'pending') {
                return res.status(400).json({ message: 'Ride is no longer available' });
            }

            const driver = await User.findById(driverId);
            if (driver.availableSeats <= 0) {
                return res.status(400).json({ message: 'No more seats available' });
            }

            ride.driverId = driverId;
            ride.status = 'accepted';
            await ride.save();

            // Decrement driver seats
            driver.availableSeats -= 1;
            // Driver stays online but seats reduced
            await driver.save();

            // Notify passenger room
            io.to(ride.passengerId.toString()).emit('rideAccepted', {
                rideId: ride._id,
                status: 'accepted',
                driver: { 
                    id: driverId, 
                    name: req.user.name, 
                    location: driver.location,
                    destination: driver.destination 
                },
                pickup: ride.pickup,
                destination: ride.destination,
                fare: ride.fare
            });

            res.status(200).json({ message: 'Ride accepted', ride });
        } catch (error) {
            res.status(500).json({ message: 'Error accepting ride', error: error.message });
        }
    },

    rejectRide: async (req, res, io) => {
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

    startRide: async (req, res, io) => {
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

    updateRideStatus: async (req, res, io) => {
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
        const { lat, lng } = req.query;
        try {
            let query = { role: 'driver', isOnline: true, availableSeats: { $gt: 0 } };
            
            if (lat && lng) {
                query.location = {
                    $near: {
                        $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
                        $maxDistance: 5000 // 5km radius
                    }
                };
            }

            const drivers = await User.find(query).limit(10);
            res.status(200).json(drivers);
        } catch (error) {
            res.status(500).json({ message: 'Error fetching nearby drivers', error: error.message });
        }
    },
    
    completeRide: async (req, res, io) => {
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
    
    goOnline: async (req, res, io) => {
        const { location, destination, availableSeats } = req.body;
        const driverId = req.user.id;

        try {
            await User.findByIdAndUpdate(driverId, {
                isOnline: true,
                location: { type: 'Point', coordinates: [location.lng, location.lat] },
                destination: destination ? { type: 'Point', coordinates: [destination.lng, destination.lat] } : undefined,
                availableSeats: availableSeats || 4
            });

            res.status(200).json({ message: 'You are now online' });
        } catch (error) {
            res.status(500).json({ message: 'Failed to go online', error: error.message });
        }
    },

    goOffline: async (req, res, io) => {
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
