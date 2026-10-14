import { NavLink, Route, Routes } from 'react-router-dom';
import { CardPage } from './pages/CardPage';
import { Deals } from './pages/Deals';
import { Search } from './pages/Search';
import { SettingsPage } from './pages/SettingsPage';
import { Watchlist } from './pages/Watchlist';

const TABS = [
  { to: '/', label: 'Deals', icon: 'M3 17l6-6 4 4 8-8M21 7v6M21 7h-6' },
  { to: '/search', label: 'Search', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5' },
  { to: '/watchlist', label: 'Watchlist', icon: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z' },
  { to: '/settings', label: 'Settings', icon: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4' },
];

export function App() {
  return (
    <div className="app">
      <main className="content">
        <Routes>
          <Route path="/" element={<Deals />} />
          <Route path="/search" element={<Search />} />
          <Route path="/card/:id" element={<CardPage />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Deals />} />
        </Routes>
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className="tab">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={t.icon} />
            </svg>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
