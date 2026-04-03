import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import './index.css';

const App = () => {
    const [user, setUser] = useState(null);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        if (storedUser) setUser(JSON.parse(storedUser));
    }, []);

    return (
        <Router>
            <Routes>
                <Route 
                    path="/" 
                    element={user ? <Navigate to="/dashboard" /> : <Home setUser={setUser} />} 
                />
                <Route 
                    path="/login" 
                    element={<Navigate to="/" />} 
                />
                <Route 
                    path="/dashboard" 
                    element={user ? <Dashboard user={user} setUser={setUser} /> : <Navigate to="/" />} 
                />
                <Route 
                    path="*" 
                    element={<Navigate to="/" />} 
                />
            </Routes>
        </Router>
    );
};

export default App;
