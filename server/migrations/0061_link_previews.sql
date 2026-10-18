-- A link on a piece's "Dateien" page shows a preview of the page it points
-- to: { title, description, site, image, fetched_at }, read once by the
-- server (server/linkFetch.ts) when the link is added or refreshed. `image`
-- is a copy kept in the piece's files, so viewing a link never contacts the
-- other site. Only the server writes it.
alter table piece_files add column link_preview json;
