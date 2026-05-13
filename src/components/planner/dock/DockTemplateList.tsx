import { useEffect, useMemo } from 'react';
import { GripVertical, Layers, Import } from 'lucide-react';
import { useProgramTemplates } from '../../../hooks/useProgramTemplates';
import type { ProgramTemplateSummary } from '../../../lib/database.types';

interface DockTemplateListProps {
  query: string;
  onOpenImport: (templateId: string) => void;
}

function filterTemplates(templates: ProgramTemplateSummary[], query: string): ProgramTemplateSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return templates;
  return templates.filter(t => {
    if (t.name.toLowerCase().includes(q)) return true;
    if (t.description && t.description.toLowerCase().includes(q)) return true;
    if (t.tags?.some(tag => tag.toLowerCase().includes(q))) return true;
    return false;
  });
}

export function DockTemplateList({ query, onOpenImport }: DockTemplateListProps) {
  const { templates, loading, error, fetchTemplates } = useProgramTemplates();

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const filtered = useMemo(() => filterTemplates(templates, query), [templates, query]);

  if (loading && templates.length === 0) {
    return <CentredText>Loading templates…</CentredText>;
  }

  if (error) {
    return (
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-danger-text)',
          background: 'var(--color-danger-bg)',
          border: '0.5px solid var(--color-danger-border)',
          padding: 8,
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {error}
        <div style={{ marginTop: 4, fontStyle: 'italic', color: 'var(--color-text-tertiary)' }}>
          If the program_templates tables are missing, apply the migration
          supabase/migrations/20260513000001_add_program_templates.sql.
        </div>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <CentredText>
        No programme templates yet — "Save day/week as template" will arrive in a later commit.
      </CentredText>
    );
  }

  if (filtered.length === 0) {
    return <CentredText>No templates match "{query.trim()}"</CentredText>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 8,
      }}
    >
      {filtered.map(t => <TemplateCard key={t.id} template={t} onOpenImport={onOpenImport} />)}
    </div>
  );
}

function TemplateCard({
  template,
  onOpenImport,
}: {
  template: ProgramTemplateSummary;
  onOpenImport: (templateId: string) => void;
}) {
  const multiDay = template.day_count > 1;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <div
        draggable
        onDragStart={e => {
          e.dataTransfer.setData('text/plain', `DOCK:template:${template.id}`);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        title={
          multiDay
            ? `Drag onto a day to open the import dialog (or drag a single day below)`
            : `Drag onto a day to apply ${template.name}`
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          background: 'var(--color-bg-secondary)',
          borderBottom: template.day_count > 0 ? '0.5px solid var(--color-border-tertiary)' : 'none',
          cursor: 'grab',
        }}
      >
        <GripVertical size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
        <Layers size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.25,
            }}
          >
            {template.name}
          </span>
          {template.description && (
            <span
              style={{
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-tertiary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontStyle: 'italic',
              }}
            >
              {template.description}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            padding: '1px 6px',
            background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {template.day_count} {template.day_count === 1 ? 'day' : 'days'}
        </span>
        {multiDay && (
          <button
            onClick={e => { e.stopPropagation(); onOpenImport(template.id); }}
            title="Open import dialog to map days deliberately"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 'var(--text-caption)',
              padding: '2px 6px',
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-primary)'; }}
          >
            <Import size={9} />
            Import…
          </button>
        )}
      </div>
      {template.days.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {template.days.map(day => (
            <div
              key={day.id}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('text/plain', `DOCK:template-day:${day.id}`);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              title={`Drag ${day.label} onto a day to append its exercises`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                borderBottom: '0.5px solid var(--color-border-tertiary)',
                cursor: 'grab',
                transition: 'background var(--transition-fast)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-secondary)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <GripVertical size={10} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  flexShrink: 0,
                  minWidth: 14,
                }}
              >
                {day.day_index}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {day.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CentredText({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--color-text-tertiary)',
        fontStyle: 'italic',
        textAlign: 'center',
        padding: '32px 0',
      }}
    >
      {children}
    </div>
  );
}
