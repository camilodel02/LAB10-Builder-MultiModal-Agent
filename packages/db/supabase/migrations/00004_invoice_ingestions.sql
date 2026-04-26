-- ============================================================
-- invoice_ingestions (audit trail for Drive/Invoice extraction)
-- ============================================================
create table public.invoice_ingestions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  source_provider text not null default 'google_drive',
  source_file_id  text not null,
  file_name       text not null default '',
  raw_text        text,
  extracted_json  jsonb not null default '{}',
  status          text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'written', 'failed')),
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, source_provider, source_file_id)
);

create index idx_invoice_ingestions_user_created
  on public.invoice_ingestions (user_id, created_at desc);

alter table public.invoice_ingestions enable row level security;

create policy "Users can manage own invoice ingestions"
  on public.invoice_ingestions for all
  using (auth.uid() = user_id);
