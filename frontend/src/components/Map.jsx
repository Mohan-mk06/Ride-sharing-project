import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const Map = ({ onMapClick, markers = [], pickup, destination, userLocation, activeDriverLocation, driverLocation, remainingPath = [], driverView }) => {
    const mapContainer = useRef(null);
    const mapRef = useRef(null);
    const markersRef = useRef({}); // Store markers by driver ID
    const pickupMarkerRef = useRef(null);
    const destMarkerRef = useRef(null);
    const activeDriverMarkerRef = useRef(null);
    const driverMarkerRef = useRef(null); // Ref for simulated driver marker
    const [mapLoaded, setMapLoaded] = useState(false);
    const currentLocMarkerRef = useRef(null);

    useEffect(() => {
        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        if (!token) {
            console.error('Mapbox token is missing!');
            return;
        }
        mapboxgl.accessToken = token;
        
        if (mapRef.current) return;

        mapRef.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/streets-v11',
            center: userLocation || [77.5946, 12.9716], // Bangalore
            zoom: 14,
            pitch: 45
        });

        mapRef.current.on('load', () => {
            setMapLoaded(true);
        });

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, []);

    // Handle Map Clicks
    useEffect(() => {
        if (!mapRef.current) return;

        const handler = (e) => {
            const coords = [e.lngLat.lng, e.lngLat.lat];
            console.log("Map clicked:", coords);
            if (onMapClick) {
                onMapClick(coords);
            }
        };

        mapRef.current.on('click', handler);

        return () => {
            if (mapRef.current) {
                mapRef.current.off('click', handler);
            }
        };
    }, [onMapClick]);

    // Handle Current Location Marker and flyTo
    useEffect(() => {
        if (!mapLoaded || !mapRef.current || !userLocation) return;

        mapRef.current.flyTo({ center: userLocation, zoom: 15 });

        if (!currentLocMarkerRef.current) {
            const el = document.createElement('div');
            el.innerHTML = '<div style="background: #10b981; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);"></div>';
            currentLocMarkerRef.current = new mapboxgl.Marker(el)
                .setLngLat(userLocation)
                .addTo(mapRef.current);
        } else {
            currentLocMarkerRef.current.setLngLat(userLocation);
        }
    }, [userLocation, mapLoaded]);


    // Handle Pickup Marker (GREEN)
    useEffect(() => {
        if (!mapLoaded || !mapRef.current) return;

        if (pickup) {
            if (!pickupMarkerRef.current) {
                pickupMarkerRef.current = new mapboxgl.Marker({ color: '#10b981', scale: 1.2 }) // Green
                    .setLngLat(pickup)
                    .addTo(mapRef.current);
            } else {
                pickupMarkerRef.current.setLngLat(pickup);
            }
        } else if (pickupMarkerRef.current) {
            pickupMarkerRef.current.remove();
            pickupMarkerRef.current = null;
        }
    }, [pickup, mapLoaded]);

    // Handle Destination Marker (RED)
    useEffect(() => {
        if (!mapLoaded || !mapRef.current) return;

        if (destination) {
            if (!destMarkerRef.current) {
                destMarkerRef.current = new mapboxgl.Marker({ color: '#ef4444', scale: 1.2 }) // Red
                    .setLngLat(destination)
                    .addTo(mapRef.current);
            } else {
                destMarkerRef.current.setLngLat(destination);
            }
        } else if (destMarkerRef.current) {
            destMarkerRef.current.remove();
            destMarkerRef.current = null;
        }
    }, [destination, mapLoaded]);

    // Handle Nearby Drivers (BLUE)
    useEffect(() => {
        if (!mapLoaded || !mapRef.current) return;

        // Create a set of current driver IDs for cleanup
        const currentDriverIds = new Set(markers.map(m => m._id));

        // Remove markers for drivers no longer present
        Object.keys(markersRef.current).forEach(id => {
            if (!currentDriverIds.has(id)) {
                markersRef.current[id].remove();
                delete markersRef.current[id];
            }
        });

        // Add or update markers for current drivers
        markers.forEach(driver => {
            const coords = driver.location.coordinates;
            if (markersRef.current[driver._id]) {
                markersRef.current[driver._id].setLngLat(coords);
            } else {
                const el = document.createElement('div');
                el.className = 'driver-marker';
                el.innerHTML = `<div style="background: #2563eb; width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(37, 99, 235, 0.5);"></div>`;
                
                const m = new mapboxgl.Marker(el)
                    .setLngLat(coords)
                    .addTo(mapRef.current);
                markersRef.current[driver._id] = m;
            }
        });
    }, [markers, mapLoaded]);

    // Handle Live Driver Tracking (Simulated)
    useEffect(() => {
        if (!mapLoaded || !mapRef.current || !driverLocation) return;

        console.log("📍 [Map] Updating driver marker:", driverLocation);
        console.log("Driver location received:", driverLocation);

        if (!driverMarkerRef.current) {
            driverMarkerRef.current = new mapboxgl.Marker({ color: "#2563eb", scale: 1.2 })
                .setLngLat(driverLocation)
                .addTo(mapRef.current);
        } else {
            driverMarkerRef.current.setLngLat(driverLocation);
        }
    }, [driverLocation, mapLoaded]);

    // Draw Route Line
    useEffect(() => {
        if (!mapLoaded || !mapRef.current) return;

        // 🔥 Case 1: Use remainingPath for simulation (disappearing line)
        if (remainingPath && remainingPath.length > 0) {
            if (mapRef.current.getSource('route')) {
                mapRef.current.getSource('route').setData({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: remainingPath
                    }
                });
            } else {
                mapRef.current.addSource('route', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: remainingPath
                        }
                    }
                });

                mapRef.current.addLayer({
                    id: 'route',
                    type: 'line',
                    source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 
                        'line-color': driverView ? '#3b82f6' : '#10b981', 
                        'line-width': 5, 
                        'line-opacity': 0.8 
                    }
                });
            }
            return; // Exit early if we have a simulation path
        }

        // 🔥 Case 2: Use static pickup/destination for initial planning
        if (!pickup || !destination) {
            if (mapRef.current?.getLayer('route')) mapRef.current.removeLayer('route');
            if (mapRef.current?.getSource('route')) mapRef.current.removeSource('route');
            return;
        }

        const drawRoute = async () => {
            try {
                let url;
                if (driverView && userLocation) {
                    // Route: Driver -> Pickup -> Destination
                    url = `https://api.mapbox.com/directions/v5/mapbox/driving/${userLocation[0]},${userLocation[1]};${pickup[0]},${pickup[1]};${destination[0]},${destination[1]}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;
                } else {
                    // Route: Pickup -> Destination
                    url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup[0]},${pickup[1]};${destination[0]},${destination[1]}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;
                }

                const res = await fetch(url);
                const data = await res.json();
                if (!data.routes || !data.routes[0]) return;

                const route = data.routes[0].geometry;

                if (mapRef.current.getSource('route')) {
                    mapRef.current.getSource('route').setData({
                        type: 'Feature',
                        geometry: route
                    });
                } else {
                    mapRef.current.addSource('route', {
                        type: 'geojson',
                        data: {
                            type: 'Feature',
                            geometry: route
                        }
                    });

                    mapRef.current.addLayer({
                        id: 'route',
                        type: 'line',
                        source: 'route',
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: { 
                            'line-color': driverView ? '#3b82f6' : '#10b981', 
                            'line-width': 5, 
                            'line-opacity': 0.8 
                        }
                    });
                }
            } catch (err) {
                console.error('Failed to draw route:', err);
            }
        };

        drawRoute();
    }, [pickup, destination, userLocation, mapLoaded, driverView, remainingPath]);

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div ref={mapContainer} className="map-container" style={{ width: '100%', height: '100%' }} />
            <style>{`
                .mapboxgl-ctrl-bottom-right, .mapboxgl-ctrl-bottom-left { display: none !important; }
                .driver-marker { cursor: pointer; transition: all 0.5s ease-in-out; }
                @keyframes pulse-animation {
                    0% { transform: scale(1); opacity: 0.8; }
                    100% { transform: scale(3); opacity: 0; }
                }
            `}</style>
        </div>
    );
};

export default Map;
