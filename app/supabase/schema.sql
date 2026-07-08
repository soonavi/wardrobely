-- Wardrobe app schema (mirrors src/lib/database.types.ts)

create type body_type as enum
  ('rectangle','hourglass','pear','apple','inverted_triangle','athletic');

create type garment_category as enum
  ('top','bottom','dress','outerwear','shoes','accessory');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  body_type body_type,
  created_at timestamptz not null default now()
);

create table public.garments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null,
  category garment_category not null,
  name text,
  color text,
  brand text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index garments_user_id_idx on public.garments(user_id);
create index garments_category_idx on public.garments(user_id, category);

create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);
create index outfits_user_id_idx on public.outfits(user_id);

create table public.outfit_items (
  outfit_id uuid not null references public.outfits(id) on delete cascade,
  garment_id uuid not null references public.garments(id) on delete cascade,
  layer_order int not null default 0,
  x float8 not null default 0,
  y float8 not null default 0,
  scale float8 not null default 1,
  rotation float8 not null default 0,
  primary key (outfit_id, garment_id)
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.garments enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "own garments" on public.garments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own outfits" on public.outfits
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own outfit items" on public.outfit_items
  for all using (
    exists (select 1 from public.outfits o
            where o.id = outfit_id and o.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.outfits o
            where o.id = outfit_id and o.user_id = auth.uid())
  );

-- Storage: garments bucket, path {user_id}/{garment_id}.jpg
insert into storage.buckets (id, name, public)
values ('garments', 'garments', false)
on conflict (id) do nothing;

create policy "own garment images select" on storage.objects
  for select using (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own garment images insert" on storage.objects
  for insert with check (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own garment images update" on storage.objects
  for update using (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own garment images delete" on storage.objects
  for delete using (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
