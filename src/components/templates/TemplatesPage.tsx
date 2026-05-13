import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Copy, Trash2, FileText } from 'lucide-react';
import { useProgramTemplates } from '../../hooks/useProgramTemplates';
import type { ProgramTemplateSummary } from '../../lib/database.types';

export function TemplatesPage() {
  const navigate = useNavigate();
  const { templates, loading, error, fetchTemplates, createTemplate, duplicateTemplate, deleteTemplate } = useProgramTemplates();
  const [creating, setCreating] = useState(false);

  useEffect(() => { void fetchTemplates(); }, [fetchTemplates]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const created = await createTemplate({ name: 'Untitled template' });
      if (created) navigate(`/templates/${created.id}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDuplicate = async (t: ProgramTemplateSummary) => {
    const copy = await duplicateTemplate(t.id);
    if (copy) navigate(`/templates/${copy.id}`);
  };

  const handleDelete = async (t: ProgramTemplateSummary) => {
    if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    await deleteTemplate(t.id);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-secondary)', padding: 16 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>
              Programme templates
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4, marginBottom: 0 }}>
              Reusable bundles of one or more days, each with their own exercises and prescriptions. Drop them into the weekly planner from the dock.
            </p>
          </div>
          <button
            onClick={() => void handleCreate()}
            disabled={creating}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, padding: '6px 12px',
              background: 'var(--color-accent)', color: 'var(--color-text-on-accent)',
              border: 'none', borderRadius: 'var(--radius-sm)',
              cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.6 : 1,
            }}
          >
            <Plus size={12} /> New template
          </button>
        </div>

        {error && (
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-danger-text)', background: 'var(--color-danger-bg)', border: '0.5px solid var(--color-danger-border)', padding: 10, borderRadius: 'var(--radius-sm)' }}>
            {error}
            <div style={{ marginTop: 4, fontStyle: 'italic', color: 'var(--color-text-tertiary)' }}>
              If the program_templates tables are missing, apply supabase/migrations/20260513000001_add_program_templates.sql.
            </div>
          </div>
        )}

        {loading && templates.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12 }}>
            Loading templates…
          </div>
        ) : templates.length === 0 ? (
          <EmptyState onCreate={() => void handleCreate()} />
        ) : (
          <TemplateTable
            templates={templates}
            onOpen={t => navigate(`/templates/${t.id}`)}
            onDuplicate={t => void handleDuplicate(t)}
            onDelete={t => void handleDelete(t)}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={{
      padding: 60, textAlign: 'center', background: 'var(--color-bg-primary)',
      border: '0.5px dashed var(--color-border-secondary)', borderRadius: 'var(--radius-lg)',
    }}>
      <FileText size={28} style={{ color: 'var(--color-text-tertiary)', margin: '0 auto 12px' }} />
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 4px' }}>
        No programme templates yet
      </p>
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 16px' }}>
        Create a template here, or use "Save day/week as template" inside the weekly planner (coming soon) to seed from an existing plan.
      </p>
      <button
        onClick={onCreate}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, padding: '6px 12px',
          background: 'var(--color-accent)', color: 'var(--color-text-on-accent)',
          border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        }}
      >
        <Plus size={12} /> Create your first template
      </button>
    </div>
  );
}

interface TableProps {
  templates: ProgramTemplateSummary[];
  onOpen: (t: ProgramTemplateSummary) => void;
  onDuplicate: (t: ProgramTemplateSummary) => void;
  onDelete: (t: ProgramTemplateSummary) => void;
}

function TemplateTable({ templates, onOpen, onDuplicate, onDelete }: TableProps) {
  return (
    <div style={{ background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 100px',
        gap: 12, padding: '8px 16px',
        background: 'var(--color-bg-secondary)',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        <span>Name</span>
        <span>Days</span>
        <span>Updated</span>
        <span style={{ textAlign: 'right' }}>Actions</span>
      </div>
      {templates.map(t => (
        <div
          key={t.id}
          onClick={() => onOpen(t)}
          style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 100px',
            gap: 12, padding: '10px 16px', alignItems: 'center',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            cursor: 'pointer',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-secondary)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {t.name}
            </span>
            {t.description && (
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
                {t.description}
              </span>
            )}
          </div>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {t.day_count} {t.day_count === 1 ? 'day' : 'days'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {new Date(t.updated_at).toLocaleDateString()}
          </span>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
            <IconButton title="Duplicate" onClick={e => { e.stopPropagation(); onDuplicate(t); }}>
              <Copy size={12} />
            </IconButton>
            <IconButton title="Delete" danger onClick={e => { e.stopPropagation(); onDelete(t); }}>
              <Trash2 size={12} />
            </IconButton>
          </div>
        </div>
      ))}
    </div>
  );
}

function IconButton({
  children, onClick, title, danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, padding: 0, background: 'transparent',
        border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
        cursor: 'pointer', color: danger ? 'var(--color-danger-text)' : 'var(--color-text-secondary)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.background = danger ? 'var(--color-danger-bg)' : 'var(--color-bg-tertiary)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}
