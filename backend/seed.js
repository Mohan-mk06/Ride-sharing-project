const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');

dotenv.config();

const seedData = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gomoto');
        console.log('MongoDB connected for seeding...');

        // Clear existing test users if any
        await User.deleteMany({ email: { $in: ['driver@test.com', 'passenger@test.com'] } });

        const driver = new User({
            name: 'Test Driver',
            email: 'driver@test.com',
            password: 'password123',
            role: 'driver',
            isOnline: true,
            availableSeats: 4,
            location: { type: 'Point', coordinates: [77.5946, 12.9716] }, // Bangalore
            destination: { type: 'Point', coordinates: [77.6412, 12.9279] } // HSR Layout
        });

        const passenger = new User({
            name: 'Test Passenger',
            email: 'passenger@test.com',
            password: 'password123',
            role: 'passenger',
            location: { type: 'Point', coordinates: [77.6000, 12.9700] } // Near driver
        });

        await driver.save();
        await passenger.save();

        console.log('Seed data inserted successfully!');
        console.log('Driver: driver@test.com | Password: password123');
        console.log('Passenger: passenger@test.com | Password: password123');

        process.exit();
    } catch (err) {
        console.error('Seeding failed:', err.message);
        process.exit(1);
    }
};

seedData();
