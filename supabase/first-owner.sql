-- After you create your own user in Supabase (Authentication > Users > Add user),
-- copy that user's UUID and run this, replacing the two placeholders.
insert into public.profiles (id, name, email, role, title, is_owner)
values ('PASTE-YOUR-USER-UUID-HERE', 'Njau', 'your-email@example.com', 'directors', 'Owner', true);
