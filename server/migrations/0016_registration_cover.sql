-- Optional cover image of a public registration form (an uploaded file,
-- /files/photos/...). Null = the page is shown without a cover.
alter table registration_pages add column cover_url text;
