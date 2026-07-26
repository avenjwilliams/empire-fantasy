import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { LeagueTypeProvider } from './context/LeagueTypeContext.js';
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LeagueTypeProvider>
        <App />
      </LeagueTypeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
