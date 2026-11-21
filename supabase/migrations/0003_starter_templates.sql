-- Every new account starts with four templates, so the Docs side shows what a template can be before the person
-- writes a prompt of their own. They are ordinary templates: the person can edit or delete them.
-- The prompts are the first four examples in the New template dialog (src/components/TemplateDialog.tsx), and each
-- spec is what the keyword rules (shared/templates.ts) make of its prompt.
-- Sign-up happens between the browser and Supabase, so the server never sees it: the templates are added here, by
-- the database, when the account's row is created.
create function public.add_starter_templates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.templates (id, user_id, created_at, prompt, spec)
  select gen_random_uuid()::text, new.id, (extract(epoch from now()) * 1000)::bigint + t.position, t.prompt, t.spec::jsonb
  from (values
    (0, 'A weekly review of my ideas and notes, in a serif magazine style',
      '{"name":"Weekly review","emoji":"🗓️","title":"Weekly review of my ideas and notes","subtitle":"","include":["idea","note"],"groupBy":"week","sort":"newest","layout":"cards","hideDone":false,"showTime":true,"style":{"font":"serif","accent":"gray","density":"comfortable"},"note":""}'),
    (1, 'A reading list of everything I saved, as a compact list',
      '{"name":"Reading list","emoji":"📚","title":"Reading list of everything I saved","subtitle":"","include":["link"],"groupBy":"none","sort":"newest","layout":"list","hideDone":false,"showTime":true,"style":{"font":"sans","accent":"gray","density":"compact"},"note":""}'),
    (2, 'A moodboard gallery of my inspiration images',
      '{"name":"Moodboard gallery","emoji":"🖼️","title":"Moodboard gallery of my inspiration images","subtitle":"","include":["inspiration"],"groupBy":"none","sort":"newest","layout":"gallery","hideDone":false,"showTime":true,"style":{"font":"sans","accent":"gray","density":"comfortable"},"note":""}'),
    (3, 'Open to-dos grouped by topic, as a green checklist',
      '{"name":"Open to-dos","emoji":"☑️","title":"Open to-dos grouped by topic","subtitle":"","include":["todo"],"groupBy":"topic","sort":"newest","layout":"checklist","hideDone":true,"showTime":true,"style":{"font":"sans","accent":"green","density":"comfortable"},"note":""}')
  ) as t (position, prompt, spec);
  return new;
exception when others then
  -- Signing up must never fail because of this. The account is then created without the templates.
  raise warning 'add_starter_templates: %', sqlerrm;
  return new;
end;
$$;

-- Only the trigger runs it.
revoke all on function public.add_starter_templates() from public, anon, authenticated;

create trigger add_starter_templates after insert on auth.users
for each row execute function public.add_starter_templates();
