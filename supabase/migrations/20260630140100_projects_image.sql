-- ============================================================================
-- Projects get an optional round logo/image, shown next to the project name.
-- Stored in the existing public "photos" bucket.
-- ============================================================================

alter table public.projects add column if not exists image_url text;
