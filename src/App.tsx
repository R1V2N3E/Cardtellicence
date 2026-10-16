import { VisionScan } from './pages/VisionScan';
import { AlertBanner, useAlertCheck } from './ai/alerts';
import { Ai } from './pages/Ai';
import { ZoomViewer } from './components/Zoom';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { CardPage } from './pages/CardPage';
import { Deals } from './pages/Deals';
import { Portfolio } from './pages/Portfolio';
import { Scan } from './pages/Scan';
import { Search } from './pages/Search';
import { SettingsPage } from './pages/SettingsPage';
import { Watchlist } from './pages/Watchlist';
import { Market } from './pages/Market';
import { MarketSet } from './pages/MarketSet';
import { usePushSync } from './push';

const TABS = [
  { to: '/', label: 'Deals', icon: 'M3 17l6-6 4 4 8-8M21 7v6M21 7h-6' },
  { to: '/search', label: 'KI & Suche', icon: 'M10.5 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-5-5M19 2.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z' },
  { to: '/portfolio', label: 'Portfolio', icon: 'M7 4h11a1 1 0 0 1 1 1v13M4 7h11a1 1 0 0 1 1 1v12H5a1 1 0 0 1-1-1z' },
  { to: '/market', label: 'Markt', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
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
  const { pathname, search } = useLocation();
  usePushSync();
  const alerts = useAlertCheck();
  if (pathname === '/scan') {
    const mode = new URLSearchParams(search).get('mode');
    return (
      <>
        {mode === 'shop' || mode === 'condition' ? <VisionScan mode={mode} /> : <Scan />}
        <ZoomViewer />
      </>
    );
  }
  return (
    <div className="app">
      <main className="content">
        <Routes>
          <Route path="/" element={<Deals />} />
          <Route path="/search" element={<Search />} />
          <Route path="/ai" element={<Ai />} />
          <Route path="/card/:id" element={<CardPage />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/market" element={<Market />} />
          <Route path="/market/set/:id" element={<MarketSet />} />
          <Route path="*" element={<Deals />} />
        </Routes>
      </main>
      <ZoomViewer />
      <AlertBanner {...alerts} />
      <nav className="tabbar">
        <Tab {...TABS[0]} />
        <Tab {...TABS[3]} />
        <NavLink to="/scan" className="scan-fab" aria-label="Karte scannen">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10" />
          </svg>
        </NavLink>
        <Tab {...TABS[2]} />
        <Tab {...TABS[1]} />
      </nav>
    </div>
  );
}
