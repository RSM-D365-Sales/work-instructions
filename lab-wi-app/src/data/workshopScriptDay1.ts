// Day 1 facilitator script content.
//
// Held as data rather than JSX so the page can interleave a shared note box after
// every block without the content and the note plumbing tangling together. The
// `html` strings are authored here by us — they never contain user input — so the
// renderer can inject them directly.
//
// A printable standalone copy of this script also lives at the repo root
// (WORKSHOP_SCRIPT_DAY1.html). If you edit the wording here, that file will drift.

export type Node =
  | { t: 'p'; html: string }
  | { t: 'h'; html: string }
  | { t: 'say'; html: string }
  | { t: 'do'; html: string }
  | { t: 'ul'; items: string[] }
  | { t: 'callout'; kind: 'warn' | 'info' | 'stop'; title: string; html: string }
  | { t: 'table'; head: string[]; rows: string[][]; matrix?: boolean }
  | { t: 'part'; kind: 'overview' | 'hands' | 'qa'; label: string; roles?: string[]; nodes: Node[] };

export interface RunRow { clock: string; who: string; what: string }

export interface Block {
  key: string;               // doubles as the note key and the anchor id
  time: string;
  title: string;
  dur: string;
  goal: string;
  run: RunRow[];
  nodes: Node[];
  cut?: { title: string; html: string };
}

export type ScheduleItem =
  | ({ kind: 'block' } & Block)
  | { kind: 'lunch'; time: string; label: string; note: string };

export interface Section {
  key: string;
  title: string;
  nodes: Node[];
  /** Sections with a note key get a shared note box. */
  noteKey?: string;
}

export const SCRIPT_SLUG = 'day1';

export const META = [
  { k: 'Session', v: 'Wednesday, July 22, 2026', sub: '10:00 AM – 3:00 PM · Day 1 of 2' },
  { k: 'Format', v: 'Guided demo + hands-on', sub: 'Participants work the system in role' },
  { k: 'Day 1 deliverable', v: 'A prioritised wishlist', sub: 'It becomes the Day 2 agenda' },
];

export const INTRO_LEDE =
  'The run-of-show behind the published agenda. Every block follows the same three beats — ' +
  '<b>RSM frames it, your team drives it, we capture what’s missing</b>. This document is for the RSM team: ' +
  'it contains timings, cut lists and candid notes on what to do when something misbehaves.';

export const PRE_SECTIONS: Section[] = [
  {
    key: 'preflight',
    title: 'Pre-flight — the day before, and T-30',
    noteKey: 'preflight',
    nodes: [
      {
        t: 'h', html: 'Stage the data',
      },
      {
        t: 'p',
        html: 'The hands-on segments assume content already exists. Check each of these the evening before:',
      },
      {
        t: 'ul',
        items: [
          '<b>Several approved Work Instructions</b>, ideally ones the client recognises from Uniflow (e.g. <i>Acidified Methanol</i>, <i>NSE Muscles Phosphate Buffer</i>) — enough that every participant can claim their own in Block 2.',
          '<b>One Work Instruction with two versions</b> so the version <b>diff</b> view has something real to show.',
          '<b>One production order already in progress</b> so the Dashboard isn’t empty at 10:15.',
          '<b>Reagent items in stock</b> for whatever recipes people will run, so Block 3 doesn’t stall on missing inventory.',
          '<b>Equipment / scales configured</b> — the weigh-tolerance moment in Block 3 is the best thing in the demo; don’t let it fail on setup.',
          '<b>The Session Wishlist board empty</b> (or cleared of previous sessions) so the wrap-up shows only today’s items.',
        ],
      },
      {
        t: 'callout',
        kind: 'warn',
        title: 'Have a fallback for every hands-on',
        html: 'For each block, know which pre-built record you’d switch to if a participant’s own attempt goes sideways. Losing four minutes to a broken record is survivable; losing fifteen is not.',
      },
      { t: 'h', html: 'Room &amp; team' },
      {
        t: 'ul',
        items: [
          '<b>Assign the four RSM leads now</b> — the agenda has a blank per block. Fill them in and make sure each lead has actually run their block once.',
          '<b>Name a floor-walker</b> whose only job during hands-on is unsticking people. The person presenting cannot also be doing this.',
          '<b>Name a scribe</b> who logs to the Session Wishlist live.',
          '<b>Decide who gets which role before the day, and put it on their table card</b> along with their credentials. Spreading Author, Approver and Operator across the room is what makes the approval and hand-off moments land — if everyone ends up an Author, Block 2 has nobody to approve anything.',
          'Projector at 110% browser zoom; participants on their own machines.',
          'Confirm the client’s network allows the site, and have a phone hotspot as backup.',
        ],
      },
    ],
  },
  {
    key: 'rhythm',
    title: 'The rhythm of every block',
    nodes: [
      {
        t: 'p',
        html: '<b>RSM Overview → Hands-On (in role) → Q&amp;A.</b> Hold this shape even when you’re behind. The temptation when time is short is to keep talking and cut the hands-on — do the opposite. <b>The hands-on is the product.</b> A client who has driven the system for ten minutes will argue for it internally; a client who watched you drive it for thirty will not.',
      },
      {
        t: 'callout',
        kind: 'warn',
        title: 'Time discipline',
        html: 'Every block below has a cut list. Decide at the block’s midpoint whether you’re taking it — not at the end, when the only thing left to cut is the part that mattered.',
      },
      { t: 'h', html: 'Capture discipline — the Session Wishlist' },
      {
        t: 'p',
        html: 'Day 1’s actual deliverable is a prioritised list of gaps, and the platform has a purpose-built board for it. It is at the <b>bottom of the sidebar</b> (💡 <b>Session Wishlist</b>) and is visible to <b>every role</b>, including the client’s own logins.',
      },
      {
        t: 'do',
        html: 'Open <span class="path">Session Wishlist</span> from the sidebar footer. Each item takes a <b>title</b>, <b>detail</b>, a <b>section</b>, a <b>category</b> (feature / bug / idea / question / like) and a <b>priority</b> (critical / high / medium / low).',
      },
      {
        t: 'ul',
        items: [
          '<b>Set Section to the block name</b> — “Work Instructions”, “Execution”, and so on. The wrap-up is far easier to run when items are already grouped.',
          '<b>Log the likes too</b>, not just the gaps. The <i>like</i> category exists for a reason: it tells you what not to change, and it keeps the board from reading as a list of complaints.',
          '<b>Let participants add their own items.</b> An item in the client’s own words carries more weight in the wrap-up than the same point paraphrased by RSM.',
          'The board updates <b>live on every screen</b>, so the scribe can log while you keep talking, and everyone sees the list grow.',
        ],
      },
      {
        t: 'callout',
        kind: 'info',
        title: 'Why this matters',
        html: 'At 2:45 you will put this board on the projector and triage it into the Day 2 agenda. Everything you fail to capture during the day is something you have to remember at 2:45 — and you won’t.',
      },
    ],
  },
];

export const SCHEDULE: ScheduleItem[] = [
  {
    kind: 'block',
    key: 'b1',
    time: '10:00',
    title: 'Welcome, Overview, Login, Roles & Security',
    dur: '70 min · to 11:10',
    goal: '<b>By 11:10 they should believe:</b> this is one role-aware system that mirrors how their lab is actually organised — not five disconnected screens, and not a system where everyone can do everything.',
    run: [
      { clock: '10:00–10:12', who: 'RSM lead', what: '<b>Welcome &amp; introductions.</b> Goals for the day, how the session runs, and the promise that they will be driving. Round the room: name, role today, one thing they want to see.' },
      { clock: '10:12–10:25', who: 'RSM lead', what: '<b>The big picture.</b> Dashboard tour and the reagent-production lifecycle end to end.' },
      { clock: '10:25–10:35', who: 'RSM lead', what: '<b>Uniflow → platform mapping.</b> What carries across, what changes, what is deliberately different.' },
      { clock: '10:35–10:45', who: 'RSM lead', what: '<b>The role model</b> and the Admin setup surfaces — Users, Labs, Equipment, Notifications, default lab.' },
      { clock: '10:45–11:02', who: 'Everyone', what: '<b>Hands-on:</b> sign in, explore, and deliberately test the boundaries.' },
      { clock: '11:02–11:10', who: 'All', what: '<b>Q&amp;A</b> + first Wishlist entries.' },
    ],
    nodes: [
      {
        t: 'part', kind: 'overview', label: 'RSM Overview',
        nodes: [
          { t: 'say', html: '“Before we show you a single screen — the way today works is that we’ll frame each area for about fifteen minutes, and then you’ll drive it. Not us. You’ll be signed in as different roles, so you’ll see different things, and that’s the point. And every time something is missing or annoying, we’re going to write it down in the system itself. What we’ve collected by three o’clock is what we’ll spend tomorrow on.”' },
          { t: 'do', html: 'Sign in as <b>Admin</b>. Land on <span class="path">Dashboard</span>. Walk the tiles top to bottom without clicking — draft work, pending review, in-flight production, insufficient stock.' },
          { t: 'say', html: '“This is the morning view. Everything on this screen is a thing someone has to do something about — that’s the whole design principle. Let me trace one reagent from request to delivery, and then we’ll come back and you’ll do it yourselves.”' },
          { t: 'p', html: 'Walk the lifecycle in one pass, naming each stage as a place you’ll return to later in the day: <b>Work Instruction → Approval → Production Order → Execution → QC → Scheduling</b>. Keep it to a single trace; resist opening every screen.' },
          { t: 'do', html: 'Then the role model. <span class="path">Users</span> → show the five roles. <span class="path">Labs</span> → the default-lab concept. <span class="path">Equipment</span> → one configured scale, and flag it forward: <i>“this is what makes the weigh step in Block 3 work.”</i> <span class="path">Notifications</span> → the Admin inbox.' },
          { t: 'say', html: '“Five roles — Admin, Author, Approver, Operator, Lab. The role decides which menus even appear. Nobody is trained not to click the wrong thing; the wrong thing isn’t there.”' },
        ],
      },
      {
        t: 'part', kind: 'hands', label: 'Hands-on — everyone signs in, in role (17 min)',
        roles: ['Admin', 'Author', 'Approver', 'Operator', 'Lab'],
        nodes: [
          {
            t: 'ul',
            items: [
              'Everyone signs in with their assigned account and <b>reads their own sidebar out loud</b> to their neighbour.',
              '<b>Compare sidebars across the table.</b> The Lab scientist has no Work Instructions or Production Orders at all; the Admin has Users, Labs and Equipment that nobody else has. Use the role matrix below to confirm what each person <i>should</i> be seeing.',
              '<b>Test the boundaries deliberately:</b> an Operator tries to edit a Work Instruction; an Author tries to approve their own; a Lab user looks for Production Orders.',
              'Everyone sets their <b>default lab</b> and finds the <b>Session Wishlist</b> at the bottom of the sidebar — they’ll be using it all day.',
            ],
          },
          {
            t: 'callout', kind: 'warn', title: 'Watch out',
            html: 'This is the first time the room touches the system, so it is also where login problems surface. The floor-walker should start at the far end of the room and work back. If someone can’t get in, pair them with a neighbour rather than holding the block.',
          },
        ],
      },
      {
        t: 'part', kind: 'qa', label: 'Q&A / Wrap-up (8 min)',
        nodes: [
          {
            t: 'ul',
            items: [
              '<b>“Does this role model match your segregation of duties?”</b> — the question that matters most in this block. Push for specifics: who signs off in reality, and does the system let the right person do it?',
              '“What does a successful day look like for you?” Write the answers down — you’ll check against them at 2:45.',
            ],
          },
          { t: 'say', html: '“Anything you’d change about who can see what — put it in the Wishlist now, section ‘Roles &amp; Security’. Don’t save it for the end, you’ll forget.”' },
        ],
      },
    ],
    cut: {
      title: 'If you’re behind at 10:35',
      html: 'Cut the Uniflow mapping to three sentences and move on — it’s a conversation that will recur naturally all day. Protect the hands-on segment; it is the first impression of the whole session. Do not cut the boundary testing.',
    },
  },
  {
    kind: 'block',
    key: 'b2',
    time: '11:20',
    title: 'Work Instructions Core — build, edit & approve',
    dur: '70 min · to 12:30',
    goal: '<b>By 12:30 they should believe:</b> their real recipes fit this model, an author can build one without training, and approval is a genuine control rather than a checkbox.',
    run: [
      { clock: '11:20–11:32', who: 'RSM lead', what: '<b>Anatomy of a Work Instruction</b> — reagent-item link, target molarity, scheduled time.' },
      { clock: '11:32–11:42', who: 'RSM lead', what: '<b>Step Library</b> and the step types.' },
      { clock: '11:42–11:52', who: 'RSM lead', what: '<b>Editor, versioning, diff, approval workflow.</b>' },
      { clock: '11:52–12:20', who: 'Everyone', what: '<b>Hands-on:</b> claim a WI, edit it, send for approval, cross-approve.' },
      { clock: '12:20–12:30', who: 'All', what: '<b>Q&amp;A — likes &amp; gaps.</b> The richest discussion of the day.' },
    ],
    nodes: [
      {
        t: 'part', kind: 'overview', label: 'RSM Overview',
        nodes: [
          { t: 'do', html: 'Open an <b>existing, recognisable</b> Work Instruction — not a blank one. Header first: product / reagent-item link, target molarity, scheduled time. Then scroll the steps.' },
          { t: 'say', html: '“We deliberately opened one of yours rather than a toy example, because the question we need answered this morning isn’t ‘is this a nice editor’ — it’s ‘does your chemistry actually fit in here’. Tell us where it doesn’t.”' },
          { t: 'do', html: '<span class="path">Step Library</span> → the palette: gather reagents, weigh, dispense, mix, stir/vortex/invert, pH adjust, heat/cool, transfer, bring-to-volume, cap, package, attachments, record time, QC, user-defined.' },
          { t: 'say', html: '“These are the building blocks. The one at the end matters most for you — user-defined — because no library survives contact with a real lab. When you hit something that doesn’t fit, that’s a Wishlist item, and it might be a five-minute fix.”' },
          { t: 'do', html: 'Editor mechanics, briskly: step navigator, insert-between, collapse/expand, drag-to-reorder. Then <b>versioning</b> — open the pre-staged two-version WI and show the <b>diff</b> view.' },
          { t: 'say', html: '“This is the part QA will care about. A production order is stamped with the exact version it was made from. You can publish version four tomorrow and every batch made on version three still points at version three, forever.”' },
        ],
      },
      {
        t: 'part', kind: 'hands', label: 'Hands-on — build & approve (28 min · the longest of the day)',
        roles: ['Author', 'Approver'],
        nodes: [
          {
            t: 'ul',
            items: [
              '<b>Each person claims their own Work Instruction</b> — ideally one they wrote in real life — or creates a new one. Have them say out loud which one they’ve taken so two people don’t claim the same record.',
              '<b>Walk the steps</b> and <b>add or edit one</b>, to feel the authoring tools rather than just read them.',
              '<b>Send for approval.</b>',
              '<b>Each person approves somebody else’s.</b> Cross-review, deliberately — nobody approves their own. Agree the pairings before you start so this doesn’t take five minutes to organise.',
            ],
          },
          {
            t: 'callout', kind: 'warn', title: 'Watch out',
            html: 'This block runs long more often than any other — people get absorbed in their own recipe, which is a good sign but a scheduling problem. Call a hard warning at <b>12:12</b> so the approval half actually happens. An author who never sees their WI get approved has missed the point of the block.',
          },
        ],
      },
      {
        t: 'part', kind: 'qa', label: 'Q&A — likes & gaps (10 min)',
        nodes: [
          {
            t: 'ul',
            items: [
              '<b>“What’s missing from the step library for your chemistry?”</b> — the single highest-value question of the day. Every answer is a Wishlist item, section “Work Instructions”.',
              '“Is the approval flow strict enough? Too strict?”',
              '“Would your authors actually build recipes here, or would they still draft in Word first?” — an uncomfortable question worth asking.',
            ],
          },
        ],
      },
    ],
    cut: {
      title: 'If you’re behind at 11:52',
      html: 'Cut the versioning/diff walkthrough from the overview and fold it into the Q&amp;A instead — it’s easier to explain against a WI they’ve just edited. Never cut the cross-approval; the hand-off between two people in the room is the moment the workflow becomes real.',
    },
  },
  {
    kind: 'lunch',
    time: '12:30',
    label: '🍽 Lunch — 45 min · to 1:15',
    note: 'RSM huddle over lunch — five minutes, standing: are we on time, what’s the mood, and is anything on the Wishlist already big enough that it should change this afternoon?',
  },
  {
    kind: 'block',
    key: 'b3',
    time: '1:15',
    title: 'Production Orders — Execution Core',
    dur: '60 min · to 2:15',
    goal: '<b>By 2:15 they should believe:</b> an operator can be guided through a batch without paper, and what comes out the other end is audit-grade evidence rather than a signature on a form.',
    run: [
      { clock: '1:15–1:20', who: 'RSM lead', what: '<b>Re-entry.</b> Recap the morning in three sentences; connect the approved WI to the batch we’re about to run.' },
      { clock: '1:20–1:32', who: 'RSM lead', what: '<b>Create a production order</b> from an approved WI; walk the execution experience.' },
      { clock: '1:32–1:40', who: 'RSM lead', what: '<b>Deviation flagging, QC tests, Certificate of Analysis.</b>' },
      { clock: '1:40–2:05', who: 'Everyone', what: '<b>Hands-on:</b> run a batch end to end, then break it on purpose.' },
      { clock: '2:05–2:15', who: 'All', what: '<b>Q&amp;A</b> — what would this feel like on the floor?' },
    ],
    nodes: [
      {
        t: 'callout', kind: 'info', title: 'This is the centrepiece',
        html: 'The post-lunch block is the one people remember. Weigh-tolerance gating and the deviation flag are the two moments that land hardest — protect both. If you sacrifice anything here, sacrifice the overview, not the hands-on.',
      },
      {
        t: 'part', kind: 'overview', label: 'RSM Overview',
        nodes: [
          { t: 'say', html: '“This morning you wrote the recipe and approved it. Now we’re going to make the batch. The person doing this in real life is wearing gloves, is standing up, and is not going to read a wall of text — so watch how much the screen tells them versus asks them.”' },
          { t: 'do', html: 'Create a production order from an approved WI. Then open execution and walk it: step-by-step guidance → <b>scale scan and weigh-tolerance gating</b> → volumetric <b>dispense</b> → attachments.' },
          { t: 'say', html: '“Watch this. I’ll enter a weight that’s outside tolerance. — The system doesn’t let it through, and it doesn’t just record a failure; it records the actual measured value and the deviation percentage. A year from now, an investigator can see exactly what happened, not just that somebody ticked a box.”' },
          { t: 'do', html: 'Then the exception path: flag a <b>possible deviation</b> → supervisor notification (Microsoft Teams). Then end-of-run <b>QC tests</b>, the awaiting-QC and complete statuses, and the <b>Certificate of Analysis</b>.' },
          { t: 'say', html: '“The deviation button is deliberately easy to reach. If flagging a problem is harder than ignoring it, people ignore it — and then you find out at the end of the month.”' },
        ],
      },
      {
        t: 'part', kind: 'hands', label: 'Hands-on — run a production order (25 min)',
        roles: ['Operator', 'Approver'],
        nodes: [
          {
            t: 'ul',
            items: [
              '<b>Each person creates their own production order</b> against the Work Instruction they approved this morning — the continuity is the point, so make it explicit.',
              '<b>Happy path first:</b> run the batch end to end, weighing and dispensing within tolerance.',
              '<b>Then break it.</b> Deliberately weigh out of tolerance and see the gate. Flag a possible deviation and watch the supervisor notification fire.',
              '<b>Finish with QC checks</b> and open the resulting certificate.',
            ],
          },
          {
            t: 'callout', kind: 'warn', title: 'Watch out',
            html: 'Two things reliably go wrong here. <b>Missing stock</b> for the chosen recipe blocks the run — have a known-good recipe ready to redirect people to. And <b>the Teams notification</b> depends on integration being live; if it isn’t, say so plainly and show the in-app Notifications inbox instead. Do not let the room think they saw something they didn’t.',
          },
        ],
      },
      {
        t: 'part', kind: 'qa', label: 'Q&A — recap (10 min)',
        nodes: [
          {
            t: 'ul',
            items: [
              '<b>“What felt natural, and what would you change on the floor?”</b> Ask the person who actually runs batches, by name.',
              '“Is the tolerance gate set where you’d want it — and who should be allowed to override it?”',
              '“What would your QA team want on that certificate that isn’t there?”',
            ],
          },
        ],
      },
    ],
    cut: {
      title: 'If you’re behind at 1:40',
      html: 'Cut the Certificate of Analysis from the overview — it re-appears naturally at the end of the hands-on when people finish their own runs. Keep the deviation demonstration; it is the moment that separates this from a checklist app.',
    },
  },
  {
    kind: 'block',
    key: 'b4',
    time: '2:25',
    title: 'Planned Production Orders & Scheduling',
    dur: '20 min · to 2:45',
    goal: '<b>By 2:45 they should believe:</b> this connects to D365 and to the wider stock picture — it isn’t an island that someone has to keep in sync by hand.',
    run: [
      { clock: '2:25–2:35', who: 'RSM lead', what: '<b>Planned Production Orders</b> from D365, <b>Unscheduled Orders</b>, and the <b>Production Schedule</b> / Gantt.' },
      { clock: '2:35–2:41', who: 'Everyone', what: '<b>Guided walkthrough</b> — open the schedule and a planned order together.' },
      { clock: '2:41–2:45', who: 'All', what: '<b>Q&amp;A</b> on planning cadence and D365 fit.' },
    ],
    nodes: [
      {
        t: 'callout', kind: 'warn', title: 'Twenty minutes for six modules',
        html: 'This block is badly outnumbered by its own content. <b>Do not attempt to demo everything listed.</b> Pick the schedule plus <i>one</i> surrounding module based on what the room has reacted to most today, and name the rest as things you can open tomorrow. Rushing all six leaves no impression at all.',
      },
      {
        t: 'part', kind: 'overview', label: 'RSM Overview',
        nodes: [
          { t: 'do', html: '<span class="path">Planned Production Orders</span> → where D365 demand lands. <span class="path">Unscheduled Orders</span> → what hasn’t been slotted. <span class="path">Production Schedule</span> → how a WI’s scheduled time blocks the calendar.' },
          { t: 'say', html: '“Everything you’ve done today started from a button we pressed ourselves. In production, most of this arrives from D365 — planning generates the demand, it lands here, and someone decides when it runs. Same execution experience at the end of it.”' },
          { t: 'p', html: 'Then <b>name</b> the surrounding modules and open only the one that fits today’s conversation: <b>Inventory</b> &amp; on-hand, <b>Cycle Count</b>, <b>Reagent Orders</b> &amp; receiving, <b>Quality Trends</b>.' },
        ],
      },
      {
        t: 'part', kind: 'hands', label: 'Guided walkthrough (6 min)',
        roles: ['Approver', 'Admin'],
        nodes: [
          {
            t: 'ul',
            items: [
              'Everyone opens the schedule and one planned order, and traces how it would become a production run.',
              'Keep this one led from the front — there isn’t time for open exploration, and that’s fine to say out loud.',
            ],
          },
        ],
      },
      {
        t: 'part', kind: 'qa', label: 'Q&A (4 min)',
        nodes: [
          {
            t: 'ul',
            items: [
              '<b>“How does this fit your planning cadence?”</b> Weekly? Daily? Who actually decides the sequence today?',
              'Park anything deep — this is the natural feeder for a Day 2 deep-dive, so say <i>“let’s put that on the board for tomorrow”</i> rather than starting it now at 2:43.',
            ],
          },
        ],
      },
    ],
    cut: {
      title: 'If you’re behind at 2:35',
      html: 'Drop the surrounding-modules tour entirely and go straight to the wrap-up on time. <b>Starting the wrap-up late is the worst outcome of the day</b> — it’s the only block whose output you actually need.',
    },
  },
  {
    kind: 'block',
    key: 'b5',
    time: '2:45',
    title: 'Day 1 Wrap-up & Planning for Day 2',
    dur: '15 min · to 3:00',
    goal: '<b>By 3:00 you must have:</b> a triaged wishlist with owners, and a written Day 2 agenda the room has agreed to. Do not leave the room without the second one.',
    run: [
      { clock: '2:45–2:52', who: 'All', what: '<b>Read the board.</b> Walk the captured items section by section. Let the person who raised each one restate it in a sentence.' },
      { clock: '2:52–2:57', who: 'All', what: '<b>Triage.</b> Set priority on each item live. Assign an owner where one is obvious. Mark anything RSM must go away and answer.' },
      { clock: '2:57–3:00', who: 'RSM lead', what: '<b>Lock the Day 2 agenda</b> and read it back to the room.' },
    ],
    nodes: [
      {
        t: 'callout', kind: 'info', title: 'Run this from the board, on the projector',
        html: 'Put <span class="path">Session Wishlist</span> on the big screen and work through it live. Editing it in front of the room — changing a priority as someone argues for it — is what makes the client believe the list is real and not a courtesy exercise.',
      },
      { t: 'say', html: '“Before we set tomorrow — the things on this board are the ones you told us. We’re going to sort them by what actually hurts, not by what’s easy for us. So argue with the priorities now, because tomorrow’s agenda comes straight off this list.”' },
      {
        t: 'part', kind: 'qa', label: 'The three questions to close on',
        nodes: [
          {
            t: 'ul',
            items: [
              '<b>“What’s the one thing that would stop you adopting this?”</b> Ask it directly, and wait through the silence. This is the most valuable answer you’ll get all day and it rarely comes without a pause.',
              '“What surprised you — good or bad?”',
              '“Who else needs to see this before you could make a decision?”',
            ],
          },
        ],
      },
      {
        t: 'callout', kind: 'warn', title: 'Before you leave the room',
        html: 'Confirm the <b>start time</b> for Thursday, who is attending, and whether anyone needs a login they don’t yet have. Half-day sessions lose their first twenty minutes to logistics unless this is settled today.',
      },
      {
        t: 'do',
        html: '<b>RSM, immediately after:</b> the board is realtime and persists, so review it again that evening. Anything you can genuinely turn around overnight is worth far more on Thursday morning than another slide. Be conservative about what you promise — showing two fixes you committed to beats half-finishing five.',
      },
    ],
  },
];

export const APPENDICES: Section[] = [
  {
    key: 'matrix',
    title: 'Appendix A — Role visibility matrix',
    nodes: [
      {
        t: 'p',
        html: 'What each role sees in the sidebar. Use this during the Block 1 boundary exercise to confirm people are seeing the right thing — and to spot immediately when someone is signed in as the wrong role.',
      },
      {
        t: 'table',
        matrix: true,
        head: ['Sidebar item', 'Admin', 'Author', 'Approver', 'Operator', 'Lab'],
        rows: [
          ['Dashboard', '1', '1', '1', '1', '1'],
          ['Notifications', '1', '0', '0', '0', '0'],
          ['Work Instructions', '1', '1', '1', '1', '0'],
          ['Production Orders', '1', '1', '1', '1', '0'],
          ['Production Schedule', '1', '1', '1', '1', '0'],
          ['Quality Trends', '1', '1', '1', '0', '0'],
          ['Inventory', '1', '1', '1', '0', '0'],
          ['Cycle Count', '1', '1', '1', '1', '1'],
          ['Planned Production Orders', '1', '0', '1', '0', '0'],
          ['Unscheduled Orders', '1', '0', '0', '0', '0'],
          ['Reagent Orders', '1', '1', '1', '1', '1'],
          ['Users · Labs · Equipment', '1', '0', '0', '0', '0'],
          ['Reagent Items', '1', '1', '0', '0', '0'],
          ['Step Library', '1', '1', '1', '0', '0'],
          ['Session Wishlist <span class="muted">(sidebar footer)</span>', '1', '1', '1', '1', '1'],
        ],
      },
      {
        t: 'callout', kind: 'info', title: 'Two things worth saying out loud in Block 1',
        html: 'The <b>Lab</b> role is the narrowest by design — a lab scientist orders reagents and counts stock, and never touches a recipe. And <b>Admin bypasses every role restriction</b>, so if you’re driving from an admin account you will see things the room cannot. Say that when someone asks why your screen looks different.',
      },
    ],
  },
  {
    key: 'recovery',
    title: 'Appendix B — When it goes wrong',
    nodes: [
      {
        t: 'table',
        head: ['Situation', 'What to do'],
        rows: [
          ['<b>A participant can’t sign in</b>', 'Pair them with a neighbour and keep moving; fix it during the next break. Never hold a block for one login.'],
          ['<b>Someone is seeing the wrong menus</b>', 'They’re signed in as a different role than you think. Check their account against Appendix A — and remember an Admin account sees everything, which masks the whole boundary exercise.'],
          ['<b>Two people edited the same Work Instruction</b>', 'Redirect one to a different recipe and treat it as a talking point about record locking — then log it as a Wishlist item rather than talking around it.'],
          ['<b>Production order blocked by missing stock</b>', 'Switch that person to the known-good recipe you staged. Note it — insufficient stock has a dashboard tile and a planner flow, so it’s a feature you can pivot into rather than an embarrassment.'],
          ['<b>Teams / email notification doesn’t fire</b>', 'Say plainly that the integration isn’t live in this environment and show the in-app Notifications inbox instead. Never imply they saw a live integration when they didn’t — it’s the fastest way to lose a technical audience.'],
          ['<b>Network drops</b>', 'Move to the projector on a hotspot and switch to a led walkthrough. Announce the change of format rather than letting the room wonder.'],
          ['<b>A question you can’t answer</b>', 'Log it as a Wishlist item, category <i>question</i>, with the asker’s name. Answering it on Thursday morning is worth more than guessing on Wednesday afternoon.'],
          ['<b>You’re 15+ minutes behind by lunch</b>', 'Take the Block 4 cut in advance — plan to drop the surrounding-modules tour — and tell the RSM team over lunch so nobody is improvising at 2:40.'],
        ],
      },
    ],
  },
  {
    key: 'day2',
    title: 'Appendix C — Day 2 candidates',
    noteKey: 'day2',
    nodes: [
      {
        t: 'p',
        html: 'The Day 2 agenda is set by the room at 2:45 and should come off the Wishlist board. Keep this list in your back pocket only for when the room goes quiet — lead with their items, not yours.',
      },
      {
        t: 'ul',
        items: [
          '<b>Deep-dive on whichever block generated the most items</b> — usually Work Instructions.',
          '<b>Answers to the parked questions</b> from Day 1, prepared overnight.',
          '<b>Reagent Orders and the delivery loop</b> — barely touched on Day 1, and it’s the Lab role’s whole world.',
          '<b>Quality Trends, Inventory and Cycle Count</b>, if Block 4 got squeezed as expected.',
          '<b>The D365 integration story</b> in technical detail, if IT are in the room on Thursday.',
          '<b>Anything RSM turned around overnight</b> — demonstrably acting on their feedback is the strongest possible opening for Day 2.',
        ],
      },
      {
        t: 'callout', kind: 'warn', title: 'Untested — click it through before you show it',
        html: '<b>Standing Orders</b> (recurring reagent requests — “20 L every Monday until December”) was built on July 21. The database migration is in place, but it has not been clicked through in the deployed app. Keep it out of the Day 1 script. Run one series end to end on Wednesday evening and it becomes a strong Thursday addition — generated orders show a ↻ badge on the Reagent Orders list that links back to the series.',
      },
    ],
  },
];
