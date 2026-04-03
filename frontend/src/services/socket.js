import { io } from 'socket.io-client';

let socket;

export const getSocket = () => {
    if (!socket) {
        // Use environment variable for backend URL if available
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
        socket = io(backendUrl, {
            transports: ['websocket'],
            autoConnect: true
        });
    }
    return socket;
};

export const disconnectSocket = () => {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
};

export const subscribeToEvent = (event, callback) => {
    const s = getSocket();
    s.on(event, callback);
    return () => s.off(event, callback); // Return unsubscribe function
};

export const emitEvent = (event, data) => {
    const s = getSocket();
    s.emit(event, data);
};
