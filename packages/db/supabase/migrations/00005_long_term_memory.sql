-- ============================================================
-- Long-term memory storage + extraction queue
-- ============================================================
create extension if not exists vector;

create table public.user_memories (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  session_id         uuid references public.agent_sessions(id) on delete set null,
  memory_type        text not null
    check (memory_type in ('episodic', 'semantic', 'procedural')),
  content            text not null,
  embedding          vector(1536) not null,
  retrieval_count    integer not null default 0,
  last_retrieved_at  timestamptz,
  archived           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_user_memories_user_id
  on public.user_memories (user_id);

create index idx_user_memories_type_archived
  on public.user_memories (memory_type, archived);

create index idx_user_memories_vector
  on public.user_memories
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table public.user_memories enable row level security;

create policy "Users can manage own memories"
  on public.user_memories for all
  using (auth.uid() = user_id);

create table public.memory_extraction_jobs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  session_id        uuid not null references public.agent_sessions(id) on delete cascade,
  status            text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts          integer not null default 0,
  error_message     text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (session_id)
);

create index idx_memory_jobs_status_created
  on public.memory_extraction_jobs (status, created_at);

alter table public.memory_extraction_jobs enable row level security;

create policy "Users can view own memory jobs"
  on public.memory_extraction_jobs for select
  using (auth.uid() = user_id);

-- ============================================================
-- RPC: cosine similarity search for user memories
-- ============================================================
create or replace function public.match_user_memories(
  p_user_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 8,
  p_min_score float default 0.75
)
returns table (
  id uuid,
  user_id uuid,
  session_id uuid,
  memory_type text,
  content text,
  retrieval_count int,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
language sql
security definer
set search_path = public
as $$
  select
    m.id,
    m.user_id,
    m.session_id,
    m.memory_type,
    m.content,
    m.retrieval_count,
    m.created_at,
    m.updated_at,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from public.user_memories m
  where m.user_id = p_user_id
    and m.archived = false
    and (1 - (m.embedding <=> p_query_embedding)) >= p_min_score
  order by m.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 20));
$$;
