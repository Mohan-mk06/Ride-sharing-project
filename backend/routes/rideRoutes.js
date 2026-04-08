const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/request', authMiddleware, rideController.requestRide);
router.post('/start', authMiddleware, rideController.startRide);
router.post('/reject', authMiddleware, rideController.rejectRide);
router.get('/drivers', authMiddleware, rideController.getNearbyDrivers);
router.get('/nearby', authMiddleware, rideController.getNearbyDrivers);

module.exports = router;
