import { Routes, Route, NavLink } from 'react-router-dom';
import LeagueTypeSelector from './components/LeagueTypeSelector.js';
import KtcPopup from './components/KtcPopup.js';
import Rankings from './pages/Rankings.js';
import PlayerDetail from './pages/PlayerDetail.js';
import Log from './pages/Log.js';
import Calculator from './pages/Calculator.js';
import KeepTradeCut from './pages/KeepTradeCut.js';

export default function App() {
  return (
    <>
      <KtcPopup />
      <header className="topbar">
        <div className="topbar__brand">Empire Fantasy</div>
        <nav className="topbar__nav">
          <NavLink to="/">Calculator</NavLink>
          <NavLink to="/rankings">Rankings</NavLink>
          <NavLink to="/ktc">KTC</NavLink>
          <NavLink to="/log">Log</NavLink>
        </nav>
        <LeagueTypeSelector />
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
