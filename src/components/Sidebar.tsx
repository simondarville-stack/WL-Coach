import { useState } from 'react';
import {
  Dumbbell,
  BarChart3,
  Calendar,
  TrendingUp,
  CalendarDays,
  Users,
  UsersRound,
  Eye,
  ClipboardList,
  BookOpen,
  Settings,
  ChevronsLeft,
  type LucideIcon,
} from 'lucide-react';

type Page =
  | 'athletes'
  | 'library'
  | 'planner'
  | 'macrocycles'
  | 'athlete_programme'
  | 'athlete_log'
  | 'general_settings'
  | 'coach_dashboard'
  | 'events'
  | 'training_groups';

interface NavItem {
  key: Page;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    label: 'Planning',
    items: [
      { key: 'coach_dashboard', label: 'Dashboard', icon: BarChart3 },
      { key: 'planner', label: 'Weekly planner', icon: Calendar },
      { key: 'macrocycles', label: 'Macro cycles', icon: TrendingUp },
      { key: 'events', label: 'Events', icon: CalendarDays },
    ],
  },
  {
    label: 'Athletes',
    items: [
      { key: 'athletes', label: 'Roster', icon: Users },
      { key: 'training_groups', label: 'Training groups', icon: UsersRound },
      { key: 'athlete_programme', label: 'Programme', icon: Eye },
      { key: 'athlete_log', label: 'Training log', icon: ClipboardList },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'library', label: 'Exercise library', icon: BookOpen },
      { key: 'general_settings', label: 'Settings', icon: Settings },
    ],
  },
];

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('winwota_sidebar_collapsed') === 'true';
  });

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('winwota_sidebar_collapsed', String(next));
  }

  return (
    <aside
      className={`flex flex-col flex-shrink-0 bg-gray-50 border-r border-gray-200 transition-all duration-150 ease-in-out overflow-hidden ${
        collapsed ? 'w-12' : 'w-[200px]'
      }`}
    >
      {/* Logo / App name */}
      <div
        className={`flex items-center gap-2 border-b border-gray-200 cursor-pointer flex-shrink-0 ${
          collapsed ? 'justify-center px-0 py-3' : 'px-3 py-3'
        }`}
        onClick={() => onNavigate('coach_dashboard')}
        title="WinWota 2.0"
      >
        <Dumbbell className="text-blue-600 flex-shrink-0" size={20} />
        {!collapsed && (
          <span className="font-semibold text-sm text-gray-900 whitespace-nowrap overflow-hidden">
            WinWota 2.0
          </span>
        )}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto py-1">
        {sections.map((section, sIdx) => (
          <div key={section.label}>
            {/* Section header */}
            {collapsed ? (
              sIdx > 0 && (
                <div className="mx-2 my-2 border-t border-gray-200" />
              )
            ) : (
              <div
                className={`px-3 pb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap overflow-hidden ${
                  sIdx === 0 ? 'pt-2' : 'pt-4'
                }`}
              >
                {section.label}
              </div>
            )}

            {/* Nav items */}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.key;

              return (
                <button
                  key={item.key}
                  onClick={() => onNavigate(item.key)}
                  title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-2 text-[13px] transition-colors duration-100 ${
                    collapsed
                      ? 'justify-center py-2 px-0'
                      : 'py-1.5 px-3'
                  } ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <Icon
                    size={16}
                    className={`flex-shrink-0 ${
                      isActive ? 'text-blue-700' : ''
                    }`}
                  />
                  {!collapsed && (
                    <span className="whitespace-nowrap overflow-hidden">
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="flex-shrink-0 border-t border-gray-200">
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`w-full flex items-center gap-2 text-gray-400 hover:text-gray-600 transition-colors duration-100 ${
            collapsed ? 'justify-center py-2.5 px-0' : 'py-2.5 px-3'
          }`}
        >
          <ChevronsLeft
            size={16}
            className={`flex-shrink-0 transition-transform duration-150 ${
              collapsed ? 'rotate-180' : ''
            }`}
          />
          {!collapsed && (
            <span className="text-[13px] whitespace-nowrap overflow-hidden">
              Collapse
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
