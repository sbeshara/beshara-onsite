-- Profile photos: each person can upload their own picture, shown beside
-- their messages and wherever their initials appear.

alter table public.profiles add column if not exists avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500);
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- Pictures are public (anyone with the link can see them) so they load fast
-- everywhere; each person can only write inside their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: remove own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
