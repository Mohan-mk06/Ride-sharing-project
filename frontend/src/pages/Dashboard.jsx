import React, { useState, useEffect, useCallback, useRef } from 'react';
import Map from '../components/Map';
import API from '../services/api';
import { getSocket, subscribeToEvent, emitEvent, disconnectSocket } from '../services/socket';
import { LogOut, ToggleLeft, ToggleRight, MapPin, Navigation, User, CheckCircle, XCircle, Loader, Navigation2, Users, Phone, Zap, CreditCard, History, Calendar } from 'lucide-react';
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
    const [notifications, setNotifications] = useState([]);
    const [distance, setDistance] = useState(null);
    const [duration, setDuration] = useState(null);
    const [calculatingFare, setCalculatingFare] = useState(false);
    const [accepting, setAccepting] = useState(false); 
    const [fare, setFare] = useState(null); // 🔥 CRITICAL FIX
    const [incomingRide, setIncomingRide] = useState(null); // 🔥 CRITICAL FIX
    
    // 🎭 Review System States
    const [showReviewModal, setShowReviewModal] = useState(false);
    const [rating, setRating] = useState(0);
    const [feedback, setFeedback] = useState("");
    const [completedRideFare, setCompletedRideFare] = useState(null);
    const [routeCoordinates, setRouteCoordinates] = useState([]); // 🔥 For simulation
    const [driverLocation, setDriverLocation] = useState(null); // 🔥 Moving marker
    const [remainingPath, setRemainingPath] = useState([]); // 🔥 For disappearing line
    const [rideHistory, setRideHistory] = useState([]);
    const [driverStats, setDriverStats] = useState(null);

    const acceptTimeoutRef = useRef(null); // 🔥 Timer fallback guard
    const intervalRef = useRef(null); // 🔥 Prevent duplicates
    const navigate = useNavigate();

    // 0. Socket Connection Lifecycle
    useEffect(() => {
        const socket = getSocket();
        socket.connect();
        return () => {
            socket.disconnect(); 
        };
    }, []);

    const showNotification = (msg, type = "info") => {
        const id = Date.now() + Math.random();
        setNotifications(prev => [...prev, { id, msg, type }]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 10000); // 10 sec
    };

    const resetRideState = () => {
        setPickup(null);
        setDestination(null);
        setDistance(null);
        setDuration(null);
        setFare(null);
        setActiveRide(null);
        setDriverInfo(null);
        setSearching(false);
        setIncomingRide(null);
        setAccepting(false);
        setRideStatus('idle');
        setStatus('idle');
        setDriverLocation(null); // 🔥 Reset live tracking
        setRouteCoordinates([]); // 🔥 Clear old route
        // 🔥 CRITICAL: DO NOT clear driverDestination here
    };

    // 1. Socket Registration
    useEffect(() => {
        const socket = getSocket();
        const userId = user?._id || user?.id;
        if (!socket || !userId) return;

        const registrationData = user.role === 'driver' 
            ? { userId, availableSeats: seats } 
            : userId;

        console.log("📡 Registering socket:", registrationData);
        socket.emit("register", registrationData);
        
    }, [user?._id, user?.id, seats, user?.role]); 

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

        // Subscriptions cleanup before re-subscribing
        socket.off('newRideRequest');
        socket.off('rideRejected');
        socket.off('rideCompleted');
        socket.off('rideStatusUpdated');
        socket.off('rideStarted');

        const unsubRequest = subscribeToEvent('newRideRequest', (data) => {
            console.log("🔥 [Socket] RECEIVED RIDE REQUEST:", data);
            setActiveRide(data);
            setRideStatus('pending_request');
            setStatus('pending_request');
            if (user?.role === 'driver') {
                showNotification(`📍 New ride request from ${data.passenger?.name} - ₹${data.fare}`);
            }
        });
        

        const unsubRejected = subscribeToEvent('rideRejected', () => {
            console.log("❌ [Socket] Ride rejected");
            showNotification('Your ride request was rejected. Please try again.', 'error');
            setActiveRide(null);
            setSearching(false);
            setLoading(false);
            setAccepting(false); // 🔥 RESET HERE ALSO
            setRideStatus('idle');
            setStatus('idle');
        });

        const unsubCompleted = subscribeToEvent('rideCompleted', (data) => {
            console.log("🏁 [Socket] Ride Completed:", data);
            
            if (user?.role === 'passenger') {
                setCompletedRideFare(data.ride?.fare || 0);
                // Capture driver info for modal before reset
                if (data.ride?.driver) setDriverInfo(data.ride.driver);
                setShowReviewModal(true);
            }

            // We specifically don't call resetRideState() here for passengers 
            // so they can see the driver info and fare in the modal.
            fetchHistory();
            setRideStatus('completed_summary');
            setStatus('completed_summary');
        });

        const unsubStatus = subscribeToEvent('rideStatusUpdated', (data) => {
            console.log("📈 [Socket] Status Update:", data.status);
            setActiveRide(prev => {
                const updated = { ...prev, ...data.ride, status: data.status };
                // Preserve driver info if the update is partial
                if (!updated.driver && prev?.driver) updated.driver = prev.driver;
                return updated;
            });
            
            if (data.status === 'ongoing' && user?.role === 'passenger') {
                showNotification("🚗 Driver has started the trip", "info");
                setRideStatus('ongoing');
                setStatus('ongoing');
            }
            if (data.status === 'completed') {
                setRideStatus('completed_summary');
                setStatus('completed_summary');
            }
        });

        const unsubStarted = subscribeToEvent('rideStarted', (data) => {
            console.log("🚀 [Socket] Ride Started:", data);
            setActiveRide(prev => ({ ...prev, ...data.ride, status: 'ongoing' }));
            setRideStatus('ongoing');
            setStatus('ongoing');
        });

        socket.off('driverLocationUpdated');
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

        socket.off('ride-error');
        const unsubError = subscribeToEvent('ride-error', (msg) => {
            console.error("⚠️ [Socket Error]:", msg);
            showNotification(msg, 'error');
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
            unsubStarted();
            unsubLocUpdate();
            unsubError();
        };
    }, [user, activeRide?._id]);

    // 2.3 Ride Accepted Listener (Dedicated)
    useEffect(() => {
        const socket = getSocket();
        socket.off("rideAccepted"); // PREVENT STACKING

        const handleRideAccepted = (data) => {
            console.log("✅ rideAccepted RECEIVED:", data);
            
            // 🔥 Timer Reset
            if (acceptTimeoutRef.current) {
                clearTimeout(acceptTimeoutRef.current);
                acceptTimeoutRef.current = null;
            }

            // CRITICAL: Stop searching and update state immediately
            setSearching(false);
            setLoading(false);
            setRideStatus('accepted');
            setStatus('accepted');
            setDriverInfo(data.driver);
            setActiveRide(data.ride);
            setAccepting(false); // 🔥 FIX
            setIncomingRide(null); // 🔥 FIX
            
            // 🔥 SYNC METRICS IMMEDIATELY
            if (data.ride?.pickup && data.ride?.destination) {
                fetchDistanceAndFare(data.ride.pickup, data.ride.destination);
            }
            
            // Show notification if passenger
            if (user?.role === 'passenger') {
                const driverName = data.driver?.name || 'A driver';
                const fareValue = data.ride?.fare || '';
                showNotification(`🚗 ${driverName} accepted your ride. Fare: ₹${fareValue}`, 'success');
            }
            if (user?.role === 'driver') {
                showNotification("Ride accepted successfully 🚀", "success");
            }
        };

        socket.on("rideAccepted", handleRideAccepted);
        return () => {
            socket.off("rideAccepted", handleRideAccepted);
        };
    }, [user?.role]); 

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

    // 2. Driver Location Tracking (Real GPS fallback)
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

    // 🔥 LIVE DRIVER TRACKING (SIMULATION) - DRIVER SIDE
    useEffect(() => {
        if (!activeRide || user?.role !== 'driver' || !routeCoordinates || routeCoordinates.length === 0) return;
        
        // Stop simulation if ride completed
        if (activeRide.status === 'completed') {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }

        let index = 0;
        console.log("🚀 Starting route simulation for ride:", activeRide._id);

        intervalRef.current = setInterval(() => {
            if (index >= routeCoordinates.length) {
                console.log("🏁 Route simulation finished");
                clearInterval(intervalRef.current);
                handleCompleteRide(); // 🔥 AUTO COMPLETE
                return;
            }

            const coords = routeCoordinates[index];
            const restOfPath = routeCoordinates.slice(index); // 🔥 Sliced path
            
            setDriverLocation(coords); // 🔥 DRIVER SIDE UPDATE
            setRemainingPath(restOfPath); // 🔥 DRIVER SIDE UPDATE

            const passengerId = activeRide.passengerId || activeRide.passenger?._id || activeRide.passenger?.id;

            if (passengerId) {
                emitEvent("driverLocationUpdate", {
                    passengerId: passengerId,
                    coords,
                    remainingPath: restOfPath // 🔥 Emit to passenger
                });
            }

            index++;
        }, 2000);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [activeRide?._id, activeRide?.status, routeCoordinates, user?.role]);

    // 🔥 LIVE DRIVER TRACKING (SIMULATION) - PASSENGER SIDE
    useEffect(() => {
        const socket = getSocket();
        
        const handleLocationUpdate = ({ coords, remainingPath }) => {
            console.log("📍 Received driver location update:", coords);
            setDriverLocation(coords);
            if (remainingPath) setRemainingPath(remainingPath); // 🔥 Update path
        };

        socket.on("driverLocationUpdate", handleLocationUpdate);
        
        return () => {
            socket.off("driverLocationUpdate", handleLocationUpdate);
        };
    }, []);

    const fetchHistory = useCallback(async () => {
        try {
            const { data } = await API.get('/rides/history');
            setRideHistory(data);
        } catch (err) {
            console.error('History fetch error:', err);
        }
    }, []);

    const fetchDriverStats = useCallback(async () => {
        if (user?.role !== 'driver') return;
        try {
            const { data } = await API.get('/rides/driver-stats');
            setDriverStats(data);
        } catch (err) {
            console.error('Stats fetch error:', err);
        }
    }, [user?.role]);

    useEffect(() => {
        fetchHistory();
        if (user?.role === 'driver') fetchDriverStats();
    }, [fetchHistory, fetchDriverStats, user?.role]);




    const fetchDistanceAndFare = useCallback(async (p1, p2) => {
        if (!p1 || !p2) return;
        
        setSearching(false); // Make sure we are not in searching state yet
        setCalculatingFare(true);
        
        try {
            const token = import.meta.env.VITE_MAPBOX_TOKEN;
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${p1[0]},${p1[1]};${p2[0]},${p2[1]}?geometries=geojson&overview=full&access_token=${token}`;
            
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.routes && data.routes[0]) {
                const distanceKm = data.routes[0].distance / 1000;
                const durationMins = Math.round(data.routes[0].duration / 60);
                
                setDistance(distanceKm);
                setDuration(durationMins);
                
                const route = data.routes[0].geometry.coordinates;
                console.log("Full route points:", route.length);
                setRouteCoordinates(route); // 🔥 Save for simulation
                
                // Set fare dynamically (₹7 per km), min ₹30
                const calculatedFare = Math.max(30, Math.round(distanceKm * 7));
                setFare(calculatedFare); // 🔥 FIX: Set fare state
                
                if (activeRide && searching) {
                    setActiveRide(prev => ({ ...prev, fare: calculatedFare, distance: distanceKm, duration: durationMins }));
                }
                
                setCalculatingFare(false);
                return calculatedFare;
            } else {
                // Safety check fallback
                setDistance(null);
                setDuration(null);
                setFare(null);
                setCalculatingFare(false);
                return 30;
            }
        } catch (error) {
            console.error('Fare calculation error:', error);
            setCalculatingFare(false);
            setFare(30);
            return 30;
        }
    }, [activeRide, searching]);

    // 2.4 Driver Metrics Sync
    useEffect(() => {
        if (pickup && destination && user?.role === 'driver') {
            fetchDistanceAndFare(pickup, destination);
        }
    }, [pickup, destination, user?.role, fetchDistanceAndFare]);

    useEffect(() => {
        if (pickup && destination && user?.role === 'passenger' && rideStatus === 'idle') {
            fetchDistanceAndFare(pickup, destination);
        }
    }, [pickup, destination, user?.role, rideStatus, fetchDistanceAndFare]);

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
        
        let fare = 0;
        if (distance) {
            fare = Math.max(30, Math.round(distance * 7));
        } else {
            fare = await fetchDistanceAndFare(pickup, destination);
        }
        
        setSearching(true);
        setRideStatus('searching');
        setStatus('searching');

        console.log("📡 Sending ride request to /rides/request:", pickup, destination, fare);
        try {
            const res = await API.post('/rides/request', {
                pickup,
                destination,
                fare,
                passengers
            });

            if (res.data.success === false) {
                showNotification(res.data.message || "No drivers available", "info");
                setSearching(false);
                setRideStatus('idle');
                setStatus('idle');
                return;
            }

            setActiveRide(res.data.ride);
        } catch (err) {
            console.error("Ride request failed:", err);
            const errorMsg = err.response?.data?.message || err.response?.data?.msg || err.message || 'Request failed';
            showNotification(`Ride request failed: ${errorMsg}`, 'error');
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
            showNotification('Action failed', 'error');
        }
    };

    const handleStartTrip = async () => {
        const rideId = activeRide?.rideId || activeRide?._id;
        if (!rideId) {
            showNotification('Ride ID not found', 'error');
            return;
        }
        try {
            await API.post('/rides/start', { rideId });
            setRideStatus('ongoing');
            setStatus('ongoing');
        } catch (err) {
            console.error('Start trip error:', err.response?.data || err.message);
            showNotification('Failed to start trip', 'error');
        }
    };

    const handleAcceptRide = () => {
        const rideId = activeRide?._id || activeRide?.rideId;
        const driverId = user?._id || user?.id;
        if (!rideId || !driverId) return;

        setLoading(true);
        setAccepting(true); // 🔥 SET ACCEPTING
        const socket = getSocket();
        
        console.log("📡 Emitting acceptRide:", rideId, driverId);
        socket.emit('acceptRide', { rideId, driverId }, (response) => {
            setLoading(false);
            if (response.status === 'error') {
                showNotification(response.message || "Failed to accept ride", "error");
                setAccepting(false);
                if (acceptTimeoutRef.current) {
                    clearTimeout(acceptTimeoutRef.current);
                    acceptTimeoutRef.current = null;
                }
            }
        });

        // 🔥 Fallback safety (3s as requested)
        if (acceptTimeoutRef.current) clearTimeout(acceptTimeoutRef.current);
        acceptTimeoutRef.current = setTimeout(() => {
            setAccepting(false);
            acceptTimeoutRef.current = null;
        }, 3000);
    };

    const handleCompleteRide = () => {
        const rideId = activeRide?.rideId || activeRide?._id;
        const fareAmt = activeRide?.fare || 0;
        if (!rideId) return;

        setLoading(true);
        const socket = getSocket();
        socket.emit('completeRide', { rideId }, (response) => {
            setLoading(false);
            if (response.status === 'success') {
                showNotification(`Ride request complete. Collect ₹${fareAmt} from passenger.`, "success");
                resetRideState(); // 🔥 ENSURE CALL
                fetchDriverStats();
                fetchHistory();
            } else {
                showNotification(response.message || "Failed to complete ride", "error");
            }
        });
    };

    const handleRejectRide = () => {
        const rideId = activeRide?._id || activeRide?.rideId;
        if (!rideId) return;

        setLoading(true);
        const socket = getSocket();
        socket.emit('rejectRide', { rideId }, (response) => {
            setLoading(false);
            setActiveRide(null);
            setRideStatus('idle');
            setStatus('idle');
            if (response.status === 'error') {
                showNotification(response.message || "Failed to reject ride", "error");
            }
        });
    };

    const handleSubmitReview = () => {
        console.log("Rating:", rating);
        console.log("Feedback:", feedback);
        showNotification("Thanks for your feedback!", "success");
        setShowReviewModal(false);
        setRating(0);
        setFeedback("");
        resetRideState(); // 🔥 FINALLY RESET HERE
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
            {/* Notification System Rendering */}
            <div className="notification-container" style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '12px', pointerEvents: 'none' }}>
                {notifications.map(n => (
                    <div key={n.id} className={`notification-toast ${n.type}`} style={{ pointerEvents: 'auto', background: n.type === 'success' ? '#10b981' : n.type === 'error' ? '#ef4444' : '#1e293b', color: 'white', padding: '16px 24px', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '12px', animation: 'slideIn 0.3s ease-out' }}>
                        {n.type === 'success' ? <CheckCircle size={20} /> : n.type === 'error' ? <XCircle size={20} /> : <Zap size={20} />}
                        {n.msg}
                    </div>
                ))}
            </div>

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
                                            
                                            {calculatingFare ? (
                                                <div style={{ padding: '16px', borderRadius: '16px', background: '#f8fafc', border: '1px dashed #cbd5e1', textAlign: 'center', marginBottom: '16px' }}>
                                                    <Loader className="animate-spin" size={16} color="#64748b" style={{ display: 'inline-block', marginRight: '8px' }} />
                                                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>Calculating route...</span>
                                                </div>
                                            ) : distance && (
                                                <div style={{ padding: '16px', borderRadius: '16px', background: '#eff6ff', border: '1px solid #bfdbfe', marginBottom: '16px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                        <span style={{ fontSize: '13px', color: '#1e40af', fontWeight: 600 }}>Distance: {distance.toFixed(2)} km</span>
                                                        <span style={{ fontSize: '16px', color: '#1e3a8a', fontWeight: 800 }}>₹{Math.max(30, Math.round(distance * 7))}</span>
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 500 }}>Est. Time: {duration} mins</div>
                                                </div>
                                            )}

                                            <button 
                                                onClick={handleRequestRide}
                                                disabled={!pickup || !destination || calculatingFare}
                                                style={{ width: '100%', background: '#1e293b', color: 'white', padding: '16px', borderRadius: '16px', fontWeight: 700, cursor: pickup && destination && !calculatingFare ? 'pointer' : 'not-allowed', opacity: pickup && destination && !calculatingFare ? 1 : 0.5 }}
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
                                                {rideStatus === 'accepted' ? 'Driver Found' : rideStatus === 'ongoing' ? 'Ride in Progress' : 'Trip Finished'}
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
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                            <span style={{ color: '#64748b', fontSize: '13px' }}>Distance / Time</span>
                                            <span style={{ fontWeight: 700, color: '#1e293b' }}>{activeRide?.distance?.toFixed(2) || distance?.toFixed(2)} km / {activeRide?.duration || duration} min</span>
                                        </div>
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
                                            <span style={{ color: '#64748b', fontSize: '13px' }}>Ride Metrics</span>
                                            <span style={{ fontWeight: 700 }}>
                                                {distance ? `${distance} km` : "—"} / {duration ? `${duration} min` : "—"}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                            <span style={{ color: '#64748b', fontSize: '13px' }}>Passengers</span>
                                            <span style={{ fontWeight: 700, color: '#2563eb', display: 'flex', alignItems: 'center', gap: '4px' }}><Users size={14} /> {activeRide?.passengers || 1}</span>
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

                    <div style={{ marginTop: '32px' }}>
                        {/* EARNINGS DASHBOARD (DRIVER ONLY) */}
                        {user?.role === 'driver' && driverStats && (
                            <div style={{ background: '#1e293b', padding: '24px', borderRadius: '24px', color: 'white', marginBottom: '20px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                    <div style={{ background: '#3b82f6', width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <CreditCard size={18} />
                                    </div>
                                    <h3 style={{ fontSize: '18px', fontWeight: 800 }}>Earnings</h3>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>Total Earned</div>
                                        <div style={{ fontSize: '20px', fontWeight: 800 }}>₹{driverStats.totalEarnings}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>Rides Done</div>
                                        <div style={{ fontSize: '20px', fontWeight: 800 }}>{driverStats.totalRides}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* RIDE HISTORY */}
                        <div style={{ background: 'white', padding: '24px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', marginBottom: '24px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                                <div style={{ background: '#f1f5f9', width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                                    <History size={18} />
                                </div>
                                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1e293b' }}>Ride History</h3>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
                                {rideHistory.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '14px' }}>No rides yet</div>
                                ) : (
                                    rideHistory.map((ride) => (
                                        <div key={ride._id} style={{ padding: '16px', background: '#f8fafc', borderRadius: '16px', border: '1px solid #f1f5f9' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                                                <span style={{ 
                                                    fontSize: '11px', 
                                                    fontWeight: 800, 
                                                    textTransform: 'uppercase', 
                                                    padding: '4px 8px', 
                                                    borderRadius: '6px',
                                                    background: ride.status === 'completed' ? '#ecfdf5' : ride.status === 'rejected' ? '#fef2f2' : '#f8fafc',
                                                    color: ride.status === 'completed' ? '#10b981' : ride.status === 'rejected' ? '#ef4444' : '#64748b'
                                                }}>
                                                    {ride.status}
                                                </span>
                                                <span style={{ fontSize: '14px', fontWeight: 800, color: '#1e293b' }}>₹{ride.fare}</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>
                                                <Calendar size={12} />
                                                {new Date(ride.createdAt).toLocaleDateString()} at {new Date(ride.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                            <div style={{ fontSize: '13px', color: '#1e293b' }}>
                                                <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                                                    <div style={{ color: '#10b981' }}>●</div>
                                                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ride.pickup ? "Pickup point" : "Unknown"}</div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <div style={{ color: '#ef4444' }}>●</div>
                                                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ride.destination ? "Destination point" : "Unknown"}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ flex: 1, position: 'relative' }}>
                <div className="notification-container" style={{ position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 2000, display: 'flex', flexDirection: 'column', gap: '10px', pointerEvents: 'none' }}>
                    {notifications.map(n => (
                        <div key={n.id} className={`notification ${n.type} fade-in`} style={{ 
                            background: n.type === 'error' ? '#ef4444' : n.type === 'success' ? '#10b981' : '#1e293b', 
                            color: 'white', 
                            padding: '12px 24px', 
                            borderRadius: '16px', 
                            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', 
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            minWidth: '320px',
                            justifyContent: 'center',
                            pointerEvents: 'auto',
                            animation: 'fadeIn 0.3s ease-out, fadeOut 0.5s ease-in 9.5s'
                        }}>
                            {n.type === 'success' ? <CheckCircle size={18} /> : n.type === 'error' ? <XCircle size={18} /> : <Zap size={18} />}
                            {n.msg}
                        </div>
                    ))}
                </div>

                <Map 
                    userLocation={pickup}
                    pickup={user?.role === 'passenger' ? pickup : (activeRide ? activeRide.pickup : null)}
                    destination={user?.role === 'passenger' ? destination : (activeRide ? activeRide.destination : driverDestination)}
                    markers={nearbyDrivers}
                    activeDriverLocation={activeRide?.driver?.location?.coordinates || activeRide?.driver?.location}
                    driverLocation={driverLocation}
                    remainingPath={remainingPath}
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
                            <button 
                                onClick={handleAcceptRide} 
                                disabled={accepting} 
                                style={{ flex: 1, background: '#1e293b', color: 'white', border: 'none', padding: '16px', borderRadius: '14px', fontWeight: 700, cursor: accepting ? 'not-allowed' : 'pointer', opacity: accepting ? 0.7 : 1 }}
                            >
                                {accepting ? 'Accepting...' : 'Accept'}
                            </button>
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
                            <button onClick={() => { setRideStatus('idle'); setStatus('idle'); setActiveRide(null); resetRideState(); }} style={{ width: '100%', background: '#1e293b', color: 'white', padding: '16px', borderRadius: '16px', fontWeight: 700, cursor: 'pointer', border: 'none' }}>Back to Map</button>
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
                @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
                @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            `}</style>
            {showReviewModal && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>🎉 Ride Completed</h2>
                        <p className="pay-text">Pay ₹{completedRideFare} to driver</p>
                        
                        <div className="stars">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <span
                                    key={star}
                                    onClick={() => setRating(star)}
                                    className={`star ${star <= rating ? "active-star" : ""}`}
                                >
                                    ★
                                </span>
                            ))}
                        </div>

                        <textarea
                            className="review-textarea"
                            placeholder="Write feedback..."
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                        />

                        <button className="submit-review-btn" onClick={handleSubmitReview}>
                            Submit
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background: rgba(0,0,0,0.6);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    backdrop-filter: blur(4px);
                }
                .modal {
                    background: white;
                    padding: 30px;
                    border-radius: 20px;
                    width: 340px;
                    text-align: center;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                    animation: modalIn 0.3s ease-out;
                }
                @keyframes modalIn {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                .modal h2 { margin-bottom: 10px; color: #1f2937; }
                .pay-text { font-size: 1.2rem; font-weight: 600; color: #059669; margin-bottom: 20px; }
                .stars { margin-bottom: 20px; display: flex; justify-content: center; gap: 8px; }
                .star { font-size: 32px; cursor: pointer; color: #d1d5db; transition: transform 0.1s; }
                .star:hover { transform: scale(1.1); }
                .active-star { color: #f59e0b; }
                .review-textarea {
                    width: 100%;
                    height: 80px;
                    padding: 12px;
                    border: 1px solid #e5e7eb;
                    border-radius: 10px;
                    margin-bottom: 20px;
                    font-family: inherit;
                    resize: none;
                }
                .submit-review-btn {
                    width: 100%;
                    padding: 12px;
                    background: #1f2937;
                    color: white;
                    border-radius: 10px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .submit-review-btn:hover { background: #374151; }
            `}</style>
        </div>
    );
};

export default Dashboard;
