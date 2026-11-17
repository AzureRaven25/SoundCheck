-- SoundCheck Score v1.1: two more categories (nullable: performances scored by v1.0 don't have them).
alter table public.performances add column duration_score real check (duration_score between 0 and 1);
alter table public.performances add column transition_score real check (transition_score between 0 and 1);
