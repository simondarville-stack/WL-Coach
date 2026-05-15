import { useState, useCallback } from 'react';
import * as svc from '../lib/templateService';
import type {
  ProgramTemplate,
  ProgramTemplateFull,
  ProgramTemplateSummary,
} from '../lib/database.types';

export function useProgramTemplates() {
  const [templates, setTemplates] = useState<ProgramTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrap = useCallback(async <T,>(fn: () => Promise<T>, fallbackMsg: string): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackMsg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTemplates = useCallback(async (): Promise<ProgramTemplateSummary[]> => {
    const result = await wrap(svc.fetchTemplates, 'Failed to load templates');
    if (result) setTemplates(result);
    return result ?? [];
  }, [wrap]);

  const fetchTemplateFull = useCallback(
    async (id: string): Promise<ProgramTemplateFull | null> =>
      wrap(() => svc.fetchTemplateFull(id), 'Failed to load template'),
    [wrap],
  );

  const createTemplate = useCallback(
    async (input: { name: string; description?: string | null; tags?: string[] }): Promise<ProgramTemplate | null> => {
      const result = await wrap(() => svc.createTemplate(input), 'Failed to create template');
      if (result) await fetchTemplates();
      return result;
    },
    [wrap, fetchTemplates],
  );

  const updateTemplate = useCallback(
    async (id: string, patch: { name?: string; description?: string | null; tags?: string[] }): Promise<boolean> => {
      const result = await wrap(() => svc.updateTemplate(id, patch).then(() => true), 'Failed to update template');
      if (result) await fetchTemplates();
      return result === true;
    },
    [wrap, fetchTemplates],
  );

  const deleteTemplate = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await wrap(() => svc.deleteTemplate(id).then(() => true), 'Failed to delete template');
      if (result) await fetchTemplates();
      return result === true;
    },
    [wrap, fetchTemplates],
  );

  const duplicateTemplate = useCallback(
    async (id: string, newName?: string): Promise<ProgramTemplate | null> => {
      const result = await wrap(() => svc.duplicateTemplate(id, newName), 'Failed to duplicate template');
      if (result) await fetchTemplates();
      return result;
    },
    [wrap, fetchTemplates],
  );

  const createTemplateFromDay = useCallback(
    async (
      weekPlanId: string,
      dayIndex: number,
      name: string,
      opts?: { description?: string | null; tags?: string[]; dayLabel?: string },
    ): Promise<ProgramTemplate | null> => {
      const result = await wrap(
        () => svc.createTemplateFromDay(weekPlanId, dayIndex, name, opts),
        'Failed to save template from day',
      );
      if (result) await fetchTemplates();
      return result;
    },
    [wrap, fetchTemplates],
  );

  const createTemplateFromWeek = useCallback(
    async (
      weekPlanId: string,
      name: string,
      opts?: {
        description?: string | null;
        tags?: string[];
        dayLabels?: Record<number, string> | null;
        includeDays?: number[];
      },
    ): Promise<ProgramTemplate | null> => {
      const result = await wrap(
        () => svc.createTemplateFromWeek(weekPlanId, name, opts),
        'Failed to save template from week',
      );
      if (result) await fetchTemplates();
      return result;
    },
    [wrap, fetchTemplates],
  );

  const applyTemplateDayToPlanDay = useCallback(
    async (
      templateDayId: string,
      weekPlanId: string,
      targetDayIndex: number,
      opts?: { replace?: boolean },
    ): Promise<boolean> => {
      const result = await wrap(
        () => svc.applyTemplateDayToPlanDay(templateDayId, weekPlanId, targetDayIndex, opts).then(() => true),
        'Failed to apply template day',
      );
      return result === true;
    },
    [wrap],
  );

  const applyTemplateToPlan = useCallback(
    async (
      templateId: string,
      weekPlanId: string,
      mapping: Record<number, number | null>,
      opts?: { replace?: boolean },
    ): Promise<boolean> => {
      const result = await wrap(
        () => svc.applyTemplateToPlan(templateId, weekPlanId, mapping, opts).then(() => true),
        'Failed to apply template',
      );
      return result === true;
    },
    [wrap],
  );

  return {
    templates,
    loading,
    error,
    setError,
    fetchTemplates,
    fetchTemplateFull,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    createTemplateFromDay,
    createTemplateFromWeek,
    applyTemplateDayToPlanDay,
    applyTemplateToPlan,
  };
}
