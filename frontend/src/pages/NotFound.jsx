import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="mx-auto mt-24 max-w-md px-4 text-center">
      <Compass className="mx-auto mb-3 h-10 w-10 text-slate-400" aria-hidden />
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-slate-500">The page you are looking for does not exist, or you do not have access to it.</p>
      <Link to="/" className="btn-primary mt-5">Go to dashboard</Link>
    </div>
  );
}
