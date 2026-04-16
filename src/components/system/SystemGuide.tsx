import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

type Section =
  | 'foundations'
  | 'colors'
  | 'typography'
  | 'spacing'
  | 'buttons'
  | 'inputs'
  | 'badges'
  | 'dots'
  | 'ribbons'
  | 'stat-cards'
  | 'data-tables'
  | 'panels-modals'
  | 'page-layout';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'foundations', label: 'Foundations' },
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'spacing', label: 'Spacing & borders' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'inputs', label: 'Inputs' },
  { id: 'badges', label: 'Badges' },
  { id: 'dots', label: 'Color dots' },
  { id: 'ribbons', label: 'Ribbons' },
  { id: 'stat-cards', label: 'Stat cards' },
  { id: 'data-tables', label: 'Data tables' },
  { id: 'panels-modals', label: 'Panels & modals' },
  { id: 'page-layout', label: 'Page layout' },
];

export function SystemGuide() {
  const [activeSection, setActiveSection] = useState<Section>('foundations');

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--color-bg-page)' }}>
      {/* Left nav */}
      <div
        className="w-[200px] flex-shrink-0 overflow-y-auto"
        style={{ borderRight: '0.5px solid var(--color-border-tertiary)' }}
      >
        <div style={{ padding: '16px 16px 12px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          <div style={{ fontSize: 'var(--text-page-title)', fontWeight: 500, letterSpacing: '-0.01em' }}>
            Style guide
          </div>
          <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
            EMOS design system v1.0
          </div>
        </div>
        <nav style={{ padding: '8px 0' }}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setActiveSection(s.id);
                document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="w-full flex items-center justify-between text-left"
              style={{
                padding: '6px 16px',
                fontSize: 'var(--text-label)',
                color: activeSection === s.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                background: activeSection === s.id ? 'var(--color-bg-secondary)' : 'transparent',
                fontWeight: activeSection === s.id ? 500 : 400,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {s.label}
              <ChevronRight size={12} style={{ opacity: activeSection === s.id ? 1 : 0 }} />
            </button>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '32px 48px' }}>
          <Foundations />
          <Colors />
          <Typography />
          <SpacingAndBorders />
          <Buttons />
          <Inputs />
          <Badges />
          <ColorDots />
          <Ribbons />
          <StatCards />
          <DataTables />
          <PanelsAndModals />
          <PageLayout />
        </div>
      </div>
    </div>
  );
}

// ── Shared wrappers ────────────────────────────────────────────────

function SectionBlock({ id, title, description, children }: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`section-${id}`}
      style={{ marginBottom: 'var(--space-2xl)', scrollMarginTop: '24px' }}
    >
      <header style={{ marginBottom: 'var(--space-lg)', paddingBottom: 'var(--space-md)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <h2 style={{ fontSize: 'var(--text-page-title)', fontWeight: 500, letterSpacing: '-0.01em', margin: 0 }}>
          {title}
        </h2>
        {description && (
          <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)', marginTop: '4px', margin: 0 }}>
            {description}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

function Subhead({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: 'var(--text-section)',
      fontWeight: 500,
      letterSpacing: '-0.005em',
      margin: '0 0 var(--space-md) 0',
      color: 'var(--color-text-primary)',
    }}>
      {children}
    </h3>
  );
}

// ── Section components ─────────────────────────────────────────────

function Foundations() {
  return (
    <SectionBlock
      id="foundations"
      title="Foundations"
      description="EMOS synthesises German rigor with Scandinavian restraint. Mono-forward data, generous whitespace, quiet hairline borders, a single user-defined accent."
    >
      <div style={{
        padding: 'var(--space-xl)',
        background: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-lg)',
        fontSize: 'var(--text-body)',
        color: 'var(--color-text-secondary)',
        lineHeight: 1.6,
      }}>
        <p style={{ margin: '0 0 var(--space-md) 0' }}>
          <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>Core principles:</strong>
        </p>
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          <li>Grayscale by default. Color earns its place by encoding meaning.</li>
          <li>Two font weights: 400 regular, 500 medium. Never bold.</li>
          <li>Five type sizes: 11, 13, 14, 16, 22 px. Never between.</li>
          <li>Sentence case everywhere. Never Title Case, never uppercase.</li>
          <li>Numbers always in IBM Plex Mono, tabular, right-aligned in tables.</li>
          <li>Borders over shadows. Hairlines over thick rules.</li>
          <li>Dot = identity of an entity. Ribbon = phase / state / context.</li>
        </ul>
      </div>
    </SectionBlock>
  );
}

function Colors() {
  return (
    <SectionBlock id="colors" title="Colors" description="Neutrals for surfaces and text, user-defined accent, four semantic states, nine-ramp entity palette.">

      <Subhead>Neutrals</Subhead>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)' }}>
        <Swatch name="--color-bg-page" value="#FAFAF9" bg="var(--color-bg-page)" />
        <Swatch name="--color-bg-primary" value="#FFFFFF" bg="var(--color-bg-primary)" />
        <Swatch name="--color-bg-secondary" value="#F4F4F2" bg="var(--color-bg-secondary)" />
        <Swatch name="--color-bg-tertiary" value="#E9E9E6" bg="var(--color-bg-tertiary)" />
      </div>

      <Subhead>Text</Subhead>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)' }}>
        <TextSwatch name="--color-text-primary" value="#1A1A18" />
        <TextSwatch name="--color-text-secondary" value="#5F5E5A" />
        <TextSwatch name="--color-text-tertiary" value="#8B8A83" />
      </div>

      <Subhead>Borders</Subhead>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)' }}>
        <BorderSwatch name="--color-border-tertiary" value="rgba(0,0,0,0.08)" />
        <BorderSwatch name="--color-border-secondary" value="rgba(0,0,0,0.15)" />
        <BorderSwatch name="--color-border-primary" value="rgba(0,0,0,0.25)" />
      </div>

      <Subhead>Accent (user-defined)</Subhead>
      <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md) 0' }}>
        Default is ink blue. In production, this is set by the coach in settings and applied via CSS custom property.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)' }}>
        <Swatch name="--color-accent" value="#185FA5" bg="var(--color-accent)" onDark />
        <Swatch name="--color-accent-hover" value="#0C447C" bg="var(--color-accent-hover)" onDark />
        <Swatch name="--color-accent-muted" value="rgba(24,95,165,0.08)" bg="var(--color-accent-muted)" />
      </div>

      <Subhead>Semantic states</Subhead>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <SemanticSwatch name="success" bg="var(--color-success-bg)" text="var(--color-success-text)" border="var(--color-success-border)" label="Logged" />
        <SemanticSwatch name="warning" bg="var(--color-warning-bg)" text="var(--color-warning-text)" border="var(--color-warning-border)" label="Behind" />
        <SemanticSwatch name="danger" bg="var(--color-danger-bg)" text="var(--color-danger-text)" border="var(--color-danger-border)" label="Missed" />
        <SemanticSwatch name="info" bg="var(--color-info-bg)" text="var(--color-info-text)" border="var(--color-info-border)" label="Planned" />
      </div>

      <Subhead>Entity palette</Subhead>
      <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md) 0' }}>
        Nine ramps for exercise, category, phase, and athlete colors. Each ramp has seven stops. Entities can also use custom hex codes outside the palette.
      </p>
      {['blue', 'teal', 'coral', 'pink', 'gray', 'green', 'amber', 'red', 'purple'].map((ramp) => (
        <div key={ramp} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xs)' }}>
          <div style={{ width: '60px', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {ramp}
          </div>
          <div style={{ display: 'flex', gap: '2px', flex: 1 }}>
            {['50', '100', '200', '400', '600', '800', '900'].map((stop) => (
              <div
                key={stop}
                title={`var(--color-${ramp}-${stop})`}
                style={{
                  flex: 1,
                  height: '32px',
                  background: `var(--color-${ramp}-${stop})`,
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--text-caption)',
                  fontFamily: 'var(--font-mono)',
                  color: parseInt(stop) >= 400 ? '#FFFFFF' : '#1A1A18',
                }}
              >
                {stop}
              </div>
            ))}
          </div>
        </div>
      ))}
    </SectionBlock>
  );
}

function Swatch({ name, value, bg, onDark }: { name: string; value: string; bg: string; onDark?: boolean }) {
  return (
    <div style={{
      border: '0.5px solid var(--color-border-tertiary)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      background: 'var(--color-bg-primary)',
    }}>
      <div style={{ height: '48px', background: bg }} />
      <div style={{ padding: 'var(--space-sm) var(--space-md)' }}>
        <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: onDark ? 'var(--color-text-primary)' : 'var(--color-text-primary)' }}>
          {name}
        </div>
        <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
          {value}
        </div>
      </div>
    </div>
  );
}

function TextSwatch({ name, value }: { name: string; value: string }) {
  return (
    <div style={{
      border: '0.5px solid var(--color-border-tertiary)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-md)',
      background: 'var(--color-bg-primary)',
    }}>
      <div style={{ fontSize: 'var(--text-body)', color: value, marginBottom: '4px' }}>
        The quick brown fox
      </div>
      <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
        {name}
      </div>
      <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
        {value}
      </div>
    </div>
  );
}

function BorderSwatch({ name, value }: { name: string; value: string }) {
  return (
    <div style={{
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-md)',
      background: 'var(--color-bg-primary)',
      border: `0.5px solid ${value}`,
    }}>
      <div style={{ height: '24px', borderBottom: `0.5px solid ${value}`, marginBottom: 'var(--space-sm)' }} />
      <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
        {name}
      </div>
      <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
        {value}
      </div>
    </div>
  );
}

function SemanticSwatch({ name, bg, text, border, label }: {
  name: string; bg: string; text: string; border: string; label: string;
}) {
  return (
    <div style={{
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-md)',
      background: bg,
      border: `0.5px solid ${border}`,
    }}>
      <div style={{ fontSize: 'var(--text-caption)', fontWeight: 500, color: text, marginBottom: '8px' }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: text, opacity: 0.7 }}>
        {name}
      </div>
    </div>
  );
}

function Typography() {
  return (
    <SectionBlock id="typography" title="Typography" description="Two families, two weights, five sizes.">

      <Subhead>Type scale</Subhead>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <TypeExample name="page-title" size="22px" weight="500" tracking="-0.01em" sample="Spring block" />
        <TypeExample name="section" size="16px" weight="500" tracking="-0.005em" sample="Weekly targets" />
        <TypeExample name="body" size="14px" weight="400" sample="Standard body text reads at this size. Prose and descriptions use this setting." />
        <TypeExample name="label" size="13px" weight="400" sample="Metadata, dates, subdued captions" />
        <TypeExample name="caption" size="11px" weight="400" sample="TABLE COLUMN HEADERS · TINY LABELS" />
      </div>

      <Subhead>Font families</Subhead>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div style={{ padding: 'var(--space-lg)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: '18px', marginBottom: 'var(--space-sm)' }}>
            IBM Plex Sans
          </div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            UI chrome · labels · buttons · body text · page titles
          </div>
          <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-sm)' }}>
            var(--font-sans)
          </div>
        </div>
        <div style={{ padding: 'var(--space-lg)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', marginBottom: 'var(--space-sm)' }}>
            IBM Plex Mono
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            Numbers · dates · codes · identifiers · tabular data
          </div>
          <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-sm)' }}>
            var(--font-mono)
          </div>
        </div>
      </div>

      <Subhead>Number formatting</Subhead>
      <div style={{ padding: 'var(--space-lg)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px var(--space-lg)', fontSize: 'var(--text-body)' }}>
          <div style={{ color: 'var(--color-text-secondary)' }}>Weight</div><div>82 kg · 105 kg · 155 kg</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>Tonnage</div><div>148.3 t</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>Percentage</div><div>92 % · 80 %</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>Date</div><div>Apr 13 · 2026-04-13</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>Date range</div><div>Apr 13 → Jun 28</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>Time</div><div>09:30</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>Rep × set</div><div>5 × 3</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>Week</div><div>W5 · W11</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>Delta</div><div>+12.4 % · −2.1 kg</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>K-value</div><div>0.41</div>
        </div>
      </div>
    </SectionBlock>
  );
}

function TypeExample({ name, size, weight, tracking, sample }: {
  name: string; size: string; weight: string; tracking?: string; sample: string;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: 'var(--space-lg)',
      paddingBottom: 'var(--space-md)',
      borderBottom: '0.5px solid var(--color-border-tertiary)',
    }}>
      <div style={{ width: '120px', flexShrink: 0, fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
        {name}
      </div>
      <div style={{ flex: 1, fontSize: size, fontWeight: weight, letterSpacing: tracking || 0 }}>
        {sample}
      </div>
      <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
        {size} · {weight}
      </div>
    </div>
  );
}

function SpacingAndBorders() {
  return (
    <SectionBlock id="spacing" title="Spacing & borders" description="Six spacing stops. Four radius stops. Hairline borders.">

      <Subhead>Spacing scale</Subhead>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)' }}>
        {[
          { name: '--space-xs', value: '4px' },
          { name: '--space-sm', value: '8px' },
          { name: '--space-md', value: '12px' },
          { name: '--space-lg', value: '16px' },
          { name: '--space-xl', value: '24px' },
          { name: '--space-2xl', value: '32px' },
        ].map(s => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <div style={{ width: '120px', fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
              {s.name}
            </div>
            <div style={{ height: '20px', width: s.value, background: 'var(--color-accent-muted)', border: '0.5px solid var(--color-accent-border)', borderRadius: '2px' }} />
            <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <Subhead>Radius scale</Subhead>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        {[
          { name: '--radius-sm', value: '4px' },
          { name: '--radius-md', value: '6px' },
          { name: '--radius-lg', value: '8px' },
          { name: '--radius-xl', value: '12px' },
        ].map(r => (
          <div key={r.name} style={{
            padding: 'var(--space-lg)',
            background: 'var(--color-bg-secondary)',
            borderRadius: r.value,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
              {r.name}
            </div>
            <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
              {r.value}
            </div>
          </div>
        ))}
      </div>

      <Subhead>Borders</Subhead>
      <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md) 0' }}>
        All borders are 0.5px hairlines. The color varies based on emphasis.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-md)' }}>
        {['tertiary', 'secondary', 'primary'].map(level => (
          <div key={level} style={{
            padding: 'var(--space-lg)',
            border: `0.5px solid var(--color-border-${level})`,
            borderRadius: 'var(--radius-md)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
              --color-border-{level}
            </div>
          </div>
        ))}
      </div>
    </SectionBlock>
  );
}

function Buttons() {
  const btnBase: React.CSSProperties = {
    fontFamily: 'var(--font-sans)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'all 100ms ease-out',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-xs)',
  };

  const sizes = {
    sm: { height: '28px', padding: '4px 10px', fontSize: 'var(--text-caption)' },
    md: { height: '32px', padding: '6px 14px', fontSize: 'var(--text-label)' },
    lg: { height: '40px', padding: '10px 18px', fontSize: 'var(--text-body)' },
  };

  const variants = {
    primary: { background: 'var(--color-accent)', color: 'var(--color-text-on-accent)', border: 'none', fontWeight: 500 },
    secondary: { background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-secondary)', fontWeight: 400 },
    ghost: { background: 'transparent', color: 'var(--color-text-secondary)', border: 'none', fontWeight: 400 },
    danger: { background: 'var(--color-bg-primary)', color: 'var(--color-danger-text)', border: '0.5px solid var(--color-danger-border)', fontWeight: 400 },
  };

  return (
    <SectionBlock id="buttons" title="Buttons" description="Three variants × three sizes. Primary is the user's accent color.">
      {(['sm', 'md', 'lg'] as const).map(size => (
        <div key={size} style={{ marginBottom: 'var(--space-lg)' }}>
          <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-sm)' }}>
            Size: {size}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
            <button style={{ ...btnBase, ...sizes[size], ...variants.primary }}>Open week</button>
            <button style={{ ...btnBase, ...sizes[size], ...variants.secondary }}>Export</button>
            <button style={{ ...btnBase, ...sizes[size], ...variants.ghost }}>Cancel</button>
            <button style={{ ...btnBase, ...sizes[size], ...variants.danger }}>Delete</button>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 'var(--space-lg)', padding: 'var(--space-md)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
        <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>Rules:</strong> Medium (32px) is the default. Primary used for the single most important action per page. No shadows. Hover darkens 10 % for primary; shifts to secondary bg for other variants.
      </div>
    </SectionBlock>
  );
}

function Inputs() {
  const inputStyle: React.CSSProperties = {
    height: '32px',
    padding: '6px 12px',
    border: '0.5px solid var(--color-border-tertiary)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-body)',
    fontFamily: 'var(--font-sans)',
    background: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <SectionBlock id="inputs" title="Inputs" description="Text, number, select, textarea, checkbox. Focus uses accent ring.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-lg)' }}>
        <div>
          <label style={{ display: 'block', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)' }}>
            Text input
          </label>
          <input type="text" placeholder="Macro name" style={inputStyle} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)' }}>
            Number input (mono)
          </label>
          <input type="number" defaultValue="82" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)' }}>
            Select
          </label>
          <select style={inputStyle}>
            <option>Foundation</option>
            <option>Build</option>
            <option>Peak</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)' }}>
            Disabled
          </label>
          <input type="text" disabled value="Read-only value" style={{ ...inputStyle, background: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }} />
        </div>
      </div>
      <div style={{ marginTop: 'var(--space-lg)' }}>
        <label style={{ display: 'block', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)' }}>
          Textarea
        </label>
        <textarea rows={3} placeholder="Coach notes for this phase..." style={{ ...inputStyle, height: 'auto', resize: 'vertical', width: '100%' }} />
      </div>
    </SectionBlock>
  );
}

function Badges() {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-caption)',
    fontWeight: 500,
    fontFamily: 'var(--font-sans)',
  };

  return (
    <SectionBlock id="badges" title="Badges" description="Small semantic markers. Four semantic variants plus neutral.">
      <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-lg)' }}>
        <span style={{ ...base, background: 'var(--color-success-bg)', color: 'var(--color-success-text)' }}>Logged</span>
        <span style={{ ...base, background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)' }}>Behind</span>
        <span style={{ ...base, background: 'var(--color-danger-bg)', color: 'var(--color-danger-text)' }}>Missed</span>
        <span style={{ ...base, background: 'var(--color-info-bg)', color: 'var(--color-info-text)' }}>Planned</span>
        <span style={{ ...base, background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>Archived</span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
        <span style={{ ...base, borderRadius: '999px', background: 'var(--color-success-bg)', color: 'var(--color-success-text)' }}>92 % done</span>
        <span style={{ ...base, borderRadius: '999px', background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)' }}>64 % done</span>
        <span style={{ ...base, borderRadius: '999px', background: 'var(--color-info-bg)', color: 'var(--color-info-text)' }}>36 % in progress</span>
      </div>
    </SectionBlock>
  );
}

function ColorDots() {
  return (
    <SectionBlock id="dots" title="Color dots" description="Dots encode entity identity — the color of the exercise, category, or athlete itself.">
      <Subhead>Sizes</Subhead>
      <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-blue-400)', display: 'inline-block' }} />
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>6px (inline)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-teal-400)', display: 'inline-block' }} />
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>8px (standalone)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--color-coral-400)', display: 'inline-block' }} />
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>10px (prominent)</span>
        </div>
      </div>

      <Subhead>In context — exercise list</Subhead>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: 'var(--space-md)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
        {[
          { dot: 'var(--color-blue-400)', code: 'Sn', name: 'Snatch' },
          { dot: 'var(--color-red-400)', code: 'C&J', name: 'Clean & Jerk' },
          { dot: 'var(--color-teal-400)', code: 'BSq', name: 'Back Squat' },
          { dot: 'var(--color-purple-400)', code: 'PSn', name: 'Power Snatch' },
          { dot: 'var(--color-coral-400)', code: 'SnPl', name: 'Snatch Pull' },
        ].map(ex => (
          <div key={ex.code} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '6px 10px', fontSize: 'var(--text-label)', background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-sm)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ex.dot, flexShrink: 0, display: 'inline-block' }} />
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)', minWidth: '40px' }}>{ex.code}</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>{ex.name}</span>
          </div>
        ))}
      </div>
    </SectionBlock>
  );
}

function Ribbons() {
  return (
    <SectionBlock id="ribbons" title="Ribbons" description="Ribbons encode phase, state, or structural context — where an entity sits within a larger structure.">
      <Subhead>Macro phase ribbons (left-border)</Subhead>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        {[
          { color: 'var(--color-blue-600)', name: 'Foundation', weeks: 'W 1 — 6' },
          { color: 'var(--color-amber-400)', name: 'Build', weeks: 'W 7 — 10' },
          { color: 'var(--color-green-400)', name: 'Peak', weeks: 'W 11' },
        ].map(p => (
          <div key={p.name} style={{
            padding: 'var(--space-md) var(--space-lg)',
            background: 'var(--color-bg-primary)',
            borderLeft: `2px solid ${p.color}`,
          }}>
            <div style={{ fontSize: 'var(--text-label)', fontWeight: 500 }}>{p.name}</div>
            <div style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
              {p.weeks}
            </div>
          </div>
        ))}
      </div>

      <Subhead>Selected row (2px accent border)</Subhead>
      <div style={{ background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {['Week 3', 'Week 4', 'Week 5', 'Week 6'].map((w, i) => {
            const isCurrent = w === 'Week 5';
            return (
              <div
                key={w}
                style={{
                  display: 'flex',
                  gap: 'var(--space-md)',
                  padding: '10px var(--space-md)',
                  background: isCurrent ? 'var(--color-info-bg)' : 'var(--color-bg-primary)',
                  borderRadius: 'var(--radius-sm)',
                  borderLeft: isCurrent ? '2px solid var(--color-accent)' : '2px solid transparent',
                  fontSize: 'var(--text-label)',
                  fontFamily: 'var(--font-mono)',
                  color: isCurrent ? 'var(--color-info-text)' : 'var(--color-text-primary)',
                }}
              >
                <span>{w}</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>May {8 + i * 7}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-lg)', padding: 'var(--space-md)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
        <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>Rule:</strong> Dots answer "what is this?" Ribbons answer "where does this sit?" Never use one for the other's role.
      </div>
    </SectionBlock>
  );
}

function StatCards() {
  return (
    <SectionBlock id="stat-cards" title="Stat cards" description="Tinted-fill tiles for summary numbers. No border — the grid gap separates them.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'var(--color-border-tertiary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 'var(--space-lg)' }}>
        {[
          { label: 'Total reps', value: '1,648', unit: '', delta: '+8.2 %' },
          { label: 'Tonnage', value: '148.3', unit: 't', delta: '+12.4 %' },
          { label: 'Average load', value: '90', unit: 'kg', delta: '−2.1 kg' },
          { label: 'Compliance', value: '92', unit: '%', delta: '4 of 5 wks' },
        ].map(s => (
          <div key={s.label} style={{ padding: '14px 16px', background: 'var(--color-bg-secondary)' }}>
            <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
              {s.label}
            </div>
            <div style={{ fontSize: '22px', fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)', lineHeight: 1.1 }}>
              {s.value}
              {s.unit && <sub style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)', fontWeight: 400, marginLeft: '3px', verticalAlign: 'baseline' }}>{s.unit}</sub>}
            </div>
            <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
              {s.delta}
            </div>
          </div>
        ))}
      </div>
    </SectionBlock>
  );
}

function DataTables() {
  return (
    <SectionBlock id="data-tables" title="Data tables" description="Mono cells, right-aligned numbers, hairline row dividers, current-row highlight.">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)' }}>
        <thead>
          <tr>
            {['Wk', 'Type', 'Date', 'Reps', 'Tonnage', 'Avg load'].map((h, i) => (
              <th key={h} style={{ textAlign: i >= 3 ? 'right' : 'left', fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', padding: '10px 12px 8px', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            { wk: 1, type: 'High', date: 'Apr 13', reps: '136', tonnage: '12.4 t', avg: '91 kg', current: false },
            { wk: 2, type: 'High', date: 'Apr 20', reps: '168', tonnage: '14.8 t', avg: '88 kg', current: false },
            { wk: 3, type: 'Low', date: 'Apr 27', reps: '84', tonnage: '8.1 t', avg: '96 kg', current: false },
            { wk: 4, type: 'High', date: 'May 4', reps: '182', tonnage: '16.2 t', avg: '89 kg', current: false },
            { wk: 5, type: 'High', date: 'May 11', reps: '174', tonnage: '15.8 t', avg: '91 kg', current: true },
          ].map(r => (
            <tr key={r.wk} style={{ background: r.current ? 'var(--color-info-bg)' : 'transparent' }}>
              <td style={{ padding: '11px 12px', borderBottom: '0.5px solid var(--color-border-tertiary)', borderLeft: r.current ? '2px solid var(--color-accent)' : '2px solid transparent', color: 'var(--color-text-primary)' }}>{r.wk}</td>
              <td style={{ padding: '11px 12px', borderBottom: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-label)' }}>{r.type}</td>
              <td style={{ padding: '11px 12px', borderBottom: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-label)' }}>{r.date}</td>
              <td style={{ padding: '11px 12px', borderBottom: '0.5px solid var(--color-border-tertiary)', textAlign: 'right' }}>{r.reps}</td>
              <td style={{ padding: '11px 12px', borderBottom: '0.5px solid var(--color-border-tertiary)', textAlign: 'right' }}>{r.tonnage}</td>
              <td style={{ padding: '11px 12px', borderBottom: '0.5px solid var(--color-border-tertiary)', textAlign: 'right' }}>{r.avg}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} style={{ padding: '12px', borderTop: '0.5px solid var(--color-border-secondary)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>Average</td>
            <td style={{ padding: '12px', borderTop: '0.5px solid var(--color-border-secondary)', textAlign: 'right', fontWeight: 500 }}>149</td>
            <td style={{ padding: '12px', borderTop: '0.5px solid var(--color-border-secondary)', textAlign: 'right', fontWeight: 500 }}>13.5 t</td>
            <td style={{ padding: '12px', borderTop: '0.5px solid var(--color-border-secondary)', textAlign: 'right', fontWeight: 500 }}>91 kg</td>
          </tr>
        </tbody>
      </table>
    </SectionBlock>
  );
}

function PanelsAndModals() {
  return (
    <SectionBlock id="panels-modals" title="Panels & modals" description="Side panel for browsing/viewing. Modal for focused creation and destructive confirmation.">
      <Subhead>Side panel (preview)</Subhead>
      <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md) 0' }}>
        Right-side panel pushes list narrower. No backdrop — page remains interactive.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-md)', height: '240px', background: 'var(--color-bg-secondary)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-xl)' }}>
        <div style={{ flex: 1, background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-md)' }}>
          <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-sm)' }}>
            Exercise list
          </div>
          {[
            { code: 'Sn', name: 'Snatch', pr: '82 kg', selected: false },
            { code: 'BSq', name: 'Back Squat', pr: '155 kg', selected: true },
            { code: 'C&J', name: 'Clean & Jerk', pr: '105 kg', selected: false },
          ].map(e => (
            <div key={e.code} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
              padding: '6px 8px', borderRadius: 'var(--radius-sm)',
              background: e.selected ? 'var(--color-info-bg)' : 'transparent',
              fontSize: 'var(--text-label)',
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-blue-400)', display: 'inline-block' }} />
              <span style={{ fontFamily: 'var(--font-mono)', minWidth: '36px' }}>{e.code}</span>
              <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>{e.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{e.pr}</span>
            </div>
          ))}
        </div>
        <div style={{ width: '200px', flexShrink: 0, background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-md)', borderLeft: '0.5px solid var(--color-border-tertiary)' }}>
          <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-sm)' }}>
            Detail panel
          </div>
          <div style={{ fontSize: 'var(--text-label)', fontWeight: 500, marginBottom: '4px' }}>Back Squat</div>
          <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-md)' }}>Squats · PR tracked</div>
          <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>Current PR</div>
          <div style={{ fontSize: '18px', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>155 kg</div>
        </div>
      </div>

      <Subhead>Modal (preview)</Subhead>
      <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md) 0' }}>
        Centered overlay with backdrop. Page locked. Use for focused creation or destructive confirmation.
      </p>
      <div style={{ position: 'relative', height: '240px', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: '320px',
          background: 'var(--color-bg-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-lg)',
        }}>
          <div style={{ fontSize: 'var(--text-section)', fontWeight: 500, marginBottom: '4px' }}>New macrocycle</div>
          <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-lg)' }}>
            Create a training block for this athlete
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Name</label>
              <div style={{ height: '24px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Duration</label>
              <div style={{ height: '24px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-lg)' }}>
            <button style={{ padding: '6px 14px', fontSize: 'var(--text-label)', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', cursor: 'pointer' }}>Cancel</button>
            <button style={{ padding: '6px 14px', fontSize: 'var(--text-label)', fontWeight: 500, border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', color: 'var(--color-text-on-accent)', cursor: 'pointer' }}>Create</button>
          </div>
        </div>
      </div>
    </SectionBlock>
  );
}

function PageLayout() {
  return (
    <SectionBlock id="page-layout" title="Page layout" description="Three framings: standard content page, dense tool page, full-bleed immersive.">

      <Subhead>Framing A — standard content page (default)</Subhead>
      <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md) 0' }}>
        White work surface inside off-white page. 24 px gap on all sides. Max width 1400 px centered.
      </p>
      <div style={{ background: 'var(--color-bg-page)', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', padding: '24px', marginBottom: 'var(--space-xl)' }}>
        <div style={{ background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', minHeight: '140px' }}>
          <div style={{ fontSize: 'var(--text-section)', fontWeight: 500, marginBottom: 'var(--space-sm)' }}>Work surface</div>
          <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
            Used for: macro detail, exercise library, athlete list, settings.
          </div>
        </div>
      </div>

      <Subhead>Framing B — dense tool page</Subhead>
      <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md) 0' }}>
        Edge-to-edge on the right. 24 px gap on the left only. Maximum screen real estate for dense data.
      </p>
      <div style={{ background: 'var(--color-bg-page)', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', padding: '24px 0 24px 24px', marginBottom: 'var(--space-xl)' }}>
        <div style={{ background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRight: 'none', borderTopLeftRadius: 'var(--radius-lg)', borderBottomLeftRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', minHeight: '140px' }}>
          <div style={{ fontSize: 'var(--text-section)', fontWeight: 500, marginBottom: 'var(--space-sm)' }}>Dense work surface</div>
          <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
            Used for: weekly planner (detail), macro annual wheel, dense tables.
          </div>
        </div>
      </div>

      <Subhead>Framing C — full-bleed immersive</Subhead>
      <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md) 0' }}>
        No framing. Surface is the page. Reserved for dashboards and print views.
      </p>
      <div style={{ background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', padding: 'var(--space-lg)', minHeight: '140px' }}>
        <div style={{ fontSize: 'var(--text-section)', fontWeight: 500, marginBottom: 'var(--space-sm)' }}>Full-bleed surface</div>
        <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
          Used for: landing dashboard, print views.
        </div>
      </div>
    </SectionBlock>
  );
}
