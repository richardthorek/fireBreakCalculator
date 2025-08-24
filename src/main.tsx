import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'leaflet/dist/leaflet.css'; // Leaflet's required CSS
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
