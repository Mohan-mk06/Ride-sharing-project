const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/request', authMiddleware, (req, res) => {
    const io = req.app.get('io');
    rideController.requestRide(req, res, io);
});

router.post('/accept', authMiddleware, (req, res) => {
    const io = req.app.get('io');
    rideController.acceptRide(req, res, io);
});

router.post('/start', authMiddleware, (req, res) => {
    const io = req.app.get('io');
    rideController.startRide(req, res, io);
});

router.post('/reject', authMiddleware, (req, res) => {
    const io = req.app.get('io');
    rideController.rejectRide(req, res, io);
});

router.post('/complete', authMiddleware, (req, res) => {
    const io = req.app.get('io');
    rideController.completeRide(req, res, io);
});

router.get('/drivers', authMiddleware, (req, res) => {
    rideController.getNearbyDrivers(req, res);
});

router.get('/nearby', authMiddleware, (req, res) => {
    rideController.getNearbyDrivers(req, res);
});

module.exports = router;
