import React, { useState } from 'react';
import API from '../services/api';
import { useNavigate } from 'react-router-dom';
import { LogIn, UserPlus, Mail, Lock, User as UserIcon, ArrowRight, ShieldCheck, Map as MapIcon, Zap } from 'lucide-react';

const Home = ({ setUser }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [formData, setFormData] = useState({
        name: '', email: '', password: '', role: 'passenger', phone: ''
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const endpoint = isLogin ? '/auth/login' : '/auth/register';
            const { data } = await API.post(endpoint, formData);
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            setUser(data.user);
            navigate('/dashboard');
        } catch (err) {
            setError(err.response?.data?.message || 'Authentication failed. Please check your credentials.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header" style={{ textAlign: 'center' }}>
                    <h1>GoMoto</h1>
                    <p>{isLogin ? 'Welcome back! Ready for a ride?' : 'Join the GoMoto community today'}</p>
                </div>

                {error && (
                    <div className="error-message">
                        <ShieldCheck size={16} />
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="auth-form">
                    {!isLogin && (
                        <>
                            <div className="form-group">
                                <label>Full Name</label>
                                <div style={{ position: 'relative' }}>
                                    <UserIcon size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                    <input 
                                        type="text" 
                                        placeholder="Enter your name" 
                                        style={{ paddingLeft: '44px' }}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })} 
                                        required 
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Phone Number</label>
                                <div style={{ position: 'relative' }}>
                                    <Zap size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                    <input 
                                        type="text" 
                                        placeholder="+91 98765 43210" 
                                        style={{ paddingLeft: '44px' }}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })} 
                                        required 
                                    />
                                </div>
                            </div>
                        </>
                    )}
                    <div className="form-group">
                        <label>Email Address</label>
                        <div style={{ position: 'relative' }}>
                            <Mail size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input 
                                type="email" 
                                placeholder="name@example.com" 
                                style={{ paddingLeft: '44px' }}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })} 
                                required 
                            />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Password</label>
                        <div style={{ position: 'relative' }}>
                            <Lock size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input 
                                type="password" 
                                placeholder="••••••••" 
                                style={{ paddingLeft: '44px' }}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })} 
                                required 
                            />
                        </div>
                    </div>
                    {!isLogin && (
                        <div className="form-group">
                            <label>I want to be a...</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, role: 'passenger' })}
                                    style={{
                                        padding: '12px',
                                        borderRadius: '12px',
                                        border: formData.role === 'passenger' ? '2px solid #2563eb' : '1.5px solid #e2e8f0',
                                        background: formData.role === 'passenger' ? '#eff6ff' : 'white',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    Passenger
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, role: 'driver' })}
                                    style={{
                                        padding: '12px',
                                        borderRadius: '12px',
                                        border: formData.role === 'driver' ? '2px solid #2563eb' : '1.5px solid #e2e8f0',
                                        background: formData.role === 'driver' ? '#eff6ff' : 'white',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    Driver
                                </button>
                            </div>
                        </div>
                    )}

                    <button type="submit" className="primary-button" disabled={loading} style={{ marginTop: '12px' }}>
                        {loading ? 'Processing...' : (isLogin ? <><LogIn size={18} /> Sign In</> : <><UserPlus size={18} /> Create Account</>)}
                        {!loading && <ArrowRight size={18} />}
                    </button>
                </form>

                <div className="auth-footer">
                    <button onClick={() => { setIsLogin(!isLogin); setError(''); }}>
                        {isLogin ? "New to GoMoto? Create an account" : "Already have an account? Sign in"}
                    </button>
                </div>

                <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'center', gap: '20px', opacity: 0.6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700 }}>
                        <Zap size={14} color="#10b981" /> REAL-TIME
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700 }}>
                        <MapIcon size={14} color="#2563eb" /> INTERACTIVE
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Home;
