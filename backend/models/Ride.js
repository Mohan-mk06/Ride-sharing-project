const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
    passengerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    pickup: {
        type: { type: String, default: 'Point' },
        coordinates: { type: [Number], required: true }
    },
    destination: {
        type: { type: String, default: 'Point' },
        coordinates: { type: [Number], required: true }
    },
    fare: { type: Number, required: true },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'ongoing', 'completed', 'cancelled'],
        default: 'pending'
    }
}, { timestamps: true });

rideSchema.index({ pickup: '2dsphere' });
rideSchema.index({ destination: '2dsphere' });

module.exports = mongoose.model('Ride', rideSchema);
