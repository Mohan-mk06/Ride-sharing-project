import React, { useState, useEffect, useCallback } from 'react';
import Map from '../components/Map';
import API from '../services/api';
import { getSocket, subscribeToEvent, emitEvent, disconnectSocket } from '../services/socket';
import { LogOut, ToggleLeft, ToggleRight, MapPin, Navigation, User, CheckCircle, XCircle, Loader, Navigation2, Users, Phone, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Dashboard = ({ user, setUser }) => {
    const [isOnline, setIsOnline] = useState(user?.isOnline || false);
    const [nearbyDrivers, setNearbyDrivers] = useState([]);
    const [activeRide, setActiveRide] = useState(null);
    const [mode, setMode] = useState('pickup'); // 'pickup' or 'destination'
    const [pickup, setPickup] = useState(null);
    const [destination, setDestination] = useState(null);
    const [driverDestination, setDriverDestination] = useState(null);
    const [passengers, setPassengers] = useState(1);
    
    // Mandated States
    const [searching, setSearching] = useState(false);
    const [rideStatus, setRideStatus] = useState('idle');
    const [driverInfo, setDriverInfo] = useState(null);
    
    const [status, setStatus] = useState('idle'); // Backwards compatibility if needed
    const [seats, setSeats] = useState(4);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    // 1. Socket Registration
    useEffect(() => {
        const userId = user?._id || user?.id;
        if (!userId) return;

        const socket = getSocket();
        
        const registrationData = user.role === 'driver' 
            ? { userId, availableSeats: seats } 
            : userId;

        console.log("📡 Registering socket:", registrationData);
        socket.emit("register", registrationData);
        
        const handleConnect = () => {
            console.log("📡 Re-registering socket on reconnect:", registrationData);
            socket.emit("register", registrationData);
        };
        
        socket.on("connect", handleConnect);
        
        return () => {
            socket.off("connect", handleConnect);
        };
    }, [user?._id, user?.id, user?.role, seats]); 

    // 2. Initial Setup & Subscriptions
    useEffect(() => {
        if (!user) return;
        const socket = getSocket();

        const fetchInitialDrivers = async (coords) => {
            try {
                const endpoint = coords ? `/rides/nearby?lat=${coords[1]}&lng=${coords[0]}` : '/rides/drivers';
                const { data } = await API.get(endpoint);
                setNearbyDrivers(data);
            } catch (err) {
                console.error('Failed to fetch initial drivers', err);
            }
        };

        // Subscriptions
        const unsubRequest = subscribeToEvent('new-ride', (data) => {
            console.log("🔥 [Socket] RECEIVED RIDE:", data);
            setActiveRide(data);
            setRideStatus('pending_request');
            setStatus('pending_request');
        });
        

        const unsubRejected = subscribeToEvent('rideRejected', () => {
            console.log("❌ [Socket] Ride rejected");
            alert('Your ride request was rejected. Please try again.');
            setActiveRide(null);
            setSearching(false);
            setLoading(false);
            setRideStatus('idle');
            setStatus('idle');
        });

        const unsubCompleted = subscribeToEvent('rideCompleted', (data) => {
            console.log("✅ [Socket] Ride completed:", data);
            setLoading(false);
            setActiveRide(prev => ({ ...prev, ...(data.ride || {}), status: 'completed' }));
            setRideStatus('completed_summary');
            setStatus('completed_summary');
            setSearching(false);
        });

        const unsubStatus = subscribeToEvent('rideStatusUpdated', (data) => {
            console.log("📡 [Socket] Ride status updated:", data.status);
            setRideStatus(data.status);
            setStatus(data.status);
            setActiveRide(prev => ({ ...prev, status: data.status }));
        });

        const unsubLocUpdate = subscribeToEvent('driverLocationUpdated', (data) => {
            setNearbyDrivers(prev => {
                const existing = prev.find(d => d._id === data.driverId);
                if (existing) {
                    return prev.map(d => d._id === data.driverId 
                        ? { ...d, location: { ...d.location, coordinates: [data.location.lng, data.location.lat] } }
                        : d
                    );
                }
                return [...prev, { _id: data.driverId, location: { type: 'Point', coordinates: [data.location.lng, data.location.lat] } }];
            });
            
            if (activeRide?.driver?.id === data.driverId || activeRide?.driver?._id === data.driverId) {
                setActiveRide(prev => ({
                    ...prev,
                    driver: { 
                        ...prev.driver, 
                        location: { type: 'Point', coordinates: [data.location.lng, data.location.lat] } 
                    }
                }));
            }
        });

        const unsubError = subscribeToEvent('ride-error', (msg) => {
            console.error("⚠️ [Socket Error]:", msg);
            alert(msg);
            setLoading(false);
        });

        // Get location and then fetch drivers
        navigator.geolocation.getCurrentPosition((pos) => {
            const coords = [pos.coords.longitude, pos.coords.latitude];
            setPickup(coords);
            fetchInitialDrivers(coords);
        }, () => fetchInitialDrivers(null));

        return () => {
            unsubRequest();
            unsubRejected();
            unsubCompleted();
            unsubStatus();
            unsubLocUpdate();
            unsubError();
        };
    }, [user, activeRide?.driver?.id, activeRide?.driver?._id]);

    // 2.3 Ride Accepted Listener (Dedicated)
    useEffect(() => {
        const socket = getSocket();
        const handleRideAccepted = (data) => {
            console.log("✅ ride-accepted RECEIVED:", data);
            setSearching(false);
            setLoading(false);
            setRideStatus('accepted');
            setStatus('accepted');
            setDriverInfo(data.driver);
            setActiveRide(data.ride);
        };

        socket.on("ride-accepted", handleRideAccepted);
        return () => {
            socket.off("ride-accepted", handleRideAccepted);
        };
    }, []); 

    // 2.5 Reliability Fallback
    useEffect(() => {
        if (searching && !driverInfo) {
            const timeout = setTimeout(() => {
                const socket = getSocket();
                socket.emit("recover-state", (res) => {
                    if (res.status === 'success' && res.ride?.driver) {
                        console.log("🔄 [Fallback] Recovered driver info");
                        setDriverInfo(res.ride.driver);
                        setActiveRide(res.ride);
                        setRideStatus('accepted');
                        setSearching(false);
                    }
                });
            }, 2500);
            return () => clearTimeout(timeout);
        }
    }, [searching, driverInfo]);

    // 2. Driver Location Tracking
    useEffect(() => {
        let watchId;
        if (user?.role === 'driver' && isOnline) {
            watchId = navigator.geolocation.watchPosition((pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                emitEvent('updateLocation', { lat, lng });
            }, (err) => console.error(err), { enableHighAccuracy: true });
        }
        return () => {
            if (watchId) navigator.geolocation.clearWatch(watchId);
        };
    }, [user?.role, isOnline]);


    const calculateFare = (p1, p2) => {
        if (!p1 || !p2) return 0;
        const R = 6371;
        const dLat = (p2[1] - p1[1]) * Math.PI / 180;
        const dLng = (p2[0] - p1[0]) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceKm = R * c;
        // Base fare ₹30 + ₹15 per km, minimum ₹50
        const fare = Math.round(30 + distanceKm * 15);
        return Math.max(50, fare);
    };

    const handleMapClick = useCallback((coords) => {
        if (rideStatus !== 'idle' && rideStatus !== 'pending_request') return;
        
        if (user?.role === 'passenger') {
            if (mode === 'pickup') {
                setPickup(coords);
                setMode('destination');
            } else if (mode === 'destination') {
                setDestination(coords);
            }
        }

        if (user?.role === 'driver') {
            setDriverDestination(coords);
        }
    }, [mode, rideStatus, user?.role]);

    const handleRequestRide = async () => {
        if (!pickup || !destination) return;
        const fare = calculateFare(pickup, destination);
        
        setSearching(true);
        setRideStatus('searching');
        setStatus('searching');

        console.log("Sending:", pickup, destination);
        try {
            const res = await API.post('/rides/request', {
                pickup,
                destination,
                fare,
                passengers
            });
            setActiveRide(res.data.ride);
        } catch (err) {
            console.error("Ride request failed:", err);
            alert(err.response?.data?.message || err.response?.data?.msg || 'Request failed');
            setSearching(false);
            setRideStatus('idle');
            setStatus('idle');
        }
    };

    const handleGoOnline = async () => {
        if (!isOnline && (!pickup || !driverDestination)) return alert('Set current location (pickup) and destination first');
        
        try {
            if (!isOnline) {
                await API.post('/driver/online', {
                    location: { lng: pickup[0], lat: pickup[1] },
                    destination: { lng: driverDestination[0], lat: driverDestination[1] },
                    availableSeats: seats
                });
                setIsOnline(true);
                emitEvent('updateLocation', { lat: pickup[1], lng: pickup[0] });
            } else {
                await API.post('/driver/offline');
                setIsOnline(false);
            }
        } catch (err) {
            alert('Action failed');
        }
    };

    const handleStartTrip = async () => {
        const rideId = activeRide?.rideId || activeRide?._id;
        if (!rideId) {
            alert('Ride ID not found');
            return;
        }
        try {
            await API.post('/rides/start', { rideId });
            setRideStatus('ongoing');
            setStatus('ongoing');
        } catch (err) {
            console.error('Start trip error:', err.response?.data || err.message);
            alert('Failed to start trip');
        }
    };

    const handleAcceptRide = () => {
        const rideId = activeRide?._id || activeRide?.ride?._id || activeRide?.rideId;
        const driverId = user?._id || user?.id;

        if (!rideId || !driverId) {
            alert("Ride ID or Driver ID missing");
            return;
        }

        setLoading(true);
        const socket = getSocket();
        socket.emit('accept-ride', { rideId, driverId }, (response) => {
            setLoading(false);
            if (response.status === 'success') {
                setRideStatus('accepted');
                setStatus('accepted');
            } else {
                alert(response.message || "Failed to accept ride");
            }
        });
    };

    const handleCompleteRide = () => {
        const rideId = activeRide?.rideId || activeRide?._id;
        if (!rideId) return;

        setLoading(true);
        const socket = getSocket();
        socket.emit('complete-ride', { rideId }, (response) => {
            setLoading(false);
            if (response.status === 'success') {
                setRideStatus('completed_summary');
                setStatus('completed_summary');
                setActiveRide(null);
                setPickup(null);
                setDestination(null);
            }
        });
    };

    const handleRejectRide = () => {
        const rideId = activeRide?._id || activeRide?.rideId;
        if (!rideId) return;

        setLoading(true);
        const socket = getSocket();
        socket.emit('reject-ride', { rideId }, (response) => {
            setLoading(false);
            setActiveRide(null);
            setRideStatus('idle');
            setStatus('idle');
            if (response.status === 'error') {
                alert(response.message || "Failed to reject ride");
            }
        });
    };

    const handleLogout = () => {
        localStorage.clear();
        setUser(null);
        setPickup(null);
        setDestination(null);
        setDriverDestination(null);
        navigate('/');
    };

    return (
        <div className="dashboard-container" style={{ display: 'flex', height: '100vh', background: '#f1f5f9', overflow: 'hidden' }}>
            <div className="sidebar" style={{ width: '380px', minWidth: '380px', background: 'white', boxShadow: '4px 0 15px rgba(0,0,0,0.05)', zIndex: 10, display: 'flex', flexDirection: 'column', padding: '24px', overflowY: 'auto', height: '100vh' }}>
                <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                    <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#1e293b' }}>GoMoto</h1>
                    <button onClick={handleLogout} className="logout-btn" style={{ background: '#f1f5f9', border: 'none', padding: '10px', borderRadius: '12px', cursor: 'pointer' }}>
                        <LogOut size={20} color="#64748b" />
                    </button>
                </div>

                <div className="user-profile" style={{ background: '#f8fafc', padding: '16px', borderRadius: '16px', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                    <div style={{ background: '#e2e8f0', width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <User size={24} color="#64748b" />
                    </div>
                    <div>
                        <div style={{ fontWeight: 700, color: '#1e293b' }}>{user?.name}</div>
                        <div style={{ fontSize: '13px', color: '#64748b', textTransform: 'capitalize' }}>{user?.role}</div>
                    </div>
                </div>

                <div className="controls-area" style={{ flex: 1 }}>
                    {user?.role === 'passenger' ? (
                        <>
                            <div className="selection-cards" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
                                <div 
                                    className={`input-card ${mode === 'pickup' ? 'active' : ''}`}
                                    onClick={() => setMode('pickup')}
                                    style={{ padding: '16px', borderRadius: '16px', border: mode === 'pickup' ? '2px solid #10b981' : '2px solid #f1f5f9', cursor: 'pointer', transition: 'all 0.2s' }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <MapPin size={20} color="#10b981" />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '11px', fontWeight: 800, color: '#64748b' }}>PICKUP</div>
                                            <div style={{ fontSize: '14px', fontWeight: 600 }}>{pickup ? 'Location selected' : 'Set pickup...'}</div>
                                        </div>
                                    </div>
                                </div>

                                <div 
                                    className={`input-card ${mode === 'destination' ? 'active' : ''}`}
                                    onClick={() => setMode('destination')}
                                    style={{ padding: '16px', borderRadius: '16px', border: mode === 'destination' ? '2px solid #ef4444' : '2px solid #f1f5f9', cursor: 'pointer', transition: 'all 0.2s' }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <Navigation2 size={20} color="#ef4444" />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '11px', fontWeight: 800, color: '#64748b' }}>DESTINATION</div>
                                            <div style={{ fontSize: '14px', fontWeight: 600 }}>{destination ? 'Location selected' : 'Set destination...'}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {rideStatus === 'idle' && (
                                <>
                                    <div style={{ marginBottom: '16px' }}>
                                        <label style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', marginBottom: '10px', display: 'block' }}>PASSENGERS</label>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            {[1, 2, 3, 4].map(n => (
                                                <button
                                                    key={n}
                                                    onClick={() => setPassengers(n)}
                                                    style={{ flex: 1, padding: '10px', borderRadius: '12px', border: passengers === n ? '2px solid #1e293b' : '1px solid #e2e8f0', background: passengers === n ? '#1e293b' : 'white', color: passengers === n ? 'white' : '#475569', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', fontSize: '14px' }}
                                                >
                                                    {n}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <button 
                                        onClick={handleRequestRide}
                                        disabled={!pickup || !destination}
                                        style={{ width: '100%', background: '#1e293b', color: 'white', padding: '16px', borderRadius: '16px', fontWeight: 700, cursor: pickup && destination ? 'pointer' : 'not-allowed', opacity: pickup && destination ? 1 : 0.5 }}
                                    >
                                        Request Ride ({passengers} {passengers === 1 ? 'passenger' : 'passengers'})
                                    </button>
                                </>
                            )}

                            {searching && rideStatus !== 'accepted' && rideStatus !== 'ongoing' && rideStatus !== 'completed_summary' && (
                                <div className="status-searching" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '24px', background: '#f8fafc', borderRadius: '16px' }}>
                                    <Loader className="animate-spin" size={32} color="#10b981" />
                                    <div style={{ fontWeight: 600 }}>{loading ? 'Processing...' : 'Finding nearby drivers...'}</div>
                                    {activeRide?.fare && (
                                        <div style={{ fontSize: '18px', fontWeight: 800, color: '#1e293b' }}>Estimated Fare: ₹{activeRide.fare}</div>
                                    )}
                                    <button onClick={() => { setSearching(false); setRideStatus('idle'); setStatus('idle'); setActiveRide(null); }} style={{ fontSize: '13px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                                </div>
                            )}

                            {(rideStatus === 'accepted' || rideStatus === 'ongoing') && activeRide && (
                                <div className="ride-card fade-in" style={{ padding: '20px', background: rideStatus === 'accepted' ? '#ecfdf5' : '#eff6ff', borderRadius: '16px', border: rideStatus === 'accepted' ? '1px solid #10b981' : '1px solid #3b82f6', marginBottom: '24px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                        <div style={{ background: rideStatus === 'accepted' ? '#10b981' : '#3b82f6', padding: '8px', borderRadius: '10px' }}>
                                            <User size={20} color="white" />
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 800, color: rideStatus === 'accepted' ? '#065f46' : '#1d4ed8', fontSize: '16px' }}>
                                                {rideStatus === 'accepted' ? 'Driver Arriving' : 'Ride in Progress'}
                                            </div>
                                            <div style={{ fontSize: '12px', color: rideStatus === 'accepted' ? '#047857' : '#2563eb' }}>
                                                {rideStatus === 'accepted' ? 'Meet at pickup location' : 'Heading to destination'}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div style={{ padding: '16px', background: 'white', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                        {(() => {
                                            const driver = driverInfo || activeRide?.driver;
                                            return (
                                                <>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                        <span style={{ color: '#64748b', fontSize: '13px' }}>Driver Name</span>
                                                        <span style={{ fontWeight: 700, color: '#1e293b' }}>{driver?.name}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                        <span style={{ color: '#64748b', fontSize: '13px' }}>Contact</span>
                                                        <span style={{ fontWeight: 600, color: rideStatus === 'accepted' ? '#10b981' : '#3b82f6' }}>📞 {driver?.phone}</span>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                        <div style={{ height: '1px', background: '#f1f5f9', margin: '12px 0' }}></div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ color: '#64748b', fontSize: '13px' }}>Total Fare</span>
                                            <span style={{ fontWeight: 800, color: '#1e293b', fontSize: '18px' }}>₹{activeRide?.fare}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="driver-config" style={{ marginBottom: '24px' }}>
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', marginBottom: '8px', display: 'block' }}>MY DESTINATION</label>
                                    <div 
                                        onClick={() => setMode('destination')}
                                        style={{ padding: '14px', background: '#f1f5f9', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', border: mode === 'destination' ? '2px solid #2563eb' : '2px solid transparent' }}
                                    >
                                        <Navigation size={18} color="#64748b" />
                                        <span style={{ fontSize: '14px', fontWeight: 500 }}>{driverDestination ? 'Routing set' : 'Click map to set route'}</span>
                                    </div>
                                </div>
                                <div>
                                    <label style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', marginBottom: '8px', display: 'block' }}>AVAILABLE SEATS</label>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        {[1,2,3,4].map(s => (
                                            <button 
                                                key={s}
                                                onClick={() => setSeats(s)}
                                                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: seats === s ? '2px solid #2563eb' : '1px solid #e2e8f0', background: seats === s ? '#eff6ff' : 'white', fontWeight: 700, cursor: 'pointer' }}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <button 
                                onClick={handleGoOnline}
                                style={{ width: '100%', padding: '16px', borderRadius: '16px', background: isOnline ? '#ef4444' : '#1e293b', color: 'white', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', border: 'none', marginBottom: '24px' }}
                            >
                                {isOnline ? <><ToggleRight /> GO OFFLINE</> : <><ToggleLeft /> GO ONLINE</>}
                            </button>

                            {isOnline && (rideStatus === 'accepted' || rideStatus === 'ongoing') && activeRide && (
                                <div className="ride-card fade-in" style={{ padding: '20px', background: rideStatus === 'accepted' ? '#eff6ff' : '#ecfdf5', borderRadius: '16px', border: rideStatus === 'accepted' ? '1px solid #3b82f6' : '1px solid #10b981', marginBottom: '24px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                        <div style={{ background: rideStatus === 'accepted' ? '#3b82f6' : '#10b981', padding: '8px', borderRadius: '10px' }}>
                                            <User size={20} color="white" />
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 800, color: rideStatus === 'accepted' ? '#1d4ed8' : '#065f46', fontSize: '16px' }}>
                                                {rideStatus === 'accepted' ? 'Passenger Waiting' : 'Trip in Progress'}
                                            </div>
                                            <div style={{ fontSize: '12px', color: rideStatus === 'accepted' ? '#2563eb' : '#047857' }}>
                                                {rideStatus === 'accepted' ? 'Proceed to pickup' : 'Drive safely to destination'}
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ padding: '16px', background: 'white', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', marginBottom: '16px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                            <span style={{ color: '#64748b', fontSize: '13px' }}>Passenger Name</span>
                                            <span style={{ fontWeight: 700, color: '#1e293b' }}>{activeRide.passenger?.name}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                            <span style={{ color: '#64748b', fontSize: '13px' }}>Contact</span>
                                            <span style={{ fontWeight: 600, color: rideStatus === 'accepted' ? '#3b82f6' : '#10b981' }}>📞 {activeRide.passenger?.phone}</span>
                                        </div>
                                        <div style={{ height: '1px', background: '#f1f5f9', margin: '12px 0' }}></div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                            <span style={{ color: '#64748b', fontSize: '13px' }}>Passengers</span>
                                            <span style={{ fontWeight: 700, color: '#2563eb', display: 'flex', alignItems: 'center', gap: '4px' }}><Users size={14} /> {activeRide?.passengers || activeRide?.passengers || 1}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ color: '#64748b', fontSize: '13px' }}>Expected Fare</span>
                                            <span style={{ fontWeight: 800, color: '#1e293b', fontSize: '18px' }}>₹{activeRide?.fare}</span>
                                        </div>
                                    </div>

                                    {rideStatus === 'accepted' ? (
                                        <button 
                                            onClick={handleStartTrip}
                                            style={{ width: '100%', padding: '14px', borderRadius: '12px', background: '#3b82f6', color: 'white', fontWeight: 800, cursor: 'pointer', border: 'none', transition: 'all 0.2s' }}
                                        >
                                            START TRIP
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={handleCompleteRide}
                                            disabled={loading}
                                            style={{ width: '100%', padding: '14px', borderRadius: '12px', background: '#10b981', color: 'white', fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', border: 'none', transition: 'all 0.2s', opacity: loading ? 0.7 : 1 }}
                                        >
                                            {loading ? 'PROCESSING...' : 'COMPLETE RIDE'}
                                        </button>
                                    )}
                                </div>
                            )}

                            {isOnline && rideStatus === 'idle' && (
                                <div style={{ textAlign: 'center', color: '#10b981', fontSize: '13px', fontWeight: 600 }}>
                                    📡 Waiting for ride requests nearby...
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            <div style={{ flex: 1, position: 'relative' }}>
                <Map 
                    userLocation={pickup}
                    pickup={user?.role === 'passenger' ? pickup : (activeRide ? activeRide.pickup : null)}
                    destination={user?.role === 'passenger' ? destination : (activeRide ? activeRide.destination : driverDestination)}
                    markers={nearbyDrivers}
                    activeDriverLocation={activeRide?.driver?.location?.coordinates || activeRide?.driver?.location}
                    onMapClick={handleMapClick}
                    driverView={user?.role === 'driver'}
                />

                {user?.role === 'driver' && rideStatus === 'pending_request' && activeRide && (
                    <div className="fade-in" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '340px', background: 'white', padding: '32px', borderRadius: '28px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #e2e8f0', zIndex: 100 }}>
                        <div style={{ background: '#eff6ff', width: '56px', height: '56px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
                            <Navigation2 size={28} color="#2563eb" />
                        </div>
                        <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px', color: '#1e293b' }}>New Ride Request</h3>
                        <div style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>
                            Passenger <strong>{activeRide.passenger?.name}</strong> is nearby.
                            <div style={{ marginTop: '8px', fontSize: '13px', color: '#3b82f6', fontWeight: 600 }}>📞 {activeRide.passenger?.phone}</div>
                            <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                                <div style={{ flex: 1, padding: '12px', background: '#f8fafc', borderRadius: '12px', fontWeight: 700, color: '#1e293b', fontSize: '16px', textAlign: 'center' }}>₹{activeRide.fare}</div>
                                <div style={{ flex: 1, padding: '12px', background: '#eff6ff', borderRadius: '12px', fontWeight: 700, color: '#2563eb', fontSize: '14px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                    <Users size={16} /> {activeRide.passengers || 1} pax
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button onClick={handleAcceptRide} disabled={loading} style={{ flex: 1, background: '#1e293b', color: 'white', border: 'none', padding: '16px', borderRadius: '14px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>{loading ? 'Accepting...' : 'Accept'}</button>
                            <button onClick={handleRejectRide} disabled={loading} style={{ flex: 1, background: '#f1f5f9', color: '#64748b', border: 'none', padding: '16px', borderRadius: '14px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>Reject</button>
                        </div>
                    </div>
                )}

                {user?.role === 'passenger' && rideStatus === 'completed_summary' && activeRide && (
                    <div className="fade-in" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                        <div style={{ width: '380px', background: 'white', borderRadius: '32px', padding: '40px', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
                            <div style={{ background: '#ecfdf5', width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                                <CheckCircle size={40} color="#10b981" />
                            </div>
                            <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#1e293b', marginBottom: '8px' }}>Trip Completed!</h2>
                            <p style={{ color: '#64748b', marginBottom: '32px' }}>Thank you for riding with GoMoto.</p>
                            <div style={{ background: '#f8fafc', borderRadius: '20px', padding: '24px', marginBottom: '32px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                    <span style={{ color: '#64748b', fontSize: '14px' }}>Biker</span>
                                    <span style={{ fontWeight: 700 }}>{driverInfo?.name || 'Partner'}</span>
                                </div>
                                <div style={{ height: '1px', background: '#e2e8f0', margin: '12px 0' }}></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ color: '#64748b', fontSize: '14px' }}>Total Fare</span>
                                    <span style={{ fontSize: '20px', fontWeight: 800, color: '#1e293b' }}>₹{activeRide.fare}</span>
                                </div>
                            </div>
                            <button onClick={() => { setRideStatus('idle'); setStatus('idle'); setActiveRide(null); }} style={{ width: '100%', background: '#1e293b', color: 'white', padding: '16px', borderRadius: '16px', fontWeight: 700, cursor: 'pointer', border: 'none' }}>Back to Map</button>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                .animate-spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes bike-pulse-anim { 0% { transform: scale(1); opacity: 0.4; } 100% { transform: scale(2.5); opacity: 0; } }
                .fade-in { animation: fadeIn 0.3s ease-out; }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            `}</style>
        </div>
    );
};

export default Dashboard;
