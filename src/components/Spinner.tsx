// Full-page centered spinner. Uses the CSS .spinner ring defined in index.css.
export const PageSpinner = () => (
  <div className="flex h-full w-full items-center justify-center py-24">
    <div className="spinner" role="status" aria-label="loading" />
  </div>
);

export const Spinner = () => <div className="spinner" role="status" aria-label="loading" />;
