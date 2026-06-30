import { Outlet } from 'react-router-dom';

// Standard padded content wrapper for top-level dashboard pages. Sections that
// render their own full-height chrome (e.g. a nested sidebar) opt out by not
// using this layout.
export const PaddedPage = () => (
  <div className="p-8 max-w-[1400px]">
    <Outlet />
  </div>
);
