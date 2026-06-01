import { useEffect, useMemo, useState } from 'react';
import { Import } from 'lucide-react';
import { useProgramTemplates } from '../../../hooks/useProgramTemplates';
import type { ProgramTemplateSummary } from '../../../lib/database.types';
import { TemplatePreviewDialog } from './TemplatePreviewDialog';
import { DockGroupCard } from './DockGroupCard';

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
    if (t.days.some(d =>
      d.label.toLowerCase().includes(q)
      || d.exercise_names.some(n => n.toLowerCase().includes(q))
    )) return true;
    return false;
  });
}

export function DockTemplateList({ query, onOpenImport }: DockTemplateListProps) {
  const { templates, loading, error, fetchTemplates } = useProgramTemplates();
  const [previewId, setPreviewId] = useState<string | null>(null);

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
        No programme templates yet — open Programme templates from the sidebar to create one.
      </CentredText>
    );
  }

  if (filtered.length === 0) {
    return <CentredText>No templates match "{query.trim()}"</CentredText>;
  }

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 8,
        }}
      >
        {filtered.map(t => (
          <TemplateCard
            key={t.id}
            template={t}
            onOpenImport={onOpenImport}
            onPreview={() => setPreviewId(t.id)}
          />
        ))}
      </div>
      {previewId && (
        <TemplatePreviewDialog
          templateId={previewId}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}

function TemplateCard({
  template,
  onOpenImport,
  onPreview,
}: {
  template: ProgramTemplateSummary;
  onOpenImport: (templateId: string) => void;
  onPreview: () => void;
}) {
  const multiDay = template.day_count > 1;

  return (
    <DockGroupCard
      title={template.name}
      countLabel={`${template.day_count} ${template.day_count === 1 ? 'day' : 'days'}`}
      description={template.description}
      onDoubleClick={onPreview}
      onHeaderDragStart={e => {
        e.dataTransfer.setData('text/plain', `DOCK:template:${template.id}`);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      headerAction={multiDay ? (
        <button
          onClick={e => { e.stopPropagation(); onOpenImport(template.id); }}
          onDoubleClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          title="Open import dialog to map days deliberately"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            padding: 0,
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
          <Import size={10} />
        </button>
      ) : undefined}
      days={template.days.map(day => ({
        key: day.id,
        index: day.day_index,
        label: day.label,
        previewNames: day.exercise_names,
        title: `Drag ${day.label} onto a day to append its exercises`,
        onDragStart: e => {
          e.dataTransfer.setData('text/plain', `DOCK:template-day:${day.id}`);
          e.dataTransfer.effectAllowed = 'copy';
        },
      }))}
    />
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
