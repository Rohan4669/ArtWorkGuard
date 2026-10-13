import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FilePlus2, History, FolderOpen, UserCog, LogOut, Menu, X, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSystem } from '../context/SystemContext.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/comparisons/new', label: 'New comparison', icon: FilePlus2 },
  { to: '/comparisons', label: 'History', icon: History, end: true },
  { to: '/projects', label: 'Projects & files', icon: FolderOpen },
  { to: '/profile', label: 'Profile & settings', icon: UserCog },
];

export default function Layout() {
  const { user, logout } = useAuth(); const { appName } = useSystem(); const nav = useNavigate(); const [open, setOpen] = useState(false);
  const link = ({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`;
  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-5"><ShieldCheck className="h-6 w-6 text-brand-700" aria-hidden /><span className="text-lg font-semibold">{appName}</span></div>
      <ul className="flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => <li key={to}><NavLink to={to} end={end} className={link} onClick={() => setOpen(false)}><Icon className="h-4 w-4" aria-hidden />{label}</NavLink></li>)}
      </ul>
      <div className="border-t border-slate-200 p-3">
        <p className="truncate px-3 text-sm font-medium">{user.name}</p><p className="truncate px-3 pb-2 text-xs text-slate-500">{user.email}{user.role === 'admin' ? ' · admin' : ''}</p>
        <button className="btn-secondary w-full" onClick={async () => { await logout(); nav('/login'); }}><LogOut className="h-4 w-4" aria-hidden />Sign out</button>
      </div>
    </nav>
  );
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block"><div className="sticky top-0 h-screen">{sidebar}</div></aside>
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <span className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-brand-700" aria-hidden />{appName}</span>
        <button aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? <X /> : <Menu />}</button>
      </div>
      {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} /><div className="absolute left-0 top-0 h-full w-64 bg-white shadow-xl">{sidebar}</div></div>}
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-6xl"><Outlet /></div></main>
    </div>
  );
}
