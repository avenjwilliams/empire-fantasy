import { Routes, Route, NavLink } from 'react-router-dom';
import LeagueTypeSelector from './components/LeagueTypeSelector.js';
import Rankings from './pages/Rankings.js';
import PlayerDetail from './pages/PlayerDetail.js';
import Log from './pages/Log.js';
import Calculator from './pages/Calculator.js';

export default function App() {
  return (
    <>
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
          <Route path="/ktc" element={<Placeholder name="Keep / Trade / Cut" />} />
          <Route path="/log" element={<Log />} />
        </Routes>
      </main>
    </>
  );
}

function Placeholder({ name }: { name: string }) {
  return (
    <div className="page">
      <h1 className="page__title">{name}</h1>
      <p className="text-muted">Coming in a later phase.</p>
    </div>
  );
}
