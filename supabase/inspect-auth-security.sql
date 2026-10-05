-- READ ONLY. Run in the Supabase SQL Editor to inspect schema/policies.
-- No table, role, user, grant, policy or order is changed by this script.
select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema in ('public', 'auth')
  and (table_name in ('profiles', 'orders', 'user_roles')
    or (table_schema = 'auth' and table_name = 'users'
        and column_name in ('id', 'raw_app_meta_data', 'raw_user_meta_data')))
order by table_schema, table_name, ordinal_position;

select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'storage') and c.relkind = 'r'
order by schema_name, table_name;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema in ('public', 'auth') and grantee in ('anon', 'authenticated')
order by table_schema, table_name, grantee, privilege_type;
