const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/online', authMiddleware, (req, res) => {
    const io = req.app.get('io');
    rideController.goOnline(req, res, io);
});

router.post('/offline', authMiddleware, (req, res) => {
    const io = req.app.get('io');
    rideController.goOffline(req, res, io);
});

module.exports = router;
