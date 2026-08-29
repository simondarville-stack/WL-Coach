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
    const result = await wrap(svc.fetchTemplates, 'Couldn’t load templates. Check your connection and try again.');
    if (result) setTemplates(result);
    return result ?? [];
  }, [wrap]);

  const fetchTemplateFull = useCallback(
    async (id: string): Promise<ProgramTemplateFull | null> =>
      wrap(() => svc.fetchTemplateFull(id), 'Couldn’t load template. Check your connection and try again.'),
    [wrap],
  );

  const createTemplate = useCallback(
    async (input: { name: string; description?: string | null; tags?: string[] }): Promise<ProgramTemplate | null> => {
      const result = await wrap(() => svc.createTemplate(input), 'Couldn’t create template. Nothing was created.');
      if (result) await fetchTemplates();
      return result;
    },
    [wrap, fetchTemplates],
  );

  const updateTemplate = useCallback(
    async (id: string, patch: { name?: string; description?: string | null; tags?: string[] }): Promise<boolean> => {
      const result = await wrap(() => svc.updateTemplate(id, patch).then(() => true), 'Couldn’t update template. Nothing was changed.');
      if (result) await fetchTemplates();
      return result === true;
    },
    [wrap, fetchTemplates],
  );

  const deleteTemplate = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await wrap(() => svc.deleteTemplate(id).then(() => true), 'Couldn’t delete template. Nothing was deleted.');
      if (result) await fetchTemplates();
      return result === true;
    },
    [wrap, fetchTemplates],
  );

  const duplicateTemplate = useCallback(
    async (id: string, newName?: string): Promise<ProgramTemplate | null> => {
      const result = await wrap(() => svc.duplicateTemplate(id, newName), 'Couldn’t duplicate template. Nothing was copied.');
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
        'Couldn’t save template from day. Your changes are still on screen.',
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
        'Couldn’t save template from week. Your changes are still on screen.',
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
        'Couldn’t apply template day. Nothing was applied.',
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
        'Couldn’t apply template. Nothing was applied.',
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
