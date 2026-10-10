-- "Vorgesungen": managers tick on the Fehlzeiten page who has already
-- auditioned in this project. Member rows are per project, so the flag is too.
alter table members add column auditioned boolean not null default 0;
