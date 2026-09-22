-- The private bucket is an Edge/service-role write boundary.  Bucket privacy
-- alone does not revoke table privileges granted through Storage defaults.
revoke insert, update, delete on table storage.objects from public, anon, authenticated;
