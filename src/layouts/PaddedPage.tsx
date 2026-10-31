import { Outlet } from 'react-router-dom';
import { PAGE_PADDING } from '@/lib/pagePadding';

// Standard padded content wrapper for top-level dashboard pages. Sections that
// render their own full-height chrome (e.g. a nested sidebar) opt out by not
// using this layout.
export const PaddedPage = () => (
  <div className={`max-w-[1400px] ${PAGE_PADDING}`}>
    <Outlet />
  </div>
);
