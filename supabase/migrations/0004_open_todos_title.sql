-- The "Open to-dos" starter template was headed "Open to-dos grouped by topic", but the page is only split by topic
-- when its to-dos have topics, and often they have none. The heading is now "Open to-dos", which is what the
-- keyword rules (shared/templates.ts) now make of the prompt. Nothing else about the starter templates changes.

-- Accounts that already have the template.
update public.templates
set spec = jsonb_set(spec, '{title}', '"Open to-dos"')
where prompt = 'Open to-dos grouped by topic, as a green checklist' and spec->>'title' = 'Open to-dos grouped by topic';

-- New accounts. The same function as in 0003_starter_templates.sql, with the one heading changed.
create or replace function public.add_starter_templates() returns trigger
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
      '{"name":"Open to-dos","emoji":"☑️","title":"Open to-dos","subtitle":"","include":["todo"],"groupBy":"topic","sort":"newest","layout":"checklist","hideDone":true,"showTime":true,"style":{"font":"sans","accent":"green","density":"comfortable"},"note":""}')
  ) as t (position, prompt, spec);
  return new;
exception when others then
  -- Signing up must never fail because of this. The account is then created without the templates.
  raise warning 'add_starter_templates: %', sqlerrm;
  return new;
end;
$$;
