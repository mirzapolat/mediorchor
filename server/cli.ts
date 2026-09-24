// Maintenance commands (the Supabase dashboard replacement):
//
//   node server/cli.ts create-admin <email> <password> [name]
//   node server/cli.ts make-admin <email>
//   node server/cli.ts reset-password <email> <new password>
//   node server/cli.ts disable-2fa <email>
//
// In Docker: docker compose exec web node server/cli.ts <command> …
import { db, migrate, loadTableMeta } from './db.ts';
import { createAccount, hashPassword, validatePassword } from './auth.ts';

migrate();
loadTableMeta();

const [command, ...args] = process.argv.slice(2);

const userId = (email: string | undefined) => {
  const row = db.prepare('select id from auth_users where email = ? collate nocase').get(email ?? '') as
    | { id: string }
    | undefined;
  if (!row) {
    console.error(`No account with email ${email}`);
    process.exit(1);
  }
  return row.id;
};

switch (command) {
  case 'create-admin': {
    const [email, password, name = 'Admin'] = args;
    if (!email || !password) {
      console.error('Usage: create-admin <email> <password> [name]');
      process.exit(1);
    }
    await createAccount({ email, password, name, confirmed: true, isAdmin: true });
    console.log(`Created admin ${email}`);
    break;
  }
  case 'make-admin': {
    db.prepare('update app_users set is_admin = 1 where id = ?').run(userId(args[0]));
    console.log(`${args[0]} is now an administrator`);
    break;
  }
  case 'reset-password': {
    const id = userId(args[0]);
    const hash = await hashPassword(validatePassword(args[1]));
    db.prepare('update auth_users set password_hash = ? where id = ?').run(hash, id);
    db.prepare('delete from auth_sessions where user_id = ?').run(id);
    console.log(`Password reset for ${args[0]}; all sessions signed out`);
    break;
  }
  case 'disable-2fa': {
    const id = userId(args[0]);
    db.transaction(() => {
      db.prepare('delete from auth_factors where user_id = ?').run(id);
      db.prepare('delete from auth_passkeys where user_id = ?').run(id);
      db.prepare('update auth_users set email_2fa = 0 where id = ?').run(id);
    })();
    console.log(`Two-factor authentication (authenticator app, passkeys, email codes) removed for ${args[0]}`);
    break;
  }
  default:
    console.log(
      'Commands:\n' +
        '  create-admin <email> <password> [name]\n' +
        '  make-admin <email>\n' +
        '  reset-password <email> <new password>\n' +
        '  disable-2fa <email>',
    );
}

db.close();
