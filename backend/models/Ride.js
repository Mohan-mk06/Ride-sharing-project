const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
    passengerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    passenger: {
        name: { type: String, required: true },
        phone: { type: String, required: true }
    },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    driver: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String },
        phone: { type: String }
    },
    pickup: { type: [Number], required: true },
    destination: { type: [Number], required: true },
    fare: { type: Number, default: 0 },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'ongoing', 'completed', 'rejected', 'cancelled'],
        default: 'pending'
    }
}, { timestamps: true });


module.exports = mongoose.model('Ride', rideSchema);
