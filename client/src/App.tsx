import { Routes, Route, NavLink } from 'react-router-dom';
import { useTeamTheme } from './context/TeamThemeContext.js';
import LeagueTypeSelector from './components/LeagueTypeSelector.js';
import TeamSelector from './components/TeamSelector.js';
import TeamPicker from './components/TeamPicker.js';
import KtcPopup from './components/KtcPopup.js';
import Rankings from './pages/Rankings.js';
import PlayerDetail from './pages/PlayerDetail.js';
import Log from './pages/Log.js';
import Calculator from './pages/Calculator.js';
import KeepTradeCut from './pages/KeepTradeCut.js';

export default function App() {
  const { setTeam, hasChosen } = useTeamTheme();
  // Two modals must never be on screen at once: on a true first visit the user
  // sees the team picker first; only after choosing (hasChosen) does the KTC
  // popup get a chance to mount. The conditional mount lives here, on the
  // <KtcPopup/> element — not inside the component (whose sessionStorage gate
  // we must not touch).

  return (
    <>
      {!hasChosen && <TeamPicker onSelect={setTeam} />}
      {hasChosen && <KtcPopup />}
      <header className="topbar">
        <div className="topbar__brand">Empire Fantasy</div>
        <nav className="topbar__nav">
          <NavLink to="/">Calculator</NavLink>
          <NavLink to="/rankings">Rankings</NavLink>
          <NavLink to="/ktc">KTC</NavLink>
          <NavLink to="/log">Log</NavLink>
        </nav>
        <LeagueTypeSelector />
        <TeamSelector />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Calculator />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/player/:assetId" element={<PlayerDetail />} />
          <Route path="/ktc" element={<KeepTradeCut />} />
          <Route path="/log" element={<Log />} />
        </Routes>
      </main>
    </>
  );
}