# Functional Specification

A complete, implementation-agnostic description of everything this application does. Anyone reading this should be able to rebuild the app from scratch on any stack.

---

## 1. What the product is

An attendance-management tool for a musical ensemble / club (orchestra, choir, band). It has three intertwined jobs:

1. **Attendance tracking** — projects contain rehearsals ("events"), rehearsals have member attendance, and attendance rolls up into statistics and absence reports.
2. **Self-service intake** — public, link-based QR check-in forms and public registration/sign-up pages that let people mark themselves present or apply to join, with or without an account.
3. **Rehearsal material** — a per-project library of musical pieces with attached sheet music, audio, links and notes, plus a bar-by-bar practice player that maps a recording onto the score.

Alongside these, a separate **club-member directory** holds the association's formal membership records (postal addresses etc.), which is deliberately unrelated to project participation.

Everything is multilingual (German and English) and re-brandable (app name, accent color, logo).

---

## 2. Core concepts and vocabulary

| Concept | Meaning |
|---|---|
| **Account** | A login (email + password). Every account is the same kind of object; capabilities are granted through flags. |
| **Project** | A workspace: a named ensemble/season/production. Owns its members, events, groups, pieces, registration pages and settings. |
| **Group** | A subdivision inside a project (e.g. "Sopran", "1. Geige") with a name and a color. Each project maintains one central, ordered set of groups (the Groups page); it is the only source of selectable groups anywhere in the project. |
| **Member** | A person inside one project. Has a name, optional group, optional email, optional photo, and a status. A member row may be **linked** to an account. |
| **Participation** | An account is a participant in a project when it has an *active linked member row* there. |
| **Event / rehearsal** | A dated (optionally timed) occasion inside a project, with an attendance list. |
| **Attendance** | One record per (event, member) with status *present*, *excused*, or *absent*. |
| **Guest** | A person added ad-hoc to a single event; kept out of the regular member list. |
| **Check-in** | A per-event public QR/link form where people mark themselves present. |
| **Registration page** | A per-project public link where people sign up to join; submissions can later be transferred into the member list. |
| **Piece** | A musical work inside a project, with an ordered list of content blocks. |
| **Block** | One content item on a piece: a file, an audio recording, a link, or a Markdown text. |
| **Club member** | A record in the association-wide member directory (name, salutation, address, contact, active/passive). Independent of projects. |
| **Absence label** | A saved, reusable set of attendance conditions with a name, optionally shown to the matching participants themselves. |

---

## 3. Roles, permissions and visibility

There are no role names in the data — only capability flags on each account. An account with no flags is a plain participant.

### 3.1 Capability flags

| Flag | Grants |
|---|---|
| **Administrator** | Full access to everything, including account administration and instance configuration. Multiple accounts may hold it. |
| **Project management** | May create projects and manage projects within their scope. |
| **Project scope** | Either *all projects* (default) or *only explicitly selected projects*. Only meaningful together with project management. |
| **Club access** | May view and edit the club-member directory. Off by default. |

Administrators implicitly hold every other capability; the UI shows their toggles as on and locked. An administrator cannot remove their own administrator flag, and administrators cannot be deleted.

### 3.2 Effective access rules

- **Managing a project** requires: administrator, OR project management + (all-projects scope OR that project explicitly in scope).
- **Participating in a project** requires: an active linked member row in that project AND the project's "allow account access" toggle being on.
- Managers see everything in a project. Participants see only the participation page and (if the project allows it) the pieces area.
- A single account can be a manager of project A and a mere participant in project B.
- The projects list shows managers every project they manage and participants every project they participate in.
- Access is enforced server-side, not only in the UI: a participant must be unable to read other members' names, attendance, registrations, check-in submissions or club records by any means.

### 3.3 Own-profile safety

An account may edit its own display name, email and password, but must never be able to change its own capability flags or project scope through any self-service path.

---

## 4. Authentication and account lifecycle

### 4.1 Sign-in

- Email + password form on a centered card showing the app logo and name.
- Failure shows the real reason where useful (e.g. "email not confirmed") and a generic "invalid credentials" message for bad passwords.
- **Deep-link memory:** if an unauthenticated visitor opens any in-app URL, they are sent to the login page and, after signing in, returned to exactly that URL. Only safe in-app paths are accepted as return targets (never absolute or protocol-relative URLs).

### 4.2 Self sign-up

- Controlled by a single instance-wide setting, "Allow self-signup". The login page reads this setting without needing a session; when off, no sign-up link is offered at all.
- Sign-up asks for name, email and password (minimum 8 characters).
- Email confirmation is required: after submitting, the user sees a "Confirm your email" screen and cannot sign in until they've clicked the link.
- A profile record is created automatically for every new login.

### 4.3 Automatic membership claiming

Unlinked member rows whose email matches an account's **confirmed** email address (ignoring case and surrounding whitespace) are attached to that account automatically:

- **When a member row is created or its email changes** (manual add, CSV import, transfer, …) and a matching account already exists, it is linked immediately.
- **When an account signs in** and whenever it opens "My participation", any still-unlinked matching rows are claimed.
- At most one link per project; the oldest matching member row per project wins.
- Never creates a second link where one already exists.
- The operation is idempotent and safe to run repeatedly.
- Effect: someone a manager added (or who checked in as a guest or registered publicly) with the same email automatically sees that membership and history on "My participation".

### 4.4 Account settings page

- Laid out in two columns when the screen is wide enough (profile left; language and two-factor right), one column otherwise.
- Edit display name, email address and set a new password.
- **Name propagation:** changing the display name renames every linked member row across all projects. The name is split into first/last at the last space. A manager may afterwards rename that member within a project; the UI then flags "name differs from account" and shows the account's name.
- UI language switch (German / English), remembered per browser.
- **Two-factor authentication** via time-based one-time codes: enroll (shows a QR code to scan, then asks for a 6-digit confirmation code), and disable.
- **Delete account:** a card explaining the consequences opens a dialog that requires the current password and, when two-factor authentication is enabled, a current code from the authenticator app (the code field appears automatically; a missing or wrong code is rejected with its own message). Deleting removes the account, its sign-in, sessions, pending email links, 2FA and project-management scope; member rows linked to it stay (with their attendance history) but are unlinked — signing up again later with the same email re-links them automatically. The last remaining administrator cannot delete their account ("Make someone else an administrator first"). Afterwards the user lands on the login page.

### 4.5 Account administration (administrators only)

A dedicated administration area with its own sidebar (Users, Configuration) and a "back" link to the main app.

**User list** — a table of all accounts with: first name (with avatar) and last name (the display name split at the last space), email, role (Administrator / Member), project-management state (*All* / *Partial* / *No*), and club access (*Yes* / *No*). Searchable by name/email, filterable by each of those three dimensions.

**Create user** — name, email and password; the account is created already email-confirmed.

**User detail** — avatar, name, email, and toggles for:
- Administrator ("Full access to everything, including user management"); disabled for oneself.
- Project management; disabled (and shown as on) for administrators.
- Project access: opens a dialog offering "Access to all projects" or, when off, a checkbox list of individual projects. Disabled unless the account has project management.
- Club members access; disabled (and shown as on) for administrators.
- Delete user (hidden for oneself, blocked for other administrators), with confirmation showing the name and email.

**Configuration** — currently just the "Allow self-signup" toggle.

---

## 5. Layout, navigation and design system

### 5.1 Shell

Every authenticated screen is a **left sidebar + scrolling content** layout. Content is capped at a comfortable max width with generous padding that shrinks on small screens.

The sidebar is a shared shell reused by every section:
- **Header** — an icon/logo plus the current context's name (app name, project name + logo, event name + date/time, "Admin settings", "Club (beta)"). Sub-contexts (project, event, admin) additionally show a "back" row at the very top.
- **Nav items** — icon + label, active item highlighted, optional red warning badge with a count.
- **Footer** — Admin link (administrators only), then an **account card**: a rounded, bordered rectangle with the user's avatar (initials), name and email linking to account settings, and sign-out as an icon-only button (tooltip "Sign out", turns red on hover). Collapsed, the card shows just the avatar above the sign-out icon.
- **Collapsible** to a 64px icon rail (labels become tooltips; badges become a red dot).
- **Resizable** by dragging the right edge (200–440px).
- Collapsed state and width persist per browser, and independently per sidebar so a nested sidebar keeps its own preference.
- **On mobile** the sidebar becomes an off-canvas drawer opened from a fixed top bar; it closes on navigation, locks background scroll, and shows a close button. A nested sidebar suppresses its own top bar and instead renders a horizontal scrolling tab strip.

### 5.2 Navigation map

```
/                        Projects list
/account                 Account settings
/club/members            Club member list
/club/members/:id        Club member detail (":id = new" creates one)
/club/applications       Membership applications (placeholder: "Coming soon")
/club/rules              Rules (placeholder: "Coming soon")
/admin/users             User list
/admin/users/:id         User detail
/admin/config            Instance configuration

/projects/:id                        → redirects to /participation
/projects/:id/participation          My participation          (everyone)
/projects/:id/pieces                 Pieces                    (managers; participants if enabled)
/projects/:id/pieces/:pid            Piece detail
/projects/:id/pieces/:pid/practice/:bid   Bar practice view
/projects/:id/events                 Events                    (managers only)
/projects/:id/members                Members                   (managers only)
/projects/:id/members/:mid           Member detail             (managers only)
/projects/:id/groups                 Groups                    (managers only)
/projects/:id/groups/:gid            Group detail              (managers only)
/projects/:id/registrations          Registration pages        (managers only)
/projects/:id/registrations/:rid     Registration page detail  (managers only)
/projects/:id/absences               Absences                  (managers only)
/projects/:id/statistics             Statistics                (managers only)
/projects/:id/settings               Project settings          (managers only)

/projects/:id/events/:eid            Event attendance          (managers only, own sidebar)
/projects/:id/events/:eid/check-in   Event check-in
/projects/:id/events/:eid/settings   Event settings

/check-in/:token         PUBLIC event check-in form
/register/:token         PUBLIC registration form
```

Rules:
- The two public routes bypass authentication entirely and render even for signed-out visitors; they never show app chrome.
- Opening a project always lands on "My participation".
- Participants who try to reach a management route are redirected to the participation page. Non-administrators reaching the admin area are redirected home.
- Any unknown route redirects home.

### 5.3 Visual language

- **Palette:** near-white page background (`#fafafa`), white surfaces, light grey borders (`#e5e5e5`), near-black text (`#1a1a1a`) with secondary (`#6b6b6b`) and tertiary (`#9a9a9a`) tiers. A configurable **accent color** (default amber `#efa100`) with an auto-darkened hover variant. Semantic greens for present/success (`#16a34a`, `#16803b`) and reds for warnings (`#b91c1c` on `#fef2f2`).
- **Type:** Inter, 400/500/600/700.
- **Radius:** 6px everywhere. Borders, not shadows, define structure. Transitions are 150ms color fades.
- **Buttons:** primary (black), secondary (white with border), accent (accent-colored — also used for destructive confirmations). Each with an icon slot, disabled at 50% opacity, visible focus ring.
- **Cards:** white, bordered, 6px radius, 20px padding.
- **Page header:** large title, optional subtitle, right-aligned action buttons; wraps to two rows on mobile.
- **Avatars:** photo if present, else up to two initials on a light grey circle; a rounded-square variant for project logos.
- **Status badges:** outlined pills — green "Present", accent "Excused", grey "Absent".
- **Modals:** centered, blurred dark backdrop, title bar with close button, scrollable body, sticky footer with actions. Size presets from medium to extra-wide.
- **Confirm dialog:** a modal with a message and a cancel/confirm pair; the confirm button uses the accent style when destructive.
- **Empty states:** a large muted icon over a short message.
- **Spinner:** a rotating ring; a full-page variant is shown while a page's data loads.

### 5.4 The data table

Nearly every list in the app is the same reusable table component. It supports:

- **Sorting** — click a header to cycle none → ascending → descending → none; the active direction shows a chevron, inactive sortable columns show a faint up/down glyph. Null values sort last.
- **Free-text search** — one input filtering across a per-table concatenation of fields.
- **Dropdown filters** — any number, each with an "All" option and an optional default value.
- **Reset** — appears whenever any filter, search or pin is active and clears them all.
- **Row click** — navigates to a detail view; optionally restricted so only some rows are clickable (unclickable rows lose the pointer and hover styling).
- **Row actions** — a right-aligned column of small square icon buttons that never trigger the row click.
- **Selection** — an optional leading checkbox column with a header checkbox that selects/deselects all *currently visible* rows and shows an indeterminate state; selected rows are tinted blue.
- **Pinning/highlighting** — one row can be pinned to the top and tinted green regardless of sort (used for the next rehearsal).
- **Drag reordering** — an optional leading grip column. Dragging works with mouse and touch, the dragged row lifts with a shadow and follows the pointer, other rows slide out of the way, and the new order is committed once on release. Column sorting is disabled in this mode.
- Empty state with a custom message and icon; horizontal scroll on narrow screens.

---

## 6. Projects

### 6.1 Projects list (home)

Table of projects with columns: name (with round logo and an "Archived" tag) and description. Searchable by name and description; filtered by status with **Active** preselected. Clicking a row opens the project.

Users with project management get: a "New project" button (name + optional description) and per-row actions to edit (opens project settings), archive/restore, and delete (with confirmation). Plain participants see the list read-only.

### 6.2 Project settings

A single form, saved as a whole. The save button (with its "✓" acknowledgement) sits in the page header so it is always within reach. On wide screens the cards are laid out in two columns — identity on the left, access settings and "delete project" on the right. Groups are managed on their own page (§8.5).

**Identity**
- Project image (round/square logo): upload, preview, remove. Shown next to the project name everywhere and, optionally, in the centre of check-in QR codes.
- Project name (required) and optional description.


**Access & forms** — six independent toggles:

| Toggle | Effect |
|---|---|
| Allow account access | Participants can sign in, see the project and view their own attendance. Off ⇒ nobody participates via account. |
| Allow account check-in | Check-in forms offer signing in and checking in with an account. |
| Allow account sign-up | Registration forms offer signing up with an account. |
| Allow guest check-in | Check-in forms work without an account. |
| Allow guest sign-up | Registration forms work without an account. |
| Show pieces to participants | Participants see the pieces area (scores, audio, practice view). |

### 6.3 Project sidebar

- **My participation** — always visible.
- **Events** — managers only; carries a red badge with the number of unrecognized check-ins across the whole project, refreshed every 5 seconds while the tab is visible.
- **Members**, **Groups** — managers only.
- **Pieces** — managers, plus participants when the project allows it.
- **Registration**, **Absences**, **Statistics**, **Settings** — managers only.

---

## 7. My participation

The page every account gets inside a project — including managers and administrators, for their own participation.

### 7.1 Not participating

A single card, "Join project":
- If the account has never had a member row here: first name / last name (prefilled by splitting the account's display name at the last space) plus a **required** group dropdown when the project defines groups. Hint: "You are not participating in this project yet. Join to be included in attendance."
- If the account previously left: no name fields, and the hint becomes "You left this project. You can rejoin at any time; your previous attendance is kept."

Joining rules: a manager/administrator may join any project they can access. A plain account may only *re-activate* an existing link — new participants arrive via check-in, sign-up, or a manager adding them. A group must be one of the project's defined groups.

### 7.2 Participating

Four cards:

1. **My group** — a dropdown of the project's groups, saved immediately with a "✓". Once a group is set it can be changed but not cleared (the server rejects an empty group while the project has groups). If the project defines no groups, a muted "No groups are available for this project."
2. **Upcoming events** — every event dated today or later, name (with its description in small text below, if any) plus date and time.
3. **My attendance** — every past or undated event (newest first) with its description in small text below the name, if any, and its own status badge. Undated events count as held. Above the list, any **public absence labels** whose conditions this person currently matches are shown as accent-outlined chips.
4. **Leave project** — an accent button with a confirmation. Leaving archives the member row: the person disappears from the active member list and loses participant access, but their attendance history is preserved and rejoining restores everything.

---

## 8. Members (project)

### 8.1 Member list (managers)

Table columns: first name (with avatar), last name (with an "Archived" tag and an accent "Name differs from account: …" note when the linked account's display name diverges), group (as a group pill, §8.5), email. Searchable across name/group/email; filters for status (Active preselected / Archived) and group (the project's group list). Row click opens the member. Row actions: edit, archive/restore, delete.

Guest members never appear here.

### 8.2 Member form (create / edit)

- **Account link (create only):** a debounced search box ("Name or email…") that queries existing accounts by name or email and shows up to 10 results with avatar, name and email. Selecting one pins it, prefills first/last name (split at last space) and email, and shows a remove button. Hint text explains: pick an account to add it as a member, or fill the fields below to create one manually; when the search finds nothing: "No matching account found. The member will be created manually."
  - Saving with a linked account **re-activates** any existing member row for that account in this project instead of creating a duplicate — one link per account per project.
- Photo upload with avatar preview.
- First name, last name (both required).
- Group (optional) — a dropdown of the project's groups.
- Email (optional).

### 8.3 CSV import

A guided dialog:

1. **File** — pick a `.csv`. The parser handles quoted fields, escaped quotes, embedded newlines, a leading byte-order mark, and auto-detects the delimiter among comma, semicolon and tab. Fully blank rows are dropped.
2. **Header row** — a checkbox for "First row contains column names"; when off, generic "Column N" headers are generated and every record is data.
3. **Column mapping (graphical)** — the first 5 rows are shown as a preview table ("… and *n* more" below). Above every column sits a chip-styled dropdown to assign what the column contains: *First name*, *Last name*, *Full name*, *Email*, *Group* or *Not used*. Each attribute has its own color and icon; assigned columns are tinted in that color with a colored top edge, unused columns are greyed out. Assigning an attribute moves it from any other column (one column per attribute, one attribute per column). Columns are **pre-assigned** from the headers by substring matching in both languages (`vorname/first/given`, `nachname/last/surname/familien`, `mail`, `gruppe/group/team/klasse/stimme/instrument/register`); a "name" header without a first/last qualifier becomes the full name when first and last name aren't both found.
   - Names: first and last name come from their own columns; a *Full name* column fills whatever is missing, split at the last space. Required is either first + last name, or a full name (then single-token names are allowed). Until then an accent note asks for it.
4. **New groups** — shown only when the group column contains groups the project doesn't have (values matching an existing group apart from case are mapped to it silently). For each new group the manager chooses: **create it as a new group** (default; appended to the project's groups with the next palette color), **assign its rows to an existing group**, or **remove** it (those rows get no group).
5. **Result preview** — "How members will be created": the first 3 resulting members (first name, last name, email, group pill). The footer states "*n* of *total* rows will be imported"; rows without a usable name are skipped.

Import is a single batch operation; errors are surfaced inline.

### 8.4 Member detail

- Back link, avatar, full name, the account-name-deviation note if any, and the group pill followed by the email.
- Three stat cards: number of times present, excused, and total events attended-or-recorded.
- An attendance history table: event name (with a "Guest" tag where applicable), date, and status badge. Searchable by event name, filterable by status. Rows link to the event.
- An edit button opening the member form.

### 8.5 Groups

A project page of its own (sidebar: **Groups**, managers only). Groups live in their own table with a name, a color and a position.

**Group list** — a table of all groups in their configured order: the group pill and the number of active members in it. Rows are **drag-sortable**; that order is used everywhere (check-in and registration forms, the participation picker, member forms, group filters). Row click opens the group; row actions edit and delete. Hint in the header: "The order here is used everywhere … Drag to reorder."

**Distribution chart** — on wide screens a second, sticky column next to the table: a card "Distribution · Active members per group" with a **donut chart** of active members per group in the group colors, in the configured order starting at 12 o'clock, separated by thin surface-colored gaps; members without a group form a grey hatched segment ("No group"). The hole shows the total ("64 Members"); hovering a segment or legend row lifts that segment slightly, fades the others and shows its name, count and share in the hole. Below it a legend (color dot, name, count, percentage) doubles as the accessible table view; clicking a segment or row opens the group. On narrow screens the card stacks under the table. New groups get their preset colors in an order validated so that neighbouring segments stay distinguishable, including for colour-blind readers.

**Create / edit dialog** — group name (unique within the project regardless of case; a duplicate is flagged inline) and a color: ten preset swatches (rose, orange, amber, green, teal, sky, indigo, purple, pink, slate) or a **custom color** via the system color picker. A live pill preview shows the result. New groups preselect the next palette color. Editing a name notes that the rename applies to all members.

**Delete** — confirmation stating how many members will lose their group.

**Group detail** — back link, the group name with its active member count, edit and delete buttons, the pill, and a table of the group's members (first name with avatar, last name, email, and a status column with a green "Active" or grey "Archived" dot), searchable, with a status filter (all members shown by default). Row click opens the member.

**Group pills** — wherever a group is shown in a table or on a member (members, group detail, event attendance, check-in submissions and the assign picker, absences, registrations, member detail), it is rendered as a rounded pill tinted with the group's color and a colored dot. A group that isn't in the project (a pending webhook registration) renders grey.

**Consistency rules (enforced by the database):**
- Renaming a group renames it on every member and every pending registration with that group.
- Deleting a group clears the group of every member in it.
- A member saved with a group that doesn't exist (by any path) creates that group automatically with the next palette color, so no member is ever in a group the project doesn't list.

---

## 9. Events and attendance

### 9.1 Events list (managers)

Table sorted by date ascending (then time; undated events last), columns: name (with the optional description in small text below, clamped to two lines), date, time. Search by name and description; filter by timeframe (Upcoming / Past). Create dialog: name (required), optional description (up to 500 characters), optional date, optional time.

Two badges appear inline on rows:
- The **next rehearsal** — the nearest event dated today or later — is pinned to the top, tinted green, and tagged "Today" or "Next rehearsal". Resetting the filters unpins it.
- Any event with unrecognized check-ins gets a red "*n* not recognized" badge. Counts refresh every 5 seconds.

Row actions: edit (opens event settings) and delete. Clicking a row **enters** the event.

### 9.2 Inside an event

An event gets its own sidebar layout, so opening it feels like entering it: a back link to the events list, the event name with its date and time, and three nav items — **Attendance**, **Check-in** (with the unrecognized-count warning badge), **Settings**.

### 9.3 Attendance page

- Header subtitle: "*x* present · *y* excused · *z* total".
- Table rows: avatar + name (with a "Guest" tag), group, and a three-way segmented control — **Present** (green when active), **Excused** (accent when active), **Absent** (grey when active). Clicking a segment saves immediately and updates optimistically.
- Rows are all active project members, plus any guests attached to *this* event only, sorted by last then first name. Search by name; filter by status and group. Clicking a row opens the member.
- **Add member** dialog: first and last name, then a choice — "Add as guest" (one-off, kept out of the member list) or "Add to project" (a permanent member). Either way the person is immediately marked present at this event.

### 9.4 Event settings

Name, optional description, date and time in a card with a "✓" on save, plus a delete card with confirmation that returns to the events list.

---

## 10. Public check-in

### 10.1 Manager side (event → Check-in)

- A large QR code encoding the public check-in URL, rendered with high error correction. When the project has a logo and the "show logo" option is on, the logo is punched into the centre of the code.
- **Started / stopped state:** when stopped, the QR is faded to 15% with a padlock overlaid, and the status line reads "Check-in is stopped" (grey dot) instead of "Check-in is active" (green dot). New check-ins default to **stopped** until someone starts them.
- Big **Start / Stop** button (accent when active), and a **reset** action that mints a brand-new token, instantly invalidating the previous QR code and link.
- The public URL is shown as a clickable link, plus three actions:
  - **Copy link** → "Link copied."
  - **Copy image** → renders the QR into a 1200×1200 white PNG and puts it on the clipboard → "QR code copied as a PNG." Falls back to "Copying is not supported by this browser."
  - **Show fullscreen** → an immersive white overlay with the event name and a very large QR (closable with Escape or the ✕), for projecting onto a wall.
- **Configuration dialog:** which attendance status a successful check-in produces (*Present* or *Excused*), and whether the project image appears inside the QR code.

**Submission lists** (polled every 5 seconds):

- **Not recognized** — shown only when non-empty, with a red count badge. Columns: name, group, submission timestamp. Row actions:
  - **Assign check-in** — opens a picker that, before any typing, offers up to 6 **similar members** ranked by a fuzzy name-similarity score with the percentage shown next to each ("87% similarity"). Typing switches to a plain substring search over name and group. Both comparisons ignore case, accents, ß/ss and punctuation; the score weights the last name slightly more than the first, also considers the full name as one string, and gets a small boost when the group matches exactly. Only members scoring ≥55% are suggested. Assigning writes the attendance record and marks the submission recognized.
  - **Save as new member** — a prefilled, editable form (first name, last name, group) that creates a new active project member and assigns the submission to them.
  - **Delete** the submission.
- **Successful check-ins** — the recognized submissions with a count, same columns, no actions.

### 10.2 Visitor side (`/check-in/:token`)

A standalone centered page with the app logo, "Check in to event", the event name and the project name. Behaviour depends on state:

- **Invalid token** → padlock + "This QR code is no longer valid."
- **Stopped** → padlock + the event name + "This check-in is not open right now."
- **Active, signed in, account check-in allowed, already a member of this project** → a one-tap flow: a card showing their name and group and a single "Check in" button. If guest check-in is also allowed, a link offers "Check in as a guest instead".
- **Active, signed in, but not yet in this project** → the normal form with the note "You are not part of this project yet. Checking in will add you to the project."
- **Active, guest flow** → first name, last name, and a **required group dropdown** populated from the project's groups. If no groups exist the form is disabled with "No groups are available for this project." When account check-in is allowed and the visitor is signed out, a "Sign in to check in with your account" link appears which returns to this exact page after signing in.
- **Guest check-in disabled and not signed in** → padlock + "Checking in without an account is disabled for this project." plus the sign-in link when account check-in is allowed.

**Server-side matching rules for a guest submission:** an active member of that project is matched when first name AND last name (case- and whitespace-insensitive) AND group all match. On a match, attendance is written (or overwritten) with the configured status and an audit row is recorded as *recognized*. With no match, only an audit row is recorded as *not recognized* — no member is created. Fields are validated (non-empty, ≤120 characters).

**Account check-in rules:** the caller's linked member row is used; if none exists it is created (an implicit join), and if it was archived it is re-activated. The account's own name and group are used, never typed values.

On success the card is replaced with a green check and "Your check-in was submitted successfully."

The public endpoints never expose member names or any other project data — only the event name, project name and the group list.

---

## 11. Public registration

### 11.1 Registration pages (managers)

In the UI the list is titled **Registrations** (*Anmeldungen*, also the sidebar label) and each page is called a **source** (*Quelle*): "New source", "Edit source", "No sources yet".

A project can have any number of registration pages, each of one of two **types**, chosen when it is created:
- **Form** — the public registration wizard (§11.3), shared by link or QR code.
- **Webhook** — entries arrive from an external tool (Google Forms, Microsoft Forms, Zapier, IFTTT, Make, …) through a secret URL (§11.4).

Both types feed the same registrations list, table, transfer and auto-transfer. The list shows title, type (icon + label), active/inactive state (colored dot) and the number of registrations received. Search by title, filter by type and state.

**Page editor:**
- Type (on creation only): two option cards, Form / Webhook.
- Title (required).
- *Form pages only:*
  - Description written in a **Markdown editor**: a toolbar (heading, bold, italic, bullet list, insert link) over a textarea, plus a Write/Preview tab pair that renders the same Markdown the public page will show. Toolbar actions operate on the current selection and restore it afterwards.
  - "Ask for email" and "Ask for group" toggles. The group hint notes that the selectable groups come from the project settings. (Webhook pages always show the email and group columns.)
- "Auto-transfer" toggle: new registrations are added to the member list immediately.

### 11.2 Registration page detail

- Back link, title, "*n* registrations", an edit button, and an Activate/Deactivate button (accent when active).
- A status card: colored dot with "Registration is active/inactive", for form pages the public URL as a link with a copy-link button that flips to "Link copied.", and the auto-transfer checkbox toggled inline.
- Webhook pages additionally show the webhook panel (§11.4).
- **Registrations table** — columns first name, last name, (email if asked), (group if asked), transfer status (green "Transferred" / grey "Pending"), and registered-at timestamp. Search across all name/email/group fields; filter by transfer status.
  - A pending registration whose group isn't one of the project's groups (possible for webhook entries) shows an accent note "Not in the project – adjust before transferring".
  - **Inline editing:** the edit row action turns the name/email/group cells into inputs, with save (✓) and cancel (✕) actions.
  - **Per-row transfer** action (hidden once transferred).
  - **Delete** with confirmation.
  - **Bulk selection:** checkboxes enable "*n* selected" plus bulk *Transfer to members* and bulk *Delete* (with a confirmation warning it cannot be undone).
  - **Transfer all** button showing the count of pending rows, replaced by the bulk actions while a selection exists.
  - **Transfer a selection** (next to Transfer all, also hidden while rows are selected) opens a dialog to transfer only part of the pending registrations:
    - **The first *n*** — the earliest *n* by registration time; a numbered preview lists who will be transferred (first 8, then "and *n* more").
    - **Random draw** — *n* registrations drawn uniformly at random **on the server** with a cryptographically secure random source, so the draw can't be influenced from the browser.
    - The number is set with a −/+ stepper or typed, limited to 1…pending ("of *N* pending registrations"). The submit button reads "Transfer *n*" / "Draw and transfer *n*".
    - Afterwards the dialog lists exactly who was transferred (numbered, with check marks) until closed with "Done"; the table refreshes behind it. Transfers follow the usual transfer semantics.

**Transfer semantics:** transferring creates an active project member from the registration and marks it transferred. If the registration was submitted by a signed-in account that *already* has a member row in that project, that row is re-activated (and its group updated) rather than duplicated, and the new member is linked to the account. Transferring an already-transferred registration is a no-op.

### 11.3 Visitor side (`/register/:token`)

A four-step wizard with progress dots at the top, on a centered card under the app logo, the page title and the project name.

- **Invalid token** → "This registration link is no longer valid."
- **Deactivated** → the title + "This registration is not open right now."
- **Guest sign-up disabled and no account flow available** → "Registering without an account is disabled for this project." plus a "Sign in to register with your account" link when account sign-up is allowed.

**Step 1 — Intro.** The Markdown description (or a fallback line). Signed-in visitors registering with their account see a card with their name and "You are registering with your account." Links let a signed-out visitor sign in (returning to this page), a signed-in visitor continue as a guest, and a guest-mode visitor switch back to their account.

**Step 2 — Your details.** First name, last name; email if the page asks for it; group dropdown if the page asks for it, populated from the project groups. In account mode name and email are prefilled from the account and **locked** ("Name and email are taken from your account. Only the group is chosen per project.") — the account's verified address always wins. Next is disabled until the required fields are filled.

**Step 3 — Review.** A definition list of everything entered, a privacy notice ("By submitting you consent to your data being stored and processed for the purpose of managing your registration. The data will not be shared with third parties."), and a required consent checkbox. Submit is disabled until it's ticked.

**Step 4 — Done.** Green check + "Your registration was submitted successfully."

**Important rule:** submitting a registration — even with an account — does *not* create membership. Membership only happens through a transfer (manual or automatic). The account identity is remembered on the registration so the transfer can link it.

A webhook page's token never opens the public form (it shows "no longer valid"), and a form page's token is never accepted by the webhook endpoint.

### 11.4 Webhook registrations

**Endpoint:** `POST /api/webhooks/registrations/:token`, one registration per request. The unguessable token in the URL is the only credential; "Generate new URL" (with a confirmation) rotates it and the old URL stops working immediately. A `GET` on the URL answers "reachable" without creating anything. Requests are rate-limited per URL and capped at 64 KB.

**Accepted bodies:** JSON (flat or nested objects; arrays of `{title|label|question: …, answer|value: …}` pairs; arrays of plain values are joined with ", "), `application/x-www-form-urlencoded`, `multipart/form-data`, and JSON sent as `text/plain`. Query parameters are merged in.

**Field detection:** each target — first name, last name, full name, email, group — is taken from the explicitly mapped field if the page has one, otherwise detected by name (case, spacing, punctuation and accents ignored; German and English synonyms such as "Vorname", "Surname", "E-Mail-Adresse", "Stimme", "Instrument"). A full name fills whatever of first/last name is missing, split at the last space. A first name is required; the last name may stay empty.

**Groups:** matched against the project's groups ignoring case. An unknown group is kept on the registration, and such a registration is **never auto-transferred** — a manager adjusts the group first.

**Responses:** `200 {"ok": true, "transferred": bool}`; `422` `missing_name` / `invalid_input` (values over 120 characters, email over 200); `409` `inactive`; `404` unknown URL.

**Webhook panel** (on the page detail, two columns on wide screens):
- **Webhook URL** with copy button and "Generate new URL", plus a hint to treat the URL like a password.
- **Last delivery & mapping** (one card) — timestamp and outcome (Accepted / Rejected: no name found / values too long / registration inactive), a refresh button, and the received fields as a list (up to 50 fields, values truncated; stored for rejected deliveries too, so a failing setup can be diagnosed). Each row shows the field name, its value and the same attribute chip as the CSV import: fields the server **detected** show their attribute with a dashed "AUTO" chip, explicitly chosen ones a solid chip; rows in use are tinted with a colored left edge. Choosing an attribute fixes it for that field (moving it from any other field); choosing *Not used* on a detected field **switches that attribute off** (it is then neither mapped nor detected). Below the list: "Switched off: …" and "Restore automatic detection" to clear all choices. Saved immediately.
- **Re-mapping pending registrations:** every webhook registration stores the fields it arrived with (up to 50 fields, values truncated). Whenever the mapping changes (including "Restore automatic detection"), all **pending** (not transferred) registrations of the page are re-derived from their stored fields with the new mapping — same rules as on arrival, including case-insensitive group matching — and the table refreshes. Transferred registrations never change. A registration edited by hand drops its stored fields and keeps the manual values; registrations from before this feature have no stored fields either. Rows the new mapping can't produce a name for stay unchanged. A green note reports the outcome ("Mapping saved – *n* pending registrations updated · *n* unchanged because no name would be found · *n* without raw data"). The detection shown for the last delivery is recomputed at the same time.
- **Setup** — tabs with step-by-step guides for Google Forms (a copy-ready Apps Script with the URL filled in, installed as an "On form submit" trigger), Microsoft Forms (Power Automate), Zapier, IFTTT, Make and "Other" (formats, detected fields, responses and a curl example), each noting plan requirements where relevant.

---

## 12. Absences

A manager tool for finding people by attendance pattern and exporting the result.

### 12.1 Metrics

For each member of the project (active and archived): **present**, **excused**, and **absent**, where absent = total number of events in the project minus present minus excused (floored at zero).

### 12.2 Condition builder

An ordered list of rows, each: a connector (the first row reads "When", the rest are an AND/OR dropdown), a metric (Present / Excused / Absent), a comparison (≥ at least, > more than, = exactly, < less than, ≤ at most), a numeric count, and a remove button. "Add condition" appends a row.

Evaluation: **AND binds tighter than OR** — `A OR B AND C` means `A OR (B AND C)`. An empty condition list matches everyone.

### 12.3 Labels

Condition sets can be saved as named **labels**:
- Saving asks for a name and a "Public" checkbox ("Public labels are shown to participants on 'My participation' when they apply to them").
- Saved labels appear as a row of chips above the builder; clicking one loads its conditions into the editor and marks the chip active. Editing any condition deactivates the chip.
- A gear button opens a management dialog: drag to reorder, toggle public inline, delete — each change saved immediately.

### 12.4 Results

A table of matching members: avatar + name (with an "Archived" tag), group, email, and three numeric columns (present / excused / absent, present shown in green). Search across name/group/email; filters for status (Active preselected / Archived) and group. Clicking a row opens the member. The header shows how many members match.

**Exports** operate on the *currently visible* rows (after search and filters):
- **Download CSV** — semicolon-separated, quoted, UTF-8 with BOM so spreadsheet software in German locales opens it correctly.
- **Download PDF** — an A4 document with a title ("Absences – <project>"), page numbers, a grey header band, and one line per member with name, group and the three counts; text is truncated with an ellipsis to fit its column, and it paginates automatically.
- **Copy name list** — puts one name per line on the clipboard → "Name list copied."

Filenames are slugified from the project name. Failures show "Export failed."

---

## 13. Statistics

A read-only overview for a project, covering only events that have a date.

- Four stat cards: **attendance rate** (present ÷ all recorded slots, as a percentage), **average present per rehearsal** (one decimal), **total attendances**, **total excuses**.
- A stacked column chart, "Attendance over time", one column per dated event in chronological order, each stacked green (present) / accent (excused) / light grey (absent), with a legend. Column heights are normalised against the largest total across events and the current active-member count, so columns are comparable. Hovering a column shows a tooltip with the event name, full date and the three counts. The date is printed beneath each column and the chart scrolls horizontally when there are many events.
- With no dated events: "No data yet. Add rehearsals with a date and record attendance."

---

## 14. Pieces

### 14.1 Piece list

An ordered list of the project's musical works: name and composer. Managers can create/edit pieces (name + composer), **drag rows to reorder** them, and delete a piece (confirmation warns that all of its content is removed permanently; attached files are cleaned up from storage too). Participants get the same list read-only, but only when the project's "Show pieces to participants" toggle is on.

### 14.2 Piece detail

Header shows the piece name and composer, an edit button, and an "Add block" dropdown offering the four block types. Below, a reorderable two-column table:

- **Name** — a type icon plus the block title (falling back to the file name).
- **Target** — the block's primary content, rendered inline:
  - **File** → a bordered download button with the original file name.
  - **Audio** → an inline player (see below) with a download button.
  - **Link** → a bordered button showing the URL that opens in a new tab. Only `http`/`https` URLs are ever rendered as clickable — anything else is neutralised.
  - **Text** → the Markdown rendered directly in the cell.

Rows are clickable only when the block is an audio block that declares bars — those open the practice view.

Managers can edit and delete blocks (deleting also removes the stored file) and drag to reorder.

### 14.3 Block editor

Type is fixed by which menu entry was used. Per type:

- **File / Audio** — a dashed drop-style file picker showing the selected/current file name, the note "A new file replaces the current one." when editing, and an optional display name (placeholder = file name). Audio pickers accept audio types only.
- **Audio, additionally** — a "This audio file has bars" checkbox ("Enables starting playback at a specific bar on a dedicated practice page"). When ticked, three linked numeric fields appear: *number of bars*, *starts at bar*, *ends at bar*. They stay mutually consistent — changing the count or start recomputes the end; changing the end recomputes the count. Defaults: start 1, end = count. Validation requires start ≥ 1 and end ≥ start.
- **Link** — display name (required) and URL (required). A URL without a scheme gets `https://` prepended; anything that isn't http/https is rejected with "Please enter a valid http(s) URL."
- **Text** — display name (required) and the Markdown editor with live preview.

Uploaded files are stored under keys derived from the piece, using generated names rather than the original file name (so spaces, umlauts etc. never break uploads) while download links still serve the original file name. Replacing a file deletes the old object.

### 14.4 Audio player

An inline bordered player: play/pause (black round button), current time, a seekable range slider, total duration, and — on wider screens — a mute toggle and volume slider. An optional download button sits at the end. It exposes a slot for extra controls, and can hand its underlying audio element to a parent that needs to control playback.

### 14.5 Practice view

For an audio block with bars. The recording is assumed to be **evenly divided** across its bar range, so bar *n* starts at `(n − first) × (duration ÷ number of bars)`.

- **Header** — the block title and "*N* number of bars (first–last)". Managers additionally get: *Add / Replace score PDF*, *Anchor bars* (a toggle that becomes *Done*), and *Remove score PDF* (confirmation: "The score PDF and all bar anchors will be removed.").
- **Player card** — the audio player extended with a **loop toggle** and a **playback-speed** selector (0.5×, 0.75×, 1×, 1.25×, 1.5×). Below it: the current bar number, the current selection, a clear-selection button, and the hint "Tap a bar to start playback there. Shift-click selects a range."
- **Bar grid** — a responsive grid of square buttons, one per bar. Clicking a bar seeks there and starts playback; shift-clicking a later bar extends the selection into a range. The bar currently sounding is filled black and shows a **live progress fill** sweeping across it (driven by an animation frame loop so it's smooth, not the coarse timeupdate rate). Selected bars are outlined.
- **Playback behaviour** — with a range selected, playback stops (and rewinds to the range start) at the end of the range; with loop on, it jumps back to the start of the range instead. With no end selected, playback runs to the end of the file.
- **Score PDF** — when attached, the PDF is rendered at full container width, one page below the next, above the bar grid. Bars can be **anchored** onto the sheet music:
  - In anchor mode, the grid selects which bar to place next (defaulting to the first bar without an anchor), and clicking a spot in the PDF pins that bar there. The banner reads "Click the spot in the PDF for bar *n*." or "All bars are anchored.", with the sub-hint "Drag moves an anchor, click removes it. Use the grid to choose the next bar."
  - Anchors are stored as a page number plus fractional x/y coordinates, so they scale with any rendering width.
  - Out of anchor mode, the anchored bar buttons sit directly on the score as bright red pills. Clicking one starts playback at that bar (shift-click extends the selection). The bar currently sounding grows and gets a glowing red halo so it's trackable while playing.
  - Anchor changes save immediately; a failure shows an inline error.
- The PDF renderer is loaded lazily, only for pages that actually show a score, and shows "The PDF could not be loaded." on failure.

---

## 15. Club (association directory)

Shown in the navigation as **Club (beta)** / *Verein (Beta)*.

A workspace-wide directory, gated behind the club-access capability, with its own nested sidebar (Members / Membership applications / Rules) that becomes a horizontal tab strip on mobile. Applications and Rules are placeholders showing "Coming soon".

**Member list** — columns: name (title + first + last), city, email, phone, and an active/passive status with a colored dot. Search across name, email, phone and city; filter by status. Row click opens the record; row actions edit and delete.

**Member record** — a form laid out in three cards:

1. **Details** — salutation (Herr / Frau / Divers), title, first name (required), last name (required), status (Active / Passive).
2. **Contact** — email, phone.
3. **Address** — care-of ("Zusatz / c/o"), street and number, address addition (hint: "e.g. building, floor or apartment number"), postal code, city, country.

The header shows the assembled full name, a delete button (with confirmation) and a save button that turns into a "Saved" acknowledgement. Creating a new record redirects to its own page after saving.

This directory is completely separate from project members — no linking, no shared data.

---

## 16. Cross-cutting behaviours

**Internationalisation** — every visible string comes from a German/English dictionary. The default language comes from configuration; the user's choice overrides it and persists per browser. Dates and times are formatted per locale (`de-DE` vs. `en-GB`/`en-US`). Note the domain wording: the German term for "event" is *Probe* (rehearsal), and the club section is *Verein*.

**Branding** — app name, accent color and default language are deployment configuration, resolvable at container start without rebuilding the frontend. The accent color drives a CSS variable and an auto-darkened hover shade; the app name sets the document title; the logo is the favicon.

**Polling** — check-in submission lists, the events list and the sidebar warning badges refresh every 5 seconds, but only while the browser tab is visible.

**Optimistic updates** — attendance toggles, drag reordering, label changes and group changes apply instantly in the UI and reconcile with the server afterwards.

**Markdown** — a deliberately small subset is supported everywhere Markdown appears: headings (1–3 levels), bullet and numbered lists, bold, italic, inline code, and links. Links are only rendered as clickable for `http`, `https`, `mailto` and in-app paths. Text is always escaped.

**Destructive actions** always go through a confirmation dialog with an explicit warning that they cannot be undone.

**Name splitting** — wherever a single display name must become first/last, the split happens at the **last space**; single-token names get an empty last name. This heuristic is used identically for account names, CSV imports and registration prefills.

**Storage** — member/project images and piece attachments live in public buckets. Object keys are always generated (never the raw file name); downloads still present the original file name. Deleting a piece or block cleans up its stored files.

**Server-side privileged operations** — creating and deleting accounts require elevated privileges and therefore run server-side behind an admin check, never in the browser. Deleting oneself or another administrator is rejected.

---

## 17. Data model summary

```
account            id, email, name, is_admin, can_manage_projects,
                   all_projects, can_access_club, created_at
account_project     (account, project)            ← explicit scope when all_projects = false

instance_settings  app_name, accent_color, icon, language, allow_self_signup

project            id, name, description, image_url,
                   status (active|archived),
                   allow_account_access, allow_account_checkin, allow_account_signup,
                   allow_guest_checkin, allow_guest_signup, allow_participant_pieces,
                   created_at, created_by

project_group      id, project, name (unique per project, case-insensitive),
                   color (#rrggbb), position, created_at

member             id, project, first_name, last_name, group_name, email, photo_url,
                   status (active|archived|guest), account (nullable), created_at
                   — unique: one linked member per (project, account)

event              id, project, name, description?, date?, time?, created_at
attendance         id, event, member, status (attended|excused|not_attended), is_guest
                   — unique: (event, member)

event_checkin      event, token, is_active, attendance_status (attended|excused),
                   show_logo, updated_at
checkin_submission id, event, member?, first_name, last_name, group_name,
                   recognized, attendance_status?, submitted_at

registration_page  id, project, token, source (form|webhook), title, description,
                   ask_email, ask_group, is_active, auto_transfer,
                   webhook_mapping {target: field}, webhook_last_payload
                   {fields, matched}, webhook_last_received_at,
                   webhook_last_status, created_at
registration       id, page, first_name, last_name, email?, group_name?,
                   member?, transferred, account?, raw_payload? (webhook fields),
                   created_at

piece              id, project, name, composer, position, created_at
piece_block        id, piece, type (file|audio|link|text), title,
                   url?, file_path?, file_name?, content?,
                   has_bars, bars_start?, bars_end?,
                   score_path?, score_name?, bar_anchors{ bar → {page, x, y} },
                   position, created_at

absence_label      id, project, name, conditions[{connector, metric, comparison, value}],
                   is_public, position, created_at

club_member        id, title?, salutation?, first_name, last_name, care_of?, street?,
                   address_extra?, postal_code?, city?, country?, email?, phone?,
                   status (active|passive), created_at
```

---

## 18. Behaviours worth getting right

These are the non-obvious rules that make the app coherent. They are easy to miss on a rebuild.

1. **Registration ≠ membership.** Even an account-authenticated sign-up produces only a registration. Membership happens at transfer time. Check-in, by contrast, *does* create membership implicitly.
2. **Leaving a project archives, never deletes.** History must survive, and rejoining must restore participation without any data loss.
3. **One member row per account per project**, enforced everywhere: joining, check-in, registration transfer, and the manager's member form all re-activate rather than duplicate.
4. **Groups are per project and centrally defined.** The project's groups table is the only source of groups anywhere; member groups always stay in sync with it (renames and deletions cascade, unknown groups are created).
5. **Absent is derived, not stored.** It is total events minus present minus excused. Undated events still count as held.
6. **The account's email and name are authoritative** in account-mode flows; typed values are ignored.
7. **Public endpoints leak nothing.** They return the event/project/page title and the group list, never member names or counts.
8. **AND binds tighter than OR** in absence conditions.
9. **Check-in starts stopped.** A newly created check-in must be explicitly started, and resetting the token invalidates every printed QR code instantly.
10. **Bars are evenly distributed** across the recording; there is no per-bar timing data.
