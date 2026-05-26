-- Atomic quota increment — called by the service role after a query is created.
-- Security definer so the function runs as the owner regardless of caller privileges.
create or replace function public.increment_monthly_queries(p_user_id uuid)
returns void
language sql
security definer
as $$
  update public.profiles
  set monthly_queries_used = monthly_queries_used + 1
  where id = p_user_id;
$$;
