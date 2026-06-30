# Anwesenheit App

Self hosted Choir attendance Management Plattform. 
- **Frontend:** React + Vite + TypeScript
- **Styling:** Tailwind CSS (fully custom, no component library)
- **Backend:** Supabase (auth, database, storage)
- **Icons:** Lucide React (outline style)

# Self hosted approach

Everything is customizable using env variables. This will be a dockerized application but we develop this to work also using npm run dev. 
# Design System

### Philosophy

Minimal, Notion-inspired, black-and-white-dominant UI. The design is subtle but well-defined. every element has clear boundaries and purpose. No decorative elements, no gradients, no unnecessary embellishment. The interface should feel calm, stable, and professional.

### Language

The ui language of the entire app is bilingual German/English. this can be set in env.

### Colors

| Token | Value | Usage |

| ------------------ | --------- | ------------------------------------------ |

| `--color-bg` | `#fafafa` | Page background |

| `--color-surface` | `#ffffff` | Cards, panels, dialogs, sidebar |

| `--color-border` | `#e5e5e5` | All borders (cards, inputs, tables, dividers) |

| `--color-text` | `#1a1a1a` | Primary text |

| `--color-text-secondary` | `#6b6b6b` | Secondary/muted text |

| `--color-text-tertiary` | `#9a9a9a` | Placeholder text, disabled states |

| `--color-accent` | `#efa100` | Accent — used sparingly for emphasis |

| `--color-accent-hover` | `#d99000` | Accent hover state |

| `--color-black` | `#1a1a1a` | Primary buttons, strong UI elements |

| `--color-black-hover` | `#333333` | Black button hover |

| `--color-white` | `#ffffff` | Text on dark backgrounds, secondary buttons |


Define these as CSS custom properties in `index.css` and reference them in `tailwind.config.ts` under `theme.extend.colors`.

### Typography


- **Font family:** Sans-serif only. Use `Inter` via Google Fonts. Set as `font-sans` in Tailwind config.
- **Base size:** `16px` (Tailwind default)
- **Headings:** Use font-size and font-weight for hierarchy, not color.
- `h1`: `text-2xl font-bold`
- `h2`: `text-xl font-semibold`
- `h3`: `text-lg font-semibold`
- `h4`: `text-base font-medium`
- **Body:** `text-base font-normal` (`16px`)
- **Small/caption:** `text-sm` (`14px`)
- **Line height:** Use Tailwind defaults (`leading-normal`)
- **No italic or underline** for emphasis — use weight or size.

### Borders & Radius

- **Border width:** `1px` everywhere. Never use thicker borders.
- **Border color:** `--color-border` (`#e5e5e5`)
- **Border radius:** `rounded-md` (`6px`) as the standard. Use on cards, inputs, buttons, dialogs, dropdowns.
- **No border-radius-0** unless it's a full-width element or table.
### Spacing
- Spacious but efficient. Prefer `p-4` / `p-5` for card padding, `gap-4` for flex/grid gaps.
- Page-level horizontal padding: `px-6` to `px-8`.
- Vertical rhythm between sections: `space-y-6`.
- Everything should be visible on screen — avoid excessive whitespace that pushes content below the fold.
### Layout

- **Sidebar navigation** on the left. Fixed position, full height, `w-60` to `w-64`.
- Sidebar background: `--color-surface` (`#ffffff`) with a right border (`border-r border-[--color-border]`).
- **Main content area** fills remaining width. No max-width constraint — content can stretch wide.
- Main content padding: `p-6` to `p-8`.
### Components
#### Buttons
Three variants only:

1. **Primary (black):** `bg-[--color-black] text-white rounded-md px-4 py-2 hover:bg-[--color-black-hover] transition-colors duration-150`
2. **Secondary (white/outlined):** `bg-white text-[--color-black] border border-[--color-border] rounded-md px-4 py-2 hover:bg-[#f5f5f5] transition-colors duration-150`
3. **Accent (rare):** `bg-[--color-accent] text-white rounded-md px-4 py-2 hover:bg-[--color-accent-hover] transition-colors duration-150`

- Never use ghost/link-style buttons for primary actions.
- Button text: `text-sm font-medium`.
- Disabled state: `opacity-50 cursor-not-allowed`.
#### Inputs

- Bordered box style: `border border-[--color-border] rounded-md px-3 py-2 text-base bg-white`
- Focus state: `focus:outline-none focus:border-[--color-black] transition-colors duration-150`
- Placeholder color: `placeholder:text-[--color-text-tertiary]`
- Labels: `text-sm font-medium text-[--color-text] mb-1.5` displayed above the input.
- Apply the same style to `<select>`, `<textarea>`, and any custom dropdowns.

#### Cards

- `bg-[--color-surface] border border-[--color-border] rounded-md p-4` or `p-5`.
- **No box-shadow.**
- Cards should be flat and bordered, never elevated.
#### Tables

- Fully lined: both horizontal and vertical grid lines.
- `border border-[--color-border]` on the table wrapper.
- `border-b border-r border-[--color-border]` on cells.
- Header row: `bg-[#f5f5f5] text-sm font-medium text-[--color-text-secondary]`.
- Body rows: `text-base`.
- Cell padding: `px-4 py-3`.
- No row hover effect unless rows are clickable.
#### Dialogs / Modals
- Centered overlay with a semi-transparent blurred backdrop via the shared `<Overlay />` component (`src/components/Overlay.tsx`). All styling for the backdrop lives there — never inline it.
- Dialog box: `bg-white border border-[--color-border] rounded-md w-full max-w-md max-h-[90vh] flex flex-col`. Header is `flex-shrink-0`, body is `overflow-y-auto` so tall content scrolls instead of overflowing.
- Close button in top-right corner (Lucide `X` icon).
- No nested modals.
#### SidePanel

- Always render via `createPortal(…, document.body)` so `fixed` positioning is relative to the true viewport, not a clipped overflow ancestor.
- Use the shared `<Overlay />` component for the backdrop.
#### Sidebar Navigation
- Each nav item: `px-3 py-2 rounded-md text-sm font-medium text-[--color-text-secondary]`
- Active state: `bg-[#f0f0f0] text-[--color-text]`
- Hover state: `hover:bg-[#f5f5f5] transition-colors duration-150`
- Section headers in sidebar: `text-xs font-semibold text-[--color-text-tertiary] uppercase tracking-wide px-3 py-2`
- Lucide icons next to nav labels, `size={18}`.

#### Loading State

- Full-page spinner centered vertically and horizontally.
- Use a simple CSS spinner (animated border ring), not a branded animation
- Spinner color: `--color-black`.
- No skeleton loaders, no progress bars, no shimmer effects.

#### Empty States

- Centered text with a short message. `text-[--color-text-secondary] text-sm`.
- Optionally a Lucide icon above the text, `size={32}`, same muted color.
### Transitions & Animations

- **Duration:** `150ms` for interactions (hover, focus). `200ms` for elements entering/leaving (modals).
- **Easing:** Use Tailwind defaults (`ease-in-out`).
- **What to animate:** `background-color`, `border-color`, `opacity`, `transform` (for modals).
- **Never animate:** layout shifts, width/height changes, color of text.
- Keep animations subtle. If in doubt, don't animate.

### No Toast / Notification System

- Do not implement toast messages or floating notifications.
- For success feedback: navigate to the result or update UI inline.
- For errors: display inline near the relevant form field or action.
### General Rules

- No `box-shadow` anywhere in the app.
- No gradients.
- No rounded-full on rectangular elements (only on avatars/profile pictures).
- No emoji in the UI.
- No placeholder illustrations or stock imagery.
- Scrollbars: use default browser scrollbars, do not style them.
- All interactive elements must have visible focus states for accessibility.
- Use semantic HTML (`<nav>`, `<main>`, `<section>`, `<button>`, `<table>`).
## File Structure

  

```

src/

components/ # Reusable UI components (Button, Input, Card, Modal, Table, Spinner, Overlay, etc.)

layouts/ # Layout components (SidebarLayout)

pages/ # Route-level page components

hooks/ # Custom React hooks

lib/ # Utilities, Supabase client, helpers

types/ # TypeScript type definitions

```

## Code Conventions

- Use TypeScript strict mode.
- Functional components with arrow functions.
- Named exports (no default exports).
- Tailwind classes directly on elements — no CSS modules, no styled-components, no `@apply` in CSS files (except for the base CSS custom properties).
- Colocate component-specific types in the component file.
- Supabase client initialized once in `src/lib/supabase.ts`.
- use smtp email (in env or some other config file)

# The App Itself:

- No landing page.
- user logs in on login page
- then next is project selection dashboard
	- sidebar has Projects, Users, Settings. on the bottom account, log out
	- Projects page has projects in a card view. can be created, edited, archived, deleted
	- users page has all users who have access to the app. all users have access to all the projects. there is one owner, ownership can be transferred. only the owner can see members and settings. every user has name, email, password. in accunt settings 2fa can be created, name, email and password changed. owner creates new users who can then log in to the app. 
	- Settings page. admin can set Name, set color, set icon (will be used everywhere and in favicon)
- People can click on a project to open it.
	- We want to track who attended which event
	- Sidebar: Events, Members, Settings (change project settings)
	- Members have First name, Last name, Group, optional email. optional photo. members in members database can be opened (member preview page) and/or edited. members can be added or edited or archived (does not show in list) or deleted (completely gone)
	- Events have name, optional date, optional time. 
		- events can be edited (these details)
		- events can be opened: then attendee list: shows all members in a list. members are default all not attended. they can be switched to attended or excused. easily
		- members can be added to an event and then the user is asked if the member should be a guest or be added to the members of the project