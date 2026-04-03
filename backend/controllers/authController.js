const User = require('../models/User');
const jwt = require('jsonwebtoken');

const authController = {
    register: async (req, res) => {
        try {
            const { name, email, password, role } = req.body;
            const existingUser = await User.findOne({ email });
            if (existingUser) return res.status(400).json({ message: 'User already exists' });

            const user = new User({ name, email, password, role });
            await user.save();

            const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
            res.status(201).json({ token, user: { id: user._id, name: user.name, role: user.role } });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ message: 'Registration failed', error: error.message });
        }
    },

    login: async (req, res) => {
        try {
            const { email, password } = req.body;
            const user = await User.findOne({ email });
            if (!user || !(await user.comparePassword(password))) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
            res.status(200).json({ token, user: { id: user._id, name: user.name, role: user.role } });
        } catch (error) {
            res.status(500).json({ message: 'Login failed', error: error.message });
        }
    },

    getProfile: async (req, res) => {
        res.status(200).json(req.user);
    }
};

module.exports = authController;
