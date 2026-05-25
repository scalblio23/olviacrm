# Loop Appointment Dialer — TODO

## Phase 1: Schema & Secrets
- [x] Create todo.md
- [x] Define DB schema: leads, sessions, dispositions, notes
- [x] Request Telnyx secrets (API key, from number, connection ID)

## Phase 2: Backend API
- [x] tRPC procedure: upload/parse CSV leads (store in DB)
- [x] tRPC procedure: list leads for a session
- [x] tRPC procedure: place outbound call via Telnyx Voice API
- [x] tRPC procedure: send SMS via Telnyx Messaging API
- [x] tRPC procedure: update disposition for a lead
- [x] tRPC procedure: update notes for a lead
- [x] tRPC procedure: get lead detail (with disposition + notes)
- [x] Server-side env: TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_CONNECTION_ID

## Phase 3: Frontend UI
- [x] Global design system: dark/light theme, typography, color palette
- [x] App layout: two-panel split (lead list left, active lead right)
- [x] CSV upload component with drag-and-drop
- [x] Lead list panel: search, scroll, status badges
- [x] Active lead panel: lead info, call/SMS buttons, disposition buttons, notes
- [x] Call status feedback (calling, connected, failed)
- [x] SMS send feedback (sent, failed)
- [x] Disposition persistence per lead per session
- [x] Notes persistence per lead per session
- [x] Responsive and polished micro-interactions

## Phase 4: Integration & Delivery
- [x] End-to-end test: CSV upload → call → disposition → notes
- [x] Vitest unit tests for backend procedures
- [x] Checkpoint and publish

## Phase 5: Manual Dial + Chat + Theme Toggle
- [x] Add "Manual Dial" tab/panel: type phone number + name
- [x] Chat-style SMS thread per contact (send + receive display)
- [x] Call button in manual dial panel
- [x] Light/dark mode toggle in header
- [x] Fix CSS so light mode is fully visible (no invisible text)
- [x] Verify light mode visually before delivery
- [x] Update version to v1.02

## Phase 6: Call Bridging (Agent Audio)
- [x] Webhook handles call.answered → speak hold message to callee
- [x] Webhook handles call.speak.ended → bridge call to agent number +61485825732
- [x] Webhook handles call.bridged → log bridge success
- [x] Webhook handles call.hangup → log call end
- [x] Store AGENT_NUMBER as env variable
- [x] Update version to v1.04

## Phase 7: Two-Leg Bridge (Agent + Lead Audio)
- [x] Change call flow: dial agent first, store call_control_id in memory map
- [x] When agent answers (call.answered, direction=incoming), dial the lead
- [x] When lead answers (call.answered, direction=outgoing), bridge both legs
- [x] Store pending bridge state in server memory (agentCallId → leadNumber)
- [x] Update routers.ts placeCall to dial agent first instead of lead
- [x] Update version to v1.06

## Phase 8: Browser WebRTC Audio (Option B)
- [x] Research Telnyx WebRTC SDK npm package and credential requirements
- [x] Backend: create SIP credential or WebRTC token endpoint for browser client
- [x] Install @telnyx/webrtc npm package
- [x] Frontend: TelnyxPhone component — init SDK, request mic permission, register SIP
- [x] Frontend: wire Call button to SDK dial() instead of tRPC placeCall
- [x] Frontend: show mic status indicator (connected/disconnected)
- [x] Frontend: mute/unmute button during active call
- [x] Frontend: call state display (ringing, connected, ended)
- [x] Remove two-leg bridge flow (no longer needed)
- [x] Update version to v1.07

## Phase 9: Fix WebRTC Call Drop (5-second issue)
- [x] Handle 'destroyed' state in notification handler (not just 'hangup'/'destroy')
- [x] Attach remote audio stream to a hidden <audio> element so audio plays
- [x] Handle 'new' state transition (show "Connecting..." before ringing)
- [x] Handle 'reconnecting' state
- [x] Add call.cause logging on destroyed for debugging
- [x] Fix: fresh token fetched on each initialize() call (token may expire)
- [x] Update version to v1.08

## Phase 10: Fix CALL_REJECTED (callerNumber missing)
- [x] Add getFromNumber endpoint to return TELNYX_FROM_NUMBER server-side
- [x] Pass callerNumber in newCall() options in useTelnyxPhone hook
- [x] Handle 'requesting' state in notification handler
- [x] Update version to v1.09

## Phase 11: Call Timer + Call History
- [x] Add call_history table to DB schema (leadId, sessionId, startedAt, duration, disposition)
- [x] Backend: logCall procedure (insert call record)
- [x] Backend: getCallHistory procedure (fetch calls per lead)
- [x] Frontend: live call timer (starts on active, stops on hangup)
- [x] Frontend: call history dropdown panel below call button
- [x] Each history entry shows: timestamp, duration, disposition badge
- [x] Auto-log call when it ends (duration + disposition at time of hangup)
- [x] Update version to v1.10

## Phase 12: Layout Redesign — Conversation Window + Lead Selector
- [x] Persistent Conversation Window always visible (bottom/right): dial button, call history, SMS chat
- [x] Lead Selector panel (top/left): CSV Leads tab + Manual Dial tab — pick who to call
- [x] Selecting a lead from CSV or typing manual number populates the active contact in Conversation Window
- [x] Call history and SMS thread always visible regardless of lead selection state
- [x] Clean separation: lead selection is a "who" panel, conversation is a "do" panel
- [x] Update version to v1.11

## Phase 14: Layout v1.14 — Global Call History Left + Unified Conversation Right
- [x] Add `direction` column to call_history table (outbound/inbound)
- [x] Add tRPC procedure: getAllCallHistory (all calls across all sessions, no leadId filter)
- [x] Left panel: dial tabs (Manual Dial / CSV Leads) at top, global call history list below
- [x] Global call history list shows: number, name (if known), time, duration, outbound/inbound badge — clickable to open contact
- [x] Right panel: unified conversation window — merged timeline of call events + SMS messages for selected contact
- [x] Call events in timeline show: direction, duration, disposition badge, timestamp
- [x] SMS messages in timeline show: direction (sent/received), text, timestamp
- [x] Clicking a call history entry on the left sets it as the active contact and opens their conversation
- [x] Remove separate Call History tab and Conversations tab — merge into single unified timeline
- [x] Notes tab remains for CSV leads only
- [x] Update version to v1.14

## Phase 16: Two-Way SMS (Inbound + Outbound Persistence)
- [x] DB: add sms_messages table (id, phone, direction, body, status, externalId, createdAt)
- [x] Backend: persist outbound SMS to sms_messages on send
- [x] Backend: POST /api/webhooks/telnyx-sms endpoint to receive inbound messages from Telnyx
- [x] Backend: tRPC getSmsThread procedure — fetch all messages for a phone number
- [x] Frontend: replace in-memory chatMessages state with DB-backed getSmsThread query
- [x] Frontend: poll getSmsThread every 5s so inbound replies appear automatically
- [x] Frontend: outbound send still calls telnyx.sms mutation, which now also persists to DB
- [x] Update version to v1.16

## Phase 17: iMessage via Blooio

- [x] Store BLOOIO_API_KEY as secret env var
- [x] Add sendBlooioMessage tRPC procedure (POST to Blooio API, persist to sms_messages with channel='imessage')
- [x] Add /api/blooio/webhook endpoint to receive inbound Blooio iMessages and persist to sms_messages
- [x] Add iMessage toggle switch next to chat input in Dialer.tsx conversation window
- [x] When toggle is ON: send via Blooio; when OFF: send via Telnyx SMS
- [x] Show channel badge (iMessage / SMS) on each message bubble in the timeline
- [x] Update version to v1.17

## Phase 18: Icon Sidebar v1.18
- [x] Add narrow icon sidebar (60px wide) to the far left of the dialer layout
- [x] Sidebar has 3 tabs: Conversations (MessageSquare icon + unread badge), Contacts (Users icon), Settings (Settings icon)
- [x] Active tab highlighted with accent color
- [x] Conversations tab: shows current CSV Leads / Manual Dial + Call History panel (existing content)
- [x] Contacts tab: placeholder panel with "coming soon"
- [x] Settings tab: placeholder panel with "coming soon"
- [x] Update version to v1.18

## Phase 19: Contacts System v1.19
- [x] DB: add contacts table (id, name, phone, email, company, notes, createdAt)
- [x] Backend: createContact, listContacts, getContactByPhone, updateContact procedures
- [x] Conversation panel: "Add Contact" / "Edit Contact" button in contact header strip
- [x] Add Contact dialog: pre-fills phone from active contact, user enters name/email/company
- [x] Contacts tab: shows saved contact list with name, phone, company
- [x] Clicking a contact in Contacts tab opens their conversation (same as clicking call history)
- [x] Contact name persists in conversation header, call history rows, and SMS thread
- [x] Update version to v1.19

## Phase 20: Tagging, Custom Fields & CSV Field Mapping v1.20
- [x] DB: tags table (id, name, color, createdAt)
- [x] DB: contact_tags junction table (contactId, tagId)
- [x] DB: custom fields on contacts (source, criteria1-5)
- [x] DB: tagId column on lead_sessions
- [x] Backend: tags.list, tags.create, tags.delete procedures
- [x] Backend: contacts.upsert accepts custom fields (source, criteria1-5) and tagIds
- [x] Backend: contacts.getTagsForContact procedure
- [x] Backend: leads.upload accepts optional tagId
- [x] Frontend: Pipedrive-style CSV field mapping modal (auto-detect columns, map to Name/Phone/Email/Company/Source/Criteria 1-5/Skip)
- [x] Frontend: Tag assignment in CSV mapping modal (pick existing tag or create new with color picker)
- [x] Frontend: Contacts tab tag filter chips (All + per-tag, colored)
- [x] Frontend: Contact rows show tag color badges
- [x] Frontend: Contact dialog has Source, Criteria 1-5 fields and multi-tag picker
- [x] Frontend: Active contact strip shows tags and custom fields
- [x] Tests: tags.test.ts (create, list, delete) — all 13 tests pass
- [x] Update version to v1.20

## Phase 21: Lead Persistence, Layout, Tab Rename, Required Tag v1.22
- [x] Persist sessionId in localStorage so leads survive page refresh
- [x] Add backend procedure to get latest lead session (for auto-restore on mount)
- [x] Fix left panel: leads list fills full height, remove max-h-72 cap, use native scrollbar styling (no grey widget)
- [x] Rename "CSV Leads" tab label to "Contacts"
- [x] Make tag required on bulk upload: disable Import button until a tag is selected, show inline warning
- [x] Update version to v1.22

## Phase 22: Contacts Filter Bar v1.23 (superseded by Phase 23)
- [x] Add collapsible filter section above the leads list in the Contacts tab
- [x] Date filter: "From" and "To" date inputs (filter leads by createdAt between range)
- [x] Tag filter: multi-select tag chips (filter leads whose session tagId matches selected tags)
- [x] Active filter count badge on the filter toggle button
- [x] Clear all filters button
- [x] Update version to v1.23

## Phase 23: Contacts Table View v1.24
- [x] Backend: contacts.list supports dateFrom/dateTo and tagId filter params
- [x] Backend: contacts.bulkDelete procedure (accepts array of contact IDs)
- [x] Backend: contacts.bulkAddTag procedure (accepts array of contact IDs + tagId)
- [x] Frontend: Contacts tab shows full-screen table (replaces old card list)
- [x] Table columns: checkbox, Name, Phone, Email, Tags, Date Created
- [x] Filter bar: Date From/To date pickers + Tag multi-select chips
- [x] Active filter badge count on filter toggle
- [x] Bulk action toolbar appears when rows are selected: Delete selected, Add tag
- [x] Select all checkbox in header
- [x] Clicking a contact row opens their conversation (sets activeContact + switches to Conversations tab)
- [x] Update version to v1.24

## Phase 24: Persistent Tag Filter & Lead-Contact Mirror v1.26
- [x] Lift tag filter to single shared state that persists across Conversations and Contacts tabs
- [x] Conversations tab: tag filter chips below search use shared state
- [x] Contacts table: tag filter chips use shared state
- [x] Upload rows pass email/source/criteria1-5 to backend so they mirror to contacts
- [x] Update version to v1.26

## Phase 25: Backfill Contacts & Conversations Activity Filter v1.27
- [x] Backfill all 455 leads into contacts table (extract email/criteria from extraData JSON)
- [x] Conversations panel: only show leads with at least one call, SMS, or iMessage (not all leads)
- [x] Backend: getActiveLeads procedure (leads joined to call_history OR sms_messages)
- [x] Frontend: Conversations tab uses getActiveLeads instead of full leads list
- [x] Full leads list (all 455) remains accessible via the Contacts tab only
- [x] Update version to v1.27

## Phase 25: Backfill Contacts & Conversations Activity Filter v1.27
- [x] Backfill all 455 leads into contacts table (extract email/criteria from extraData JSON)
- [x] Remove CSV upload from Conversations panel entirely
- [x] Add "Upload Contacts" button to Contacts table view (triggers CSV mapping modal)
- [x] Conversations panel: only show leads/contacts with at least one call, SMS, or iMessage
- [x] Backend: getActiveContacts procedure (contacts joined to call_history OR sms_messages)
- [x] Frontend: Conversations tab uses getActiveContacts instead of full leads list
- [x] Update version to v1.27

## Phase 27: Tab Persistence, Tag UI Polish, Optimistic Updates v1.29
- [x] Persist leftTab in localStorage so page refresh restores the active tab
- [x] Bulk tag dialog: replace Select dropdown with inline tag chip grid (click to select)
- [x] Bulk tag: apply immediately on chip click (no separate Add Tag button needed)
- [x] Per-row tag popover: optimistic update so tag appears instantly without waiting for server
- [x] Per-row tag popover: remove tag also updates instantly
- [x] Update version to v1.29

## Phase 26: Contacts Table — Selectable Rows, Bulk Tag, Per-Row Tag v1.28
- [x] Contacts table: checkbox on every row is visible and clickable
- [x] Contacts table: select-all checkbox in header works
- [x] Bulk action toolbar: appears when any rows are selected, shows Delete + Add Tag buttons
- [x] Bulk Add Tag: opens tag picker dialog, applies tag to all selected contacts
- [x] Per-row tag button: each row has a tag icon button that opens a tag popover
- [x] Tag popover: shows all existing tags, click to add or remove tag from that contact
- [x] Backend: removeTagFromContact procedure added
- [x] Update version to v1.28

## Phase 28: Create Tag Inline v1.31
- [x] Per-row tag popover: add "New tag" button at bottom that reveals inline name+color form
- [x] Per-row tag popover: submitting creates the tag, auto-selects it, closes the form
- [x] Bulk Add Tag dialog: same "New tag" inline form at the bottom of the chip grid
- [x] Update version to v1.31

## Phase 29: Custom Field Columns + Smart Sort v1.32
- [x] Contacts table: add Source, Criteria 1-5 as visible column headers
- [x] Column headers are sortable — clicking cycles asc → desc → off
- [x] Sort type auto-detected per column: date (ISO/common formats), number, or text (A-Z)
- [x] Sort is applied client-side on the fetched contacts list
- [x] Active sort column shows an up/down arrow indicator
- [x] Update version to v1.32

## Phase 30: Fix CSV Import Rate Limit v1.33
- [x] Chunk contact upserts into groups of 20 with 150ms pause between chunks
- [x] Bulk-tag all contacts in each chunk with a single query instead of one per contact
- [x] Update version to v1.33

## Phase 31: Tag Removal + Notion-style Filters v1.34
- [x] Server: add removeTagFromContact(contactId, tagId) db helper
- [x] Server: add contacts.removeTag tRPC mutation
- [x] Per-row tag popover: show X button on each applied tag chip to remove it
- [x] Bulk action: add "Remove Tag" bulk action alongside "Add Tag"
- [x] Replace simple date/tag filter panel with Notion-style rule builder
- [x] Filter rules: field selector (Name, Phone, Email, Company, Source, Criteria 1-5, Tags, Date Created)
- [x] Filter rules: operator selector per field type (contains/not contains/is/is not/is empty/is not empty for text; before/after/between for date; has tag/doesn't have tag for tags)
- [x] Filter rules: value input per rule
- [x] Multiple rules combined with AND logic
- [x] Add/remove filter rules dynamically
- [x] Apply filters client-side to sortedContactList
- [x] Update version to v1.34

## Phase 32: Color-coded Contact Status v1.35
- [x] DB: add `status` varchar column to contacts table (nullable, default null)
- [x] Generate and apply migration SQL
- [x] Define CONTACT_STATUSES constant: New (grey), Contacted (blue), Interested (green), Not Interested (red), Callback (yellow), Appointment Set (teal), Do Not Call (dark red)
- [x] Server: add updateContactStatus(id, status) db helper
- [x] Server: add contacts.setStatus tRPC mutation
- [x] Server: include status in listContacts and upsertContact
- [x] Contacts table: add Status column header (sortable)
- [x] Contacts table row: show color-coded status badge, click to open inline status picker popover
- [x] Bulk action toolbar: add "Set Status" bulk action
- [x] Notion filter builder: add "Status" field with is/is not/is empty/is not empty operators
- [x] Contact upsert dialog: add status field
- [x] Update version to v1.35

## Phase 33: Table Layout Fix + Notes/Outcomes Column v1.36
- [x] Fix email column overflow — truncate with ellipsis, proper min-w/max-w
- [x] Fix Status + Tags column overlap — give each a fixed width, prevent overflow
- [x] DB: add `outcome` text column to contacts table (nullable)
- [x] Generate and apply migration SQL
- [x] Server: include outcome in listContacts, upsertContact, updateContactOutcome helper, contacts.setOutcome tRPC mutation
- [x] Contacts table: add Notes/Outcomes column header
- [x] Contacts table row: show truncated outcome text, click to open inline edit popover (textarea)
- [x] Add outcome field to Add/Edit Contact dialog
- [x] Notion filter builder: add Outcome field (contains/is empty operators)
- [x] Update version to v1.36

## Phase 34: SmartLists (GHL-style) v1.41
- [x] DB: add `smartlists` table (id, userId, name, filterRules JSON, createdAt)
- [x] Generate and apply migration SQL
- [x] Server: smartlists.list, smartlists.create, smartlists.delete tRPC procedures
- [x] Contacts table: SmartList tabs row above the table (All Contacts + saved lists)
- [x] Clicking a SmartList tab loads its filter rules into the active filter state
- [x] Filter panel: "Save as SmartList" button when filter rules are active
- [x] "Save as SmartList" opens a name input inline, then saves to DB
- [x] SmartList tabs have a delete (×) button to remove the list
- [x] Active SmartList tab is highlighted
- [x] Fix: createSmartlist TiDB bigint insertId bug — now fetches by userId+name+desc(createdAt)
- [x] Update version to v1.41

## Phase 35: Required Date Created Field in CSV Import v1.42
- [x] Add `createdAt` to CONTACT_FIELDS mapping options in CSV dialog (labeled "Date Created ★")
- [x] Update autoDetectField to auto-map columns named date_created, created_at, date added, etc.
- [x] Add `hasDateCreated` validation — Import button disabled if no column mapped to createdAt
- [x] Show red warning: "Date Created is required — please map a column to Date Created ★"
- [x] Pass createdAt string through handleCsvImport → upload mutation → upsertContact
- [x] Server: upload procedure Zod schema accepts `createdAt: z.string().optional()`
- [x] Server: upsertContact passes createdAt as `new Date(r.createdAt)` when provided
- [x] db.ts: upsertContact onDuplicateKeyUpdate also updates createdAt when provided
- [x] Update version to v1.42

## Phase 36: Tag-Based User Permissions v1.43
- [x] DB: add `user_tag_permissions` table (id, userId, tagId, createdAt)
- [x] Generate and apply migration SQL
- [x] Server: admin.listUsers procedure — list all users with their permitted tag IDs
- [x] Server: admin.setUserTagPermissions procedure — replace a user's permitted tags
- [x] Server: admin.setUserRole procedure — promote/demote users between admin/user roles
- [x] Server: contacts.list enforces tag permissions for non-admin users (intersect with permitted tags)
- [x] Server: admin.myPermittedTagIds — returns null (admin) or array of permitted tag IDs
- [x] Frontend: Settings panel — full user management UI (replaces "coming soon" placeholder)
- [x] Settings: user list showing name, email, role, and permission summary badge
- [x] Settings: click a user to expand permission editor — toggle which tags they can see
- [x] Settings: role toggle (User/Admin) per user row
- [x] Settings: admin badge on admin rows, "No access" / "N tags" badge on user rows
- [x] Settings: "Save permissions" button only enabled when changes are pending
- [x] Contacts table: non-admin users only see contacts that have at least one of their permitted tags
- [x] Contacts table: permission notice banner showing which tags the user can see
- [x] Update version to v1.43

## Phase 37: Custom Email/Password Login v1.44
- [x] DB: add `password_hash` column to users table, apply migration
- [x] Server: bcrypt password hashing (install bcryptjs)
- [x] Server: auth.login procedure (email + password → JWT session cookie)
- [x] Server: auth.logout procedure (clear session cookie)
- [x] Server: auth.me procedure (read session cookie → return user or null)
- [x] Server: admin.createUser procedure (admin only — name, email, password, role)
- [x] Server: admin.updateUserPassword procedure (admin only — reset a user's password)
- [x] Server: admin.deleteUser procedure (admin only)
- [x] Remove Manus OAuth routes and login URL references
- [x] Frontend: custom Login page (email + password form, error state)
- [x] Frontend: useAuth hook reads from auth.me (no Manus OAuth)
- [x] Frontend: redirect to /login if not authenticated
- [x] Frontend: Settings panel — "Add User" form (name, email, temp password, role)
- [x] Frontend: Settings panel — delete user button per row
- [x] Frontend: Settings panel — reset password button per row
- [x] Update version to v1.44

## Phase 38: Add User + SMS Invite Flow v1.45
- [x] DB: add `phone` and `inviteToken` columns to users table, apply migration
- [x] Server: admin.createUser — creates user record, generates crypto invite token, sends SMS via Telnyx
- [x] Server: auth.acceptInvite — validates token, sets password, creates session cookie
- [x] Server: auth.login — custom email/password login procedure
- [x] Server: admin.deleteUser and admin.resetUserPassword procedures
- [x] Frontend: Settings — "Add User" section with name/email/phone form + country code selector (AU/US/GB/NZ)
- [x] Frontend: Settings — user list shows all created users with role badge, tag permission editor, and delete button
- [x] Frontend: Accept Invite page (/invite?token=xxx) — set password form, auto-login on submit
- [x] Frontend: Login page (/login) — email/password form for returning users
- [x] App.tsx: add /invite and /login routes
- [x] Update version to v1.45

## Phase 39: Invite Drip Sequence + 2-Way Email Tab v1.48
- [x] DB: emailMessages table with direction/subject/body/status/externalId/messageType columns
- [x] DB: users table — inviteToken, inviteSequenceStep, inviteCronTaskUid columns
- [x] Server: mailgun.ts — sendEmail helper with DB persistence, buildInviteEmailHtml, buildFollowUp1Html, buildReminderHtml
- [x] Server: db.ts — listEmailMessages, updateUserInviteStep, getUsersPendingDrip helpers
- [x] Server: admin.createUser — sends step-1 SMS + email invite, schedules heartbeat drip job
- [x] Server: /api/scheduled/inviteDrip heartbeat endpoint — advances drip steps (1hr/24hr/48hr thresholds)
- [x] Server: email.list procedure — returns email thread for a given email address
- [x] Server: email.send procedure — sends email via Mailgun and persists to DB
- [x] Frontend: Dialer.tsx — Email tab appears when contact has email address
- [x] Frontend: Email tab shows threaded conversation (outbound/inbound bubbles with subject)
- [x] Frontend: Email compose area with Subject + Body fields + Send button
- [x] Update version to v1.48

## Phase 40: Automations Engine (GHL-style)

- [ ] DB: `automations` table (id, name, triggerType, triggerTagId, isActive, createdAt)
- [ ] DB: `automation_steps` table (id, automationId, stepOrder, stepType, waitValue, waitUnit, waitMode, eventType, smsBody, emailSubject, emailBody)
- [ ] DB: `automation_enrollments` table (id, automationId, contactId, currentStep, nextRunAt, status, enrolledAt)
- [ ] DB migration applied via webdev_execute_sql
- [ ] Server: db helpers for automations CRUD + enrollment management
- [ ] Server: tRPC automation router (list, get, create, update, delete, toggle)
- [ ] Server: enrollment trigger — when tag added to contact, enroll in matching automations
- [ ] Server: heartbeat processor — advance enrollments whose nextRunAt has passed
- [ ] Frontend: Automations tab in Settings sidebar
- [ ] Frontend: Automations list page (name, trigger, steps count, active toggle, edit/delete)
- [ ] Frontend: GHL-style vertical step canvas builder
- [ ] Frontend: Trigger block — tag-based trigger selector
- [ ] Frontend: Wait step — delay mode (X min/hours/days) OR before-event mode (X time before event)
- [ ] Frontend: SMS step — preset body with merge tags
- [ ] Frontend: Email step — subject + body fields
- [ ] Frontend: Add/remove/reorder steps, save & activate

## Phase 40: Automations Engine (v1.52)
- [x] DB schema: automations, automation_steps, automation_enrollments tables
- [x] Migration applied via webdev_execute_sql
- [x] DB helpers: listAutomations, getAutomationById, createAutomation, updateAutomation, deleteAutomation, replaceAutomationSteps, getAutomationSteps, enrollContact, getDueEnrollments, updateEnrollment, getAutomationsForTag, getContactById
- [x] tRPC automations router: list, get, create, update, delete, saveSteps, enroll procedures
- [x] AutomationsPanel.tsx: GHL-style list view + step-by-step builder
- [x] Trigger: tag-based (any tag or specific tag)
- [x] Step types: Wait (delay or before-event), SMS, Email
- [x] Wait modes: delay X minutes/hours/days OR X time before an event
- [x] Variable substitution: {{first_name}}, {{last_name}}, {{phone}}, {{email}}
- [x] Automations nav button (Zap icon) added to sidebar
- [x] Heartbeat handler: /api/scheduled/automationRun (every 5 min)
- [x] Heartbeat job created: task_uid=kjDbPTRM2SWfHxmbtko7CV

## Phase 40: Automations Engine (v1.52)
- [x] DB schema: automations, automation_steps, automation_enrollments tables
- [x] Migration applied via webdev_execute_sql
- [x] DB helpers: listAutomations, getAutomationById, createAutomation, updateAutomation, deleteAutomation, replaceAutomationSteps, getAutomationSteps, enrollContact, getDueEnrollments, updateEnrollment, getAutomationsForTag, getContactById
- [x] tRPC automations router: list, get, create, update, delete, saveSteps, enroll procedures
- [x] AutomationsPanel.tsx: GHL-style list view + step-by-step builder
- [x] Trigger: tag-based (any tag or specific tag)
- [x] Step types: Wait (delay or before-event), SMS, Email
- [x] Wait modes: delay X minutes/hours/days OR X time before an event
- [x] Variable substitution: first_name, last_name, phone, email
- [x] Automations nav button (Zap icon) added to sidebar
- [x] Heartbeat handler: /api/scheduled/automationRun (every 5 min)
- [x] Heartbeat job created: task_uid=kjDbPTRM2SWfHxmbtko7CV

## Phase 41: Appointments Section (v1.53)
- [ ] DB: calendars table (id, name, type: user|custom, ownerId, color, createdAt)
- [ ] DB: appointments table (id, calendarId, contactId, title, startAt, endAt, notes, status, createdAt)
- [ ] Migration applied
- [ ] DB helpers: listCalendars, createCalendar, deleteCalendar, listAppointments, createAppointment, updateAppointment, deleteAppointment
- [ ] tRPC: calendars.list, calendars.create, calendars.delete
- [ ] tRPC: appointments.list, appointments.create, appointments.update, appointments.delete
- [ ] Frontend: AppointmentsPanel with Calendar view + List view toggle
- [ ] Calendar view: month grid with appointment dots, day click opens booking dialog
- [ ] Calendar view: right sidebar — per-user calendars + custom calendars with color toggles
- [ ] Booking dialog: pick contact (search), calendar, date/time, duration, notes
- [ ] List view: table with Name, Time, Calendar, Date Created columns
- [ ] Appointments nav button added to sidebar

## Phase 42: Universal Placeholders + Contact Linking
- [ ] Create shared placeholder utility (resolvePlaceholders) in shared/placeholders.ts
- [ ] Fix appointment booking: save contactId to DB, show linked contact name in list/calendar views
- [ ] Auto-fill appointment title with contact full name when contact is selected
- [ ] Wire placeholder chip picker into SMS/iMessage input in Dialer
- [ ] Wire placeholder chip picker into email compose in Dialer email tab
- [ ] Wire placeholder chip picker into automation step SMS/Email body editors

## Phase 43: Appointment Trigger + Before-Event Wait + Timezone (v1.58)
- [x] DB: add `timezone` column to `automations` table (default 'UTC')
- [x] DB: add `timezone` column to `appointments` table (default 'UTC')
- [x] DB: add `appointment_booked` to automation trigger enum
- [x] DB: add `eventTimestamp` column to `automation_enrollments` (stores appointment startAt for before-event resolution)
- [x] Server: fire automations with `appointment_booked` trigger when appointment is created
- [x] Server: enrollment engine resolves `before_event` wait using `eventTimestamp` from enrollment
- [x] Frontend: add `appointment_booked` trigger option in AutomationsPanel builder
- [x] Frontend: timezone selector in AutomationsPanel (per-automation)
- [x] Frontend: timezone selector in AppointmentsPanel booking dialog
- [x] Version string updated to v1.58

## Phase 44: Appointment Placeholders in Automations (v1.59)
- [x] shared/placeholders.ts: add {{appointment_title}}, {{appointment_date}}, {{appointment_time}}, {{appointment_timezone}} tokens
- [x] PlaceholderPicker: add showAppointment prop — shows appointment chips when true
- [x] AutomationsPanel: pass showAppointment={triggerType === "appointment_booked"} to StepEditor
- [x] StepEditor: forward showAppointment to SmsStepEditor and EmailStepEditor
- [x] server/_core/index.ts: resolve appointment placeholders from eventTimestamp using getAppointmentByEventTimestamp
- [x] server/db.ts: add getAppointmentByEventTimestamp helper
- [x] Version string updated to v1.59

## Phase 45: Calendar Filter on appointment_booked Trigger (v1.60)
- [x] DB: add `triggerCalendarId` column to `automations` table (nullable int, default null = any calendar)
- [x] DB migration 0018 applied via webdev_execute_sql
- [x] server/db.ts: getAutomationsForAppointmentBooked accepts calendarId param and filters by triggerCalendarId (null = match all)
- [x] server/routers.ts: automations.create and automations.update accept triggerCalendarId input
- [x] server/routers.ts: appointments.create passes appointment.calendarId to getAutomationsForAppointmentBooked
- [x] AutomationsPanel: show calendar picker (from calendars.list) when trigger is appointment_booked
- [x] AutomationsPanel: display "Any Calendar" as default option (null), then list of calendars
- [x] Version string updated to v1.60

## Phase 46: Calendar Event Card + iMessage Automation Step (v1.61)
- [x] AppointmentsPanel: fix event card layout — title at top (font-semibold), time below (smaller/muted)
- [x] AutomationsPanel: add 'imessage' step type alongside SMS
- [x] server/routers.ts: saveSteps accepts 'imessage' stepType
- [x] server/_core/index.ts: handle imessage step using Blooio API to send iMessage
- [x] AutomationsPanel: imessage step editor (same as SMS editor, different colour/icon)
- [x] Version string updated to v1.61

## Phase 47: Contacts Kanban View (v1.62)
- [x] Contacts page: add List/Kanban view toggle button in toolbar (persists in localStorage)
- [x] Contacts page: KanbanView component — columns per stage, ordered by stage order
- [x] Kanban card: show name, phone, email, stage colour swatch
- [x] Kanban card: speech-bubble button opens conversation window for that contact
- [x] Active search + filter state persists when switching between list and kanban views
- [x] Version string updated to v1.62

## Phase 48: Appointments Tab in Contact Panel (v1.63)
- [ ] Add "Appointments" tab to the Conversation/Notes/Email tab bar in the contact detail panel
- [ ] Query appointments by contact phone number for the active contact
- [ ] Render appointment list: title, date/time, timezone, calendar name, status
- [ ] Version string updated to v1.63

## Phase 49: Single-Select Tag Filter in Contacts (v1.63)
- [ ] Change contactTagFilters from multi-select array to single-select (one tag at a time)
- [ ] Clicking an active tag deselects it (back to All)
- [ ] Clicking a different tag replaces the current selection
- [ ] Version string updated to v1.63

## Phase 50: Kanban Expanded Cards + Lazy Load + Drag-and-Drop (v1.63)
- [x] Install @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities
- [x] Expand kanban cards (full width, more padding, all fields visible)
- [x] Per-column lazy load: show first 20 cards, load more on scroll to bottom
- [x] Drag-and-drop: drag card between columns updates contact status via setStatus mutation
- [x] Single-select tag filter: clicking active tag deselects (back to All)
- [x] Version string updated to v1.63

## Phase 51: CSV Date Format Fix (v1.64)
- [x] Add smart parseDate() utility that handles DD/MM/YYYY, D/M/YYYY, YYYY-MM-DD, M/D/YYYY, ISO 8601, and natural language dates
- [x] Apply parseDate() in server-side contacts.upload procedure
- [x] Version string updated to v1.64

## Phase 52: AI Automation Builder Chat Box (v1.65)
- [x] Server: automations.buildFromPrompt procedure — calls LLM with system prompt describing automation schema, returns structured JSON (name, trigger, steps)
- [x] Frontend: "Ask AI" button in AutomationsPanel toolbar opens a slide-in chat panel
- [x] Frontend: AI response populates the visual builder (name, trigger, all steps) for review before saving
- [x] Frontend: loading state while AI generates, error handling if generation fails
- [x] Frontend: 3 example prompt chips shown when chat is empty
- [x] Version string updated to v1.65

## Phase 53: Automation Builder Editing Fixes (v1.66)
- [x] Fix step fields not being editable — root cause: stepsQuery refetchOnWindowFocus=true was overwriting edits; fixed with staleTime=Infinity + refetchOnWindowFocus=false + one-time load guard
- [x] Add + insert button between steps to add a new step at any position
- [x] Version string updated to v1.66

## Phase 54: SmartList Sharing + Delete Confirmation (v1.67)
- [ ] DB: add `isPublic` boolean column to smartLists table (default false = owner only)
- [ ] DB: add `sharedWith` text column (JSON array of user IDs, nullable) to smartLists table
- [ ] DB migration 0019 applied via webdev_execute_sql
- [ ] server/routers.ts: smartLists.share procedure (set isPublic or sharedWith array)
- [ ] server/routers.ts: smartLists.list returns shared lists to current user (own + public + shared-with-me)
- [ ] Frontend: share button on each smartlist row (Share to All / specific user picker)
- [ ] Frontend: delete confirmation dialog before deleting a smartlist
- [ ] Version string updated to v1.67

## Phase 54: SmartList Sharing + Delete Confirm (v1.67)
- [x] DB: add isPublic (boolean, default false) and sharedWith (text, nullable JSON array of user IDs) to smartlists table
- [x] DB migration 0019 applied
- [x] server/db.ts: listSmartlists returns shared lists for the current user
- [x] server/db.ts: shareSmartlist helper added
- [x] server/routers.ts: smartlists.share procedure added
- [x] Dialer.tsx: Share button (Share2 icon) on hover for each smartlist tab
- [x] Dialer.tsx: Share dialog — Share with All Users or Specific Users (checkbox list)
- [x] Dialer.tsx: Delete confirmation dialog before deleting a smartlist
- [x] Dialer.tsx: Globe icon shown on shared-with-all smartlists, Users icon on specific-shared
- [x] Version string updated to v1.67
- [x] v1.68: Contact table header made fully opaque (solid bg-background) so it stays readable when scrolling
- [ ] v1.69: Add delete button to appointment cards/list items in AppointmentsPanel
- [ ] v1.69: Fix phone field editable in Add Contact dialog (currently locked when activeContact has a phone)
- [ ] v1.69: Fix automation message templates — appointment date/time/timezone not being substituted correctly
- [ ] v1.69: Add Ask AI button to SMS compose area in conversation panel
- [ ] v1.69: Add Ask AI button to email compose area in conversation panel
- [x] v1.69: Email From name now uses the logged-in user's name (not OliviaAI)
- [x] v1.69: Disabled Mailgun click-tracking so URLs in emails are not rewritten
- [x] v1.69: Added Ask AI button to SMS/iMessage compose in conversation panel
- [x] v1.69: Added Ask AI button to email compose in conversation panel
- [x] v1.70: Automation heartbeat scheduler — added setupHeartbeat tRPC procedure (registers automationRun cron every minute), runNow procedure (manual trigger), Setup Scheduler + Run Now buttons in AutomationsPanel header, app_settings table for storing taskUid, internal x-internal-cron bypass for runNow
- [x] v1.71: Fix automation processor — consecutive action steps (SMS, email, iMessage) now run in a single pass per tick; wait steps correctly pause execution until the delay expires; prevents out-of-order sends when Run Now is clicked
- [ ] v1.72: Add AI chat panel to Contacts page — natural language contact creation via AI
- [ ] v1.72: Add timezone field to contacts schema, migration, DB helpers
- [ ] v1.72: Add timezone selector to Edit Contact dialog
- [ ] v1.72: Show timezone in contacts table
- [ ] v1.72: Use contact timezone in automation appointment date/time formatting
- [ ] v1.72: Add AI chat panel to Contacts page for natural language contact creation
- [x] v1.72: Add timezone column to contacts schema and DB migration
- [x] v1.72: Add timezone to upsertContact db helper and tRPC procedure
- [x] v1.72: Add timezone selector to Edit Contact dialog
- [x] v1.72: Use contact timezone (priority over appointment timezone) in automation message variables
- [x] v1.72: Add contacts.addFromAI tRPC procedure for natural language contact creation
- [x] v1.72: Add Ask AI button and chat panel to Contacts tab
- [x] v1.73: Add phone normalisation in useTelnyxPhone.ts — 04xx → +614xx, 614xx → +614xx before dialling
- [x] v1.74: E.164 phone normalisation applied to all server-side SMS sends (telnyx.sms, telnyx.sendMessage, invite SMS, automation processor)
- [x] v1.74: Timezone column added to contacts table view
- [x] v1.74: Ringback tone plays during call connecting/ringing states
- [ ] v1.76: Contacts AI chat — read fields, edit any field, add/remove tags, update status via natural language tool-calling
- [x] v1.76: Contacts AI chat — full tool-calling for read/edit/tag/status via natural language
- [x] v1.76: SMS thread phone normalisation — getSmsThread queries both raw and E.164 so bubbles always show
- [x] v1.76: upsertContact normalises phone to E.164 on save to prevent future mismatches
- [x] v1.79: Fix aiChat LLM context overflow — trim search results to essential fields, add empty choices guard, fix undefined query in search_contacts
- [x] v1.80: Fix AI chat tool-calling — normalizeMessage in llm.ts now preserves tool_calls on assistant messages so multi-turn tool chains (search then edit) actually execute
- [x] v1.81: Add contacts.addFromAI legacy alias (returns refresh prompt); both dev and production now handle the old procedure name gracefully
- [x] v1.82: Fix edit_contact tool — use direct updateContactById (UPDATE WHERE id) instead of upsertContact (INSERT ON DUPLICATE KEY UPDATE phone) to guarantee writes actually persist
- [x] v1.83: Change all email sender display name from 'Loop' to 'Henry from Scalbl.io' across automation, invite drip, manual email, and default fallback
- [x] v1.84: Skip expired before_event wait steps — if the calculated trigger time has already passed when enrollment reaches the wait step, skip that wait + its following action step instead of firing immediately
- [ ] v1.85: Add Execution Logs tab to automations page — DB table, backend procedure, GHL-style log table UI with filters (date, action type, status, contact) and pagination
- [x] v1.85: Add Execution Logs tab to Automations page with filters and paginated table
- [x] v1.86: Fix automation skip logic — skip ALL action steps after expired before_event wait, not just one
- [x] v1.87: Fix appointment booking to parse date/time in selected timezone; automation engine already converts to lead timezone for message placeholders
- [x] v1.88: Add QuickBookBar to Appointments page — contact autocomplete, date/time in Adelaide timezone, calendar picker, duration selector
- [x] v1.89: Fix automation builder save — staleTime 0 so steps always load fresh, invalidate get cache after save
