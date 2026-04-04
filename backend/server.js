const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const driverRoutes = require('./routes/driverRoutes');
const socketManager = require('./sockets/socketManager');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*' }
});

// Middleware
app.use(cors());
app.use(express.json());
app.set('io', io); // Make io available in routes

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/driver', driverRoutes);

// Socket.io
socketManager(io);

// MongoDB
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gomoto';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('MongoDB Connected');
        // Reset ghost drivers to offline on startup
        try {
            const User = require('./models/User');
            await User.updateMany({ role: "driver" }, { isOnline: false, socketId: null });
        } catch(e) {
            console.error('Failed to reset drivers online status:', e);
        }
        server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch(err => console.error('MongoDB Connection Error:', err.message));
