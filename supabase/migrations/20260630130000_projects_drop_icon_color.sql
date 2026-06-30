-- ============================================================================
-- Projects are reduced to a name + optional description; drop icon and color.
-- ============================================================================

alter table public.projects drop column if exists color;
alter table public.projects drop column if exists icon;
