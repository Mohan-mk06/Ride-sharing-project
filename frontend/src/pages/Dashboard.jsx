import React, { useState, useEffect, useCallback } from 'react';
import Map from '../components/Map';
import API from '../services/api';
import { getSocket, subscribeToEvent, emitEvent, disconnectSocket } from '../services/socket';
import { LogOut, ToggleLeft, ToggleRight, MapPin, Navigation, User, CheckCircle, XCircle, Loader, Navigation2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Dashboard = ({ user, setUser }) => {
    const [isOnline, setIsOnline] = useState(user?.isOnline || false);
    const [nearbyDrivers, setNearbyDrivers] = useState([]);
    const [activeRide, setActiveRide] = useState(null);
    const [mode, setMode] = useState('pickup'); // 'pickup' or 'destination'
    const [pickup, setPickup] = useState(null);
    const [destination, setDestination] = useState(null);
    const [driverDestination, setDriverDestination] = useState(null);
    const [status, setStatus] = useState('idle'); // 'idle', 'searching', 'accepted', 'ongoing'
    const [seats, setSeats] = useState(4);
    const [geolocError, setGeolocError] = useState(null);
    const [isFetchingLocation, setIsFetchingLocation] = useState(false);
    const navigate = useNavigate();

    // 1. Initial Setup & Socket Connection
    useEffect(() => {
        if (!user) return;
        const socket = getSocket();
        socket.on('connect', () => socket.emit('join', user.id));
        socket.emit('join', user.id); // Immediate join if already connected

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
        const unsubRequest = subscribeToEvent('newRideRequest', (data) => {
            setActiveRide(data);
            setStatus('pending_request');
        });

        const unsubAccepted = subscribeToEvent('rideAccepted', (data) => {
            setActiveRide(data);
            setStatus('accepted');
        });

        const unsubRejected = subscribeToEvent('rideRejected', () => {
            alert('Your ride request was rejected. Please try again.');
            setActiveRide(null);
            setStatus('idle');
        });

        const unsubCompleted = subscribeToEvent('rideCompleted', (data) => {
            setActiveRide(data.ride || activeRide);
            setStatus('completed_summary');
            setPickup(null);
            setDestination(null);
        });

        const unsubStatus = subscribeToEvent('rideStatusUpdated', (data) => {
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
            
            if (activeRide?.driver?.id === data.driverId) {
                setActiveRide(prev => ({
                    ...prev,
                    driver: { ...prev.driver, location: { ...prev.driver.location, coordinates: [data.location.lng, data.location.lat] } }
                }));
            }
        });

        // Get location and then fetch drivers
        navigator.geolocation.getCurrentPosition((pos) => {
            const coords = [pos.coords.longitude, pos.coords.latitude];
            setPickup(coords);
            fetchInitialDrivers(coords);
        }, () => fetchInitialDrivers(null));

        return () => {
            unsubRequest();
            unsubAccepted();
            unsubRejected();
            unsubCompleted();
            unsubStatus();
            unsubLocUpdate();
        };
    }, [user, activeRide?.driver?.id]);

    // 2. Driver Location Tracking (watchPosition)
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

    // Handlers
    const handleCompleteRide = async () => {
        try {
            await API.post('/rides/complete', { rideId: activeRide?.rideId || activeRide?._id });
            setStatus('idle');
            setPickup(null);
            setDestination(null);
            setActiveRide(null);
            alert('Ride marked as completed!');
        } catch (err) {
            alert('Failed to complete ride');
        }
    };
    const calculateFare = (p1, p2) => {
        if (!p1 || !p2) return 0;
        const R = 6371; // Earth radius in km
        const dLat = (p2[1] - p1[1]) * Math.PI / 180;
        const dLng = (p2[0] - p1[0]) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;
        return Math.max(50, Math.round(distance * 20)); // Min ₹50, then ₹20/km
    };

    const handleMapClick = useCallback((coords) => {
        if (status !== 'idle' && status !== 'pending_request') return;
        
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
    }, [mode, status, user?.role]);

    const handleRequestRide = async () => {
        if (!pickup || !destination) return;
        const fare = calculateFare(pickup, destination);
        console.log('Requesting ride:', pickup, destination, 'Fare:', fare);
        setStatus('searching');
        try {
            await API.post('/rides/request', {
                pickup: { lng: pickup[0], lat: pickup[1] },
                destination: { lng: destination[0], lat: destination[1] },
                fare
            });
        } catch (err) {
            alert(err.response?.data?.message || 'Request failed');
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
        try {
            await API.post('/rides/start', { rideId: activeRide?.rideId || activeRide?._id });
            setStatus('ongoing');
        } catch (err) {
            alert('Failed to start trip');
        }
    };

    const handleAcceptRide = async () => {
        try {
            await API.post('/rides/accept', { rideId: activeRide.rideId });
            setStatus('accepted');
        } catch (err) {
            alert('Failed to accept');
            setActiveRide(null);
            setStatus('idle');
        }
    };

    const handleRejectRide = async () => {
        try {
            await API.post('/rides/reject', { rideId: activeRide.rideId });
            setActiveRide(null);
            setStatus('idle');
        } catch (err) {
            console.error(err);
        }
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
        <div className="dashboard-container" style={{ display: 'flex', height: '100vh', background: '#f1f5f9' }}>
            <div className="sidebar" style={{ width: '380px', background: 'white', boxShadow: '4px 0 15px rgba(0,0,0,0.05)', zIndex: 10, display: 'flex', flexDirection: 'column', padding: '24px' }}>
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

                {/* Role-Specific Controls */}
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

                            {status === 'idle' && (
                                <button 
                                    onClick={handleRequestRide}
                                    disabled={!pickup || !destination}
                                    style={{ width: '100%', background: '#1e293b', color: 'white', padding: '16px', borderRadius: '16px', fontWeight: 700, cursor: pickup && destination ? 'pointer' : 'not-allowed', opacity: pickup && destination ? 1 : 0.5 }}
                                >
                                    Request Ride
                                </button>
                            )}

                            {status === 'searching' && (
                                <div className="status-searching" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '24px', background: '#f8fafc', borderRadius: '16px' }}>
                                    <Loader className="animate-spin" size={32} color="#10b981" />
                                    <div style={{ fontWeight: 600 }}>Finding nearby drivers...</div>
                                    <button onClick={() => setStatus('idle')} style={{ fontSize: '13px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                                </div>
                            )}

                            {status === 'accepted' && activeRide && (
                                <div className="ride-card fade-in" style={{ padding: '20px', background: '#ecfdf5', borderRadius: '16px', border: '1px solid #10b981' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                        <div style={{ background: '#10b981', padding: '8px', borderRadius: '10px' }}>
                                            <CheckCircle size={20} color="white" />
                                        </div>
                                        <div style={{ fontWeight: 700, color: '#065f46' }}>Driver is matching!</div>
                                    </div>
                                    <div style={{ padding: '12px', background: 'white', borderRadius: '12px', marginBottom: '12px' }}>
                                        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 800 }}>DRIVER</div>
                                        <div style={{ fontSize: '14px', fontWeight: 700 }}>{activeRide.driver?.name}</div>
                                        <div style={{ fontSize: '12px', color: '#10b981', marginTop: '4px' }}>₹{activeRide.fare} • Cash Payment</div>
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#065f46', fontWeight: 500 }}>
                                        Driver is currently at their pickup point. Track live on map.
                                    </div>
                                </div>
                            )}

                            {status === 'ongoing' && activeRide && (
                                <div className="ride-card fade-in" style={{ padding: '20px', background: '#eff6ff', borderRadius: '16px', border: '1px solid #3b82f6' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                        <div style={{ background: '#3b82f6', padding: '8px', borderRadius: '10px' }}>
                                            <Navigation size={20} color="white" />
                                        </div>
                                        <div style={{ fontWeight: 700, color: '#1d4ed8' }}>Ride in Progress</div>
                                    </div>
                                    <div style={{ fontSize: '14px', color: '#1d4ed8' }}>
                                        You are currently on your way to the destination. Enjoy your ride with <strong>{activeRide.driver?.name}</strong>!
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        // Driver Role
                        <>
                            <div className="driver-config" style={{ marginBottom: '24px' }}>
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', marginBottom: '8px', display: 'block' }}>MY DESTINATION</label>
                                    <div 
                                        className={`input-card ${mode === 'destination' ? 'active' : ''}`}
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
                                style={{ width: '100%', padding: '16px', borderRadius: '16px', background: isOnline ? '#ef4444' : '#1e293b', color: 'white', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', border: 'none' }}
                            >
                                {isOnline ? <><ToggleRight /> GO OFFLINE</> : <><ToggleLeft /> GO ONLINE</>}
                            </button>

                            {isOnline && status === 'accepted' && (
                                <div style={{ marginTop: '24px', padding: '20px', background: '#eff6ff', borderRadius: '16px', border: '1px solid #3b82f6' }}>
                                    <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: '12px' }}>Ride Accepted</div>
                                    <button 
                                        onClick={handleStartTrip}
                                        style={{ width: '100%', padding: '12px', borderRadius: '12px', background: '#3b82f6', color: 'white', fontWeight: 700, cursor: 'pointer', border: 'none' }}
                                    >
                                        START TRIP
                                    </button>
                                </div>
                            )}

                            {isOnline && status === 'ongoing' && (
                                <div style={{ marginTop: '24px', padding: '20px', background: '#ecfdf5', borderRadius: '16px', border: '1px solid #10b981' }}>
                                    <div style={{ fontWeight: 700, color: '#065f46', marginBottom: '12px' }}>Current Ride Active</div>
                                    <button 
                                        onClick={handleCompleteRide}
                                        style={{ width: '100%', padding: '12px', borderRadius: '12px', background: '#10b981', color: 'white', fontWeight: 700, cursor: 'pointer', border: 'none' }}
                                    >
                                        COMPLETE RIDE
                                    </button>
                                </div>
                            )}

                            {isOnline && status === 'idle' && (
                                <div style={{ marginTop: '24px', textAlign: 'center', color: '#10b981', fontSize: '13px', fontWeight: 600 }}>
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
                    pickup={user?.role === 'passenger' ? pickup : null}
                    destination={user?.role === 'passenger' ? destination : driverDestination}
                    markers={nearbyDrivers}
                    activeDriverLocation={activeRide?.driver?.location?.coordinates || activeRide?.driver?.location}
                    onMapClick={handleMapClick}
                />

                {/* Ride Request Popup (Driver Only) */}
                {user?.role === 'driver' && status === 'pending_request' && activeRide && (
                    <div className="fade-in" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '340px', background: 'white', padding: '32px', borderRadius: '28px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #e2e8f0', zIndex: 100 }}>
                        <div style={{ background: '#eff6ff', width: '56px', height: '56px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
                            <Navigation2 size={28} color="#2563eb" />
                        </div>
                        <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px', color: '#1e293b' }}>New Ride Request</h3>
                        <div style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>
                            Passenger <strong>{activeRide.passenger?.name}</strong> is nearby.
                            <div style={{ marginTop: '12px', padding: '12px', background: '#f8fafc', borderRadius: '12px', fontWeight: 700, color: '#1e293b', fontSize: '16px' }}>₹{activeRide.fare}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button onClick={handleAcceptRide} style={{ flex: 1, background: '#1e293b', color: 'white', border: 'none', padding: '16px', borderRadius: '14px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>Accept</button>
                            <button onClick={handleRejectRide} style={{ flex: 1, background: '#f1f5f9', color: '#64748b', border: 'none', padding: '16px', borderRadius: '14px', fontWeight: 700, cursor: 'pointer' }}>Reject</button>
                        </div>
                    </div>
                )}
                {/* Ride Summary Modal (Passenger Only) */}
                {user?.role === 'passenger' && status === 'completed_summary' && activeRide && (
                    <div className="fade-in" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                        <div style={{ width: '380px', background: 'white', borderRadius: '32px', padding: '40px', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
                            <div style={{ background: '#ecfdf5', width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                                <CheckCircle size={40} color="#10b981" />
                            </div>
                            <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#1e293b', marginBottom: '8px' }}>Trip Completed!</h2>
                            <p style={{ color: '#64748b', marginBottom: '32px' }}>Thank you for riding with GoMoto. Hope you had a smooth journey.</p>
                            
                            <div style={{ background: '#f8fafc', borderRadius: '20px', padding: '24px', marginBottom: '32px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                    <span style={{ color: '#64748b', fontSize: '14px' }}>Biker</span>
                                    <span style={{ fontWeight: 700 }}>{activeRide.driver?.name || 'Partner'}</span>
                                </div>
                                <div style={{ height: '1px', background: '#e2e8f0', margin: '12px 0' }}></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ color: '#64748b', fontSize: '14px' }}>Total Fare</span>
                                    <span style={{ fontSize: '20px', fontWeight: 800, color: '#1e293b' }}>₹{activeRide.fare}</span>
                                </div>
                            </div>

                            <button 
                                onClick={() => { setStatus('idle'); setActiveRide(null); }}
                                style={{ width: '100%', background: '#1e293b', color: 'white', padding: '16px', borderRadius: '16px', fontWeight: 700, cursor: 'pointer', border: 'none', transition: 'transform 0.2s' }}
                            >
                                Back to Map
                            </button>
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
                .logout-btn:hover { background: #fee2e2 !important; }
                .logout-btn:hover svg { color: #ef4444 !important; }
            `}</style>
        </div>
    );
};

export default Dashboard;
