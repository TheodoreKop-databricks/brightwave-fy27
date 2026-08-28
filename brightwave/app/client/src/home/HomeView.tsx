/**
 * Home / landing page.
 *
 * Template concern: this is where you tell the STORY of the use case.
 * The narrative pieces (hero persona, headline, situation, goal, journey
 * diagram quotes, starter prompts, featured action) are hardcoded in this
 * file as an EXAMPLE — rewrite them for your demo. Only `assistantScript`
 * and `branding` stay config-driven (script chain is reused by the chat
 * dock; branding is also read by the shell header).
 *
 * The journey diagram's 4 cards wire into the floating chat dock via
 * `dockController` (pub/sub in `chat/dockController.ts`) — clicking a card
 * either navigates somewhere, opens the dock, or opens the dock and
 * auto-sends a scripted prompt. That's the "see the demo in action" path.
 */
import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Eye,
  Mail,
  MessageCircleQuestion,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import { useSession, type ScriptStep } from '@/lib/api';
import { fetchActivity } from '@/lib/returns';
import type { ActivityEvent } from '@/shared/types';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { AgentLoopFlow } from '@/architecture/AgentLoopFlow';

// ---------------------------------------------------------------------------
// Narrative — REPLACE for your demo.
// This is what the landing page shows. Hero persona, headline, situation,
// starter prompts, and the "featured action" are the story hooks that tell
// the viewer what this app does. Rewrite these to match your use case.
// ---------------------------------------------------------------------------

const HERO = {
  name: 'Priya',
  role: 'CMO at Brightwave',
};

const STORY = {
  headline: "Replicate what's working, while the quarter's still in play.",
  situation:
    "Our winners are running ~4.0 ROAS on $2.3M spend, while a cluster of underperformers is stuck at ~1.1 ROAS leaking $6.8M in recoverable spend. The gap is sharpening every week. I need to find the patterns in the winners and apply them across the underperformers before we run out of time.",
  goal: "Identify why winners win, and replicate their playbook across the underperformer backlog before quarter-end.",
};

const STARTER_QUESTIONS = [
  'Why is CMP-0000214 underperforming?',
  'What campaigns should I replicate?',
  'Which winners should we study for patterns?',
];

// The featured action's copy is inlined in the JSX below — the section is just
// HTML, edit it freely. The prompt text is the single thing the agent runs.
const FEATURED_ACTION_PROMPT =
  'CMP-0000214 is one of our worst underperformers at $2.3M spend and 1.1 ROAS. I see it has a matching winner. Tell me what makes that winner work — the channel, the creative strategy, the target segment. Then give me a brief for replicating those patterns across CMP-0000214. I want to know which elements are most likely to move the needle and how much ROAS lift we can expect.';

export function HomeView() {
  const { config, configError, retry: retrySession } = useSession();
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Activity feed errors are non-fatal (feed silently empty). Logged for
    // dev debugging; the page still renders the story without it.
    const reload = () =>
      fetchActivity(20).then(setActivity).catch((e) => {
        console.error('[home] activity feed failed', e);
      });
    void reload();
    return dataMutated.subscribe(reload);
  }, []);

  if (configError) {
    return (
      <div className="p-12 max-w-xl text-sm">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive flex items-start gap-3">
          <AlertTriangle className="size-5 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <div className="font-semibold">Couldn't load app config</div>
            <div className="text-destructive/80">{configError}</div>
            <button
              type="button"
              onClick={retrySession}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs hover:bg-destructive/15 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!config) {
    return <div className="p-12 text-muted-foreground">Loading…</div>;
  }

  const heroFirstName = HERO.name.split(/\s+/)[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-14 space-y-5 sm:space-y-7">
        {/* Hero */}
        <section className="space-y-5">
          <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span className="inline-block h-px w-8 bg-foreground/40" />
            {HERO.name} · {HERO.role}
          </div>
          <h1 className="display text-3xl sm:text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-tight text-foreground">
            {STORY.headline}
          </h1>
          <p className="hidden sm:block text-lg text-muted-foreground leading-relaxed max-w-3xl">
            {STORY.situation}
          </p>
          <p
            className="inline-block text-sm text-foreground italic border-l-2 pl-3 py-0.5 max-w-3xl"
            style={{ borderColor: 'var(--accent)' }}
          >
            <span className="font-semibold not-italic uppercase tracking-[0.15em] text-xs text-muted-foreground mr-2">
              Goal
            </span>
            {STORY.goal}
          </p>
        </section>

        {/* Persona journey diagram */}
        <section className="space-y-5">
          <div className="hidden sm:block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            A week of work · before noon
          </div>
          <JourneyDiagram heroName={heroFirstName} script={config.assistantScript} />

          <AgentLoopFlow />
        </section>

        {/* Starter prompts — each opens the floating assistant dock */}
        <section className="space-y-3">
          <div className="hidden sm:block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Try asking
          </div>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
            {STARTER_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => dockController.newAndSend(q)}
                className="flex w-full sm:w-auto sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-foreground/30 hover:shadow-sm transition-all"
              >
                <Sparkles className="size-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left sm:flex-none">{q}</span>
                <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        </section>

        {/* Featured action — climax. Inline the copy; edit this HTML freely. */}
        <section>
          <div
            className="rounded-2xl p-7 relative overflow-hidden"
            style={{
              background:
                'linear-gradient(135deg, color-mix(in oklch, var(--primary) 96%, white) 0%, color-mix(in oklch, var(--primary) 88%, var(--accent) 12%) 100%)',
              color: 'var(--primary-foreground)',
            }}
          >
            <div
              className="absolute -right-16 -top-16 size-52 rounded-full opacity-20"
              style={{ background: 'var(--accent)' }}
            />
            <div className="relative">
              <div className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80 mb-3">
                <Zap className="size-3.5" />
                Let the assistant handle it
              </div>
              <h3 className="display text-2xl font-semibold mb-2 leading-tight">
                Replicate the winner playbook across underperformers
              </h3>
              <p className="hidden sm:block text-sm opacity-85 leading-relaxed mb-5 max-w-2xl">
                The assistant analyzes CMP-0000214's matching winner to
                identify what's driving its 4.0 ROAS: the channel mix, the
                creative strategy, the audience targeting. It then drafts a
                brief for replicating those patterns and estimates the ROAS
                lift. Once you approve, it can replicate across your
                underperformer cluster.
              </p>
              <p className="sm:hidden text-sm opacity-85 leading-relaxed mb-5">
                Find what makes the winners work, draft a replication plan,
                apply it across underperformers.
              </p>
              <button
                onClick={() => dockController.newAndSend(FEATURED_ACTION_PROMPT)}
                className="inline-flex items-center gap-2 rounded-full bg-background text-foreground px-5 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Run this <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Proof — activity feed */}
        {activity.length > 0 && (
          <section className="space-y-4">
            <div className="hidden sm:block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Recent activity
            </div>
            <ActivityFeed
              events={activity}
              onJumpToReturn={(id) => navigate(`/campaign-desk?campaign=${id}`)}
            />
          </section>
        )}
      </div>
    </div>
  );
}

// --- Journey diagram -------------------------------------------------------

/**
 * Four-step narrative. Each step is clickable and fires the demo:
 *   - "Claire operates"    → navigate to Operations page
 *   - "She asks"           → open dock, auto-send "Why so many returns?"
 *   - "AI investigates"    → open dock (shows the investigation in progress)
 *   - "AI takes action"    → open dock, auto-send the final "send it" prompt
 *
 * `script` comes from config — the handlers pull the matching prompts.
 */
function JourneyDiagram({
  heroName,
  script,
}: {
  heroName: string;
  script: ScriptStep[];
}) {
  const navigate = useNavigate();
  const step0 = script[0];
  const step1 = script[1];
  const step2 = script[2];

  const steps = [
    {
      icon: <Eye className="size-5" />,
      role: `${heroName} operates`,
      quote: '"Green campaigns winning at 4.0x, red ones stuck at 1.1x."',
      highlight: false,
      onClick: () => navigate('/campaign-desk'),
    },
    {
      icon: <MessageCircleQuestion className="size-5" />,
      role: 'She asks',
      quote: '"Why is CMP-0000214 so far behind?"',
      highlight: false,
      onClick: () =>
        step0
          ? dockController.newAndSend(step0.prompt)
          : dockController.open(),
    },
    {
      icon: <Brain className="size-5" />,
      role: 'AI investigates',
      quote: '"Its matching winner uses a different channel angle. High relevance to premium segment."',
      highlight: true,
      onClick: () => dockController.open(),
    },
    {
      icon: <Wrench className="size-5" />,
      role: 'AI takes action',
      quote: '"Drafted replication brief. 2.5x ROAS lift predicted. Ready to replicate."',
      highlight: true,
      onClick: () => {
        // Fire step-1 (accept + draft). If user is mid-chain the dock will
        // still open; they can then click "Yes — send it" from the chip.
        if (step1) dockController.openAndSend(step1.prompt);
        else if (step2) dockController.openAndSend(step2.prompt);
        else dockController.open();
      },
    },
  ];

  return (
    <>
      {/* Desktop / tablet: 4 cards in a row with arrows between. */}
      <div className="hidden md:grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-3 items-stretch">
        {steps.map((s, i) => (
          <Fragment key={i}>
            <button
              onClick={s.onClick}
              className={`text-left rounded-xl px-4 py-4 flex flex-col gap-2 transition-all hover:shadow-sm ${stepCardClass(s.highlight)}`}
              style={stepCardStyle(s.highlight)}
            >
              <StepIcon step={s} size="sm" />
              <StepText step={s} />
            </button>
            {i < steps.length - 1 && (
              <div className="flex items-center justify-center text-muted-foreground">
                <ArrowRight className="size-4" />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* Phone: vertical rail of icons on the left (sequential-flow cue),
          card per step on the right. */}
      <ol className="md:hidden relative flex flex-col gap-2.5">
        {/* Vertical rail behind the icon column — starts just under
            step-1's icon and ends just above step-N's. */}
        <div
          aria-hidden
          className="absolute left-[18px] top-7 bottom-7 w-px bg-border"
        />
        {steps.map((s, i) => (
          <li key={i} className="relative flex items-start gap-3">
            <StepIcon step={s} size="md" className="relative z-10 shrink-0 mt-1" />
            <button
              onClick={s.onClick}
              className={`flex-1 min-w-0 text-left rounded-xl px-3 py-2.5 transition-all hover:shadow-sm ${stepCardClass(s.highlight)}`}
              style={stepCardStyle(s.highlight)}
            >
              <StepText step={s} compact />
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

// --- Journey step primitives ------------------------------------------------
// Shared between the desktop grid + the mobile rail. Owning the highlight
// styling here means a tweak to "what does highlighted look like" lands
// in one place instead of two.

type JourneyStep = {
  icon: React.ReactNode;
  role: string;
  quote: string;
  highlight: boolean;
  onClick: () => void;
};

function stepCardClass(highlight: boolean): string {
  return highlight
    ? 'border-2 bg-card'
    : 'border border-border bg-card hover:border-foreground/30';
}

function stepCardStyle(highlight: boolean): React.CSSProperties | undefined {
  return highlight ? { borderColor: 'var(--accent)' } : undefined;
}

function StepIcon({
  step,
  size,
  className = '',
}: {
  step: JourneyStep;
  size: 'sm' | 'md';
  className?: string;
}) {
  // Literal Tailwind classes so the JIT picks them up at build time.
  const sizeClass = size === 'sm' ? 'size-8' : 'size-9';
  return (
    <div
      className={`${sizeClass} rounded-lg flex items-center justify-center ${className}`}
      style={{
        background: step.highlight ? 'var(--accent)' : 'var(--muted)',
        color: step.highlight ? 'var(--accent-foreground)' : 'var(--foreground)',
      }}
    >
      {step.icon}
    </div>
  );
}

function StepText({ step, compact = false }: { step: JourneyStep; compact?: boolean }) {
  return (
    <>
      <div
        className={`text-sm font-semibold text-foreground ${compact ? 'leading-tight' : ''}`}
      >
        {step.role}
      </div>
      <div
        className={`text-xs text-muted-foreground leading-snug italic ${compact ? 'mt-0.5' : ''}`}
      >
        {step.quote}
      </div>
    </>
  );
}

// --- Activity feed ---------------------------------------------------------

function ActivityFeed({
  events,
  onJumpToReturn,
}: {
  events: ActivityEvent[];
  onJumpToReturn: (returnId: string) => void;
}) {
  return (
    <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
      {events.map((e, i) => (
        <li
          key={i}
          className="px-4 py-3 flex items-start gap-3 text-sm"
        >
          <ActivityIcon kind={e.kind} />
          <div className="flex-1 min-w-0">
            <ActivityBody event={e} onJumpToReturn={onJumpToReturn} />
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {relativeTime(e.at)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityIcon({ kind }: { kind: ActivityEvent['kind'] }) {
  const Icon = kind === 'email' ? Mail : CheckCircle2;
  const bg =
    kind === 'email'
      ? 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]'
      : 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]';
  return (
    <div
      className={`size-7 rounded-full flex items-center justify-center shrink-0 ${bg}`}
    >
      <Icon className="size-3.5" />
    </div>
  );
}

function ActivityBody({
  event,
  onJumpToReturn,
}: {
  event: ActivityEvent;
  onJumpToReturn: (returnId: string) => void;
}) {
  if (event.kind === 'email') {
    return (
      <>
        <div className="text-foreground truncate">
          <span className="font-medium">Email</span> to{' '}
          <span className="text-muted-foreground">{event.to ?? '—'}</span>:{' '}
          <span className="text-muted-foreground">"{event.subject}"</span>
        </div>
        <button
          onClick={() => onJumpToReturn(event.return_id)}
          className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          View return →
        </button>
      </>
    );
  }
  return (
    <>
      <div className="text-foreground">
        <span className="font-medium capitalize">{event.action}</span>
        {event.notes && (
          <span className="text-muted-foreground"> · {event.notes}</span>
        )}
        <span className="text-xs text-muted-foreground ml-2">by {event.by}</span>
      </div>
      <button
        onClick={() => onJumpToReturn(event.return_id)}
        className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        View return →
      </button>
    </>
  );
}

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.round((now - d) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
