const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/online', authMiddleware, rideController.goOnline);
router.post('/offline', authMiddleware, rideController.goOffline);

module.exports = router;
