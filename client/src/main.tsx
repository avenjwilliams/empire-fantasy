import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { LeagueTypeProvider } from './context/LeagueTypeContext.js';
import { TeamThemeProvider, applyTeamTheme } from './context/TeamThemeContext.js';
import { TEAM_STORAGE_KEY } from './context/TeamThemeContext.js';
import './theme.css';

// Apply the persisted team theme BEFORE React's first paint so there's no flash
// of the default amber theme. Inline setProperty on documentElement; when nothing
// is stored (or it's 'NONE') this no-ops and the plain :root theme remains.
// A useEffect here would run after the first paint and flash amber on every load.
(function applyPersistedTheme() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(TEAM_STORAGE_KEY);
  } catch { /* storage unavailable — keep default */ }
  applyTeamTheme(stored);
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <TeamThemeProvider>
        <LeagueTypeProvider>
          <App />
        </LeagueTypeProvider>
      </TeamThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);