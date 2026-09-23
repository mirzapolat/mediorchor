// Browser client for the app's own server (see server/). It mirrors the subset
// of the supabase-js API the app was written against — query builder, rpc,
// storage, auth, functions — so call sites read the same, but everything goes
// to same-origin /api endpoints backed by SQLite.
//
// Results never throw: like supabase-js they resolve to { data, error }.

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
}

export interface ApiResult<T = any> {
  data: T;
  error: ApiError | null;
  count?: number | null;
}

export interface SessionUser {
  id: string;
  email: string;
}

export interface Session {
  user: SessionUser;
}

type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED';
type AuthListener = (event: AuthEvent, session: Session | null) => void;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const listeners = new Set<AuthListener>();
let currentSession: Session | null = null;

const emit = (event: AuthEvent, session: Session | null) => {
  currentSession = session;
  for (const listener of listeners) listener(event, session);
};

const request = async <T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ data: T | null; error: ApiError | null }> => {
  let response: Response;
  try {
    const raw = body instanceof Blob;
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: raw || body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { data: null, error: { message: 'Network error: the server is unreachable' } };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error: ApiError = {
      message: payload?.error?.message ?? response.statusText ?? 'Request failed',
      code: payload?.error?.code,
      status: response.status,
    };
    // The session expired or was revoked elsewhere.
    if (response.status === 401 && currentSession) emit('SIGNED_OUT', null);
    return { data: null, error };
  }
  return { data: payload as T, error: null };
};

// ---------------------------------------------------------------------------
// Query builder (PostgREST-style subset, executed by server/rest.ts)
// ---------------------------------------------------------------------------

type Filter = [string, string, unknown];
type Action = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

class QueryBuilder implements PromiseLike<ApiResult> {
  private action: Action = 'select';
  private columns: string | undefined;
  private filters: Filter[] = [];
  private orders: { column: string; ascending?: boolean; nullsFirst?: boolean }[] = [];
  private limitCount: number | undefined;
  private countMode: 'exact' | undefined;
  private headOnly = false;
  private values: unknown;
  private onConflict: string | undefined;
  private singleMode: 'single' | 'maybe' | undefined;
  private readonly table: string;

  constructor(table: string) {
    this.table = table;
  }

  // On reads: the select list. After a write: return these columns.
  select(columns = '*', options: { count?: 'exact'; head?: boolean } = {}) {
    if (this.action === 'select') {
      this.countMode = options.count;
      this.headOnly = Boolean(options.head);
    }
    this.columns = columns;
    return this;
  }

  insert(values: object | object[]) {
    this.action = 'insert';
    this.values = values;
    return this;
  }

  upsert(values: object | object[], options: { onConflict?: string } = {}) {
    this.action = 'upsert';
    this.values = values;
    this.onConflict = options.onConflict;
    return this;
  }

  update(values: object) {
    this.action = 'update';
    this.values = values;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  private filter(column: string, operator: string, value: unknown) {
    this.filters.push([column, operator, value]);
    return this;
  }

  eq(column: string, value: unknown) {
    return this.filter(column, 'eq', value);
  }
  neq(column: string, value: unknown) {
    return this.filter(column, 'neq', value);
  }
  gt(column: string, value: unknown) {
    return this.filter(column, 'gt', value);
  }
  gte(column: string, value: unknown) {
    return this.filter(column, 'gte', value);
  }
  lt(column: string, value: unknown) {
    return this.filter(column, 'lt', value);
  }
  lte(column: string, value: unknown) {
    return this.filter(column, 'lte', value);
  }
  like(column: string, pattern: string) {
    return this.filter(column, 'like', pattern);
  }
  ilike(column: string, pattern: string) {
    return this.filter(column, 'ilike', pattern);
  }
  in(column: string, values: readonly unknown[]) {
    return this.filter(column, 'in', values);
  }
  is(column: string, value: null | boolean) {
    return this.filter(column, 'is', value);
  }
  not(column: string, operator: string, value: unknown) {
    return this.filter(column, `not.${operator}`, value);
  }

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.orders.push({ column, ...options });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.singleMode = 'single';
    return this;
  }

  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }

  private async execute(): Promise<ApiResult> {
    const { data, error } = await request<{ data: unknown; count: number | null }>('POST', '/api/db', {
      table: this.table,
      action: this.action,
      columns: this.columns,
      filters: this.filters,
      order: this.orders,
      limit: this.singleMode ? 2 : this.limitCount,
      count: this.countMode,
      head: this.headOnly,
      values: this.values,
      onConflict: this.onConflict,
    });
    if (error || !data) return { data: null, error, count: null };

    if (this.singleMode && Array.isArray(data.data)) {
      const rows = data.data;
      if (rows.length > 1 || (this.singleMode === 'single' && rows.length === 0)) {
        return {
          data: null,
          error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
          count: data.count,
        };
      }
      return { data: rows[0] ?? null, error: null, count: data.count };
    }
    return { data: data.data, error: null, count: data.count };
  }

  then<R1 = ApiResult, R2 = never>(
    onfulfilled?: ((value: ApiResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// ---------------------------------------------------------------------------
// Server functions, storage, admin functions
// ---------------------------------------------------------------------------

const rpc = async (name: string, args: Record<string, unknown> = {}): Promise<ApiResult> => {
  const { data, error } = await request<{ data: unknown }>('POST', `/api/rpc/${encodeURIComponent(name)}`, args);
  return { data: data?.data ?? null, error };
};

const encodeKey = (path: string) => path.split('/').map(encodeURIComponent).join('/');

const storage = {
  from: (bucket: string) => ({
    upload: async (
      path: string,
      file: Blob,
      options: { upsert?: boolean; contentType?: string; cacheControl?: string } = {},
    ): Promise<ApiResult<{ path: string } | null>> => {
      const headers: Record<string, string> = { 'x-upsert': options.upsert ? 'true' : 'false' };
      headers['Content-Type'] = options.contentType || file.type || 'application/octet-stream';
      const { data, error } = await request<{ path: string }>(
        'POST',
        `/api/storage/${bucket}/${encodeKey(path)}`,
        file,
        headers,
      );
      return { data, error };
    },
    remove: async (paths: string[]): Promise<ApiResult<{ name: string }[] | null>> => {
      const { data, error } = await request<{ name: string }[]>('DELETE', `/api/storage/${bucket}`, { paths });
      return { data, error };
    },
    // Files are public and served by the app itself, so the URL is relative.
    getPublicUrl: (path: string, options: { download?: string } = {}) => {
      const query = options.download ? `?download=${encodeURIComponent(options.download)}` : '';
      return { data: { publicUrl: `/files/${bucket}/${encodeKey(path)}${query}` } };
    },
  }),
};

const functions = {
  invoke: async (name: string, options: { body?: unknown } = {}): Promise<ApiResult> => {
    const { data, error } = await request('POST', `/api/functions/${encodeURIComponent(name)}`, options.body ?? {});
    return { data, error };
  },
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface SessionPayload {
  session: Session | null;
  mfa_required?: boolean;
  email_change_pending?: boolean;
}

const auth = {
  getSession: async (): Promise<{ data: { session: Session | null }; error: ApiError | null }> => {
    const { data, error } = await request<SessionPayload>('GET', '/api/auth/session');
    currentSession = data?.session ?? null;
    return { data: { session: currentSession }, error };
  },

  onAuthStateChange: (listener: AuthListener) => {
    listeners.add(listener);
    return { data: { subscription: { unsubscribe: () => void listeners.delete(listener) } } };
  },

  // With two-factor enabled the first call answers mfaRequired; call again
  // with the 6-digit code.
  signInWithPassword: async (credentials: { email: string; password: string; code?: string }) => {
    const { data, error } = await request<SessionPayload>('POST', '/api/auth/login', credentials);
    if (data?.session) emit('SIGNED_IN', data.session);
    return {
      data: { session: data?.session ?? null, mfaRequired: Boolean(data?.mfa_required) },
      error,
    };
  },

  // Without email confirmation the account is signed in right away; with it,
  // session is null until the emailed link is opened.
  signUp: async (input: { email: string; password: string; options?: { data?: { name?: string } } }) => {
    const { data, error } = await request<SessionPayload>('POST', '/api/auth/signup', {
      email: input.email,
      password: input.password,
      name: input.options?.data?.name ?? '',
    });
    if (data?.session) emit('SIGNED_IN', data.session);
    return { data: { session: data?.session ?? null }, error };
  },

  signOut: async () => {
    const { error } = await request('POST', '/api/auth/logout', {});
    emit('SIGNED_OUT', null);
    return { error };
  },

  updateUser: async (changes: { email?: string; password?: string }) => {
    const { data, error } = await request<SessionPayload>('PATCH', '/api/auth/user', changes);
    if (data?.session) emit('USER_UPDATED', data.session);
    return { data: { emailChangePending: Boolean(data?.email_change_pending) }, error };
  },

  mfa: {
    listFactors: async () => {
      const { data, error } = await request<{ totp: { id: string; status: 'verified' | 'unverified' }[] }>(
        'GET',
        '/api/auth/mfa/factors',
      );
      return { data, error };
    },
    enroll: async (_options: { factorType: 'totp' }) => {
      const { data, error } = await request<{ id: string; totp: { secret: string; uri: string } }>(
        'POST',
        '/api/auth/mfa/enroll',
        {},
      );
      return { data, error };
    },
    verify: async (input: { factorId: string; code: string }) =>
      request<{ ok: boolean }>('POST', '/api/auth/mfa/verify', input),
    unenroll: async (input: { factorId: string }) =>
      request<{ ok: boolean }>('POST', '/api/auth/mfa/unenroll', input),
  },
};

export const api = {
  from: (table: string) => new QueryBuilder(table),
  rpc,
  storage,
  functions,
  auth,
};
