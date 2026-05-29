import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { addBreadcrumb } from '../lib/errorLogger';

/**
 * Records every route change as a breadcrumb on the error logger. Mount
 * once per router subtree (CoachApp + AthleteApp both call it).
 */
export function useRouteBreadcrumbs(): void {
  const location = useLocation();
  useEffect(() => {
    addBreadcrumb({
      category: 'nav',
      message: location.pathname,
      data: location.search ? { search: location.search } : undefined,
    });
  }, [location.pathname, location.search]);
}
