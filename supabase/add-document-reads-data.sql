-- supabase/add-document-reads-data.sql
--
-- Lets document_reads remember a quote as well as a certificate.
--
-- The cache is keyed on the Drive file id plus its modification time, which is
-- a property of a file rather than of insurance, so it already generalises. The
-- only thing missing was somewhere to put a payload whose shape is not a
-- certificate's: a total, what the total does and does not cover, the terms
-- printed beside it.
--
-- Additive. Nothing existing changes meaning, no row is rewritten, and a
-- certificate read continues to use exactly the columns it used before.
--
-- Run this in the Supabase SQL editor.

alter table document_reads
  add column if not exists data jsonb default '{}'::jsonb;

comment on column document_reads.data is
  'Kind-specific payload. For kind = ''quote'': total, coversWholeScope, quoteDate, validUntil, validityText, scope, lineItems, pricedSeparately, exclusions.';

-- kind was documented as 'coi' | 'w9'. It is now 'coi' | 'w9' | 'quote'.
comment on column document_reads.kind is
  'coi | w9 | quote. Which sort of document was read.';

-- PostgREST answers from a cached picture of the schema and will keep
-- rejecting writes that mention the new column until it is told to look again.
notify pgrst, 'reload schema';

-- Says plainly whether this worked. Expect one row: data  present
select
  'data' as column_name,
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name  = 'document_reads'
      and column_name = 'data'
  ) then 'present' else 'MISSING, the alter above did not run' end as status;
