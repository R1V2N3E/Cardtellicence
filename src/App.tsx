import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { CardPage } from './pages/CardPage';
import { Deals } from './pages/Deals';
import { Portfolio } from './pages/Portfolio';
import { Scan } from './pages/Scan';
import { Search } from './pages/Search';
import { SettingsPage } from './pages/SettingsPage';
import { Watchlist } from './pages/Watchlist';

const TABS = [
  { to: '/', label: 'Deals', icon: 'M3 17l6-6 4 4 8-8M21 7v6M21 7h-6' },
  { to: '/search', label: 'Suche', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5' },
  { to: '/portfolio', label: 'Portfolio', icon: 'M7 4h11a1 1 0 0 1 1 1v13M4 7h11a1 1 0 0 1 1 1v12H5a1 1 0 0 1-1-1z' },
  { to: '/settings', label: 'Einstellungen', icon: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4' },
];

function Tab({ to, label, icon }: (typeof TABS)[number]) {
  return (
    <NavLink to={to} end={to === '/'} className="tab">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={icon} />
      </svg>
      <span>{label}</span>
    </NavLink>
  );
}

export function App() {
  const { pathname } = useLocation();
  if (pathname === '/scan') return <Scan />;
  return (
    <div className="app">
      <main className="content">
        <Routes>
          <Route path="/" element={<Deals />} />
          <Route path="/search" element={<Search />} />
          <Route path="/card/:id" element={<CardPage />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Deals />} />
        </Routes>
      </main>
      <nav className="tabbar">
        <Tab {...TABS[0]} />
        <Tab {...TABS[1]} />
        <NavLink to="/scan" className="scan-fab" aria-label="Karte scannen">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10" />
          </svg>
        </NavLink>
        <Tab {...TABS[2]} />
        <Tab {...TABS[3]} />
      </nav>
    </div>
  );
}
